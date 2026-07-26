import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, EstrategiaSobreposicao, NivelCompletude, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";
import { calcularCustoDia } from "./calcular-custo-dia";
import type { ItemCustoFixo, TipoDia } from "./calcular-custo-dia";
import { calcularMargem } from "./calcular-margem";
import type { ResumoCustoViagem } from "./calcular-margem";
import type { ResumoCpkParaCusto } from "./calcular-valor-minimo-frete";
import { calcularCpk } from "./calcular-cpk";

/**
 * Ferramenta: calcular_custo_veiculo_parado
 *
 * Calcula e interpreta o impacto financeiro de um veículo (ou frota) parado
 * — por manutenção, avaria, acidente, espera de peça/oficina/carga/descarga,
 * falta de motorista/demanda, restrição operacional ou administrativa, ou
 * parada programada. Sempre diferencia custo fixo que continua existindo,
 * custo adicional provocado pela parada, custos evitados por não operar,
 * receita não realizada e lucro não realizado — nunca trata faturamento
 * perdido como lucro perdido, nunca soma receita não realizada e lucro não
 * realizado como impactos independentes, e nunca afirma que um veículo
 * parado tem custo zero.
 *
 * Atua como coordenadora: reutiliza `calcularCustoDia` (modo
 * `CUSTO_FIXO_DIARIO`) para normalizar `custosFixos` (mesmo tipo `ItemCustoFixo`
 * reexportado por `calcular-custo-dia.ts` — mesma normalização de
 * periodicidade, sem reimplementar o rateio de custos mensais/anuais/etc.);
 * reutiliza `calcularMargem` (modo `MARGEM_SIMPLES`) para o "lucro pela
 * operação evitada" (receita não realizada − custos variáveis evitados);
 * reutiliza `calcularCpk` (modo `CPK_PNEUS` como divisor genérico) para
 * qualquer divisão segura contra zero.
 *
 * Aceita o custo de `calcular-custo-dia.ts` via `resumoCustoDia` (o mesmo
 * ponto de extensão decoupled que aquela ferramenta já expõe para esta —
 * `ResumoCustoVeiculoParadoParaCustoDia` —, usado aqui em sentido inverso),
 * de `calcular-custo-viagem.ts` via `resumoCustoViagem` (tipo reexportado
 * por `calcular-margem.ts`) para os custos evitados, e o CPK de
 * `calcular-cpk.ts` via `resumoCpk` (tipo reexportado por
 * `calcular-valor-minimo-frete.ts`) para os custos evitados por
 * quilômetro. Nenhuma dependência circular: este arquivo importa de
 * `calcular-custo-dia.ts`, `calcular-margem.ts`, `calcular-cpk.ts` e
 * `calcular-valor-minimo-frete.ts` (só tipo) — nenhum deles importa deste.
 *
 * Sem APIs externas nesta fase. Nunca inventa duração, custos, receita,
 * margem, lucro, quantidade de viagens, quilômetros, prazo de peça/oficina,
 * custo de substituto, custo de oportunidade, responsabilidade ou cobertura
 * de seguro não informados.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

const CASAS_DECIMAIS_HORA_PADRAO = 2;
const CASAS_DECIMAIS_DIA_PADRAO = 2;
const CASAS_DECIMAIS_KM_PADRAO = 2;

const TOLERANCIA_CLASSIFICACAO_PERCENTUAL_PADRAO = 0.5;

/** Limites indicativos (não escondidos) para a classificação por impacto — configuráveis via `limites*`. */
const LIMITES_CLASSIFICACAO_PADRAO = {
  impactoModeradoValor: 1000,
  impactoAltoValor: 5000,
  impactoCriticoValor: 20000,
  duracaoAtencaoDias: 5,
  percentualFrotaParadaAtencao: 20,
  desvioPrazoAtencaoPercentual: 20,
};

