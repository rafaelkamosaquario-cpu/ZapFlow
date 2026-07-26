import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, NivelCompletude, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO, CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";
import { CASAS_DECIMAIS_DISTANCIA_PADRAO } from "./calcular-custo-viagem";
import { calcularMargem } from "./calcular-margem";
import type { ResumoCustoViagem } from "./calcular-margem";
import { calcularCpk } from "./calcular-cpk";
import { calcularValorMinimoFrete } from "./calcular-valor-minimo-frete";
import type { ResumoCpkParaCusto } from "./calcular-valor-minimo-frete";
import { calcularReceitaKm } from "./calcular-receita-km";

/**
 * Ferramenta: calcular_custo_dia
 *
 * Calcula e interpreta o custo diário de um veículo, conjunto veicular,
 * operação, rota, contrato, frota, período, veículo trabalhando, parado ou
 * disponível sem receita — sempre diferenciando custo fixo de variável,
 * dia corrido de dia útil/operado/disponível, e nunca dividindo custos
 * mensais/anuais por 30/365 silenciosamente (só sob `permitirEstimativas`,
 * com premissa registrada). Nunca afirma que um veículo parado tem custo
 * zero, nem soma o custo do veículo parado duas vezes quando já incluído
 * no custo fixo diário.
 *
 * Atua como coordenadora: reutiliza `calcularMargem` (modo `MARGEM_SIMPLES`)
 * para lucro/margem diária quando receita e custo diário já são conhecidos
 * (mesma técnica de `calcular_receita_km`); reutiliza `calcularValorMinimoFrete`
 * (modos `PONTO_EQUILIBRIO`/`MARGEM_ALVO`) para a receita de equilíbrio e a
 * receita mínima para a margem-alvo diária, já considerando deduções
 * percentuais, sem reimplementar essas equações; reutiliza `calcularCpk`
 * (modo `CPK_PNEUS` como divisor genérico valor ÷ km) para toda divisão
 * segura contra zero (custo por km, por hora, por veículo, por motorista,
 * por ajudante, por viagem); reutiliza `calcularReceitaKm` (modo
 * `RECEITA_BRUTA_POR_KM`) quando a receita diária é informada como valor
 * por km × quilometragem, em vez de reimplementar aquela resolução.
 *
 * Aceita o custo de uma viagem já calculado por `calcular-custo-viagem.ts`
 * via `resumoCustoViagem` (mesma interface reexportada por
 * `calcular-margem.ts`) e o CPK de `calcular-cpk.ts` via `resumoCpk` (tipo
 * reexportado por `calcular-valor-minimo-frete.ts`). Cria só um ponto de
 * extensão decoupled (`resumoCustoVeiculoParado`) para a futura
 * `calcular-custo-veiculo-parado.ts` — sem importar aquele módulo, que
 * ainda não existe.
 *
 * Sem APIs externas nesta fase. Nunca inventa custo, salário, encargos,
 * financiamento, seguro, manutenção, combustível, quilometragem, dias,
 * horas, receita, margem ou quantidade de veículos/pessoas não informados.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

const CASAS_DECIMAIS_HORA_PADRAO = 2;
const CASAS_DECIMAIS_DIA_PADRAO = 2;

/** Dias assumidos por periodicidade quando não há período explícito — só usados sob `permitirEstimativas`, sempre com premissa registrada. */
const DIAS_ESTIMADOS_PADRAO = {
  SEMANAL: 7,
  QUINZENAL: 15,
  DIAS_POR_MES: 30,
};
const MESES_POR_PERIODICIDADE: Record<string, number> = { BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };

/** Tolerância padrão (em % do indicador) para não tratar ruído de ponto flutuante como classificação incorreta. */
const TOLERANCIA_CLASSIFICACAO_PERCENTUAL_PADRAO = 0.5;
/** Limite de ociosidade (%) acima do qual, no modo VEICULO_OCIOSO, a classificação passa a OCIOSIDADE_ALTA. */
const LIMITE_OCIOSIDADE_ALTA_PERCENTUAL_PADRAO = 30;

