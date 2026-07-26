# Ferramentas internas do Frota IA (`src/ai/tools`)

## Finalidade

Esta pasta reúne as **ferramentas de cálculo** usadas pelo Frota IA: funções
determinísticas em TypeScript que fazem as contas de custo, consumo,
margem, viabilidade de frete, jornada etc. A regra de ouro é:

> **O modelo de linguagem nunca deve fazer contas sozinho.** Ele descreve o
> que o usuário quer, pede os dados que faltam e delega o cálculo em si para
> uma dessas ferramentas — que devolve números exatos, reproduzíveis e sem
> alucinação.

Cada ferramenta é independente, testável isoladamente e não depende de
nenhuma API externa nesta fase.

## Estado atual

| Ferramenta | Arquivo | Status |
|---|---|---|
| `calcular_combustivel` | `calcular-combustivel.ts` | **Lógica implementada** |
| `calcular_cpk` | `calcular-cpk.ts` | **Lógica implementada** |
| `comparar_pneus` | `comparar-pneus.ts` | **Lógica implementada** |
| `calcular_custo_viagem` | `calcular-custo-viagem.ts` | **Lógica implementada** |
| `calcular_margem` | `calcular-margem.ts` | **Lógica implementada** |
| `analisar_frete` | `analisar-frete.ts` | **Lógica implementada** |
| `calcular_valor_minimo_frete` | `calcular-valor-minimo-frete.ts` | **Lógica implementada** |
| `calcular_receita_km` | `calcular-receita-km.ts` | **Lógica implementada** |
| `calcular_custo_dia` | `calcular-custo-dia.ts` | **Lógica implementada** |
| `calcular_custo_veiculo_parado` | `calcular-custo-veiculo-parado.ts` | **Lógica implementada** |
| `calcular_jornada` | `calcular-jornada.ts` | Estrutura apenas |

"Estrutura apenas" significa: tipos de entrada/saída, parâmetros
documentados e a função `executar` já existem, mas o corpo lança
`Error("... logica ainda nao implementada (etapa de estrutura).")`. Cada uma
será implementada em uma etapa própria, seguindo o mesmo padrão usado em
`calcular-combustivel.ts`.

## Contrato comum (`types.ts`)

Toda ferramenta é descrita por `DefinicaoFerramenta<TEntrada, TSaida>`:

```ts
interface DefinicaoFerramenta<TEntrada, TSaida extends ResultadoFerramentaBase> {
  nome: string;            // identificador em snake_case
  descricao: string;
  objetivo: string;
  parametros: DefinicaoParametroFerramenta[];
  executar: (entrada: TEntrada) => TSaida;
}
```

E todo resultado estende `ResultadoFerramentaBase`:

```ts
interface ResultadoFerramentaBase {
  sucesso: boolean;
  alertas: string[];
  premissas: string[];
  dadosFaltantes: string[];
  mensagemResumo: string;
}
```

Esse contrato é o que permite a qualquer consumidor (hoje: nada; futuramente:
o loop de tool use do Claude) saber, de forma padronizada, se o cálculo foi
feito, o que foi assumido como premissa e o que ainda falta perguntar ao
usuário.

## `calcular_combustivel`

Calcula consumo e custo de combustível sem depender de API externa. Aceita
cinco modos, cada um com seus próprios campos obrigatórios:

| Modo | Obrigatórios | Calcula |
|---|---|---|
| `PREVISAO_VIAGEM` | distância (`distanciaKm` ou ida/volta) + `consumoMedioKmLitro` | litros necessários, custo total/por km, litros restantes/faltantes |
| `CONSUMO_REAL` | distância real (ou `quilometragemInicial`/`Final`) + `litrosConsumidos` | consumo real, litros/100km, custo real |
| `COMPARACAO_PREVISTO_REALIZADO` | `consumoPrevistoKmLitro` + consumo real (direto ou via litros+distância) + distância | diferença de consumo (km/l e %), diferença de custo, classificação |
| `AUTONOMIA` | `litrosNoTanque` + `consumoMedioKmLitro` | autonomia teórica e útil (descontando `percentualReserva`, se informado) |
| `COMPARACAO_CENARIOS` | `cenarioA` e `cenarioB` completos (distância, consumo, preço) | custo por km de cada cenário, cenário mais econômico, economia |

### Fórmulas principais

```
distanciaTotalKm      = distanciaIdaKm + distanciaVoltaKm            (se ambos informados)
                       = distanciaIdaKm × 2                          (se considerarIdaVolta e só ida informada)
                       = distanciaKm                                 (caso direto)
                       + distanciaAdicionalKm

litrosNecessarios      = distanciaTotalKm ÷ consumoMedioKmLitro
custoTotalCombustivel  = litrosNecessarios × precoCombustivelLitro
custoCombustivelPorKm  = custoTotalCombustivel ÷ distanciaTotalKm

distanciaRealKm        = quilometragemFinal − quilometragemInicial
consumoRealKmLitro     = distanciaRealKm ÷ litrosConsumidos
litrosPor100Km         = 100 ÷ consumoKmLitro

autonomiaTotalKm       = litrosNoTanque × consumoMedioKmLitro
litrosReserva          = litrosNoTanque × percentualReserva ÷ 100
autonomiaUtilKm         = (litrosNoTanque − litrosReserva) × consumoMedioKmLitro

diferencaPercentualConsumo = ((consumoReal − consumoPrevisto) ÷ consumoPrevisto) × 100
  (positivo = consumo real melhor; negativo = consumo real pior)
```

### Classificações e limites configuráveis

Definidos como constantes no topo de `calcular-combustivel.ts`, nunca como
números "mágicos" espalhados pelo código:

- `TOLERANCIA_CONSUMO_PERCENTUAL = 3` — diferença dentro dessa faixa é
  classificada como `CONSUMO_DENTRO_DO_ESPERADO`.
- `AUTONOMIA_UTIL_MINIMA_KM = 50` e `AUTONOMIA_UTIL_ALERTA_KM = 150` —
  definem `AUTONOMIA_INSUFICIENTE` / `AUTONOMIA_PROXIMA_DO_LIMITE` /
  `AUTONOMIA_SUFICIENTE`.
- `CASAS_DECIMAIS_PADRAO = 2` — pode ser sobrescrito por chamada via
  `arredondamentoCasasDecimais`.

### Exemplo de uso

```ts
import { calcularCombustivel } from "@/ai/tools";

const resultado = calcularCombustivel({
  modo: "PREVISAO_VIAGEM",
  distanciaKm: 600,
  consumoMedioKmLitro: 3,
  precoCombustivelLitro: 6,
});

// resultado.resultados.litrosNecessarios === 200
// resultado.resultados.custoTotalCombustivel === 1200
// resultado.resultados.custoCombustivelPorKm === 2
```

Quando faltam dados obrigatórios, `sucesso` vem `false`,
`classificacao` vem `"DADOS_INSUFICIENTES"` e `dadosFaltantes` lista
exatamente os campos que faltam — a ferramenta **nunca** estima um valor não
informado (ex.: nunca assume `litrosAbastecidos` como se fosse
`litrosConsumidos`).

### Limitações conhecidas

- Não busca preço de combustível, distância de rota ou clima automaticamente
  — tudo precisa vir do usuário ou do sistema.
- `COMPARACAO_CENARIOS` compara principalmente por custo/km; quando as
  distâncias dos dois cenários são diferentes, isso é sinalizado em
  `premissas`.
- Sem persistência: cada chamada é isolada, sem memória de abastecimentos
  anteriores.

## `calcular_cpk`

Calcula o Custo Por Quilômetro (CPK) por categoria de custo ou no total, e
compara o CPK entre dois veículos/operações (ex.: pneu novo x recapado,
veículo A x veículo B). Reutilizável por outras ferramentas — `analisar_frete`,
`comparar_pneus`, `calcular_custo_viagem`, `calcular_margem` e
`calcular_valor_minimo_frete` podem chamar `calcularCpk` em vez de reimplementar
a soma de custos.

| Modo | Obrigatórios | Calcula |
|---|---|---|
| `CPK_PNEUS` | `quilometragem` + `custoPneus` e/ou `custoRecapagem` | CPK de pneus |
| `CPK_COMBUSTIVEL` | `quilometragem` + `custoCombustivel` | CPK de combustível |
| `CPK_MANUTENCAO` | `quilometragem` + ao menos um custo de manutenção | CPK de manutenção |
| `CPK_OPERACIONAL` | `quilometragem` + ao menos um custo operacional | CPK operacional |
| `CPK_TOTAL` | `quilometragem` + ao menos um custo de qualquer categoria | CPK total + `cpkPorCategoria` (breakdown) |
| `COMPARACAO_CPK` | `operacaoA` e `operacaoB`, cada uma com `quilometragem` + custos da `categoriaComparacao` (padrão `TOTAL`) | menor CPK, diferença R$/km e %, economia estimada |

### Categorias de custo

```
PNEUS        = custoPneus + custoRecapagem
COMBUSTIVEL  = custoCombustivel
MANUTENCAO   = custoManutencaoPreventiva + custoManutencaoCorretiva + custoPecas + custoMaoDeObra
OPERACIONAL  = custoPedagios + custoLubrificantes + custoArla + custoSeguros + custoLicenciamento
             + custoFinanciamento + custoDepreciacao + custoSalarios + custoEncargos
             + custoAdministracao + custoRastreador + custoOperacionalAdicional + custoPersonalizado
TOTAL        = PNEUS + COMBUSTIVEL + MANUTENCAO + OPERACIONAL

CPK (qualquer categoria) = soma da categoria ÷ quilometragem
```

`quantidadePneus`, `vidaUtilPneusKm` e `valorResidual` são aceitos na entrada
para uso futuro (ex.: por `comparar_pneus`), mas **não** entram na fórmula de
`CPK_PNEUS` nesta versão — que é exatamente `(custoPneus + custoRecapagem) ÷ quilometragem`,
como especificado.

### Transparência

Todo resultado bem-sucedido traz `custosConsiderados` e `custosIgnorados`
(rótulos, não só nomes de campo) com a lista completa dos custos daquela
categoria — o que entrou e o que ficou de fora por não ter sido informado.
Quando há custos ignorados, um alerta explícito avisa que o CPK **não**
representa o custo real completo.

### Classificação e limites configuráveis

`ClassificacaoCpk`: `EXCELENTE` / `BOM` / `ATENCAO` / `CRITICO`, calculada por
`LIMITES_CLASSIFICACAO_CPK` (um conjunto de 3 limiares R$/km por categoria,
no topo de `calcular-cpk.ts`). **Importante**: são valores iniciais de
referência para caminhões de carga, não um benchmark oficial do setor —
ajuste-os para a operação real antes de usar a classificação para decisões.

### Exemplo de uso

```ts
import { calcularCpk } from "@/ai/tools";

const resultado = calcularCpk({
  modo: "CPK_PNEUS",
  custoPneus: 12000,
  quilometragem: 100000,
});
// resultado.resultados.cpk === 0.12
// resultado.custosConsiderados === ["Pneus"]
```

### Limitações conhecidas

- Não busca custos históricos automaticamente — tudo vem do que foi informado.
- Os limiares de classificação são um ponto de partida, não um dado do setor.
- `COMPARACAO_CPK` compara uma categoria por vez (`categoriaComparacao`); para
  comparar todas as categorias entre dois veículos, é preciso chamar a
  ferramenta uma vez por categoria (ou usar `TOTAL`, que soma todas).

## `comparar_pneus`

Compara duas ou mais opções de pneu (novo nacional/importado, recapado,
remoldado, marcas/modelos diferentes, desenho, cenário previsto x
realizado) pelo **custo total do ciclo e pelo CPK — nunca apenas pelo
preço de compra**. Não declara que pneu novo, recapado, nacional ou
importado é sempre superior; a conclusão depende inteiramente dos dados
informados.

| Modo | O que faz |
|---|---|
| `COMPARACAO_SIMPLES` | Compara só preço de aquisição, quilometragem e CPK "leve" (sem recapagens/adicionais/residual) |
| `COMPARACAO_CPK` | Ciclo completo (recapagens + adicionais + residual), foco no CPK |
| `COMPARACAO_CICLO_COMPLETO` | Igual a `COMPARACAO_CPK` — pneu novo, recapagens, custos adicionais, vida total, valor residual |
| `COMPARACAO_RECAPAGEM` | Mesmo cálculo de ciclo completo; usado para comparar "continuar recapando" x "pneu novo" x "trocar carcaça" |
| `COMPARACAO_FROTA` | Ciclo completo + projeção de economia usando `pneusPorVeiculo` × `quantidadeVeiculos` |
| `COMPARACAO_REALIZADO_PREVISTO` | Calcula CPK previsto **e** realizado por opção, com alerta se a quilometragem real ficar abaixo da prevista |

### Reutilização de `calcular-cpk.ts`

`comparar-pneus.ts` **não reimplementa a divisão custo ÷ quilometragem**.
Ele agrega o ciclo de vida do pneu (algo que `calcular-cpk.ts` não modela —
não há dedução de valor residual nem custos adicionais tipo
montagem/desmontagem/frete nesse arquivo) e delega o cálculo final do CPK
para `calcularCpk({ modo: "CPK_PNEUS", custoPneus: custoTotalCiclo,
quilometragem: quilometragemTotal })`, reaproveitando a validação de
quilometragem zero, a rejeição de custo negativo e o arredondamento já
testados ali. **Nenhuma alteração foi necessária em `calcular-cpk.ts`** —
foi avaliado estender sua API (ex.: suporte a dedução de valor residual),
mas não foi preciso: a agregação específica de pneus fica inteiramente em
`comparar-pneus.ts`, e só o resultado final (custo agregado, km agregada)
é passado para a ferramenta existente.

### Convenção de valores (para eliminar ambiguidade)

- `custoAquisicao` e `custoPorRecapagem` (e cada item de `custosRecapagens`)
  são **por pneu, por evento** — multiplicados por `quantidadePneus`.
- Custos adicionais (`custoMontagem`, `custoDesmontagem`, `custoConserto`,
  `custoCamara`, `custoProtetor`, `custoFrete`, `custoDescarte`,
  `outrosCustos`) e `valorResidual` são **totais já para o conjunto**
  (`quantidadePneus`) — não multiplicados de novo.
- Se `custosRecapagens` (lista) for informado, ele tem prioridade sobre
  `numeroRecapagensPrevistas`/`Realizadas` + `custoPorRecapagem`, para nunca
  contar o mesmo custo duas vezes.
- `quantidadePneus` não informado é tratado como 1 (premissa explícita no
  resultado, nunca um valor "escondido").

### Fórmulas

```
custoInicial            = custoAquisicao × quantidadePneus
custoTotalRecapagens     = Σ(custosRecapagens[i].custo) × quantidadePneus
                          ou numeroRecapagens × custoPorRecapagem × quantidadePneus
custosAdicionais         = soma dos custos adicionais informados (já totais)
custoTotalCiclo          = custoInicial + custoTotalRecapagens + custosAdicionais − valorResidual

quilometragemTotal       = quilometragemPrevista(ou Realizada) + Σ quilometragem das recapagens

CPK (previsto/realizado) = calcularCpk({modo:"CPK_PNEUS", custoPneus: custoTotalCiclo, quilometragem: quilometragemTotal})

diferencaCpk             = CPK da opção de maior CPK − CPK da opção de menor CPK
diferencaPercentual      = (diferencaCpk ÷ CPK maior) × 100
economiaPorPneu          = diferencaCpk × quilometragem da opção de referência (a de maior CPK)
economiaPorVeiculo       = economiaPorPneu × pneusPorVeiculo
economiaFrota            = economiaPorVeiculo × quantidadeVeiculos
```

`opcaoReferencia` é sempre a opção de **maior CPK** entre as comparáveis —
independente de `criterioPrincipal` — porque a diferença/economia é sempre
definida em termos de CPK, como especificado. `melhorOpcao`/`piorOpcao`
seguem o `criterioPrincipal` escolhido (padrão: `MENOR_CPK`), que pode, em
tese, apontar uma opção diferente da usada como referência para a economia
(ex.: `criterioPrincipal: "MENOR_PRECO"` elege pelo preço, mas a economia
projetada continua sendo a maior diferença de CPK do conjunto).

### Nível de completude por opção

- **INSUFICIENTE**: falta `custoAquisicao` ou quilometragem válida — CPK
  não pode ser calculado; a opção some do ranking e das contas de
  economia (mas continua listada em `resultadosPorOpcao`, com
  `dadosFaltantes`).
- **PARCIAL**: CPK calculável, mas há recapagens incompletas (custo sem km
  ou vice-versa) ou, nos modos de ciclo completo, `valorResidual` não
  informado (tratado como R$ 0,00, sempre disclosed via `premissas`).
- **COMPLETO**: nada relevante ao modo está faltando.