const LIMITACOES_PADRAO: string[] = [
  "Esta ferramenta não calcula duração, custos, receita, margem, lucro, quantidade de viagens, quilômetros, prazo de peça/oficina, custo de substituto ou custo de oportunidade automaticamente — todos os valores vêm do que foi informado.",
  "Faturamento perdido (receita não realizada) nunca é apresentado como lucro perdido — o lucro não realizado só é calculado quando há margem, lucro médio ou custos evitados informados para derivá-lo.",
  "A visão de caixa trata todo custo fixo informado como desembolsável nesta fase — não distingue itens não-caixa (ex.: depreciação) automaticamente; para isso, informe os custos separadamente e ajuste a leitura.",
  "Esta ferramenta não infere responsabilidade, culpa, cobertura de seguro ou obrigação legal a partir do motivo da parada — o motivo é apenas informativo, para organizar os custos.",
  "A classificação por impacto usa limites configuráveis e indicativos, não um padrão de mercado — sem limites personalizados, a classificação é apenas indicativa.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoCustoVeiculoParado =
  | "CUSTO_DIRETO_PARADA"
  | "CUSTO_FIXO_DURANTE_PARADA"
  | "CUSTO_ADICIONAL_PARADA"
  | "CUSTO_TOTAL_PARADA"
  | "RECEITA_NAO_REALIZADA"
  | "LUCRO_NAO_REALIZADO"
  | "CUSTO_OPORTUNIDADE"
  | "CUSTO_POR_HORA_PARADA"
  | "CUSTO_POR_DIA_PARADO"
  | "PARADA_MANUTENCAO"
  | "PARADA_AVARIA"
  | "PARADA_ACIDENTE"
  | "AGUARDANDO_PECA"
  | "AGUARDANDO_OFICINA"
  | "AGUARDANDO_CARGA"
  | "AGUARDANDO_DESCARGA"
  | "FALTA_MOTORISTA"
  | "FALTA_DEMANDA"
  | "PARADA_PROGRAMADA"
  | "PARADA_NAO_PROGRAMADA"
  | "VEICULO_SUBSTITUTO"
  | "MULTIPLOS_VEICULOS"
  | "FROTA_PARCIALMENTE_PARADA"
  | "PREVISTO_X_REALIZADO"
  | "COMPARACAO_CENARIOS"
  | "ANALISE_REDUCAO_TEMPO_PARADO"
  | "ANALISE_REPARAR_OU_SUBSTITUIR";

export type MotivoParada =
  | "MANUTENCAO_PREVENTIVA"
  | "MANUTENCAO_CORRETIVA"
  | "AVARIA_MECANICA"
  | "AVARIA_ELETRICA"
  | "PNEU"
  | "ACIDENTE"
  | "AGUARDANDO_PECA"
  | "AGUARDANDO_OFICINA"
  | "AGUARDANDO_AUTORIZACAO"
  | "AGUARDANDO_CARGA"
  | "AGUARDANDO_DESCARGA"
  | "DOCUMENTACAO"
  | "FALTA_MOTORISTA"
  | "FALTA_AJUDANTE"
  | "FALTA_DEMANDA"
  | "FALTA_COMBUSTIVEL"
  | "RESTRICAO_FINANCEIRA"
  | "RESTRICAO_OPERACIONAL"
  | "PARADA_PROGRAMADA"
  | "CLIMA_INFORMADO"
  | "OUTRO"
  | "NAO_INFORMADO";

export type TipoParada = "PROGRAMADA" | "NAO_PROGRAMADA" | "OPERACIONAL" | "MECANICA" | "ADMINISTRATIVA" | "COMERCIAL" | "FINANCEIRA" | "EXTERNA" | "NAO_CLASSIFICADA";

export type StatusParada = "EM_ANDAMENTO" | "ENCERRADA" | "ESTIMADA" | "PLANEJADA" | "NAO_INFORMADO";

export type EstrategiaSobreposicaoDuracao = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_HORAS" | "PRIORIZAR_DIAS" | "PRIORIZAR_DATAS";

/** Mesmo conceito de `EstrategiaSobreposicaoCustoDia`, com uma 6ª opção (`PRIORIZAR_VALOR_HORA`) — local a este arquivo porque a granularidade das fontes de custo é diferente (inclui custo fixo por hora). */
export type EstrategiaSobreposicaoCustoParada = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_TOTAL" | "PRIORIZAR_DETALHADO" | "PRIORIZAR_VALOR_DIARIO" | "PRIORIZAR_VALOR_HORA" | "PRIORIZAR_FONTE_EXTERNA";

export type BaseCustoAdicional = "POR_HORA" | "POR_DIA" | "POR_EVENTO" | "POR_PESSOA" | "POR_VEICULO" | "POR_VIAGEM" | "POR_UNIDADE" | "VALOR_TOTAL" | "PERCENTUAL";

/** `VALOR_FIXO` ainda não tem base implementada nesta fase (ver limitações) — os demais valores têm equação fechada, inclusive `CUSTO_TOTAL_PARADA` (circular, resolvido por equação). */
export type BasePercentualAdicional = "RECEITA_NAO_REALIZADA" | "VALOR_DO_FRETE" | "CUSTO_REPARO" | "CUSTO_TOTAL_PARADA" | "VALOR_FIXO";

export type NivelCertezaCustoEvitado = "CONFIRMADO" | "ESTIMADO" | "NAO_AVALIADO";

export type NivelConfianca = "CONFIRMADO" | "ESTIMADO" | "PARCIAL" | "NAO_AVALIADO";

export interface ItemCustoAdicional {
  descricao?: string;
  categoria?: string;
  valor: number;
  base: BaseCustoAdicional;
  basePercentual?: BasePercentualAdicional;
  quantidade?: number;
  incluidoEmOutroCusto?: boolean;
  observacoes?: string;
}

export interface ItemCustoEvitado {
  descricao?: string;
  valor: number;
  quantidade?: number;
  justificativa?: string;
  certeza?: NivelCertezaCustoEvitado;
  incluidoNoCustoOperacionalNormal?: boolean;
}

/** Resumo normalizado e desacoplado de `calcular-custo-dia.ts` — sentido inverso do ponto de extensão que aquela ferramenta já expõe para esta (`ResumoCustoVeiculoParadoParaCustoDia`). */
export interface ResumoCustoDiaParaCustoParado {
  custoFixoDiario?: number;
}

/**
 * Conjunto completo de dados usado pelo cálculo direto, por cada cenário em
 * `COMPARACAO_CENARIOS` e pelos blocos `previsto`/`realizado`.
 */
export interface DadosCustoParadaVariante {
  identificacao?: string;
  descricao?: string;
  identificacaoVeiculo?: string;
  placa?: string;
  tipoVeiculo?: string;

  motivoParada?: MotivoParada;
  tipoParada?: TipoParada;
  statusParada?: StatusParada;

  dataInicio?: string;
  dataFim?: string;
  horasParadas?: number;
  diasParados?: number;
  horasPorDia?: number;
  previsaoHorasParadas?: number;
  previsaoDiasParados?: number;

  quantidadeVeiculos?: number;
  quantidadeVeiculosFrota?: number;
  quantidadeVeiculosParados?: number;

  diasOperadosPeriodo?: number;
  diasDisponiveisPeriodo?: number;
  /** Complementa `diasOperadosPeriodo` para o cálculo de `utilizacaoAntes`/`utilizacaoDepois`/`impactoUtilizacao`. */
  diasOperadosPlanejadosPeriodo?: number;

  receitaMediaDia?: number;
  receitaMediaHora?: number;
  receitaMediaViagem?: number;
  receitaMediaKm?: number;
  lucroMedioDia?: number;
  lucroMedioHora?: number;
  margemMediaPercentual?: number;
  quantidadeViagensPerdidas?: number;
  kmNaoRealizados?: number;
  valorFreteCancelado?: number;
  receitaContratadaNaoRealizada?: number;

  custoFixoDiarioInformado?: number;
  custoFixoHoraInformado?: number;
  custoAdicionalTotalInformado?: number;
  custoTotalParadaInformado?: number;
  custosFixos?: ItemCustoFixo[];
  custosAdicionais?: ItemCustoAdicional[];
  custosEvitados?: ItemCustoEvitado[];

  /** Base para o rateio de `custosFixos`, quando informados — mesmo formato de `calcular-custo-dia.ts`. */
  tipoDia?: TipoDia;
  diasCorridosPeriodo?: number;
  diasUteisPeriodo?: number;

  resumoCustoDia?: ResumoCustoDiaParaCustoParado;
  resumoCustoViagem?: ResumoCustoViagem;
  resumoCpk?: ResumoCpkParaCusto;

  /** Usado como base percentual `CUSTO_REPARO`, e somado no custo total econômico da alternativa. */
  custoReparoInformado?: number;
  custoOportunidadeInformado?: number;
  alternativaOportunidadeDescricao?: string;

  custoVeiculoSubstitutoDia?: number;
  custoVeiculoSubstitutoTotal?: number;
  receitaGeradaSubstituto?: number;

  /** Usado nos modos AGUARDANDO_CARGA/AGUARDANDO_DESCARGA. */
  receitaEstadiaInformada?: number;

  /** Usado no modo ANALISE_REDUCAO_TEMPO_PARADO. */
  diasReducaoAnalisados?: number;

  prazoPagamentoDias?: number;
}

export interface CenarioCustoParada extends DadosCustoParadaVariante {
  id?: string;
  nome?: string;
}

/** Entrada por veículo, para `MULTIPLOS_VEICULOS`. */
export interface VeiculoCustoParada extends DadosCustoParadaVariante {
  status?: StatusParada;
}

export interface CalcularCustoVeiculoParadoEntrada extends DadosCustoParadaVariante {
  modo: ModoCustoVeiculoParado;

  /** Usado apenas em COMPARACAO_CENARIOS — ao menos 2 cenários. */
  cenarios?: CenarioCustoParada[];
  /** Usado apenas em MULTIPLOS_VEICULOS. */
  veiculos?: VeiculoCustoParada[];
  /** Usados apenas em PREVISTO_X_REALIZADO. */
  previsto?: DadosCustoParadaVariante;
  realizado?: DadosCustoParadaVariante;

  estrategiaSobreposicaoCusto?: EstrategiaSobreposicaoCustoParada;
  estrategiaSobreposicaoDuracao?: EstrategiaSobreposicaoDuracao;
  estrategiaSobreposicaoReceita?: EstrategiaSobreposicao;
  estrategiaSobreposicaoLucro?: EstrategiaSobreposicao;
  toleranciaClassificacaoPercentual?: number;

  casasDecimais?: number;
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type ClassificacaoCustoParada =
  | "BAIXO_IMPACTO"
  | "IMPACTO_MODERADO"
  | "ALTO_IMPACTO"
  | "IMPACTO_CRITICO"
  | "SOMENTE_CUSTO_FIXO"
  | "SEM_RECEITA_AVALIADA"
  | "PARADA_PROGRAMADA_CONTROLADA"
  | "ACIMA_DO_PREVISTO"
  | "DADOS_INSUFICIENTES"
  | "NAO_AVALIADO";

export interface ItemRankingCustoParada {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface ResultadoCenarioCustoParada extends ResultadoFerramentaBase {
  id: string;
  nome: string;
  diasParados?: number;
  horasParadas?: number;
  custoFixoParada?: number;
  custoAdicionalParada?: number;
  custoDiretoParada?: number;
  custosEvitados?: number;
  custoLiquidoDireto?: number;
  receitaNaoRealizada?: number;
  lucroNaoRealizado?: number;
  impactoCaixa?: number;
  impactoEconomico?: number;
  custoTotalAlternativa?: number;
  nivelCompletude: NivelCompletude;
}

export interface ComparacaoCenariosCustoParada {
  cenarios: ResultadoCenarioCustoParada[];
  rankingPorMenorDesembolso: ItemRankingCustoParada[];
  rankingPorMenorImpactoEconomico: ItemRankingCustoParada[];
  rankingPorMenorPrazo: ItemRankingCustoParada[];
  rankingPorMenorCustoAdicional: ItemRankingCustoParada[];
  rankingPorMaiorPreservacaoReceita: ItemRankingCustoParada[];
  alertas: string[];
}

export interface DiferencaCustoParada {
  previsto?: number;
  realizado?: number;
  diferenca?: number;
  diferencaPercentual?: number;
}

export interface PrevistoRealizadoCustoParada {
  diasParados?: DiferencaCustoParada;
  custoDiretoParada?: DiferencaCustoParada;
  receitaNaoRealizada?: DiferencaCustoParada;
  lucroNaoRealizado?: DiferencaCustoParada;
  impactoEconomico?: DiferencaCustoParada;
  principalDesvio?: string;
  categoriasAcimaDoPrevisto: string[];
  categoriasAbaixoDoPrevisto: string[];
  alertas: string[];
}

export interface ResultadoConsolidadoCustoParada {
  quantidadeRegistros: number;
  quantidadeVeiculosParados?: number;
  quantidadeVeiculosFrota?: number;
  percentualFrotaParada?: number;
  horasParadasTotais?: number;
  diasParadosTotais?: number;
  custoFixoTotal?: number;
  custoAdicionalTotal?: number;
  custoDiretoTotal?: number;
  custosEvitadosTotais?: number;
  custoLiquidoDiretoTotal?: number;
  receitaNaoRealizadaTotal?: number;
  lucroNaoRealizadoTotal?: number;
  impactoCaixaTotal?: number;
  impactoEconomicoTotal?: number;
  custoMedioPorHora?: number;
  custoMedioPorDia?: number;
  custoPorVeiculoParado?: number;
  receitaNaoRealizadaPorVeiculo?: number;
  resultadosIndividuais: ResultadoCenarioCustoParada[];
  rankingPorMaiorImpactoEconomico: ItemRankingCustoParada[];
  rankingPorMaiorImpactoCaixa: ItemRankingCustoParada[];
  rankingPorMaiorDuracao: ItemRankingCustoParada[];
  rankingPorMaiorReceitaNaoRealizada: ItemRankingCustoParada[];
  rankingPorMaiorLucroNaoRealizado: ItemRankingCustoParada[];
  rankingPorMaiorCustoAdicional: ItemRankingCustoParada[];
  alertas: string[];
}

export interface CalcularCustoVeiculoParadoResultado extends ResultadoFerramentaBase {
  modo: ModoCustoVeiculoParado;
  identificacao?: string;
  descricao?: string;
  identificacaoVeiculo?: string;
  placa?: string;
  motivoParada?: MotivoParada;
  tipoParada?: TipoParada;
  statusParada?: StatusParada;

  horasParadas?: number;
  diasParados?: number;
  baseDuracao?: string;

  custoFixoParada?: number;
  custoAdicionalParada?: number;
  custoDiretoParada?: number;
  custosEvitados?: number;
  custoLiquidoDireto?: number;
  receitaNaoRealizada?: number;
  lucroNaoRealizado?: number;
  custoOportunidade?: number;
  impactoCaixa?: number;
  impactoEconomico?: number;

  custoPorHoraParada?: number;
  custoPorDiaParada?: number;
  custoPorVeiculoParado?: number;
  receitaNaoRealizadaPorVeiculo?: number;

  quantidadeViagensPerdidas?: number;
  kmNaoRealizados?: number;
  percentualFrotaParada?: number;
  taxaIndisponibilidade?: number;
  utilizacaoAntes?: number;
  utilizacaoDepois?: number;
  impactoUtilizacao?: number;

  diasParaRecuperar?: number;
  horasParaRecuperar?: number;

  custoVeiculoSubstituto?: number;
  receitaGeradaSubstituto?: number;
  resultadoSubstituto?: number;
  beneficioLiquidoSubstituto?: number;

  valorMaximoJustificavelReducao?: number;
  economiaPorDiaReduzido?: number;

  custoTotalAlternativa?: number;
  resultadoLiquidoEspera?: number;

  comparacaoCenarios?: ComparacaoCenariosCustoParada;
  consolidadoVeiculos?: ResultadoConsolidadoCustoParada;
  previstoRealizado?: PrevistoRealizadoCustoParada;

  classificacao?: ClassificacaoCustoParada;
  nivelCompletude: NivelCompletude;
  nivelConfianca?: NivelConfianca;
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

interface CasasDecimaisCustoParada {
  moeda: number;
  percentual: number;
  hora: number;
  dia: number;
  km: number;
}

function casasDecimaisDe(entrada: CalcularCustoVeiculoParadoEntrada): CasasDecimaisCustoParada {
  const override = entrada.casasDecimais;
  return {
    moeda: override ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    percentual: override ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    hora: override ?? CASAS_DECIMAIS_HORA_PADRAO,
    dia: override ?? CASAS_DECIMAIS_DIA_PADRAO,
    km: override ?? CASAS_DECIMAIS_KM_PADRAO,
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
// Resolução da duração da parada
// ---------------------------------------------------------------------------

interface DuracaoResolvida {
  diasParados?: number;
  horasParadas?: number;
  baseDuracao?: string;
  alertas: string[];
  premissas: string[];
  erro?: string;
}

function resolverDuracao(v: DadosCustoParadaVariante, estrategia: EstrategiaSobreposicaoDuracao, rotulo: string): DuracaoResolvida {
  const alertas: string[] = [];
  const premissas: string[] = [];

  if (v.diasParados === 0 || v.horasParadas === 0) {
    return { alertas, premissas, erro: `${rotulo}: a duração da parada deve ser maior que zero (recebido 0).` };
  }

  const candidatosDias: Array<{ fonte: string; valor: number }> = [];
  if (v.diasParados !== undefined) candidatosDias.push({ fonte: "diasParados", valor: v.diasParados });
  let diasPorDatas: number | undefined;
  if (v.dataInicio && v.dataFim) {
    const inicio = new Date(v.dataInicio);
    const fim = new Date(v.dataFim);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      return { alertas, premissas, erro: `${rotulo}: "dataInicio"/"dataFim" inválidas — use um formato de data reconhecível (ex.: ISO 8601).` };
    }
    diasPorDatas = (fim.getTime() - inicio.getTime()) / 86400000;
    if (diasPorDatas < 0) return { alertas, premissas, erro: `${rotulo}: "dataFim" é anterior a "dataInicio".` };
    candidatosDias.push({ fonte: "datas", valor: diasPorDatas });
  }

  let diasParados: number | undefined;
  let baseDuracao: string | undefined;
  if (candidatosDias.length === 1) {
    diasParados = candidatosDias[0].valor;
    baseDuracao = candidatosDias[0].fonte;
  } else if (candidatosDias.length > 1) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return { alertas, premissas, erro: `${rotulo}: duração informada tanto por "diasParados" quanto por "dataInicio"/"dataFim". Informe apenas uma, ou defina "estrategiaSobreposicaoDuracao".` };
    }
    const vencedor = estrategia === "PRIORIZAR_DATAS" ? candidatosDias.find((c) => c.fonte === "datas") : candidatosDias.find((c) => c.fonte === "diasParados");
    diasParados = (vencedor ?? candidatosDias[0]).valor;
    baseDuracao = (vencedor ?? candidatosDias[0]).fonte;
    alertas.push(`${rotulo}: sobreposição de duração resolvida por "${estrategia}" — usado ${baseDuracao}.`);
  }
  if (baseDuracao === "datas") {
    premissas.push(`${rotulo}: duração calculada como diferença em dias corridos entre "dataInicio" e "dataFim" (sem considerar fuso horário ou horas parciais).`);
  }

  const candidatosHoras: Array<{ fonte: string; valor: number }> = [];
  if (v.horasParadas !== undefined) candidatosHoras.push({ fonte: "horasParadas", valor: v.horasParadas });
  if (diasParados !== undefined && v.horasPorDia !== undefined) {
    candidatosHoras.push({ fonte: "diasParados×horasPorDia", valor: diasParados * v.horasPorDia });
  }

  let horasParadas: number | undefined;
  if (candidatosHoras.length === 1) {
    horasParadas = candidatosHoras[0].valor;
  } else if (candidatosHoras.length > 1) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return { alertas, premissas, erro: `${rotulo}: duração em horas informada tanto por "horasParadas" quanto por "diasParados"×"horasPorDia". Informe apenas uma, ou defina "estrategiaSobreposicaoDuracao".` };
    }
    const vencedor = estrategia === "PRIORIZAR_HORAS" ? candidatosHoras.find((c) => c.fonte === "horasParadas") : candidatosHoras[0];
    horasParadas = (vencedor ?? candidatosHoras[0]).valor;
    alertas.push(`${rotulo}: sobreposição de horas resolvida por "${estrategia}" — usado ${(vencedor ?? candidatosHoras[0]).fonte}.`);
  }

  if (baseDuracao === undefined && horasParadas !== undefined) baseDuracao = "horasParadas";

  return { diasParados, horasParadas, baseDuracao, alertas, premissas };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function coletarCamposNumericos(v: DadosCustoParadaVariante, rotulo: string): Array<[string, number | undefined]> {
  return [
    [`${rotulo}.horasParadas`, v.horasParadas],
    [`${rotulo}.diasParados`, v.diasParados],
    [`${rotulo}.horasPorDia`, v.horasPorDia],
    [`${rotulo}.previsaoHorasParadas`, v.previsaoHorasParadas],
    [`${rotulo}.previsaoDiasParados`, v.previsaoDiasParados],
    [`${rotulo}.quantidadeVeiculos`, v.quantidadeVeiculos],
    [`${rotulo}.quantidadeVeiculosFrota`, v.quantidadeVeiculosFrota],
    [`${rotulo}.quantidadeVeiculosParados`, v.quantidadeVeiculosParados],
    [`${rotulo}.diasOperadosPeriodo`, v.diasOperadosPeriodo],
    [`${rotulo}.diasDisponiveisPeriodo`, v.diasDisponiveisPeriodo],
    [`${rotulo}.diasOperadosPlanejadosPeriodo`, v.diasOperadosPlanejadosPeriodo],
    [`${rotulo}.receitaMediaDia`, v.receitaMediaDia],
    [`${rotulo}.receitaMediaHora`, v.receitaMediaHora],
    [`${rotulo}.receitaMediaViagem`, v.receitaMediaViagem],
    [`${rotulo}.receitaMediaKm`, v.receitaMediaKm],
    [`${rotulo}.lucroMedioDia`, v.lucroMedioDia],
    [`${rotulo}.lucroMedioHora`, v.lucroMedioHora],
    [`${rotulo}.quantidadeViagensPerdidas`, v.quantidadeViagensPerdidas],
    [`${rotulo}.kmNaoRealizados`, v.kmNaoRealizados],
    [`${rotulo}.valorFreteCancelado`, v.valorFreteCancelado],
    [`${rotulo}.receitaContratadaNaoRealizada`, v.receitaContratadaNaoRealizada],
    [`${rotulo}.custoFixoDiarioInformado`, v.custoFixoDiarioInformado],
    [`${rotulo}.custoFixoHoraInformado`, v.custoFixoHoraInformado],
    [`${rotulo}.custoAdicionalTotalInformado`, v.custoAdicionalTotalInformado],
    [`${rotulo}.custoTotalParadaInformado`, v.custoTotalParadaInformado],
    [`${rotulo}.custoReparoInformado`, v.custoReparoInformado],
    [`${rotulo}.custoOportunidadeInformado`, v.custoOportunidadeInformado],
    [`${rotulo}.custoVeiculoSubstitutoDia`, v.custoVeiculoSubstitutoDia],
    [`${rotulo}.custoVeiculoSubstitutoTotal`, v.custoVeiculoSubstitutoTotal],
    [`${rotulo}.receitaGeradaSubstituto`, v.receitaGeradaSubstituto],
    [`${rotulo}.receitaEstadiaInformada`, v.receitaEstadiaInformada],
    [`${rotulo}.diasReducaoAnalisados`, v.diasReducaoAnalisados],
    [`${rotulo}.prazoPagamentoDias`, v.prazoPagamentoDias],
  ];
}

function validarVariante(v: DadosCustoParadaVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) erros.push(`O campo "${campo}" não pode ser negativo.`);
  }

  if (v.margemMediaPercentual !== undefined && (v.margemMediaPercentual < 0 || v.margemMediaPercentual > 100)) {
    erros.push(`"${rotulo}.margemMediaPercentual" deve estar entre 0 e 100.`);
  }

  if (v.quantidadeVeiculosParados !== undefined && v.quantidadeVeiculosFrota !== undefined && v.quantidadeVeiculosParados > v.quantidadeVeiculosFrota) {
    erros.push(`${rotulo}: "quantidadeVeiculosParados" (${v.quantidadeVeiculosParados}) não pode ser maior que "quantidadeVeiculosFrota" (${v.quantidadeVeiculosFrota}).`);
  }

  const fontesCusto = [
    v.custoTotalParadaInformado !== undefined,
    v.custoFixoDiarioInformado !== undefined,
    v.custoFixoHoraInformado !== undefined,
    v.resumoCustoDia?.custoFixoDiario !== undefined,
    (v.custosFixos && v.custosFixos.length > 0) ?? false,
  ].filter(Boolean).length;
  if (v.custoTotalParadaInformado !== undefined && fontesCusto > 1) {
    erros.push(`${rotulo}: "custoTotalParadaInformado" informado junto de outra fonte de custo fixo — conflito tratado em resolverCustoFixoParada (verifique estrategiaSobreposicaoCusto).`);
  } else {
    const fontesFixo = [v.custoFixoDiarioInformado !== undefined, v.custoFixoHoraInformado !== undefined, v.resumoCustoDia?.custoFixoDiario !== undefined, (v.custosFixos && v.custosFixos.length > 0) ?? false].filter(
      Boolean
    ).length;
    if (fontesFixo > 1) {
      erros.push(`${rotulo}: custo fixo informado por mais de uma fonte — conflito tratado em resolverCustoFixoParada (verifique estrategiaSobreposicaoCusto).`);
    }
  }

  const fontesAdicional = [v.custoAdicionalTotalInformado !== undefined, (v.custosAdicionais && v.custosAdicionais.length > 0) ?? false].filter(Boolean).length;
  if (fontesAdicional > 1) {
    erros.push(`${rotulo}: custo adicional informado tanto por "custoAdicionalTotalInformado" quanto por "custosAdicionais" detalhados — conflito tratado em resolverCustoAdicionalParada.`);
  }

  const fontesReceita = [
    v.receitaMediaDia !== undefined,
    v.receitaMediaHora !== undefined,
    v.receitaMediaViagem !== undefined,
    v.receitaMediaKm !== undefined,
    v.valorFreteCancelado !== undefined,
    v.receitaContratadaNaoRealizada !== undefined,
  ].filter(Boolean).length;
  if (fontesReceita > 1) {
    erros.push(`${rotulo}: receita não realizada informada por mais de uma fonte — conflito tratado em resolverReceitaNaoRealizada (verifique estrategiaSobreposicaoReceita).`);
  }

  for (const item of v.custosFixos ?? []) {
    if (item.valor < 0) erros.push(`${rotulo}: item de custo fixo "${item.descricao ?? item.categoria ?? "?"}" tem valor negativo.`);
  }
  for (const item of v.custosAdicionais ?? []) {
    if (item.valor < 0) erros.push(`${rotulo}: item de custo adicional "${item.descricao ?? item.categoria ?? "?"}" tem valor negativo.`);
    if (item.base === "PERCENTUAL" && item.basePercentual === undefined) {
      erros.push(`${rotulo}: item "${item.descricao ?? item.categoria ?? "?"}" usa base PERCENTUAL sem "basePercentual" definida.`);
    }
  }
  for (const item of v.custosEvitados ?? []) {
    if (item.valor < 0) erros.push(`${rotulo}: item de custo evitado "${item.descricao ?? "?"}" tem valor negativo.`);
  }

  return erros;
}