const LIMITACOES_PADRAO: string[] = [
  "Esta ferramenta não calcula custos, salário, encargos, financiamento, seguro, manutenção, combustível, quilometragem, dias, horas ou receita automaticamente — todos os valores vêm do que foi informado.",
  'Um veículo parado nunca é tratado como "sem custo" — os custos fixos que continuam existindo (financiamento, seguro, licenciamento etc.) são sempre considerados, mesmo sem operação.',
  "Custos mensais/anuais sem base de rateio explícita (tipo de dia + quantidade de dias) não são convertidos silenciosamente para diário — só sob \"permitirEstimativas\", com a premissa sempre registrada (nunca assume 30 ou 365 dias por padrão).",
  "A consolidação de múltiplos veículos usa sempre custo total ÷ quilometragem total (média ponderada), nunca a média simples dos custos por km individuais.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoCustoDia =
  | "CUSTO_FIXO_DIARIO"
  | "CUSTO_VARIAVEL_DIARIO"
  | "CUSTO_TOTAL_DIARIO"
  | "CUSTO_POR_DIA_CORRIDO"
  | "CUSTO_POR_DIA_UTIL"
  | "CUSTO_POR_DIA_OPERADO"
  | "CUSTO_POR_DIA_DISPONIVEL"
  | "CUSTO_VEICULO_DIA"
  | "CUSTO_FROTA_DIA"
  | "CUSTO_VIAGEM_POR_DIA"
  | "VEICULO_OPERANDO"
  | "VEICULO_PARADO"
  | "VEICULO_OCIOSO"
  | "RECEITA_E_RESULTADO_DIARIO"
  | "PONTO_EQUILIBRIO_DIARIO"
  | "MARGEM_ALVO_DIARIA"
  | "PREVISTO_X_REALIZADO"
  | "ANALISE_POR_PERIODO"
  | "MULTIPLOS_VEICULOS"
  | "COMPARACAO_CENARIOS";

export type TipoDia = "CORRIDO" | "UTIL" | "OPERADO" | "DISPONIVEL" | "VIAGEM" | "PARADO" | "PERSONALIZADO";

export type Periodicidade = "DIARIO" | "SEMANAL" | "QUINZENAL" | "MENSAL" | "BIMESTRAL" | "TRIMESTRAL" | "SEMESTRAL" | "ANUAL" | "POR_PERIODO" | "VALOR_TOTAL" | "PERSONALIZADO";

export type BaseCustoVariavel = "POR_DIA" | "POR_KM" | "POR_HORA" | "POR_VIAGEM" | "POR_VEICULO" | "POR_PESSOA" | "POR_UNIDADE" | "VALOR_TOTAL" | "PERCENTUAL_RECEITA";

/** Estratégia para custo informado por mais de uma fonte (total diário/mensal, detalhado, CPK, ou de outra ferramenta). */
export type EstrategiaSobreposicaoCustoDia = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_TOTAL" | "PRIORIZAR_DETALHADO" | "PRIORIZAR_VALOR_DIARIO" | "PRIORIZAR_FONTE_EXTERNA";

export type TipoPeriodoCustoDia = "DIA" | "SEMANA" | "QUINZENA" | "MES" | "TRIMESTRE" | "ANO" | "PERIODO_PERSONALIZADO";

/**
 * Item de custo fixo — existe independentemente de o veículo rodar.
 * `categoria` é texto livre para documentação, exceto os valores
 * reconhecidos `"SALARIO_COM_ENCARGOS"`/`"ENCARGOS"`, usados para detectar
 * a sobreposição "salário já com encargos" + "encargos separados".
 */
export interface ItemCustoFixo {
  descricao?: string;
  categoria?: string;
  valor: number;
  periodicidade: Periodicidade;
  quantidade?: number;
  /** Quando true, `valor` já é o valor diário — não normalizar de novo. */
  jaRateado?: boolean;
  /** Alternativa a `valor`+`periodicidade`: valor diário já calculado. */
  valorDiarioInformado?: number;
  /** Quando true, este item é ignorado na soma (já está incluído em outro custo informado). */
  incluidoEmOutroCusto?: boolean;
  /** Para periodicidades que não mapeiam para o tipo de dia selecionado (SEMANAL/QUINZENAL/BIMESTRAL/TRIMESTRAL/SEMESTRAL/ANUAL/VALOR_TOTAL/POR_PERIODO). */
  quantidadeDiasPeriodo?: number;
  /** Para periodicidade PERSONALIZADO. */
  quantidadeMesesPeriodo?: number;
  /** Para periodicidade PERSONALIZADO: divisor direto. */
  fatorRateio?: number;
  observacoes?: string;
}

export interface ItemCustoVariavel {
  descricao?: string;
  categoria?: string;
  valor: number;
  base: BaseCustoVariavel;
  /** Para base POR_UNIDADE. */
  quantidade?: number;
  incluidoEmOutroCusto?: boolean;
  observacoes?: string;
}

/** Resumo normalizado e desacoplado — ponto de extensão para a futura `calcular-custo-veiculo-parado.ts` (ainda não implementada). Não importa aquele módulo. */
export interface ResumoCustoVeiculoParadoParaCustoDia {
  custoDiario?: number;
}

/**
 * Conjunto completo de dados usado pelo cálculo direto, por cada cenário em
 * `COMPARACAO_CENARIOS` e pelos blocos `previsto`/`realizado`.
 */
export interface DadosCustoDiaVariante {
  identificacao?: string;
  descricao?: string;
  tipoDia?: TipoDia;
  periodoInicio?: string;
  periodoFim?: string;
  tipoPeriodo?: TipoPeriodoCustoDia;

  diasCorridosPeriodo?: number;
  diasUteisPeriodo?: number;
  diasOperadosPeriodo?: number;
  diasDisponiveisPeriodo?: number;
  diasParadosPeriodo?: number;
  diasViagem?: number;
  divisorPersonalizado?: number;

  quantidadeVeiculos?: number;
  quantidadeMotoristas?: number;
  quantidadeAjudantes?: number;

  quilometragemDia?: number;
  quilometragemPeriodo?: number;
  horasOperadasDia?: number;
  horasDisponiveisDia?: number;

  custosFixos?: ItemCustoFixo[];
  custosVariaveis?: ItemCustoVariavel[];

  /** Alternativa 1: custo total diário já pronto. */
  custoTotalDiarioInformado?: number;
  /** Alternativa 2: custo total mensal, rateado pelo tipo de dia selecionado. */
  custoTotalMensalInformado?: number;
  /** Alternativa 3: resultado resumido de `calcular-custo-viagem.ts` — dividido por `diasViagem`. */
  resumoCustoViagem?: ResumoCustoViagem;
  /** Alternativa 4: resultado resumido de `calcular-cpk.ts`, multiplicado por `quilometragemDia`. */
  resumoCpk?: ResumoCpkParaCusto;
  /** Alternativa 5: custo por km informado direto, multiplicado por `quilometragemDia`. */
  custoPorKmInformado?: number;
  /** Alternativa 6: custo total de uma viagem, dividido por `diasViagem` (modo CUSTO_VIAGEM_POR_DIA). */
  custoTotalViagemInformado?: number;
  /** Alternativa 7 (ponto de extensão futuro): resultado de `calcular-custo-veiculo-parado.ts`. */
  resumoCustoVeiculoParado?: ResumoCustoVeiculoParadoParaCustoDia;

  /** Sempre somados por cima da fonte de custo principal (fixo+variável), nunca competem por sobreposição entre si. */
  custoFinanceiroDiarioInformado?: number;
  custoAdministrativoDiarioInformado?: number;
  outrosCustosDiariosInformado?: number;
  /** Custos específicos do veículo parado (estacionamento, diária de pátio, reboque etc.), somados ao custo fixo diário no modo VEICULO_PARADO. */
  custosEspecificosParada?: number;

  /** Custo agregado de motoristas/ajudantes, dividido por quantidade — soma-se ao custo variável diário. */
  custoTotalMotoristas?: number;
  custoTotalAjudantes?: number;

  receitaDia?: number;
  receitaPeriodo?: number;
  /** Receita diária = valor por km × quilometragemDia, resolvida via `calcular_receita_km`. */
  receitaPorKmInformada?: number;

  impostoPercentual?: number;
  comissaoPercentual?: number;
  outrasDeducoesPercentual?: number;
  margemAlvoPercentual?: number;
}

export interface CenarioCustoDia extends DadosCustoDiaVariante {
  id?: string;
  nome?: string;
}

/** Entrada por veículo, para `MULTIPLOS_VEICULOS`. */
export interface VeiculoCustoDia {
  identificacaoVeiculo?: string;
  placa?: string;
  tipoVeiculo?: string;
  custosFixos?: ItemCustoFixo[];
  custosVariaveis?: ItemCustoVariavel[];
  custoTotalDiarioInformado?: number;
  receitaDia?: number;
  quilometragemDia?: number;
  horasOperadasDia?: number;
  diasOperados?: number;
  diasDisponiveis?: number;
  tipoDia?: TipoDia;
  diasCorridosPeriodo?: number;
  diasUteisPeriodo?: number;
  observacoes?: string;
}

export interface CalcularCustoDiaEntrada extends DadosCustoDiaVariante {
  modo: ModoCustoDia;

  /** Usado apenas em COMPARACAO_CENARIOS — ao menos 2 cenários. */
  cenarios?: CenarioCustoDia[];
  /** Usado apenas em MULTIPLOS_VEICULOS. */
  veiculos?: VeiculoCustoDia[];
  /** Usados apenas em PREVISTO_X_REALIZADO. */
  previsto?: DadosCustoDiaVariante;
  realizado?: DadosCustoDiaVariante;

  estrategiaSobreposicaoCusto?: EstrategiaSobreposicaoCustoDia;
  toleranciaClassificacaoPercentual?: number;

  casasDecimais?: number;
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type ClassificacaoCustoDia = "SEM_RECEITA" | "PREJUIZO" | "PONTO_DE_EQUILIBRIO" | "RESULTADO_BAIXO" | "RESULTADO_POSITIVO" | "ACIMA_DA_META" | "OCIOSIDADE_ALTA" | "DADOS_INSUFICIENTES";

export interface ItemRankingCustoDia {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface ResultadoCenarioCustoDia extends ResultadoFerramentaBase {
  id: string;
  nome: string;
  custoFixoDiario?: number;
  custoVariavelDiario?: number;
  custoTotalDiario?: number;
  custoPorKmDia?: number;
  custoPorHoraOperada?: number;
  receitaDiaria?: number;
  lucroDiario?: number;
  margemDiariaPercentual?: number;
  taxaUtilizacao?: number;
  taxaOciosidade?: number;
  quilometragemDia?: number;
  nivelCompletude: NivelCompletude;
}

export interface ComparacaoCenariosCustoDia {
  cenarios: ResultadoCenarioCustoDia[];
  rankingPorMenorCustoDiario: ItemRankingCustoDia[];
  rankingPorMenorCustoPorKm: ItemRankingCustoDia[];
  rankingPorMaiorLucroDiario: ItemRankingCustoDia[];
  rankingPorMaiorMargem: ItemRankingCustoDia[];
  rankingPorMaiorUtilizacao: ItemRankingCustoDia[];
  rankingPorMenorOciosidade: ItemRankingCustoDia[];
  alertas: string[];
}

export interface DiferencaCustoDia {
  previsto?: number;
  realizado?: number;
  diferenca?: number;
  diferencaPercentual?: number;
}

export interface PrevistoRealizadoCustoDia {
  custoTotalDiario?: DiferencaCustoDia;
  custoPorKmDia?: DiferencaCustoDia;
  receitaDiaria?: DiferencaCustoDia;
  lucroDiario?: DiferencaCustoDia;
  margemDiariaPercentual?: DiferencaCustoDia;
  diasOperados?: DiferencaCustoDia;
  principalDesvio?: string;
  alertas: string[];
}

export interface ResultadoConsolidadoCustoDia {
  quantidadeRegistros: number;
  custoFixoDiarioConsolidado?: number;
  custoVariavelDiarioConsolidado?: number;
  custoTotalDiarioConsolidado?: number;
  receitaDiariaConsolidada?: number;
  lucroDiarioConsolidado?: number;
  margemConsolidadaPercentual?: number;
  quilometragemTotalConsolidada?: number;
  custoPorKmConsolidado?: number;
  diasOperadosTotais?: number;
  diasDisponiveisTotais?: number;
  taxaUtilizacaoConsolidada?: number;
  resultadosIndividuais: ResultadoCenarioCustoDia[];
  rankingPorMenorCustoDiario: ItemRankingCustoDia[];
  rankingPorMenorCustoPorKm: ItemRankingCustoDia[];
  rankingPorMaiorLucroDiario: ItemRankingCustoDia[];
  veiculosComPrejuizo: string[];
  maiorCustoDiario?: string;
  menorCustoDiario?: string;
  melhorLucroDiario?: string;
  piorResultado?: string;
  alertas: string[];
}

export interface CalcularCustoDiaResultado extends ResultadoFerramentaBase {
  modo: ModoCustoDia;
  identificacao?: string;
  descricao?: string;

  tipoDia?: TipoDia;
  baseRateio?: TipoDia;
  diasBase?: number;

  custoFixoDiario?: number;
  custoVariavelDiario?: number;
  custoFinanceiroDiario?: number;
  custoAdministrativoDiario?: number;
  outrosCustosDiarios?: number;
  custoTotalDiario?: number;

  custoDisponibilidadeDia?: number;
  custoDiaOperado?: number;
  custoDiaParado?: number;
  custoDiaOcioso?: number;

  custoPorKmDia?: number;
  custoFixoPorKmDia?: number;
  custoVariavelPorKmDia?: number;
  custoPorHoraOperada?: number;
  custoPorVeiculoDia?: number;
  receitaPorVeiculoDia?: number;
  custoMotoristaDia?: number;
  custoAjudanteDia?: number;
  custoViagemDia?: number;

  receitaDiaria?: number;
  lucroDiario?: number;
  margemDiariaPercentual?: number;

  receitaPontoEquilibrioDia?: number;
  receitaMinimaMargemDia?: number;
  diferencaEquilibrioDia?: number;
  valorAdicionalNecessarioDia?: number;

  diasOperados?: number;
  diasDisponiveis?: number;
  diasParados?: number;
  diasOciosos?: number;
  taxaUtilizacao?: number;
  taxaOciosidade?: number;
  custoFixoOciosidade?: number;

  custoTotalPeriodo?: number;
  receitaTotalPeriodo?: number;
  lucroTotalPeriodo?: number;

  consolidadoVeiculos?: ResultadoConsolidadoCustoDia;
  comparacaoCenarios?: ComparacaoCenariosCustoDia;
  previstoRealizado?: PrevistoRealizadoCustoDia;

  classificacao?: ClassificacaoCustoDia;
  nivelCompletude: NivelCompletude;
  custosIncluidos: string[];
  custosIgnorados: string[];
  dadosPresentes: string[];
  indicadoresNaoAvaliados: string[];
  limitacoes: string[];
  memoriaCalculo: string[];
}

// ---------------------------------------------------------------------------
// Casas decimais
// ---------------------------------------------------------------------------

interface CasasDecimaisCustoDia {
  moeda: number;
  percentual: number;
  custoPorKm: number;
  hora: number;
  dia: number;
  distancia: number;
}

function casasDecimaisDe(entrada: CalcularCustoDiaEntrada): CasasDecimaisCustoDia {
  const override = entrada.casasDecimais;
  return {
    moeda: override ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    percentual: override ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    custoPorKm: override ?? CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO,
    hora: override ?? CASAS_DECIMAIS_HORA_PADRAO,
    dia: override ?? CASAS_DECIMAIS_DIA_PADRAO,
    distancia: override ?? CASAS_DECIMAIS_DISTANCIA_PADRAO,
  };
}

// ---------------------------------------------------------------------------
// Delegação a calcular-cpk.ts (divisões que nunca são negativas)
// ---------------------------------------------------------------------------

function dividirViaCpk(valor: number, divisor: number, casas: number): number | undefined {
  if (divisor <= 0) return undefined;
  const resultado = calcularCpk({ modo: "CPK_PNEUS", custoPneus: valor, quilometragem: divisor, arredondamentoCasasDecimais: casas });
  return resultado.sucesso ? resultado.resultados.cpk : undefined;
}

// ---------------------------------------------------------------------------
// Resolução do tipo de dia / dias base
// ---------------------------------------------------------------------------

const TIPO_DIA_POR_MODO: Partial<Record<ModoCustoDia, TipoDia>> = {
  CUSTO_POR_DIA_CORRIDO: "CORRIDO",
  CUSTO_POR_DIA_UTIL: "UTIL",
  CUSTO_POR_DIA_OPERADO: "OPERADO",
  CUSTO_POR_DIA_DISPONIVEL: "DISPONIVEL",
  CUSTO_VIAGEM_POR_DIA: "VIAGEM",
  VEICULO_PARADO: "PARADO",
};

interface DiasBaseResolvido {
  tipoDia?: TipoDia;
  diasBase?: number;
  erro?: string;
}

function resolverDiasBase(v: DadosCustoDiaVariante, modo: ModoCustoDia, rotulo: string): DiasBaseResolvido {
  const tipoDia = v.tipoDia ?? TIPO_DIA_POR_MODO[modo];
  if (!tipoDia) return {};

  const mapa: Record<TipoDia, number | undefined> = {
    CORRIDO: v.diasCorridosPeriodo,
    UTIL: v.diasUteisPeriodo,
    OPERADO: v.diasOperadosPeriodo,
    DISPONIVEL: v.diasDisponiveisPeriodo,
    VIAGEM: v.diasViagem,
    PARADO: v.diasParadosPeriodo,
    PERSONALIZADO: v.divisorPersonalizado,
  };
  const diasBase = mapa[tipoDia];
  // Não erra por antecipação quando o campo de dias correspondente está
  // ausente — só é exigido quando algo realmente precisar dele (custo
  // mensal informado, ou item de custo fixo com periodicidade que rateia
  // pela base de dias); esses pontos levantam seu próprio erro específico.
  if (diasBase !== undefined && diasBase <= 0) {
    return { tipoDia, erro: `${rotulo}: a base de dias para tipoDia="${tipoDia}" deve ser maior que zero.` };
  }
  return { tipoDia, diasBase };
}

// ---------------------------------------------------------------------------
// Normalização de periodicidade — custos fixos
// ---------------------------------------------------------------------------

interface ItemNormalizado {
  rotulo: string;
  valorDiario: number;
  ignorado: boolean;
}

function normalizarItemCustoFixo(item: ItemCustoFixo, diasBase: number | undefined, permitirEstimativas: boolean | undefined, rotulo: string, alertas: string[], premissas: string[]): { resultado?: ItemNormalizado; erro?: string } {
  const nome = item.descricao ?? item.categoria ?? "custo fixo";
  if (item.incluidoEmOutroCusto) return { resultado: { rotulo: nome, valorDiario: 0, ignorado: true } };
  if (item.jaRateado || item.valorDiarioInformado !== undefined) {
    return { resultado: { rotulo: nome, valorDiario: (item.valorDiarioInformado ?? item.valor) * (item.quantidade ?? 1), ignorado: false } };
  }

  const quantidade = item.quantidade ?? 1;
  const valorBase = item.valor * quantidade;

  if (item.periodicidade === "DIARIO") return { resultado: { rotulo: nome, valorDiario: valorBase, ignorado: false } };

  if (item.periodicidade === "MENSAL" || item.periodicidade === "POR_PERIODO") {
    const divisor = item.quantidadeDiasPeriodo ?? diasBase;
    if (divisor === undefined || divisor <= 0) {
      return { erro: `${rotulo}: "${nome}" (${item.periodicidade}) exige uma base de dias (tipoDia + dias*Periodo, ou "quantidadeDiasPeriodo").` };
    }
    return { resultado: { rotulo: nome, valorDiario: valorBase / divisor, ignorado: false } };
  }

  if (item.periodicidade === "VALOR_TOTAL") {
    if (item.quantidadeDiasPeriodo === undefined || item.quantidadeDiasPeriodo <= 0) {
      return { erro: `${rotulo}: "${nome}" (VALOR_TOTAL) exige "quantidadeDiasPeriodo".` };
    }
    return { resultado: { rotulo: nome, valorDiario: valorBase / item.quantidadeDiasPeriodo, ignorado: false } };
  }

  if (item.periodicidade === "SEMANAL" || item.periodicidade === "QUINZENAL") {
    let divisor = item.quantidadeDiasPeriodo;
    if (divisor === undefined) {
      if (!permitirEstimativas) {
        return { erro: `${rotulo}: "${nome}" (${item.periodicidade}) exige "quantidadeDiasPeriodo", ou habilite "permitirEstimativas" para usar um padrão (${item.periodicidade === "SEMANAL" ? DIAS_ESTIMADOS_PADRAO.SEMANAL : DIAS_ESTIMADOS_PADRAO.QUINZENAL} dias).` };
      }
      divisor = item.periodicidade === "SEMANAL" ? DIAS_ESTIMADOS_PADRAO.SEMANAL : DIAS_ESTIMADOS_PADRAO.QUINZENAL;
      premissas.push(`${rotulo}: "${nome}" — assumidos ${divisor} dias corridos para ${item.periodicidade.toLowerCase()} (estimativa, "permitirEstimativas" habilitado).`);
    }
    return { resultado: { rotulo: nome, valorDiario: valorBase / divisor, ignorado: false } };
  }

  if (item.periodicidade === "BIMESTRAL" || item.periodicidade === "TRIMESTRAL" || item.periodicidade === "SEMESTRAL" || item.periodicidade === "ANUAL") {
    let divisor = item.quantidadeDiasPeriodo;
    if (divisor === undefined) {
      if (!permitirEstimativas) {
        return { erro: `${rotulo}: "${nome}" (${item.periodicidade}) exige "quantidadeDiasPeriodo" (dias corridos do período completo), ou habilite "permitirEstimativas".` };
      }
      divisor = MESES_POR_PERIODICIDADE[item.periodicidade] * DIAS_ESTIMADOS_PADRAO.DIAS_POR_MES;
      premissas.push(`${rotulo}: "${nome}" — assumidos ${divisor} dias corridos para ${item.periodicidade.toLowerCase()} (${MESES_POR_PERIODICIDADE[item.periodicidade]} meses × ${DIAS_ESTIMADOS_PADRAO.DIAS_POR_MES} dias, estimativa).`);
    }
    return { resultado: { rotulo: nome, valorDiario: valorBase / divisor, ignorado: false } };
  }

  // PERSONALIZADO
  if (item.fatorRateio !== undefined && item.fatorRateio > 0) {
    return { resultado: { rotulo: nome, valorDiario: valorBase / item.fatorRateio, ignorado: false } };
  }
  if (item.quantidadeMesesPeriodo !== undefined || item.quantidadeDiasPeriodo !== undefined) {
    const diasEstimados = (item.quantidadeMesesPeriodo ?? 0) * DIAS_ESTIMADOS_PADRAO.DIAS_POR_MES + (item.quantidadeDiasPeriodo ?? 0);
    if (diasEstimados > 0) return { resultado: { rotulo: nome, valorDiario: valorBase / diasEstimados, ignorado: false } };
  }
  return { erro: `${rotulo}: "${nome}" (PERSONALIZADO) exige "fatorRateio", ou "quantidadeMesesPeriodo"/"quantidadeDiasPeriodo".` };
}

// ---------------------------------------------------------------------------
// Custos variáveis
// ---------------------------------------------------------------------------

interface ContextoCustoVariavel {
  quilometragemDia?: number;
  horasOperadasDia?: number;
  diasViagem?: number;
  quantidadeVeiculos?: number;
  quantidadePessoas?: number;
  receitaDia?: number;
}

function resolverItemCustoVariavel(item: ItemCustoVariavel, ctx: ContextoCustoVariavel, rotulo: string): { resultado?: ItemNormalizado; erro?: string } {
  const nome = item.descricao ?? item.categoria ?? "custo variável";
  if (item.incluidoEmOutroCusto) return { resultado: { rotulo: nome, valorDiario: 0, ignorado: true } };

  switch (item.base) {
    case "POR_DIA":
    case "VALOR_TOTAL":
      return { resultado: { rotulo: nome, valorDiario: item.valor, ignorado: false } };
    case "POR_KM":
      if (ctx.quilometragemDia === undefined || ctx.quilometragemDia <= 0) return { erro: `${rotulo}: "${nome}" (POR_KM) exige "quilometragemDia" maior que zero.` };
      return { resultado: { rotulo: nome, valorDiario: item.valor * ctx.quilometragemDia, ignorado: false } };
    case "POR_HORA":
      if (ctx.horasOperadasDia === undefined || ctx.horasOperadasDia <= 0) return { erro: `${rotulo}: "${nome}" (POR_HORA) exige "horasOperadasDia" maior que zero.` };
      return { resultado: { rotulo: nome, valorDiario: item.valor * ctx.horasOperadasDia, ignorado: false } };
    case "POR_VIAGEM":
      if (ctx.diasViagem === undefined || ctx.diasViagem <= 0) return { erro: `${rotulo}: "${nome}" (POR_VIAGEM) exige "diasViagem" maior que zero.` };
      return { resultado: { rotulo: nome, valorDiario: item.valor / ctx.diasViagem, ignorado: false } };
    case "POR_VEICULO":
      if (ctx.quantidadeVeiculos === undefined || ctx.quantidadeVeiculos <= 0) return { erro: `${rotulo}: "${nome}" (POR_VEICULO) exige "quantidadeVeiculos" maior que zero.` };
      return { resultado: { rotulo: nome, valorDiario: item.valor * ctx.quantidadeVeiculos, ignorado: false } };
    case "POR_PESSOA":
      if (ctx.quantidadePessoas === undefined || ctx.quantidadePessoas <= 0) return { erro: `${rotulo}: "${nome}" (POR_PESSOA) exige quantidade de motoristas/ajudantes maior que zero.` };
      return { resultado: { rotulo: nome, valorDiario: item.valor * ctx.quantidadePessoas, ignorado: false } };
    case "POR_UNIDADE":
      if (item.quantidade === undefined || item.quantidade <= 0) return { erro: `${rotulo}: "${nome}" (POR_UNIDADE) exige "quantidade" maior que zero.` };
      return { resultado: { rotulo: nome, valorDiario: item.valor * item.quantidade, ignorado: false } };
    case "PERCENTUAL_RECEITA":
      if (ctx.receitaDia === undefined) return { erro: `${rotulo}: "${nome}" (PERCENTUAL_RECEITA) exige "receitaDia" informada.` };
      return { resultado: { rotulo: nome, valorDiario: (item.valor / 100) * ctx.receitaDia, ignorado: false } };
    default:
      return { erro: `${rotulo}: "${nome}" tem base de custo desconhecida.` };
  }
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — fonte de custo (fixo+variável x total x mensal x CPK x fonte externa)
// ---------------------------------------------------------------------------

interface CandidatoCustoDia {
  chave: "total" | "mensal" | "externa" | "cpk" | "detalhado";
  rotulo: string;
  valorDiario: number;
  custoFixoDiario?: number;
  custoVariavelDiario?: number;
}

interface FonteCustoResolvidaDia {
  custoFixoDiario?: number;
  custoVariavelDiario?: number;
  custoPrincipalDiario?: number;
  custosIncluidos: string[];
  custosIgnorados: string[];
  alertas: string[];
  premissas: string[];
  erro?: string;
}

function resolverCustoPrincipal(v: DadosCustoDiaVariante, diasBase: DiasBaseResolvido, estrategia: EstrategiaSobreposicaoCustoDia, permitirEstimativas: boolean | undefined, rotulo: string): FonteCustoResolvidaDia {
  const alertas: string[] = [];
  const premissas: string[] = [];
  const candidatos: CandidatoCustoDia[] = [];

  if (v.custoTotalDiarioInformado !== undefined) {
    candidatos.push({ chave: "total", rotulo: "custoTotalDiarioInformado", valorDiario: v.custoTotalDiarioInformado });
  }
  if (v.custoTotalMensalInformado !== undefined) {
    if (diasBase.diasBase === undefined) {
      return { custosIncluidos: [], custosIgnorados: [], alertas, premissas, erro: `${rotulo}: "custoTotalMensalInformado" exige uma base de rateio (tipoDia + dias*Periodo).` };
    }
    candidatos.push({ chave: "mensal", rotulo: "custoTotalMensalInformado ÷ diasBase", valorDiario: v.custoTotalMensalInformado / diasBase.diasBase });
  }
  if (v.resumoCustoViagem?.custoTotal !== undefined) {
    const divisor = v.diasViagem;
    if (divisor !== undefined && divisor > 0) {
      candidatos.push({ chave: "externa", rotulo: "resumoCustoViagem.custoTotal ÷ diasViagem", valorDiario: v.resumoCustoViagem.custoTotal / divisor });
    }
  }
  if (v.custoTotalViagemInformado !== undefined) {
    if (v.diasViagem === undefined || v.diasViagem <= 0) {
      return { custosIncluidos: [], custosIgnorados: [], alertas, premissas, erro: `${rotulo}: "custoTotalViagemInformado" exige "diasViagem" maior que zero.` };
    }
    candidatos.push({ chave: "externa", rotulo: "custoTotalViagemInformado ÷ diasViagem", valorDiario: v.custoTotalViagemInformado / v.diasViagem });
  }
  if (v.resumoCustoVeiculoParado?.custoDiario !== undefined) {
    candidatos.push({ chave: "externa", rotulo: "resumoCustoVeiculoParado.custoDiario", valorDiario: v.resumoCustoVeiculoParado.custoDiario });
  }
  if (v.resumoCpk?.cpk !== undefined) {
    if (v.quilometragemDia === undefined || v.quilometragemDia <= 0) {
      return { custosIncluidos: [], custosIgnorados: [], alertas, premissas, erro: `${rotulo}: "resumoCpk" exige "quilometragemDia" maior que zero.` };
    }
    candidatos.push({ chave: "cpk", rotulo: "resumoCpk.cpk × quilometragemDia", valorDiario: v.resumoCpk.cpk * v.quilometragemDia });
  }
  if (v.custoPorKmInformado !== undefined) {
    if (v.quilometragemDia === undefined || v.quilometragemDia <= 0) {
      return { custosIncluidos: [], custosIgnorados: [], alertas, premissas, erro: `${rotulo}: "custoPorKmInformado" exige "quilometragemDia" maior que zero.` };
    }
    candidatos.push({ chave: "cpk", rotulo: "custoPorKmInformado × quilometragemDia", valorDiario: v.custoPorKmInformado * v.quilometragemDia });
  }

  // Detalhado: custosFixos + custosVariaveis.
  const custosIncluidos: string[] = [];
  const custosIgnorados: string[] = [];
  const temDetalhado = (v.custosFixos && v.custosFixos.length > 0) || (v.custosVariaveis && v.custosVariaveis.length > 0);

  if (temDetalhado) {
    let somaFixo = 0;
    for (const item of v.custosFixos ?? []) {
      const { resultado, erro } = normalizarItemCustoFixo(item, diasBase.diasBase, permitirEstimativas, rotulo, alertas, premissas);
      if (erro) return { custosIncluidos: [], custosIgnorados: [], alertas, premissas, erro };
      if (resultado) {
        if (resultado.ignorado) custosIgnorados.push(`${resultado.rotulo} (incluído em outro custo)`);
        else {
          somaFixo += resultado.valorDiario;
          custosIncluidos.push(resultado.rotulo);
        }
      }
    }
    // Sobreposição salário-com-encargos x encargos separados (convenção de categoria).
    const categorias = (v.custosFixos ?? []).map((c) => c.categoria);
    if (categorias.includes("SALARIO_COM_ENCARGOS") && categorias.includes("ENCARGOS")) {
      return { custosIncluidos: [], custosIgnorados: [], alertas, premissas, erro: `${rotulo}: custosFixos tem um item "SALARIO_COM_ENCARGOS" e também "ENCARGOS" separado — possível duplicidade. Use apenas uma forma.` };
    }

    let somaVariavel = v.custoTotalMotoristas ?? 0;
    if (v.custoTotalMotoristas !== undefined) custosIncluidos.push("custoTotalMotoristas");
    somaVariavel += v.custoTotalAjudantes ?? 0;
    if (v.custoTotalAjudantes !== undefined) custosIncluidos.push("custoTotalAjudantes");

    const ctx: ContextoCustoVariavel = {
      quilometragemDia: v.quilometragemDia,
      horasOperadasDia: v.horasOperadasDia,
      diasViagem: v.diasViagem,
      quantidadeVeiculos: v.quantidadeVeiculos,
      quantidadePessoas: (v.quantidadeMotoristas ?? 0) + (v.quantidadeAjudantes ?? 0) || undefined,
      receitaDia: v.receitaDia,
    };
    for (const item of v.custosVariaveis ?? []) {
      const { resultado, erro } = resolverItemCustoVariavel(item, ctx, rotulo);
      if (erro) return { custosIncluidos: [], custosIgnorados: [], alertas, premissas, erro };
      if (resultado) {
        if (resultado.ignorado) custosIgnorados.push(`${resultado.rotulo} (incluído em outro custo)`);
        else {
          somaVariavel += resultado.valorDiario;
          custosIncluidos.push(resultado.rotulo);
        }
      }
    }
    candidatos.push({ chave: "detalhado", rotulo: "custosFixos + custosVariaveis detalhados", valorDiario: somaFixo + somaVariavel, custoFixoDiario: somaFixo, custoVariavelDiario: somaVariavel });
  } else if (v.custoTotalMotoristas !== undefined || v.custoTotalAjudantes !== undefined) {
    // Só motoristas/ajudantes, sem itens detalhados: entra como fonte "detalhado" própria.
    const somaVariavel = (v.custoTotalMotoristas ?? 0) + (v.custoTotalAjudantes ?? 0);
    if (v.custoTotalMotoristas !== undefined) custosIncluidos.push("custoTotalMotoristas");
    if (v.custoTotalAjudantes !== undefined) custosIncluidos.push("custoTotalAjudantes");
    candidatos.push({ chave: "detalhado", rotulo: "custoTotalMotoristas + custoTotalAjudantes", valorDiario: somaVariavel, custoFixoDiario: 0, custoVariavelDiario: somaVariavel });
  }

  if (candidatos.length === 0) return { custosIncluidos: [], custosIgnorados: [], alertas, premissas };

  if (candidatos.length > 1) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return {
        custosIncluidos: [],
        custosIgnorados: [],
        alertas,
        premissas,
        erro: `${rotulo}: custo diário informado por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".`,
      };
    }
    let vencedor = candidatos[0];
    if (estrategia === "PRIORIZAR_TOTAL") vencedor = candidatos.find((c) => c.chave === "total") ?? candidatos.find((c) => c.chave === "mensal") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_DETALHADO") vencedor = candidatos.find((c) => c.chave === "detalhado") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_VALOR_DIARIO") vencedor = candidatos.find((c) => c.chave === "total") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_FONTE_EXTERNA") vencedor = candidatos.find((c) => c.chave === "externa") ?? candidatos.find((c) => c.chave === "cpk") ?? candidatos[0];

    alertas.push(`${rotulo}: sobreposição de custo resolvida por "${estrategia}" — usado ${vencedor.rotulo}, ignoradas as demais fontes (${candidatos.filter((c) => c !== vencedor).map((c) => c.rotulo).join(", ")}).`);
    return {
      custoFixoDiario: vencedor.custoFixoDiario,
      custoVariavelDiario: vencedor.custoVariavelDiario,
      custoPrincipalDiario: vencedor.valorDiario,
      custosIncluidos: vencedor.chave === "detalhado" ? custosIncluidos : [vencedor.rotulo],
      custosIgnorados: vencedor.chave === "detalhado" ? custosIgnorados : [],
      alertas,
      premissas,
    };
  }

  const unico = candidatos[0];
  return {
    custoFixoDiario: unico.custoFixoDiario,
    custoVariavelDiario: unico.custoVariavelDiario,
    custoPrincipalDiario: unico.valorDiario,
    custosIncluidos: unico.chave === "detalhado" ? custosIncluidos : [unico.rotulo],
    custosIgnorados: unico.chave === "detalhado" ? custosIgnorados : [],
    alertas,
    premissas,
  };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function coletarCamposNumericos(v: DadosCustoDiaVariante, rotulo: string): Array<[string, number | undefined]> {
  return [
    [`${rotulo}.diasCorridosPeriodo`, v.diasCorridosPeriodo],
    [`${rotulo}.diasUteisPeriodo`, v.diasUteisPeriodo],
    [`${rotulo}.diasOperadosPeriodo`, v.diasOperadosPeriodo],
    [`${rotulo}.diasDisponiveisPeriodo`, v.diasDisponiveisPeriodo],
    [`${rotulo}.diasParadosPeriodo`, v.diasParadosPeriodo],
    [`${rotulo}.diasViagem`, v.diasViagem],
    [`${rotulo}.divisorPersonalizado`, v.divisorPersonalizado],
    [`${rotulo}.quantidadeVeiculos`, v.quantidadeVeiculos],
    [`${rotulo}.quantidadeMotoristas`, v.quantidadeMotoristas],
    [`${rotulo}.quantidadeAjudantes`, v.quantidadeAjudantes],
    [`${rotulo}.quilometragemDia`, v.quilometragemDia],
    [`${rotulo}.quilometragemPeriodo`, v.quilometragemPeriodo],
    [`${rotulo}.horasOperadasDia`, v.horasOperadasDia],
    [`${rotulo}.horasDisponiveisDia`, v.horasDisponiveisDia],
    [`${rotulo}.custoTotalDiarioInformado`, v.custoTotalDiarioInformado],
    [`${rotulo}.custoTotalMensalInformado`, v.custoTotalMensalInformado],
    [`${rotulo}.custoPorKmInformado`, v.custoPorKmInformado],
    [`${rotulo}.custoTotalViagemInformado`, v.custoTotalViagemInformado],
    [`${rotulo}.custoFinanceiroDiarioInformado`, v.custoFinanceiroDiarioInformado],
    [`${rotulo}.custoAdministrativoDiarioInformado`, v.custoAdministrativoDiarioInformado],
    [`${rotulo}.outrosCustosDiariosInformado`, v.outrosCustosDiariosInformado],
    [`${rotulo}.custosEspecificosParada`, v.custosEspecificosParada],
    [`${rotulo}.custoTotalMotoristas`, v.custoTotalMotoristas],
    [`${rotulo}.custoTotalAjudantes`, v.custoTotalAjudantes],
    [`${rotulo}.receitaDia`, v.receitaDia],
    [`${rotulo}.receitaPeriodo`, v.receitaPeriodo],
    [`${rotulo}.receitaPorKmInformada`, v.receitaPorKmInformada],
  ];
}

function validarVariante(v: DadosCustoDiaVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) erros.push(`O campo "${campo}" não pode ser negativo.`);
  }

  for (const [campo, valor] of [
    [`${rotulo}.impostoPercentual`, v.impostoPercentual],
    [`${rotulo}.comissaoPercentual`, v.comissaoPercentual],
    [`${rotulo}.outrasDeducoesPercentual`, v.outrasDeducoesPercentual],
    [`${rotulo}.margemAlvoPercentual`, v.margemAlvoPercentual],
  ] as Array<[string, number | undefined]>) {
    if (valor !== undefined && (valor < 0 || valor > 100)) erros.push(`"${campo}" deve estar entre 0 e 100.`);
  }

  if (v.diasOperadosPeriodo !== undefined && v.diasDisponiveisPeriodo !== undefined && v.diasOperadosPeriodo > v.diasDisponiveisPeriodo) {
    erros.push(`${rotulo}: "diasOperadosPeriodo" (${v.diasOperadosPeriodo}) não pode ser maior que "diasDisponiveisPeriodo" (${v.diasDisponiveisPeriodo}).`);
  }

  const fontesCusto = [
    v.custoTotalDiarioInformado !== undefined,
    v.custoTotalMensalInformado !== undefined,
    v.resumoCustoViagem?.custoTotal !== undefined,
    v.custoTotalViagemInformado !== undefined,
    v.resumoCustoVeiculoParado?.custoDiario !== undefined,
    v.resumoCpk?.cpk !== undefined,
    v.custoPorKmInformado !== undefined,
    (v.custosFixos && v.custosFixos.length > 0) || (v.custosVariaveis && v.custosVariaveis.length > 0),
  ].filter(Boolean).length;
  if (fontesCusto > 1) {
    erros.push(`${rotulo}: custo informado por mais de uma fonte — conflito tratado em resolverCustoPrincipal (verifique estrategiaSobreposicaoCusto).`);
  }

  for (const item of v.custosFixos ?? []) {
    if (item.valor < 0) erros.push(`${rotulo}: item de custo fixo "${item.descricao ?? item.categoria ?? "?"}" tem valor negativo.`);
  }
  for (const item of v.custosVariaveis ?? []) {
    if (item.valor < 0) erros.push(`${rotulo}: item de custo variável "${item.descricao ?? item.categoria ?? "?"}" tem valor negativo.`);
    if (item.base === "PERCENTUAL_RECEITA" && v.receitaDia === undefined) {
      erros.push(`${rotulo}: item "${item.descricao ?? item.categoria ?? "?"}" usa PERCENTUAL_RECEITA sem "receitaDia" informada.`);
    }
  }

  return erros;
}