Se **menos de duas opções** tiverem CPK calculável, a comparação inteira
falha (`sucesso: false`) — não há conclusão financeira sem dados
suficientes em pelo menos duas opções.

`permitirEstimativas: false` vai além: se qualquer opção usada na
comparação for PARCIAL, a ferramenta ainda mostra os dados por opção mas
**suprime** `melhorOpcao`/`diferencaCpk`/economia, com um alerta explicando
por quê.

### Transparência

Cada opção traz `custosIncluidos`/`custosNaoInformados` (rótulos, não só
nomes de campo), `premissas` (ex.: "quantidadePneus não informado; foi
considerado 1 pneu") e `alertas` (ex.: recapagem sem custo, quilometragem
realizada abaixo da prevista). O resultado geral sempre traz `limitacoes`
fixas — a ferramenta nunca garante compatibilidade técnica ou segurança:

```ts
"Esta ferramenta não valida compatibilidade técnica (medida, índice de
carga, índice de velocidade, aplicação, eixo). Confirme a adequação com o
fabricante, reformador credenciado ou responsável técnico antes de aplicar
a escolha."
```

### Classificação da diferença

`ClassificacaoDiferencaCpk`: `DIFERENCA_PEQUENA` / `VANTAGEM_MODERADA` /
`VANTAGEM_RELEVANTE` / `VANTAGEM_ELEVADA`, por `LIMITES_CLASSIFICACAO_DIFERENCA_CPK`
(percentuais configuráveis, não um padrão de mercado). A linguagem usada
nunca é absoluta ("menor CPK **nos dados informados**", "opção
financeiramente mais vantajosa **nesta simulação**").

### Arredondamento diferenciado

`casasDecimais` na entrada sobrescreve TODOS os tipos de grandeza de uma
vez; sem ele, os padrões são: moeda 2 casas, CPK 4 casas, percentual 2
casas, quilometragem 2 casas (constantes `CASAS_DECIMAIS_*_PADRAO` no topo
de `comparar-pneus.ts`).

### Exemplo de uso

```ts
import { compararPneus } from "@/ai/tools";

const resultado = compararPneus({
  modo: "COMPARACAO_CICLO_COMPLETO",
  opcoes: [
    { id: "novo", nome: "Pneu novo", custoAquisicao: 1800, quilometragemPrevista: 80000 },
    { id: "recapado", nome: "Recapado", custoAquisicao: 1100, quilometragemPrevista: 50000 },
  ],
});
// resultado.resultadosPorOpcao[0].cpkPrevisto === 0.0225
// resultado.resultadosPorOpcao[1].cpkPrevisto === 0.022
// resultado.melhorOpcao === "Recapado"
```

### Limitações conhecidas

- Não valida compatibilidade técnica (medida, carga, velocidade,
  aplicação, eixo) — apenas registra o que foi informado e sempre alerta
  sobre isso.
- `COMPARACAO_FROTA`: se `quantidadePneus` da opção **e** `pneusPorVeiculo`
  forem informados juntos, a ferramenta alerta sobre possível dupla
  contagem em vez de adivinhar qual valor está certo.
- Sem persistência: cada chamada é isolada, sem histórico de recapagens
  anteriores.

## `calcular_custo_viagem`

Calcula o custo operacional **completo** de uma viagem de transporte
rodoviário — não só diesel e pedágio. Sempre diferencia custo variável,
custo fixo proporcional, custo direto, custo indireto, previsto e
realizado, e nunca apresenta um valor parcial como se fosse o custo real
completo da operação.

| Modo | O que faz |
|---|---|
| `VIAGEM_SIMPLES` | Custo de um único trecho (`distanciaIdaKm`) |
| `IDA_E_VOLTA` | Ida e volta, com parâmetros iguais ou distintos por trecho |
| `IDA_COM_RETORNO_VAZIO` | Ida carregada + volta sem receita — os custos da volta continuam entrando no total |
| `IDA_COM_CARGA_RETORNO` | Ida e volta com cargas distintas (`volta.cargaToneladas`) |
| `CUSTO_PREVISTO` / `CUSTO_REALIZADO` | Igual a `VIAGEM_SIMPLES`, só rotula o resultado como previsto/realizado |
| `COMPARACAO_PREVISTO_REALIZADO` | Recebe blocos `previsto` e `realizado` completos e compara |
| `MULTIPLOS_VEICULOS` | Calcula o custo de 1 veículo e projeta para `quantidadeVeiculos`, sem duplicar |
| `RATEIO_POR_CARGA` | Exige `criterioRateioCarga` (`TONELADA`/`UNIDADE`/`VOLUME`) + o divisor correspondente |

### Reutilização de `calcular-combustivel.ts` e `calcular-cpk.ts`

- **Combustível**: sempre que há distância + consumo (+ preço opcional), a
  categoria é calculada chamando `calcularCombustivel({modo:"PREVISAO_VIAGEM", ...})`
  — inclusive nos modos de ida e volta, com uma chamada por trecho (mesmo
  quando o consumo é igual nos dois), para poder reportar `custoIda`/`custoVolta`
  separadamente sem duplicar a lógica de litros/custo já implementada ali.
- **Custo por km**: depois de somado o custo total, `custoPorKm` é obtido
  chamando `calcularCpk({modo:"CPK_PNEUS", custoPneus: custoTotal, quilometragem: distanciaTotalKm})`
  — reaproveitando a mesma divisão/arredondamento/validação de km zero já
  testada em `calcular-cpk.ts`, exatamente como `comparar-pneus.ts` já fazia.
- **CPK por categoria** (`veiculo.cpkManutencao`, `cpkPneus`, `cpkDepreciacao`,
  `cpkCustosFixos`): a fórmula é `cpk × distanciaTotalKm`, uma multiplicação
  simples que **não existe** em `calcular-cpk.ts` (que só faz a divisão
  custo ÷ km) — não há lógica para reutilizar aqui, então é calculada
  diretamente nesta ferramenta.
- **`comparar-pneus.ts`** não é chamado diretamente; o CPK de pneus que ela
  calcula pode ser passado como `veiculo.cpkPneus`.
- **Nenhuma alteração foi necessária** em `calcular-combustivel.ts` ou
  `calcular-cpk.ts` — ambas foram usadas apenas por composição.

### Base de rateio dos custos fixos (elimina ambiguidade)

Cada item de `custosFixos` (`seguroVeiculo`, `licenciamento`, `financiamento`,
`depreciacao`, `rastreador`, `administracao`, `salarioFixo`, `garagem`,
`impostosFixos`, `outros`) é `{ valor, base }`, com `base` em `POR_VIAGEM` /
`POR_TRECHO` / `POR_VEICULO` / `POR_PESSOA` / `POR_DIA` / `POR_KM` /
`POR_TONELADA` / `POR_UNIDADE` / `VALOR_TOTAL`. Um `valor` informado **sem**
`base` nunca é multiplicado silenciosamente — vira dado faltante
(`custosFixos.X.base`). A normalização é feita por uma única função
(`normalizarValorComBase`), não duplicada por categoria.

### Sobreposição de custos

Detecta e trata como conflito (nunca soma as duas fontes automaticamente):

- `cpkTotal` informado junto com combustível detalhado, `custosFixos` ou
  `cpkManutencao`/`cpkPneus`/`cpkDepreciacao`/`cpkCustosFixos` (o CPK total
  já embutiria tudo isso).
- `cpkCustosFixos` junto com `custosFixos` detalhados.
- `cpkDepreciacao` junto com `custosFixos.depreciacao`.
- `pedagios.valorTotal` junto com `pedagios.pracas`.
- `operacao.valorTotal` junto com os itens detalhados de `operacao`.
- `custoCombustivelInformado` junto com consumo/preço detalhados.

Controlado por `estrategiaSobreposicao` (padrão **`REJEITAR_SOBREPOSICAO`**,
que falha com mensagem explicando os campos em conflito); `PRIORIZAR_TOTAL`
e `PRIORIZAR_DETALHADO` escolhem uma fonte, ignoram a outra e registram um
alerta explicando o que foi ignorado.

> Nem todo par citado na especificação original tem um campo concreto nesta
> versão (ex.: "custo de motorista total + diária" — `CustosMotorista` não
> tem um campo de total agregado separado da diária, então não há uma
> sobreposição real de dados para detectar aí; os dois são componentes
> aditivos legítimos). Os pares acima são os que existem de fato na
> tipagem e por isso são checados.

### Categorias de saída

`combustível`, `ARLA`, `pedágios`, `motorista`, `ajudante`, `alimentação`,
`hospedagem`, `carga e descarga`, `operação`, `manutenção`, `pneus`,
`depreciação`, `seguro`, `licenciamento`, `financiamento`, `rastreador`,
`administração`, `outros (indiretos)` — cada uma com valor, origem, base de
cálculo, previsto/realizado, incluído/ignorado e memória de cálculo.
`alimentação`/`hospedagem` são inseridas em `motorista`/`ajudante` na
entrada, mas somadas numa categoria própria na saída (sem duplicar).
Quando `veiculo.cpkTotal` é usado, aparece uma única categoria "CPK total
do veículo" — as demais (combustível, manutenção, pneus, depreciação,
fixos) não são estimadas separadamente, pois já estão embutidas nele.

Cada categoria pertence a exatamente um dos 4 buckets do resultado
(`custosVariaveis` = combustível/ARLA/pedágios; `custosFixosProporcionais`
= tudo de `custosFixos` + CPK do veículo; `custosDiretos` = motorista,
ajudante, alimentação, hospedagem, carga/descarga, operação;
`custosIndiretos` = despesas administrativas e custos adicionais), para que
`custoTotal` nunca conte a mesma categoria duas vezes.

### Nível de completude

- **INSUFICIENTE**: sem distância válida ou nenhuma categoria calculável.
- **PARCIAL**: dá para calcular, mas falta combustível com preço completo
  ou qualquer representação de custos fixos (nenhum `custosFixos.*`, nem
  `cpkTotal`/`cpkCustosFixos` informado) — é por isso que uma viagem só com
  combustível (teste 1 da especificação) sai como parcial.
- **COMPLETO**: nenhuma dessas lacunas.

### Ida, volta e retorno vazio

`custoIda`/`custoVolta` cobrem os custos atribuíveis a cada trecho
(combustível por perna, pedágio de praças marcadas com `trecho`, custos
adicionais do retorno em `volta.custosAdicionais`). Motorista, ajudante,
custos fixos e operação **não** são divididos por trecho nesta versão —
normalmente não fazem sentido meio-ida-meio-volta — e entram só no
`custoTotal`. Em `IDA_COM_RETORNO_VAZIO`, os custos da volta nunca são
omitidos; uma premissa explícita registra que o retorno foi tratado como
sem carga/receita.

### Exemplo de uso

```ts
import { calcularCustoViagem } from "@/ai/tools";

const resultado = calcularCustoViagem({
  modo: "VIAGEM_SIMPLES",
  distanciaIdaKm: 600,
  veiculo: { consumoMedioKmLitro: 3, precoCombustivelLitro: 6 },
});
// resultado.litrosCombustivel === 200
// resultado.custosPorCategoria.find(c => c.categoria === "Combustível").valor === 1200
// resultado.nivelCompletude === "PARCIAL" (sem custos fixos informados)
```

### Limitações conhecidas

- Não calcula distância, preço de combustível, pedágio, diária ou CPK
  automaticamente — tudo vem do que foi informado.
- Motorista/ajudante/custos fixos/operação não são divididos por trecho
  (só combustível e pedágio, quando as praças têm `trecho` marcado).
- Comparação previsto x realizado sinaliza a categoria de maior desvio, mas
  nunca infere a causa (rota diferente, operação extra, etc.).

## `calcular_margem`

Calcula a margem financeira de uma viagem, frete, operação, veículo,
contrato ou período. Sempre diferencia **faturamento, receita bruta,
receita líquida, custo, lucro, margem, markup e preço mínimo** — nunca
trata margem e markup como o mesmo indicador, nunca declara uma operação
lucrativa só porque a receita supera alguns custos isolados, e nunca
apresenta lucro líquido como definitivo quando impostos, comissões ou
custos indiretos relevantes não foram informados.

| Modo | O que faz |
|---|---|
| `MARGEM_SIMPLES` | Receita, custo, lucro e margem básicos |
| `MARGEM_OPERACIONAL` | Idem, com foco no lucro operacional (buckets de custo) |
| `MARGEM_LIQUIDA_ESTIMADA` | Idem, com impostos/comissões/indiretos informados |
| `MARGEM_POR_VIAGEM` | Igual a `MARGEM_SIMPLES` — resultado de uma viagem específica |
| `MARGEM_POR_KM` | Igual, exigindo também `quilometragemTotal` |
| `MARGEM_POR_TONELADA` | Igual, exigindo também `pesoCargaToneladas` |
| `COMPARACAO_CENARIOS` | Compara `cenarios` (≥ 2): ranking por lucro, margem, lucro/km, receita |
| `PREVISTO_X_REALIZADO` | Compara os blocos `previsto` e `realizado` |
| `MARGEM_ALVO` | Receita necessária para `margemAlvoPercentual` — **não exige receitaBruta** |
| `PONTO_EQUILIBRIO` | Receita mínima para não haver prejuízo — **não exige receitaBruta** |

### Receita, lucro, margem e markup — por que não são a mesma coisa

- **Receita bruta** → **receita líquida** (após descontos, devoluções,
  impostos, comissões e outras deduções) → **lucro** (receita líquida
  menos custo) → **margem** (lucro ÷ receita, em %) → **markup** (receita
  ÷ custo, em %, ou seja, o quanto se cobra *acima* do custo).
- Margem de 20% sobre a receita **não é** o mesmo número que markup de 20%
  sobre o custo — o teste `MARGEM_E_MARKUP` comprova isso explicitamente
  (receita R$ 10.000, custo R$ 8.000 → margem 20%, markup 25%).
- `lucroBruto` usa só `custosDiretos`; `lucroOperacional` soma os 4 buckets
  (`custosVariaveis`+`custosFixosRateados`+`custosDiretos`+`custosIndiretos`);
  `lucroLiquidoEstimado` usa `custoTotalFinal` (que pode incluir também
  `custoViagem`/`custoRetorno`/`custoAdministrativo`/`outrosCustos`) — por
  isso os três podem divergir, e o resultado sempre indica qual foi usado.

### Três fontes de custo (nunca somadas ao mesmo tempo)

1. `custoTotal` — valor já pronto.
2. Categorias detalhadas — `custosVariaveis`, `custosFixosRateados`,
   `custosDiretos`, `custosIndiretos`, `custoViagem`, `custoRetorno`,
   `custoAdministrativo`, `outrosCustos` (somadas entre si).
3. `resumoCustoViagem` — **estruturalmente compatível** com o resultado de
   `calcular_custo_viagem` (mesmos nomes de campo: `custoTotal`,
   `custosVariaveis`, `custosFixosProporcionais`, `custosDiretos`,
   `custosIndiretos`, `distanciaTotalKm`, `quantidadeVeiculos`,
   `nivelCompletude`) — o resultado completo daquela ferramenta pode ser
   passado direto aqui, sem conversão.

Impostos e comissões seguem a mesma lógica em miniatura: cada um pode ser
`valor` (R$) **ou** `aliquota*Percentual` (%) — nunca os dois ao mesmo
tempo. Controlado pela mesma `estrategiaSobreposicao` (padrão
`REJEITAR_SOBREPOSICAO`, compartilhada com `calcular_custo_viagem` via
`types.ts`).

### Reutilização de `calcular-cpk.ts`

`receitaPorKm` e `custoPorKm` (e as versões por tonelada) são calculados
via `calcularCpk({modo:"CPK_PNEUS", custoPneus: valor, quilometragem: divisor})`
— o mesmo truque de composição já usado em `comparar-pneus.ts` e
`calcular-custo-viagem.ts`. **`lucroPorKm`/`lucroPorTonelada`/`lucroPorVeiculo`/
`lucroPorViagem` são calculados diretamente aqui**, porque `calcular-cpk.ts`
rejeita valores negativos e a margem, por definição, precisa suportar
prejuízo — não haveria lógica reaproveitável nesse caso. Nenhuma alteração
foi feita em `calcular-cpk.ts`.

### Fórmulas principais

