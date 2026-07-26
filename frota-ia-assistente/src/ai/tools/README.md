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
| `analisar_frete` | `analisar-frete.ts` | Estrutura apenas |
| `calcular_valor_minimo_frete` | `calcular-valor-minimo-frete.ts` | Estrutura apenas |
| `calcular_receita_km` | `calcular-receita-km.ts` | Estrutura apenas |
| `calcular_custo_dia` | `calcular-custo-dia.ts` | Estrutura apenas |
| `calcular_custo_veiculo_parado` | `calcular-custo-veiculo-parado.ts` | Estrutura apenas |
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

## Futura integração com IA (Claude)

Este repositório está na Fase 1 (scaffold de frontend): **ainda não existe**
nenhuma integração com a API do Claude (`src/services/aiService.ts` apenas
lança `Error(... Fase 2 ...)`, não há rota `/api/chat`, não há SDK da
Anthropic instalado). Por isso, `calcular_combustivel`, `calcular_cpk`,
`comparar_pneus`, `calcular_custo_viagem` e `calcular_margem` estão
registradas aqui em `FERRAMENTAS_FROTA_IA` (`index.ts`), mas ainda **não
estão** conectadas a nenhum loop de tool use real.

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
- Nenhuma ferramenta desta pasta deve acessar o Supabase diretamente — a
  busca de dados deve acontecer antes, na camada que monta a `entrada` da
  ferramenta, mantendo os cálculos puros e testáveis.

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
a confirmar, nunca assumida silenciosamente.