const MODOS_QUE_EXIGEM_KM: ModoCustoDia[] = ["CUSTO_VEICULO_DIA"];
const MODOS_QUE_EXIGEM_VEICULOS: ModoCustoDia[] = ["CUSTO_FROTA_DIA"];
const MODOS_QUE_EXIGEM_DIAS_VIAGEM: ModoCustoDia[] = ["CUSTO_VIAGEM_POR_DIA"];

function validarEstruturaTopo(entrada: CalcularCustoDiaEntrada): string[] {
  const erros: string[] = [];

  if (entrada.modo === "COMPARACAO_CENARIOS" && (!entrada.cenarios || entrada.cenarios.length < 2)) {
    erros.push("COMPARACAO_CENARIOS exige ao menos dois cenários em \"cenarios\".");
  }
  if (entrada.modo === "PREVISTO_X_REALIZADO" && (!entrada.previsto || !entrada.realizado)) {
    erros.push('PREVISTO_X_REALIZADO exige os blocos "previsto" e "realizado" completos.');
  }
  if (entrada.modo === "MULTIPLOS_VEICULOS") {
    if (!entrada.veiculos || entrada.veiculos.length === 0) {
      erros.push('MULTIPLOS_VEICULOS exige ao menos um veículo em "veiculos".');
    }
    if (entrada.veiculos && entrada.veiculos.length > 0 && (entrada.custoTotalDiarioInformado !== undefined || (entrada.custosFixos && entrada.custosFixos.length > 0))) {
      erros.push('MULTIPLOS_VEICULOS: "veiculos" foi informado junto de custos consolidados diretos — informe apenas uma fonte.');
    }
  }
  if (entrada.modo === "MARGEM_ALVO_DIARIA" && entrada.margemAlvoPercentual === undefined) {
    erros.push('O modo MARGEM_ALVO_DIARIA exige "margemAlvoPercentual".');
  }
  if (MODOS_QUE_EXIGEM_KM.includes(entrada.modo) && !(entrada.quilometragemDia !== undefined && entrada.quilometragemDia > 0)) {
    erros.push(`O modo ${entrada.modo} exige "quilometragemDia" maior que zero.`);
  }
  if (MODOS_QUE_EXIGEM_VEICULOS.includes(entrada.modo) && !(entrada.quantidadeVeiculos !== undefined && entrada.quantidadeVeiculos > 0)) {
    erros.push(`O modo ${entrada.modo} exige "quantidadeVeiculos" maior que zero.`);
  }
  if (MODOS_QUE_EXIGEM_DIAS_VIAGEM.includes(entrada.modo) && !(entrada.diasViagem !== undefined && entrada.diasViagem > 0)) {
    erros.push(`O modo ${entrada.modo} exige "diasViagem" maior que zero.`);
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Núcleo de cálculo
// ---------------------------------------------------------------------------

interface AgregacaoCustoDia {
  tipoDia?: TipoDia;
  diasBase?: number;

  custoFixoDiario?: number;
  custoVariavelDiario?: number;
  custoFinanceiroDiario?: number;
  custoAdministrativoDiario?: number;
  outrosCustosDiarios?: number;
  custoTotalDiario?: number;

  custoDisponibilidadeDia?: number;
  custoDiaOperado?: number;
  custoDiaParado?: number;
  custoDiaOcioso?: number;

  custoPorKmDia?: number;
  custoFixoPorKmDia?: number;
  custoVariavelPorKmDia?: number;
  custoPorHoraOperada?: number;
  custoPorVeiculoDia?: number;
  receitaPorVeiculoDia?: number;
  custoMotoristaDia?: number;
  custoAjudanteDia?: number;
  custoViagemDia?: number;

  receitaDiaria?: number;
  lucroDiario?: number;
  margemDiariaPercentual?: number;

  receitaPontoEquilibrioDia?: number;
  receitaMinimaMargemDia?: number;
  diferencaEquilibrioDia?: number;
  valorAdicionalNecessarioDia?: number;

  diasOperados?: number;
  diasDisponiveis?: number;
  diasParados?: number;
  diasOciosos?: number;
  taxaUtilizacao?: number;
  taxaOciosidade?: number;
  custoFixoOciosidade?: number;

  classificacao?: ClassificacaoCustoDia;

  custosIncluidos: string[];
  custosIgnorados: string[];
  dadosPresentes: string[];
  indicadoresNaoAvaliados: string[];
  alertas: string[];
  premissas: string[];
  dadosFaltantes: string[];
  errosValidacao: string[];

  custoValido: boolean;
}

interface ConfigCustoDia {
  estrategiaCusto: EstrategiaSobreposicaoCustoDia;
  toleranciaPercentual: number;
  permitirEstimativas?: boolean;
  casas: CasasDecimaisCustoDia;
}

function calcularNucleo(v: DadosCustoDiaVariante, modo: ModoCustoDia, config: ConfigCustoDia, rotulo: string): AgregacaoCustoDia {
  const alertas: string[] = [];
  const premissas: string[] = [];
  const dadosFaltantes: string[] = [];
  const dadosPresentes: string[] = [];
  const indicadoresNaoAvaliados: string[] = [];
  const errosValidacao: string[] = [];

  const diasBase = resolverDiasBase(v, modo, rotulo);
  if (diasBase.erro) errosValidacao.push(diasBase.erro);

  const fonte = resolverCustoPrincipal(v, diasBase, config.estrategiaCusto, config.permitirEstimativas, rotulo);
  if (fonte.erro) errosValidacao.push(fonte.erro);
  alertas.push(...fonte.alertas);
  premissas.push(...fonte.premissas);

  if (fonte.custoPrincipalDiario === undefined) {
    dadosFaltantes.push(`${rotulo}.custoTotalDiarioInformado (ou custos detalhados, ou fonte equivalente)`);
  } else {
    dadosPresentes.push("custo");
  }

  if (errosValidacao.length > 0 || dadosFaltantes.length > 0) {
    return {
      tipoDia: diasBase.tipoDia,
      diasBase: diasBase.diasBase,
      custosIncluidos: [],
      custosIgnorados: [],
      dadosPresentes,
      indicadoresNaoAvaliados,
      alertas,
      premissas,
      dadosFaltantes,
      errosValidacao,
      custoValido: fonte.custoPrincipalDiario !== undefined,
    };
  }

  const c = config.casas.moeda;
  const p = config.casas.percentual;
  const rpk = config.casas.custoPorKm;

  const custoFinanceiroDiario = v.custoFinanceiroDiarioInformado ?? 0;
  const custoAdministrativoDiario = v.custoAdministrativoDiarioInformado ?? 0;
  const outrosCustosDiarios = v.outrosCustosDiariosInformado ?? 0;
  const custoTotalDiario = (fonte.custoPrincipalDiario as number) + custoFinanceiroDiario + custoAdministrativoDiario + outrosCustosDiarios;

  // Custo do dia parado / ocioso / operado.
  let custoDiaParado: number | undefined;
  if (modo === "VEICULO_PARADO") {
    custoDiaParado = (fonte.custoFixoDiario ?? custoTotalDiario) + (v.custosEspecificosParada ?? 0);
  }
  const custoDiaOperado = modo === "VEICULO_OPERANDO" ? custoTotalDiario : undefined;

  // Utilização / ociosidade.
  const diasOperados = v.diasOperadosPeriodo;
  const diasDisponiveis = v.diasDisponiveisPeriodo;
  const diasOciosos = diasOperados !== undefined && diasDisponiveis !== undefined ? Math.max(0, diasDisponiveis - diasOperados) : undefined;
  const taxaUtilizacao = diasOperados !== undefined && diasDisponiveis !== undefined && diasDisponiveis > 0 ? arredondar((diasOperados / diasDisponiveis) * 100, p) : undefined;
  const taxaOciosidade = diasOciosos !== undefined && diasDisponiveis !== undefined && diasDisponiveis > 0 ? arredondar((diasOciosos / diasDisponiveis) * 100, p) : undefined;
  const custoFixoOciosidade = diasOciosos !== undefined && fonte.custoFixoDiario !== undefined ? arredondar(fonte.custoFixoDiario * diasOciosos, c) : undefined;

  let custoDiaOcioso: number | undefined;
  if (modo === "VEICULO_OCIOSO") {
    custoDiaOcioso = fonte.custoFixoDiario ?? custoTotalDiario;
  }

  const custoDisponibilidadeDia = modo === "VEICULO_OCIOSO" || modo === "VEICULO_PARADO" ? fonte.custoFixoDiario ?? custoTotalDiario : undefined;

  // Divisões por km/hora/veículo/motorista/ajudante/viagem — sempre via calcularCpk.
  const custoPorKmDia = v.quilometragemDia !== undefined && v.quilometragemDia > 0 ? dividirViaCpk(custoTotalDiario, v.quilometragemDia, rpk) : undefined;
  const custoFixoPorKmDia = v.quilometragemDia !== undefined && v.quilometragemDia > 0 && fonte.custoFixoDiario !== undefined ? dividirViaCpk(fonte.custoFixoDiario, v.quilometragemDia, rpk) : undefined;
  const custoVariavelPorKmDia = v.quilometragemDia !== undefined && v.quilometragemDia > 0 && fonte.custoVariavelDiario !== undefined ? dividirViaCpk(fonte.custoVariavelDiario, v.quilometragemDia, rpk) : undefined;
  if (v.quilometragemDia !== undefined && v.quilometragemDia > 0 && fonte.custoFixoDiario !== undefined) {
    alertas.push("O custo fixo por km aumenta quando a quilometragem diária diminui — não é um custo por km real, é o custo fixo distribuído sobre os km rodados no dia.");
  }
  const custoPorHoraOperada = v.horasOperadasDia !== undefined && v.horasOperadasDia > 0 ? dividirViaCpk(custoTotalDiario, v.horasOperadasDia, config.casas.hora) : undefined;
  const custoPorVeiculoDia = v.quantidadeVeiculos !== undefined && v.quantidadeVeiculos > 0 ? dividirViaCpk(custoTotalDiario, v.quantidadeVeiculos, c) : undefined;
  const custoMotoristaDia = v.custoTotalMotoristas !== undefined && v.quantidadeMotoristas !== undefined && v.quantidadeMotoristas > 0 ? dividirViaCpk(v.custoTotalMotoristas, v.quantidadeMotoristas, c) : undefined;
  const custoAjudanteDia = v.custoTotalAjudantes !== undefined && v.quantidadeAjudantes !== undefined && v.quantidadeAjudantes > 0 ? dividirViaCpk(v.custoTotalAjudantes, v.quantidadeAjudantes, c) : undefined;
  const custoViagemDia =
    v.custoTotalViagemInformado !== undefined && v.diasViagem !== undefined && v.diasViagem > 0
      ? dividirViaCpk(v.custoTotalViagemInformado, v.diasViagem, c)
      : v.resumoCustoViagem?.custoTotal !== undefined && v.diasViagem !== undefined && v.diasViagem > 0
        ? dividirViaCpk(v.resumoCustoViagem.custoTotal, v.diasViagem, c)
        : undefined;

  // Receita diária.
  let receitaDiaria: number | undefined;
  if (v.receitaDia !== undefined) {
    receitaDiaria = v.receitaDia;
  } else if (v.receitaPeriodo !== undefined && diasBase.diasBase !== undefined) {
    receitaDiaria = arredondar(v.receitaPeriodo / diasBase.diasBase, c);
    premissas.push(`${rotulo}: receita diária = receitaPeriodo ÷ ${diasBase.diasBase} dias (${diasBase.tipoDia}).`);
  } else if (v.receitaPorKmInformada !== undefined && v.quilometragemDia !== undefined && v.quilometragemDia > 0) {
    const resultadoReceita = calcularReceitaKm({ modo: "RECEITA_BRUTA_POR_KM", valorPorKmInformado: v.receitaPorKmInformada, distanciaTotalKm: v.quilometragemDia });
    if (resultadoReceita.sucesso) {
      receitaDiaria = resultadoReceita.receitaBrutaTotal;
      premissas.push(`${rotulo}: receita diária derivada via calcular_receita_km (valor por km × quilometragem do dia).`);
    }
  }

  // Receita por veículo — só quando a receita for consolidada (mais de um veículo).
  const receitaPorVeiculoDia = receitaDiaria !== undefined && v.quantidadeVeiculos !== undefined && v.quantidadeVeiculos > 0 ? dividirViaCpk(receitaDiaria, v.quantidadeVeiculos, c) : undefined;

  // Lucro/margem diária — reutiliza calcularMargem (mesma técnica de calcular_receita_km).
  let lucroDiario: number | undefined;
  let margemDiariaPercentual: number | undefined;
  if (receitaDiaria !== undefined) {
    const resultadoMargem = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: receitaDiaria, custoTotal: custoTotalDiario, estrategiaSobreposicao: "REJEITAR_SOBREPOSICAO" });
    if (resultadoMargem.sucesso) {
      lucroDiario = resultadoMargem.lucroLiquidoEstimado;
      margemDiariaPercentual = resultadoMargem.margemLiquidaPercentual;
    }
  } else {
    indicadoresNaoAvaliados.push("lucroDiario", "margemDiariaPercentual");
  }

  // Ponto de equilíbrio / margem-alvo diária — reutiliza calcularValorMinimoFrete.
  let receitaPontoEquilibrioDia: number | undefined;
  let receitaMinimaMargemDia: number | undefined;
  const resultadoMinimo = calcularValorMinimoFrete({
    modo: v.margemAlvoPercentual !== undefined ? "MARGEM_ALVO" : "PONTO_EQUILIBRIO",
    custoTotal: custoTotalDiario,
    margemAlvoPercentual: v.margemAlvoPercentual,
    impostoPercentual: v.impostoPercentual,
    comissaoPercentual: v.comissaoPercentual,
    outrasDeducoesPercentual: v.outrasDeducoesPercentual,
  });
  if (resultadoMinimo.sucesso) {
    receitaPontoEquilibrioDia = resultadoMinimo.valorPontoEquilibrio;
    receitaMinimaMargemDia = resultadoMinimo.valorMinimoComMargem;
  } else if (v.margemAlvoPercentual !== undefined) {
    errosValidacao.push(...resultadoMinimo.dadosFaltantes);
  }

  if (errosValidacao.length > 0) {
    return {
      tipoDia: diasBase.tipoDia,
      diasBase: diasBase.diasBase,
      custosIncluidos: fonte.custosIncluidos,
      custosIgnorados: fonte.custosIgnorados,
      dadosPresentes,
      indicadoresNaoAvaliados,
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      custoValido: true,
    };
  }

  const alvoEquilibrio = receitaMinimaMargemDia ?? receitaPontoEquilibrioDia;
  const diferencaEquilibrioDia = receitaDiaria !== undefined && alvoEquilibrio !== undefined ? arredondar(receitaDiaria - alvoEquilibrio, c) : undefined;
  const valorAdicionalNecessarioDia = receitaDiaria !== undefined && alvoEquilibrio !== undefined ? arredondar(Math.max(0, alvoEquilibrio - receitaDiaria), c) : undefined;

  // Classificação.
  let classificacao: ClassificacaoCustoDia;
  const tolAbs = custoTotalDiario * (config.toleranciaPercentual / 100);
  if (modo === "VEICULO_OCIOSO" && taxaOciosidade !== undefined && taxaOciosidade >= LIMITE_OCIOSIDADE_ALTA_PERCENTUAL_PADRAO) {
    classificacao = "OCIOSIDADE_ALTA";
  } else if (receitaDiaria === undefined) {
    classificacao = "SEM_RECEITA";
  } else if (lucroDiario !== undefined && lucroDiario < -tolAbs) {
    classificacao = "PREJUIZO";
  } else if (lucroDiario !== undefined && Math.abs(lucroDiario) <= tolAbs) {
    classificacao = "PONTO_DE_EQUILIBRIO";
  } else if (v.margemAlvoPercentual !== undefined && margemDiariaPercentual !== undefined) {
    classificacao = margemDiariaPercentual >= v.margemAlvoPercentual ? "ACIMA_DA_META" : "RESULTADO_BAIXO";
  } else {
    classificacao = "RESULTADO_POSITIVO";
  }

  return {
    tipoDia: diasBase.tipoDia,
    diasBase: diasBase.diasBase,

    custoFixoDiario: fonte.custoFixoDiario !== undefined ? arredondar(fonte.custoFixoDiario, c) : undefined,
    custoVariavelDiario: fonte.custoVariavelDiario !== undefined ? arredondar(fonte.custoVariavelDiario, c) : undefined,
    custoFinanceiroDiario: v.custoFinanceiroDiarioInformado !== undefined ? arredondar(custoFinanceiroDiario, c) : undefined,
    custoAdministrativoDiario: v.custoAdministrativoDiarioInformado !== undefined ? arredondar(custoAdministrativoDiario, c) : undefined,
    outrosCustosDiarios: v.outrosCustosDiariosInformado !== undefined ? arredondar(outrosCustosDiarios, c) : undefined,
    custoTotalDiario: arredondar(custoTotalDiario, c),

    custoDisponibilidadeDia: custoDisponibilidadeDia !== undefined ? arredondar(custoDisponibilidadeDia, c) : undefined,
    custoDiaOperado: custoDiaOperado !== undefined ? arredondar(custoDiaOperado, c) : undefined,
    custoDiaParado: custoDiaParado !== undefined ? arredondar(custoDiaParado, c) : undefined,
    custoDiaOcioso: custoDiaOcioso !== undefined ? arredondar(custoDiaOcioso, c) : undefined,

    custoPorKmDia,
    custoFixoPorKmDia,
    custoVariavelPorKmDia,
    custoPorHoraOperada,
    custoPorVeiculoDia,
    receitaPorVeiculoDia,
    custoMotoristaDia,
    custoAjudanteDia,
    custoViagemDia,

    receitaDiaria: receitaDiaria !== undefined ? arredondar(receitaDiaria, c) : undefined,
    lucroDiario: lucroDiario !== undefined ? arredondar(lucroDiario, c) : undefined,
    margemDiariaPercentual,

    receitaPontoEquilibrioDia,
    receitaMinimaMargemDia,
    diferencaEquilibrioDia,
    valorAdicionalNecessarioDia,

    diasOperados,
    diasDisponiveis,
    diasParados: v.diasParadosPeriodo,
    diasOciosos,
    taxaUtilizacao,
    taxaOciosidade,
    custoFixoOciosidade,

    classificacao,

    custosIncluidos: fonte.custosIncluidos,
    custosIgnorados: fonte.custosIgnorados,
    dadosPresentes,
    indicadoresNaoAvaliados,
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

function determinarCompletude(ag: AgregacaoCustoDia): NivelCompletude {
  if (!ag.custoValido || ag.custoTotalDiario === undefined) return "INSUFICIENTE";
  if (ag.receitaDiaria === undefined) return "PARCIAL";
  if (ag.custosIgnorados.length > 0) return "PARCIAL";
  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirMemoriaCalculo(rotulo: string, ag: AgregacaoCustoDia): string[] {
  const linhas: string[] = [];
  if (ag.tipoDia !== undefined && ag.diasBase !== undefined) linhas.push(`${rotulo}: base de rateio = ${ag.tipoDia} (${formatarNumero(ag.diasBase)} dias).`);
  if (ag.custoFixoDiario !== undefined) linhas.push(`${rotulo}: custo fixo diário = ${formatarBRL(ag.custoFixoDiario)}.`);
  if (ag.custoVariavelDiario !== undefined) linhas.push(`${rotulo}: custo variável diário = ${formatarBRL(ag.custoVariavelDiario)}.`);
  if (ag.custoTotalDiario !== undefined) linhas.push(`${rotulo}: custo total diário = ${formatarBRL(ag.custoTotalDiario)}.`);
  if (ag.custoPorKmDia !== undefined) linhas.push(`${rotulo}: custo por km do dia = ${formatarBRL(ag.custoTotalDiario ?? 0)}/dia.`);
  if (ag.receitaDiaria !== undefined && ag.lucroDiario !== undefined) linhas.push(`${rotulo}: lucro diário = receita (${formatarBRL(ag.receitaDiaria)}) − custo (${formatarBRL(ag.custoTotalDiario ?? 0)}) = ${formatarBRL(ag.lucroDiario)}.`);
  if (ag.receitaPontoEquilibrioDia !== undefined) linhas.push(`${rotulo}: receita de ponto de equilíbrio diária = ${formatarBRL(ag.receitaPontoEquilibrioDia)}.`);
  if (ag.receitaMinimaMargemDia !== undefined) linhas.push(`${rotulo}: receita mínima para a margem-alvo diária = ${formatarBRL(ag.receitaMinimaMargemDia)}.`);
  return linhas;
}

function construirResumo(ag: AgregacaoCustoDia, nivelCompletude: NivelCompletude): string {
  if (ag.custoTotalDiario === undefined) {
    return "Não foi possível calcular o custo diário com os dados informados. Verifique os campos faltantes.";
  }
  const partes: string[] = [];
  if (ag.custoFixoDiario !== undefined && ag.custoVariavelDiario !== undefined) {
    partes.push(`O veículo possui custo fixo diário estimado de ${formatarBRL(ag.custoFixoDiario)} e custo variável diário de ${formatarBRL(ag.custoVariavelDiario)}, totalizando ${formatarBRL(ag.custoTotalDiario)} por dia.`);
  } else {
    partes.push(`O custo total diário foi de ${formatarBRL(ag.custoTotalDiario)}.`);
  }
  if (ag.custoPorKmDia !== undefined) partes.push(`O custo foi de ${formatarBRL(ag.custoPorKmDia)} por km.`);
  if (ag.receitaDiaria !== undefined && ag.lucroDiario !== undefined) {
    const verbo = ag.lucroDiario >= 0 ? "lucro" : "prejuízo";
    partes.push(`A receita informada foi de ${formatarBRL(ag.receitaDiaria)}, resultando em ${verbo} estimado de ${formatarBRL(Math.abs(ag.lucroDiario))}${ag.margemDiariaPercentual !== undefined ? ` e margem de ${formatarNumero(ag.margemDiariaPercentual)}%` : ""}.`);
  }
  if (ag.receitaPontoEquilibrioDia !== undefined) partes.push(`O ponto de equilíbrio diário foi calculado em ${formatarBRL(ag.receitaPontoEquilibrioDia)}.`);
  if (ag.classificacao) partes.push(`Classificação: ${ag.classificacao}.`);
  if (nivelCompletude === "PARCIAL") partes.push("A análise foi classificada como parcial porque nem todos os custos ou a receita foram informados.");
  else if (nivelCompletude === "INSUFICIENTE") partes.push("A análise foi classificada como insuficiente para um resultado confiável.");
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Pipeline por variante
// ---------------------------------------------------------------------------

function analisarVariante(v: DadosCustoDiaVariante, modo: ModoCustoDia, rotulo: string, config: ConfigCustoDia): AgregacaoCustoDia {
  const errosEstrutura = validarVariante(v, rotulo);
  const ag = calcularNucleo(v, modo, config, rotulo);
  if (errosEstrutura.length > 0) ag.errosValidacao = [...errosEstrutura, ...ag.errosValidacao];
  return ag;
}

function paraResultadoCenario(id: string, nome: string, ag: AgregacaoCustoDia): ResultadoCenarioCustoDia {
  const sucesso = ag.errosValidacao.length === 0 && ag.dadosFaltantes.length === 0 && ag.custoTotalDiario !== undefined;
  const nivelCompletude = determinarCompletude(ag);
  return {
    id,
    nome,
    sucesso,
    alertas: ag.alertas,
    premissas: ag.premissas,
    dadosFaltantes: [...ag.dadosFaltantes, ...ag.errosValidacao],
    mensagemResumo: sucesso ? construirResumo(ag, nivelCompletude) : "Não foi possível calcular este registro — verifique os dados faltantes.",
    custoFixoDiario: ag.custoFixoDiario,
    custoVariavelDiario: ag.custoVariavelDiario,
    custoTotalDiario: ag.custoTotalDiario,
    custoPorKmDia: ag.custoPorKmDia,
    custoPorHoraOperada: ag.custoPorHoraOperada,
    receitaDiaria: ag.receitaDiaria,
    lucroDiario: ag.lucroDiario,
    margemDiariaPercentual: ag.margemDiariaPercentual,
    taxaUtilizacao: ag.taxaUtilizacao,
    taxaOciosidade: ag.taxaOciosidade,
    nivelCompletude,
  };
}

function construirRanking(itens: Array<{ id: string; nome: string; valor: number | undefined }>, maiorMelhor: boolean): ItemRankingCustoDia[] {
  const validos = itens.filter((i): i is { id: string; nome: string; valor: number } => i.valor !== undefined);
  const ordenados = [...validos].sort((a, b) => (maiorMelhor ? b.valor - a.valor : a.valor - b.valor));
  return ordenados.map((item, indice) => ({ id: item.id, nome: item.nome, valor: item.valor, posicao: indice + 1 }));
}

// ---------------------------------------------------------------------------
// Comparação de cenários
// ---------------------------------------------------------------------------

function compararCenarios(entrada: CalcularCustoDiaEntrada, config: ConfigCustoDia): { comparacao: ComparacaoCenariosCustoDia; nivelCompletude: NivelCompletude } {
  const cenarios = entrada.cenarios as CenarioCustoDia[];
  const resultados = cenarios.map((cen, indice) => {
    const id = cen.id ?? `cenario-${indice + 1}`;
    const nome = cen.nome ?? cen.id ?? `Cenário ${indice + 1}`;
    const ag = analisarVariante(cen, "CUSTO_TOTAL_DIARIO", nome, config);
    return paraResultadoCenario(id, nome, ag);
  });

  const rankingPorMenorCustoDiario = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoTotalDiario })), false);
  const rankingPorMenorCustoPorKm = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoPorKmDia })), false);
  const rankingPorMaiorLucroDiario = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.lucroDiario })), true);
  const rankingPorMaiorMargem = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.margemDiariaPercentual })), true);
  const rankingPorMaiorUtilizacao = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.taxaUtilizacao })), true);
  const rankingPorMenorOciosidade = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.taxaOciosidade })), false);

  const alertas: string[] = [];
  if (rankingPorMenorCustoDiario.length > 0 && rankingPorMenorCustoPorKm.length > 0 && rankingPorMenorCustoDiario[0].id !== rankingPorMenorCustoPorKm[0].id) {
    alertas.push("O cenário de menor custo diário não é o mesmo de menor custo por km — custo total não é o mesmo que eficiência.");
  }

  const nivelCompletude: NivelCompletude = resultados.every((r) => r.nivelCompletude === "COMPLETO") ? "COMPLETO" : "PARCIAL";

  return {
    comparacao: { cenarios: resultados, rankingPorMenorCustoDiario, rankingPorMenorCustoPorKm, rankingPorMaiorLucroDiario, rankingPorMaiorMargem, rankingPorMaiorUtilizacao, rankingPorMenorOciosidade, alertas },
    nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Consolidação de múltiplos veículos
// ---------------------------------------------------------------------------

function veiculoParaVariante(veic: VeiculoCustoDia): DadosCustoDiaVariante {
  return {
    custosFixos: veic.custosFixos,
    custosVariaveis: veic.custosVariaveis,
    custoTotalDiarioInformado: veic.custoTotalDiarioInformado,
    receitaDia: veic.receitaDia,
    quilometragemDia: veic.quilometragemDia,
    horasOperadasDia: veic.horasOperadasDia,
    diasOperadosPeriodo: veic.diasOperados,
    diasDisponiveisPeriodo: veic.diasDisponiveis,
    tipoDia: veic.tipoDia,
    diasCorridosPeriodo: veic.diasCorridosPeriodo,
    diasUteisPeriodo: veic.diasUteisPeriodo,
  };
}

function consolidarVeiculos(entrada: CalcularCustoDiaEntrada, config: ConfigCustoDia): { consolidado: ResultadoConsolidadoCustoDia; nivelCompletude: NivelCompletude } {
  const veiculos = entrada.veiculos as VeiculoCustoDia[];
  const resultados = veiculos.map((veic, indice) => {
    const id = veic.identificacaoVeiculo ?? veic.placa ?? `veiculo-${indice + 1}`;
    const nome = veic.identificacaoVeiculo ?? veic.placa ?? `Veículo ${indice + 1}`;
    const ag = analisarVariante(veiculoParaVariante(veic), "MULTIPLOS_VEICULOS", nome, config);
    const resultado = paraResultadoCenario(id, nome, ag);
    return { ...resultado, quilometragemDia: veic.quilometragemDia };
  });

  const validos = resultados.filter((r) => r.sucesso);
  const somaCustoFixo = validos.reduce((acc, r) => acc + (r.custoFixoDiario ?? 0), 0);
  const somaCustoVariavel = validos.reduce((acc, r) => acc + (r.custoVariavelDiario ?? 0), 0);
  const somaCustoTotal = validos.reduce((acc, r) => acc + (r.custoTotalDiario ?? 0), 0);
  const somaReceita = validos.reduce((acc, r) => acc + (r.receitaDiaria ?? 0), 0);
  const somaKm = validos.reduce((acc, r) => acc + (r.quilometragemDia ?? 0), 0);
  const somaDiasOperados = validos.reduce((acc, r) => acc + (r.taxaUtilizacao !== undefined ? 1 : 0), 0);

  const c = config.casas.moeda;
  const rpk = config.casas.custoPorKm;
  const p = config.casas.percentual;

  const custoPorKmConsolidado = somaKm > 0 ? dividirViaCpk(somaCustoTotal, somaKm, rpk) : undefined;
  const lucroDiarioConsolidado = validos.some((r) => r.receitaDiaria !== undefined) ? arredondar(somaReceita - somaCustoTotal, c) : undefined;
  const margemConsolidadaPercentual = lucroDiarioConsolidado !== undefined && somaReceita > 0 ? arredondar((lucroDiarioConsolidado / somaReceita) * 100, p) : undefined;

  const rankingPorMenorCustoDiario = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoTotalDiario })), false);
  const rankingPorMenorCustoPorKm = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoPorKmDia })), false);
  const rankingPorMaiorLucroDiario = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.lucroDiario })), true);

  const veiculosComPrejuizo = validos.filter((r) => r.lucroDiario !== undefined && r.lucroDiario < 0).map((r) => r.nome);

  const alertas: string[] = [];
  if (rankingPorMenorCustoDiario.length > 1) {
    alertas.push("O custo por km consolidado da frota usa custo total ÷ quilometragem total (média ponderada), nunca a média simples dos custos por km individuais.");
  }

  const nivelCompletude: NivelCompletude = resultados.length === 0 ? "INSUFICIENTE" : validos.length === resultados.length ? "COMPLETO" : validos.length > 0 ? "PARCIAL" : "INSUFICIENTE";

  return {
    consolidado: {
      quantidadeRegistros: veiculos.length,
      custoFixoDiarioConsolidado: validos.length > 0 ? arredondar(somaCustoFixo, c) : undefined,
      custoVariavelDiarioConsolidado: validos.length > 0 ? arredondar(somaCustoVariavel, c) : undefined,
      custoTotalDiarioConsolidado: validos.length > 0 ? arredondar(somaCustoTotal, c) : undefined,
      receitaDiariaConsolidada: somaReceita > 0 ? arredondar(somaReceita, c) : undefined,
      lucroDiarioConsolidado,
      margemConsolidadaPercentual,
      quilometragemTotalConsolidada: somaKm > 0 ? arredondar(somaKm, config.casas.distancia) : undefined,
      custoPorKmConsolidado,
      diasOperadosTotais: somaDiasOperados > 0 ? somaDiasOperados : undefined,
      diasDisponiveisTotais: undefined,
      taxaUtilizacaoConsolidada: undefined,
      resultadosIndividuais: resultados,
      rankingPorMenorCustoDiario,
      rankingPorMenorCustoPorKm,
      rankingPorMaiorLucroDiario,
      veiculosComPrejuizo,
      maiorCustoDiario: rankingPorMenorCustoDiario[rankingPorMenorCustoDiario.length - 1]?.nome,
      menorCustoDiario: rankingPorMenorCustoDiario[0]?.nome,
      melhorLucroDiario: rankingPorMaiorLucroDiario[0]?.nome,
      piorResultado: rankingPorMaiorLucroDiario[rankingPorMaiorLucroDiario.length - 1]?.nome,
      alertas,
    },
    nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Previsto x realizado
// ---------------------------------------------------------------------------

function diferenca(previsto: number | undefined, realizado: number | undefined, casas: number): DiferencaCustoDia | undefined {
  if (previsto === undefined || realizado === undefined) return undefined;
  const diferencaAbsoluta = realizado - previsto;
  return {
    previsto: arredondar(previsto, casas),
    realizado: arredondar(realizado, casas),
    diferenca: arredondar(diferencaAbsoluta, casas),
    diferencaPercentual: previsto !== 0 ? arredondar((diferencaAbsoluta / previsto) * 100, 2) : undefined,
  };
}

function calcularPrevistoRealizado(entrada: CalcularCustoDiaEntrada, config: ConfigCustoDia): { resultado?: PrevistoRealizadoCustoDia; agPrevisto: AgregacaoCustoDia; agRealizado: AgregacaoCustoDia } {
  const agPrevisto = analisarVariante(entrada.previsto as DadosCustoDiaVariante, "CUSTO_TOTAL_DIARIO", "previsto", config);
  const agRealizado = analisarVariante(entrada.realizado as DadosCustoDiaVariante, "CUSTO_TOTAL_DIARIO", "realizado", config);

  if (agPrevisto.errosValidacao.length > 0 || agPrevisto.dadosFaltantes.length > 0 || agRealizado.errosValidacao.length > 0 || agRealizado.dadosFaltantes.length > 0) {
    return { agPrevisto, agRealizado };
  }

  const c = config.casas.moeda;
  const rpk = config.casas.custoPorKm;
  const p = config.casas.percentual;
  const d = config.casas.dia;

  const custoTotalDiario = diferenca(agPrevisto.custoTotalDiario, agRealizado.custoTotalDiario, c);
  const custoPorKmDia = diferenca(agPrevisto.custoPorKmDia, agRealizado.custoPorKmDia, rpk);
  const receitaDiaria = diferenca(agPrevisto.receitaDiaria, agRealizado.receitaDiaria, c);
  const lucroDiario = diferenca(agPrevisto.lucroDiario, agRealizado.lucroDiario, c);
  const margemDiariaPercentual = diferenca(agPrevisto.margemDiariaPercentual, agRealizado.margemDiariaPercentual, p);
  const diasOperados = diferenca(agPrevisto.diasOperados, agRealizado.diasOperados, d);

  const candidatosDesvio: Array<[string, number | undefined]> = [
    ["Custo diário", custoTotalDiario?.diferenca !== undefined ? Math.abs(custoTotalDiario.diferenca) : undefined],
    ["Dias operados", diasOperados?.diferenca !== undefined ? Math.abs(diasOperados.diferenca) : undefined],
    ["Receita", receitaDiaria?.diferenca !== undefined ? Math.abs(receitaDiaria.diferenca) : undefined],
  ];
  const maiorDesvio = candidatosDesvio.filter(([, valor]) => valor !== undefined).sort((a, b) => (b[1] as number) - (a[1] as number))[0];

  const alertas: string[] = [];
  if (custoTotalDiario && Math.abs(custoTotalDiario.diferencaPercentual ?? 0) >= 10) {
    alertas.push(`O custo diário realizado ficou ${formatarNumero(custoTotalDiario.diferencaPercentual ?? 0)}% em relação ao previsto.`);
  }

  return {
    resultado: { custoTotalDiario, custoPorKmDia, receitaDiaria, lucroDiario, margemDiariaPercentual, diasOperados, principalDesvio: maiorDesvio?.[0], alertas },
    agPrevisto,
    agRealizado,
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

function respostaFalha(modo: ModoCustoDia, dadosFaltantes: string[], erros: string[], alertas: string[] = []): CalcularCustoDiaResultado {
  return {
    sucesso: false,
    modo,
    alertas,
    premissas: [],
    dadosFaltantes: [...dadosFaltantes, ...erros],
    mensagemResumo: erros.length > 0 ? `Não foi possível calcular: ${erros.join(" ")}` : `Dados insuficientes para calcular o custo diário. Faltam: ${dadosFaltantes.join(", ")}.`,
    nivelCompletude: "INSUFICIENTE",
    custosIncluidos: [],
    custosIgnorados: [],
    dadosPresentes: [],
    indicadoresNaoAvaliados: [],
    limitacoes: LIMITACOES_PADRAO,
    memoriaCalculo: [],
  };
}

export function calcularCustoDia(entrada: CalcularCustoDiaEntrada): CalcularCustoDiaResultado {
  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) return respostaFalha(entrada.modo, [], errosTopo);

  const casas = casasDecimaisDe(entrada);
  const config: ConfigCustoDia = {
    estrategiaCusto: entrada.estrategiaSobreposicaoCusto ?? "REJEITAR_SOBREPOSICAO",
    toleranciaPercentual: entrada.toleranciaClassificacaoPercentual ?? TOLERANCIA_CLASSIFICACAO_PERCENTUAL_PADRAO,
    permitirEstimativas: entrada.permitirEstimativas,
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
        ? `Comparação entre ${comparacao.cenarios.length} cenários concluída. Menor custo diário: ${comparacao.rankingPorMenorCustoDiario[0]?.nome ?? "—"}.`
        : "Nenhum cenário pôde ser calculado com os dados informados.",
      nivelCompletude,
      custosIncluidos: [],
      custosIgnorados: [],
      dadosPresentes: [],
      indicadoresNaoAvaliados: [],
      comparacaoCenarios: comparacao,
      limitacoes: LIMITACOES_PADRAO,
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "MULTIPLOS_VEICULOS") {
    const { consolidado, nivelCompletude } = consolidarVeiculos(entrada, config);
    return {
      sucesso: consolidado.custoTotalDiarioConsolidado !== undefined,
      modo: entrada.modo,
      alertas: consolidado.alertas,
      premissas: [],
      dadosFaltantes: consolidado.custoTotalDiarioConsolidado === undefined ? ["Nenhum veículo pôde ser calculado — verifique os dados de cada veículo."] : [],
      mensagemResumo:
        consolidado.custoTotalDiarioConsolidado !== undefined
          ? `${consolidado.quantidadeRegistros} veículos consolidados: custo total diário de ${formatarBRL(consolidado.custoTotalDiarioConsolidado)}.`
          : "Não foi possível consolidar os veículos informados.",
      nivelCompletude,
      custosIncluidos: [],
      custosIgnorados: [],
      dadosPresentes: [],
      indicadoresNaoAvaliados: [],
      consolidadoVeiculos: consolidado,
      limitacoes: LIMITACOES_PADRAO,
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "PREVISTO_X_REALIZADO") {
    const { resultado, agPrevisto, agRealizado } = calcularPrevistoRealizado(entrada, config);
    if (!resultado) {
      const erros = [...agPrevisto.errosValidacao, ...agRealizado.errosValidacao];
      const faltantes = [...agPrevisto.dadosFaltantes, ...agRealizado.dadosFaltantes];
      return respostaFalha(entrada.modo, faltantes, erros, [...agPrevisto.alertas, ...agRealizado.alertas]);
    }
    return {
      sucesso: true,
      modo: entrada.modo,
      alertas: resultado.alertas,
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: `Custo diário previsto de ${formatarBRL(resultado.custoTotalDiario?.previsto ?? 0)} x realizado de ${formatarBRL(resultado.custoTotalDiario?.realizado ?? 0)} (diferença de ${formatarNumero(
        resultado.custoTotalDiario?.diferencaPercentual ?? 0
      )}%).`,
      nivelCompletude: "COMPLETO",
      custosIncluidos: [],
      custosIgnorados: [],
      dadosPresentes: [],
      indicadoresNaoAvaliados: [],
      previstoRealizado: resultado,
      limitacoes: LIMITACOES_PADRAO,
      memoriaCalculo: [],
    };
  }

  const errosVariante = validarVariante(entrada, "entrada");
  const ag = calcularNucleo(entrada, entrada.modo, config, "entrada");

  if (errosVariante.length > 0) return respostaFalha(entrada.modo, ag.dadosFaltantes, [...errosVariante, ...ag.errosValidacao], ag.alertas);
  if (ag.dadosFaltantes.length > 0 || ag.errosValidacao.length > 0) return respostaFalha(entrada.modo, ag.dadosFaltantes, ag.errosValidacao, ag.alertas);

  const nivelCompletude = determinarCompletude(ag);
  const memoriaCalculo = construirMemoriaCalculo("entrada", ag);
  const mensagemResumo = construirResumo(ag, nivelCompletude);

  const custoTotalPeriodo = ag.custoTotalDiario !== undefined && ag.diasOperados !== undefined ? arredondar(ag.custoTotalDiario * ag.diasOperados, casas.moeda) : undefined;
  const receitaTotalPeriodo = ag.receitaDiaria !== undefined && ag.diasOperados !== undefined ? arredondar(ag.receitaDiaria * ag.diasOperados, casas.moeda) : undefined;
  const lucroTotalPeriodo = receitaTotalPeriodo !== undefined && custoTotalPeriodo !== undefined ? arredondar(receitaTotalPeriodo - custoTotalPeriodo, casas.moeda) : undefined;

  return {
    sucesso: true,
    modo: entrada.modo,
    identificacao: entrada.identificacao,
    descricao: entrada.descricao,

    tipoDia: ag.tipoDia,
    baseRateio: ag.tipoDia,
    diasBase: ag.diasBase,

    custoFixoDiario: ag.custoFixoDiario,
    custoVariavelDiario: ag.custoVariavelDiario,
    custoFinanceiroDiario: ag.custoFinanceiroDiario,
    custoAdministrativoDiario: ag.custoAdministrativoDiario,
    outrosCustosDiarios: ag.outrosCustosDiarios,
    custoTotalDiario: ag.custoTotalDiario,

    custoDisponibilidadeDia: ag.custoDisponibilidadeDia,
    custoDiaOperado: ag.custoDiaOperado,
    custoDiaParado: ag.custoDiaParado,
    custoDiaOcioso: ag.custoDiaOcioso,

    custoPorKmDia: ag.custoPorKmDia,
    custoFixoPorKmDia: ag.custoFixoPorKmDia,
    custoVariavelPorKmDia: ag.custoVariavelPorKmDia,
    custoPorHoraOperada: ag.custoPorHoraOperada,
    custoPorVeiculoDia: ag.custoPorVeiculoDia,
    receitaPorVeiculoDia: ag.receitaPorVeiculoDia,
    custoMotoristaDia: ag.custoMotoristaDia,
    custoAjudanteDia: ag.custoAjudanteDia,
    custoViagemDia: ag.custoViagemDia,

    receitaDiaria: ag.receitaDiaria,
    lucroDiario: ag.lucroDiario,
    margemDiariaPercentual: ag.margemDiariaPercentual,

    receitaPontoEquilibrioDia: ag.receitaPontoEquilibrioDia,
    receitaMinimaMargemDia: ag.receitaMinimaMargemDia,
    diferencaEquilibrioDia: ag.diferencaEquilibrioDia,
    valorAdicionalNecessarioDia: ag.valorAdicionalNecessarioDia,

    diasOperados: ag.diasOperados,
    diasDisponiveis: ag.diasDisponiveis,
    diasParados: ag.diasParados,
    diasOciosos: ag.diasOciosos,
    taxaUtilizacao: ag.taxaUtilizacao,
    taxaOciosidade: ag.taxaOciosidade,
    custoFixoOciosidade: ag.custoFixoOciosidade,

    custoTotalPeriodo,
    receitaTotalPeriodo,
    lucroTotalPeriodo,

    classificacao: ag.classificacao,
    nivelCompletude,
    custosIncluidos: ag.custosIncluidos,
    custosIgnorados: ag.custosIgnorados,
    dadosPresentes: ag.dadosPresentes,
    indicadoresNaoAvaliados: ag.indicadoresNaoAvaliados,
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
    descricao: "Modo de cálculo do custo diário.",
    valoresPossiveis: [
      "CUSTO_FIXO_DIARIO",
      "CUSTO_VARIAVEL_DIARIO",
      "CUSTO_TOTAL_DIARIO",
      "CUSTO_POR_DIA_CORRIDO",
      "CUSTO_POR_DIA_UTIL",
      "CUSTO_POR_DIA_OPERADO",
      "CUSTO_POR_DIA_DISPONIVEL",
      "CUSTO_VEICULO_DIA",
      "CUSTO_FROTA_DIA",
      "CUSTO_VIAGEM_POR_DIA",
      "VEICULO_OPERANDO",
      "VEICULO_PARADO",
      "VEICULO_OCIOSO",
      "RECEITA_E_RESULTADO_DIARIO",
      "PONTO_EQUILIBRIO_DIARIO",
      "MARGEM_ALVO_DIARIA",
      "PREVISTO_X_REALIZADO",
      "ANALISE_POR_PERIODO",
      "MULTIPLOS_VEICULOS",
      "COMPARACAO_CENARIOS",
    ],
  },
  { nome: "identificacao", tipo: "string", obrigatorio: false, descricao: "Identificador livre da operação/veículo." },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre." },
  { nome: "tipoDia", tipo: "enum", obrigatorio: false, descricao: "Base de rateio explícita.", valoresPossiveis: ["CORRIDO", "UTIL", "OPERADO", "DISPONIVEL", "VIAGEM", "PARADO", "PERSONALIZADO"] },
  { nome: "periodoInicio", tipo: "string", obrigatorio: false, descricao: "Início do período analisado (informativo)." },
  { nome: "periodoFim", tipo: "string", obrigatorio: false, descricao: "Fim do período analisado (informativo)." },
  { nome: "tipoPeriodo", tipo: "enum", obrigatorio: false, descricao: "Tipo de período.", valoresPossiveis: ["DIA", "SEMANA", "QUINZENA", "MES", "TRIMESTRE", "ANO", "PERIODO_PERSONALIZADO"] },
  { nome: "diasCorridosPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias corridos do período." },
  { nome: "diasUteisPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias úteis do período." },
  { nome: "diasOperadosPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias em que o veículo efetivamente operou." },
  { nome: "diasDisponiveisPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias em que o veículo esteve disponível para operar." },
  { nome: "diasParadosPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias em que o veículo ficou parado." },
  { nome: "diasViagem", tipo: "number", obrigatorio: false, descricao: "Duração da viagem, em dias." },
  { nome: "divisorPersonalizado", tipo: "number", obrigatorio: false, descricao: "Divisor de dias personalizado (tipoDia=PERSONALIZADO)." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos." },
  { nome: "quantidadeMotoristas", tipo: "number", obrigatorio: false, descricao: "Quantidade de motoristas." },
  { nome: "quantidadeAjudantes", tipo: "number", obrigatorio: false, descricao: "Quantidade de ajudantes." },
  { nome: "quilometragemDia", tipo: "number", obrigatorio: false, descricao: "Quilometragem do dia." },
  { nome: "quilometragemPeriodo", tipo: "number", obrigatorio: false, descricao: "Quilometragem total do período." },
  { nome: "horasOperadasDia", tipo: "number", obrigatorio: false, descricao: "Horas operadas no dia." },
  { nome: "horasDisponiveisDia", tipo: "number", obrigatorio: false, descricao: "Horas disponíveis no dia." },
  { nome: "custosFixos", tipo: "string", obrigatorio: false, descricao: "Lista de custos fixos detalhados (descrição, categoria, valor, periodicidade)." },
  { nome: "custosVariaveis", tipo: "string", obrigatorio: false, descricao: "Lista de custos variáveis detalhados (descrição, categoria, valor, base)." },
  { nome: "custoTotalDiarioInformado", tipo: "number", obrigatorio: false, descricao: "Custo total diário já pronto." },
  { nome: "custoTotalMensalInformado", tipo: "number", obrigatorio: false, descricao: "Custo total mensal, rateado pelo tipoDia selecionado." },
  { nome: "custoPorKmInformado", tipo: "number", obrigatorio: false, descricao: "Custo por km, multiplicado por quilometragemDia." },
  { nome: "custoTotalViagemInformado", tipo: "number", obrigatorio: false, descricao: "Custo total de uma viagem, dividido por diasViagem." },
  { nome: "custoFinanceiroDiarioInformado", tipo: "number", obrigatorio: false, descricao: "Custo financeiro diário (juros, custo de capital), somado por cima." },
  { nome: "custoAdministrativoDiarioInformado", tipo: "number", obrigatorio: false, descricao: "Custo administrativo diário, somado por cima." },
  { nome: "outrosCustosDiariosInformado", tipo: "number", obrigatorio: false, descricao: "Outros custos diários, somados por cima." },
  { nome: "custosEspecificosParada", tipo: "number", obrigatorio: false, descricao: "Custos específicos do veículo parado (estacionamento, pátio, reboque etc.)." },
  { nome: "custoTotalMotoristas", tipo: "number", obrigatorio: false, descricao: "Custo total de motoristas no dia, dividido por quantidadeMotoristas." },
  { nome: "custoTotalAjudantes", tipo: "number", obrigatorio: false, descricao: "Custo total de ajudantes no dia, dividido por quantidadeAjudantes." },
  { nome: "receitaDia", tipo: "number", obrigatorio: false, descricao: "Receita do dia." },
  { nome: "receitaPeriodo", tipo: "number", obrigatorio: false, descricao: "Receita total do período, dividida pela base de rateio." },
  { nome: "receitaPorKmInformada", tipo: "number", obrigatorio: false, descricao: "Receita por km, multiplicada por quilometragemDia (via calcular_receita_km)." },
  { nome: "impostoPercentual", tipo: "number", obrigatorio: false, descricao: "Imposto em percentual sobre a receita (para ponto de equilíbrio/margem-alvo)." },
  { nome: "comissaoPercentual", tipo: "number", obrigatorio: false, descricao: "Comissão em percentual sobre a receita." },
  { nome: "outrasDeducoesPercentual", tipo: "number", obrigatorio: false, descricao: "Outras deduções em percentual sobre a receita." },
  { nome: "margemAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "Margem-alvo diária desejada." },
  { nome: "cenarios", tipo: "string", obrigatorio: false, descricao: "Lista de cenários a comparar (modo COMPARACAO_CENARIOS, ao menos 2)." },
  { nome: "veiculos", tipo: "string", obrigatorio: false, descricao: "Lista de veículos a consolidar (modo MULTIPLOS_VEICULOS)." },
  { nome: "estrategiaSobreposicaoCusto", tipo: "enum", obrigatorio: false, descricao: "Estratégia para custo informado por mais de uma fonte.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO", "PRIORIZAR_VALOR_DIARIO", "PRIORIZAR_FONTE_EXTERNA"] },
  { nome: "toleranciaClassificacaoPercentual", tipo: "number", obrigatorio: false, descricao: "Tolerância (%) para classificação do resultado diário." },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve todas as casas decimais padrão da saída." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Permite usar padrões configuráveis (ex.: 30 dias/mês) quando a base de rateio de uma periodicidade não é informada — sempre com premissa registrada." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaCalcularCustoDia: DefinicaoFerramenta<CalcularCustoDiaEntrada, CalcularCustoDiaResultado> = {
  nome: "calcular_custo_dia",
  descricao: "Calcula e interpreta o custo diário de um veículo, frota, operação, rota, contrato ou período — fixo, variável, total, por km, por hora, parado ou ocioso.",
  objetivo: "Definir quanto custa manter um veículo/frota por dia (rodando, parado ou ocioso) e quanto é preciso faturar para não ter prejuízo.",
  parametros: PARAMETROS,
  executar: calcularCustoDia,
};