```
receitaBrutaTotal   = receitaBruta + receitaAdicional
receitaLiquida       = receitaBrutaTotal − descontos − devoluções − impostos − comissões − outrasDeduções

lucroBruto            = receitaBrutaTotal − custosDiretos
lucroOperacional       = receitaLiquida − (custosVariaveis + custosFixosRateados + custosDiretos + custosIndiretos)
lucroLiquidoEstimado    = receitaLiquida − custoTotalFinal

margemXPercentual     = (lucroX ÷ base) × 100        (base = receitaBrutaTotal para a bruta; receitaLiquida para as demais)
markupPercentual      = ((receitaLiquida ÷ custoTotalFinal) − 1) × 100
fatorMarkup           = receitaLiquida ÷ custoTotalFinal

receitaPontoEquilibrio = (custoTotalFinal + deduçõesFixas) ÷ (1 − percentualDeduções)
receitaParaMargemAlvo  = (custoTotalFinal + deduçõesFixas) ÷ (1 − margemAlvoDecimal − percentualDeduções)
receitaComMarkupAlvo   = custoTotalFinal × (1 + markupAlvoDecimal)
```

`percentualDeduções` usa só impostos/comissão informados como **percentual**
(proporcionais à receita); valores informados como **R$ fixo** entram em
`deduçõesFixas` — por isso a fórmula do ponto de equilíbrio funciona tanto
na "versão simples" (sem deduções) quanto com impostos/comissão
percentuais, sem misturar as duas bases incorretamente.

### Margem negativa (prejuízo)

Nunca é zerada. `classificacao` vira `PREJUIZO` sempre que a margem usada
para classificar é negativa, com alerta explícito. `valorAdicionalParaEquilibrio`/
`valorAdicionalParaMargemAlvo` mostram exatamente quanto falta (podem ser
negativos, quando a meta já foi superada — também nunca escondido).

### Retorno vazio

`custoViagem` + `custoRetorno` + `receitaIda` (+ `receitaRetorno`, 0 quando
vazio) disparam `impactoRetornoVazio`, comparando o resultado com e sem o
trecho de volta:

```ts
{
  lucroComRetorno, margemComRetornoPercentual,   // considerando ida + volta
  lucroSoIda, margemSoIdaPercentual,              // só a ida
  diferencaLucro, diferencaMargemPercentual,      // impacto do retorno vazio
}
```

### Comparação de cenários

Rankings por lucro, margem, lucro/km e receita líquida — **nunca** assume
que o cenário de maior receita é o melhor; quando o líder por receita
difere do líder por lucro, um alerta explícito é adicionado.
`rankingPorMenorRiscoPrejuizo` é um proxy simples (maior margem líquida),
documentado como tal — não é um modelo de risco.

### Previsto x realizado

Compara os dois blocos completos e aponta `principalDesvio` (receita ou
custo, o de maior variação absoluta) sem inventar a causa — só alerta que
houve desvio e qual foi maior.

### Nível de completude

- **INSUFICIENTE**: falta custo, ou falta receita nos modos que exigem
  receita (todos, exceto `MARGEM_ALVO`/`PONTO_EQUILIBRIO`).
- **PARCIAL**: calculável, mas impostos, comissão ou custos indiretos não
  foram informados de nenhuma forma.
- **COMPLETO**: nada relevante faltando. `MARGEM_ALVO`/`PONTO_EQUILIBRIO`
  são sempre `COMPLETO` quando o custo é válido — são simulações baseadas
  em premissas do próprio usuário, não em dados reais.

### Exemplo de uso

```ts
import { calcularMargem } from "@/ai/tools";

const resultado = calcularMargem({
  modo: "MARGEM_SIMPLES",
  receitaBruta: 10000,
  custoTotal: 8000,
});
// resultado.lucroLiquidoEstimado === 2000
// resultado.margemLiquidaPercentual === 20   (sobre a receita)
// resultado.markupPercentual === 25          (sobre o custo — indicador diferente)
```

### Limitações conhecidas

- Não calcula tributos, comissões ou custos automaticamente.
- `receitaComMarkupAlvo` não está na lista original de campos do resultado,
  mas a fórmula de markup-alvo e o teste dedicado exigem o valor — foi
  adicionada como um campo extra, documentada aqui.
- Nem todo par citado como sobreposição na especificação original tem um
  campo concreto nesta tipagem (ex.: "custo de motorista total + diária" —
  não existe aqui, já que este tool não modela motorista/diária
  separadamente; isso é escopo de `calcular_custo_viagem`).

## `analisar_frete`

Ferramenta **coordenadora/interpretativa**: responde perguntas como "Este
frete compensa?", "Vale a pena pegar essa carga?", "Quanto vai sobrar?",
"Preciso de quanto de capital de giro?", "Qual proposta é melhor?" — sempre
considerando receita, custo, distância, retorno vazio, prazo de pagamento,
capital de giro, riscos e nível de completude dos dados, **nunca** apenas o
valor bruto do frete.

| Modo | O que faz |
|---|---|
| `ANALISE_SIMPLES` | Receita, custo, lucro e margem de um frete único |
| `ANALISE_COMPLETA` | Igual, com todas as camadas (riscos, prazo, capital de giro) |
| `IDA_E_VOLTA` | Frete com volta informada (remunerada ou não) |
| `RETORNO_VAZIO` | Considera o custo total do retorno sem receita; infere `distanciaCarregadaKm`/`distanciaVaziaKm` a partir de ida/volta quando não informadas separadamente |
| `FRETE_COM_RETORNO` | Ida e volta com receita e custo próprios em cada trecho |
| `COMPARACAO_PROPOSTAS` | Compara `propostas` (≥ 2): ranking por lucro, margem, lucro/km, capital de giro, risco |
| `PREVISTO_X_REALIZADO` | Compara os blocos `previsto` e `realizado`, com categorias extras (distância, capital de giro, prazo) |
| `ANALISE_POR_KM` | Foco em receita/custo/lucro por km |
| `ANALISE_POR_TONELADA` | Foco em receita/custo/lucro por tonelada — exige `pesoCargaToneladas` |
| `ANALISE_CAPITAL_GIRO` | Foco na necessidade de capital de giro até o recebimento |

### Reutilização de `calcular-margem.ts` (não reimplementa fórmulas)

O núcleo financeiro inteiro — receita líquida, deduções, custo total
(incluindo a resolução de sobreposição entre `custoTotal`/categorias
detalhadas/`resumoCustoViagem`), lucro, margem, markup, ponto de
equilíbrio, receita para margem-alvo, receita/custo/lucro por km e por
tonelada, e `impactoRetornoVazio` — é delegado para
`calcularMargem({modo: "MARGEM_SIMPLES", ...})`. `analisar-frete.ts` monta
um `DadosMargemVariante` a partir da sua própria entrada e lê o resultado;
nenhuma dessas fórmulas foi copiada. A função `resolverValorOuAliquota`
(resolve um valor como R$ fixo ou percentual da receita) foi **exportada**
por `calcular-margem.ts` especificamente para ser reaproveitada aqui na taxa
de plataforma, em vez de reimplementada — a única alteração feita naquele
arquivo para este trabalho (além de dois campos opcionais `custoIda`/
`custoVolta` em `ResumoCustoViagem`, para compatibilidade estrutural com o
resultado completo de `calcular_custo_viagem`). `calcular-cpk.ts` e
`calcular-combustivel.ts` não são chamados diretamente por esta ferramenta;
seus resultados podem ser passados via `resumoCustoViagem`/`resumoCpk`/
`cpkTotalReaisPorKm`.

Camadas exclusivas desta ferramenta (não existem em `calcular_margem`):
dupla representação de distância, capital de giro, análise de prazo,
classificação de riscos, classificação de viabilidade, comparação de
propostas e as categorias extras do previsto x realizado.

### Dupla representação de distância (nunca duplicada)

1. `distanciaIdaKm` + `distanciaVoltaKm` + `distanciaAdicionalKm`, **ou**
2. `distanciaCarregadaKm` + `distanciaVaziaKm`.

As duas formas juntas disparam sobreposição (`estrategiaSobreposicaoDistancia`,
padrão `REJEITAR_SOBREPOSICAO`). No modo `RETORNO_VAZIO`, quando só a forma
1 é informada, a ferramenta assume `distanciaCarregadaKm = distanciaIdaKm` e
`distanciaVaziaKm = distanciaVoltaKm` — premissa sempre declarada
explicitamente, nunca silenciosa, e só nesse modo (nos demais modos, sem a
forma 2 explícita, `distanciaCarregadaKm`/`distanciaVaziaKm` ficam
indefinidos).

### Receita por km: total x carregado

- `receitaPorKmTotal` = receita líquida ÷ distância total (via
  `calcularMargem`, mesmo cálculo de `calcular_margem`).
- `receitaPorKmCarregado` = receita líquida ÷ `distanciaCarregadaKm` —
  calculado localmente nesta ferramenta (divisão simples, não é uma fórmula
  de outra ferramenta) porque `calcular_margem` só divide por um único
  `quilometragemTotal` por chamada. Sempre acompanhado do alerta de que
  pode esconder o custo do retorno vazio quando olhado isoladamente.

### Fontes de custo (nunca somadas ao mesmo tempo)

As mesmas três fontes de `calcular_margem` (`custoTotal` / categorias
detalhadas / `resumoCustoViagem`) — resolvidas por aquela própria
ferramenta — mais uma quarta, exclusiva daqui: `cpkTotalReaisPorKm` ou
`resumoCpk.cpk` (resultado de `calcular_cpk`), multiplicado pela distância
total para derivar um `custoTotal`. Essa quarta fonte tem sua própria
checagem de sobreposição contra as outras três (`estrategiaSobreposicaoCusto`,
padrão `REJEITAR_SOBREPOSICAO`) antes de ser repassada para `calcularMargem`.

### Deduções: taxa de plataforma, seguro e gerenciamento de risco

`descontos`, `impostos`/`aliquotaImpostosPercentual` e `comissao`/
`aliquotaComissaoPercentual` são repassados direto para `calcular_margem`.
`taxaPlataforma`/`aliquotaTaxaPlataformaPercentual` (resolvidos via
`resolverValorOuAliquota`, com `estrategiaSobreposicaoDeducao` — rótulos
próprios `REJEITAR_SOBREPOSICAO`/`PRIORIZAR_VALOR_FIXO`/`PRIORIZAR_PERCENTUAL`,
já que a escolha aqui é entre valor fixo e percentual, não entre total e
detalhado), `seguroCarga`, `gerenciamentoRisco` e `outrasDeducoesInformadas`
são somados e entram como `outrasDeducoes` no `calcularMargem`.

### Capital de giro

```
desembolsoAntesRecebimento = soma dos custosAntecipados informados (combustível, pedágio, alimentação, hospedagem, diária, carga/descarga, outros)
capitalGiroNecessario      = desembolsoAntesRecebimento − adiantamento      (pode ser negativo, se o adiantamento cobre tudo)
saldoOperacional           = max(0, capitalGiroNecessario)
retornoSobreCapitalPercentual = lucro ÷ capitalProprioEmpregado × 100        (só quando capitalProprioEmpregado é informado explicitamente — nunca derivado do capital de giro)
```

Só entram no cálculo os itens de `custosAntecipados` efetivamente
informados — nunca presume que todo o custo é pago antecipadamente.

### Análise de prazo de pagamento

Nunca usa um limite universal de "prazo bom/ruim". Gera alertas/riscos para:
prazo não informado (`NAO_AVALIADO`), ausência de adiantamento, prazo
elevado (`LIMITES_CLASSIFICACAO_FRETE.prazoPagamentoElevadoDias`, hoje 45
dias) combinado com margem baixa, e resultado positivo com capital de giro
alto — sem nunca inventar histórico de pagamento do cliente.

### Classificação de riscos

Categorias: `FINANCEIRO`, `OPERACIONAL`, `DADOS_INCOMPLETOS`,
`RETORNO_VAZIO`, `PRAZO_PAGAMENTO`, `MARGEM_BAIXA`, `PREJUIZO`,
`CAPITAL_GIRO`, `CARGA`, `ROTA`, `CLIENTE`, `DOCUMENTACAO`, `OUTRO`. Níveis:
`BAIXO`/`MODERADO`/`ALTO`/`CRITICO`/`NAO_AVALIADO`. Cada risco traz
`categoria`, `nivel`, `descricao`, `evidencia`, `impactoPotencial`,
`acaoRecomendada` e `origemInformacao`. **`CARGA`/`ROTA`/`CLIENTE`/
`DOCUMENTACAO` só recebem um nível diferente de `NAO_AVALIADO` quando o
usuário informa explicitamente `risco*Nivel`/`risco*Descricao`** — nunca
inferidos do nome de `origem`/`destino`/`tipoCarga`.

### Classificação de viabilidade

`ClassificacaoViabilidadeFrete`: `DADOS_INSUFICIENTES` → `INVIAVEL` →
`ALTO_RISCO` → `MARGEM_INSUFICIENTE` → `VIAVEL_COM_RESSALVAS` → `VIAVEL` →
`ATRATIVO`, verificados nessa ordem de prioridade (a primeira condição que
bater decide a classificação). "Prejuízo" e "custos conhecidos não cobertos
pela receita" são a mesma condição numérica (`lucro < 0`) e não duas
categorias separadas — documentado em `limitacoes`. Limites configuráveis em
`LIMITES_CLASSIFICACAO_FRETE` (`margemAtrativaPercentual`,
`percentualKmVazioAtencaoPercentual`,
`capitalGiroSobreLucroAtencaoPercentual`, `prazoPagamentoElevadoDias`) —
nenhum limite embutido sem constante nomeada. Quando `margemMinimaPercentual`
não é informado, a classificação `ATRATIVO`/`VIAVEL` usa só os limites
indicativos, deixando claro que não há meta personalizada.

### Comparação de propostas

Cada proposta em `propostas` (≥ 2) passa pelo mesmo pipeline de um frete
único. Rankings por maior lucro, maior margem, maior lucro/km, maior
receita/km, menor capital de giro, menor exposição ao retorno vazio, menor
pontuação de risco (`pontuacaoRisco`, pesos por nível — proxy simples,
documentado como tal) e um `porResultadoGeral` que combina as posições de
lucro + margem + risco. **Nunca** classifica pela maior receita/valor bruto
isoladamente; quando o líder por receita/km difere do líder por lucro, um
alerta explícito é adicionado (mesmo padrão de `calcular_margem`).

### Previsto x realizado

Roda o pipeline completo duas vezes (`previsto`/`realizado`) e compara
receita, custo, distância, lucro, margem, capital de giro e prazo —
categorias a mais do que o `PREVISTO_X_REALIZADO` de `calcular_margem`
(que só compara receita/custo/lucro/margem). Aponta `principalDesvio` (a
categoria com maior variação absoluta entre receita/custo/distância) sem
inventar a causa.

### Nível de completude

- **INSUFICIENTE**: falha na validação, receita/custo/distância ausentes,
  ou o `calcularMargem` subjacente retorna `INSUFICIENTE`.
- **PARCIAL**: calculável, mas `calcularMargem` retornou `PARCIAL`
  (impostos/comissão/indiretos ausentes), ou faltam `prazoPagamentoDias`,
  ou não há informação sobre o retorno (nem `distanciaVaziaKm` nem
  `receitaFreteVolta`).
- **COMPLETO**: nada relevante faltando.

### Exemplo de uso

```ts
import { analisarFrete } from "@/ai/tools";

const resultado = analisarFrete({
  modo: "RETORNO_VAZIO",
  receitaFreteIda: 10000,
  receitaFreteVolta: 0,
  custoViagem: 6000,
  custoRetorno: 2000,
  distanciaIdaKm: 500,
  distanciaVoltaKm: 500,
  prazoPagamentoDias: 30,
  custosAntecipados: { combustivel: 3000, pedagio: 200 },
});
// resultado.freteAnalisado.lucro === 2000
// resultado.freteAnalisado.margemPercentual === 20
// resultado.freteAnalisado.percentualKmVazio === 50
// resultado.freteAnalisado.classificacao === "VIAVEL_COM_RESSALVAS" (retorno vazio relevante)
```

### Limitações conhecidas

- Não calcula distância, consumo, preço de diesel, pedágio, impostos,
  comissão, retorno, prazo, peso, valor mínimo ou margem ideal
  automaticamente — tudo vem do que foi informado.
- Riscos de carga, rota, cliente e documentação só são avaliados quando
  informados explicitamente — na ausência de dados, ficam `NAO_AVALIADO`.
- A classificação de viabilidade não é um padrão de mercado nem uma meta
  universal — depende do tipo de operação, risco, prazo, cliente e
  estrutura de custos da transportadora.
- `analisarRiscos` inclui uma checagem leve de `OPERACIONAL` (menos
  motoristas do que veículos); não modela escala, jornada ou legislação de
  motorista — isso é escopo de `calcular_jornada`.

## `calcular_valor_minimo_frete`

Calcula o **piso econômico** de um frete: o valor mínimo necessário para
cobrir o custo informado, atingir o ponto de equilíbrio, uma margem-alvo, um
markup-alvo ou um lucro fixo desejado — nunca o mesmo indicador tratado de
forma intercambiável, e nunca um piso legal/oficial (essa distinção é sempre
reforçada nas limitações do resultado; sem integração com tabelas oficiais,
ANTT ou plataformas de frete nesta fase).