function validarEstruturaTopo(entrada: CalcularCustoVeiculoParadoEntrada): string[] {
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
    if (entrada.veiculos && entrada.veiculos.length > 0 && (entrada.custoTotalParadaInformado !== undefined || (entrada.custosFixos && entrada.custosFixos.length > 0))) {
      erros.push('MULTIPLOS_VEICULOS: "veiculos" foi informado junto de custos consolidados diretos — informe apenas uma fonte.');
    }
  }
  if (entrada.modo === "ANALISE_REDUCAO_TEMPO_PARADO" && entrada.diasReducaoAnalisados === undefined) {
    erros.push('O modo ANALISE_REDUCAO_TEMPO_PARADO exige "diasReducaoAnalisados".');
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Custo fixo durante a parada
// ---------------------------------------------------------------------------

interface CandidatoCustoFixo {
  chave: "diario" | "hora" | "detalhado" | "externa" | "total";
  rotulo: string;
  valor: number;
}

interface CustoFixoResolvido {
  custoFixoParada?: number;
  origem?: string;
  custosIncluidos: string[];
  custosIgnorados: string[];
  alertas: string[];
  premissas: string[];
  erro?: string;
}

function resolverCustoFixoParada(
  v: DadosCustoParadaVariante,
  diasParados: number | undefined,
  horasParadas: number | undefined,
  estrategia: EstrategiaSobreposicaoCustoParada,
  permitirEstimativas: boolean | undefined,
  rotulo: string
): CustoFixoResolvido {
  const alertas: string[] = [];
  const premissas: string[] = [];
  const custosIncluidos: string[] = [];
  const custosIgnorados: string[] = [];
  const candidatos: CandidatoCustoFixo[] = [];

  if (v.custoFixoDiarioInformado !== undefined) {
    if (diasParados === undefined || diasParados <= 0) {
      return { custosIncluidos, custosIgnorados, alertas, premissas, erro: `${rotulo}: "custoFixoDiarioInformado" exige "diasParados" maior que zero.` };
    }
    candidatos.push({ chave: "diario", rotulo: "custoFixoDiarioInformado × diasParados", valor: v.custoFixoDiarioInformado * diasParados });
  }
  if (v.custoFixoHoraInformado !== undefined) {
    if (horasParadas === undefined || horasParadas <= 0) {
      return { custosIncluidos, custosIgnorados, alertas, premissas, erro: `${rotulo}: "custoFixoHoraInformado" exige "horasParadas" maior que zero.` };
    }
    candidatos.push({ chave: "hora", rotulo: "custoFixoHoraInformado × horasParadas", valor: v.custoFixoHoraInformado * horasParadas });
  }
  if (v.resumoCustoDia?.custoFixoDiario !== undefined) {
    if (diasParados === undefined || diasParados <= 0) {
      return { custosIncluidos, custosIgnorados, alertas, premissas, erro: `${rotulo}: "resumoCustoDia" exige "diasParados" maior que zero.` };
    }
    candidatos.push({ chave: "externa", rotulo: "resumoCustoDia.custoFixoDiario × diasParados", valor: v.resumoCustoDia.custoFixoDiario * diasParados });
  }
  if (v.custosFixos && v.custosFixos.length > 0) {
    if (diasParados === undefined || diasParados <= 0) {
      return { custosIncluidos, custosIgnorados, alertas, premissas, erro: `${rotulo}: "custosFixos" detalhados exigem "diasParados" maior que zero.` };
    }
    const resultadoCustoDia = calcularCustoDia({
      modo: "CUSTO_FIXO_DIARIO",
      custosFixos: v.custosFixos,
      tipoDia: v.tipoDia,
      diasCorridosPeriodo: v.diasCorridosPeriodo,
      diasUteisPeriodo: v.diasUteisPeriodo,
      permitirEstimativas,
    });
    if (!resultadoCustoDia.sucesso || resultadoCustoDia.custoFixoDiario === undefined) {
      return { custosIncluidos, custosIgnorados, alertas, premissas, erro: `${rotulo}: não foi possível normalizar "custosFixos" (${resultadoCustoDia.mensagemResumo}).` };
    }
    alertas.push(...resultadoCustoDia.alertas);
    premissas.push(...resultadoCustoDia.premissas.map((p) => `${rotulo}: ${p}`));
    candidatos.push({ chave: "detalhado", rotulo: "custosFixos (via calcular_custo_dia) × diasParados", valor: resultadoCustoDia.custoFixoDiario * diasParados });
  }

  if (candidatos.length === 0) return { custosIncluidos, custosIgnorados, alertas, premissas };

  if (candidatos.length > 1) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return {
        custosIncluidos,
        custosIgnorados,
        alertas,
        premissas,
        erro: `${rotulo}: custo fixo da parada informado por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".`,
      };
    }
    let vencedor = candidatos[0];
    if (estrategia === "PRIORIZAR_VALOR_DIARIO") vencedor = candidatos.find((c) => c.chave === "diario") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_VALOR_HORA") vencedor = candidatos.find((c) => c.chave === "hora") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_DETALHADO") vencedor = candidatos.find((c) => c.chave === "detalhado") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_FONTE_EXTERNA") vencedor = candidatos.find((c) => c.chave === "externa") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_TOTAL") vencedor = candidatos.find((c) => c.chave === "diario" || c.chave === "hora") ?? candidatos[0];
    alertas.push(`${rotulo}: sobreposição de custo fixo resolvida por "${estrategia}" — usado ${vencedor.rotulo}, ignoradas as demais fontes.`);
    custosIncluidos.push(vencedor.rotulo);
    return { custoFixoParada: vencedor.valor, origem: vencedor.rotulo, custosIncluidos, custosIgnorados, alertas, premissas };
  }

  custosIncluidos.push(candidatos[0].rotulo);
  return { custoFixoParada: candidatos[0].valor, origem: candidatos[0].rotulo, custosIncluidos, custosIgnorados, alertas, premissas };
}

// ---------------------------------------------------------------------------
// Custo adicional da parada (com bases percentuais, inclusive circular)
// ---------------------------------------------------------------------------

interface CustoAdicionalResolvido {
  custoAdicionalParada?: number;
  custosIncluidos: string[];
  alertas: string[];
  erro?: string;
}

