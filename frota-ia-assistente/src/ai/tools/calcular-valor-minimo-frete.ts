import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, EstrategiaSobreposicao, NivelCompletude, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO, CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";
import { CASAS_DECIMAIS_DISTANCIA_PADRAO, CASAS_DECIMAIS_PESO_PADRAO } from "./calcular-custo-viagem";
import { resolverValorOuAliquota } from "./calcular-margem";
import type { ResumoCustoViagem } from "./calcular-margem";
import { calcularCpk } from "./calcular-cpk";
import type { EstrategiaSobreposicaoDeducao } from "./analisar-frete";

/**
 * Ferramenta: calcular_valor_minimo_frete
 *
 * Calcula o valor econômico mínimo que um frete precisa pagar para cobrir os
 * custos informados, atingir o ponto de equilíbrio, uma margem-alvo, um
 * markup-alvo ou um lucro fixo desejado — sempre a partir exclusivamente dos
 * dados recebidos, nunca de uma tabela de preço mínimo legal/oficial (essa
 * distinção é sempre reforçada nos alertas e limitações do resultado).
 *
 * Atua como coordenadora: reutiliza `resolverValorOuAliquota` (exportada por
 * `calcular-margem.ts`) para resolver, campo a campo, cada par valor-fixo x
 * percentual (imposto, comissão, taxa de plataforma, outras deduções, custo
 * de capital, adicional de risco) sem duplicar a lógica de detecção de
 * sobreposição; e reutiliza `calcularCpk` (`calcular-cpk.ts`, modo
 * `CPK_PNEUS` como divisor genérico valor ÷ km) para toda divisão que nunca
 * pode ser negativa (valor mínimo por km, por km carregado, por tonelada,
 * por tonelada-km, por unidade, por veículo, por viagem).
 *
 * As equações de ponto de equilíbrio/margem-alvo/markup-alvo/lucro-fixo desta
 * ferramenta são uma generalização das equações equivalentes de
 * `calcular-margem.ts` (que resolve apenas 2 deduções percentuais — imposto e
 * comissão — hardcoded). Como este cálculo precisa somar até 5 deduções
 * percentuais independentes (imposto, comissão, taxa de plataforma, outras
 * deduções, custo de capital), as fórmulas de denominador são reimplementadas
 * aqui de forma genérica — não são cópia das de `calcular-margem.ts`, mas
 * produzem o mesmo resultado quando só imposto/comissão são usados.
 *
 * Aceita o custo de uma viagem já calculado por `calcular-custo-viagem.ts`
 * via `resumoCustoViagem` (mesma interface reexportada por
 * `calcular-margem.ts`), o CPK de `calcular-cpk.ts` via `resumoCpk` (ou
 * `cpkTotalReaisPorKm` direto) multiplicado pela distância total, e um
 * resumo normalizado e desacoplado de `analisar-frete.ts` via
 * `resumoAnaliseFrete` — sem importar aquele módulo, para não criar
 * dependência circular (`analisar-frete.ts` poderia um dia precisar do valor
 * mínimo desta ferramenta).
 *
 * Sem APIs externas nesta fase. Nunca assume distância, consumo, imposto,
 * comissão, margem, prazo ou preço de diesel não informados — nunca declara
 * um preço mínimo "legal" ou "oficial" sem uma fonte e integração
 * correspondente.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

const CASAS_DECIMAIS_TONELADA_PADRAO = 2;
const CASAS_DECIMAIS_TONELADA_KM_PADRAO = 4;

/** Tolerância padrão (em % do valor mínimo) para não tratar ruído de ponto flutuante como oferta acima/abaixo da meta. */
const TOLERANCIA_CLASSIFICACAO_OFERTA_PERCENTUAL_PADRAO = 0.5;