| Modo | Uso |
|---|---|
| `PONTO_EQUILIBRIO` | Receita mínima para não haver prejuízo |
| `MARGEM_ALVO` | Receita mínima para atingir `margemAlvoPercentual` |
| `MARKUP_ALVO` | Receita mínima para atingir `markupAlvoPercentual` sobre o custo |
| `LUCRO_FIXO_ALVO` | Receita mínima para gerar `lucroFixoDesejado` em R$ |
| `VALOR_MINIMO_POR_VIAGEM` | Valor mínimo dividido por `quantidadeViagens` |
| `VALOR_MINIMO_POR_KM` | Valor mínimo dividido por `distanciaTotalKm` |
| `VALOR_MINIMO_POR_KM_CARREGADO` | Valor mínimo (com todo o custo, inclusive retorno vazio) dividido só por `distanciaCarregadaKm` |
| `VALOR_MINIMO_POR_TONELADA` | Valor mínimo dividido por `pesoCargaToneladas` |
| `VALOR_MINIMO_TONELADA_KM` | Valor mínimo dividido por peso × `distanciaCarregadaKm` |
| `VALOR_MINIMO_POR_UNIDADE` | Valor mínimo dividido por `quantidadeCarga` |
| `IDA_E_VOLTA` / `RETORNO_VAZIO` / `FRETE_COM_RETORNO` | Custo de ida e volta via `custoIda`/`custoVolta`; `RETORNO_VAZIO` destaca o impacto do trecho sem receita |
| `MULTIPLOS_VEICULOS` | `custoTotal` interpretado como custo **por veículo**, multiplicado por `quantidadeVeiculos` (sem duplicar na divisão de volta) |
| `COMPARAR_COM_OFERTA` | Compara `valorFreteOferecido` com o valor mínimo calculado |
| `COMPARACAO_CENARIOS` | Compara ≥ 2 `cenarios`: ranking por menor valor mínimo, maior margem, menor custo total, menor impacto do retorno vazio |

### Reutilização — coordenadora, não reimplementadora

- **`resolverValorOuAliquota`** (exportada por `calcular-margem.ts`) resolve,
  campo a campo, cada par valor-fixo × percentual (imposto, comissão, taxa de
  plataforma, outras deduções, custo de capital, adicional de risco) — a
  mesma função usada por `calcular_margem` e `analisar_frete`, sem duplicar a
  lógica de detecção de sobreposição.
- **`calcularCpk`** (`calcular-cpk.ts`, modo `CPK_PNEUS` como divisor
  genérico valor ÷ km) é reutilizada para toda divisão que nunca pode ser
  negativa: valor mínimo por km, por km carregado, por tonelada, por
  tonelada-km, por unidade, por veículo e por viagem — mesmo padrão de
  `calcular-margem.ts` (`dividirViaCpk`).
- Aceita o custo já calculado por `calcular-custo-viagem.ts` via
  `resumoCustoViagem` (a mesma interface reexportada por
  `calcular-margem.ts` — não duplicada aqui), o CPK de `calcular-cpk.ts` via
  `resumoCpk`/`cpkTotalReaisPorKm` × `distanciaTotalKm`, e um resumo
  **normalizado e desacoplado** de `analisar-frete.ts` via
  `resumoAnaliseFrete` (`{ custoTotal?, distanciaTotalKm? }`) — sem importar
  aquele módulo, para não criar uma dependência circular (`analisar-frete.ts`
  pode um dia precisar consumir o valor mínimo calculado aqui).
- O tipo `EstrategiaSobreposicaoDeducao` (conflito valor fixo × percentual em
  deduções) é **importado de `analisar-frete.ts`** em vez de redeclarado —
  mesmo conceito, um `import type` sem risco de dependência circular (aquele
  módulo não importa nada deste).
- As equações de ponto de equilíbrio/margem-alvo/markup-alvo/lucro-fixo são
  uma **generalização** das equações equivalentes de `calcular-margem.ts`
  (que resolve só 2 deduções percentuais — imposto e comissão — fixas no
  código). Como esta ferramenta soma até 5 deduções percentuais
  independentes (imposto, comissão, taxa de plataforma, outras deduções,
  custo de capital), os denominadores são reimplementados de forma genérica
  — produzem o mesmo resultado de `calcular-margem.ts` quando só
  imposto/comissão são usados, mas não são uma cópia do código de lá.

### Fórmulas principais

```
custoTotalBase        = custoTotal informado, OU soma das categorias
                         detalhadas, OU resumoCustoViagem.custoTotal, OU
                         CPK × distância, OU custoIda + custoVolta
                         (sobreposição entre fontes é rejeitada por padrão)
custosFixosAdicionais  = soma das deduções resolvidas como valor fixo
baseFinanceira         = custoTotalBase + custosFixosAdicionais
percentualTotalDeducoes = soma das deduções resolvidas como percentual
                          sobre a receita bruta

valorPontoEquilibrio   = baseFinanceira ÷ (1 − %deduções)
valorMinimoComMargem   = baseFinanceira ÷ (1 − %deduções − %margem)
valorMinimoComMarkup   = baseFinanceira × (1 + %markup), ajustado por
                         ÷ (1 − %deduções) quando há deduções percentuais
valorMinimoComLucroFixo = (baseFinanceira + lucroFixoDesejado) ÷ (1 − %deduções)
```

Quando o modo não determina uma única meta de preço (ex.:
`VALOR_MINIMO_POR_KM` sem margem/markup/lucro definidos), a prioridade usada
para o "valor mínimo principal" é: **margem-alvo > markup-alvo > lucro fixo
desejado > ponto de equilíbrio**.

### Adicional de risco: três interpretações, nunca assumidas

`adicionalRiscoPercentual` exige `interpretacaoAdicionalRisco` explícito —
`SOBRE_CUSTO` (aplicado sobre `custoTotalBase`, soma-se aos custos fixos
adicionais), `SOBRE_VALOR_MINIMO` (multiplicador final, forma fechada, sobre
o valor mínimo já calculado) ou `SOBRE_RECEITA` (entra na mesma soma
percentual das outras deduções). Sem essa interpretação, o cálculo falha em
vez de assumir.

### Custo de capital: valor direto ou sub-cálculo

`custoCapitalValor`/`custoCapitalPercentual` funcionam como qualquer outra
dedução (valor fixo ou percentual sobre a receita). Alternativamente,
informando `capitalEmpregadoValor` + `custoCapitalMetodo`
(`JUROS_SIMPLES`/`JUROS_COMPOSTOS`/`PERCENTUAL_DIRETO`/`VALOR_FIXO`) +
`custoCapitalPeriodos`, a ferramenta calcula o custo financeiro do capital
(juros simples: `capital × taxa × períodos`; juros compostos: `capital ×
(1+taxa)^períodos − capital`) e soma o resultado aos custos fixos
adicionais — nunca os dois caminhos ao mesmo tempo.

### Retorno vazio

O impacto do retorno vazio é calculado sempre que `custoIda` e `custoVolta`
estão presentes: recalcula o mesmo "valor mínimo principal" só com o custo
da ida, e compara com o valor considerando o retorno. **Nunca** calcula o
valor mínimo por km carregado ignorando o custo do retorno — o numerador é
sempre o custo de toda a operação.

### Frete com retorno remunerado (rateio)

Quando há `receitaRetorno`, a necessidade de receita da ida é resolvida por
`criterioRateioReceitaRetorno` (padrão `NAO_RATEAR` — subtração simples da
receita de retorno do valor mínimo total). `POR_CUSTO_DO_TRECHO` e
`POR_DISTANCIA` fazem rateio proporcional quando os dados de cada trecho
estão presentes; `MANUAL` usa `valorRateioManualIda` diretamente;
`POR_PESO` cai de volta para `NAO_RATEAR` com alerta (não há peso separado
por trecho na entrada desta fase).

### Comparação com a oferta

`COMPARAR_COM_OFERTA` classifica `valorFreteOferecido` com tolerância
configurável (`toleranciaClassificacaoOfertaPercentual`, padrão 0,5% do
valor mínimo, para não deixar ruído de ponto flutuante virar classificação
errada): `ABAIXO_DO_CUSTO` → `NO_PONTO_DE_EQUILIBRIO` →
`ABAIXO_DA_MARGEM_ALVO` → `ATENDE_MARGEM_ALVO` → `ACIMA_DA_MARGEM_ALVO`. O
desconto máximo (`descontoMaximo`) é calculado a partir de
`precoInicialNegociacao` (ou de `valorFreteOferecido` como alternativa) até
o limite econômico — sem considerar estratégia comercial ou risco não
informado.

### Arredondamento comercial

Nunca arredonda durante os cálculos — só na saída, e o arredondamento
comercial (`arredondamentoComercial`, padrão `SEM_ARREDONDAMENTO`) acontece
depois do arredondamento matemático. `PROXIMO_5`/`10`/`50`/`100` arredondam
sempre **para cima** (nunca para baixo do valor mínimo calculado);
`SEMPRE_PARA_CIMA` arredonda para o real inteiro seguinte. `valorMinimoExato`
e `valorMinimoComercial` são sempre retornados juntos, nunca só o
arredondado.

### Nível de completude

`INSUFICIENTE` quando não há fonte de custo válida. `PARCIAL` quando alguma
categoria de dedução relevante (imposto, comissão, taxa de plataforma,
outras deduções, custo de capital, adicional de risco) não foi informada —
o que cobre a maioria dos casos de uso reais; `COMPLETO` exige as seis
categorias explicitamente preenchidas.

### Exemplo de uso

```ts
import { calcularValorMinimoFrete } from "@/ai/tools/calcular-valor-minimo-frete";

const resultado = calcularValorMinimoFrete({
  modo: "MARGEM_ALVO",
  custoIda: 6000,
  custoVolta: 2000,
  impostoPercentual: 10,
  margemAlvoPercentual: 20,
  valorFreteOferecido: 9500,
  distanciaTotalKm: 1000,
});
// resultado.valorMinimoComMargem, resultado.impactoRetornoVazio,
// resultado.classificacaoOferta, resultado.valorAdicionalNecessario
```

### Limitações conhecidas

- "Valor mínimo" aqui é exclusivamente o piso econômico calculado a partir
  dos dados informados — nunca um piso legal, oficial ou de tabela de
  mercado.
- `baseCalculoPercentuais` diferente de `RECEITA_BRUTA` (o padrão) ainda não
  tem equação fechada implementada — cai de volta para `RECEITA_BRUTA` com
  alerta.
- O critério de rateio `POR_PESO` não tem dados suficientes na entrada desta
  fase (peso não é separado por trecho) e cai de volta para `NAO_RATEAR`.
- Não calcula tributos, comissões, pedágio ou combustível automaticamente —
  tudo vem do que foi informado.

## `calcular_receita_km`

Calcula e interpreta a **receita por quilômetro** de um frete, viagem, rota,
veículo, operação, contrato, conjunto de viagens, frota ou período — sempre
diferenciando receita bruta de receita líquida, receita por km total de
receita por km carregado, e nunca declarando uma operação lucrativa só
porque a receita por km é positiva (isso só é avaliado quando há custo ou
CPK informado).

| Modo | Uso |
|---|---|
| `RECEITA_BRUTA_POR_KM` | Receita bruta ÷ distância |
| `RECEITA_LIQUIDA_POR_KM` | Receita líquida (após deduções) ÷ distância |
| `RECEITA_POR_KM_TOTAL` | Toda a distância percorrida, carregada e vazia |
| `RECEITA_POR_KM_CARREGADO` | Só a distância carregada, com alerta sobre a vazia |
| `RECEITA_E_CUSTO_POR_KM` | Compara receita/km com custo/km ou CPK |
| `LUCRO_POR_KM` / `MARGEM_POR_KM` | Lucro e margem por km |
| `RETORNO_VAZIO` / `FRETE_COM_RETORNO` | Distâncias/receitas separadas por trecho |
| `MULTIPLAS_VIAGENS` | Consolida `viagens` (média ponderada pela distância) |
| `MULTIPLOS_VEICULOS` | Consolida `veiculos`, com ranking por eficiência |
| `ANALISE_POR_PERIODO` | Indicadores por dia (`receitaPorDia`, `kmPorDia`, `lucroPorDia`) |
| `PREVISTO_X_REALIZADO` | Compara os blocos `previsto`/`realizado` |
| `COMPARACAO_CENARIOS` | Compara ≥ 2 `cenarios`, com 5 rankings independentes |
| `COMPARAR_COM_VALOR_MINIMO` | Compara com `valorMinimoPorKm`/`valorMinimoTotal` |
| `RECEITA_TONELADA_KM` | Receita/custo/lucro por tonelada-quilômetro |

### Reutilização — coordenadora, não reimplementadora

- **`calcularMargem`** (modo `MARGEM_POR_KM`) faz todo o núcleo financeiro:
  receita líquida, deduções (imposto, comissão, descontos, devoluções —
  resolvidas pela própria `calcularMargem` via `resolverValorOuAliquota`
  interna), custo, lucro, margem e receita/custo/lucro por km. Diferente de
  `calcular_valor_minimo_frete`, aqui a receita já é conhecida (não está
  sendo resolvida), então a delegação é direta, como em `analisar_frete`.
  `calcularMargem` exige `custoTotal` em todo modo — quando não há custo
  real informado, um placeholder `0` é passado só para obter a receita
  líquida, e os campos derivados de custo (`custoPorKm`/`lucroPorKm`/
  `margemPercentual`) são descartados no resultado, nunca sugerindo uma
  rentabilidade que não foi avaliada.
- **`calcularValorMinimoFrete`** é reutilizada para derivar a receita mínima
  por km (ponto de equilíbrio ou margem-alvo) quando `valorMinimoPorKm`/
  `valorMinimoTotal` não são informados diretamente — só quando o custo
  resolvido é um custo genuíno, não um CPK usado apenas como benchmark de
  comparação (CPK e "meta de preço" são conceitos distintos aqui).
- **`calcularCpk`** (modo `CPK_PNEUS` como divisor genérico valor ÷ km) faz
  toda divisão adicional que `calcularMargem` não expõe: receita bruta por
  km, receita por km carregado, receita por km de retorno, tonelada-km, por
  dia, por veículo, por viagem — mesmo padrão de `calcular_margem.ts` e
  `calcular_valor_minimo_frete.ts`.
- Aceita custo de `calcular-custo-viagem.ts` via `resumoCustoViagem` (tipo
  reexportado por `calcular-margem.ts`), CPK de `calcular-cpk.ts` via
  `resumoCpk` (tipo reexportado por `calcular-valor-minimo-frete.ts` — não
  duplicado aqui) e um resumo normalizado e desacoplado de
  `analisar-frete.ts` via `resumoAnaliseFrete` — sem importar aquele módulo
  por valor, evitando dependência circular; só o tipo
  `EstrategiaSobreposicaoDeducao` é importado de lá (mesmo conceito já
  reaproveitado por `calcular-valor-minimo-frete.ts`).

### Receita bruta x líquida x por km total x por km carregado

A receita por km carregado nunca é apresentada como o resultado da operação
inteira: sempre que há distância vazia, um alerta explícito lembra que os km
vazios ficaram fora desse divisor. O impacto do retorno vazio
(`impactoRetornoVazio`) é apenas uma diferença de indicador (receita/km
carregado − receita/km total) — nunca tratado como custo financeiro isolado.

### Comparação com CPK e com valor mínimo

`indiceCoberturaCpk`/`diferencaReceitaCpkPorKm` comparam a receita líquida
por km com um CPK de referência (`cpkTotal`/`resumoCpk`/`custoPorKm`, nessa
ordem). `receitaMinimaPorKm`/`diferencaParaMinimoPorKm`/
`valorAdicionalNecessario` comparam com o valor mínimo (informado ou
derivado via `calcular_valor_minimo_frete`). A classificação
(`ABAIXO_DO_CUSTO` → `PONTO_DE_EQUILIBRIO` → `ABAIXO_DO_VALOR_MINIMO` →
`ACIMA_DO_CUSTO` → `ATINGE_VALOR_MINIMO` → `ACIMA_DO_VALOR_MINIMO` →
`DADOS_INSUFICIENTES`) usa tolerância configurável
(`toleranciaClassificacaoPercentual`, padrão 0,5%) e nunca compara pontos
flutuantes por igualdade exata. Sem custo, CPK ou valor mínimo informado, a
classificação fica `DADOS_INSUFICIENTES` e a análise financeira é marcada
como não avaliada — apenas a receita por km é retornada.

### Consolidação de viagens e veículos — sempre média ponderada

