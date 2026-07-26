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
| `analisar_frete` | `analisar-frete.ts` | Estrutura apenas |
| `comparar_pneus` | `comparar-pneus.ts` | Estrutura apenas |
| `calcular_custo_viagem` | `calcular-custo-viagem.ts` | Estrutura apenas |
| `calcular_margem` | `calcular-margem.ts` | Estrutura apenas |
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

## Helpers compartilhados (`utils.ts`)

`arredondar`, `formatarBRL`, `formatarNumero` e `CASAS_DECIMAIS_PADRAO` vivem
em `utils.ts` e são usados por `calcular-combustivel.ts` e `calcular-cpk.ts`.
Novas ferramentas que precisarem de arredondamento/formatação devem importar
daqui em vez de duplicar as funções.

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

## Futura integração com IA (Claude)

Este repositório está na Fase 1 (scaffold de frontend): **ainda não existe**
nenhuma integração com a API do Claude (`src/services/aiService.ts` apenas
lança `Error(... Fase 2 ...)`, não há rota `/api/chat`, não há SDK da
Anthropic instalado). Por isso, `calcular_combustivel` e `calcular_cpk` estão
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
- Nenhuma ferramenta desta pasta deve acessar o Supabase diretamente — a
  busca de dados deve acontecer antes, na camada que monta a `entrada` da
  ferramenta, mantendo os cálculos puros e testáveis.

## Integração com Google Routes / ANTT / ANP / Clima / Pedágios

Fora de escopo nesta fase. Quando chegar a hora: essas integrações também
devem alimentar a `entrada` de uma ferramenta existente (ex.: distância via
Google Routes viraria `distanciaKm`), e não misturar chamadas de rede dentro
da lógica de cálculo em si.