function resolverCustoAdicionalParada(
  v: DadosCustoParadaVariante,
  custoFixoParada: number | undefined,
  receitaNaoRealizada: number | undefined,
  estrategia: EstrategiaSobreposicaoCustoParada,
  rotulo: string
): CustoAdicionalResolvido {
  const alertas: string[] = [];
  const custosIncluidos: string[] = [];

  const temTotal = v.custoAdicionalTotalInformado !== undefined;
  const temDetalhado = v.custosAdicionais !== undefined && v.custosAdicionais.length > 0;

  if (temTotal && temDetalhado) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return { custosIncluidos, alertas, erro: `${rotulo}: custo adicional informado tanto por "custoAdicionalTotalInformado" quanto por "custosAdicionais". Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".` };
    }
    if (estrategia === "PRIORIZAR_DETALHADO") {
      alertas.push(`${rotulo}: sobreposição de custo adicional resolvida por "PRIORIZAR_DETALHADO" — ignorado "custoAdicionalTotalInformado".`);
    } else {
      custosIncluidos.push("custoAdicionalTotalInformado");
      alertas.push(`${rotulo}: sobreposição de custo adicional resolvida por "${estrategia}" — usado "custoAdicionalTotalInformado", ignorados "custosAdicionais".`);
      return { custoAdicionalParada: v.custoAdicionalTotalInformado, custosIncluidos, alertas };
    }
  } else if (temTotal) {
    custosIncluidos.push("custoAdicionalTotalInformado");
    return { custoAdicionalParada: v.custoAdicionalTotalInformado, custosIncluidos, alertas };
  }

  if (!temDetalhado) return { custosIncluidos, alertas };

  const itens = v.custosAdicionais as ItemCustoAdicional[];
  let somaFixa = 0;
  let somaPercentualCircular = 0;
  const ctx = { quantidadeVeiculos: v.quantidadeVeiculos, quantidadeMotoristas: undefined, quantidadeAjudantes: undefined };

  for (const item of itens) {
    const nome = item.descricao ?? item.categoria ?? "custo adicional";
    if (item.incluidoEmOutroCusto) continue;

    if (item.base === "PERCENTUAL") {
      const pctDecimal = item.valor / 100;
      switch (item.basePercentual) {
        case "RECEITA_NAO_REALIZADA":
          if (receitaNaoRealizada === undefined) return { custosIncluidos, alertas, erro: `${rotulo}: "${nome}" (PERCENTUAL sobre RECEITA_NAO_REALIZADA) exige a receita não realizada calculável.` };
          somaFixa += pctDecimal * receitaNaoRealizada;
          custosIncluidos.push(nome);
          break;
        case "VALOR_DO_FRETE":
          if (v.valorFreteCancelado === undefined) return { custosIncluidos, alertas, erro: `${rotulo}: "${nome}" (PERCENTUAL sobre VALOR_DO_FRETE) exige "valorFreteCancelado".` };
          somaFixa += pctDecimal * v.valorFreteCancelado;
          custosIncluidos.push(nome);
          break;
        case "CUSTO_REPARO":
          if (v.custoReparoInformado === undefined) return { custosIncluidos, alertas, erro: `${rotulo}: "${nome}" (PERCENTUAL sobre CUSTO_REPARO) exige "custoReparoInformado".` };
          somaFixa += pctDecimal * v.custoReparoInformado;
          custosIncluidos.push(nome);
          break;
        case "CUSTO_TOTAL_PARADA":
          somaPercentualCircular += pctDecimal;
          custosIncluidos.push(`${nome} (% do custo total da parada)`);
          break;
        default:
          return { custosIncluidos, alertas, erro: `${rotulo}: "${nome}" usa "basePercentual" ainda não implementada nesta fase (VALOR_FIXO).` };
      }
      continue;
    }

    switch (item.base) {
      case "VALOR_TOTAL":
      case "POR_EVENTO":
        somaFixa += item.valor;
        break;
      case "POR_PESSOA":
      case "POR_VEICULO":
        if (ctx.quantidadeVeiculos === undefined || ctx.quantidadeVeiculos <= 0) return { custosIncluidos, alertas, erro: `${rotulo}: "${nome}" (${item.base}) exige "quantidadeVeiculos" maior que zero.` };
        somaFixa += item.valor * ctx.quantidadeVeiculos;
        break;
      case "POR_UNIDADE":
        if (item.quantidade === undefined || item.quantidade <= 0) return { custosIncluidos, alertas, erro: `${rotulo}: "${nome}" (POR_UNIDADE) exige "quantidade" maior que zero.` };
        somaFixa += item.valor * item.quantidade;
        break;
      default:
        // POR_HORA/POR_DIA/POR_VIAGEM: sem base de tempo/viagem dedicada nesta fase — tratado como valor já totalizado.
        somaFixa += item.valor;
        break;
    }
    custosIncluidos.push(nome);
  }

  if (somaPercentualCircular > 0) {
    if (somaPercentualCircular >= 1) {
      return { custosIncluidos, alertas, erro: `${rotulo}: a soma dos percentuais sobre o custo total da própria parada (${formatarNumero(somaPercentualCircular * 100)}%) é maior ou igual a 100% — denominador inválido.` };
    }
    const baseFixaTotal = (custoFixoParada ?? 0) + somaFixa;
    const parcelaCircular = (somaPercentualCircular * baseFixaTotal) / (1 - somaPercentualCircular);
    return { custoAdicionalParada: somaFixa + parcelaCircular, custosIncluidos, alertas };
  }

  return { custoAdicionalParada: somaFixa, custosIncluidos, alertas };
}

// ---------------------------------------------------------------------------
// Custos evitados
// ---------------------------------------------------------------------------

function resolverCustosEvitados(v: DadosCustoParadaVariante, casasKm: number): { custosEvitados?: number; custosIncluidos: string[]; nivel: NivelConfianca } {
  const itens = v.custosEvitados ?? [];
  let soma = 0;
  const custosIncluidos: string[] = [];
  let temEstimado = false;

  for (const item of itens) {
    soma += item.valor * (item.quantidade ?? 1);
    custosIncluidos.push(item.descricao ?? "custo evitado");
    if (item.certeza === "ESTIMADO") temEstimado = true;
  }

  if (v.resumoCpk?.cpk !== undefined && v.kmNaoRealizados !== undefined && v.kmNaoRealizados > 0) {
    soma += arredondar(v.resumoCpk.cpk * v.kmNaoRealizados, casasKm);
    custosIncluidos.push("resumoCpk.cpk × kmNaoRealizados");
  }
  if (v.resumoCustoViagem?.custosVariaveis !== undefined) {
    soma += v.resumoCustoViagem.custosVariaveis;
    custosIncluidos.push("resumoCustoViagem.custosVariaveis");
  }

  if (custosIncluidos.length === 0) return { custosIncluidos: [], nivel: "NAO_AVALIADO" };
  return { custosEvitados: soma, custosIncluidos, nivel: temEstimado ? "ESTIMADO" : "CONFIRMADO" };
}

// ---------------------------------------------------------------------------
// Receita não realizada
// ---------------------------------------------------------------------------

interface ReceitaResolvida {
  receitaNaoRealizada?: number;
  origem?: string;
  erro?: string;
}

function resolverReceitaNaoRealizada(v: DadosCustoParadaVariante, diasParados: number | undefined, horasParadas: number | undefined, estrategia: EstrategiaSobreposicao, rotulo: string): ReceitaResolvida {
  const candidatos: Array<{ rotulo: string; valor: number }> = [];

  if (v.receitaMediaDia !== undefined && diasParados !== undefined && diasParados > 0) candidatos.push({ rotulo: "receitaMediaDia × diasParados", valor: v.receitaMediaDia * diasParados });
  if (v.receitaMediaHora !== undefined && horasParadas !== undefined && horasParadas > 0) candidatos.push({ rotulo: "receitaMediaHora × horasParadas", valor: v.receitaMediaHora * horasParadas });
  if (v.receitaMediaViagem !== undefined && v.quantidadeViagensPerdidas !== undefined) candidatos.push({ rotulo: "receitaMediaViagem × quantidadeViagensPerdidas", valor: v.receitaMediaViagem * v.quantidadeViagensPerdidas });
  if (v.receitaMediaKm !== undefined && v.kmNaoRealizados !== undefined) candidatos.push({ rotulo: "receitaMediaKm × kmNaoRealizados", valor: v.receitaMediaKm * v.kmNaoRealizados });
  if (v.valorFreteCancelado !== undefined) candidatos.push({ rotulo: "valorFreteCancelado", valor: v.valorFreteCancelado });
  if (v.receitaContratadaNaoRealizada !== undefined) candidatos.push({ rotulo: "receitaContratadaNaoRealizada", valor: v.receitaContratadaNaoRealizada });

  if (candidatos.length === 0) return {};
  if (candidatos.length > 1 && estrategia === "REJEITAR_SOBREPOSICAO") {
    return { erro: `${rotulo}: receita não realizada informada por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoReceita".` };
  }
  const vencedor = estrategia === "PRIORIZAR_DETALHADO" ? candidatos[candidatos.length - 1] : candidatos[0];
  return { receitaNaoRealizada: vencedor.valor, origem: vencedor.rotulo };
}

// ---------------------------------------------------------------------------
// Lucro não realizado
// ---------------------------------------------------------------------------

interface LucroResolvido {
  lucroNaoRealizado?: number;
  origem?: string;
  erro?: string;
}

function resolverLucroNaoRealizado(
  v: DadosCustoParadaVariante,
  receitaNaoRealizada: number | undefined,
  custosEvitados: number | undefined,
  diasParados: number | undefined,
  horasParadas: number | undefined,
  estrategia: EstrategiaSobreposicao,
  rotulo: string
): LucroResolvido {
  const candidatos: Array<{ rotulo: string; valor: number }> = [];

  if (receitaNaoRealizada !== undefined && v.margemMediaPercentual !== undefined) {
    candidatos.push({ rotulo: "receitaNaoRealizada × margemMediaPercentual", valor: receitaNaoRealizada * (v.margemMediaPercentual / 100) });
  }
  if (v.lucroMedioDia !== undefined && diasParados !== undefined && diasParados > 0) {
    candidatos.push({ rotulo: "lucroMedioDia × diasParados", valor: v.lucroMedioDia * diasParados });
  }
  if (v.lucroMedioHora !== undefined && horasParadas !== undefined && horasParadas > 0) {
    candidatos.push({ rotulo: "lucroMedioHora × horasParadas", valor: v.lucroMedioHora * horasParadas });
  }
  if (receitaNaoRealizada !== undefined && custosEvitados !== undefined) {
    // Reutiliza calcularMargem (MARGEM_SIMPLES): lucro pela operação evitada = receita não realizada − custos variáveis evitados.
    const resultadoMargem = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: receitaNaoRealizada, custoTotal: custosEvitados, estrategiaSobreposicao: "REJEITAR_SOBREPOSICAO" });
    if (resultadoMargem.sucesso && resultadoMargem.lucroLiquidoEstimado !== undefined) {
      candidatos.push({ rotulo: "receitaNaoRealizada − custosVariaveisEvitados (via calcular_margem)", valor: resultadoMargem.lucroLiquidoEstimado });
    }
  }

  if (candidatos.length === 0) return {};
  if (candidatos.length > 1 && estrategia === "REJEITAR_SOBREPOSICAO") {
    return { erro: `${rotulo}: lucro não realizado calculável por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma base, ou defina "estrategiaSobreposicaoLucro".` };
  }
  const vencedor = estrategia === "PRIORIZAR_DETALHADO" ? candidatos[candidatos.length - 1] : candidatos[0];
  return { lucroNaoRealizado: vencedor.valor, origem: vencedor.rotulo };
}

// ---------------------------------------------------------------------------
// Núcleo de cálculo
// ---------------------------------------------------------------------------

interface AgregacaoCustoParada {
  diasParados?: number;
  horasParadas?: number;
  baseDuracao?: string;

  custoFixoParada?: number;
  custoAdicionalParada?: number;
  custoDiretoParada?: number;
  custosEvitados?: number;
  custoLiquidoDireto?: number;
  receitaNaoRealizada?: number;
  lucroNaoRealizado?: number;
  custoOportunidade?: number;
  impactoCaixa?: number;
  impactoEconomico?: number;

  custoPorHoraParada?: number;
  custoPorDiaParada?: number;

  percentualFrotaParada?: number;
  taxaIndisponibilidade?: number;
  utilizacaoAntes?: number;
  utilizacaoDepois?: number;
  impactoUtilizacao?: number;

  diasParaRecuperar?: number;
  horasParaRecuperar?: number;

  custoVeiculoSubstituto?: number;
  resultadoSubstituto?: number;
  beneficioLiquidoSubstituto?: number;

  valorMaximoJustificavelReducao?: number;
  economiaPorDiaReduzido?: number;

  custoTotalAlternativa?: number;
  resultadoLiquidoEspera?: number;

  classificacao?: ClassificacaoCustoParada;
  nivelConfianca?: NivelConfianca;

  custosIncluidos: string[];
  custosIgnorados: string[];
  dadosPresentes: string[];
  indicadoresNaoAvaliados: string[];
  alertas: string[];
  premissas: string[];
  dadosFaltantes: string[];
  errosValidacao: string[];

  custoValido: boolean;
  duracaoValida: boolean;
}

interface ConfigCustoParada {
  estrategiaCusto: EstrategiaSobreposicaoCustoParada;
  estrategiaDuracao: EstrategiaSobreposicaoDuracao;
  estrategiaReceita: EstrategiaSobreposicao;
  estrategiaLucro: EstrategiaSobreposicao;
  toleranciaPercentual: number;
  permitirEstimativas?: boolean;
  casas: CasasDecimaisCustoParada;
}