`MULTIPLAS_VIAGENS`/`MULTIPLOS_VEICULOS` consolidam somando receita e
distância de cada registro e dividindo o total (`receitaTotalConsolidada ÷
distanciaTotalConsolidada`) — **nunca** a média simples das receitas por km
individuais, que distorce o resultado quando as distâncias diferem (ex.:
uma viagem de 100 km a R$ 10/km e outra de 1.000 km a R$ 9/km consolidam
para R$ 9,0909/km, não R$ 9,50/km).

### Prevenção de sobreposições

Receita (total x ida/volta x líquida já informada x fontes alternativas),
distância (total x ida/volta+adicional x carregada+vazia) e custo (total x
por km x CPK x detalhado) são todas resolvidas com estratégia configurável,
padrão `REJEITAR_SOBREPOSICAO`. Consolidação (`viagens`/`veiculos`) informada
junto de totais diretos também é rejeitada — é preciso escolher uma fonte.

### Exemplo de uso

```ts
import { calcularReceitaKm } from "@/ai/tools/calcular-receita-km";

const resultado = calcularReceitaKm({
  modo: "RECEITA_E_CUSTO_POR_KM",
  receitaBruta: 10000,
  impostoPercentual: 10,
  custoTotal: 8000,
  distanciaCarregadaKm: 900,
  distanciaVaziaKm: 100,
  cpkTotal: 8.5,
});
// resultado.receitaLiquidaPorKm, resultado.custoPorKm, resultado.lucroPorKm,
// resultado.indiceCoberturaCpk, resultado.impactoRetornoVazio
```

### Limitações conhecidas

- Não calcula distância, receita, custo, CPK, impostos, comissão, retorno
  ou período automaticamente — tudo vem do que foi informado.
- A "receita por km carregado" distribui a receita só pelos km
  carregados/remunerados — o resultado efetivo de toda a operação é sempre
  a receita por km total.
- Consolida sempre por média ponderada pela distância, nunca por média
  simples.
- `estrategiaSobreposicaoCusto: "PRIORIZAR_CPK"` e as demais estratégias de
  sobreposição só escolhem UMA fonte — nunca somam fontes conflitantes.

## `calcular_custo_dia`

Calcula e interpreta o **custo diário** de um veículo, frota, operação,
rota, contrato ou período — sempre diferenciando custo fixo de variável,
dia corrido de dia útil/operado/disponível, e nunca dividindo custos
mensais/anuais por 30/365 silenciosamente. Um veículo parado **nunca** é
tratado como sem custo: os custos fixos que continuam existindo
(financiamento, seguro, licenciamento etc.) são sempre considerados.

| Modo | Uso |
|---|---|
| `CUSTO_FIXO_DIARIO` / `CUSTO_VARIAVEL_DIARIO` / `CUSTO_TOTAL_DIARIO` | Só o fixo, só o variável, ou a soma |
| `CUSTO_POR_DIA_CORRIDO`/`UTIL`/`OPERADO`/`DISPONIVEL` | Rateiam pela base de dias correspondente (infere `tipoDia` do próprio modo) |
| `CUSTO_VEICULO_DIA` / `CUSTO_FROTA_DIA` | Custo de 1 veículo, ou consolidado da frota (÷ `quantidadeVeiculos`) |
| `CUSTO_VIAGEM_POR_DIA` | Custo total de uma viagem ÷ `diasViagem` |
| `VEICULO_OPERANDO` / `VEICULO_PARADO` / `VEICULO_OCIOSO` | Veículo rodando, parado (só custos que continuam existindo) ou disponível sem receita |
| `RECEITA_E_RESULTADO_DIARIO` | Receita, custo, lucro e margem do dia |
| `PONTO_EQUILIBRIO_DIARIO` / `MARGEM_ALVO_DIARIA` | Receita diária mínima, com ou sem margem-alvo |
| `PREVISTO_X_REALIZADO` | Compara os blocos `previsto`/`realizado` |
| `ANALISE_POR_PERIODO` | Indicadores do período (usa os mesmos campos do núcleo) |
| `MULTIPLOS_VEICULOS` | Consolida `veiculos` (média ponderada pela quilometragem) |
| `COMPARACAO_CENARIOS` | Compara ≥ 2 `cenarios`, com 6 rankings independentes |

### Reutilização — coordenadora, não reimplementadora

- **`calcularMargem`** (modo `MARGEM_SIMPLES`) calcula lucro e margem
  diária quando receita e custo já são conhecidos — mesma técnica de
  `calcular_receita_km`.
- **`calcularValorMinimoFrete`** (modos `PONTO_EQUILIBRIO`/`MARGEM_ALVO`)
  calcula a receita de equilíbrio e a receita mínima para a margem-alvo
  diária, já considerando deduções percentuais (`impostoPercentual`,
  `comissaoPercentual`, `outrasDeducoesPercentual`) — sem reimplementar
  essas equações.
- **`calcularCpk`** (modo `CPK_PNEUS` como divisor genérico valor ÷ km) faz
  toda divisão segura contra zero: custo por km, por hora, por veículo,
  por motorista, por ajudante, por viagem, receita por veículo — mesmo
  padrão de `calcular_margem.ts`, `calcular_valor_minimo_frete.ts` e
  `calcular_receita_km.ts`.
- **`calcularReceitaKm`** (modo `RECEITA_BRUTA_POR_KM`) resolve a receita
  diária quando informada como valor por km × quilometragem
  (`receitaPorKmInformada`), em vez de reimplementar aquela resolução.
- Aceita o custo de `calcular-custo-viagem.ts` via `resumoCustoViagem`
  (tipo reexportado por `calcular-margem.ts`) e o CPK de `calcular-cpk.ts`
  via `resumoCpk` (tipo reexportado por `calcular-valor-minimo-frete.ts` —
  não duplicado aqui). Cria só um ponto de extensão desacoplado
  (`resumoCustoVeiculoParado`) para a futura `calcular-custo-veiculo-parado.ts`
  — sem importar aquele módulo, que ainda não existe.

### Normalização de periodicidade

Cada item de `custosFixos` tem uma `periodicidade` (`DIARIO` até
`PERSONALIZADO`) convertida para valor diário por uma função central:
`MENSAL`/`POR_PERIODO` usam a base de dias resolvida por `tipoDia` (ou
`quantidadeDiasPeriodo` do próprio item); `SEMANAL`/`QUINZENAL`/
`BIMESTRAL`/`TRIMESTRAL`/`SEMESTRAL`/`ANUAL` exigem `quantidadeDiasPeriodo`
explícito, ou caem para um padrão configurável **só** quando
`permitirEstimativas` está habilitado — sempre com a premissa registrada
(nunca assume 30 ou 365 dias silenciosamente). `VALOR_TOTAL` sempre exige
`quantidadeDiasPeriodo`.

### Tipo de dia — base de rateio explícita

`tipoDia` (`CORRIDO`/`UTIL`/`OPERADO`/`DISPONIVEL`/`VIAGEM`/`PARADO`/
`PERSONALIZADO`) é inferido do modo quando o nome do modo já o determina
(`CUSTO_POR_DIA_OPERADO` → `OPERADO`, `VEICULO_PARADO` → `PARADO` etc.); a
ferramenta nunca escolhe silenciosamente entre 30 dias, dias úteis ou dias
operados — o campo de dias correspondente só é exigido quando algo
realmente precisa dele (custo mensal informado, ou item de custo fixo com
periodicidade que rateia pela base de dias).

### Custos de pessoal

`custoTotalMotoristas`/`custoTotalAjudantes` (agregados) são divididos por
`quantidadeMotoristas`/`quantidadeAjudantes` para `custoMotoristaDia`/
`custoAjudanteDia` — nunca calcula encargos automaticamente, usa só os
valores informados. A convenção de categoria `"SALARIO_COM_ENCARGOS"` +
`"ENCARGOS"` no mesmo `custosFixos` é detectada como possível duplicidade e
rejeitada por padrão.

### Veículo parado x ocioso

`VEICULO_PARADO` inclui só os custos que continuam existindo (fixo diário
+ `custosEspecificosParada`, ex.: estacionamento, diária de pátio) —
**nunca** inclui combustível, ARLA ou pedágio automaticamente, porque
esses só existiriam se o usuário os informasse (o que não faz sentido para
um veículo parado). `VEICULO_OCIOSO` calcula `diasOciosos`
(`diasDisponiveisPeriodo − diasOperadosPeriodo`), `taxaUtilizacao`,
`taxaOciosidade` e `custoFixoOciosidade` (custo fixo × dias ociosos).

### Múltiplos veículos — sempre média ponderada

A consolidação de `veiculos` usa custo total ÷ quilometragem total (média
ponderada), nunca a média simples dos custos por km individuais — mesmo
princípio de `calcular_receita_km`.

### Prevenção de sobreposições

Custo (total diário × mensal × detalhado × CPK × custo por km × fonte
externa de outra ferramenta) é resolvido com estratégia configurável
(`REJEITAR_SOBREPOSICAO`/`PRIORIZAR_TOTAL`/`PRIORIZAR_DETALHADO`/
`PRIORIZAR_VALOR_DIARIO`/`PRIORIZAR_FONTE_EXTERNA`), padrão
`REJEITAR_SOBREPOSICAO`. `custoFinanceiroDiarioInformado`/
`custoAdministrativoDiarioInformado`/`outrosCustosDiariosInformado` são
sempre somados por cima da fonte principal (fixo+variável) — nunca
competem entre si por sobreposição.

### Exemplo de uso

```ts
import { calcularCustoDia } from "@/ai/tools/calcular-custo-dia";

const resultado = calcularCustoDia({
  modo: "RECEITA_E_RESULTADO_DIARIO",
  custosFixos: [
    { descricao: "Financiamento", valor: 4500, periodicidade: "MENSAL" },
    { descricao: "Seguro", valor: 900, periodicidade: "MENSAL" },
  ],
  custosVariaveis: [{ descricao: "Combustível", valor: 2.5, base: "POR_KM" }],
  tipoDia: "OPERADO",
  diasOperadosPeriodo: 20,
  quilometragemDia: 400,
  receitaDia: 1500,
});
// resultado.custoFixoDiario, resultado.custoTotalDiario,
// resultado.lucroDiario, resultado.classificacao
```

### Limitações conhecidas

- Não calcula custos, salário, encargos, financiamento, seguro,
  manutenção, combustível, quilometragem, dias, horas ou receita
  automaticamente — tudo vem do que foi informado.
- A detecção de "salário com encargos + encargos separados" depende da
  convenção de categoria `"SALARIO_COM_ENCARGOS"`/`"ENCARGOS"` — categorias
  livres diferentes não são detectadas automaticamente.
- Custos de pessoal detalhados (diárias, horas extras, adicional noturno
  etc.) devem ser informados como itens de `custosFixos`/`custosVariaveis`
  — não há uma sub-estrutura dedicada nesta fase.
- O ponto de extensão para `calcular-custo-veiculo-parado.ts`
  (`resumoCustoVeiculoParado`) aceita o campo, mas aquela ferramenta ainda
  não existe.

## `calcular_custo_veiculo_parado`

Calcula e interpreta o **impacto financeiro de um veículo (ou frota) parado**
— manutenção, avaria, acidente, espera de peça/oficina/carga/descarga, falta
de motorista/demanda, restrição operacional/administrativa ou parada
programada. Sempre diferencia custo fixo que continua existindo, custo
adicional provocado pela parada, custos evitados por não operar, receita
não realizada e lucro não realizado — **nunca trata faturamento perdido
como lucro perdido**, e nunca soma receita não realizada e lucro não
realizado como impactos independentes no mesmo total.

| Modo | Uso |
|---|---|
| `CUSTO_FIXO_DURANTE_PARADA` / `CUSTO_ADICIONAL_PARADA` / `CUSTO_DIRETO_PARADA` / `CUSTO_TOTAL_PARADA` | Só o fixo, só o adicional, a soma, ou o total (com custos evitados/receita/lucro quando disponíveis) |
| `RECEITA_NAO_REALIZADA` / `LUCRO_NAO_REALIZADO` | Faturamento e resultado que deixaram de acontecer |
| `CUSTO_OPORTUNIDADE` | Só quando uma alternativa é explicitamente informada |
| `CUSTO_POR_HORA_PARADA` / `CUSTO_POR_DIA_PARADO` | Impacto dividido pela duração |
| `PARADA_MANUTENCAO`/`AVARIA`/`ACIDENTE`/`AGUARDANDO_PECA`/`AGUARDANDO_OFICINA`/`AGUARDANDO_CARGA`/`AGUARDANDO_DESCARGA`/`FALTA_MOTORISTA`/`FALTA_DEMANDA` | Rótulos de motivo — o núcleo de cálculo é o mesmo, o motivo nunca infere responsabilidade ou cobertura |
| `PARADA_PROGRAMADA` / `PARADA_NAO_PROGRAMADA` | Classificação `PARADA_PROGRAMADA_CONTROLADA` fixa no primeiro caso; nenhum benefício preventivo é calculado sem entrada |
| `VEICULO_SUBSTITUTO` | Compara manter a parada com substituir temporariamente |
| `MULTIPLOS_VEICULOS` / `FROTA_PARCIALMENTE_PARADA` | Consolida `veiculos`, ou só o percentual de frota parada |
| `PREVISTO_X_REALIZADO` | Compara os blocos `previsto`/`realizado` |
| `COMPARACAO_CENARIOS` / `ANALISE_REPARAR_OU_SUBSTITUIR` | Compara ≥ 2 `cenarios` (oficinas, peças, reparar x substituir) |
| `ANALISE_REDUCAO_TEMPO_PARADO` | Valor máximo economicamente justificável para reduzir a parada |

### Reutilização — coordenadora, não reimplementadora

- **`calcularCustoDia`** (modo `CUSTO_FIXO_DIARIO`) normaliza `custosFixos`
  — mesmo tipo `ItemCustoFixo` reexportado por `calcular-custo-dia.ts`, com
  a mesma normalização de periodicidade (mensal/anual/etc. rateados pela
  base de dias) — sem reimplementar aquele rateio.
- **`calcularMargem`** (modo `MARGEM_SIMPLES`) calcula o "lucro pela
  operação evitada" (receita não realizada − custos variáveis evitados).
- **`calcularCpk`** (modo `CPK_PNEUS` como divisor genérico) faz toda
  divisão segura contra zero (custo por hora/dia parado, custo médio por
  veículo, custo médio consolidado por hora/dia).
- Aceita o custo de `calcular-custo-dia.ts` via `resumoCustoDia` (sentido
  inverso do ponto de extensão que aquela ferramenta já expõe para esta:
  `ResumoCustoVeiculoParadoParaCustoDia`), custos evitados de
  `calcular-custo-viagem.ts` via `resumoCustoViagem` (tipo reexportado por
  `calcular-margem.ts`) e de `calcular-cpk.ts` via `resumoCpk` (tipo
  reexportado por `calcular-valor-minimo-frete.ts`). Nenhuma dependência
  circular: este arquivo importa de `calcular-custo-dia.ts`,
  `calcular-margem.ts`, `calcular-cpk.ts` e `calcular-valor-minimo-frete.ts`
  (só tipo) — nenhum deles importa deste.

### Duração da parada

`horasParadas`, `diasParados`×`horasPorDia` e `dataInicio`/`dataFim` competem
como fontes concorrentes (`estrategiaSobreposicaoDuracao`, padrão
`REJEITAR_SOBREPOSICAO`). Quando datas são usadas, a regra é sempre
documentada: diferença em dias corridos, sem considerar fuso horário ou
horas parciais. Duração igual a zero é sempre rejeitada (nunca uma divisão
por zero silenciosa).

### Custo fixo x adicional x evitado

- **Custo fixo** (`custoFixoDiarioInformado`/`custoFixoHoraInformado`/
  `custosFixos`/`resumoCustoDia`) é o que continua existindo mesmo sem
  operação — financiamento, seguro, salário etc.
- **Custo adicional** (`custosAdicionais`) é o gasto extraordinário da
  parada — oficina, peça, guincho, hospedagem etc. Bases percentuais
  (`RECEITA_NAO_REALIZADA`/`VALOR_DO_FRETE`/`CUSTO_REPARO`/
  `CUSTO_TOTAL_PARADA`) têm equação fechada — inclusive `CUSTO_TOTAL_PARADA`,
  que é circular (o adicional é % do total que ele próprio compõe) e é
  resolvida por equação, não por iteração.
- **Custos evitados** (`custosEvitados`) são os custos operacionais que não
  ocorreram por não operar — nunca subtraídos automaticamente, só quando
  informados explicitamente ou derivados de `resumoCpk`/`resumoCustoViagem`.
  Quando os evitados superam o custo direto, um alerta explícito lembra que
  isso não significa lucro.

### Receita não realizada x lucro não realizado

Faturamento perdido (receita) e resultado perdido (lucro) são sempre
diferenciados — o lucro só é calculado a partir de margem histórica, lucro
médio, ou receita menos custos variáveis evitados (via `calcularMargem`),
nunca assumido como igual à receita.