const LIMITACOES_PADRAO: string[] = [
  '"Valor mínimo" aqui significa exclusivamente o piso econômico calculado a partir dos dados informados — nunca um piso legal, oficial ou de mercado. Não há integração com tabelas oficiais de frete, ANTT ou plataformas nesta fase.',
  "Quando o modo não determina uma única meta de preço (ex.: VALOR_MINIMO_POR_KM sem margem/markup/lucro definidos), a prioridade usada é: margem-alvo > markup-alvo > lucro fixo desejado > ponto de equilíbrio.",
  'Os percentuais de dedução (imposto, comissão, taxa de plataforma, outras deduções, custo de capital) são sempre considerados sobre a receita bruta calculada, salvo indicação contrária em "baseCalculoPercentuais" — bases diferentes (RECEITA_APOS_IMPOSTOS, RECEITA_LIQUIDA, VALOR_FIXO) ainda não têm equação fechada implementada nesta fase e caem de volta para RECEITA_BRUTA, com alerta.',
  'O critério de rateio de receita entre ida e volta ("criterioRateioReceitaRetorno") só tem cálculo fechado para NAO_RATEAR, POR_CUSTO_DO_TRECHO, POR_DISTANCIA e MANUAL; POR_PESO cai de volta para NAO_RATEAR por falta de peso separado por trecho na entrada.',
  "Esta ferramenta não calcula tributos, comissões, pedágios ou combustível automaticamente — todos os valores vêm do que foi informado.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoValorMinimoFrete =
  | "PONTO_EQUILIBRIO"
  | "MARGEM_ALVO"
  | "MARKUP_ALVO"
  | "LUCRO_FIXO_ALVO"
  | "VALOR_MINIMO_POR_VIAGEM"
  | "VALOR_MINIMO_POR_KM"
  | "VALOR_MINIMO_POR_KM_CARREGADO"
  | "VALOR_MINIMO_POR_TONELADA"
  | "VALOR_MINIMO_TONELADA_KM"
  | "VALOR_MINIMO_POR_UNIDADE"
  | "IDA_E_VOLTA"
  | "RETORNO_VAZIO"
  | "FRETE_COM_RETORNO"
  | "MULTIPLOS_VEICULOS"
  | "COMPARAR_COM_OFERTA"
  | "COMPARACAO_CENARIOS";

/**
 * Reaproveita o tipo `EstrategiaSobreposicaoDeducao` já exportado por
 * `analisar-frete.ts` (mesmo conceito: conflito entre valor fixo e
 * percentual para uma dedução) em vez de declarar um tipo idêntico aqui —
 * evita colisão de nomes no `export *` de `index.ts` e não duplica a
 * definição. É um import só de tipo, sem risco de dependência circular
 * (`analisar-frete.ts` não importa nada deste módulo).
 *
 * Mapeada internamente para `EstrategiaSobreposicao` (a de `types.ts`) via
 * `paraEstrategiaCusto()`, para reutilizar `resolverValorOuAliquota` sem
 * duplicar a lógica de resolução.
 */
function paraEstrategiaCusto(estrategia: EstrategiaSobreposicaoDeducao): EstrategiaSobreposicao {
  if (estrategia === "PRIORIZAR_VALOR_FIXO") return "PRIORIZAR_TOTAL";
  if (estrategia === "PRIORIZAR_PERCENTUAL") return "PRIORIZAR_DETALHADO";
  return "REJEITAR_SOBREPOSICAO";
}

export type BaseCalculoPercentuais = "RECEITA_BRUTA" | "RECEITA_APOS_IMPOSTOS" | "RECEITA_LIQUIDA" | "CUSTO_TOTAL" | "VALOR_FIXO";

export type InterpretacaoAdicionalRisco = "SOBRE_CUSTO" | "SOBRE_VALOR_MINIMO" | "SOBRE_RECEITA";

export type MetodoCustoCapital = "VALOR_FIXO" | "JUROS_SIMPLES" | "JUROS_COMPOSTOS" | "PERCENTUAL_DIRETO";

export type CriterioRateioReceitaRetorno = "POR_CUSTO_DO_TRECHO" | "POR_DISTANCIA" | "POR_PESO" | "MANUAL" | "NAO_RATEAR";

export type RegraArredondamentoComercial =
  | "SEM_ARREDONDAMENTO"
  | "PROXIMO_REAL"
  | "PROXIMO_5"
  | "PROXIMO_10"
  | "PROXIMO_50"
  | "PROXIMO_100"
  | "SEMPRE_PARA_CIMA";

/**
 * Resumo estruturalmente compatível com `ResultadosCpk` de `calcular-cpk.ts`
 * — não importa o tipo de lá para manter as ferramentas desacopladas.
 */
export interface ResumoCpkParaCusto {
  cpk?: number;
}

/**
 * Resumo normalizado e desacoplado do resultado de `analisar-frete.ts` —
 * não importa `ResultadoIndividualFrete` de lá para evitar dependência
 * circular (aquela ferramenta pode um dia precisar consumir o valor mínimo
 * calculado aqui). Qualquer objeto com este formato serve, inclusive o
 * resultado completo de `analisar_frete` (estruturalmente compatível).
 */
export interface ResumoAnaliseFreteParaCusto {
  custoTotal?: number;
  distanciaTotalKm?: number;
}

/**
 * Conjunto completo de dados usado tanto pelo cálculo direto (a própria
 * entrada) quanto por cada cenário em `COMPARACAO_CENARIOS`.
 */
export interface DadosValorMinimoVariante {
  identificacao?: string;
  descricao?: string;
  origem?: string;
  destino?: string;
  tipoCarga?: string;

  distanciaIdaKm?: number;
  distanciaVoltaKm?: number;
  distanciaAdicionalKm?: number;
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;

  pesoCargaToneladas?: number;
  quantidadeCarga?: number;
  unidadeCarga?: string;
  quantidadeVeiculos?: number;
  quantidadeViagens?: number;

  /** Alternativa 1: custo total já pronto (interpretado como custo POR VEÍCULO em MULTIPLOS_VEICULOS). */
  custoTotal?: number;
  /** Alternativa 1b: custo separado por trecho (ida/volta ou retorno vazio). */
  custoIda?: number;
  custoVolta?: number;
  /** Alternativa 2: categorias detalhadas. */
  custosVariaveis?: number;
  custosFixosRateados?: number;
  custosDiretos?: number;
  custosIndiretos?: number;
  custosAdministrativos?: number;
  outrosCustos?: number;
  /** Alternativa 3: resultado resumido de `calcular-custo-viagem.ts`. */
  resumoCustoViagem?: ResumoCustoViagem;
  /** Alternativa 4: CPK total (R$/km) informado direto, multiplicado por `distanciaTotalKm`. */
  cpkTotalReaisPorKm?: number;
  /** Alternativa 5: resultado resumido de `calcular-cpk.ts`, multiplicado por `distanciaTotalKm`. */
  resumoCpk?: ResumoCpkParaCusto;
  /** Alternativa 6: resultado normalizado de `analisar-frete.ts`. */
  resumoAnaliseFrete?: ResumoAnaliseFreteParaCusto;

  lucroFixoDesejado?: number;
  margemAlvoPercentual?: number;
  markupAlvoPercentual?: number;

  impostoValor?: number;
  impostoPercentual?: number;
  comissaoValor?: number;
  comissaoPercentual?: number;
  taxaPlataformaValor?: number;
  taxaPlataformaPercentual?: number;
  outrasDeducoesValor?: number;
  outrasDeducoesPercentual?: number;
  adicionalRiscoValor?: number;
  adicionalRiscoPercentual?: number;
  /** Interpretação obrigatória quando `adicionalRiscoPercentual` for usado — nunca assumida. */
  interpretacaoAdicionalRisco?: InterpretacaoAdicionalRisco;
  custoCapitalValor?: number;
  custoCapitalPercentual?: number;

  /** Ativa o sub-cálculo de custo de capital (JUROS_SIMPLES/JUROS_COMPOSTOS/PERCENTUAL_DIRETO) descrito em "PRAZO E CUSTO DE CAPITAL". Não usar junto de `custoCapitalValor`/`custoCapitalPercentual` diretos. */
  capitalEmpregadoValor?: number;
  custoCapitalMetodo?: MetodoCustoCapital;
  /** Taxa por período, em %; reaproveita `custoCapitalPercentual` como a taxa quando `custoCapitalMetodo` está definido. */
  custoCapitalPeriodos?: number;

  valorFreteOferecido?: number;
  /** Preço inicial de negociação, para o cálculo de desconto máximo (formula 22); usa `valorFreteOferecido` como fallback quando ausente. */
  precoInicialNegociacao?: number;
  receitaRetorno?: number;
  criterioRateioReceitaRetorno?: CriterioRateioReceitaRetorno;
  /** Usado apenas quando `criterioRateioReceitaRetorno` é MANUAL: parte da receita de retorno alocada à ida. */
  valorRateioManualIda?: number;

  prazoPagamentoDias?: number;
  adiantamento?: number;
}

export interface CenarioValorMinimoFrete extends DadosValorMinimoVariante {
  id?: string;
  nome?: string;
}

export interface CalcularValorMinimoFreteEntrada extends DadosValorMinimoVariante {
  modo: ModoValorMinimoFrete;

  /** Usado apenas em COMPARACAO_CENARIOS — ao menos 2 cenários. */
  cenarios?: CenarioValorMinimoFrete[];

  estrategiaSobreposicaoCusto?: EstrategiaSobreposicao;
  estrategiaSobreposicaoDeducao?: EstrategiaSobreposicaoDeducao;
  baseCalculoPercentuais?: BaseCalculoPercentuais;
  arredondamentoComercial?: RegraArredondamentoComercial;
  toleranciaClassificacaoOfertaPercentual?: number;

  casasDecimais?: number;
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type ClassificacaoOfertaFrete =
  | "ABAIXO_DO_CUSTO"
  | "NO_PONTO_DE_EQUILIBRIO"
  | "ABAIXO_DA_MARGEM_ALVO"
  | "ATENDE_MARGEM_ALVO"
  | "ACIMA_DA_MARGEM_ALVO"
  | "DADOS_INSUFICIENTES";

export interface ImpactoRetornoVazioMinimo {
  custoIda?: number;
  custoRetorno?: number;
  custoTotal?: number;
  percentualCustoRetorno?: number;
  valorMinimoComRetorno?: number;
  valorMinimoSemRetorno?: number;
  diferencaAbsoluta?: number;
  diferencaPercentual?: number;
  impactoPorKm?: number;
}

export interface ItemRankingValorMinimo {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface ResultadoCenarioValorMinimo extends ResultadoFerramentaBase {
  id: string;
  nome: string;
  custoTotalBase?: number;
  baseFinanceira?: number;
  valorMinimoPrincipal?: number;
  margemLiquidaPercentual?: number;
  valorMinimoPorKm?: number;
  valorMinimoPorVeiculo?: number;
  capitalGiroCalculado?: number;
  impactoRetornoVazio?: ImpactoRetornoVazioMinimo;
  nivelCompletude: NivelCompletude;
}

export interface ComparacaoCenariosValorMinimo {
  cenarios: ResultadoCenarioValorMinimo[];
  rankingPorMenorValorMinimo: ItemRankingValorMinimo[];
  rankingPorMaiorMargem: ItemRankingValorMinimo[];
  rankingPorMenorCustoTotal: ItemRankingValorMinimo[];
  rankingPorMenorImpactoRetornoVazio: ItemRankingValorMinimo[];
  alertas: string[];
}

export interface CalcularValorMinimoFreteResultado extends ResultadoFerramentaBase {
  modo: ModoValorMinimoFrete;
  identificacao?: string;
  descricao?: string;

  custoTotalBase?: number;
  custosFixosAdicionais?: number;
  baseFinanceira?: number;
  percentualTotalDeducoes?: number;

  valorPontoEquilibrio?: number;

  margemAlvoPercentual?: number;
  valorMinimoComMargem?: number;

  markupAlvoPercentual?: number;
  valorMinimoComMarkup?: number;

  lucroFixoDesejado?: number;
  valorMinimoComLucroFixo?: number;

  valorMinimoExato?: number;
  valorMinimoComercial?: number;
  impactoArredondamento?: number;

  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;

  valorMinimoPorKm?: number;
  valorMinimoPorKmCarregado?: number;
  valorMinimoPorTonelada?: number;
  valorMinimoToneladaKm?: number;
  valorMinimoPorUnidade?: number;
  valorMinimoPorVeiculo?: number;
  valorMinimoPorViagem?: number;

  custoRetorno?: number;
  impactoRetornoVazio?: ImpactoRetornoVazioMinimo;

  receitaRetorno?: number;
  valorNecessarioNaIda?: number;

  valorFreteOferecido?: number;
  diferencaOferta?: number;
  percentualDiferencaOferta?: number;
  valorAdicionalNecessario?: number;
  descontoMaximo?: number;
  lucroEstimadoNaOferta?: number;
  margemEstimadaNaOferta?: number;
  classificacaoOferta?: ClassificacaoOfertaFrete;

  comparacaoCenarios?: ComparacaoCenariosValorMinimo;

  nivelCompletude: NivelCompletude;
  custosIncluidos: string[];
  custosIgnorados: string[];
  deducoesIncluidas: string[];
  deducoesIgnoradas: string[];
  limitacoes: string[];
  memoriaCalculo: string[];
}

// ---------------------------------------------------------------------------
// Casas decimais
// ---------------------------------------------------------------------------

interface CasasDecimaisValorMinimo {
  moeda: number;
  percentual: number;
  custoPorKm: number;
  tonelada: number;
  toneladaKm: number;
  distancia: number;
  peso: number;
}

function casasDecimaisDe(entrada: CalcularValorMinimoFreteEntrada): CasasDecimaisValorMinimo {
  const override = entrada.casasDecimais;
  return {
    moeda: override ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    percentual: override ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    custoPorKm: override ?? CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO,
    tonelada: override ?? CASAS_DECIMAIS_TONELADA_PADRAO,
    toneladaKm: override ?? CASAS_DECIMAIS_TONELADA_KM_PADRAO,
    distancia: override ?? CASAS_DECIMAIS_DISTANCIA_PADRAO,
    peso: override ?? CASAS_DECIMAIS_PESO_PADRAO,
  };
}

// ---------------------------------------------------------------------------
// Delegação a calcular-cpk.ts (divisões que nunca são negativas)
// ---------------------------------------------------------------------------

function dividirViaCpk(valor: number, divisor: number, casas: number): number | undefined {
  if (divisor <= 0) return undefined;
  const resultado = calcularCpk({
    modo: "CPK_PNEUS",
    custoPneus: valor,
    quilometragem: divisor,
    arredondamentoCasasDecimais: casas,
  });
  return resultado.sucesso ? resultado.resultados.cpk : undefined;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function coletarCamposNumericos(v: DadosValorMinimoVariante, rotulo: string): Array<[string, number | undefined]> {
  return [
    [`${rotulo}.distanciaIdaKm`, v.distanciaIdaKm],
    [`${rotulo}.distanciaVoltaKm`, v.distanciaVoltaKm],
    [`${rotulo}.distanciaAdicionalKm`, v.distanciaAdicionalKm],
    [`${rotulo}.distanciaTotalKm`, v.distanciaTotalKm],
    [`${rotulo}.distanciaCarregadaKm`, v.distanciaCarregadaKm],
    [`${rotulo}.distanciaVaziaKm`, v.distanciaVaziaKm],
    [`${rotulo}.pesoCargaToneladas`, v.pesoCargaToneladas],
    [`${rotulo}.quantidadeCarga`, v.quantidadeCarga],
    [`${rotulo}.quantidadeVeiculos`, v.quantidadeVeiculos],
    [`${rotulo}.quantidadeViagens`, v.quantidadeViagens],
    [`${rotulo}.custoTotal`, v.custoTotal],
    [`${rotulo}.custoIda`, v.custoIda],
    [`${rotulo}.custoVolta`, v.custoVolta],
    [`${rotulo}.custosVariaveis`, v.custosVariaveis],
    [`${rotulo}.custosFixosRateados`, v.custosFixosRateados],
    [`${rotulo}.custosDiretos`, v.custosDiretos],
    [`${rotulo}.custosIndiretos`, v.custosIndiretos],
    [`${rotulo}.custosAdministrativos`, v.custosAdministrativos],
    [`${rotulo}.outrosCustos`, v.outrosCustos],
    [`${rotulo}.cpkTotalReaisPorKm`, v.cpkTotalReaisPorKm],
    [`${rotulo}.lucroFixoDesejado`, v.lucroFixoDesejado],
    [`${rotulo}.impostoValor`, v.impostoValor],
    [`${rotulo}.comissaoValor`, v.comissaoValor],
    [`${rotulo}.taxaPlataformaValor`, v.taxaPlataformaValor],
    [`${rotulo}.outrasDeducoesValor`, v.outrasDeducoesValor],
    [`${rotulo}.adicionalRiscoValor`, v.adicionalRiscoValor],
    [`${rotulo}.custoCapitalValor`, v.custoCapitalValor],
    [`${rotulo}.capitalEmpregadoValor`, v.capitalEmpregadoValor],
    [`${rotulo}.custoCapitalPeriodos`, v.custoCapitalPeriodos],
    [`${rotulo}.valorFreteOferecido`, v.valorFreteOferecido],
    [`${rotulo}.precoInicialNegociacao`, v.precoInicialNegociacao],
    [`${rotulo}.receitaRetorno`, v.receitaRetorno],
    [`${rotulo}.prazoPagamentoDias`, v.prazoPagamentoDias],
    [`${rotulo}.adiantamento`, v.adiantamento],
  ];
}

function validarVariante(v: DadosValorMinimoVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) erros.push(`O campo "${campo}" não pode ser negativo.`);
  }

  for (const [campo, valor] of [
    [`${rotulo}.impostoPercentual`, v.impostoPercentual],
    [`${rotulo}.comissaoPercentual`, v.comissaoPercentual],
    [`${rotulo}.taxaPlataformaPercentual`, v.taxaPlataformaPercentual],
    [`${rotulo}.outrasDeducoesPercentual`, v.outrasDeducoesPercentual],
    [`${rotulo}.adicionalRiscoPercentual`, v.adicionalRiscoPercentual],
    [`${rotulo}.custoCapitalPercentual`, v.custoCapitalPercentual],
  ] as Array<[string, number | undefined]>) {
    if (valor !== undefined && valor < 0) erros.push(`"${campo}" não pode ser negativo.`);
  }

  if (v.margemAlvoPercentual !== undefined && (v.margemAlvoPercentual < 0 || v.margemAlvoPercentual > 100)) {
    erros.push(`"${rotulo}.margemAlvoPercentual" deve estar entre 0 e 100.`);
  }
  if (v.markupAlvoPercentual !== undefined && v.markupAlvoPercentual < 0) {
    erros.push(`"${rotulo}.markupAlvoPercentual" não pode ser negativo.`);
  }

  if (v.adicionalRiscoPercentual !== undefined && v.interpretacaoAdicionalRisco === undefined) {
    erros.push(
      `${rotulo}: "adicionalRiscoPercentual" foi informado sem "interpretacaoAdicionalRisco" (SOBRE_CUSTO, SOBRE_VALOR_MINIMO ou SOBRE_RECEITA) — a interpretação nunca é assumida.`
    );
  }

  if (v.capitalEmpregadoValor !== undefined && v.custoCapitalValor !== undefined) {
    erros.push(`${rotulo}: "capitalEmpregadoValor" (sub-cálculo de custo de capital) não pode ser combinado diretamente com "custoCapitalValor" — quando "capitalEmpregadoValor" é usado, "custoCapitalPercentual" passa a ser a taxa por período do sub-cálculo, não uma dedução direta.`);
  }

  if (v.resumoCustoViagem) {
    const r = v.resumoCustoViagem;
    for (const [campo, valor] of [
      [`${rotulo}.resumoCustoViagem.custoTotal`, r.custoTotal],
      [`${rotulo}.resumoCustoViagem.distanciaTotalKm`, r.distanciaTotalKm],
    ] as Array<[string, number | undefined]>) {
      if (valor !== undefined && valor < 0) erros.push(`O campo "${campo}" não pode ser negativo.`);
    }
  }

  return erros;
}

const MODOS_QUE_EXIGEM_KM: ModoValorMinimoFrete[] = ["VALOR_MINIMO_POR_KM"];
const MODOS_QUE_EXIGEM_KM_CARREGADO: ModoValorMinimoFrete[] = ["VALOR_MINIMO_POR_KM_CARREGADO", "VALOR_MINIMO_TONELADA_KM"];
const MODOS_QUE_EXIGEM_PESO: ModoValorMinimoFrete[] = ["VALOR_MINIMO_POR_TONELADA", "VALOR_MINIMO_TONELADA_KM"];
const MODOS_QUE_EXIGEM_QUANTIDADE: ModoValorMinimoFrete[] = ["VALOR_MINIMO_POR_UNIDADE"];
const MODOS_QUE_EXIGEM_VEICULOS: ModoValorMinimoFrete[] = ["MULTIPLOS_VEICULOS"];

function validarEstruturaTopo(entrada: CalcularValorMinimoFreteEntrada): string[] {
  const erros: string[] = [];

  if (entrada.modo === "COMPARACAO_CENARIOS") {
    if (!entrada.cenarios || entrada.cenarios.length < 2) {
      erros.push("COMPARACAO_CENARIOS exige ao menos dois cenários em \"cenarios\".");
    }
  }
  if (entrada.modo === "MARGEM_ALVO" && entrada.margemAlvoPercentual === undefined) {
    erros.push('O modo MARGEM_ALVO exige "margemAlvoPercentual".');
  }
  if (entrada.modo === "MARKUP_ALVO" && entrada.markupAlvoPercentual === undefined) {
    erros.push('O modo MARKUP_ALVO exige "markupAlvoPercentual".');
  }
  if (entrada.modo === "LUCRO_FIXO_ALVO" && entrada.lucroFixoDesejado === undefined) {
    erros.push('O modo LUCRO_FIXO_ALVO exige "lucroFixoDesejado".');
  }
  if (entrada.modo === "COMPARAR_COM_OFERTA" && entrada.valorFreteOferecido === undefined) {
    erros.push('O modo COMPARAR_COM_OFERTA exige "valorFreteOferecido".');
  }
  if (MODOS_QUE_EXIGEM_KM.includes(entrada.modo) && !(entrada.distanciaTotalKm !== undefined && entrada.distanciaTotalKm > 0)) {
    erros.push(`O modo ${entrada.modo} exige "distanciaTotalKm" maior que zero.`);
  }
  if (MODOS_QUE_EXIGEM_KM_CARREGADO.includes(entrada.modo) && !(entrada.distanciaCarregadaKm !== undefined && entrada.distanciaCarregadaKm > 0)) {
    erros.push(`O modo ${entrada.modo} exige "distanciaCarregadaKm" maior que zero.`);
  }
  if (MODOS_QUE_EXIGEM_PESO.includes(entrada.modo) && !(entrada.pesoCargaToneladas !== undefined && entrada.pesoCargaToneladas > 0)) {
    erros.push(`O modo ${entrada.modo} exige "pesoCargaToneladas" maior que zero.`);
  }
  if (MODOS_QUE_EXIGEM_QUANTIDADE.includes(entrada.modo) && !(entrada.quantidadeCarga !== undefined && entrada.quantidadeCarga > 0)) {
    erros.push(`O modo ${entrada.modo} exige "quantidadeCarga" maior que zero.`);
  }
  if (MODOS_QUE_EXIGEM_VEICULOS.includes(entrada.modo) && !(entrada.quantidadeVeiculos !== undefined && entrada.quantidadeVeiculos > 0)) {
    erros.push(`O modo ${entrada.modo} exige "quantidadeVeiculos" maior que zero.`);
  }
  if (entrada.quantidadeViagens !== undefined && entrada.quantidadeViagens <= 0) {
    erros.push('"quantidadeViagens" deve ser maior que zero quando informado.');
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — fonte de custo
// ---------------------------------------------------------------------------

const CAMPOS_CUSTO_DETALHADO: Array<[keyof DadosValorMinimoVariante, string]> = [
  ["custosVariaveis", "custosVariaveis"],
  ["custosFixosRateados", "custosFixosRateados"],
  ["custosDiretos", "custosDiretos"],
  ["custosIndiretos", "custosIndiretos"],
  ["custosAdministrativos", "custosAdministrativos"],
  ["outrosCustos", "outrosCustos"],
];

interface CandidatoCustoTotal {
  rotulo: string;
  valor: number;
  custoIda?: number;
  custoVolta?: number;
}

interface FonteCustoResolvida {
  custoTotalBase?: number;
  custoIdaResolvido?: number;
  custoVoltaResolvido?: number;
  custosIncluidos: string[];
  custosIgnorados: string[];
  alertas: string[];
  erro?: string;
}

function resolverCustoBase(v: DadosValorMinimoVariante, estrategia: EstrategiaSobreposicao, rotulo: string): FonteCustoResolvida {
  const candidatos: CandidatoCustoTotal[] = [];
  if (v.custoTotal !== undefined) candidatos.push({ rotulo: "custoTotal", valor: v.custoTotal });
  if (v.custoIda !== undefined || v.custoVolta !== undefined) {
    candidatos.push({ rotulo: "custoIda + custoVolta", valor: (v.custoIda ?? 0) + (v.custoVolta ?? 0), custoIda: v.custoIda, custoVolta: v.custoVolta });
  }
  if (v.resumoCustoViagem?.custoTotal !== undefined) candidatos.push({ rotulo: "resumoCustoViagem.custoTotal", valor: v.resumoCustoViagem.custoTotal });
  if (v.cpkTotalReaisPorKm !== undefined && v.distanciaTotalKm !== undefined && v.distanciaTotalKm > 0) {
    candidatos.push({ rotulo: "cpkTotalReaisPorKm × distanciaTotalKm", valor: v.cpkTotalReaisPorKm * v.distanciaTotalKm });
  }
  if (v.resumoCpk?.cpk !== undefined && v.distanciaTotalKm !== undefined && v.distanciaTotalKm > 0) {
    candidatos.push({ rotulo: "resumoCpk.cpk × distanciaTotalKm", valor: v.resumoCpk.cpk * v.distanciaTotalKm });
  }
  if (v.resumoAnaliseFrete?.custoTotal !== undefined) candidatos.push({ rotulo: "resumoAnaliseFrete.custoTotal", valor: v.resumoAnaliseFrete.custoTotal });

  const detalhados = CAMPOS_CUSTO_DETALHADO.filter(([campo]) => v[campo] !== undefined);
  const temDetalhado = detalhados.length > 0;
  const temTotal = candidatos.length > 0;

  if (!temTotal && !temDetalhado) return { custosIncluidos: [], custosIgnorados: [], alertas: [] };

  const alertas: string[] = [];

  if (candidatos.length > 1) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return {
        erro: `${rotulo}: custo informado por mais de uma fonte "total" (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".`,
        custosIncluidos: [],
        custosIgnorados: [],
        alertas: [],
      };
    }
    alertas.push(`${rotulo}: mais de uma fonte de custo "total" informada (${candidatos.map((c) => c.rotulo).join(", ")}) — usada "${candidatos[0].rotulo}" por ordem de prioridade.`);
  }

  if (temTotal && temDetalhado && estrategia === "REJEITAR_SOBREPOSICAO") {
    return {
      erro: `${rotulo}: custo informado tanto por fonte total (${candidatos[0].rotulo}) quanto por categorias detalhadas (${detalhados.map(([, r]) => r).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".`,
      custosIncluidos: [],
      custosIgnorados: [],
      alertas: [],
    };
  }

  let usarTotal = temTotal;
  let usarDetalhado = temDetalhado;
  if (temTotal && temDetalhado) {
    if (estrategia === "PRIORIZAR_TOTAL") {
      usarDetalhado = false;
      alertas.push(`${rotulo}: sobreposição de custo resolvida por "PRIORIZAR_TOTAL" — usado ${candidatos[0].rotulo}, ignorado o detalhamento.`);
    } else {
      usarTotal = false;
      alertas.push(`${rotulo}: sobreposição de custo resolvida por "PRIORIZAR_DETALHADO" — usado o detalhamento, ignorado ${candidatos[0].rotulo}.`);
    }
  }

  if (usarTotal) {
    const vencedor = candidatos[0];
    return {
      custoTotalBase: vencedor.valor,
      custoIdaResolvido: v.custoIda,
      custoVoltaResolvido: v.custoVolta,
      custosIncluidos: [vencedor.rotulo],
      custosIgnorados: [],
      alertas,
    };
  }

  if (usarDetalhado) {
    let soma = 0;
    const incluidos: string[] = [];
    const ignorados: string[] = [];
    for (const [campo, rotuloCampo] of CAMPOS_CUSTO_DETALHADO) {
      const valor = v[campo] as number | undefined;
      if (valor !== undefined) {
        soma += valor;
        incluidos.push(rotuloCampo);
      } else {
        ignorados.push(rotuloCampo);
      }
    }
    return {
      custoTotalBase: soma,
      custoIdaResolvido: v.custoIda,
      custoVoltaResolvido: v.custoVolta,
      custosIncluidos: incluidos,
      custosIgnorados: ignorados,
      alertas,
    };
  }

  return { custosIncluidos: [], custosIgnorados: [], alertas: [] };
}

// ---------------------------------------------------------------------------
// Resolução de deduções (fixas + percentuais sobre a receita)
// ---------------------------------------------------------------------------

interface DeducaoResolvida {
  percentualTotalReceitaDecimal: number;
  deducoesFixasTotal: number;
  deducoesIncluidas: string[];
  deducoesIgnoradas: string[];
  alertas: string[];
  premissas: string[];
  erros: string[];
}

function calcularCustoCapital(v: DadosValorMinimoVariante): { valor?: number; memoria?: string; erro?: string } {
  if (v.capitalEmpregadoValor === undefined) return {};
  const metodo = v.custoCapitalMetodo ?? "JUROS_SIMPLES";
  const taxaPercentual = v.custoCapitalPercentual;
  const periodos = v.custoCapitalPeriodos;

  if (metodo === "VALOR_FIXO") {
    return { valor: v.capitalEmpregadoValor, memoria: `custo de capital: método VALOR_FIXO, valor informado ${formatarBRL(v.capitalEmpregadoValor)}.` };
  }
  if (taxaPercentual === undefined || periodos === undefined) {
    return { erro: 'Para calcular o custo de capital (JUROS_SIMPLES/JUROS_COMPOSTOS/PERCENTUAL_DIRETO) são necessários "custoCapitalPercentual" (taxa por período) e "custoCapitalPeriodos".' };
  }
  const taxaDecimal = taxaPercentual / 100;
  if (metodo === "JUROS_SIMPLES") {
    const valor = v.capitalEmpregadoValor * taxaDecimal * periodos;
    return { valor, memoria: `custo de capital: JUROS_SIMPLES — capital ${formatarBRL(v.capitalEmpregadoValor)} × ${formatarNumero(taxaPercentual)}% × ${periodos} período(s) = ${formatarBRL(valor)}.` };
  }
  if (metodo === "JUROS_COMPOSTOS") {
    const valorFuturo = v.capitalEmpregadoValor * Math.pow(1 + taxaDecimal, periodos);
    const valor = valorFuturo - v.capitalEmpregadoValor;
    return {
      valor,
      memoria: `custo de capital: JUROS_COMPOSTOS — capital ${formatarBRL(v.capitalEmpregadoValor)} × (1 + ${formatarNumero(taxaPercentual)}%)^${periodos} − capital = ${formatarBRL(valor)}.`,
    };
  }
  // PERCENTUAL_DIRETO
  const valor = v.capitalEmpregadoValor * taxaDecimal;
  return { valor, memoria: `custo de capital: PERCENTUAL_DIRETO — capital ${formatarBRL(v.capitalEmpregadoValor)} × ${formatarNumero(taxaPercentual)}% = ${formatarBRL(valor)}.` };
}

function resolverDeducoes(v: DadosValorMinimoVariante, estrategiaDeducao: EstrategiaSobreposicaoDeducao, baseCalculo: BaseCalculoPercentuais, rotulo: string): DeducaoResolvida {
  const estrategia = paraEstrategiaCusto(estrategiaDeducao);
  const alertas: string[] = [];
  const premissas: string[] = [];
  const erros: string[] = [];
  const deducoesIncluidas: string[] = [];
  const deducoesIgnoradas: string[] = [];

  let percentualTotalReceitaDecimal = 0;
  let deducoesFixasTotal = 0;

  if (baseCalculo !== "RECEITA_BRUTA") {
    alertas.push(
      `${rotulo}: baseCalculoPercentuais="${baseCalculo}" ainda não tem equação fechada implementada nesta fase — os percentuais foram considerados sobre a receita bruta (RECEITA_BRUTA), como se fosse o padrão.`
    );
  }

  const camposPercentuais: Array<[number | undefined, number | undefined, string]> = [
    [v.impostoValor, v.impostoPercentual, "imposto"],
    [v.comissaoValor, v.comissaoPercentual, "comissão"],
    [v.taxaPlataformaValor, v.taxaPlataformaPercentual, "taxa de plataforma"],
    [v.outrasDeducoesValor, v.outrasDeducoesPercentual, "outras deduções"],
  ];

  for (const [flat, percentual, nome] of camposPercentuais) {
    if (flat === undefined && percentual === undefined) continue;
    const resolvido = resolverValorOuAliquota(flat, percentual, undefined, nome, estrategia);
    if (resolvido.erro) {
      erros.push(`${rotulo}: ${resolvido.erro}`);
      continue;
    }
    if (resolvido.alerta) alertas.push(`${rotulo}: ${resolvido.alerta}`);
    if (resolvido.modoUsado === "FLAT") {
      deducoesFixasTotal += flat as number;
      deducoesIncluidas.push(`${nome} (valor fixo)`);
    } else if (resolvido.modoUsado === "PERCENTUAL") {
      percentualTotalReceitaDecimal += (percentual as number) / 100;
      deducoesIncluidas.push(`${nome} (${formatarNumero(percentual as number)}% sobre a receita bruta)`);
    }
  }

  // Custo de capital: valor/percentual diretos OU sub-cálculo via capitalEmpregadoValor.
  if (v.capitalEmpregadoValor !== undefined) {
    const resultado = calcularCustoCapital(v);
    if (resultado.erro) {
      erros.push(`${rotulo}: ${resultado.erro}`);
    } else if (resultado.valor !== undefined) {
      deducoesFixasTotal += resultado.valor;
      deducoesIncluidas.push(`custo de capital (calculado via ${v.custoCapitalMetodo ?? "JUROS_SIMPLES"})`);
      if (resultado.memoria) premissas.push(`${rotulo}: ${resultado.memoria}`);
    }
  } else if (v.custoCapitalValor !== undefined || v.custoCapitalPercentual !== undefined) {
    const resolvido = resolverValorOuAliquota(v.custoCapitalValor, v.custoCapitalPercentual, undefined, "custo de capital", estrategia);
    if (resolvido.erro) {
      erros.push(`${rotulo}: ${resolvido.erro}`);
    } else {
      if (resolvido.alerta) alertas.push(`${rotulo}: ${resolvido.alerta}`);
      if (resolvido.modoUsado === "FLAT") {
        deducoesFixasTotal += v.custoCapitalValor as number;
        deducoesIncluidas.push("custo de capital (valor fixo)");
      } else if (resolvido.modoUsado === "PERCENTUAL") {
        percentualTotalReceitaDecimal += (v.custoCapitalPercentual as number) / 100;
        deducoesIncluidas.push(`custo de capital (${formatarNumero(v.custoCapitalPercentual as number)}% sobre a receita bruta)`);
      }
    }
  } else {
    deducoesIgnoradas.push("custo de capital");
  }

  for (const [flat, percentual, nome] of camposPercentuais) {
    if (flat === undefined && percentual === undefined) deducoesIgnoradas.push(nome);
  }

  // Adicional de risco: interpretação nunca assumida (validado em validarVariante).
  if (v.adicionalRiscoValor !== undefined || v.adicionalRiscoPercentual !== undefined) {
    const resolvido = resolverValorOuAliquota(v.adicionalRiscoValor, v.adicionalRiscoPercentual, undefined, "adicional de risco", estrategia);
    if (resolvido.erro) {
      erros.push(`${rotulo}: ${resolvido.erro}`);
    } else {
      if (resolvido.alerta) alertas.push(`${rotulo}: ${resolvido.alerta}`);
      if (resolvido.modoUsado === "FLAT") {
        deducoesFixasTotal += v.adicionalRiscoValor as number;
        deducoesIncluidas.push("adicional de risco (valor fixo)");
      } else if (resolvido.modoUsado === "PERCENTUAL" && v.interpretacaoAdicionalRisco === "SOBRE_RECEITA") {
        percentualTotalReceitaDecimal += (v.adicionalRiscoPercentual as number) / 100;
        deducoesIncluidas.push(`adicional de risco (${formatarNumero(v.adicionalRiscoPercentual as number)}% sobre a receita)`);
      } else if (resolvido.modoUsado === "PERCENTUAL") {
        // SOBRE_CUSTO e SOBRE_VALOR_MINIMO são aplicados fora desta função (dependem de custoTotalBase/valorMinimoPrincipal).
        deducoesIncluidas.push(`adicional de risco (${formatarNumero(v.adicionalRiscoPercentual as number)}%, aplicado ${v.interpretacaoAdicionalRisco})`);
      }
    }
  } else {
    deducoesIgnoradas.push("adicional de risco");
  }

  return { percentualTotalReceitaDecimal, deducoesFixasTotal, deducoesIncluidas, deducoesIgnoradas, alertas, premissas, erros };
}

// ---------------------------------------------------------------------------
// Núcleo de cálculo
// ---------------------------------------------------------------------------

interface AgregacaoValorMinimo {
  custoTotalBase?: number;
  custoIdaResolvido?: number;
  custoVoltaResolvido?: number;
  custosFixosAdicionais?: number;
  baseFinanceira?: number;
  percentualTotalDeducoes?: number;

  valorPontoEquilibrio?: number;
  valorMinimoComMargem?: number;
  valorMinimoComMarkup?: number;
  valorMinimoComLucroFixo?: number;
  valorMinimoPrincipal?: number;

  valorMinimoPorKm?: number;
  valorMinimoPorKmCarregado?: number;
  valorMinimoPorTonelada?: number;
  valorMinimoToneladaKm?: number;
  valorMinimoPorUnidade?: number;
  valorMinimoPorVeiculo?: number;
  valorMinimoPorViagem?: number;

  impactoRetornoVazio?: ImpactoRetornoVazioMinimo;
  valorNecessarioNaIda?: number;

  lucroEstimadoNaOferta?: number;
  margemEstimadaNaOferta?: number;
  diferencaOferta?: number;
  percentualDiferencaOferta?: number;
  valorAdicionalNecessario?: number;
  descontoMaximo?: number;
  classificacaoOferta?: ClassificacaoOfertaFrete;

  valorMinimoExato?: number;
  valorMinimoComercial?: number;
  impactoArredondamento?: number;

  custosIncluidos: string[];
  custosIgnorados: string[];
  deducoesIncluidas: string[];
  deducoesIgnoradas: string[];
  alertas: string[];
  premissas: string[];
  dadosFaltantes: string[];
  errosValidacao: string[];

  custoValido: boolean;
}

function arredondarComercial(valor: number, regra: RegraArredondamentoComercial): number {
  switch (regra) {
    case "SEM_ARREDONDAMENTO":
      return valor;
    case "PROXIMO_REAL":
      return Math.round(valor);
    case "PROXIMO_5":
      return Math.ceil(valor / 5) * 5;
    case "PROXIMO_10":
      return Math.ceil(valor / 10) * 10;
    case "PROXIMO_50":
      return Math.ceil(valor / 50) * 50;
    case "PROXIMO_100":
      return Math.ceil(valor / 100) * 100;
    case "SEMPRE_PARA_CIMA":
      return Math.ceil(valor);
    default:
      return valor;
  }
}

function calcularNucleo(
  v: DadosValorMinimoVariante,
  modo: ModoValorMinimoFrete,
  estrategiaCusto: EstrategiaSobreposicao,
  estrategiaDeducao: EstrategiaSobreposicaoDeducao,
  baseCalculo: BaseCalculoPercentuais,
  arredondamento: RegraArredondamentoComercial,
  toleranciaPercentual: number,
  rotulo: string,
  casas: CasasDecimaisValorMinimo
): AgregacaoValorMinimo {
  const alertas: string[] = [];
  const premissas: string[] = [];
  const dadosFaltantes: string[] = [];
  const errosValidacao: string[] = [];

  const isMultiVeiculos = modo === "MULTIPLOS_VEICULOS";

  const fonteCusto = resolverCustoBase(v, estrategiaCusto, rotulo);
  if (fonteCusto.erro) errosValidacao.push(fonteCusto.erro);
  alertas.push(...fonteCusto.alertas);

  if (fonteCusto.custoTotalBase === undefined) {
    dadosFaltantes.push(`${rotulo}.custoTotal (ou custos detalhados, ou resumoCustoViagem, ou CPK × distância, ou custoIda + custoVolta)`);
  }

  if (isMultiVeiculos && v.quantidadeVeiculos === undefined) {
    dadosFaltantes.push(`${rotulo}.quantidadeVeiculos`);
  }

  if (errosValidacao.length > 0 || dadosFaltantes.length > 0) {
    return {
      custosIncluidos: [],
      custosIgnorados: [],
      deducoesIncluidas: [],
      deducoesIgnoradas: [],
      alertas,
      premissas,
      dadosFaltantes,
      errosValidacao,
      custoValido: fonteCusto.custoTotalBase !== undefined,
    };
  }

  const custoTotalBaseInformado = fonteCusto.custoTotalBase as number;
  const custoTotalBase = isMultiVeiculos ? custoTotalBaseInformado * (v.quantidadeVeiculos as number) : custoTotalBaseInformado;
  if (isMultiVeiculos) {
    premissas.push(`${rotulo}: custo informado (${formatarBRL(custoTotalBaseInformado)}) foi interpretado como custo por veículo e multiplicado por ${v.quantidadeVeiculos} veículo(s) = ${formatarBRL(custoTotalBase)}.`);
  }

  const deducao = resolverDeducoes(v, estrategiaDeducao, baseCalculo, rotulo);
  errosValidacao.push(...deducao.erros);
  alertas.push(...deducao.alertas);
  premissas.push(...deducao.premissas);

  if (errosValidacao.length > 0) {
    return {
      custoTotalBase: arredondar(custoTotalBase, casas.moeda),
      custosIncluidos: fonteCusto.custosIncluidos,
      custosIgnorados: fonteCusto.custosIgnorados,
      deducoesIncluidas: [],
      deducoesIgnoradas: [],
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      custoValido: true,
    };
  }

  // Adicional de risco SOBRE_CUSTO: resolvido aqui (precisa de custoTotalBase já pronto).
  let deducoesFixasTotal = deducao.deducoesFixasTotal;
  if (v.adicionalRiscoPercentual !== undefined && v.adicionalRiscoValor === undefined && v.interpretacaoAdicionalRisco === "SOBRE_CUSTO") {
    const valorRisco = custoTotalBase * (v.adicionalRiscoPercentual / 100);
    deducoesFixasTotal += valorRisco;
    premissas.push(`${rotulo}: adicional de risco de ${formatarNumero(v.adicionalRiscoPercentual)}% aplicado sobre o custo total (${formatarBRL(custoTotalBase)}) = ${formatarBRL(valorRisco)}.`);
  }

  const custosFixosAdicionais = deducoesFixasTotal;
  const baseFinanceira = custoTotalBase + custosFixosAdicionais;
  const pct = deducao.percentualTotalReceitaDecimal;

  if (pct >= 1) {
    errosValidacao.push(`${rotulo}: o percentual total de deduções sobre a receita (${formatarNumero(pct * 100)}%) é maior ou igual a 100% — denominador inválido, não é possível calcular um valor mínimo.`);
    return {
      custoTotalBase: arredondar(custoTotalBase, casas.moeda),
      custosFixosAdicionais: arredondar(custosFixosAdicionais, casas.moeda),
      baseFinanceira: arredondar(baseFinanceira, casas.moeda),
      percentualTotalDeducoes: arredondar(pct * 100, casas.percentual),
      custosIncluidos: fonteCusto.custosIncluidos,
      custosIgnorados: fonteCusto.custosIgnorados,
      deducoesIncluidas: deducao.deducoesIncluidas,
      deducoesIgnoradas: deducao.deducoesIgnoradas,
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      custoValido: true,
    };
  }

  const valorPontoEquilibrio = baseFinanceira / (1 - pct);

  let valorMinimoComMargem: number | undefined;
  if (v.margemAlvoPercentual !== undefined) {
    const margemDecimal = v.margemAlvoPercentual / 100;
    const denominador = 1 - pct - margemDecimal;
    if (denominador <= 0) {
      errosValidacao.push(`${rotulo}: a margem-alvo (${formatarNumero(v.margemAlvoPercentual)}%) somada às deduções percentuais (${formatarNumero(pct * 100)}%) resulta em denominador inválido — ajuste a margem-alvo ou as deduções.`);
    } else {
      valorMinimoComMargem = baseFinanceira / denominador;
    }
  }

  let valorMinimoComMarkup: number | undefined;
  if (errosValidacao.length === 0 && v.markupAlvoPercentual !== undefined) {
    const valorLiquido = baseFinanceira * (1 + v.markupAlvoPercentual / 100);
    valorMinimoComMarkup = pct > 0 ? valorLiquido / (1 - pct) : valorLiquido;
    premissas.push(
      `${rotulo}: markup-alvo de ${formatarNumero(v.markupAlvoPercentual)}% aplicado sobre a base financeira (${formatarBRL(baseFinanceira)}) = ${formatarBRL(valorLiquido)}${
        pct > 0 ? `, ajustado para ${formatarBRL(valorMinimoComMarkup)} para absorver ${formatarNumero(pct * 100)}% de deduções sobre a receita` : ""
      }.`
    );
  }

  let valorMinimoComLucroFixo: number | undefined;
  if (errosValidacao.length === 0 && v.lucroFixoDesejado !== undefined) {
    valorMinimoComLucroFixo = (baseFinanceira + v.lucroFixoDesejado) / (1 - pct);
  }

  if (errosValidacao.length > 0) {
    return {
      custoTotalBase: arredondar(custoTotalBase, casas.moeda),
      custosFixosAdicionais: arredondar(custosFixosAdicionais, casas.moeda),
      baseFinanceira: arredondar(baseFinanceira, casas.moeda),
      percentualTotalDeducoes: arredondar(pct * 100, casas.percentual),
      custosIncluidos: fonteCusto.custosIncluidos,
      custosIgnorados: fonteCusto.custosIgnorados,
      deducoesIncluidas: deducao.deducoesIncluidas,
      deducoesIgnoradas: deducao.deducoesIgnoradas,
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      custoValido: true,
    };
  }

  // Prioridade da meta de preço "principal": margem > markup > lucro fixo > ponto de equilíbrio.
  let valorMinimoPrincipal = valorMinimoComMargem ?? valorMinimoComMarkup ?? valorMinimoComLucroFixo ?? valorPontoEquilibrio;

  // Adicional de risco SOBRE_VALOR_MINIMO: multiplicador final, forma fechada.
  if (v.adicionalRiscoPercentual !== undefined && v.adicionalRiscoValor === undefined && v.interpretacaoAdicionalRisco === "SOBRE_VALOR_MINIMO") {
    const semRisco = valorMinimoPrincipal;
    valorMinimoPrincipal = semRisco * (1 + v.adicionalRiscoPercentual / 100);
    premissas.push(`${rotulo}: adicional de risco de ${formatarNumero(v.adicionalRiscoPercentual)}% aplicado sobre o valor mínimo (${formatarBRL(semRisco)}) = ${formatarBRL(valorMinimoPrincipal)}.`);
  }

  // Divisões por km/tonelada/unidade/veículo/viagem — sempre via calcularCpk (nunca negativas).
  let valorMinimoPorKm: number | undefined;
  if (v.distanciaTotalKm !== undefined && v.distanciaTotalKm > 0) {
    valorMinimoPorKm = dividirViaCpk(valorMinimoPrincipal, v.distanciaTotalKm, casas.custoPorKm);
  }
  let valorMinimoPorKmCarregado: number | undefined;
  if (v.distanciaCarregadaKm !== undefined && v.distanciaCarregadaKm > 0) {
    valorMinimoPorKmCarregado = dividirViaCpk(valorMinimoPrincipal, v.distanciaCarregadaKm, casas.custoPorKm);
    if (v.distanciaVaziaKm !== undefined && v.distanciaVaziaKm > 0) {
      alertas.push("O valor mínimo por km carregado distribui o custo de toda a operação (inclusive o retorno vazio) apenas pelos km carregados/remunerados — não representa o custo real de cada km individual.");
    }
  }
  let valorMinimoPorTonelada: number | undefined;
  if (v.pesoCargaToneladas !== undefined && v.pesoCargaToneladas > 0) {
    valorMinimoPorTonelada = dividirViaCpk(valorMinimoPrincipal, v.pesoCargaToneladas, casas.tonelada);
  }
  let valorMinimoToneladaKm: number | undefined;
  if (v.pesoCargaToneladas !== undefined && v.pesoCargaToneladas > 0 && v.distanciaCarregadaKm !== undefined && v.distanciaCarregadaKm > 0) {
    valorMinimoToneladaKm = dividirViaCpk(valorMinimoPrincipal, v.pesoCargaToneladas * v.distanciaCarregadaKm, casas.toneladaKm);
  }
  let valorMinimoPorUnidade: number | undefined;
  if (v.quantidadeCarga !== undefined && v.quantidadeCarga > 0) {
    valorMinimoPorUnidade = dividirViaCpk(valorMinimoPrincipal, v.quantidadeCarga, casas.moeda);
  }
  let valorMinimoPorVeiculo: number | undefined;
  if (v.quantidadeVeiculos !== undefined && v.quantidadeVeiculos > 0) {
    valorMinimoPorVeiculo = dividirViaCpk(valorMinimoPrincipal, v.quantidadeVeiculos, casas.moeda);
  }
  let valorMinimoPorViagem: number | undefined;
  if (v.quantidadeViagens !== undefined && v.quantidadeViagens > 0) {
    valorMinimoPorViagem = dividirViaCpk(valorMinimoPrincipal, v.quantidadeViagens, casas.moeda);
  }

  // Impacto do retorno vazio — recalcula o mesmo "valorMinimoPrincipal" só com o custo da ida.
  let impactoRetornoVazio: ImpactoRetornoVazioMinimo | undefined;
  const custoIda = fonteCusto.custoIdaResolvido;
  const custoVolta = fonteCusto.custoVoltaResolvido;
  if (custoIda !== undefined && custoVolta !== undefined) {
    const baseFinanceiraSoIda = custoIda + custosFixosAdicionais;
    let valorMinimoSemRetorno: number | undefined;
    if (v.margemAlvoPercentual !== undefined && valorMinimoComMargem !== undefined) {
      const denom = 1 - pct - v.margemAlvoPercentual / 100;
      if (denom > 0) valorMinimoSemRetorno = baseFinanceiraSoIda / denom;
    } else {
      valorMinimoSemRetorno = baseFinanceiraSoIda / (1 - pct);
    }
    const diferencaAbsoluta = valorMinimoSemRetorno !== undefined ? valorMinimoPrincipal - valorMinimoSemRetorno : undefined;
    impactoRetornoVazio = {
      custoIda: arredondar(custoIda, casas.moeda),
      custoRetorno: arredondar(custoVolta, casas.moeda),
      custoTotal: arredondar(custoIda + custoVolta, casas.moeda),
      percentualCustoRetorno: custoIda + custoVolta > 0 ? arredondar((custoVolta / (custoIda + custoVolta)) * 100, casas.percentual) : undefined,
      valorMinimoComRetorno: arredondar(valorMinimoPrincipal, casas.moeda),
      valorMinimoSemRetorno: valorMinimoSemRetorno !== undefined ? arredondar(valorMinimoSemRetorno, casas.moeda) : undefined,
      diferencaAbsoluta: diferencaAbsoluta !== undefined ? arredondar(diferencaAbsoluta, casas.moeda) : undefined,
      diferencaPercentual:
        diferencaAbsoluta !== undefined && valorMinimoSemRetorno !== undefined && valorMinimoSemRetorno > 0
          ? arredondar((diferencaAbsoluta / valorMinimoSemRetorno) * 100, casas.percentual)
          : undefined,
      impactoPorKm: v.distanciaVoltaKm !== undefined && v.distanciaVoltaKm > 0 ? arredondar(custoVolta / v.distanciaVoltaKm, casas.custoPorKm) : undefined,
    };
  }

  // Frete com retorno remunerado — rateio da necessidade de receita entre ida e volta.
  let valorNecessarioNaIda: number | undefined;
  if (v.receitaRetorno !== undefined) {
    const criterio = v.criterioRateioReceitaRetorno ?? "NAO_RATEAR";
    if (criterio === "MANUAL" && v.valorRateioManualIda !== undefined) {
      valorNecessarioNaIda = v.valorRateioManualIda;
      premissas.push(`${rotulo}: rateio manual — necessidade da ida definida diretamente em "valorRateioManualIda".`);
    } else if (criterio === "POR_CUSTO_DO_TRECHO" && custoIda !== undefined && custoVolta !== undefined && custoIda + custoVolta > 0) {
      valorNecessarioNaIda = valorMinimoPrincipal * (custoIda / (custoIda + custoVolta));
      premissas.push(`${rotulo}: necessidade de receita rateada entre ida e volta proporcionalmente ao custo de cada trecho.`);
    } else if (criterio === "POR_DISTANCIA" && v.distanciaIdaKm !== undefined && v.distanciaVoltaKm !== undefined && v.distanciaIdaKm + v.distanciaVoltaKm > 0) {
      valorNecessarioNaIda = valorMinimoPrincipal * (v.distanciaIdaKm / (v.distanciaIdaKm + v.distanciaVoltaKm));
      premissas.push(`${rotulo}: necessidade de receita rateada entre ida e volta proporcionalmente à distância de cada trecho.`);
    } else {
      valorNecessarioNaIda = valorMinimoPrincipal - v.receitaRetorno;
      if (criterio !== "NAO_RATEAR") {
        alertas.push(`${rotulo}: critério de rateio "${criterio}" não pôde ser aplicado por falta de dados — usado NAO_RATEAR (subtração simples da receita de retorno).`);
      } else {
        premissas.push(`${rotulo}: sem rateio — a receita de retorno foi simplesmente descontada da necessidade total de receita (NAO_RATEAR).`);
      }
    }
  }

  // Arredondamento comercial.
  const valorMinimoExato = arredondar(valorMinimoPrincipal, casas.moeda);
  const valorMinimoComercial = arredondar(arredondarComercial(valorMinimoPrincipal, arredondamento), casas.moeda);
  const impactoArredondamentoValor = arredondar(valorMinimoComercial - valorMinimoExato, casas.moeda);

  // Comparação com a oferta.
  let lucroEstimadoNaOferta: number | undefined;
  let margemEstimadaNaOferta: number | undefined;
  let diferencaOferta: number | undefined;
  let percentualDiferencaOferta: number | undefined;
  let valorAdicionalNecessario: number | undefined;
  let classificacaoOferta: ClassificacaoOfertaFrete | undefined;

  if (v.valorFreteOferecido !== undefined) {
    lucroEstimadoNaOferta = v.valorFreteOferecido * (1 - pct) - baseFinanceira;
    margemEstimadaNaOferta = v.valorFreteOferecido > 0 ? (lucroEstimadoNaOferta / v.valorFreteOferecido) * 100 : undefined;
    diferencaOferta = v.valorFreteOferecido - valorMinimoPrincipal;
    percentualDiferencaOferta = valorMinimoPrincipal > 0 ? (diferencaOferta / valorMinimoPrincipal) * 100 : undefined;
    valorAdicionalNecessario = Math.max(0, valorMinimoPrincipal - v.valorFreteOferecido);

    const tolAbs = valorMinimoPrincipal * (toleranciaPercentual / 100);
    if (v.valorFreteOferecido < valorPontoEquilibrio - tolAbs) {
      classificacaoOferta = "ABAIXO_DO_CUSTO";
    } else if (Math.abs(v.valorFreteOferecido - valorPontoEquilibrio) <= tolAbs && (v.margemAlvoPercentual === undefined || valorMinimoComMargem === undefined)) {
      classificacaoOferta = "NO_PONTO_DE_EQUILIBRIO";
    } else if (v.margemAlvoPercentual !== undefined && valorMinimoComMargem !== undefined) {
      if (Math.abs(v.valorFreteOferecido - valorMinimoComMargem) <= tolAbs) {
        classificacaoOferta = "ATENDE_MARGEM_ALVO";
      } else if (v.valorFreteOferecido < valorMinimoComMargem) {
        classificacaoOferta = "ABAIXO_DA_MARGEM_ALVO";
      } else {
        classificacaoOferta = "ACIMA_DA_MARGEM_ALVO";
      }
    } else {
      classificacaoOferta = "ACIMA_DA_MARGEM_ALVO";
    }
  }

  // Desconto máximo (a partir de um preço de referência/inicial de negociação).
  let descontoMaximo: number | undefined;
  const precoReferencia = v.precoInicialNegociacao ?? v.valorFreteOferecido;
  if (precoReferencia !== undefined && precoReferencia > valorMinimoPrincipal) {
    const descontoValor = precoReferencia - valorMinimoPrincipal;
    descontoMaximo = descontoValor;
    premissas.push(
      `${rotulo}: desconto máximo calculado até o limite econômico (${formatarBRL(valorMinimoPrincipal)}) — reduz o preço de referência (${formatarBRL(precoReferencia)}) em até ${formatarBRL(
        descontoValor
      )} (${formatarNumero((descontoValor / precoReferencia) * 100)}%), sem considerar estratégia comercial ou risco não informado.`
    );
  }

  return {
    custoTotalBase: arredondar(custoTotalBase, casas.moeda),
    custoIdaResolvido: custoIda !== undefined ? arredondar(custoIda, casas.moeda) : undefined,
    custoVoltaResolvido: custoVolta !== undefined ? arredondar(custoVolta, casas.moeda) : undefined,
    custosFixosAdicionais: arredondar(custosFixosAdicionais, casas.moeda),
    baseFinanceira: arredondar(baseFinanceira, casas.moeda),
    percentualTotalDeducoes: arredondar(pct * 100, casas.percentual),

    valorPontoEquilibrio: arredondar(valorPontoEquilibrio, casas.moeda),
    valorMinimoComMargem: valorMinimoComMargem !== undefined ? arredondar(valorMinimoComMargem, casas.moeda) : undefined,
    valorMinimoComMarkup: valorMinimoComMarkup !== undefined ? arredondar(valorMinimoComMarkup, casas.moeda) : undefined,
    valorMinimoComLucroFixo: valorMinimoComLucroFixo !== undefined ? arredondar(valorMinimoComLucroFixo, casas.moeda) : undefined,
    valorMinimoPrincipal: arredondar(valorMinimoPrincipal, casas.moeda),

    valorMinimoPorKm,
    valorMinimoPorKmCarregado,
    valorMinimoPorTonelada,
    valorMinimoToneladaKm,
    valorMinimoPorUnidade,
    valorMinimoPorVeiculo,
    valorMinimoPorViagem,

    impactoRetornoVazio,
    valorNecessarioNaIda: valorNecessarioNaIda !== undefined ? arredondar(valorNecessarioNaIda, casas.moeda) : undefined,

    lucroEstimadoNaOferta: lucroEstimadoNaOferta !== undefined ? arredondar(lucroEstimadoNaOferta, casas.moeda) : undefined,
    margemEstimadaNaOferta: margemEstimadaNaOferta !== undefined ? arredondar(margemEstimadaNaOferta, casas.percentual) : undefined,
    diferencaOferta: diferencaOferta !== undefined ? arredondar(diferencaOferta, casas.moeda) : undefined,
    percentualDiferencaOferta: percentualDiferencaOferta !== undefined ? arredondar(percentualDiferencaOferta, casas.percentual) : undefined,
    valorAdicionalNecessario: valorAdicionalNecessario !== undefined ? arredondar(valorAdicionalNecessario, casas.moeda) : undefined,
    descontoMaximo: descontoMaximo !== undefined ? arredondar(descontoMaximo, casas.moeda) : undefined,
    classificacaoOferta,

    valorMinimoExato,
    valorMinimoComercial,
    impactoArredondamento: impactoArredondamentoValor,

    custosIncluidos: fonteCusto.custosIncluidos,
    custosIgnorados: fonteCusto.custosIgnorados,
    deducoesIncluidas: deducao.deducoesIncluidas,
    deducoesIgnoradas: deducao.deducoesIgnoradas,
    alertas,
    premissas,
    dadosFaltantes: [],
    errosValidacao: [],
    custoValido: true,
  };
}

// ---------------------------------------------------------------------------
// Nível de completude
// ---------------------------------------------------------------------------

function determinarCompletude(ag: AgregacaoValorMinimo): NivelCompletude {
  if (!ag.custoValido || ag.valorMinimoPrincipal === undefined) return "INSUFICIENTE";
  if (ag.deducoesIgnoradas.length > 0) return "PARCIAL";
  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirMemoriaCalculo(rotulo: string, ag: AgregacaoValorMinimo, modo: ModoValorMinimoFrete): string[] {
  const linhas: string[] = [];
  if (ag.custoTotalBase !== undefined) {
    linhas.push(`${rotulo}: custo total base considerado = ${formatarBRL(ag.custoTotalBase)} (fontes: ${ag.custosIncluidos.join(", ") || "nenhuma"}).`);
  }
  if (ag.custosFixosAdicionais !== undefined) {
    linhas.push(`${rotulo}: deduções/custos fixos adicionais = ${formatarBRL(ag.custosFixosAdicionais)}; base financeira (custo + fixos) = ${formatarBRL(ag.baseFinanceira ?? 0)}.`);
  }
  if (ag.percentualTotalDeducoes !== undefined) {
    linhas.push(`${rotulo}: percentual total de deduções sobre a receita = ${formatarNumero(ag.percentualTotalDeducoes)}%.`);
  }
  if (ag.valorPontoEquilibrio !== undefined) {
    linhas.push(`${rotulo}: ponto de equilíbrio = base financeira ÷ (1 − % deduções) = ${formatarBRL(ag.valorPontoEquilibrio)}.`);
  }
  if (ag.valorMinimoComMargem !== undefined) {
    linhas.push(`${rotulo}: valor mínimo com margem-alvo = base financeira ÷ (1 − % deduções − % margem) = ${formatarBRL(ag.valorMinimoComMargem)}.`);
  }
  if (ag.valorMinimoComMarkup !== undefined) {
    linhas.push(`${rotulo}: valor mínimo com markup-alvo = ${formatarBRL(ag.valorMinimoComMarkup)}.`);
  }
  if (ag.valorMinimoComLucroFixo !== undefined) {
    linhas.push(`${rotulo}: valor mínimo com lucro fixo desejado = (base financeira + lucro desejado) ÷ (1 − % deduções) = ${formatarBRL(ag.valorMinimoComLucroFixo)}.`);
  }
  if (ag.valorMinimoPrincipal !== undefined) {
    linhas.push(`${rotulo}: valor mínimo principal usado no modo ${modo} = ${formatarBRL(ag.valorMinimoPrincipal)} (exato: ${formatarBRL(ag.valorMinimoExato ?? ag.valorMinimoPrincipal)}, comercial: ${formatarBRL(ag.valorMinimoComercial ?? ag.valorMinimoPrincipal)}).`);
  }
  return linhas;
}

function construirResumo(ag: AgregacaoValorMinimo, nivelCompletude: NivelCompletude, modo: ModoValorMinimoFrete): string {
  if (ag.valorMinimoPrincipal === undefined) {
    return "Não foi possível calcular um valor mínimo confiável com os dados informados. Verifique os campos faltantes.";
  }

  const partes: string[] = [];
  partes.push(`O custo total considerado para a operação foi de ${formatarBRL(ag.custoTotalBase ?? 0)}.`);
  if (ag.percentualTotalDeducoes !== undefined && ag.percentualTotalDeducoes > 0) {
    partes.push(`Considerando ${formatarNumero(ag.percentualTotalDeducoes)}% de deduções sobre a receita, o valor mínimo calculado (modo ${modo}) foi de ${formatarBRL(ag.valorMinimoPrincipal)}.`);
  } else {
    partes.push(`O valor mínimo calculado (modo ${modo}) foi de ${formatarBRL(ag.valorMinimoPrincipal)}.`);
  }
  if (ag.valorMinimoPorKm !== undefined) {
    partes.push(`Isso corresponde a ${formatarBRL(ag.valorMinimoPorKm)} por km.`);
  }
  if (ag.diferencaOferta !== undefined) {
    const verbo = ag.diferencaOferta >= 0 ? "acima" : "abaixo";
    partes.push(`A oferta recebida está ${formatarBRL(Math.abs(ag.diferencaOferta))} ${verbo} do valor necessário.`);
    if (ag.classificacaoOferta) partes.push(`Classificação da oferta: ${ag.classificacaoOferta}.`);
  }
  if (nivelCompletude === "PARCIAL") {
    partes.push(`A análise é parcial porque não foram informados: ${ag.deducoesIgnoradas.join(", ")}.`);
  } else if (nivelCompletude === "INSUFICIENTE") {
    partes.push("A análise foi classificada como insuficiente para um valor mínimo confiável.");
  }
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Pipeline por variante (usado no cálculo direto e em cada cenário)
// ---------------------------------------------------------------------------

interface ConfigCalculo {
  estrategiaCusto: EstrategiaSobreposicao;
  estrategiaDeducao: EstrategiaSobreposicaoDeducao;
  baseCalculo: BaseCalculoPercentuais;
  arredondamento: RegraArredondamentoComercial;
  toleranciaPercentual: number;
  casas: CasasDecimaisValorMinimo;
}

function analisarVariante(v: DadosValorMinimoVariante, modo: ModoValorMinimoFrete, rotulo: string, config: ConfigCalculo): AgregacaoValorMinimo {
  const errosEstrutura = validarVariante(v, rotulo);
  const ag = calcularNucleo(v, modo, config.estrategiaCusto, config.estrategiaDeducao, config.baseCalculo, config.arredondamento, config.toleranciaPercentual, rotulo, config.casas);
  if (errosEstrutura.length > 0) {
    ag.errosValidacao = [...errosEstrutura, ...ag.errosValidacao];
  }
  return ag;
}

function nomeCenario(c: CenarioValorMinimoFrete, indice: number): string {
  return c.nome ?? c.id ?? `Cenário ${indice + 1}`;
}

function construirRankingValorMinimo(itens: Array<{ id: string; nome: string; valor: number | undefined }>, maiorMelhor: boolean): ItemRankingValorMinimo[] {
  const validos = itens.filter((i): i is { id: string; nome: string; valor: number } => i.valor !== undefined);
  const ordenados = [...validos].sort((a, b) => (maiorMelhor ? b.valor - a.valor : a.valor - b.valor));
  return ordenados.map((item, indice) => ({ id: item.id, nome: item.nome, valor: item.valor, posicao: indice + 1 }));
}

function compararCenarios(entrada: CalcularValorMinimoFreteEntrada, config: ConfigCalculo): { comparacao: ComparacaoCenariosValorMinimo; nivelCompletude: NivelCompletude; alertasGerais: string[] } {
  const cenarios = entrada.cenarios as CenarioValorMinimoFrete[];
  const resultados: ResultadoCenarioValorMinimo[] = cenarios.map((c, indice) => {
    const id = c.id ?? `cenario-${indice + 1}`;
    const nome = nomeCenario(c, indice);
    const ag = analisarVariante(c, "PONTO_EQUILIBRIO", nome, config);
    const sucesso = ag.errosValidacao.length === 0 && ag.dadosFaltantes.length === 0 && ag.valorMinimoPrincipal !== undefined;
    const nivelCompletude = determinarCompletude(ag);
    return {
      id,
      nome,
      sucesso,
      alertas: ag.alertas,
      premissas: ag.premissas,
      dadosFaltantes: [...ag.dadosFaltantes, ...ag.errosValidacao],
      mensagemResumo: sucesso ? construirResumo(ag, nivelCompletude, "PONTO_EQUILIBRIO") : "Não foi possível calcular este cenário — verifique os dados faltantes.",
      custoTotalBase: ag.custoTotalBase,
      baseFinanceira: ag.baseFinanceira,
      valorMinimoPrincipal: ag.valorMinimoPrincipal,
      valorMinimoPorKm: ag.valorMinimoPorKm,
      valorMinimoPorVeiculo: ag.valorMinimoPorVeiculo,
      impactoRetornoVazio: ag.impactoRetornoVazio,
      nivelCompletude,
    };
  });

  const alertasGerais: string[] = [];
  const rankingPorMenorValorMinimo = construirRankingValorMinimo(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.valorMinimoPrincipal })), false);
  const rankingPorMaiorMargem = construirRankingValorMinimo(
    resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.valorMinimoPrincipal !== undefined && r.custoTotalBase ? ((r.valorMinimoPrincipal - r.custoTotalBase) / r.valorMinimoPrincipal) * 100 : undefined })),
    true
  );
  const rankingPorMenorCustoTotal = construirRankingValorMinimo(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoTotalBase })), false);
  const rankingPorMenorImpactoRetornoVazio = construirRankingValorMinimo(
    resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.impactoRetornoVazio?.diferencaPercentual })),
    false
  );

  if (rankingPorMenorValorMinimo.length > 0 && rankingPorMaiorMargem.length > 0 && rankingPorMenorValorMinimo[0].id !== rankingPorMaiorMargem[0].id) {
    alertasGerais.push("O cenário de menor valor mínimo não é o mesmo de maior margem — o menor preço não é automaticamente o melhor cenário.");
  }

  const nivelCompletude: NivelCompletude = resultados.every((r) => r.nivelCompletude === "COMPLETO")
    ? "COMPLETO"
    : resultados.some((r) => r.nivelCompletude === "INSUFICIENTE")
      ? "PARCIAL"
      : "PARCIAL";

  return {
    comparacao: { cenarios: resultados, rankingPorMenorValorMinimo, rankingPorMaiorMargem, rankingPorMenorCustoTotal, rankingPorMenorImpactoRetornoVazio, alertas: alertasGerais },
    nivelCompletude,
    alertasGerais,
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

function respostaFalha(modo: ModoValorMinimoFrete, dadosFaltantes: string[], erros: string[], alertas: string[] = []): CalcularValorMinimoFreteResultado {
  return {
    sucesso: false,
    modo,
    alertas,
    premissas: [],
    dadosFaltantes: [...dadosFaltantes, ...erros],
    mensagemResumo:
      erros.length > 0
        ? `Não foi possível calcular: ${erros.join(" ")}`
        : `Dados insuficientes para calcular o valor mínimo do frete. Faltam: ${dadosFaltantes.join(", ")}.`,
    nivelCompletude: "INSUFICIENTE",
    custosIncluidos: [],
    custosIgnorados: [],
    deducoesIncluidas: [],
    deducoesIgnoradas: [],
    limitacoes: LIMITACOES_PADRAO,
    memoriaCalculo: [],
  };
}

export function calcularValorMinimoFrete(entrada: CalcularValorMinimoFreteEntrada): CalcularValorMinimoFreteResultado {
  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) return respostaFalha(entrada.modo, [], errosTopo);

  const casas = casasDecimaisDe(entrada);
  const config: ConfigCalculo = {
    estrategiaCusto: entrada.estrategiaSobreposicaoCusto ?? "REJEITAR_SOBREPOSICAO",
    estrategiaDeducao: entrada.estrategiaSobreposicaoDeducao ?? "REJEITAR_SOBREPOSICAO",
    baseCalculo: entrada.baseCalculoPercentuais ?? "RECEITA_BRUTA",
    arredondamento: entrada.arredondamentoComercial ?? "SEM_ARREDONDAMENTO",
    toleranciaPercentual: entrada.toleranciaClassificacaoOfertaPercentual ?? TOLERANCIA_CLASSIFICACAO_OFERTA_PERCENTUAL_PADRAO,
    casas,
  };

  if (entrada.modo === "COMPARACAO_CENARIOS") {
    const { comparacao, nivelCompletude } = compararCenarios(entrada, config);
    const algumSucesso = comparacao.cenarios.some((c) => c.sucesso);
    return {
      sucesso: algumSucesso,
      modo: entrada.modo,
      alertas: comparacao.alertas,
      premissas: [],
      dadosFaltantes: algumSucesso ? [] : ["Nenhum cenário pôde ser calculado — verifique os dados de cada cenário."],
      mensagemResumo: algumSucesso
        ? `Comparação entre ${comparacao.cenarios.length} cenários concluída. Menor valor mínimo: ${comparacao.rankingPorMenorValorMinimo[0]?.nome ?? "—"}.`
        : "Nenhum cenário pôde ser calculado com os dados informados.",
      nivelCompletude,
      custosIncluidos: [],
      custosIgnorados: [],
      deducoesIncluidas: [],
      deducoesIgnoradas: [],
      comparacaoCenarios: comparacao,
      limitacoes: LIMITACOES_PADRAO,
      memoriaCalculo: [],
    };
  }

  const errosVariante = validarVariante(entrada, "frete");
  const ag = calcularNucleo(entrada, entrada.modo, config.estrategiaCusto, config.estrategiaDeducao, config.baseCalculo, config.arredondamento, config.toleranciaPercentual, "frete", casas);

  if (errosVariante.length > 0) {
    return respostaFalha(entrada.modo, ag.dadosFaltantes, [...errosVariante, ...ag.errosValidacao], ag.alertas);
  }
  if (ag.dadosFaltantes.length > 0 || ag.errosValidacao.length > 0) {
    return respostaFalha(entrada.modo, ag.dadosFaltantes, ag.errosValidacao, ag.alertas);
  }

  const nivelCompletude = determinarCompletude(ag);
  const memoriaCalculo = construirMemoriaCalculo("frete", ag, entrada.modo);
  const mensagemResumo = construirResumo(ag, nivelCompletude, entrada.modo);

  return {
    sucesso: true,
    modo: entrada.modo,
    identificacao: entrada.identificacao,
    descricao: entrada.descricao,

    custoTotalBase: ag.custoTotalBase,
    custosFixosAdicionais: ag.custosFixosAdicionais,
    baseFinanceira: ag.baseFinanceira,
    percentualTotalDeducoes: ag.percentualTotalDeducoes,

    valorPontoEquilibrio: ag.valorPontoEquilibrio,

    margemAlvoPercentual: entrada.margemAlvoPercentual,
    valorMinimoComMargem: ag.valorMinimoComMargem,

    markupAlvoPercentual: entrada.markupAlvoPercentual,
    valorMinimoComMarkup: ag.valorMinimoComMarkup,

    lucroFixoDesejado: entrada.lucroFixoDesejado,
    valorMinimoComLucroFixo: ag.valorMinimoComLucroFixo,

    valorMinimoExato: ag.valorMinimoExato,
    valorMinimoComercial: ag.valorMinimoComercial,
    impactoArredondamento: ag.impactoArredondamento,

    distanciaTotalKm: entrada.distanciaTotalKm,
    distanciaCarregadaKm: entrada.distanciaCarregadaKm,
    distanciaVaziaKm: entrada.distanciaVaziaKm,

    valorMinimoPorKm: ag.valorMinimoPorKm,
    valorMinimoPorKmCarregado: ag.valorMinimoPorKmCarregado,
    valorMinimoPorTonelada: ag.valorMinimoPorTonelada,
    valorMinimoToneladaKm: ag.valorMinimoToneladaKm,
    valorMinimoPorUnidade: ag.valorMinimoPorUnidade,
    valorMinimoPorVeiculo: ag.valorMinimoPorVeiculo,
    valorMinimoPorViagem: ag.valorMinimoPorViagem,

    custoRetorno: ag.custoVoltaResolvido,
    impactoRetornoVazio: ag.impactoRetornoVazio,

    receitaRetorno: entrada.receitaRetorno,
    valorNecessarioNaIda: ag.valorNecessarioNaIda,

    valorFreteOferecido: entrada.valorFreteOferecido,
    diferencaOferta: ag.diferencaOferta,
    percentualDiferencaOferta: ag.percentualDiferencaOferta,
    valorAdicionalNecessario: ag.valorAdicionalNecessario,
    descontoMaximo: ag.descontoMaximo,
    lucroEstimadoNaOferta: ag.lucroEstimadoNaOferta,
    margemEstimadaNaOferta: ag.margemEstimadaNaOferta,
    classificacaoOferta: ag.classificacaoOferta,

    nivelCompletude,
    custosIncluidos: ag.custosIncluidos,
    custosIgnorados: ag.custosIgnorados,
    deducoesIncluidas: ag.deducoesIncluidas,
    deducoesIgnoradas: ag.deducoesIgnoradas,
    alertas: ag.alertas,
    premissas: ag.premissas,
    dadosFaltantes: [],
    mensagemResumo,
    limitacoes: LIMITACOES_PADRAO,
    memoriaCalculo,
  };
}