function calcularNucleo(v: DadosCustoParadaVariante, modo: ModoCustoVeiculoParado, config: ConfigCustoParada, rotulo: string): AgregacaoCustoParada {
  const alertas: string[] = [];
  const premissas: string[] = [];
  const dadosFaltantes: string[] = [];
  const dadosPresentes: string[] = [];
  const indicadoresNaoAvaliados: string[] = [];
  const errosValidacao: string[] = [];

  const duracao = resolverDuracao(v, config.estrategiaDuracao, rotulo);
  if (duracao.erro) errosValidacao.push(duracao.erro);
  alertas.push(...duracao.alertas);
  premissas.push(...duracao.premissas);

  const { diasParados, horasParadas, baseDuracao } = duracao;
  if (diasParados !== undefined) dadosPresentes.push("diasParados");
  if (horasParadas !== undefined) dadosPresentes.push("horasParadas");

  const c = config.casas.moeda;

  // Receita não realizada (calculada cedo — pode ser base percentual de custosAdicionais).
  const receita = resolverReceitaNaoRealizada(v, diasParados, horasParadas, config.estrategiaReceita, rotulo);
  if (receita.erro) errosValidacao.push(receita.erro);

  // Custo fixo.
  const fixo = resolverCustoFixoParada(v, diasParados, horasParadas, config.estrategiaCusto, config.permitirEstimativas, rotulo);
  if (fixo.erro) errosValidacao.push(fixo.erro);
  alertas.push(...fixo.alertas);
  premissas.push(...fixo.premissas);

  // Custo adicional (pode depender da receita não realizada, se PERCENTUAL sobre ela).
  const adicional = errosValidacao.length === 0 ? resolverCustoAdicionalParada(v, fixo.custoFixoParada, receita.receitaNaoRealizada, config.estrategiaCusto, rotulo) : { custosIncluidos: [], alertas: [] as string[] };
  if ("erro" in adicional && adicional.erro) errosValidacao.push(adicional.erro);
  alertas.push(...adicional.alertas);

  if (v.custoTotalParadaInformado === undefined && fixo.custoFixoParada === undefined && adicional.custoAdicionalParada === undefined) {
    dadosFaltantes.push(`${rotulo}.custoFixoDiarioInformado (ou custosFixos, ou custoTotalParadaInformado)`);
  }
  if (diasParados === undefined && horasParadas === undefined && v.custoTotalParadaInformado === undefined) {
    dadosFaltantes.push(`${rotulo}.diasParados (ou horasParadas, ou dataInicio+dataFim)`);
  }

  if (errosValidacao.length > 0 || dadosFaltantes.length > 0) {
    return {
      diasParados,
      horasParadas,
      baseDuracao,
      custosIncluidos: [],
      custosIgnorados: [],
      dadosPresentes,
      indicadoresNaoAvaliados,
      alertas,
      premissas,
      dadosFaltantes,
      errosValidacao,
      custoValido: fixo.custoFixoParada !== undefined || v.custoTotalParadaInformado !== undefined,
      duracaoValida: diasParados !== undefined || horasParadas !== undefined,
    };
  }

  const custosIncluidos = [...fixo.custosIncluidos, ...adicional.custosIncluidos];
  const custosIgnorados = [...fixo.custosIgnorados];

  const custoFixoParada = fixo.custoFixoParada;
  const custoAdicionalParada = adicional.custoAdicionalParada;
  let custoDiretoParada: number | undefined;
  if (v.custoTotalParadaInformado !== undefined) {
    custoDiretoParada = v.custoTotalParadaInformado;
    custosIncluidos.push("custoTotalParadaInformado");
  } else if (custoFixoParada !== undefined || custoAdicionalParada !== undefined) {
    custoDiretoParada = (custoFixoParada ?? 0) + (custoAdicionalParada ?? 0);
  }

  // Custos evitados.
  const evitadosResolvidos = resolverCustosEvitados(v, config.casas.km);
  const custosEvitados = evitadosResolvidos.custosEvitados;
  if (custosEvitados !== undefined) custosIncluidos.push(...evitadosResolvidos.custosIncluidos);
  else if (dadosFaltantes.length === 0) custosIgnorados.push("custosEvitados");

  const custoLiquidoDireto = custoDiretoParada !== undefined ? custoDiretoParada - (custosEvitados ?? 0) : undefined;
  if (custoLiquidoDireto !== undefined && custosEvitados !== undefined && custosEvitados > custoDiretoParada!) {
    alertas.push("Os custos evitados superam o custo direto da parada — isso não significa lucro; analise a receita não realizada para uma conclusão financeira completa.");
  }

  if (receita.receitaNaoRealizada === undefined) indicadoresNaoAvaliados.push("receitaNaoRealizada", "lucroNaoRealizado");

  const lucro =
    receita.receitaNaoRealizada !== undefined || v.lucroMedioDia !== undefined || v.lucroMedioHora !== undefined
      ? resolverLucroNaoRealizado(v, receita.receitaNaoRealizada, custosEvitados, diasParados, horasParadas, config.estrategiaLucro, rotulo)
      : {};
  if (lucro.erro) errosValidacao.push(lucro.erro);

  if (errosValidacao.length > 0) {
    return {
      diasParados,
      horasParadas,
      baseDuracao,
      custosIncluidos,
      custosIgnorados,
      dadosPresentes,
      indicadoresNaoAvaliados,
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      custoValido: true,
      duracaoValida: true,
    };
  }

  // Custo de oportunidade — nunca calculado sem alternativa informada.
  let custoOportunidade: number | undefined;
  if (v.custoOportunidadeInformado !== undefined) {
    custoOportunidade = v.custoOportunidadeInformado;
  } else {
    indicadoresNaoAvaliados.push("custoOportunidade");
  }

  // Visões de caixa e econômica.
  const impactoCaixa = custoAdicionalParada !== undefined || custoFixoParada !== undefined ? (custoAdicionalParada ?? 0) + (custoFixoParada ?? 0) - (custosEvitados ?? 0) : undefined;
  const impactoEconomico = custoLiquidoDireto !== undefined ? custoLiquidoDireto + (lucro.lucroNaoRealizado ?? 0) + (custoOportunidade ?? 0) : undefined;

  const impactoSelecionado = impactoEconomico ?? impactoCaixa ?? custoDiretoParada ?? custoLiquidoDireto;
  const custoPorHoraParada = impactoSelecionado !== undefined && horasParadas !== undefined && horasParadas > 0 ? dividirViaCpk(impactoSelecionado, horasParadas, config.casas.hora) : undefined;
  const custoPorDiaParada = impactoSelecionado !== undefined && diasParados !== undefined && diasParados > 0 ? dividirViaCpk(impactoSelecionado, diasParados, config.casas.dia) : undefined;

  // Frota / indisponibilidade.
  const percentualFrotaParada = v.quantidadeVeiculosParados !== undefined && v.quantidadeVeiculosFrota !== undefined && v.quantidadeVeiculosFrota > 0 ? arredondar((v.quantidadeVeiculosParados / v.quantidadeVeiculosFrota) * 100, config.casas.percentual) : undefined;
  const taxaIndisponibilidade = diasParados !== undefined && v.diasDisponiveisPeriodo !== undefined && v.diasDisponiveisPeriodo > 0 ? arredondar((diasParados / v.diasDisponiveisPeriodo) * 100, config.casas.percentual) : undefined;

  let utilizacaoAntes: number | undefined;
  let utilizacaoDepois: number | undefined;
  let impactoUtilizacao: number | undefined;
  if (v.diasDisponiveisPeriodo !== undefined && v.diasDisponiveisPeriodo > 0 && v.diasOperadosPlanejadosPeriodo !== undefined && v.diasOperadosPeriodo !== undefined) {
    utilizacaoAntes = arredondar((v.diasOperadosPlanejadosPeriodo / v.diasDisponiveisPeriodo) * 100, config.casas.percentual);
    utilizacaoDepois = arredondar((v.diasOperadosPeriodo / v.diasDisponiveisPeriodo) * 100, config.casas.percentual);
    impactoUtilizacao = arredondar(utilizacaoDepois - utilizacaoAntes, config.casas.percentual);
  }

  // Ponto de equilíbrio da parada.
  let diasParaRecuperar: number | undefined;
  let horasParaRecuperar: number | undefined;
  if (impactoEconomico !== undefined && v.lucroMedioDia !== undefined && v.lucroMedioDia > 0) {
    diasParaRecuperar = arredondar(impactoEconomico / v.lucroMedioDia, config.casas.dia);
  }
  if (impactoEconomico !== undefined && v.lucroMedioHora !== undefined && v.lucroMedioHora > 0) {
    horasParaRecuperar = arredondar(impactoEconomico / v.lucroMedioHora, config.casas.hora);
  }

  // Veículo substituto.
  let custoVeiculoSubstituto: number | undefined;
  if (v.custoVeiculoSubstitutoTotal !== undefined) custoVeiculoSubstituto = v.custoVeiculoSubstitutoTotal;
  else if (v.custoVeiculoSubstitutoDia !== undefined && diasParados !== undefined) custoVeiculoSubstituto = v.custoVeiculoSubstitutoDia * diasParados;
  let resultadoSubstituto: number | undefined;
  let beneficioLiquidoSubstituto: number | undefined;
  if (v.receitaGeradaSubstituto !== undefined && custoVeiculoSubstituto !== undefined) {
    resultadoSubstituto = v.receitaGeradaSubstituto - custoVeiculoSubstituto;
    if (impactoSelecionado !== undefined) beneficioLiquidoSubstituto = impactoSelecionado + resultadoSubstituto;
  }

  // Redução de tempo parado.
  let valorMaximoJustificavelReducao: number | undefined;
  if (custoPorDiaParada !== undefined && v.diasReducaoAnalisados !== undefined) {
    valorMaximoJustificavelReducao = arredondar(custoPorDiaParada * v.diasReducaoAnalisados, c);
  }
  const economiaPorDiaReduzido = custoPorDiaParada;

  // Comparação de alternativa (reparo/oficina).
  let custoTotalAlternativa: number | undefined;
  if (v.custoReparoInformado !== undefined && custoDiretoParada !== undefined) {
    custoTotalAlternativa = arredondar(v.custoReparoInformado + custoDiretoParada + (custoOportunidade ?? 0), c);
  }

  // Espera (aguardando carga/descarga).
  let resultadoLiquidoEspera: number | undefined;
  if (v.receitaEstadiaInformada !== undefined && custoDiretoParada !== undefined) {
    resultadoLiquidoEspera = arredondar(v.receitaEstadiaInformada - custoDiretoParada, c);
  }

  // Classificação.
  const classificacao = classificar(modo, {
    impactoEconomico,
    diasParados,
    percentualFrotaParada,
    receitaAvaliada: receita.receitaNaoRealizada !== undefined,
    custoDiretoParada,
  });

  // Nível de confiança (visão consolidada, não por campo).
  const usouEstimativa = alertas.some((a) => a.includes("estimativa")) || premissas.some((p) => p.includes("estimativa") || p.includes("dias corridos entre"));
  let nivelConfianca: NivelConfianca;
  if (receita.receitaNaoRealizada === undefined && lucro.lucroNaoRealizado === undefined) nivelConfianca = "PARCIAL";
  else if (usouEstimativa || evitadosResolvidos.nivel === "ESTIMADO") nivelConfianca = "ESTIMADO";
  else nivelConfianca = "CONFIRMADO";

  return {
    diasParados: diasParados !== undefined ? arredondar(diasParados, config.casas.dia) : undefined,
    horasParadas: horasParadas !== undefined ? arredondar(horasParadas, config.casas.hora) : undefined,
    baseDuracao,

    custoFixoParada: custoFixoParada !== undefined ? arredondar(custoFixoParada, c) : undefined,
    custoAdicionalParada: custoAdicionalParada !== undefined ? arredondar(custoAdicionalParada, c) : undefined,
    custoDiretoParada: custoDiretoParada !== undefined ? arredondar(custoDiretoParada, c) : undefined,
    custosEvitados: custosEvitados !== undefined ? arredondar(custosEvitados, c) : undefined,
    custoLiquidoDireto: custoLiquidoDireto !== undefined ? arredondar(custoLiquidoDireto, c) : undefined,
    receitaNaoRealizada: receita.receitaNaoRealizada !== undefined ? arredondar(receita.receitaNaoRealizada, c) : undefined,
    lucroNaoRealizado: lucro.lucroNaoRealizado !== undefined ? arredondar(lucro.lucroNaoRealizado, c) : undefined,
    custoOportunidade: custoOportunidade !== undefined ? arredondar(custoOportunidade, c) : undefined,
    impactoCaixa: impactoCaixa !== undefined ? arredondar(impactoCaixa, c) : undefined,
    impactoEconomico: impactoEconomico !== undefined ? arredondar(impactoEconomico, c) : undefined,

    custoPorHoraParada,
    custoPorDiaParada,

    percentualFrotaParada,
    taxaIndisponibilidade,
    utilizacaoAntes,
    utilizacaoDepois,
    impactoUtilizacao,

    diasParaRecuperar,
    horasParaRecuperar,

    custoVeiculoSubstituto: custoVeiculoSubstituto !== undefined ? arredondar(custoVeiculoSubstituto, c) : undefined,
    resultadoSubstituto: resultadoSubstituto !== undefined ? arredondar(resultadoSubstituto, c) : undefined,
    beneficioLiquidoSubstituto: beneficioLiquidoSubstituto !== undefined ? arredondar(beneficioLiquidoSubstituto, c) : undefined,

    valorMaximoJustificavelReducao,
    economiaPorDiaReduzido,

    custoTotalAlternativa,
    resultadoLiquidoEspera,

    classificacao,
    nivelConfianca,

    custosIncluidos,
    custosIgnorados,
    dadosPresentes,
    indicadoresNaoAvaliados,
    alertas,
    premissas,
    dadosFaltantes: [],
    errosValidacao: [],
    custoValido: true,
    duracaoValida: true,
  };
}

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