### Visão de caixa x visão econômica

```
impactoCaixa     = custoAdicionalParada + custoFixoParada − custosEvitados
impactoEconomico = custoLiquidoDireto + lucroNaoRealizado + custoOportunidadeInformado
```

A visão de caixa trata todo custo fixo informado como desembolsável nesta
fase (não distingue itens não-caixa como depreciação automaticamente). A
visão econômica nunca soma receita não realizada e lucro não realizado
juntos — só o lucro entra no impacto econômico.

### Veículo substituto e redução de tempo parado

`VEICULO_SUBSTITUTO` calcula `resultadoSubstituto` (receita gerada − custo
do substituto) e `beneficioLiquidoSubstituto` (impacto evitado + resultado
do substituto) — nunca escolhe automaticamente a substituição como melhor.
`ANALISE_REDUCAO_TEMPO_PARADO` calcula `valorMaximoJustificavelReducao`
(custo por dia parado × dias de redução) como um indicativo, nunca como
autorização automática de gasto.

### Múltiplos veículos — sempre média ponderada

A consolidação usa impacto total ÷ horas/dias totais (média ponderada),
nunca a média simples — mesmo princípio de `calcular_custo_dia` e
`calcular_receita_km`.

### Prevenção de sobreposições

Custo fixo (diário × hora × detalhado × `resumoCustoDia`), custo adicional
(total × detalhado), receita não realizada (6 fontes) e lucro não realizado
(4 fontes) são todos resolvidos com estratégia configurável, padrão
`REJEITAR_SOBREPOSICAO`.

### Exemplo de uso

```ts
import { calcularCustoVeiculoParado } from "@/ai/tools/calcular-custo-veiculo-parado";

const resultado = calcularCustoVeiculoParado({
  modo: "PARADA_MANUTENCAO",
  motivoParada: "MANUTENCAO_CORRETIVA",
  diasParados: 3,
  custoFixoDiarioInformado: 400,
  custosAdicionais: [
    { descricao: "Peça", valor: 2000, base: "VALOR_TOTAL" },
    { descricao: "Mão de obra", valor: 800, base: "VALOR_TOTAL" },
  ],
  custosEvitados: [{ descricao: "Combustível", valor: 700 }],
  receitaMediaDia: 2000,
  margemMediaPercentual: 20,
});
// resultado.custoDiretoParada, resultado.custoLiquidoDireto,
// resultado.receitaNaoRealizada, resultado.lucroNaoRealizado,
// resultado.impactoEconomico, resultado.classificacao
```

### Limitações conhecidas

- Não calcula duração, custos, receita, margem, lucro, quantidade de
  viagens, quilômetros, prazo de peça/oficina, custo de substituto ou
  custo de oportunidade automaticamente — tudo vem do que foi informado.
- Não infere responsabilidade, culpa, cobertura de seguro ou obrigação
  legal a partir do motivo da parada.
- O nível de confiança (`nivelConfianca`) é um indicador único por
  resultado nesta fase, não granular por categoria (custo fixo, adicional,
  evitados etc. separadamente) como o detalhamento máximo da especificação
  sugere.
- Base percentual `VALOR_FIXO` para `custosAdicionais` ainda não tem
  equação implementada nesta fase.

## Helpers compartilhados (`utils.ts`)

`arredondar`, `formatarBRL`, `formatarNumero`, `CASAS_DECIMAIS_PADRAO`,
`CASAS_DECIMAIS_MOEDA_PADRAO`, `CASAS_DECIMAIS_PERCENTUAL_PADRAO` e
`CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO` vivem em `utils.ts` e são usados por
todas as ferramentas com lógica implementada. `NivelCompletude`
(COMPLETO/PARCIAL/INSUFICIENTE) e `EstrategiaSobreposicao`
(REJEITAR_SOBREPOSICAO/PRIORIZAR_TOTAL/PRIORIZAR_DETALHADO) vivem em
`types.ts` pelo mesmo motivo — usados por `comparar-pneus.ts`,
`calcular-custo-viagem.ts` e `calcular-margem.ts`. Novas ferramentas que
precisarem de arredondamento/formatação/completude/estratégia de
sobreposição devem importar daqui em vez de redeclarar.

## Dependências

Nenhuma nesta fase — apenas TypeScript puro, sem pacotes externos.

## Testes

O projeto (`frota-ia-assistente`) ainda **não tem um framework de testes
configurado** (sem Jest/Vitest no `package.json`). Por instrução explícita,
nenhum framework novo foi instalado sem antes informar isso. A verificação
de cada ferramenta foi feita manualmente, rodando os cenários da
especificação em um script descartável (não commitado) — para
`calcular-combustivel.ts` via `node --experimental-strip-types`; para
`calcular-cpk.ts`, como o arquivo passou a importar `./utils` (sem extensão),
o resolvedor nativo do Node não encontra o módulo nesse modo, então a
verificação foi feita compilando os arquivos para CommonJS com
`tsc --module commonjs --moduleResolution node` num diretório temporário e
rodando o JS resultante com `node`. Quando o time decidir qual framework
usar, os casos abaixo devem virar testes automatizados:

**`calcular_combustivel`**

1. Viagem simples (600 km, 3 km/l, R$ 6,00/l → 200 l, R$ 1.200,00, R$ 2,00/km)
2. Ida e volta via `considerarIdaVolta`
3. Ida e volta informadas separadamente (sem duplicar)
4. Distância adicional
5. Consumo real via hodômetro (100.000 → 100.750, 250 l → 3 km/l, 33,33 l/100km)
6. Autonomia com reserva (200 l, 3 km/l, 10% → 600 km teórica, 540 km útil)
7. Combustível insuficiente (litros no tanque < litros necessários)
8. Comparação previsto x realizado (3 km/l x 2,7 km/l)
9. Valores negativos rejeitados
10. Consumo igual a zero rejeitado
11. Quilometragem final menor que a inicial rejeitada
12. Litros no tanque acima da capacidade rejeitados
13. Comparação entre dois cenários

**`calcular_cpk`**

1. Pneus (R$ 12.000, 100.000 km → CPK = 0,12)
2. Combustível (R$ 90.000, 60.000 km → CPK = 1,50)
3. Manutenção (R$ 18.000, 60.000 km → CPK = 0,30)
4. CPK total (somatório correto + `cpkPorCategoria` só com as categorias informadas)
5. Comparação entre dois veículos (menor CPK, diferença, economia estimada)
6. Valores negativos rejeitados
7. Quilometragem igual a zero rejeitada
8. Custos incompletos → `dadosFaltantes` preenchido
9. Somente pneus (sem exigir outras categorias)
10. Somente combustível

**`comparar_pneus`**

1. Pneu novo x recapado (CPK 0,0225 x 0,0220, diferença 0,0005, sem superioridade técnica declarada)
2. Ciclo completo com recapagens (custo total R$ 3.500, 220.000 km, CPK ≈ 0,015909)
3. Preço menor com CPK maior (a ferramenta não escolhe pelo preço)
4. Comparação de frota (10 veículos, 18 pneus/veículo, economia projetada)
5. Quilometragem zero → falha, sem divisão por zero
6. Custo negativo → falha, campo identificado
7. Somente uma opção → falha, pede ao menos duas
8. Três opções → ranking, melhor, pior e diferença em relação à referência
9. Dados parciais → classificação PARCIAL, custos ausentes listados
10. Dados insuficientes → sem conclusão financeira
11. Previsto x realizado → CPK dos dois, alerta quando km real < previsto
12. Valor residual subtraído uma única vez
13. Quantidade de pneus sem duplicar custo/economia
14. Recapagens em lista, com custos e quilometragens diferentes por evento

**`calcular_custo_viagem`**

1. Viagem simples só combustível (600 km, 3 km/l, R$ 6,00/l → 200 l, R$ 1.200,00, R$ 2,0000/km, classificação parcial)
2. Combustível + pedágio (custo total R$ 1.600,00, R$ 3,2000/km)
3. Ida e volta com consumos diferentes (160 l + 125 l = 285 l, R$ 1.710,00)
4. Custo por `cpkTotal` (1.000 km × R$ 4,50/km = R$ 4.500,00)
5. `cpkTotal` + combustível detalhado → sobreposição rejeitada por padrão
6. CPK por categoria (manutenção+pneus+fixos+combustível → R$ 3,5000/km)
7. ARLA por percentual (5% de 200 l → 10 l, R$ 40,00)
8. Custo por tonelada (R$ 5.000,00 ÷ 25 t = R$ 200,00)
9. Custo por tonelada-km (R$ 5.000,00 ÷ (25 t × 500 km) = R$ 0,40)
10. Múltiplos veículos (3 veículos, custo por veículo sem duplicar)
11. Motorista por diária (3 dias × R$ 250,00 = R$ 750,00)
12. Dois motoristas (multiplicação correta por pessoa e por dia)
13. Pedágio em lista (soma de praças e passagens)
14. Pedágio total + lista → duplicidade rejeitada por padrão
15. Retorno vazio (custo da ida e da volta preservados, total correto, premissa explícita)
16. Previsto x realizado (R$ 4.000,00 → R$ 4.600,00: diferença R$ 600,00, variação 15%)
17. Distância zero rejeitada
18. Consumo zero rejeitado
19. Custo negativo rejeitado
20. Dados parciais → classificação PARCIAL, custos ausentes listados
21. Dados insuficientes → falha, sem resultado financeiro enganoso
22. Rateio por dia (custo fixo `POR_DIA` × dias)
23. Rateio por veículo (custo fixo `POR_VEICULO` × quantidadeVeiculos)
24. Rateio por pessoa (ajudante: diária × dias × quantidade)
25. Custo por unidade (`RATEIO_POR_CARGA`, critério `UNIDADE`)

**`calcular_margem`**

1. Margem simples (receita R$ 10.000, custo R$ 8.000 → lucro R$ 2.000, margem 20%, markup 25%)
2. Prejuízo (receita R$ 8.000, custo R$ 9.000 → prejuízo R$ 1.000, margem -12,5%, classificação PREJUIZO)
3. Desconto (receita bruta R$ 10.000 − R$ 500 → receita líquida R$ 9.500, margem ≈15,79%)
4. Imposto percentual (10% de R$ 10.000 = R$ 1.000 → receita líquida R$ 9.000, margem ≈22,22%)
5. Comissão percentual (validação do cálculo e da base usada)
6. Margem por km (receita R$ 9,00/km, custo R$ 7,00/km, lucro R$ 2,00/km)
7. Margem por tonelada (lucro R$ 100,00/t)
8. Ponto de equilíbrio sem percentuais (R$ 8.000,00)
9. Ponto de equilíbrio com imposto (10%) e comissão (5%) (≈R$ 9.411,76)
10. Margem-alvo sem deduções (R$ 8.000 ÷ 0,80 = R$ 10.000,00)
11. Margem-alvo com deduções (equação completa validada)
12. Markup-alvo (R$ 8.000 × 1,25 = R$ 10.000,00)
13. Retorno vazio (custo total R$ 8.000, lucro R$ 2.000, margem 20%, impacto destacado)
14. Previsto x realizado (diferença de receita, custo e margem calculadas corretamente)
15. Comparação de três cenários (cenário de maior receita não é o de maior lucro — alertado)
16. Receita zero rejeitada
17. Custo negativo rejeitado
18. Percentual acima de 100% rejeitado
19. Deduções somando 100% ou mais → denominador inválido, rejeitado
20. Custo total e detalhado ao mesmo tempo → sobreposição rejeitada por padrão
21. Dados parciais → classificação PARCIAL, impostos/comissão ausentes citados no resumo
22. Dados insuficientes → sem conclusão enganosa
23. Dois veículos (lucro por veículo)
24. Múltiplas viagens (lucro por viagem)
25. Margem e markup comprovadamente diferentes para os mesmos números

Testes de regressão de `calcular_combustivel` (13), `calcular_cpk` (10),
`comparar_pneus` (5 cenários-chave) e `calcular_custo_viagem` (8
cenários-chave) foram reexecutados junto com os 25 de `calcular_margem` —
todas as 90 verificações passaram nesta rodada.

**`analisar_frete`**

1. Frete simples lucrativo (receita R$ 10.000, custo R$ 8.000, 1.000 km → lucro R$ 2.000, margem 20%, receita/custo/lucro por km: 10/8/2)
2. Prejuízo (receita R$ 8.000, custo R$ 9.000 → prejuízo R$ 1.000, margem negativa, classificação `INVIAVEL`)
3. Retorno vazio (ida: receita R$ 10.000/custo R$ 6.000/500 km; volta: receita R$ 0/custo R$ 2.000/500 km → custo total R$ 8.000, lucro R$ 2.000, margem 20%, distância vazia 500 km, 50%, lucro/km R$ 2,00, `impactoRetornoVazio` presente)
4. Frete com retorno remunerado (receita e custo somados dos dois trechos, sem duplicidade)
5. Receita por km carregado x total diferem (carregado > total, quando há retorno vazio)
6. Análise por tonelada (receita R$ 10.000, custo R$ 8.000, 20 t → R$ 500,00/400,00/100,00 por tonelada)
7. Imposto percentual (10% de R$ 10.000 → dedução R$ 1.000, receita líquida R$ 9.000, lucro R$ 2.000, margem ≈22,22%)
8. Comissão percentual (5% de R$ 10.000 → dedução R$ 500, lucro R$ 2.500)
9. Taxa de plataforma percentual (8% de R$ 10.000 → dedução R$ 800, lucro R$ 2.200)
10. `valorFreteTotal` + `receitaFreteIda` → sobreposição de receita rejeitada por padrão
11. `custoTotal` + `custosVariaveis` → sobreposição de custo rejeitada por padrão (delegado a `calcular_margem`)
12. Capital de giro (antecipados R$ 4.000, adiantamento R$ 1.500 → capital necessário R$ 2.500)
13. Adiantamento suficiente (antecipados R$ 4.000, adiantamento R$ 4.500 → capital necessário -R$ 500, saldo operacional R$ 0)
14. Prazo não informado → risco `PRAZO_PAGAMENTO`/`NAO_AVALIADO`, completude `PARCIAL`
15. Margem mínima (receita R$ 10.000, custo R$ 8.500, margem 15% x mínima 20% → cobre custos, valor adicional R$ 625,00, classificação `MARGEM_INSUFICIENTE`)
16. Ponto de equilíbrio (receita R$ 9.000, custo R$ 10.000 → valor adicional R$ 1.000,00, classificação `INVIAVEL`)
17. Comparação de duas propostas (maior receita/custo não é a de maior margem/lucro — ranking não usa só o faturamento)
18. Comparação de três propostas (ranking por lucro, e uma proposta com margem mínima própria classificada `MARGEM_INSUFICIENTE` mesmo lucrativa)
19. Previsto x realizado (previsto: receita R$ 10.000/custo R$ 8.000/margem 20%; realizado: receita R$ 9.500/custo R$ 8.700/lucro R$ 800/margem ≈8,42%)
20. Distância igual a zero → falha, sem divisão por zero
21. Receita igual a zero → falha para margem, mensagem clara
22. Custo negativo → falha, campo identificado (delegado a `calcular_margem`)
23. Percentual inválido (150%) → falha (delegado a `calcular_margem`)
24. Apenas parte dos custos (`custosVariaveis`) → cálculo possível, completude `PARCIAL`, custos ausentes listados
25. Dados insuficientes (só `descricaoFrete`) → falha, sem recomendação enganosa
26. Risco não avaliado (origem/destino/tipoCarga informados, mas sem `risco*Nivel`) → `CARGA`/`ROTA`/`CLIENTE` como `NAO_AVALIADO`, nada inventado do nome da cidade/carga
27. Múltiplos veículos (2 veículos, lucro R$ 6.000 → lucro por veículo R$ 3.000,00, sem duplicidade)
28. Adiantamento maior que o frete → rejeitado sem justificativa; aceito com `justificativaAdiantamentoSuperiorAoFrete`
29. Saldo inconsistente (adiantamento + saldo ≠ valor do frete) → rejeitado; aceito quando coerente
30. Resultado positivo com capital de giro alto → lucro positivo, risco `CAPITAL_GIRO`, alerta financeiro, classificação não é `ATRATIVO` automaticamente

Testes de regressão de `calcular_combustivel`, `calcular_cpk`,
`comparar_pneus`, `calcular_custo_viagem` e `calcular_margem` (um cenário
representativo de cada) foram reexecutados junto com os 30 de
`analisar_frete` — todas as 111 verificações passaram nesta rodada.

**`calcular_valor_minimo_frete`**