// ---------------------------------------------------------------------------
// Registro da ferramenta
// ---------------------------------------------------------------------------

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "Modo de cálculo do valor mínimo do frete.",
    valoresPossiveis: [
      "PONTO_EQUILIBRIO",
      "MARGEM_ALVO",
      "MARKUP_ALVO",
      "LUCRO_FIXO_ALVO",
      "VALOR_MINIMO_POR_VIAGEM",
      "VALOR_MINIMO_POR_KM",
      "VALOR_MINIMO_POR_KM_CARREGADO",
      "VALOR_MINIMO_POR_TONELADA",
      "VALOR_MINIMO_TONELADA_KM",
      "VALOR_MINIMO_POR_UNIDADE",
      "IDA_E_VOLTA",
      "RETORNO_VAZIO",
      "FRETE_COM_RETORNO",
      "MULTIPLOS_VEICULOS",
      "COMPARAR_COM_OFERTA",
      "COMPARACAO_CENARIOS",
    ],
  },
  { nome: "identificacao", tipo: "string", obrigatorio: false, descricao: "Identificador livre do frete (ex.: número do pedido)." },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre do frete." },
  { nome: "origem", tipo: "string", obrigatorio: false, descricao: "Origem do frete (informativo nesta fase)." },
  { nome: "destino", tipo: "string", obrigatorio: false, descricao: "Destino do frete (informativo nesta fase)." },
  { nome: "tipoCarga", tipo: "string", obrigatorio: false, descricao: "Tipo de carga (informativo nesta fase)." },
  { nome: "distanciaIdaKm", tipo: "number", obrigatorio: false, descricao: "Distância da ida, em km." },
  { nome: "distanciaVoltaKm", tipo: "number", obrigatorio: false, descricao: "Distância da volta, em km." },
  { nome: "distanciaAdicionalKm", tipo: "number", obrigatorio: false, descricao: "Distância adicional (desvios), em km." },
  { nome: "distanciaTotalKm", tipo: "number", obrigatorio: false, descricao: "Distância total da operação, em km (necessária para VALOR_MINIMO_POR_KM)." },
  { nome: "distanciaCarregadaKm", tipo: "number", obrigatorio: false, descricao: "Distância percorrida com carga, em km." },
  { nome: "distanciaVaziaKm", tipo: "number", obrigatorio: false, descricao: "Distância percorrida vazia (retorno), em km." },
  { nome: "pesoCargaToneladas", tipo: "number", obrigatorio: false, descricao: "Peso da carga, em toneladas." },
  { nome: "quantidadeCarga", tipo: "number", obrigatorio: false, descricao: "Quantidade de unidades/volumes/pallets transportados." },
  { nome: "unidadeCarga", tipo: "string", obrigatorio: false, descricao: "Rótulo da unidade de carga (ex.: pallet, caixa)." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos envolvidos na operação." },
  { nome: "quantidadeViagens", tipo: "number", obrigatorio: false, descricao: "Quantidade de viagens do período, para VALOR_MINIMO_POR_VIAGEM." },
  { nome: "custoTotal", tipo: "number", obrigatorio: false, descricao: "Custo total já pronto (por veículo, em MULTIPLOS_VEICULOS)." },
  { nome: "custoIda", tipo: "number", obrigatorio: false, descricao: "Custo do trecho de ida." },
  { nome: "custoVolta", tipo: "number", obrigatorio: false, descricao: "Custo do trecho de volta/retorno." },
  { nome: "custosVariaveis", tipo: "number", obrigatorio: false, descricao: "Custos variáveis detalhados." },
  { nome: "custosFixosRateados", tipo: "number", obrigatorio: false, descricao: "Custos fixos rateados para a operação." },
  { nome: "custosDiretos", tipo: "number", obrigatorio: false, descricao: "Custos diretos detalhados." },
  { nome: "custosIndiretos", tipo: "number", obrigatorio: false, descricao: "Custos indiretos detalhados." },
  { nome: "custosAdministrativos", tipo: "number", obrigatorio: false, descricao: "Custos administrativos detalhados." },
  { nome: "outrosCustos", tipo: "number", obrigatorio: false, descricao: "Outros custos detalhados." },
  { nome: "lucroFixoDesejado", tipo: "number", obrigatorio: false, descricao: "Valor de lucro fixo desejado, em R$ (modo LUCRO_FIXO_ALVO)." },
  { nome: "margemAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "Margem-alvo desejada sobre a receita, em %." },
  { nome: "markupAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "Markup-alvo desejado sobre o custo, em %." },
  { nome: "impostoValor", tipo: "number", obrigatorio: false, descricao: "Imposto em valor fixo." },
  { nome: "impostoPercentual", tipo: "number", obrigatorio: false, descricao: "Imposto em percentual sobre a receita." },
  { nome: "comissaoValor", tipo: "number", obrigatorio: false, descricao: "Comissão em valor fixo." },
  { nome: "comissaoPercentual", tipo: "number", obrigatorio: false, descricao: "Comissão em percentual sobre a receita." },
  { nome: "taxaPlataformaValor", tipo: "number", obrigatorio: false, descricao: "Taxa de plataforma em valor fixo." },
  { nome: "taxaPlataformaPercentual", tipo: "number", obrigatorio: false, descricao: "Taxa de plataforma em percentual sobre a receita." },
  { nome: "outrasDeducoesValor", tipo: "number", obrigatorio: false, descricao: "Outras deduções em valor fixo." },
  { nome: "outrasDeducoesPercentual", tipo: "number", obrigatorio: false, descricao: "Outras deduções em percentual sobre a receita." },
  { nome: "adicionalRiscoValor", tipo: "number", obrigatorio: false, descricao: "Adicional de risco em valor fixo." },
  { nome: "adicionalRiscoPercentual", tipo: "number", obrigatorio: false, descricao: "Adicional de risco em percentual (exige interpretacaoAdicionalRisco)." },
  { nome: "interpretacaoAdicionalRisco", tipo: "enum", obrigatorio: false, descricao: "Base do adicional de risco percentual.", valoresPossiveis: ["SOBRE_CUSTO", "SOBRE_VALOR_MINIMO", "SOBRE_RECEITA"] },
  { nome: "custoCapitalValor", tipo: "number", obrigatorio: false, descricao: "Custo de capital em valor fixo." },
  { nome: "custoCapitalPercentual", tipo: "number", obrigatorio: false, descricao: "Custo de capital em percentual (sobre a receita, ou taxa por período quando usado com capitalEmpregadoValor)." },
  { nome: "capitalEmpregadoValor", tipo: "number", obrigatorio: false, descricao: "Capital empregado, para o sub-cálculo de custo de capital (juros simples/compostos)." },
  { nome: "custoCapitalMetodo", tipo: "enum", obrigatorio: false, descricao: "Método do sub-cálculo de custo de capital.", valoresPossiveis: ["VALOR_FIXO", "JUROS_SIMPLES", "JUROS_COMPOSTOS", "PERCENTUAL_DIRETO"] },
  { nome: "custoCapitalPeriodos", tipo: "number", obrigatorio: false, descricao: "Quantidade de períodos para o sub-cálculo de custo de capital." },
  { nome: "valorFreteOferecido", tipo: "number", obrigatorio: false, descricao: "Valor oferecido pelo contratante, para comparação (modo COMPARAR_COM_OFERTA)." },
  { nome: "precoInicialNegociacao", tipo: "number", obrigatorio: false, descricao: "Preço inicial de negociação, para o cálculo de desconto máximo." },
  { nome: "receitaRetorno", tipo: "number", obrigatorio: false, descricao: "Receita do trecho de retorno, quando remunerado." },
  { nome: "criterioRateioReceitaRetorno", tipo: "enum", obrigatorio: false, descricao: "Critério de rateio da necessidade de receita entre ida e volta.", valoresPossiveis: ["POR_CUSTO_DO_TRECHO", "POR_DISTANCIA", "POR_PESO", "MANUAL", "NAO_RATEAR"] },
  { nome: "valorRateioManualIda", tipo: "number", obrigatorio: false, descricao: "Parte da necessidade de receita alocada à ida, quando o critério é MANUAL." },
  { nome: "prazoPagamentoDias", tipo: "number", obrigatorio: false, descricao: "Prazo de pagamento combinado, em dias." },
  { nome: "adiantamento", tipo: "number", obrigatorio: false, descricao: "Valor de adiantamento recebido." },
  { nome: "cenarios", tipo: "string", obrigatorio: false, descricao: "Lista de cenários a comparar (modo COMPARACAO_CENARIOS, ao menos 2)." },
  { nome: "estrategiaSobreposicaoCusto", tipo: "enum", obrigatorio: false, descricao: "Estratégia para custo informado por mais de uma fonte.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"] },
  { nome: "estrategiaSobreposicaoDeducao", tipo: "enum", obrigatorio: false, descricao: "Estratégia para dedução informada como valor fixo e percentual.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_VALOR_FIXO", "PRIORIZAR_PERCENTUAL"] },
  { nome: "baseCalculoPercentuais", tipo: "enum", obrigatorio: false, descricao: "Base sobre a qual os percentuais de dedução incidem.", valoresPossiveis: ["RECEITA_BRUTA", "RECEITA_APOS_IMPOSTOS", "RECEITA_LIQUIDA", "CUSTO_TOTAL", "VALOR_FIXO"] },
  { nome: "arredondamentoComercial", tipo: "enum", obrigatorio: false, descricao: "Regra de arredondamento comercial aplicada só na saída.", valoresPossiveis: ["SEM_ARREDONDAMENTO", "PROXIMO_REAL", "PROXIMO_5", "PROXIMO_10", "PROXIMO_50", "PROXIMO_100", "SEMPRE_PARA_CIMA"] },
  { nome: "toleranciaClassificacaoOfertaPercentual", tipo: "number", obrigatorio: false, descricao: "Tolerância (%) para classificar a oferta como no ponto de equilíbrio/na margem-alvo." },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve todas as casas decimais padrão da saída." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Sinaliza que parte dos dados são estimativas." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaCalcularValorMinimoFrete: DefinicaoFerramenta<CalcularValorMinimoFreteEntrada, CalcularValorMinimoFreteResultado> = {
  nome: "calcular_valor_minimo_frete",
  descricao:
    "Calcula o valor econômico mínimo que um frete precisa pagar para cobrir custos, atingir o ponto de equilíbrio, uma margem-alvo, um markup-alvo ou um lucro fixo desejado, e compara com o valor oferecido.",
  objetivo: "Definir o piso de negociação de um frete e responder se um valor oferecido cobre os custos e a margem desejada.",
  parametros: PARAMETROS,
  executar: calcularValorMinimoFrete,
};