function classificar(
  modo: ModoCustoVeiculoParado,
  ctx: { impactoEconomico?: number; diasParados?: number; percentualFrotaParada?: number; receitaAvaliada: boolean; custoDiretoParada?: number }
): ClassificacaoCustoParada {
  if (ctx.impactoEconomico === undefined && ctx.custoDiretoParada === undefined) return "DADOS_INSUFICIENTES";
  if (modo === "PARADA_PROGRAMADA") return "PARADA_PROGRAMADA_CONTROLADA";

  const valor = ctx.impactoEconomico ?? ctx.custoDiretoParada as number;
  if (!ctx.receitaAvaliada) {
    if (valor <= 0) return "SOMENTE_CUSTO_FIXO";
    return "SEM_RECEITA_AVALIADA";
  }
  if (valor >= LIMITES_CLASSIFICACAO_PADRAO.impactoCriticoValor) return "IMPACTO_CRITICO";
  if (valor >= LIMITES_CLASSIFICACAO_PADRAO.impactoAltoValor) return "ALTO_IMPACTO";
  if (valor >= LIMITES_CLASSIFICACAO_PADRAO.impactoModeradoValor) return "IMPACTO_MODERADO";
  return "BAIXO_IMPACTO";
}

// ---------------------------------------------------------------------------
// Nível de completude
// ---------------------------------------------------------------------------