1. Ponto de equilíbrio simples (custo R$ 8.000,00, sem deduções → R$ 8.000,00)
2. Ponto de equilíbrio com deduções (custo R$ 8.000,00, imposto 10% + comissão 5% → R$ 8.000 ÷ 0,85 ≈ R$ 9.411,76)
3. Margem-alvo sem deduções (custo R$ 8.000,00, margem 20% → R$ 8.000 ÷ 0,80 = R$ 10.000,00)
4. Margem-alvo com deduções (custo R$ 8.000,00, dedução 10%, margem 20% → R$ 8.000 ÷ 0,70 ≈ R$ 11.428,57)
5. Markup-alvo sem deduções (custo R$ 8.000,00, markup 25% → R$ 10.000,00)
6. Markup-alvo com deduções (custo R$ 8.000,00, markup 25%, dedução 10% → R$ 10.000 ÷ 0,90 ≈ R$ 11.111,11)
7. Lucro fixo sem deduções (custo R$ 8.000,00, lucro R$ 2.000,00 → R$ 10.000,00)
8. Lucro fixo com deduções (custo R$ 8.000,00, lucro R$ 2.000,00, dedução 10% → R$ 11.111,11)
9. Valor por km (valor mínimo R$ 10.000,00, 1.000 km → R$ 10,0000/km)
10. Valor por km carregado com retorno vazio (500 km carregados + 500 km vazios → R$ 10,0000/km total, R$ 20,0000/km carregado, alerta sobre o retorno vazio)
11. Valor por tonelada (R$ 10.000,00, 20 t → R$ 500,00/t)
12. Tonelada-quilômetro (R$ 10.000,00, 20 t × 500 km → R$ 1,0000/t·km)
13. Valor por unidade (R$ 10.000,00, 200 unidades → R$ 50,00/unidade)
14. Múltiplos veículos (custo individual R$ 8.000,00 × 3 veículos → custo total R$ 24.000,00, valor por veículo R$ 8.000,00, sem multiplicação duplicada)
15. Retorno vazio (ida R$ 6.000,00 + retorno R$ 2.000,00, margem 20% → R$ 10.000,00; impacto do retorno destacado — sem retorno seria R$ 7.500,00)
16. Retorno remunerado (valor mínimo R$ 10.000,00, receita de retorno R$ 3.000,00 → necessidade na ida R$ 7.000,00, sem rateio arbitrário)
17. Oferta abaixo do custo (mínimo R$ 10.000,00, oferta R$ 7.500,00 → diferença -R$ 2.500,00, `ABAIXO_DO_CUSTO`)
18. Oferta cobre custo mas não a margem (custo R$ 8.000,00, mínimo com margem R$ 10.000,00, oferta R$ 9.000,00 → `ABAIXO_DA_MARGEM_ALVO`)
19. Oferta atinge a margem (mínimo e oferta R$ 10.000,00 → `ATENDE_MARGEM_ALVO`)
20. Oferta acima da margem (mínimo R$ 10.000,00, oferta R$ 11.000,00 → `ACIMA_DA_MARGEM_ALVO`)
21. Desconto máximo (referência R$ 12.000,00, mínimo R$ 10.000,00 → desconto R$ 2.000,00, ≈16,67%)
22. Arredondamento comercial (R$ 10.043,27, `PROXIMO_50` → R$ 10.050,00)
23. Margem x markup (custo R$ 8.000,00 → margem 20% dá R$ 10.000,00, markup 20% dá R$ 9.600,00 — resultados diferentes)
24. Deduções somando 100% → falha, denominador inválido
25. Margem + deduções ≥ 100% → falha, cálculo impossível
26. Distância igual a zero → falha só quando o modo exige km; sem divisão por zero
27. Peso igual a zero → falha só quando o modo exige tonelada
28. Quantidade igual a zero → falha só quando o modo exige unidade
29. Custo negativo → falha, campo identificado
30. `custoTotal` + `custosVariaveis` → sobreposição de custo rejeitada por padrão
31. Imposto fixo e percentual → sobreposição rejeitada por padrão
32. Comissão fixa e percentual → sobreposição rejeitada por padrão
33. Comparação de três cenários (margem 10%/15%/20% sobre o mesmo custo → ranking por menor valor mínimo, valores R$ 8.888,89 / R$ 9.411,76 / R$ 10.000,00)
34. Custo de capital simples (capital R$ 5.000,00, taxa 2% a.m., 2 meses, juros simples → R$ 200,00)
35. Custo de capital composto (mesmos dados, juros compostos → R$ 202,00)
36. Dados parciais → cálculo possível, completude `PARCIAL`, deduções ausentes listadas
37. Dados insuficientes (sem nenhuma fonte de custo) → falha, completude `INSUFICIENTE`
38. Tolerância decimal → ruído de ponto flutuante na oferta não altera a classificação

Testes de regressão de `calcular_combustivel`, `calcular_cpk`,
`comparar_pneus`, `calcular_custo_viagem`, `calcular_margem` e
`analisar_frete` (um cenário representativo de cada) foram reexecutados
junto com os 38 de `calcular_valor_minimo_frete` — todas as 100 verificações
passaram nesta rodada.

**`calcular_receita_km`**

1. Receita bruta por km (R$ 10.000,00, 1.000 km → R$ 10,0000/km)
2. Receita líquida por km (bruta R$ 10.000,00, deduções R$ 1.000,00 → líquida R$ 9.000,00, R$ 9,0000/km)
3. Imposto percentual (10% de R$ 10.000,00 → líquida R$ 9.000,00, R$ 9,0000/km)
4. Comissão percentual (10% de R$ 10.000,00 → líquida R$ 9.000,00, R$ 9,0000/km)
5. Receita por km total com retorno vazio (500 km carregados + 500 km vazios → total 1.000 km, R$ 10,0000/km total, R$ 20,0000/km carregado, 50% vazio, alerta)
6. Frete com retorno remunerado (ida R$ 8.000,00/500 km + volta R$ 4.000,00/500 km → total R$ 12.000,00/1.000 km = R$ 12,0000/km; volta R$ 8,0000/km)
7. Receita e custo por km (receita R$ 10.000,00, custo R$ 8.000,00, 1.000 km → R$ 10,0000/km receita, R$ 8,0000/km custo, R$ 2,0000/km lucro, margem 20%)
8. Receita abaixo do CPK (R$ 5,00/km x CPK R$ 6,00/km → diferença -R$ 1,00/km, cobertura ≈0,8333, `ABAIXO_DO_CUSTO`)
9. Receita igual ao CPK (R$ 6,00/km x CPK R$ 6,00/km → `PONTO_DE_EQUILIBRIO` dentro da tolerância)
10. Receita acima do CPK (R$ 8,00/km x CPK R$ 6,00/km → diferença R$ 2,00/km, cobertura ≈1,3333)
11. Comparação com valor mínimo abaixo (R$ 8,50/km x mínimo R$ 10,00/km, 1.000 km → diferença -R$ 1,50/km, adicional R$ 1.500,00, `ABAIXO_DO_VALOR_MINIMO`)
12. Receita acima do valor mínimo (R$ 12,00/km x mínimo R$ 10,00/km → diferença +R$ 2,00/km, `ACIMA_DO_VALOR_MINIMO`)
13. Receita por tonelada-quilômetro (R$ 10.000,00, 20 t, 500 km carregados → R$ 1,0000/t·km)
14. Lucro por tonelada-quilômetro (receita R$ 10.000,00, custo R$ 8.000,00, 20 t, 500 km → lucro R$ 2.000,00 = R$ 0,2000/t·km)
15. Múltiplas viagens com distâncias diferentes (A: R$ 1.000,00/100 km; B: R$ 9.000,00/1.000 km → consolidado R$ 10.000,00 ÷ 1.100 km ≈ R$ 9,0909/km, nunca a média simples R$ 9,50/km)
16. Múltiplos veículos (resultados individuais + consolidação ponderada + rankings por receita/km e lucro/km)
17. Receita por dia (R$ 30.000,00, 20 dias → R$ 1.500,00/dia)
18. Km por dia (10.000 km, 20 dias → 500 km/dia)
19. Receita por veículo (R$ 60.000,00, 3 veículos → R$ 20.000,00/veículo)
20. Receita média por viagem (R$ 50.000,00, 10 viagens → R$ 5.000,00/viagem)
21. Previsto x realizado (previsto R$ 10,00/km, realizado R$ 9,00/km → diferença -R$ 1,00/km, variação -10%)
22. Distância zero → falha, sem divisão por zero
23. Receita negativa → falha, campo identificado
24. Dedução negativa → falha
25. Percentual inválido (150%) → falha
26. Distância carregada maior que a total → falha
27. Distância vazia incompatível com a soma carregada+vazia → falha
28. Receita total e receitas detalhadas → sobreposição rejeitada por padrão
29. Receita líquida informada e deduções → sobreposição rejeitada por padrão
30. Custo total e CPK → sobreposição rejeitada por padrão
31. Lista de viagens e totais consolidados diretos → sobreposição rejeitada, fonte prioritária solicitada
32. Sem custo informado → calcula receita por km, não calcula lucro/margem, classificação `DADOS_INSUFICIENTES`, completude `PARCIAL`
33. Dados insuficientes (sem receita nem distância) → falha, completude `INSUFICIENTE`
34. Comparação de três fretes → rankings por receita/km, lucro/km, margem e % km vazio
35. Maior receita total, menor eficiência (fretes com receita/distância diferentes) → ranking por receita total diverge do ranking por receita/km, com alerta de que faturamento não é eficiência
36. Tolerância de ponto flutuante → ruído decimal não altera a classificação

Testes de regressão de `calcular_combustivel`, `calcular_cpk`,
`comparar_pneus`, `calcular_custo_viagem`, `calcular_margem`,
`analisar_frete` e `calcular_valor_minimo_frete` (um cenário representativo
de cada) foram reexecutados junto com os 36 de `calcular_receita_km` — todas
as 106 verificações passaram nesta rodada.

**`calcular_custo_dia`**

1. Custo mensal por dia corrido (R$ 9.000,00 ÷ 30 dias → R$ 300,00/dia)
2. Custo mensal por dia útil (R$ 9.000,00 ÷ 22 dias → ≈R$ 409,09/dia)
3. Custo mensal por dia operado (R$ 9.000,00 ÷ 20 dias → R$ 450,00/dia)
4. Custo anual rateado (R$ 12.000,00 ÷ 365 dias informados explicitamente → ≈R$ 32,88/dia)
5. Custo fixo diário (financiamento R$ 150,00 + seguro R$ 30,00 + rastreador R$ 10,00 → R$ 190,00/dia)
6. Custo variável por km (R$ 2,50/km × 400 km → R$ 1.000,00)
7. Custo variável por hora (R$ 50,00/h × 8h → R$ 400,00)
8. Custo total diário (fixo R$ 400,00 + variável R$ 800,00 → R$ 1.200,00/dia)
9. Custo por km do dia (R$ 1.200,00, 400 km → R$ 3,0000/km)
10. Custo por hora (R$ 1.200,00, 10h → R$ 120,00/h)
11. Custo de viagem por dia (R$ 6.000,00 ÷ 3 dias → R$ 2.000,00/dia)
12. Receita e lucro diário (receita R$ 1.500,00, custo R$ 1.200,00 → lucro R$ 300,00, margem 20%)
13. Prejuízo diário (receita R$ 1.000,00, custo R$ 1.200,00 → prejuízo R$ 200,00, `PREJUIZO`)
14. Ponto de equilíbrio diário sem deduções (custo R$ 1.200,00 → R$ 1.200,00)
15. Ponto de equilíbrio com dedução (custo R$ 1.200,00, 10% → ≈R$ 1.333,33)
16. Margem-alvo diária sem deduções (custo R$ 1.200,00, margem 20% → R$ 1.500,00)
17. Margem-alvo com deduções (custo R$ 1.200,00, dedução 10%, margem 20% → ≈R$ 1.714,29)
18. Veículo parado (fixo R$ 400,00 + custos específicos R$ 100,00 → R$ 500,00/dia, sem combustível/pedágio)
19. Veículo ocioso (25 dias disponíveis, 20 operados → 5 ociosos, utilização 80%, ociosidade 20%, custo fixo da ociosidade R$ 2.000,00)
20. Múltiplos veículos (A: R$ 1.000,00/400 km; B: R$ 1.500,00/600 km → total R$ 2.500,00/1.000 km = R$ 2,5000/km, sem média simples)
21. Receita por veículo (R$ 6.000,00, 3 veículos → R$ 2.000,00/veículo)
22. Motoristas (custo total R$ 600,00, 2 motoristas → R$ 300,00/motorista)
23. Ajudantes (custo total R$ 300,00, 2 ajudantes → R$ 150,00/ajudante)
24. Previsto x realizado (previsto R$ 1.200,00, realizado R$ 1.350,00 → diferença R$ 150,00, variação 12,5%)
25. Dias operados maiores que disponíveis → falha, campos identificados
26. Divisor zero (quilometragem zero no modo que exige km) → falha, sem divisão por zero
27. Custo negativo → falha, campo identificado
28. Receita negativa → falha
29. Custo total e detalhado → sobreposição rejeitada por padrão
30. Custo mensal sem base de rateio → dados insuficientes, solicita tipo de dia e divisor
31. Custo por km sem quilometragem → falha, campo `quilometragemDia` identificado
32. Custo por hora sem horas → falha
33. Percentual sobre receita sem receita → falha, solicita receita
34. Salário com encargos e encargos separados (convenção de categoria) → duplicidade detectada, rejeitada por padrão
35. CPK e custo por km → conflito detectado, fonte prioritária solicitada
36. Dados parciais (só custo total diário) → cálculo possível, completude `PARCIAL`
37. Dados insuficientes (sem custo nem divisor) → falha, completude `INSUFICIENTE`
38. Comparação de três cenários (20/22/25 dias operados) → custo por dia, custo por km, utilização e rankings separados
39. Maior custo diário, melhor eficiência (veículo com custo maior mas menor custo por km) → rankings divergem, com alerta de que custo total não é o mesmo que eficiência
40. Tolerância decimal → ruído de ponto flutuante não altera a classificação de ponto de equilíbrio

Testes de regressão de `calcular_combustivel`, `calcular_cpk`,
`comparar_pneus`, `calcular_custo_viagem`, `calcular_margem`,
`analisar_frete`, `calcular_valor_minimo_frete` e `calcular_receita_km` (um
cenário representativo de cada) foram reexecutados junto com os 40 de
`calcular_custo_dia` — todas as 92 verificações passaram nesta rodada.

**`calcular_custo_veiculo_parado`**

1. Custo fixo por três dias (R$ 400,00/dia × 3 → R$ 1.200,00)
2. Custo fixo por horas (R$ 25,00/h × 10h → R$ 250,00)
3. Custo adicional (peças R$ 2.000,00 + mão de obra R$ 800,00 + guincho R$ 500,00 → R$ 3.300,00)
4. Custo direto da parada (fixo R$ 1.200,00 + adicional R$ 3.300,00 → R$ 4.500,00)
5. Custos evitados (direto R$ 4.500,00, combustível R$ 700,00 + pedágio R$ 300,00 → evitados R$ 1.000,00, líquido R$ 3.500,00)
6. Receita não realizada por dia (R$ 2.000,00/dia × 3 → R$ 6.000,00)
7. Receita não realizada por hora (R$ 200,00/h × 10h → R$ 2.000,00)
8. Receita não realizada por viagem (R$ 5.000,00 × 2 viagens perdidas → R$ 10.000,00)
9. Receita não realizada por km (R$ 8,00/km × 1.000 km → R$ 8.000,00)
10. Lucro não realizado por margem (receita R$ 10.000,00 × 20% → R$ 2.000,00)
11. Lucro não realizado por dia (R$ 500,00/dia × 3 → R$ 1.500,00)
12. Lucro pela operação evitada (receita R$ 10.000,00 − evitados R$ 7.000,00, via calcular_margem → R$ 3.000,00)
13. Visão de caixa (adicional R$ 3.000,00 + fixo R$ 1.000,00 − evitados R$ 700,00 → R$ 3.300,00)
14. Visão econômica (líquido direto R$ 3.500,00 + lucro não realizado R$ 2.000,00 → R$ 5.500,00)
15. Custo por dia parado (impacto R$ 6.000,00 ÷ 3 dias → R$ 2.000,00/dia)
16. Custo por hora parada (impacto R$ 6.000,00 ÷ 24h → R$ 250,00/h)
17. Frota parcialmente parada (2 de 10 veículos → 20%)
18. Veículos parados maiores que a frota → falha, campos identificados
19. Custo médio por veículo (impacto total R$ 20.000,00 ÷ 4 veículos → R$ 5.000,00/veículo)
20. Veículo substituto (parada R$ 8.000,00, substituto R$ 3.000,00, receita R$ 7.000,00 → resultado R$ 4.000,00, benefício líquido R$ 12.000,00)
21. Redução do tempo parado (R$ 2.000,00/dia × 2 dias → R$ 4.000,00 indicativo)
22. Oficina mais cara e mais rápida (reparo maior + parada menor vence no custo econômico total, não no preço do reparo)
23. Previsto x realizado (2→4 dias, R$ 4.000,00→R$ 7.000,00 → +2 dias, +R$ 3.000,00, variação 75%)
24. Parada programada → classificação `PARADA_PROGRAMADA_CONTROLADA`, sem pressupor falha
25. Aguardando carga (fixo R$ 300,00 + alimentação R$ 80,00 = R$ 380,00; estadia R$ 200,00 → resultado líquido -R$ 180,00)
26. Custo total e detalhado → sobreposição rejeitada por padrão
27. Custo fixo diário e detalhado → conflito detectado, fonte prioritária solicitada
28. Receita diária e horária → sobreposição rejeitada por padrão
29. Receita perdida e lucro perdido não somados como impactos independentes no impacto econômico
30. Duração zero → falha, sem divisão por zero
31. Custo negativo → falha, campo identificado
32. Receita negativa → falha
33. Margem inválida (150%) → falha
34. Custo de oportunidade sem alternativa informada → não calculado, `NAO_AVALIADO`
35. Sem receita informada → calcula custo direto, não calcula receita/lucro, completude `PARCIAL`
36. Dados insuficientes (sem duração nem custo) → falha, completude `INSUFICIENTE`
37. Múltiplos veículos com durações diferentes → consolidação, impacto total, custo médio ponderado por hora, ranking
38. Maior receita perdida, menor lucro perdido (dois veículos com receitas/margens diferentes) → rankings de receita e lucro não realizados divergem
39. Custos evitados maiores que o custo direto → alerta, líquido direto negativo, sem classificar como lucro
40. Tolerância decimal → cálculo com ruído de ponto flutuante não gera erro