function determinarCompletude(ag: AgregacaoCustoParada): NivelCompletude {
  if (!ag.custoValido || !ag.duracaoValida || ag.custoDiretoParada === undefined) return "INSUFICIENTE";
  if (ag.receitaNaoRealizada === undefined || ag.custosEvitados === undefined) return "PARCIAL";
  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirMemoriaCalculo(rotulo: string, ag: AgregacaoCustoParada): string[] {
  const linhas: string[] = [];
  if (ag.diasParados !== undefined) linhas.push(`${rotulo}: duração = ${formatarNumero(ag.diasParados)} dia(s) (base: ${ag.baseDuracao ?? "não informada"}).`);
  if (ag.custoFixoParada !== undefined) linhas.push(`${rotulo}: custo fixo da parada = ${formatarBRL(ag.custoFixoParada)}.`);
  if (ag.custoAdicionalParada !== undefined) linhas.push(`${rotulo}: custo adicional da parada = ${formatarBRL(ag.custoAdicionalParada)}.`);
  if (ag.custoDiretoParada !== undefined) linhas.push(`${rotulo}: custo direto da parada = fixo + adicional = ${formatarBRL(ag.custoDiretoParada)}.`);
  if (ag.custosEvitados !== undefined) linhas.push(`${rotulo}: custos evitados = ${formatarBRL(ag.custosEvitados)}; custo líquido direto = ${formatarBRL(ag.custoLiquidoDireto ?? 0)}.`);
  if (ag.receitaNaoRealizada !== undefined) linhas.push(`${rotulo}: receita não realizada = ${formatarBRL(ag.receitaNaoRealizada)}.`);
  if (ag.lucroNaoRealizado !== undefined) linhas.push(`${rotulo}: lucro não realizado = ${formatarBRL(ag.lucroNaoRealizado)}.`);
  if (ag.impactoCaixa !== undefined) linhas.push(`${rotulo}: impacto de caixa = ${formatarBRL(ag.impactoCaixa)}.`);
  if (ag.impactoEconomico !== undefined) linhas.push(`${rotulo}: impacto econômico = custo líquido direto + lucro não realizado + custo de oportunidade = ${formatarBRL(ag.impactoEconomico)}.`);
  return linhas;
}

function construirResumo(ag: AgregacaoCustoParada, nivelCompletude: NivelCompletude): string {
  if (ag.custoDiretoParada === undefined) {
    return "Não foi possível calcular o custo da parada com os dados informados. Verifique os campos faltantes.";
  }
  const partes: string[] = [];
  if (ag.diasParados !== undefined) partes.push(`O veículo permaneceu parado por ${formatarNumero(ag.diasParados)} dia(s).`);
  if (ag.custoFixoParada !== undefined && ag.custoAdicionalParada !== undefined) {
    partes.push(`Os custos fixos que continuaram existindo somaram ${formatarBRL(ag.custoFixoParada)}, e os custos adicionais da parada foram de ${formatarBRL(ag.custoAdicionalParada)}.`);
  }
  if (ag.custosEvitados !== undefined) partes.push(`Foram identificados ${formatarBRL(ag.custosEvitados)} em custos operacionais evitados. O impacto direto líquido foi de ${formatarBRL(ag.custoLiquidoDireto ?? 0)}.`);
  if (ag.receitaNaoRealizada !== undefined) partes.push(`A receita não realizada foi estimada em ${formatarBRL(ag.receitaNaoRealizada)}.`);
  if (ag.lucroNaoRealizado !== undefined) partes.push(`O lucro não realizado estimado foi de ${formatarBRL(ag.lucroNaoRealizado)}.`);
  if (ag.impactoEconomico !== undefined) {
    partes.push(`O impacto econômico estimado totalizou ${formatarBRL(ag.impactoEconomico)}${ag.custoPorDiaParada !== undefined ? `, equivalente a ${formatarBRL(ag.custoPorDiaParada)} por dia parado` : ""}.`);
  }
  if (ag.classificacao) partes.push(`Classificação: ${ag.classificacao}.`);
  if (nivelCompletude === "PARCIAL") partes.push("A análise é parcial porque receita não realizada, custos evitados ou outros dados de resultado não foram totalmente informados.");
  else if (nivelCompletude === "INSUFICIENTE") partes.push("A análise foi classificada como insuficiente para um resultado confiável.");
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Pipeline por variante
// ---------------------------------------------------------------------------

function analisarVariante(v: DadosCustoParadaVariante, modo: ModoCustoVeiculoParado, rotulo: string, config: ConfigCustoParada): AgregacaoCustoParada {
  const errosEstrutura = validarVariante(v, rotulo);
  const ag = calcularNucleo(v, modo, config, rotulo);
  if (errosEstrutura.length > 0) ag.errosValidacao = [...errosEstrutura, ...ag.errosValidacao];
  return ag;
}

function paraResultadoCenario(id: string, nome: string, ag: AgregacaoCustoParada): ResultadoCenarioCustoParada {
  const sucesso = ag.errosValidacao.length === 0 && ag.dadosFaltantes.length === 0 && ag.custoDiretoParada !== undefined;
  const nivelCompletude = determinarCompletude(ag);
  return {
    id,
    nome,
    sucesso,
    alertas: ag.alertas,
    premissas: ag.premissas,
    dadosFaltantes: [...ag.dadosFaltantes, ...ag.errosValidacao],
    mensagemResumo: sucesso ? construirResumo(ag, nivelCompletude) : "Não foi possível calcular este registro — verifique os dados faltantes.",
    diasParados: ag.diasParados,
    horasParadas: ag.horasParadas,
    custoFixoParada: ag.custoFixoParada,
    custoAdicionalParada: ag.custoAdicionalParada,
    custoDiretoParada: ag.custoDiretoParada,
    custosEvitados: ag.custosEvitados,
    custoLiquidoDireto: ag.custoLiquidoDireto,
    receitaNaoRealizada: ag.receitaNaoRealizada,
    lucroNaoRealizado: ag.lucroNaoRealizado,
    impactoCaixa: ag.impactoCaixa,
    impactoEconomico: ag.impactoEconomico,
    custoTotalAlternativa: ag.custoTotalAlternativa,
    nivelCompletude,
  };
}

function construirRanking(itens: Array<{ id: string; nome: string; valor: number | undefined }>, maiorMelhor: boolean): ItemRankingCustoParada[] {
  const validos = itens.filter((i): i is { id: string; nome: string; valor: number } => i.valor !== undefined);
  const ordenados = [...validos].sort((a, b) => (maiorMelhor ? b.valor - a.valor : a.valor - b.valor));
  return ordenados.map((item, indice) => ({ id: item.id, nome: item.nome, valor: item.valor, posicao: indice + 1 }));
}

// ---------------------------------------------------------------------------
// Comparação de cenários
// ---------------------------------------------------------------------------

function compararCenarios(entrada: CalcularCustoVeiculoParadoEntrada, config: ConfigCustoParada): { comparacao: ComparacaoCenariosCustoParada; nivelCompletude: NivelCompletude } {
  const cenarios = entrada.cenarios as CenarioCustoParada[];
  const resultados = cenarios.map((cen, indice) => {
    const id = cen.id ?? `cenario-${indice + 1}`;
    const nome = cen.nome ?? cen.id ?? `Cenário ${indice + 1}`;
    const ag = analisarVariante(cen, "COMPARACAO_CENARIOS", nome, config);
    return paraResultadoCenario(id, nome, ag);
  });

  const rankingPorMenorDesembolso = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoTotalAlternativa ?? r.custoDiretoParada })), false);
  const rankingPorMenorImpactoEconomico = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.impactoEconomico })), false);
  const rankingPorMenorPrazo = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.diasParados })), false);
  const rankingPorMenorCustoAdicional = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoAdicionalParada })), false);
  const rankingPorMaiorPreservacaoReceita = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.receitaNaoRealizada !== undefined ? -r.receitaNaoRealizada : undefined })), true);

  const alertas: string[] = [];
  if (rankingPorMenorDesembolso.length > 0 && rankingPorMenorImpactoEconomico.length > 0 && rankingPorMenorDesembolso[0].id !== rankingPorMenorImpactoEconomico[0].id) {
    alertas.push("O cenário de menor desembolso não é o mesmo de menor impacto econômico — o menor preço não é automaticamente a melhor alternativa.");
  }

  const nivelCompletude: NivelCompletude = resultados.every((r) => r.nivelCompletude === "COMPLETO") ? "COMPLETO" : "PARCIAL";

  return {
    comparacao: { cenarios: resultados, rankingPorMenorDesembolso, rankingPorMenorImpactoEconomico, rankingPorMenorPrazo, rankingPorMenorCustoAdicional, rankingPorMaiorPreservacaoReceita, alertas },
    nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Consolidação de múltiplos veículos
// ---------------------------------------------------------------------------

function consolidarVeiculos(entrada: CalcularCustoVeiculoParadoEntrada, config: ConfigCustoParada): { consolidado: ResultadoConsolidadoCustoParada; nivelCompletude: NivelCompletude } {
  const veiculos = entrada.veiculos as VeiculoCustoParada[];
  const resultados = veiculos.map((veic, indice) => {
    const id = veic.identificacaoVeiculo ?? veic.placa ?? `veiculo-${indice + 1}`;
    const nome = veic.identificacaoVeiculo ?? veic.placa ?? `Veículo ${indice + 1}`;
    const ag = analisarVariante(veic, "MULTIPLOS_VEICULOS", nome, config);
    return paraResultadoCenario(id, nome, ag);
  });

  const validos = resultados.filter((r) => r.sucesso);
  const somaHoras = validos.reduce((acc, r) => acc + (r.horasParadas ?? 0), 0);
  const somaDias = validos.reduce((acc, r) => acc + (r.diasParados ?? 0), 0);
  const somaFixo = validos.reduce((acc, r) => acc + (r.custoFixoParada ?? 0), 0);
  const somaAdicional = validos.reduce((acc, r) => acc + (r.custoAdicionalParada ?? 0), 0);
  const somaDireto = validos.reduce((acc, r) => acc + (r.custoDiretoParada ?? 0), 0);
  const somaEvitados = validos.reduce((acc, r) => acc + (r.custosEvitados ?? 0), 0);
  const somaLiquido = validos.reduce((acc, r) => acc + (r.custoLiquidoDireto ?? 0), 0);
  const somaReceita = validos.reduce((acc, r) => acc + (r.receitaNaoRealizada ?? 0), 0);
  const somaLucro = validos.reduce((acc, r) => acc + (r.lucroNaoRealizado ?? 0), 0);
  const somaCaixa = validos.reduce((acc, r) => acc + (r.impactoCaixa ?? 0), 0);
  const somaEconomico = validos.reduce((acc, r) => acc + (r.impactoEconomico ?? 0), 0);

  const c = config.casas.moeda;
  const custoMedioPorHora = somaHoras > 0 ? dividirViaCpk(somaEconomico || somaDireto, somaHoras, config.casas.hora) : undefined;
  const custoMedioPorDia = somaDias > 0 ? dividirViaCpk(somaEconomico || somaDireto, somaDias, config.casas.dia) : undefined;
  const quantidadeVeiculosParados = entrada.quantidadeVeiculosParados ?? veiculos.length;
  const custoPorVeiculoParado = quantidadeVeiculosParados > 0 ? dividirViaCpk(somaEconomico || somaDireto, quantidadeVeiculosParados, c) : undefined;
  const receitaNaoRealizadaPorVeiculo = somaReceita > 0 && quantidadeVeiculosParados > 0 ? dividirViaCpk(somaReceita, quantidadeVeiculosParados, c) : undefined;
  const percentualFrotaParada = entrada.quantidadeVeiculosFrota !== undefined && entrada.quantidadeVeiculosFrota > 0 ? arredondar((quantidadeVeiculosParados / entrada.quantidadeVeiculosFrota) * 100, config.casas.percentual) : undefined;

  const rankingPorMaiorImpactoEconomico = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.impactoEconomico })), true);
  const rankingPorMaiorImpactoCaixa = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.impactoCaixa })), true);
  const rankingPorMaiorDuracao = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.diasParados ?? r.horasParadas })), true);
  const rankingPorMaiorReceitaNaoRealizada = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.receitaNaoRealizada })), true);
  const rankingPorMaiorLucroNaoRealizado = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.lucroNaoRealizado })), true);
  const rankingPorMaiorCustoAdicional = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoAdicionalParada })), true);

  const alertas: string[] = [];
  if (rankingPorMaiorImpactoEconomico.length > 1) {
    alertas.push("O custo médio por hora/dia consolidado usa impacto total ÷ horas/dias totais (média ponderada) — nunca a média simples dos veículos individuais.");
  }

  const nivelCompletude: NivelCompletude = resultados.length === 0 ? "INSUFICIENTE" : validos.length === resultados.length ? "COMPLETO" : validos.length > 0 ? "PARCIAL" : "INSUFICIENTE";

  return {
    consolidado: {
      quantidadeRegistros: veiculos.length,
      quantidadeVeiculosParados,
      quantidadeVeiculosFrota: entrada.quantidadeVeiculosFrota,
      percentualFrotaParada,
      horasParadasTotais: somaHoras > 0 ? arredondar(somaHoras, config.casas.hora) : undefined,
      diasParadosTotais: somaDias > 0 ? arredondar(somaDias, config.casas.dia) : undefined,
      custoFixoTotal: validos.length > 0 ? arredondar(somaFixo, c) : undefined,
      custoAdicionalTotal: validos.length > 0 ? arredondar(somaAdicional, c) : undefined,
      custoDiretoTotal: validos.length > 0 ? arredondar(somaDireto, c) : undefined,
      custosEvitadosTotais: somaEvitados > 0 ? arredondar(somaEvitados, c) : undefined,
      custoLiquidoDiretoTotal: validos.length > 0 ? arredondar(somaLiquido, c) : undefined,
      receitaNaoRealizadaTotal: somaReceita > 0 ? arredondar(somaReceita, c) : undefined,
      lucroNaoRealizadoTotal: somaLucro !== 0 ? arredondar(somaLucro, c) : undefined,
      impactoCaixaTotal: validos.length > 0 ? arredondar(somaCaixa, c) : undefined,
      impactoEconomicoTotal: validos.length > 0 ? arredondar(somaEconomico, c) : undefined,
      custoMedioPorHora,
      custoMedioPorDia,
      custoPorVeiculoParado,
      receitaNaoRealizadaPorVeiculo,
      resultadosIndividuais: resultados,
      rankingPorMaiorImpactoEconomico,
      rankingPorMaiorImpactoCaixa,
      rankingPorMaiorDuracao,
      rankingPorMaiorReceitaNaoRealizada,
      rankingPorMaiorLucroNaoRealizado,
      rankingPorMaiorCustoAdicional,
      alertas,
    },
    nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Previsto x realizado
// ---------------------------------------------------------------------------

function diferenca(previsto: number | undefined, realizado: number | undefined, casas: number): DiferencaCustoParada | undefined {
  if (previsto === undefined || realizado === undefined) return undefined;
  const diferencaAbsoluta = realizado - previsto;
  return {
    previsto: arredondar(previsto, casas),
    realizado: arredondar(realizado, casas),
    diferenca: arredondar(diferencaAbsoluta, casas),
    diferencaPercentual: previsto !== 0 ? arredondar((diferencaAbsoluta / previsto) * 100, 2) : undefined,
  };
}

function calcularPrevistoRealizado(entrada: CalcularCustoVeiculoParadoEntrada, config: ConfigCustoParada): { resultado?: PrevistoRealizadoCustoParada; agPrevisto: AgregacaoCustoParada; agRealizado: AgregacaoCustoParada } {
  const agPrevisto = analisarVariante(entrada.previsto as DadosCustoParadaVariante, "PREVISTO_X_REALIZADO", "previsto", config);
  const agRealizado = analisarVariante(entrada.realizado as DadosCustoParadaVariante, "PREVISTO_X_REALIZADO", "realizado", config);

  if (agPrevisto.errosValidacao.length > 0 || agPrevisto.dadosFaltantes.length > 0 || agRealizado.errosValidacao.length > 0 || agRealizado.dadosFaltantes.length > 0) {
    return { agPrevisto, agRealizado };
  }

  const c = config.casas.moeda;
  const d = config.casas.dia;

  const diasParados = diferenca(agPrevisto.diasParados, agRealizado.diasParados, d);
  const custoDiretoParada = diferenca(agPrevisto.custoDiretoParada, agRealizado.custoDiretoParada, c);
  const receitaNaoRealizada = diferenca(agPrevisto.receitaNaoRealizada, agRealizado.receitaNaoRealizada, c);
  const lucroNaoRealizado = diferenca(agPrevisto.lucroNaoRealizado, agRealizado.lucroNaoRealizado, c);
  const impactoEconomico = diferenca(agPrevisto.impactoEconomico, agRealizado.impactoEconomico, c);

  const categoriasAcimaDoPrevisto: string[] = [];
  const categoriasAbaixoDoPrevisto: string[] = [];
  for (const [nome, dif] of [
    ["Dias parados", diasParados],
    ["Custo direto", custoDiretoParada],
    ["Impacto econômico", impactoEconomico],
  ] as Array<[string, DiferencaCustoParada | undefined]>) {
    if (dif?.diferenca === undefined) continue;
    if (dif.diferenca > 0) categoriasAcimaDoPrevisto.push(nome);
    else if (dif.diferenca < 0) categoriasAbaixoDoPrevisto.push(nome);
  }

  const candidatosDesvio: Array<[string, number | undefined]> = [
    ["Dias parados", diasParados?.diferenca !== undefined ? Math.abs(diasParados.diferenca) : undefined],
    ["Custo direto", custoDiretoParada?.diferenca !== undefined ? Math.abs(custoDiretoParada.diferenca) : undefined],
    ["Impacto econômico", impactoEconomico?.diferenca !== undefined ? Math.abs(impactoEconomico.diferenca) : undefined],
  ];
  const maiorDesvio = candidatosDesvio.filter(([, valor]) => valor !== undefined).sort((a, b) => (b[1] as number) - (a[1] as number))[0];

  const alertas: string[] = [];
  if (custoDiretoParada && Math.abs(custoDiretoParada.diferencaPercentual ?? 0) >= 10) {
    alertas.push(`O custo direto da parada realizado ficou ${formatarNumero(custoDiretoParada.diferencaPercentual ?? 0)}% em relação ao previsto.`);
  }

  return {
    resultado: { diasParados, custoDiretoParada, receitaNaoRealizada, lucroNaoRealizado, impactoEconomico, principalDesvio: maiorDesvio?.[0], categoriasAcimaDoPrevisto, categoriasAbaixoDoPrevisto, alertas },
    agPrevisto,
    agRealizado,
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

function respostaFalha(modo: ModoCustoVeiculoParado, dadosFaltantes: string[], erros: string[], alertas: string[] = []): CalcularCustoVeiculoParadoResultado {
  return {
    sucesso: false,
    modo,
    alertas,
    premissas: [],
    dadosFaltantes: [...dadosFaltantes, ...erros],
    mensagemResumo: erros.length > 0 ? `Não foi possível calcular: ${erros.join(" ")}` : `Dados insuficientes para calcular o custo da parada. Faltam: ${dadosFaltantes.join(", ")}.`,
    nivelCompletude: "INSUFICIENTE",
    custosIncluidos: [],
    custosIgnorados: [],
    dadosPresentes: [],
    indicadoresNaoAvaliados: [],
    limitacoes: LIMITACOES_PADRAO,
    memoriaCalculo: [],
  };
}

export function calcularCustoVeiculoParado(entrada: CalcularCustoVeiculoParadoEntrada): CalcularCustoVeiculoParadoResultado {
  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) return respostaFalha(entrada.modo, [], errosTopo);

  const casas = casasDecimaisDe(entrada);
  const config: ConfigCustoParada = {
    estrategiaCusto: entrada.estrategiaSobreposicaoCusto ?? "REJEITAR_SOBREPOSICAO",
    estrategiaDuracao: entrada.estrategiaSobreposicaoDuracao ?? "REJEITAR_SOBREPOSICAO",
    estrategiaReceita: entrada.estrategiaSobreposicaoReceita ?? "REJEITAR_SOBREPOSICAO",
    estrategiaLucro: entrada.estrategiaSobreposicaoLucro ?? "REJEITAR_SOBREPOSICAO",
    toleranciaPercentual: entrada.toleranciaClassificacaoPercentual ?? TOLERANCIA_CLASSIFICACAO_PERCENTUAL_PADRAO,
    permitirEstimativas: entrada.permitirEstimativas,
    casas,
  };

  if (entrada.modo === "COMPARACAO_CENARIOS" || entrada.modo === "ANALISE_REPARAR_OU_SUBSTITUIR") {
    const { comparacao, nivelCompletude } = compararCenarios(entrada, config);
    const algumSucesso = comparacao.cenarios.some((c) => c.sucesso);
    return {
      sucesso: algumSucesso,
      modo: entrada.modo,
      alertas: comparacao.alertas,
      premissas: [],
      dadosFaltantes: algumSucesso ? [] : ["Nenhum cenário pôde ser calculado — verifique os dados de cada cenário."],
      mensagemResumo: algumSucesso
        ? `Comparação entre ${comparacao.cenarios.length} cenários concluída. Menor impacto econômico: ${comparacao.rankingPorMenorImpactoEconomico[0]?.nome ?? "—"}.`
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
      sucesso: consolidado.custoDiretoTotal !== undefined,
      modo: entrada.modo,
      alertas: consolidado.alertas,
      premissas: [],
      dadosFaltantes: consolidado.custoDiretoTotal === undefined ? ["Nenhum veículo pôde ser calculado — verifique os dados de cada veículo."] : [],
      mensagemResumo:
        consolidado.custoDiretoTotal !== undefined
          ? `${consolidado.quantidadeRegistros} veículos consolidados: custo direto total de ${formatarBRL(consolidado.custoDiretoTotal)}.`
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
      mensagemResumo: `Duração prevista de ${formatarNumero(resultado.diasParados?.previsto ?? 0)} dia(s) x realizada de ${formatarNumero(resultado.diasParados?.realizado ?? 0)} dia(s); custo direto previsto de ${formatarBRL(
        resultado.custoDiretoParada?.previsto ?? 0
      )} x realizado de ${formatarBRL(resultado.custoDiretoParada?.realizado ?? 0)} (variação de ${formatarNumero(resultado.custoDiretoParada?.diferencaPercentual ?? 0)}%).`,
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

  return {
    sucesso: true,
    modo: entrada.modo,
    identificacao: entrada.identificacao,
    descricao: entrada.descricao,
    identificacaoVeiculo: entrada.identificacaoVeiculo,
    placa: entrada.placa,
    motivoParada: entrada.motivoParada,
    tipoParada: entrada.tipoParada,
    statusParada: entrada.statusParada,

    horasParadas: ag.horasParadas,
    diasParados: ag.diasParados,
    baseDuracao: ag.baseDuracao,

    custoFixoParada: ag.custoFixoParada,
    custoAdicionalParada: ag.custoAdicionalParada,
    custoDiretoParada: ag.custoDiretoParada,
    custosEvitados: ag.custosEvitados,
    custoLiquidoDireto: ag.custoLiquidoDireto,
    receitaNaoRealizada: ag.receitaNaoRealizada,
    lucroNaoRealizado: ag.lucroNaoRealizado,
    custoOportunidade: ag.custoOportunidade,
    impactoCaixa: ag.impactoCaixa,
    impactoEconomico: ag.impactoEconomico,

    custoPorHoraParada: ag.custoPorHoraParada,
    custoPorDiaParada: ag.custoPorDiaParada,

    quantidadeViagensPerdidas: entrada.quantidadeViagensPerdidas,
    kmNaoRealizados: entrada.kmNaoRealizados,
    percentualFrotaParada: ag.percentualFrotaParada,
    taxaIndisponibilidade: ag.taxaIndisponibilidade,
    utilizacaoAntes: ag.utilizacaoAntes,
    utilizacaoDepois: ag.utilizacaoDepois,
    impactoUtilizacao: ag.impactoUtilizacao,

    diasParaRecuperar: ag.diasParaRecuperar,
    horasParaRecuperar: ag.horasParaRecuperar,

    custoVeiculoSubstituto: ag.custoVeiculoSubstituto,
    receitaGeradaSubstituto: entrada.receitaGeradaSubstituto,
    resultadoSubstituto: ag.resultadoSubstituto,
    beneficioLiquidoSubstituto: ag.beneficioLiquidoSubstituto,

    valorMaximoJustificavelReducao: ag.valorMaximoJustificavelReducao,
    economiaPorDiaReduzido: ag.economiaPorDiaReduzido,

    custoTotalAlternativa: ag.custoTotalAlternativa,
    resultadoLiquidoEspera: ag.resultadoLiquidoEspera,

    classificacao: ag.classificacao,
    nivelCompletude,
    nivelConfianca: ag.nivelConfianca,
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
    descricao: "Modo de cálculo do custo do veículo parado.",
    valoresPossiveis: [
      "CUSTO_DIRETO_PARADA",
      "CUSTO_FIXO_DURANTE_PARADA",
      "CUSTO_ADICIONAL_PARADA",
      "CUSTO_TOTAL_PARADA",
      "RECEITA_NAO_REALIZADA",
      "LUCRO_NAO_REALIZADO",
      "CUSTO_OPORTUNIDADE",
      "CUSTO_POR_HORA_PARADA",
      "CUSTO_POR_DIA_PARADO",
      "PARADA_MANUTENCAO",
      "PARADA_AVARIA",
      "PARADA_ACIDENTE",
      "AGUARDANDO_PECA",
      "AGUARDANDO_OFICINA",
      "AGUARDANDO_CARGA",
      "AGUARDANDO_DESCARGA",
      "FALTA_MOTORISTA",
      "FALTA_DEMANDA",
      "PARADA_PROGRAMADA",
      "PARADA_NAO_PROGRAMADA",
      "VEICULO_SUBSTITUTO",
      "MULTIPLOS_VEICULOS",
      "FROTA_PARCIALMENTE_PARADA",
      "PREVISTO_X_REALIZADO",
      "COMPARACAO_CENARIOS",
      "ANALISE_REDUCAO_TEMPO_PARADO",
      "ANALISE_REPARAR_OU_SUBSTITUIR",
    ],
  },
  { nome: "identificacao", tipo: "string", obrigatorio: false, descricao: "Identificador livre do evento de parada." },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre." },
  { nome: "identificacaoVeiculo", tipo: "string", obrigatorio: false, descricao: "Identificador do veículo." },
  { nome: "placa", tipo: "string", obrigatorio: false, descricao: "Placa do veículo." },
  { nome: "tipoVeiculo", tipo: "string", obrigatorio: false, descricao: "Tipo do veículo." },
  {
    nome: "motivoParada",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Motivo da parada (informativo — não infere responsabilidade, cobertura ou risco).",
    valoresPossiveis: [
      "MANUTENCAO_PREVENTIVA",
      "MANUTENCAO_CORRETIVA",
      "AVARIA_MECANICA",
      "AVARIA_ELETRICA",
      "PNEU",
      "ACIDENTE",
      "AGUARDANDO_PECA",
      "AGUARDANDO_OFICINA",
      "AGUARDANDO_AUTORIZACAO",
      "AGUARDANDO_CARGA",
      "AGUARDANDO_DESCARGA",
      "DOCUMENTACAO",
      "FALTA_MOTORISTA",
      "FALTA_AJUDANTE",
      "FALTA_DEMANDA",
      "FALTA_COMBUSTIVEL",
      "RESTRICAO_FINANCEIRA",
      "RESTRICAO_OPERACIONAL",
      "PARADA_PROGRAMADA",
      "CLIMA_INFORMADO",
      "OUTRO",
      "NAO_INFORMADO",
    ],
  },
  { nome: "tipoParada", tipo: "enum", obrigatorio: false, descricao: "Tipo de parada.", valoresPossiveis: ["PROGRAMADA", "NAO_PROGRAMADA", "OPERACIONAL", "MECANICA", "ADMINISTRATIVA", "COMERCIAL", "FINANCEIRA", "EXTERNA", "NAO_CLASSIFICADA"] },
  { nome: "statusParada", tipo: "enum", obrigatorio: false, descricao: "Status da parada.", valoresPossiveis: ["EM_ANDAMENTO", "ENCERRADA", "ESTIMADA", "PLANEJADA", "NAO_INFORMADO"] },
  { nome: "dataInicio", tipo: "string", obrigatorio: false, descricao: "Data/hora de início da parada." },
  { nome: "dataFim", tipo: "string", obrigatorio: false, descricao: "Data/hora de fim da parada." },
  { nome: "horasParadas", tipo: "number", obrigatorio: false, descricao: "Duração da parada, em horas." },
  { nome: "diasParados", tipo: "number", obrigatorio: false, descricao: "Duração da parada, em dias." },
  { nome: "horasPorDia", tipo: "number", obrigatorio: false, descricao: "Horas por dia, para converter diasParados em horas." },
  { nome: "previsaoHorasParadas", tipo: "number", obrigatorio: false, descricao: "Previsão de horas paradas (informativo)." },
  { nome: "previsaoDiasParados", tipo: "number", obrigatorio: false, descricao: "Previsão de dias parados (informativo)." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos do evento (para custos POR_VEICULO)." },
  { nome: "quantidadeVeiculosFrota", tipo: "number", obrigatorio: false, descricao: "Quantidade total de veículos da frota." },
  { nome: "quantidadeVeiculosParados", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos parados." },
  { nome: "diasOperadosPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias operados no período (realizado)." },
  { nome: "diasDisponiveisPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias disponíveis no período." },
  { nome: "diasOperadosPlanejadosPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias operados planejados (antes da parada), para impactoUtilizacao." },
  { nome: "receitaMediaDia", tipo: "number", obrigatorio: false, descricao: "Receita média por dia." },
  { nome: "receitaMediaHora", tipo: "number", obrigatorio: false, descricao: "Receita média por hora." },
  { nome: "receitaMediaViagem", tipo: "number", obrigatorio: false, descricao: "Receita média por viagem." },
  { nome: "receitaMediaKm", tipo: "number", obrigatorio: false, descricao: "Receita média por km." },
  { nome: "lucroMedioDia", tipo: "number", obrigatorio: false, descricao: "Lucro médio por dia." },
  { nome: "lucroMedioHora", tipo: "number", obrigatorio: false, descricao: "Lucro médio por hora." },
  { nome: "margemMediaPercentual", tipo: "number", obrigatorio: false, descricao: "Margem histórica média, em %." },
  { nome: "quantidadeViagensPerdidas", tipo: "number", obrigatorio: false, descricao: "Quantidade de viagens perdidas." },
  { nome: "kmNaoRealizados", tipo: "number", obrigatorio: false, descricao: "Quilômetros não realizados." },
  { nome: "valorFreteCancelado", tipo: "number", obrigatorio: false, descricao: "Valor do frete cancelado." },
  { nome: "receitaContratadaNaoRealizada", tipo: "number", obrigatorio: false, descricao: "Receita contratada não realizada." },
  { nome: "custoFixoDiarioInformado", tipo: "number", obrigatorio: false, descricao: "Custo fixo diário que continua existindo." },
  { nome: "custoFixoHoraInformado", tipo: "number", obrigatorio: false, descricao: "Custo fixo por hora que continua existindo." },
  { nome: "custoAdicionalTotalInformado", tipo: "number", obrigatorio: false, descricao: "Custo adicional total já pronto." },
  { nome: "custoTotalParadaInformado", tipo: "number", obrigatorio: false, descricao: "Custo direto total da parada (fixo + adicional) já pronto." },
  { nome: "custosFixos", tipo: "string", obrigatorio: false, descricao: "Lista de custos fixos detalhados (mesmo formato de calcular_custo_dia)." },
  { nome: "custosAdicionais", tipo: "string", obrigatorio: false, descricao: "Lista de custos adicionais da parada." },
  { nome: "custosEvitados", tipo: "string", obrigatorio: false, descricao: "Lista de custos operacionais evitados por não operar." },
  { nome: "tipoDia", tipo: "enum", obrigatorio: false, descricao: "Base de rateio para custosFixos.", valoresPossiveis: ["CORRIDO", "UTIL", "OPERADO", "DISPONIVEL", "VIAGEM", "PARADO", "PERSONALIZADO"] },
  { nome: "diasCorridosPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias corridos do período, para rateio de custosFixos." },
  { nome: "diasUteisPeriodo", tipo: "number", obrigatorio: false, descricao: "Dias úteis do período, para rateio de custosFixos." },
  { nome: "custoReparoInformado", tipo: "number", obrigatorio: false, descricao: "Custo do reparo/peça/mão de obra, usado na comparação de alternativas." },
  { nome: "custoOportunidadeInformado", tipo: "number", obrigatorio: false, descricao: "Custo de oportunidade de uma alternativa explicitamente informada." },
  { nome: "alternativaOportunidadeDescricao", tipo: "string", obrigatorio: false, descricao: "Descrição da alternativa de oportunidade considerada." },
  { nome: "custoVeiculoSubstitutoDia", tipo: "number", obrigatorio: false, descricao: "Custo diário do veículo substituto." },
  { nome: "custoVeiculoSubstitutoTotal", tipo: "number", obrigatorio: false, descricao: "Custo total do veículo substituto." },
  { nome: "receitaGeradaSubstituto", tipo: "number", obrigatorio: false, descricao: "Receita gerada pelo veículo substituto." },
  { nome: "receitaEstadiaInformada", tipo: "number", obrigatorio: false, descricao: "Receita de estadia (aguardando carga/descarga)." },
  { nome: "diasReducaoAnalisados", tipo: "number", obrigatorio: false, descricao: "Dias de redução analisados (modo ANALISE_REDUCAO_TEMPO_PARADO)." },
  { nome: "prazoPagamentoDias", tipo: "number", obrigatorio: false, descricao: "Prazo de pagamento em dias (informativo)." },
  { nome: "cenarios", tipo: "string", obrigatorio: false, descricao: "Lista de cenários a comparar (modo COMPARACAO_CENARIOS, ao menos 2)." },
  { nome: "veiculos", tipo: "string", obrigatorio: false, descricao: "Lista de veículos a consolidar (modo MULTIPLOS_VEICULOS)." },
  { nome: "estrategiaSobreposicaoCusto", tipo: "enum", obrigatorio: false, descricao: "Estratégia para custo informado por mais de uma fonte.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO", "PRIORIZAR_VALOR_DIARIO", "PRIORIZAR_VALOR_HORA", "PRIORIZAR_FONTE_EXTERNA"] },
  { nome: "estrategiaSobreposicaoDuracao", tipo: "enum", obrigatorio: false, descricao: "Estratégia para duração informada por mais de uma forma.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_HORAS", "PRIORIZAR_DIAS", "PRIORIZAR_DATAS"] },
  { nome: "estrategiaSobreposicaoReceita", tipo: "enum", obrigatorio: false, descricao: "Estratégia para receita não realizada informada por mais de uma fonte.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"] },
  { nome: "estrategiaSobreposicaoLucro", tipo: "enum", obrigatorio: false, descricao: "Estratégia para lucro não realizado calculável por mais de uma fonte.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"] },
  { nome: "toleranciaClassificacaoPercentual", tipo: "number", obrigatorio: false, descricao: "Tolerância (%) para classificações sensíveis a ponto flutuante." },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve todas as casas decimais padrão da saída." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Permite usar padrões configuráveis do rateio de custosFixos (ver calcular_custo_dia) — sempre com premissa registrada." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaCalcularCustoVeiculoParado: DefinicaoFerramenta<CalcularCustoVeiculoParadoEntrada, CalcularCustoVeiculoParadoResultado> = {
  nome: "calcular_custo_veiculo_parado",
  descricao: "Calcula e interpreta o impacto financeiro de um veículo (ou frota) parado — custo fixo, adicional, evitado, receita e lucro não realizados, visão de caixa e econômica.",
  objetivo: "Mostrar quanto custa manter um veículo parado, quanto foi deixado de faturar/lucrar, e comparar alternativas (reparo, oficina, substituto).",
  parametros: PARAMETROS,
  executar: calcularCustoVeiculoParado,
};