Testes de regressão de `calcular_combustivel`, `calcular_cpk`,
`comparar_pneus`, `calcular_custo_viagem`, `calcular_margem`,
`analisar_frete`, `calcular_valor_minimo_frete`, `calcular_receita_km` e
`calcular_custo_dia` (um cenário representativo de cada) foram reexecutados
junto com os 40 de `calcular_custo_veiculo_parado` — todas as 91
verificações passaram nesta rodada.

## Futura integração com IA (Claude)

Este repositório está na Fase 1 (scaffold de frontend): **ainda não existe**
nenhuma integração com a API do Claude (`src/services/aiService.ts` apenas
lança `Error(... Fase 2 ...)`, não há rota `/api/chat`, não há SDK da
Anthropic instalado). Por isso, `calcular_combustivel`, `calcular_cpk`,
`comparar_pneus`, `calcular_custo_viagem`, `calcular_margem`,
`analisar_frete`, `calcular_valor_minimo_frete`, `calcular_receita_km`,
`calcular_custo_dia` e `calcular_custo_veiculo_parado` estão registradas
aqui em `FERRAMENTAS_FROTA_IA` (`index.ts`), mas ainda **não estão**
conectadas a nenhum loop de tool use real.

Quando essa conexão existir, `analisar_frete` é a ferramenta esperada para
perguntas como "Este frete compensa?", "Vale a pena pegar essa carga?",
"Quanto vai sobrar?", "Esse valor cobre meus custos?", "Qual é a margem?",
"Quanto vou ganhar por km?", "O retorno vazio prejudica muito?", "Quanto
preciso cobrar?", "Qual proposta é melhor?", "Preciso de quanto de capital
de giro?", "Esse prazo de pagamento vale a pena?" e "Esse frete está dando
prejuízo?"; e `calcular_valor_minimo_frete` é a ferramenta esperada para
perguntas como "Quanto preciso cobrar neste frete?", "Qual é o valor
mínimo?", "Quanto cobrar para não ter prejuízo?", "Quanto cobrar para ter
20% de margem?", "Qual valor por quilômetro devo pedir?", "Quanto cobrar
por tonelada?", "Quanto cobrar considerando a volta vazia?", "O valor
oferecido cobre meus custos?", "Quanto falta para este frete compensar?",
"Posso dar desconto?", "Qual é meu limite de negociação?", "Quanto devo
cobrar com imposto e comissão?", "Qual valor mínimo para três caminhões?" e
"Quanto cobrar com pagamento em 30 dias?"; e `calcular_receita_km` é a
ferramenta esperada para perguntas como "Quanto estou recebendo por
quilômetro?", "Qual é minha receita líquida por km?", "Quanto sobra por
quilômetro?", "Meu valor por km cobre meu CPK?", "Quanto preciso receber
por km para atingir minha margem?", "Quanto o retorno vazio reduz minha
receita por km?", "Qual rota paga melhor por quilômetro?", "Qual frete
gera maior lucro por km?", "Quanto faturei por km no mês?", "Minha receita
por km prevista foi atingida?", "Quanto recebo por km carregado e por km
total?" e "Qual veículo gera maior receita por km?"; e `calcular_custo_dia`
é a ferramenta esperada para perguntas como "Quanto custa meu caminhão por
dia?", "Qual é meu custo fixo diário?", "Quanto custa minha frota por
dia?", "Quanto custa um veículo parado?", "Quanto custa um dia operado?",
"Quanto custa um dia útil?", "Quanto custa um dia de viagem?", "Quanto
preciso faturar por dia?", "Quanto preciso faturar para ter 20% de
margem?", "Quanto sobra por dia?", "Qual veículo custa mais por dia?",
"Qual veículo tem menor custo por km?", "Quanto a ociosidade está me
custando?", "Qual foi meu custo diário no mês?" e "Meu custo diário
realizado ficou acima do previsto?"; e `calcular_custo_veiculo_parado` é a
ferramenta esperada para perguntas como "Quanto meu caminhão parado está
me custando?", "Quanto custa um dia parado?", "Quanto custa uma hora
parado?", "Quanto perdi com o caminhão na oficina?", "Quanto deixei de
faturar?", "Quanto deixei de lucrar?", "Quanto custa esperar uma peça?",
"Vale a pena pagar mais para a peça chegar antes?", "Vale a pena alugar
outro caminhão?", "Quanto posso gastar para reduzir a parada?", "Qual
oficina fica mais barata considerando o tempo parado?", "Quanto a frota
parada está me custando?", "Qual veículo parado tem maior impacto?",
"Quanto custa aguardar carga?", "Quanto custa aguardar descarga?", "Quanto
tempo vou precisar trabalhar para recuperar a perda?", "O custo realizado
ficou acima do previsto?" e "É melhor reparar ou substituir?" — em todos os
casos o modelo deve pedir apenas os dados faltantes (via `dadosFaltantes`),
nunca inventar distância, consumo, combustível, pedágio, retorno, custos,
impostos, comissão, margem, markup, prazo, carga, peso, quantidade, valor
oferecido, CPK, valor mínimo, período, salário, encargos, financiamento,
seguro, quilometragem, dias, horas, quantidade de veículos/pessoas, prazo
de peça/oficina, custo de substituto, custo de oportunidade,
responsabilidade ou cobertura de seguro.

Quando a Fase 2 (integração com Claude) for implementada, o trabalho
restante é:

1. Gerar o `input_schema` (JSON Schema) de cada ferramenta a partir de
   `parametros`, no formato exigido pela API de tool use da Anthropic.
2. No loop de chamadas ao Claude, quando `stop_reason === "tool_use"`,
   despachar para `ferramenta.executar(input)` usando o `nome` recebido.
3. Garantir que o Claude só chame uma ferramenta depois de ter todos os
   campos obrigatórios — e, quando não tiver, que ele pergunte ao usuário em
   vez de adivinhar (o próprio retorno de `dadosFaltantes` foi desenhado
   para alimentar essa pergunta).

## Futura integração com Supabase

Ainda não há Supabase neste projeto. Quando existir, o uso esperado é:

- Buscar dados cadastrados do veículo (capacidade do tanque, consumo médio
  histórico) para pré-preencher parâmetros em vez de perguntar tudo de novo.
- Registrar o histórico de abastecimentos/viagens para alimentar
  `CONSUMO_REAL` e `COMPARACAO_PREVISTO_REALIZADO` sem exigir que o usuário
  digite hodômetro e litros manualmente toda vez.
- Buscar o histórico de custos do veículo (pneus, manutenções, seguros etc.)
  para pré-preencher `calcular_cpk` por período, em vez de o usuário digitar
  cada custo a cada pergunta.
- Buscar o histórico de compras/recapagens de pneus (marca, modelo, custo,
  quilometragem realizada) para pré-preencher `comparar_pneus`, e registrar
  o resultado realizado de cada pneu para refinar comparações futuras.
- Buscar viagens anteriores (rota, distância, custos por categoria) para
  pré-preencher `calcular_custo_viagem`, e registrar o resultado realizado
  de cada viagem para alimentar `COMPARACAO_PREVISTO_REALIZADO`
  automaticamente em vez de exigir os dois blocos digitados na hora.
- Buscar fretes/contratos anteriores (receita, impostos e comissões
  praticados) para pré-preencher `calcular_margem`, e registrar o
  resultado realizado de cada operação para alimentar seu
  `PREVISTO_X_REALIZADO` automaticamente.
- Buscar propostas de frete recebidas (de um cadastro de clientes/cargas ou
  de uma plataforma de frete integrada) para pré-preencher
  `analisar_frete` em `COMPARACAO_PROPOSTAS`, histórico de pagamento por
  cliente (prazo médio praticado, inadimplência) para enriquecer — nunca
  substituir — a análise de prazo e risco de cliente, e o resultado
  realizado de cada frete para alimentar seu `PREVISTO_X_REALIZADO`
  automaticamente.
- Nenhuma ferramenta desta pasta deve acessar o Supabase diretamente — a
  busca de dados deve acontecer antes, na camada que monta a `entrada` da
  ferramenta, mantendo os cálculos puros e testáveis.
- Buscar propostas de frete recebidas (para pré-preencher `cenarios` em
  `calcular_valor_minimo_frete` no modo `COMPARACAO_CENARIOS`), o histórico
  de pagamento por cliente (prazo médio praticado, inadimplência) para
  enriquecer — nunca substituir — a comparação com a oferta, e o resultado
  realizado de cada frete negociado para refinar, no futuro, os limites de
  classificação da oferta.
- Buscar histórico de viagens e veículos para pré-preencher `viagens`/
  `veiculos` em `calcular_receita_km` (`MULTIPLAS_VIAGENS`/
  `MULTIPLOS_VEICULOS`) sem exigir digitação manual de cada registro,
  receita por cliente e por rota para alimentar `COMPARACAO_CENARIOS`, e
  metas por veículo/motorista para contextualizar (nunca substituir) a
  classificação da receita por km.
- Buscar o cadastro de custos fixos do veículo (financiamento, seguro,
  licenciamento, IPVA) para pré-preencher `custosFixos` em
  `calcular_custo_dia`, o histórico de dias operados/parados/ociosos por
  veículo para alimentar `MULTIPLOS_VEICULOS`/`ANALISE_POR_PERIODO`
  automaticamente, e a folha de pagamento para `custoTotalMotoristas`/
  `custoTotalAjudantes` — sempre como sugestão a confirmar.
- Buscar histórico de manutenções/oficinas/peças e prazos reais de reparo
  para pré-preencher `custoReparoInformado`/`diasParados` em
  `calcular_custo_veiculo_parado`, o histórico de paradas por veículo para
  `MULTIPLOS_VEICULOS`, e receita/margem média real por veículo/rota para
  `receitaMediaDia`/`margemMediaPercentual` — sempre como sugestão a
  confirmar, nunca assumida.

## Integração com Google Routes / ANTT / ANP / Clima / Pedágios / dados de fabricantes

Fora de escopo nesta fase. Quando chegar a hora: essas integrações também
devem alimentar a `entrada` de uma ferramenta existente (ex.: distância via
Google Routes viraria `distanciaKm`), e não misturar chamadas de rede dentro
da lógica de cálculo em si. Para `comparar_pneus` especificamente, uma
futura API de fabricantes ou banco de preços poderia sugerir
`custoAquisicao`/`quilometragemPrevista` como ponto de partida, mas a
ferramenta continuaria exigindo que esses valores sejam confirmados —
nunca assumidos — antes de entrar no cálculo. O mesmo vale para
compatibilidade técnica (medida, índice de carga/velocidade): um banco
técnico de fabricantes futuramente poderia validar isso automaticamente,
mas hoje a ferramenta apenas alerta que essa validação não foi feita.
Para `calcular_custo_viagem`: Google Routes/Maps forneceria `distanciaIdaKm`/
`distanciaVoltaKm` (a ferramenta continuaria não calculando distância
sozinha), uma API de pedágios preencheria `pedagios.pracas` automaticamente
para a rota informada, a ANP poderia sugerir `precoCombustivelLitro` por
região, e um cartão-combustível/rastreador poderia alimentar
`custoCombustivelInformado`/`distanciaVoltaKm` realizados direto no bloco
`realizado` de `COMPARACAO_PREVISTO_REALIZADO`. Nenhuma dessas integrações
foi implementada; só os tipos e pontos de entrada (campos opcionais) já
suportam recebê-las sem quebrar a API atual. Para `calcular_margem`: um
sistema financeiro/ERP ou emissão fiscal poderia fornecer
`aliquotaImpostosPercentual` real por regime tributário e `comissoes`
efetivas por cliente/contrato, e uma plataforma de frete poderia alimentar
`receitaBruta` direto a partir do valor negociado — sempre como sugestão
a confirmar, nunca assumida silenciosamente. Para `analisar_frete`: uma
plataforma de frete (ex.: agenciadores de carga) poderia alimentar
`valorFreteTotal`/`distanciaIdaKm`/`prazoPagamentoDias` de uma proposta
recebida, ANTT/ANP poderiam sugerir valores de referência de frete e preço
de diesel por região para contextualizar (nunca substituir) a análise, e um
cadastro de clientes/histórico de pagamentos poderia sugerir
`riscoClienteNivel` — sempre como dado a confirmar explicitamente, já que
esta ferramenta nunca infere risco do nome do cliente. Nenhuma dessas
integrações foi implementada; só os tipos e pontos de entrada já suportam
recebê-las sem quebrar a API atual. Para `calcular_valor_minimo_frete`: uma
plataforma de frete poderia sugerir `valorFreteOferecido` direto de uma
proposta recebida, ANTT/ANP poderiam sugerir valores de referência de frete
e preço de diesel por região para contextualizar (nunca substituir) o valor
mínimo calculado, e um sistema financeiro/ERP poderia fornecer a taxa real
de custo de capital da transportadora — sempre como sugestão a confirmar,
nunca assumida silenciosamente. Nenhuma dessas integrações foi implementada;
só os tipos e pontos de entrada já suportam recebê-las sem quebrar a API
atual. Para `calcular_receita_km`: telemetria/rastreador e hodômetro
automático poderiam alimentar `distanciaTotalKm`/`distanciaCarregadaKm`/
`distanciaVaziaKm` realizados de cada viagem, um ERP/sistema financeiro
poderia fornecer `receitaBruta`/deduções efetivas por frete, e um dashboard
gerencial poderia consumir `consolidadoViagens`/`consolidadoVeiculos`
diretamente — sempre como dado a confirmar, nunca assumido. Nenhuma dessas
integrações foi implementada; só os tipos e pontos de entrada já suportam
recebê-las sem quebrar a API atual. Para `calcular_custo_dia`: a futura
`calcular-custo-veiculo-parado.ts` alimentaria `resumoCustoVeiculoParado`
(ponto de extensão já criado, desacoplado); `calcular-jornada.ts` poderia
sugerir `horasOperadasDia`/`diasOperadosPeriodo` a partir da jornada real
do motorista; um ERP/folha de pagamento poderia fornecer
`custoTotalMotoristas`/`custoTotalAjudantes` efetivos; e telemetria/
rastreador poderiam alimentar `quilometragemDia` realizada — sempre como
sugestão a confirmar, nunca assumida silenciosamente. Nenhuma dessas
integrações foi implementada; só os tipos e pontos de entrada já suportam
recebê-las sem quebrar a API atual. Para `calcular_custo_veiculo_parado`:
oficinas/fornecedores de peças poderiam alimentar `custoReparoInformado`/
prazos reais; um sistema de manutenção forneceria MTBF/MTTR e SLA por
oficina para contextualizar (nunca decidir) a comparação de alternativas;
telemetria/rastreador poderiam sinalizar automaticamente o início/fim da
parada (`dataInicio`/`dataFim`); e um painel de disponibilidade de frota
poderia consumir `consolidadoVeiculos` diretamente — sempre como dado a
confirmar, nunca assumido. Nenhuma dessas integrações foi implementada; só
os tipos e pontos de entrada já suportam recebê-las sem quebrar a API
atual.
