import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, EstrategiaSobreposicao, NivelCompletude, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";
import { calcularCustoVeiculoParado } from "./calcular-custo-veiculo-parado";
import { calcularReceitaKm } from "./calcular-receita-km";
import { calcularMargem } from "./calcular-margem";
import type { ResumoCustoViagem } from "./calcular-margem";
import { calcularCpk } from "./calcular-cpk";
import { analisarFrete } from "./analisar-frete";

/**
 * Ferramenta: calcular_jornada
 *
 * Planeja, consolida e analisa a jornada operacional de motoristas e
 * veículos — separando sempre quatro dimensões: (1) jornada operacional
 * (planejamento da viagem: direção, carga, descarga, espera, pausas,
 * descanso etc.), (2) jornada de trabalho (períodos em que o motorista está
 * trabalhando), (3) tempo de direção (somente condução) e (4) conformidade
 * (comparação com regras fornecidas/configuradas). Nunca trata essas quatro
 * dimensões como a mesma coisa, e nunca afirma conformidade legal definitiva
 * sem uma regra versionada, com fonte, e explicitamente fornecida.
 *
 * Atua como coordenadora: reutiliza `calcularCustoVeiculoParado` (modo
 * `CUSTO_POR_HORA_PARADA`) para o custo de espera/indisponibilidade — mesma
 * fórmula (valor por hora × horas), sem duplicar a lógica de custo de
 * parada; reutiliza `calcularMargem` (modo `MARGEM_SIMPLES`) para
 * lucro/margem por hora, mesma técnica já usada por `calcular_custo_dia` e
 * `calcular_receita_km`; reutiliza `calcularReceitaKm` (modo
 * `RECEITA_BRUTA_POR_KM`) quando a receita é informada como valor por km ×
 * distância; reutiliza `calcularCpk` (modo `CPK_PNEUS`, como divisor
 * genérico valor ÷ divisor) para toda divisão seguramente protegida contra
 * zero; reutiliza `analisarFrete` (modo `ANALISE_SIMPLES`) para a
 * viabilidade prazo × custo × receita da programação, quando receita e
 * custo da jornada estão disponíveis. Aceita o resultado resumido de
 * `calcular-custo-viagem.ts` via `resumoCustoViagem` (tipo já reexportado
 * por `calcular-margem.ts`, mesmo padrão usado por `calcular_custo_dia`).
 *
 * Nenhum desses módulos importa `calcular-jornada.ts` de volta — sem
 * dependências circulares.
 *
 * Sem APIs externas nesta fase. Nunca inventa distância, velocidade,
 * duração, horários, carga, descarga, espera, pausas, descanso, regras
 * legais, quantidade de motoristas, custos, receita, margem ou fuso
 * horário não informados. Sem regras de conformidade fornecidas, a jornada
 * é calculada normalmente e a conformidade fica marcada como NÃO_AVALIADA.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

const CASAS_DECIMAIS_HORA_PADRAO = 2;
const CASAS_DECIMAIS_DIA_PADRAO = 2;
const CASAS_DECIMAIS_KM_PADRAO = 2;
const CASAS_DECIMAIS_VELOCIDADE_PADRAO = 2;
const TOLERANCIA_MINUTOS_PADRAO = 0;

const LIMITACOES_PADRAO: string[] = [
  "Esta ferramenta não calcula distância, velocidade, duração, horários, carga, descarga, espera, pausas, descanso, quantidade de motoristas, custos, receita ou fuso horário automaticamente — todos os valores vêm do que foi informado.",
  "A conformidade legal nunca é afirmada como definitiva: sem regra versionada, com fonte e vigência explicitamente fornecida, o status fica NAO_AVALIADA e apenas o planejamento operacional é retornado.",
  "Dois motoristas nunca são tratados como autorização automática para operação contínua, nem como divisão automática de 50% da direção — a distribuição precisa ser informada explicitamente.",
  "A velocidade necessária para cumprir um prazo nunca é recomendada como segura; quando ultrapassa o limite operacional informado, a programação é classificada como incompatível, sem sugerir excedê-lo.",
  "Sem biblioteca de datas/fuso-horário no projeto, os horários são calculados com o objeto Date nativo do JavaScript a partir de strings ISO 8601; o fuso não é alterado ou reinterpretado silenciosamente.",
];

// ---------------------------------------------------------------------------
// Modos de cálculo
// ---------------------------------------------------------------------------

export type ModoJornada =
  | "CALCULAR_DURACAO_VIAGEM"
  | "CALCULAR_JORNADA_TOTAL"
  | "CALCULAR_TEMPO_DIRECAO"
  | "CALCULAR_HORARIO_CHEGADA"
  | "CALCULAR_HORARIO_SAIDA"
  | "CALCULAR_DIAS_NECESSARIOS"
  | "CALCULAR_DISTANCIA_POSSIVEL"
  | "CALCULAR_VELOCIDADE_NECESSARIA"
  | "PLANEJAR_JORNADA"
  | "ANALISAR_CONFORMIDADE"
  | "ANALISAR_PAUSAS"
  | "ANALISAR_DESCANSO"
  | "ANALISAR_TEMPO_ESPERA"
  | "ANALISAR_CARGA_DESCARGA"
  | "CALCULAR_CUSTO_JORNADA"
  | "CALCULAR_CUSTO_ESPERA"
  | "CALCULAR_RECEITA_HORA"
  | "CALCULAR_LUCRO_HORA"
  | "UM_MOTORISTA"
  | "DOIS_MOTORISTAS"
  | "REVEZAMENTO"
  | "PREVISTO_X_REALIZADO"
  | "MULTIPLAS_ETAPAS"
  | "MULTIPLOS_MOTORISTAS"
  | "MULTIPLOS_VEICULOS"
  | "COMPARACAO_CENARIOS";

// ---------------------------------------------------------------------------
// Tipos de tempo e períodos
// ---------------------------------------------------------------------------

export type TipoTempo =
  | "DIRECAO"
  | "TRABALHO_SEM_DIRECAO"
  | "CARGA"
  | "DESCARGA"
  | "ESPERA"
  | "ABASTECIMENTO"
  | "MANUTENCAO"
  | "FISCALIZACAO"
  | "REFEICAO"
  | "PAUSA"
  | "DESCANSO"
  | "PERNOITE"
  | "DISPONIBILIDADE"
  | "INATIVIDADE"
  | "DESLOCAMENTO_SEM_VEICULO"
  | "TRANSBORDO"
  | "OUTRO";

export type OrigemDadoTempo = "INFORMADO" | "CALCULADO" | "IMPORTADO" | "ESTIMADO" | "NAO_INFORMADO";

/** Nível de confiança de um período/indicador — nome local para não colidir com o `NivelConfianca` de `calcular-custo-veiculo-parado.ts` (mesmos valores, arquivos diferentes). */
export type NivelConfiancaJornada = "CONFIRMADO" | "ESTIMADO" | "PARCIAL" | "NAO_AVALIADO";

/**
 * Um período de tempo dentro da jornada. `motoristaResponsavel` e `veiculo`
 * são adições justificadas ao conjunto de campos do enunciado: sem eles não
 * é possível detectar motorista dirigindo e descansando ao mesmo tempo, nem
 * veículo em duas etapas simultâneas (exigido pela seção de validações).
 */
export interface PeriodoJornada {
  tipo: TipoTempo;
  descricao?: string;
  inicio?: string;
  fim?: string;
  duracaoMinutos?: number;
  etapa?: string;
  remunerado?: boolean;
  consideradoJornada?: boolean;
  consideradoDirecao?: boolean;
  consideradoDescanso?: boolean;
  consideradoEspera?: boolean;
  origemDado?: OrigemDadoTempo;
  nivelConfianca?: NivelConfiancaJornada;
  observacoes?: string;
  motoristaResponsavel?: string;
  veiculo?: string;
}

// ---------------------------------------------------------------------------
// Motoristas
// ---------------------------------------------------------------------------

export type EstrategiaDistribuicaoMotoristas = "MANUAL" | "IGUALITARIA" | "POR_TURNO" | "POR_ETAPA" | "OTIMIZAR_DURACAO" | "OTIMIZAR_CUSTO" | "NAO_DISTRIBUIR";

export interface MotoristaJornada {
  identificacaoMotorista?: string;
  nome?: string;
  turno?: string;
  inicioDisponibilidade?: string;
  fimDisponibilidade?: string;
  tempoDirecaoDisponivelMinutos?: number;
  tempoJornadaDisponivelMinutos?: number;
  tempoDescansoAnteriorMinutos?: number;
  periodos?: PeriodoJornada[];
  custoHora?: number;
  custoDiaria?: number;
  observacoes?: string;
}

export interface ResultadoMotoristaJornada {
  identificacaoMotorista?: string;
  nome?: string;
  tempoDirecaoMinutos?: number;
  tempoTrabalhoSemDirecaoMinutos?: number;
  tempoEsperaMinutos?: number;
  tempoPausaMinutos?: number;
  tempoDescansoMinutos?: number;
  jornadaTotalMinutos?: number;
  quantidadeTurnos?: number;
  custo?: number;
  alertas: string[];
  statusConformidade?: StatusConformidadeJornada;
  nivelCompletude: NivelCompletude;
}

// ---------------------------------------------------------------------------
// Regras de conformidade (configuráveis e versionadas)
// ---------------------------------------------------------------------------

export type TipoAplicacaoRegra = "OPERACIONAL" | "CONTRATUAL" | "EMPRESARIAL" | "LEGAL" | "CONVENCAO_COLETIVA" | "POLITICA_INTERNA" | "PERSONALIZADA";

export interface RegraConformidadeJornada {
  identificacaoRegra?: string;
  nome?: string;
  descricao?: string;
  jurisdicao?: string;
  fonte?: string;
  versao?: string;
  dataVigencia?: string;
  dataConsulta?: string;
  tipoAplicacao: TipoAplicacaoRegra;
  limiteDirecaoContinuaMinutos?: number;
  pausaAposDirecaoMinutos?: number;
  limiteDirecaoDiaMinutos?: number;
  limiteJornadaDiaMinutos?: number;
  descansoEntreJornadasMinutos?: number;
  descansoSemanalMinutos?: number;
  limiteHorasExtrasMinutos?: number;
  periodoNoturnoInicio?: string;
  periodoNoturnoFim?: string;
  tratamentoTempoEspera?: string;
  tratamentoCargaDescarga?: string;
  tratamentoDoisMotoristas?: string;
  toleranciaMinutos?: number;
  observacoes?: string;
}

export type StatusConformidadeJornada = "CONFORME" | "NAO_CONFORME" | "CONFORME_COM_ALERTA" | "PARCIALMENTE_AVALIADO" | "NAO_AVALIADO" | "DADOS_INSUFICIENTES";
export type GravidadeOcorrenciaJornada = "INFORMATIVO" | "ATENCAO" | "ALTO" | "CRITICO" | "NAO_CLASSIFICADO";

export interface OcorrenciaConformidadeJornada {
  codigo: string;
  categoria: string;
  descricao: string;
  periodoRelacionado?: string;
  valorCalculado?: number;
  limiteAplicado?: number;
  diferenca?: number;
  gravidade: GravidadeOcorrenciaJornada;
  fonteRegra?: string;
  recomendacaoOperacional?: string;
  dadosFaltantes?: string[];
}

// ---------------------------------------------------------------------------
// Fontes de duração / custo — estratégias de sobreposição
// ---------------------------------------------------------------------------

export type EstrategiaSobreposicaoDuracaoJornada =
  | "REJEITAR_SOBREPOSICAO"
  | "PRIORIZAR_TEMPO_INFORMADO"
  | "PRIORIZAR_DISTANCIA_VELOCIDADE"
  | "PRIORIZAR_ETAPAS"
  | "PRIORIZAR_HORARIOS"
  | "PRIORIZAR_REALIZADO";

export type EstrategiaSobreposicaoCustoJornada = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_TOTAL" | "PRIORIZAR_FONTE_VIAGEM" | "PRIORIZAR_DETALHADO";

// ---------------------------------------------------------------------------
// Classificação operacional / completude
// ---------------------------------------------------------------------------

export type ClassificacaoOperacionalJornada =
  | "VIAVEL"
  | "VIAVEL_COM_ALERTAS"
  | "INVIAVEL_POR_TEMPO"
  | "INVIAVEL_POR_CAPACIDADE"
  | "INVIAVEL_POR_REGRA_CONFIGURADA"
  | "PRAZO_INCOMPATIVEL"
  | "DADOS_INSUFICIENTES"
  | "NAO_AVALIADO";

// ---------------------------------------------------------------------------
// Configuração de inclusão na jornada / produtividade
// ---------------------------------------------------------------------------

/** Controla quais categorias, além de direção e trabalho sem direção (sempre incluídos), contam como "jornada" — todas com padrão `true`, conforme o exemplo de referência do enunciado (direção + carga + descarga + espera = jornada total). */
export interface ConfiguracaoJornada {
  incluirEsperaNaJornada?: boolean;
  incluirPausasNaJornada?: boolean;
  incluirImprevistosNaJornada?: boolean;
  /** Categorias tratadas como produtivas para `percentualProdutivo` — padrão `["DIRECAO"]`: nunca classifica espera, carga ou descarga como produtivas automaticamente. */
  atividadesProdutivas?: TipoTempo[];
}

// ---------------------------------------------------------------------------
// Etapas da viagem
// ---------------------------------------------------------------------------

export interface EtapaJornada {
  identificacaoEtapa?: string;
  sequencia?: number;
  origem?: string;
  destino?: string;
  distanciaKm?: number;
  velocidadeMediaKmH?: number;
  tempoDirecaoInformadoMinutos?: number;
  atividadeAntes?: PeriodoJornada[];
  atividadeDepois?: PeriodoJornada[];
  tempoCargaMinutos?: number;
  tempoDescargaMinutos?: number;
  tempoEsperaMinutos?: number;
  tempoFiscalizacaoMinutos?: number;
  tempoAbastecimentoMinutos?: number;
  tempoManutencaoMinutos?: number;
  tempoPausaMinutos?: number;
  tempoDescansoMinutos?: number;
  horarioInicio?: string;
  horarioFim?: string;
  motoristaResponsavel?: string;
  veiculo?: string;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Conjunto de dados compartilhado — entrada direta, cenários, veículos,
// previsto/realizado
// ---------------------------------------------------------------------------

export interface DadosJornadaVariante {
  identificacao?: string;
  descricao?: string;
  origem?: string;
  destino?: string;

  dataHoraSaida?: string;
  dataHoraChegadaDesejada?: string;
  dataHoraChegadaReal?: string;
  dataHoraRetorno?: string;
  fusoHorario?: string;

  distanciaTotalKm?: number;
  distanciaIdaKm?: number;
  distanciaVoltaKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;

  velocidadeMediaKmH?: number;
  velocidadeMediaIdaKmH?: number;
  velocidadeMediaVoltaKmH?: number;
  /** Limite operacional informado — nunca um limite legal de velocidade presumido. Necessário para classificar a programação como incompatível sem recomendar excedê-lo. */
  velocidadeMaximaOperacionalKmH?: number;

  tempoDirecaoMinutos?: number;
  tempoTrabalhoSemDirecaoMinutos?: number;
  tempoCargaMinutos?: number;
  tempoDescargaMinutos?: number;
  tempoEsperaMinutos?: number;
  tempoAbastecimentoMinutos?: number;
  tempoFiscalizacaoMinutos?: number;
  tempoManutencaoMinutos?: number;
  tempoRefeicaoMinutos?: number;
  tempoPausasMinutos?: number;
  tempoDescansoMinutos?: number;
  tempoImprevistosMinutos?: number;
  tempoMargemSegurancaMinutos?: number;

  etapas?: EtapaJornada[];
  periodos?: PeriodoJornada[];

  quantidadeMotoristas?: number;
  quantidadeAjudantes?: number;
  quantidadeVeiculos?: number;
  motoristas?: MotoristaJornada[];
  estrategiaDistribuicaoMotoristas?: EstrategiaDistribuicaoMotoristas;

  horasDisponiveis?: number;
  diasDisponiveis?: number;
  horasPorDiaPlanejadas?: number;

  receitaTotal?: number;
  custoTotal?: number;
  custoPorHora?: number;
  receitaPorHoraInformada?: number;
  lucroPorHoraInformado?: number;
  receitaPorKmInformada?: number;
  custoMotoristaHora?: number;
  custoAjudanteHora?: number;
  custoVeiculoHora?: number;
  custoEsperaHora?: number;
  adicionalNoturnoValor?: number;
  horasExtrasValor?: number;
  despesasAdicionais?: number;

  /** Alternativa a `custoTotal`: resultado resumido de `calcular-custo-viagem.ts` (tipo reexportado por `calcular-margem.ts`). */
  resumoCustoViagem?: ResumoCustoViagem;

  regrasConformidade?: RegraConformidadeJornada[];
  configuracaoJornada?: ConfiguracaoJornada;

  observacoes?: string;
}

export interface CenarioJornada extends DadosJornadaVariante {
  id?: string;
  nome?: string;
}

export interface VeiculoJornada extends DadosJornadaVariante {
  id?: string;
  identificacaoVeiculo?: string;
  placa?: string;
  tipoVeiculo?: string;
}

export interface CalcularJornadaEntrada extends DadosJornadaVariante {
  modo: ModoJornada;

  /** Usado apenas em COMPARACAO_CENARIOS — ao menos 2 cenários. */
  cenarios?: CenarioJornada[];
  /** Usado apenas em MULTIPLOS_VEICULOS. */
  veiculos?: VeiculoJornada[];
  /** Usados apenas em PREVISTO_X_REALIZADO. */
  previsto?: DadosJornadaVariante;
  realizado?: DadosJornadaVariante;

  estrategiaSobreposicaoDuracao?: EstrategiaSobreposicaoDuracaoJornada;
  estrategiaSobreposicaoCusto?: EstrategiaSobreposicaoCustoJornada;
  /** Usada apenas para a sobreposição receita total x receita detalhada (2 fontes) — tipo compartilhado. */
  estrategiaSobreposicao?: EstrategiaSobreposicao;
  toleranciaMinutos?: number;

  casasDecimais?: number;
  permitirEstimativas?: boolean;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export interface ItemRankingJornada {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface ResultadoCenarioJornada extends ResultadoFerramentaBase {
  id: string;
  nome: string;
  distanciaTotalKm?: number;
  tempoDirecaoMinutos?: number;
  jornadaTotalMinutos?: number;
  duracaoTotalViagemMinutos?: number;
  diasNecessariosInteiros?: number;
  dataHoraChegadaEstimada?: string;
  custoJornada?: number;
  receitaTotal?: number;
  lucroTotal?: number;
  margemPercentual?: number;
  tempoEsperaMinutos?: number;
  tempoDescansoMinutos?: number;
  percentualProdutivo?: number;
  statusConformidade?: StatusConformidadeJornada;
  classificacaoOperacional?: ClassificacaoOperacionalJornada;
  nivelCompletude: NivelCompletude;
}

export interface ComparacaoCenariosJornada {
  cenarios: ResultadoCenarioJornada[];
  rankingPorMenorDuracao: ItemRankingJornada[];
  rankingPorMenorCusto: ItemRankingJornada[];
  rankingPorMaiorLucro: ItemRankingJornada[];
  rankingPorMenorEspera: ItemRankingJornada[];
  rankingPorMaiorProdutividade: ItemRankingJornada[];
  rankingPorMelhorConformidade: ItemRankingJornada[];
  alertas: string[];
}

export interface DiferencaJornada {
  previsto?: number;
  realizado?: number;
  diferenca?: number;
  diferencaPercentual?: number;
}

export interface PrevistoRealizadoJornada {
  duracaoTotalViagemMinutos?: DiferencaJornada;
  tempoDirecaoMinutos?: DiferencaJornada;
  tempoEsperaMinutos?: DiferencaJornada;
  custoEspera?: DiferencaJornada;
  custoJornada?: DiferencaJornada;
  receitaTotal?: DiferencaJornada;
  lucroTotal?: DiferencaJornada;
  diasNecessarios?: DiferencaJornada;
  atrasoMinutos?: number;
  principalDesvio?: string;
  categoriasAcimaDoPrevisto: string[];
  categoriasAbaixoDoPrevisto: string[];
  alertas: string[];
}

export interface ResultadoConsolidadoJornada {
  quantidadeRegistros: number;
  distanciaTotalConsolidada?: number;
  tempoDirecaoTotal?: number;
  jornadaTotalConsolidada?: number;
  duracaoTotalConsolidada?: number;
  tempoEsperaTotal?: number;
  tempoDescansoTotal?: number;
  velocidadeMediaConsolidada?: number;
  custoTotalConsolidado?: number;
  receitaTotalConsolidada?: number;
  lucroTotalConsolidado?: number;
  margemConsolidadaPercentual?: number;
  custoPorHoraConsolidado?: number;
  receitaPorHoraConsolidada?: number;
  lucroPorHoraConsolidado?: number;
  resultadosIndividuais: ResultadoCenarioJornada[];
  rankingPorMenorDuracao: ItemRankingJornada[];
  rankingPorMenorCusto: ItemRankingJornada[];
  rankingPorMaiorLucro: ItemRankingJornada[];
  alertas: string[];
}

export interface CalcularJornadaResultado extends ResultadoFerramentaBase {
  modo: ModoJornada;
  identificacao?: string;
  descricao?: string;
  origem?: string;
  destino?: string;

  dataHoraSaida?: string;
  dataHoraChegadaEstimada?: string;
  dataHoraChegadaDesejada?: string;
  dataHoraChegadaReal?: string;
  horarioSaidaNecessario?: string;

  distanciaTotalKm?: number;
  velocidadeMediaKmH?: number;
  velocidadeNecessariaKmH?: number;

  tempoDirecaoMinutos?: number;
  tempoTrabalhoSemDirecaoMinutos?: number;
  tempoCargaMinutos?: number;
  tempoDescargaMinutos?: number;
  tempoEsperaMinutos?: number;
  tempoAbastecimentoMinutos?: number;
  tempoFiscalizacaoMinutos?: number;
  tempoManutencaoMinutos?: number;
  tempoRefeicaoMinutos?: number;
  tempoPausasMinutos?: number;
  tempoDescansoMinutos?: number;
  tempoImprevistosMinutos?: number;

  jornadaTotalMinutos?: number;
  duracaoTotalViagemMinutos?: number;
  diasNecessariosExatos?: number;
  diasNecessariosInteiros?: number;
  distanciaPossivelKm?: number;

  percentualDirecao?: number;
  percentualEspera?: number;
  percentualProdutivo?: number;

  quantidadeMotoristas?: number;
  jornadaPorMotorista?: ResultadoMotoristaJornada[];
  cronologia?: PeriodoJornada[];

  custoJornada?: number;
  custoEspera?: number;
  custoPorHoraTotal?: number;
  custoPorHoraDirecao?: number;

  receitaTotal?: number;
  receitaPorHoraTotal?: number;
  receitaPorHoraDirecao?: number;

  lucroTotal?: number;
  lucroPorHora?: number;
  margemPercentual?: number;

  atrasoMinutos?: number;
  diferencaCusto?: number;
  diferencaReceita?: number;

  classificacaoOperacional?: ClassificacaoOperacionalJornada;
  statusConformidade?: StatusConformidadeJornada;
  ocorrenciasConformidade?: OcorrenciaConformidadeJornada[];
  regrasAplicadas?: string[];

  comparacaoCenarios?: ComparacaoCenariosJornada;
  consolidadoVeiculos?: ResultadoConsolidadoJornada;
  previstoRealizado?: PrevistoRealizadoJornada;

  nivelCompletude: NivelCompletude;
  nivelConfianca?: NivelConfiancaJornada;
  dadosPresentes: string[];
  dadosFaltantes: string[];
  indicadoresNaoAvaliados: string[];
  limitacoes: string[];
  memoriaCalculo: string[];
}

// ---------------------------------------------------------------------------
// Casas decimais
// ---------------------------------------------------------------------------

interface CasasDecimaisJornada {
  moeda: number;
  percentual: number;
  hora: number;
  dia: number;
  km: number;
  velocidade: number;
}

function casasDecimaisDe(entrada: CalcularJornadaEntrada): CasasDecimaisJornada {
  const o = entrada.casasDecimais;
  return {
    moeda: o ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    percentual: o ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    hora: o ?? CASAS_DECIMAIS_HORA_PADRAO,
    dia: o ?? CASAS_DECIMAIS_DIA_PADRAO,
    km: o ?? CASAS_DECIMAIS_KM_PADRAO,
    velocidade: o ?? CASAS_DECIMAIS_VELOCIDADE_PADRAO,
  };
}

// ---------------------------------------------------------------------------
// Datas — objeto Date nativo (sem biblioteca de datas no projeto); nunca
// reinterpreta ou altera o fuso informado silenciosamente.
// ---------------------------------------------------------------------------

function parseIso(valor: string | undefined): Date | undefined {
  if (!valor) return undefined;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? undefined : d;
}

function somarMinutosIso(iso: string, minutos: number): string | undefined {
  const d = parseIso(iso);
  if (!d) return undefined;
  return new Date(d.getTime() + minutos * 60000).toISOString();
}

function subtrairMinutosIso(iso: string, minutos: number): string | undefined {
  const d = parseIso(iso);
  if (!d) return undefined;
  return new Date(d.getTime() - minutos * 60000).toISOString();
}

/** Diferença em minutos entre duas datas ISO (fim - inicio). */
function diferencaMinutosIso(inicio: string, fim: string): number | undefined {
  const a = parseIso(inicio);
  const b = parseIso(fim);
  if (!a || !b) return undefined;
  return (b.getTime() - a.getTime()) / 60000;
}

// ---------------------------------------------------------------------------
// Divisão segura contra zero — delega a calcular-cpk.ts (modo CPK_PNEUS
// reaproveitado como divisor genérico valor ÷ divisor), mesma técnica já
// usada por calcular-custo-dia.ts e calcular-custo-veiculo-parado.ts.
// ---------------------------------------------------------------------------

function dividirSeguro(valor: number, divisor: number, casas: number): number | undefined {
  if (divisor <= 0) return undefined;
  const resultado = calcularCpk({ modo: "CPK_PNEUS", custoPneus: valor, quilometragem: divisor, arredondamentoCasasDecimais: casas });
  return resultado.sucesso ? resultado.resultados.cpk : undefined;
}

// ---------------------------------------------------------------------------
// Resolução do tempo de direção — três fontes possíveis (informado direto,
// distância ÷ velocidade, soma de etapas), nunca somadas sem estratégia.
// ---------------------------------------------------------------------------

interface ResolucaoTempoDirecao {
  tempoDirecaoMinutos?: number;
  origem?: string;
  erro?: string;
  alertas: string[];
}

function somaDirecaoEtapas(etapas: EtapaJornada[] | undefined): number | undefined {
  if (!etapas || etapas.length === 0) return undefined;
  let soma = 0;
  let algumaValida = false;
  for (const etapa of etapas) {
    if (etapa.tempoDirecaoInformadoMinutos !== undefined) {
      soma += etapa.tempoDirecaoInformadoMinutos;
      algumaValida = true;
    } else if (etapa.distanciaKm !== undefined && etapa.velocidadeMediaKmH !== undefined && etapa.velocidadeMediaKmH > 0) {
      soma += (etapa.distanciaKm / etapa.velocidadeMediaKmH) * 60;
      algumaValida = true;
    }
  }
  return algumaValida ? soma : undefined;
}

function resolverTempoDirecao(v: DadosJornadaVariante, estrategia: EstrategiaSobreposicaoDuracaoJornada, rotulo: string): ResolucaoTempoDirecao {
  const candidatos: Array<{ chave: string; valor: number; rotulo: string }> = [];

  if (v.tempoDirecaoMinutos !== undefined) {
    candidatos.push({ chave: "informado", valor: v.tempoDirecaoMinutos, rotulo: "tempoDirecaoMinutos informado" });
  }
  if (v.distanciaTotalKm !== undefined && v.velocidadeMediaKmH !== undefined) {
    if (v.velocidadeMediaKmH <= 0) {
      return { erro: `${rotulo}: "velocidadeMediaKmH" deve ser maior que zero para calcular o tempo de direção.`, alertas: [] };
    }
    candidatos.push({ chave: "distancia_velocidade", valor: (v.distanciaTotalKm / v.velocidadeMediaKmH) * 60, rotulo: "distanciaTotalKm ÷ velocidadeMediaKmH" });
  }
  const somaEtapas = somaDirecaoEtapas(v.etapas);
  if (somaEtapas !== undefined) {
    candidatos.push({ chave: "etapas", valor: somaEtapas, rotulo: "soma do tempo de direção das etapas" });
  }

  if (candidatos.length === 0) return { alertas: [] };
  if (candidatos.length === 1) return { tempoDirecaoMinutos: candidatos[0].valor, origem: candidatos[0].rotulo, alertas: [] };

  if (estrategia === "REJEITAR_SOBREPOSICAO") {
    return {
      erro: `${rotulo}: tempo de direção informado por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoDuracao".`,
      alertas: [],
    };
  }

  let vencedor = candidatos[0];
  if (estrategia === "PRIORIZAR_TEMPO_INFORMADO") vencedor = candidatos.find((c) => c.chave === "informado") ?? candidatos[0];
  if (estrategia === "PRIORIZAR_DISTANCIA_VELOCIDADE") vencedor = candidatos.find((c) => c.chave === "distancia_velocidade") ?? candidatos[0];
  if (estrategia === "PRIORIZAR_ETAPAS") vencedor = candidatos.find((c) => c.chave === "etapas") ?? candidatos[0];

  const alertas = [
    `${rotulo}: sobreposição de tempo de direção resolvida por "${estrategia}" — usado ${vencedor.rotulo}, ignoradas as demais fontes (${candidatos
      .filter((c) => c !== vencedor)
      .map((c) => c.rotulo)
      .join(", ")}).`,
  ];
  return { tempoDirecaoMinutos: vencedor.valor, origem: vencedor.rotulo, alertas };
}

// ---------------------------------------------------------------------------
// Tempo de trabalho sem direção — derivado (soma das subcategorias) a menos
// que informado diretamente.
// ---------------------------------------------------------------------------

function resolverTempoTrabalhoSemDirecao(v: DadosJornadaVariante): { valor?: number; derivado: boolean } {
  if (v.tempoTrabalhoSemDirecaoMinutos !== undefined) return { valor: v.tempoTrabalhoSemDirecaoMinutos, derivado: false };
  const partes = [v.tempoCargaMinutos, v.tempoDescargaMinutos, v.tempoAbastecimentoMinutos, v.tempoFiscalizacaoMinutos, v.tempoManutencaoMinutos];
  if (partes.every((p) => p === undefined)) return { valor: undefined, derivado: true };
  return { valor: partes.reduce((acc: number, p) => acc + (p ?? 0), 0), derivado: true };
}

// ---------------------------------------------------------------------------
// Jornada total e duração total da viagem
// ---------------------------------------------------------------------------

interface ResultadoJornadaDuracao {
  jornadaTotalMinutos?: number;
  duracaoTotalViagemMinutos?: number;
  tempoProdutivoMinutos?: number;
}

function calcularJornadaEDuracao(
  tempoDirecao: number | undefined,
  tempoTrabalhoSemDirecao: number | undefined,
  v: DadosJornadaVariante,
  config: ConfiguracaoJornada
): ResultadoJornadaDuracao {
  if (tempoDirecao === undefined && tempoTrabalhoSemDirecao === undefined) return {};

  const direcao = tempoDirecao ?? 0;
  const trabalho = tempoTrabalhoSemDirecao ?? 0;
  const espera = v.tempoEsperaMinutos ?? 0;
  const pausas = (v.tempoPausasMinutos ?? 0) + (v.tempoRefeicaoMinutos ?? 0);
  const imprevistos = v.tempoImprevistosMinutos ?? 0;
  const descanso = v.tempoDescansoMinutos ?? 0;
  const margem = v.tempoMargemSegurancaMinutos ?? 0;

  const incluirEspera = config.incluirEsperaNaJornada ?? true;
  const incluirPausas = config.incluirPausasNaJornada ?? true;
  const incluirImprevistos = config.incluirImprevistosNaJornada ?? true;

  const jornadaTotalMinutos = direcao + trabalho + (incluirEspera ? espera : 0) + (incluirPausas ? pausas : 0) + (incluirImprevistos ? imprevistos : 0);

  const foraDaJornada = (incluirEspera ? 0 : espera) + (incluirPausas ? 0 : pausas) + (incluirImprevistos ? 0 : imprevistos);
  const duracaoTotalViagemMinutos = jornadaTotalMinutos + descanso + margem + foraDaJornada;

  const atividadesProdutivas = config.atividadesProdutivas ?? ["DIRECAO"];
  let tempoProdutivoMinutos = 0;
  if (atividadesProdutivas.includes("DIRECAO")) tempoProdutivoMinutos += direcao;
  if (atividadesProdutivas.includes("TRABALHO_SEM_DIRECAO")) tempoProdutivoMinutos += trabalho;
  if (atividadesProdutivas.includes("ESPERA")) tempoProdutivoMinutos += espera;
  if (atividadesProdutivas.includes("CARGA")) tempoProdutivoMinutos += v.tempoCargaMinutos ?? 0;
  if (atividadesProdutivas.includes("DESCARGA")) tempoProdutivoMinutos += v.tempoDescargaMinutos ?? 0;

  return { jornadaTotalMinutos, duracaoTotalViagemMinutos, tempoProdutivoMinutos };
}

// ---------------------------------------------------------------------------
// Dias necessários
// ---------------------------------------------------------------------------

function calcularDiasNecessarios(duracaoTotalMinutos: number, horasPorDiaPlanejadas: number): { exatos: number; inteiros: number } | undefined {
  if (horasPorDiaPlanejadas <= 0) return undefined;
  const capacidadeMinutos = horasPorDiaPlanejadas * 60;
  const exatos = duracaoTotalMinutos / capacidadeMinutos;
  const inteiros = Math.ceil(exatos - 1e-9);
  return { exatos, inteiros };
}

// ---------------------------------------------------------------------------
// Custo de espera — reutiliza calcular-custo-veiculo-parado.ts (modo
// CUSTO_POR_HORA_PARADA), mesma fórmula (valor por hora × horas paradas).
// ---------------------------------------------------------------------------

function calcularCustoEspera(tempoEsperaMinutos: number | undefined, custoEsperaHora: number | undefined, casas: number): number | undefined {
  if (tempoEsperaMinutos === undefined || tempoEsperaMinutos <= 0 || custoEsperaHora === undefined) return undefined;
  const resultado = calcularCustoVeiculoParado({
    modo: "CUSTO_POR_HORA_PARADA",
    horasParadas: tempoEsperaMinutos / 60,
    custoFixoHoraInformado: custoEsperaHora,
    casasDecimais: casas,
  });
  return resultado.sucesso ? resultado.custoDiretoParada : undefined;
}

// ---------------------------------------------------------------------------
// Custo da jornada — candidatos: total informado, resumoCustoViagem, ou
// composição a partir das tarifas por hora (veículo + motoristas +
// ajudantes + espera + adicionais).
// ---------------------------------------------------------------------------

interface ResolucaoCustoJornada {
  custoJornada?: number;
  custoEspera?: number;
  origem?: string;
  custosIncluidos: string[];
  custosIgnorados: string[];
  erro?: string;
  alertas: string[];
}

function resolverCustoJornada(
  v: DadosJornadaVariante,
  jornadaTotalMinutos: number | undefined,
  quantidadeMotoristas: number | undefined,
  estrategia: EstrategiaSobreposicaoCustoJornada,
  casas: CasasDecimaisJornada,
  rotulo: string
): ResolucaoCustoJornada {
  const custosIncluidos: string[] = [];
  const custosIgnorados: string[] = [];
  const custoEspera = calcularCustoEspera(v.tempoEsperaMinutos, v.custoEsperaHora, casas.moeda);
  if (custoEspera !== undefined) custosIncluidos.push("custoEspera (custoEsperaHora × tempoEsperaMinutos, via calcular_custo_veiculo_parado)");

  const candidatos: Array<{ chave: string; valor: number; rotulo: string }> = [];
  if (v.custoTotal !== undefined) candidatos.push({ chave: "total", valor: v.custoTotal, rotulo: "custoTotal informado" });
  if (v.resumoCustoViagem?.custoTotal !== undefined) {
    candidatos.push({ chave: "viagem", valor: v.resumoCustoViagem.custoTotal, rotulo: "resumoCustoViagem.custoTotal (calcular_custo_viagem)" });
  }

  const horas = jornadaTotalMinutos !== undefined ? jornadaTotalMinutos / 60 : undefined;
  const temTarifaHora = v.custoVeiculoHora !== undefined || v.custoMotoristaHora !== undefined || v.custoAjudanteHora !== undefined;
  if (temTarifaHora && horas !== undefined) {
    let soma = 0;
    const partes: string[] = [];
    if (v.custoVeiculoHora !== undefined) {
      soma += v.custoVeiculoHora * horas;
      partes.push("custoVeiculoHora × jornada");
    }
    if (v.custoMotoristaHora !== undefined) {
      const qtd = quantidadeMotoristas ?? 1;
      soma += v.custoMotoristaHora * horas * qtd;
      partes.push(`custoMotoristaHora × jornada × ${qtd} motorista(s)`);
    }
    if (v.custoAjudanteHora !== undefined) {
      const qtd = v.quantidadeAjudantes ?? 0;
      if (qtd > 0) {
        soma += v.custoAjudanteHora * horas * qtd;
        partes.push(`custoAjudanteHora × jornada × ${qtd} ajudante(s)`);
      } else {
        custosIgnorados.push("custoAjudanteHora (sem quantidadeAjudantes informada)");
      }
    }
    if (custoEspera !== undefined) {
      soma += custoEspera;
      partes.push("custoEspera");
    }
    soma += v.adicionalNoturnoValor ?? 0;
    soma += v.horasExtrasValor ?? 0;
    soma += v.despesasAdicionais ?? 0;
    if (v.adicionalNoturnoValor !== undefined) partes.push("adicionalNoturnoValor");
    if (v.horasExtrasValor !== undefined) partes.push("horasExtrasValor");
    if (v.despesasAdicionais !== undefined) partes.push("despesasAdicionais");
    candidatos.push({ chave: "detalhado", valor: soma, rotulo: `composição por hora (${partes.join(" + ")})` });
  }

  if (candidatos.length === 0) {
    return { custoEspera, custosIncluidos, custosIgnorados, alertas: [] };
  }
  if (candidatos.length === 1) {
    const unico = candidatos[0];
    if (unico.chave === "detalhado") custosIncluidos.unshift(unico.rotulo);
    return { custoJornada: unico.valor, custoEspera, origem: unico.rotulo, custosIncluidos, custosIgnorados, alertas: [] };
  }

  if (estrategia === "REJEITAR_SOBREPOSICAO") {
    return {
      custosIncluidos: [],
      custosIgnorados: [],
      erro: `${rotulo}: custo da jornada informado por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".`,
      alertas: [],
    };
  }

  let vencedor = candidatos[0];
  if (estrategia === "PRIORIZAR_TOTAL") vencedor = candidatos.find((c) => c.chave === "total") ?? candidatos[0];
  if (estrategia === "PRIORIZAR_FONTE_VIAGEM") vencedor = candidatos.find((c) => c.chave === "viagem") ?? candidatos[0];
  if (estrategia === "PRIORIZAR_DETALHADO") vencedor = candidatos.find((c) => c.chave === "detalhado") ?? candidatos[0];

  const alertas = [
    `${rotulo}: sobreposição de custo da jornada resolvida por "${estrategia}" — usado ${vencedor.rotulo}, ignoradas as demais fontes (${candidatos
      .filter((c) => c !== vencedor)
      .map((c) => c.rotulo)
      .join(", ")}).`,
  ];
  if (vencedor.chave === "detalhado") custosIncluidos.unshift(vencedor.rotulo);
  return { custoJornada: vencedor.valor, custoEspera, origem: vencedor.rotulo, custosIncluidos, custosIgnorados, alertas };
}

// ---------------------------------------------------------------------------
// Receita total — candidatos: informada direto (total), ou valor por km ×
// distância via calcular-receita-km.ts (detalhado). Reaproveita a
// estratégia genérica de sobreposição total x detalhado.
// ---------------------------------------------------------------------------

function resolverReceitaTotal(
  v: DadosJornadaVariante,
  estrategia: EstrategiaSobreposicao,
  rotulo: string
): { receitaTotal?: number; origem?: string; erro?: string; alertas: string[] } {
  const candidatos: Array<{ chave: "total" | "detalhado"; valor: number; rotulo: string }> = [];

  if (v.receitaTotal !== undefined) candidatos.push({ chave: "total", valor: v.receitaTotal, rotulo: "receitaTotal informado" });

  if (v.receitaPorKmInformada !== undefined && v.distanciaTotalKm !== undefined) {
    const resultado = calcularReceitaKm({ modo: "RECEITA_BRUTA_POR_KM", valorPorKmInformado: v.receitaPorKmInformada, distanciaTotalKm: v.distanciaTotalKm });
    if (resultado.sucesso && resultado.receitaBrutaTotal !== undefined) {
      candidatos.push({ chave: "detalhado", valor: resultado.receitaBrutaTotal, rotulo: "receitaPorKmInformada × distanciaTotalKm (via calcular_receita_km)" });
    }
  }

  if (candidatos.length === 0) return { alertas: [] };
  if (candidatos.length === 1) return { receitaTotal: candidatos[0].valor, origem: candidatos[0].rotulo, alertas: [] };

  if (estrategia === "REJEITAR_SOBREPOSICAO") {
    return {
      erro: `${rotulo}: receita informada por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicao".`,
      alertas: [],
    };
  }
  const vencedor = estrategia === "PRIORIZAR_DETALHADO" ? candidatos.find((c) => c.chave === "detalhado")! : candidatos.find((c) => c.chave === "total")!;
  const alertas = [
    `${rotulo}: sobreposição de receita resolvida por "${estrategia}" — usado ${vencedor.rotulo}.`,
  ];
  return { receitaTotal: vencedor.valor, origem: vencedor.rotulo, alertas };
}

// ---------------------------------------------------------------------------
// Lucro e margem — reutiliza calcular-margem.ts (modo MARGEM_SIMPLES),
// mesma técnica já usada por calcular_custo_dia e calcular_receita_km.
// ---------------------------------------------------------------------------

function resolverLucroEMargem(receitaTotal: number | undefined, custoJornada: number | undefined): { lucroTotal?: number; margemPercentual?: number } {
  if (receitaTotal === undefined || custoJornada === undefined) return {};
  const resultado = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: receitaTotal, custoTotal: custoJornada, estrategiaSobreposicao: "REJEITAR_SOBREPOSICAO" });
  if (!resultado.sucesso) return {};
  return { lucroTotal: resultado.lucroLiquidoEstimado, margemPercentual: resultado.margemLiquidaPercentual };
}

// ---------------------------------------------------------------------------
// Conflitos entre períodos — motorista dirigindo e descansando ao mesmo
// tempo, veículo em duas etapas simultâneas.
// ---------------------------------------------------------------------------

function intervalosSobrepoem(aInicio: string, aFim: string, bInicio: string, bFim: string): boolean {
  const ai = parseIso(aInicio);
  const af = parseIso(aFim);
  const bi = parseIso(bInicio);
  const bf = parseIso(bFim);
  if (!ai || !af || !bi || !bf) return false;
  return ai.getTime() < bf.getTime() && bi.getTime() < af.getTime();
}

function detectarConflitosPeriodos(periodos: PeriodoJornada[] | undefined, rotulo: string): string[] {
  if (!periodos || periodos.length < 2) return [];
  const erros: string[] = [];

  for (let i = 0; i < periodos.length; i++) {
    const p = periodos[i];
    if (p.inicio && p.fim && parseIso(p.inicio) && parseIso(p.fim) && parseIso(p.fim)!.getTime() <= parseIso(p.inicio)!.getTime()) {
      erros.push(`${rotulo}: período "${p.descricao ?? p.tipo}" tem início posterior (ou igual) ao fim.`);
    }
  }

  for (let i = 0; i < periodos.length; i++) {
    for (let j = i + 1; j < periodos.length; j++) {
      const a = periodos[i];
      const b = periodos[j];
      if (!a.inicio || !a.fim || !b.inicio || !b.fim) continue;
      if (!intervalosSobrepoem(a.inicio, a.fim, b.inicio, b.fim)) continue;

      if (a.motoristaResponsavel && a.motoristaResponsavel === b.motoristaResponsavel) {
        const direcaoEDescanso = (a.tipo === "DIRECAO" && b.tipo === "DESCANSO") || (a.tipo === "DESCANSO" && b.tipo === "DIRECAO");
        if (direcaoEDescanso) {
          erros.push(`${rotulo}: motorista "${a.motoristaResponsavel}" tem períodos de direção e descanso sobrepostos (conflito entre "${a.descricao ?? a.tipo}" e "${b.descricao ?? b.tipo}").`);
        } else if (a.tipo === "DIRECAO" && b.tipo === "DIRECAO") {
          erros.push(`${rotulo}: motorista "${a.motoristaResponsavel}" tem dois períodos de direção sobrepostos ao mesmo tempo.`);
        }
      }
      if (a.veiculo && a.veiculo === b.veiculo && a.motoristaResponsavel !== b.motoristaResponsavel) {
        erros.push(`${rotulo}: veículo "${a.veiculo}" está em duas atividades simultâneas ("${a.descricao ?? a.tipo}" e "${b.descricao ?? b.tipo}").`);
      }
    }
  }
  return erros;
}

function detectarConflitosEtapas(etapas: EtapaJornada[] | undefined, rotulo: string): string[] {
  if (!etapas || etapas.length < 2) return [];
  const erros: string[] = [];

  for (const etapa of etapas) {
    if (etapa.horarioInicio && etapa.horarioFim) {
      const inicio = parseIso(etapa.horarioInicio);
      const fim = parseIso(etapa.horarioFim);
      if (inicio && fim && fim.getTime() <= inicio.getTime()) {
        erros.push(`${rotulo}: etapa "${etapa.identificacaoEtapa ?? etapa.sequencia ?? "?"}" tem horário de início posterior (ou igual) ao de fim.`);
      }
    }
  }

  for (let i = 0; i < etapas.length; i++) {
    for (let j = i + 1; j < etapas.length; j++) {
      const a = etapas[i];
      const b = etapas[j];
      if (!a.horarioInicio || !a.horarioFim || !b.horarioInicio || !b.horarioFim) continue;
      if (!intervalosSobrepoem(a.horarioInicio, a.horarioFim, b.horarioInicio, b.horarioFim)) continue;

      if (a.veiculo && a.veiculo === b.veiculo) {
        erros.push(`${rotulo}: veículo "${a.veiculo}" está em duas etapas simultâneas ("${a.identificacaoEtapa ?? a.sequencia}" e "${b.identificacaoEtapa ?? b.sequencia}").`);
      }
      if (a.motoristaResponsavel && a.motoristaResponsavel === b.motoristaResponsavel) {
        erros.push(`${rotulo}: motorista "${a.motoristaResponsavel}" está em duas etapas simultâneas ("${a.identificacaoEtapa ?? a.sequencia}" e "${b.identificacaoEtapa ?? b.sequencia}").`);
      }
    }
  }
  return erros;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function coletarCamposNumericos(v: DadosJornadaVariante, rotulo: string): Array<[string, number | undefined]> {
  return [
    [`${rotulo}.distanciaTotalKm`, v.distanciaTotalKm],
    [`${rotulo}.distanciaIdaKm`, v.distanciaIdaKm],
    [`${rotulo}.distanciaVoltaKm`, v.distanciaVoltaKm],
    [`${rotulo}.velocidadeMediaKmH`, v.velocidadeMediaKmH],
    [`${rotulo}.velocidadeMaximaOperacionalKmH`, v.velocidadeMaximaOperacionalKmH],
    [`${rotulo}.tempoDirecaoMinutos`, v.tempoDirecaoMinutos],
    [`${rotulo}.tempoTrabalhoSemDirecaoMinutos`, v.tempoTrabalhoSemDirecaoMinutos],
    [`${rotulo}.tempoCargaMinutos`, v.tempoCargaMinutos],
    [`${rotulo}.tempoDescargaMinutos`, v.tempoDescargaMinutos],
    [`${rotulo}.tempoEsperaMinutos`, v.tempoEsperaMinutos],
    [`${rotulo}.tempoAbastecimentoMinutos`, v.tempoAbastecimentoMinutos],
    [`${rotulo}.tempoFiscalizacaoMinutos`, v.tempoFiscalizacaoMinutos],
    [`${rotulo}.tempoManutencaoMinutos`, v.tempoManutencaoMinutos],
    [`${rotulo}.tempoRefeicaoMinutos`, v.tempoRefeicaoMinutos],
    [`${rotulo}.tempoPausasMinutos`, v.tempoPausasMinutos],
    [`${rotulo}.tempoDescansoMinutos`, v.tempoDescansoMinutos],
    [`${rotulo}.tempoImprevistosMinutos`, v.tempoImprevistosMinutos],
    [`${rotulo}.tempoMargemSegurancaMinutos`, v.tempoMargemSegurancaMinutos],
    [`${rotulo}.quantidadeMotoristas`, v.quantidadeMotoristas],
    [`${rotulo}.quantidadeAjudantes`, v.quantidadeAjudantes],
    [`${rotulo}.quantidadeVeiculos`, v.quantidadeVeiculos],
    [`${rotulo}.horasDisponiveis`, v.horasDisponiveis],
    [`${rotulo}.diasDisponiveis`, v.diasDisponiveis],
    [`${rotulo}.horasPorDiaPlanejadas`, v.horasPorDiaPlanejadas],
    [`${rotulo}.receitaTotal`, v.receitaTotal],
    [`${rotulo}.custoTotal`, v.custoTotal],
    [`${rotulo}.custoPorHora`, v.custoPorHora],
    [`${rotulo}.receitaPorHoraInformada`, v.receitaPorHoraInformada],
    [`${rotulo}.lucroPorHoraInformado`, v.lucroPorHoraInformado],
    [`${rotulo}.receitaPorKmInformada`, v.receitaPorKmInformada],
    [`${rotulo}.custoMotoristaHora`, v.custoMotoristaHora],
    [`${rotulo}.custoAjudanteHora`, v.custoAjudanteHora],
    [`${rotulo}.custoVeiculoHora`, v.custoVeiculoHora],
    [`${rotulo}.custoEsperaHora`, v.custoEsperaHora],
    [`${rotulo}.adicionalNoturnoValor`, v.adicionalNoturnoValor],
    [`${rotulo}.horasExtrasValor`, v.horasExtrasValor],
    [`${rotulo}.despesasAdicionais`, v.despesasAdicionais],
  ];
}

function validarVariante(v: DadosJornadaVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) erros.push(`O campo "${campo}" não pode ser negativo.`);
  }
  if (v.velocidadeMediaKmH === 0) erros.push(`${rotulo}: "velocidadeMediaKmH" não pode ser igual a zero.`);
  if (v.tempoDirecaoMinutos === 0 && v.distanciaTotalKm !== undefined && v.distanciaTotalKm > 0) {
    erros.push(`${rotulo}: "tempoDirecaoMinutos" igual a zero é incompatível com uma distância maior que zero.`);
  }

  if (v.dataHoraSaida !== undefined && !parseIso(v.dataHoraSaida)) erros.push(`${rotulo}: "dataHoraSaida" não é uma data/hora válida (use ISO 8601).`);
  if (v.dataHoraChegadaDesejada !== undefined && !parseIso(v.dataHoraChegadaDesejada)) erros.push(`${rotulo}: "dataHoraChegadaDesejada" não é uma data/hora válida (use ISO 8601).`);
  if (v.dataHoraChegadaReal !== undefined && !parseIso(v.dataHoraChegadaReal)) erros.push(`${rotulo}: "dataHoraChegadaReal" não é uma data/hora válida (use ISO 8601).`);

  if (v.dataHoraSaida && v.dataHoraChegadaReal) {
    const dif = diferencaMinutosIso(v.dataHoraSaida, v.dataHoraChegadaReal);
    if (dif !== undefined && dif < 0) {
      erros.push(`${rotulo}: "dataHoraChegadaReal" é anterior a "dataHoraSaida" — verifique se a chegada ocorreu em outro dia (informe a data completa).`);
    }
  }

  const fontesDuracao = [
    v.tempoDirecaoMinutos !== undefined,
    v.distanciaTotalKm !== undefined && v.velocidadeMediaKmH !== undefined,
    somaDirecaoEtapas(v.etapas) !== undefined,
  ].filter(Boolean).length;
  if (fontesDuracao > 1) {
    erros.push(`${rotulo}: tempo de direção informado por mais de uma fonte — conflito tratado na resolução (verifique "estrategiaSobreposicaoDuracao").`);
  }

  const fontesReceita = [v.receitaTotal !== undefined, v.receitaPorKmInformada !== undefined && v.distanciaTotalKm !== undefined].filter(Boolean).length;
  if (fontesReceita > 1) {
    erros.push(`${rotulo}: receita informada por mais de uma fonte — conflito tratado na resolução (verifique "estrategiaSobreposicao").`);
  }

  const fontesCusto = [v.custoTotal !== undefined, v.resumoCustoViagem?.custoTotal !== undefined].filter(Boolean).length;
  if (fontesCusto > 1) {
    erros.push(`${rotulo}: custo da jornada informado por mais de uma fonte (custoTotal e resumoCustoViagem) — conflito tratado na resolução (verifique "estrategiaSobreposicaoCusto").`);
  }

  const esperaDetalhada = (v.periodos ?? []).some((p) => p.tipo === "ESPERA");
  if (v.tempoEsperaMinutos !== undefined && esperaDetalhada) {
    erros.push(`${rotulo}: tempo de espera informado tanto em "tempoEsperaMinutos" quanto detalhado em "periodos" (tipo ESPERA) — possível duplicidade. Informe apenas uma forma.`);
  }

  erros.push(...detectarConflitosPeriodos(v.periodos, rotulo));
  erros.push(...detectarConflitosEtapas(v.etapas, rotulo));

  for (const m of v.motoristas ?? []) {
    erros.push(...detectarConflitosPeriodos(m.periodos, `${rotulo}.motoristas[${m.identificacaoMotorista ?? m.nome ?? "?"}]`));
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Conformidade — nunca afirma regularidade/irregularidade sem regra
// fornecida; regra "LEGAL" sem fonte/versão é rebaixada a referência
// operacional (nunca tratada como regra legal válida).
// ---------------------------------------------------------------------------

interface ContextoConformidade {
  tempoDirecaoMinutos?: number;
  jornadaTotalMinutos?: number;
  tempoDescansoMinutos?: number;
}

interface ResultadoConformidade {
  status: StatusConformidadeJornada;
  ocorrencias: OcorrenciaConformidadeJornada[];
  regrasAplicadas: string[];
  alertas: string[];
}

function avaliarConformidade(regras: RegraConformidadeJornada[] | undefined, ctx: ContextoConformidade, toleranciaMinutosPadrao: number): ResultadoConformidade {
  if (!regras || regras.length === 0) {
    return { status: "NAO_AVALIADO", ocorrencias: [], regrasAplicadas: [], alertas: [] };
  }

  const ocorrencias: OcorrenciaConformidadeJornada[] = [];
  const regrasAplicadas: string[] = [];
  const alertas: string[] = [];
  let algumaDegradada = false;

  for (const regra of regras) {
    const fonteRegra = regra.fonte ? `${regra.fonte}${regra.versao ? ` v${regra.versao}` : ""}` : undefined;
    let tipoEfetivo: TipoAplicacaoRegra = regra.tipoAplicacao;
    if (regra.tipoAplicacao === "LEGAL" && (!regra.fonte || !regra.versao)) {
      alertas.push(
        `Regra "${regra.nome ?? regra.identificacaoRegra ?? "?"}" está marcada como LEGAL mas não informa fonte e versão — tratada apenas como referência operacional, nunca como regra legal válida.`
      );
      tipoEfetivo = "OPERACIONAL";
      algumaDegradada = true;
    }
    regrasAplicadas.push(`${regra.nome ?? regra.identificacaoRegra ?? "regra"} (${tipoEfetivo}${fonteRegra ? `, fonte: ${fonteRegra}` : ""}${regra.versao ? ` v${regra.versao}` : ""})`);

    const tol = regra.toleranciaMinutos ?? toleranciaMinutosPadrao;

    if (regra.limiteDirecaoContinuaMinutos !== undefined && ctx.tempoDirecaoMinutos !== undefined) {
      const diff = ctx.tempoDirecaoMinutos - regra.limiteDirecaoContinuaMinutos;
      if (diff > tol) {
        ocorrencias.push({
          codigo: "DIRECAO_CONTINUA_EXCEDIDA",
          categoria: "Tempo de direção contínua",
          descricao: `Tempo de direção (${formatarNumero(ctx.tempoDirecaoMinutos)} min) ultrapassa o limite de direção contínua (${formatarNumero(regra.limiteDirecaoContinuaMinutos)} min).`,
          valorCalculado: ctx.tempoDirecaoMinutos,
          limiteAplicado: regra.limiteDirecaoContinuaMinutos,
          diferenca: diff,
          gravidade: "ALTO",
          fonteRegra,
        });
      }
    }
    if (regra.limiteDirecaoDiaMinutos !== undefined && ctx.tempoDirecaoMinutos !== undefined) {
      const diff = ctx.tempoDirecaoMinutos - regra.limiteDirecaoDiaMinutos;
      if (diff > tol) {
        ocorrencias.push({
          codigo: "DIRECAO_DIARIA_EXCEDIDA",
          categoria: "Tempo de direção diária",
          descricao: `Tempo de direção (${formatarNumero(ctx.tempoDirecaoMinutos)} min) ultrapassa o limite diário de direção (${formatarNumero(regra.limiteDirecaoDiaMinutos)} min).`,
          valorCalculado: ctx.tempoDirecaoMinutos,
          limiteAplicado: regra.limiteDirecaoDiaMinutos,
          diferenca: diff,
          gravidade: "ALTO",
          fonteRegra,
        });
      }
    }
    if (regra.limiteJornadaDiaMinutos !== undefined && ctx.jornadaTotalMinutos !== undefined) {
      const diff = ctx.jornadaTotalMinutos - regra.limiteJornadaDiaMinutos;
      if (diff > tol) {
        ocorrencias.push({
          codigo: "JORNADA_DIARIA_EXCEDIDA",
          categoria: "Jornada diária",
          descricao: `Jornada total (${formatarNumero(ctx.jornadaTotalMinutos)} min) ultrapassa o limite diário de jornada (${formatarNumero(regra.limiteJornadaDiaMinutos)} min).`,
          valorCalculado: ctx.jornadaTotalMinutos,
          limiteAplicado: regra.limiteJornadaDiaMinutos,
          diferenca: diff,
          gravidade: "CRITICO",
          fonteRegra,
        });
      }
    }
    if (regra.descansoEntreJornadasMinutos !== undefined && ctx.tempoDescansoMinutos !== undefined) {
      const diff = regra.descansoEntreJornadasMinutos - ctx.tempoDescansoMinutos;
      if (diff > tol) {
        ocorrencias.push({
          codigo: "DESCANSO_INSUFICIENTE",
          categoria: "Descanso entre jornadas",
          descricao: `Descanso informado (${formatarNumero(ctx.tempoDescansoMinutos)} min) é menor que o mínimo exigido (${formatarNumero(regra.descansoEntreJornadasMinutos)} min).`,
          valorCalculado: ctx.tempoDescansoMinutos,
          limiteAplicado: regra.descansoEntreJornadasMinutos,
          diferenca: -diff,
          gravidade: "ALTO",
          fonteRegra,
        });
      }
    }
  }

  let status: StatusConformidadeJornada;
  if (ocorrencias.some((o) => o.gravidade === "CRITICO" || o.gravidade === "ALTO")) status = "NAO_CONFORME";
  else if (ocorrencias.length > 0) status = "CONFORME_COM_ALERTA";
  else if (algumaDegradada) status = "PARCIALMENTE_AVALIADO";
  else status = "CONFORME";

  return { status, ocorrencias, regrasAplicadas, alertas };
}

// ---------------------------------------------------------------------------
// Classificação operacional e completude
// ---------------------------------------------------------------------------

function classificarOperacional(ctx: {
  duracaoValida: boolean;
  duracaoTotalViagemMinutos?: number;
  horasDisponiveis?: number;
  diasNecessariosInteiros?: number;
  diasDisponiveis?: number;
  statusConformidade?: StatusConformidadeJornada;
  velocidadeIncompativel?: boolean;
  temAlertas: boolean;
}): ClassificacaoOperacionalJornada {
  if (ctx.velocidadeIncompativel) return "PRAZO_INCOMPATIVEL";
  if (!ctx.duracaoValida) return "DADOS_INSUFICIENTES";
  if (ctx.statusConformidade === "NAO_CONFORME") return "INVIAVEL_POR_REGRA_CONFIGURADA";
  if (ctx.diasDisponiveis !== undefined && ctx.diasNecessariosInteiros !== undefined && ctx.diasNecessariosInteiros > ctx.diasDisponiveis) return "INVIAVEL_POR_CAPACIDADE";
  if (ctx.horasDisponiveis !== undefined && ctx.duracaoTotalViagemMinutos !== undefined && ctx.duracaoTotalViagemMinutos / 60 > ctx.horasDisponiveis) return "INVIAVEL_POR_TEMPO";
  if (ctx.statusConformidade === "CONFORME_COM_ALERTA" || ctx.temAlertas) return "VIAVEL_COM_ALERTAS";
  return "VIAVEL";
}

function determinarCompletude(ctx: { temDuracaoBase: boolean; temAtividades: boolean; temMotoristas: boolean; temCustoOuReceita: boolean; temRegrasConformidade: boolean }): NivelCompletude {
  if (!ctx.temDuracaoBase) return "INSUFICIENTE";
  if (!ctx.temAtividades || !ctx.temMotoristas || !ctx.temCustoOuReceita || !ctx.temRegrasConformidade) return "PARCIAL";
  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Fábrica de resposta de falha
// ---------------------------------------------------------------------------

function respostaFalha(entrada: CalcularJornadaEntrada, mensagemResumo: string, dadosFaltantes: string[] = []): CalcularJornadaResultado {
  return {
    sucesso: false,
    modo: entrada.modo,
    identificacao: entrada.identificacao,
    descricao: entrada.descricao,
    origem: entrada.origem,
    destino: entrada.destino,
    nivelCompletude: "INSUFICIENTE",
    dadosPresentes: [],
    dadosFaltantes,
    indicadoresNaoAvaliados: [],
    limitacoes: LIMITACOES_PADRAO,
    alertas: [],
    premissas: [],
    mensagemResumo,
    memoriaCalculo: [],
  };
}

// ---------------------------------------------------------------------------
// Núcleo de cálculo — orquestra a resolução de duração, custo, receita,
// lucro, conformidade, classificação e completude para uma variante.
// ---------------------------------------------------------------------------

interface OpcoesNucleo {
  estrategiaSobreposicaoDuracao: EstrategiaSobreposicaoDuracaoJornada;
  estrategiaSobreposicaoCusto: EstrategiaSobreposicaoCustoJornada;
  estrategiaSobreposicaoReceita: EstrategiaSobreposicao;
  toleranciaMinutos: number;
  casas: CasasDecimaisJornada;
}

interface AgregacaoJornada {
  erro?: string;
  dadosFaltantes: string[];
  alertas: string[];
  premissas: string[];
  memoriaCalculo: string[];
  custosIncluidos: string[];
  custosIgnorados: string[];

  tempoDirecaoMinutos?: number;
  tempoTrabalhoSemDirecaoMinutos?: number;
  jornadaTotalMinutos?: number;
  duracaoTotalViagemMinutos?: number;
  tempoProdutivoMinutos?: number;
  diasNecessariosExatos?: number;
  diasNecessariosInteiros?: number;
  distanciaPossivelKm?: number;
  velocidadeNecessariaKmH?: number;
  velocidadeIncompativel: boolean;

  dataHoraChegadaEstimada?: string;
  horarioSaidaNecessario?: string;

  percentualDirecao?: number;
  percentualEspera?: number;
  percentualProdutivo?: number;

  distanciaTotalKm?: number;
  tempoEsperaMinutos?: number;
  tempoDescansoMinutos?: number;

  custoJornada?: number;
  custoEspera?: number;
  custoPorHoraTotal?: number;
  custoPorHoraDirecao?: number;

  receitaTotal?: number;
  receitaPorHoraTotal?: number;
  receitaPorHoraDirecao?: number;

  lucroTotal?: number;
  lucroPorHora?: number;
  margemPercentual?: number;

  statusConformidade: StatusConformidadeJornada;
  ocorrenciasConformidade: OcorrenciaConformidadeJornada[];
  regrasAplicadas: string[];

  classificacaoOperacional: ClassificacaoOperacionalJornada;
  nivelCompletude: NivelCompletude;
}

function calcularNucleo(v: DadosJornadaVariante, opts: OpcoesNucleo, rotulo: string): AgregacaoJornada {
  const dadosFaltantes: string[] = [];
  const alertas: string[] = [];
  const premissas: string[] = [];
  const memoriaCalculo: string[] = [];
  const c = opts.casas;

  const errosValidacao = validarVariante(v, rotulo);
  if (errosValidacao.length > 0) {
    return {
      erro: errosValidacao.join(" "),
      dadosFaltantes,
      alertas,
      premissas,
      memoriaCalculo,
      custosIncluidos: [],
      custosIgnorados: [],
      velocidadeIncompativel: false,
      statusConformidade: "DADOS_INSUFICIENTES",
      ocorrenciasConformidade: [],
      regrasAplicadas: [],
      classificacaoOperacional: "DADOS_INSUFICIENTES",
      nivelCompletude: "INSUFICIENTE",
    };
  }

  const resDirecao = resolverTempoDirecao(v, opts.estrategiaSobreposicaoDuracao, rotulo);
  if (resDirecao.erro) {
    return {
      erro: resDirecao.erro,
      dadosFaltantes,
      alertas,
      premissas,
      memoriaCalculo,
      custosIncluidos: [],
      custosIgnorados: [],
      velocidadeIncompativel: false,
      statusConformidade: "DADOS_INSUFICIENTES",
      ocorrenciasConformidade: [],
      regrasAplicadas: [],
      classificacaoOperacional: "DADOS_INSUFICIENTES",
      nivelCompletude: "INSUFICIENTE",
    };
  }
  alertas.push(...resDirecao.alertas);
  const tempoDirecaoMinutos = resDirecao.tempoDirecaoMinutos;
  if (tempoDirecaoMinutos !== undefined && resDirecao.origem) {
    memoriaCalculo.push(`Tempo de direção: ${formatarNumero(tempoDirecaoMinutos)} min (${resDirecao.origem}).`);
  } else {
    dadosFaltantes.push("tempoDirecaoMinutos (ou distanciaTotalKm + velocidadeMediaKmH, ou etapas com tempo de direção)");
  }

  const { valor: tempoTrabalhoSemDirecaoMinutos, derivado } = resolverTempoTrabalhoSemDirecao(v);
  if (tempoTrabalhoSemDirecaoMinutos !== undefined) {
    memoriaCalculo.push(`Trabalho sem direção: ${formatarNumero(tempoTrabalhoSemDirecaoMinutos)} min${derivado ? " (soma de carga+descarga+abastecimento+fiscalização+manutenção)" : " (informado)"}.`);
  }

  const config = v.configuracaoJornada ?? {};
  const { jornadaTotalMinutos, duracaoTotalViagemMinutos, tempoProdutivoMinutos } = calcularJornadaEDuracao(tempoDirecaoMinutos, tempoTrabalhoSemDirecaoMinutos, v, config);
  if (jornadaTotalMinutos !== undefined) memoriaCalculo.push(`Jornada total: ${formatarNumero(jornadaTotalMinutos)} min.`);
  if (duracaoTotalViagemMinutos !== undefined) memoriaCalculo.push(`Duração total da viagem: ${formatarNumero(duracaoTotalViagemMinutos)} min (jornada + descanso + margem de segurança).`);

  // Dias necessários
  let diasNecessariosExatos: number | undefined;
  let diasNecessariosInteiros: number | undefined;
  if (duracaoTotalViagemMinutos !== undefined && v.horasPorDiaPlanejadas !== undefined) {
    const dias = calcularDiasNecessarios(duracaoTotalViagemMinutos, v.horasPorDiaPlanejadas);
    if (dias) {
      diasNecessariosExatos = dias.exatos;
      diasNecessariosInteiros = dias.inteiros;
      memoriaCalculo.push(`Dias necessários: ${formatarNumero(arredondar(dias.exatos, c.dia))} dias exatos (${dias.inteiros} dias inteiros), com ${v.horasPorDiaPlanejadas} h/dia planejadas.`);
    }
  }

  // Distância possível / velocidade necessária (horasDisponiveis interpretado como horas de direção disponíveis nestes cálculos)
  let distanciaPossivelKm: number | undefined;
  if (v.velocidadeMediaKmH !== undefined && v.horasDisponiveis !== undefined) {
    distanciaPossivelKm = v.velocidadeMediaKmH * v.horasDisponiveis;
    memoriaCalculo.push(`Distância possível: ${formatarNumero(arredondar(distanciaPossivelKm, c.km))} km (velocidadeMediaKmH × horasDisponiveis).`);
  }
  let velocidadeNecessariaKmH: number | undefined;
  if (v.distanciaTotalKm !== undefined && v.horasDisponiveis !== undefined && v.horasDisponiveis > 0) {
    velocidadeNecessariaKmH = v.distanciaTotalKm / v.horasDisponiveis;
    memoriaCalculo.push(`Velocidade necessária: ${formatarNumero(arredondar(velocidadeNecessariaKmH, c.velocidade))} km/h (distanciaTotalKm ÷ horasDisponiveis).`);
  }
  const velocidadeIncompativel = velocidadeNecessariaKmH !== undefined && v.velocidadeMaximaOperacionalKmH !== undefined && velocidadeNecessariaKmH > v.velocidadeMaximaOperacionalKmH;
  if (velocidadeIncompativel) {
    alertas.push(
      `A velocidade necessária (${formatarNumero(arredondar(velocidadeNecessariaKmH!, c.velocidade))} km/h) ultrapassa o limite operacional informado (${formatarNumero(
        v.velocidadeMaximaOperacionalKmH!
      )} km/h) — a programação não é recomendada nesta configuração; considere ajustar horário, prazo, rota, quantidade de motoristas ou duração das paradas. A velocidade não foi ajustada nem recomendada.`
    );
  }

  // Horários
  let dataHoraChegadaEstimada: string | undefined;
  if (v.dataHoraSaida && duracaoTotalViagemMinutos !== undefined) {
    dataHoraChegadaEstimada = somarMinutosIso(v.dataHoraSaida, duracaoTotalViagemMinutos);
    if (dataHoraChegadaEstimada) memoriaCalculo.push(`Chegada estimada: dataHoraSaida + ${formatarNumero(duracaoTotalViagemMinutos)} min = ${dataHoraChegadaEstimada}.`);
    if (v.fusoHorario && !/[zZ]|[+-]\d\d:\d\d$/.test(v.dataHoraSaida)) {
      alertas.push(`"fusoHorario" foi informado, mas "dataHoraSaida" não tem offset explícito no formato ISO 8601 — o fuso não foi alterado ou reinterpretado; informe o offset diretamente na data/hora para maior precisão.`);
    }
  }
  let horarioSaidaNecessario: string | undefined;
  if (v.dataHoraChegadaDesejada && duracaoTotalViagemMinutos !== undefined) {
    horarioSaidaNecessario = subtrairMinutosIso(v.dataHoraChegadaDesejada, duracaoTotalViagemMinutos);
    if (horarioSaidaNecessario) memoriaCalculo.push(`Horário de saída necessário: dataHoraChegadaDesejada − ${formatarNumero(duracaoTotalViagemMinutos)} min = ${horarioSaidaNecessario}.`);
  }

  // Percentuais
  let percentualDirecao: number | undefined;
  let percentualEspera: number | undefined;
  let percentualProdutivo: number | undefined;
  if (duracaoTotalViagemMinutos !== undefined && duracaoTotalViagemMinutos > 0) {
    if (tempoDirecaoMinutos !== undefined) percentualDirecao = (tempoDirecaoMinutos / duracaoTotalViagemMinutos) * 100;
    if (v.tempoEsperaMinutos !== undefined) percentualEspera = (v.tempoEsperaMinutos / duracaoTotalViagemMinutos) * 100;
    if (tempoProdutivoMinutos !== undefined) percentualProdutivo = (tempoProdutivoMinutos / duracaoTotalViagemMinutos) * 100;
  }

  // Custo
  const resCusto = resolverCustoJornada(v, jornadaTotalMinutos, v.quantidadeMotoristas, opts.estrategiaSobreposicaoCusto, c, rotulo);
  if (resCusto.erro) {
    return {
      erro: resCusto.erro,
      dadosFaltantes,
      alertas,
      premissas,
      memoriaCalculo,
      custosIncluidos: [],
      custosIgnorados: [],
      velocidadeIncompativel,
      statusConformidade: "DADOS_INSUFICIENTES",
      ocorrenciasConformidade: [],
      regrasAplicadas: [],
      classificacaoOperacional: "DADOS_INSUFICIENTES",
      nivelCompletude: "INSUFICIENTE",
    };
  }
  alertas.push(...resCusto.alertas);
  const custoJornada = resCusto.custoJornada !== undefined ? arredondar(resCusto.custoJornada, c.moeda) : undefined;
  const custoEspera = resCusto.custoEspera !== undefined ? arredondar(resCusto.custoEspera, c.moeda) : undefined;
  if (custoJornada !== undefined) memoriaCalculo.push(`Custo da jornada: ${formatarBRL(custoJornada)} (${resCusto.origem ?? "composição detalhada"}).`);
  else dadosFaltantes.push("custoTotal (ou resumoCustoViagem, ou tarifas por hora: custoVeiculoHora/custoMotoristaHora/custoAjudanteHora)");

  // Receita
  const resReceita = resolverReceitaTotal(v, opts.estrategiaSobreposicaoReceita, rotulo);
  if (resReceita.erro) {
    return {
      erro: resReceita.erro,
      dadosFaltantes,
      alertas,
      premissas,
      memoriaCalculo,
      custosIncluidos: resCusto.custosIncluidos,
      custosIgnorados: resCusto.custosIgnorados,
      velocidadeIncompativel,
      statusConformidade: "DADOS_INSUFICIENTES",
      ocorrenciasConformidade: [],
      regrasAplicadas: [],
      classificacaoOperacional: "DADOS_INSUFICIENTES",
      nivelCompletude: "INSUFICIENTE",
    };
  }
  alertas.push(...resReceita.alertas);
  const receitaTotal = resReceita.receitaTotal !== undefined ? arredondar(resReceita.receitaTotal, c.moeda) : undefined;
  if (receitaTotal !== undefined) memoriaCalculo.push(`Receita total: ${formatarBRL(receitaTotal)} (${resReceita.origem}).`);
  else dadosFaltantes.push("receitaTotal (ou receitaPorKmInformada + distanciaTotalKm)");

  // Lucro / margem — via calcular_margem
  const { lucroTotal, margemPercentual } = resolverLucroEMargem(receitaTotal, custoJornada);
  if (lucroTotal !== undefined) memoriaCalculo.push(`Lucro total: ${formatarBRL(lucroTotal)} = receita − custo da jornada (via calcular_margem).`);

  // Por hora
  const duracaoHoras = duracaoTotalViagemMinutos !== undefined ? duracaoTotalViagemMinutos / 60 : undefined;
  const direcaoHoras = tempoDirecaoMinutos !== undefined ? tempoDirecaoMinutos / 60 : undefined;
  const custoPorHoraTotal = custoJornada !== undefined && duracaoHoras !== undefined ? dividirSeguro(custoJornada, duracaoHoras, c.moeda) : undefined;
  const custoPorHoraDirecao = custoJornada !== undefined && direcaoHoras !== undefined ? dividirSeguro(custoJornada, direcaoHoras, c.moeda) : undefined;
  if (custoPorHoraDirecao !== undefined) {
    memoriaCalculo.push(`Custo por hora de direção: ${formatarBRL(custoPorHoraDirecao)} — distribui TODO o custo da jornada apenas pelas horas de direção (indicador informativo, não o custo real por hora trabalhada).`);
  }
  const receitaPorHoraTotal = receitaTotal !== undefined && duracaoHoras !== undefined ? dividirSeguro(receitaTotal, duracaoHoras, c.moeda) : undefined;
  const receitaPorHoraDirecao = receitaTotal !== undefined && direcaoHoras !== undefined ? dividirSeguro(receitaTotal, direcaoHoras, c.moeda) : undefined;
  const lucroPorHora = lucroTotal !== undefined && duracaoHoras !== undefined ? dividirSeguro(lucroTotal, duracaoHoras, c.moeda) : undefined;

  // Conformidade
  const resConformidade = avaliarConformidade(v.regrasConformidade, { tempoDirecaoMinutos, jornadaTotalMinutos, tempoDescansoMinutos: v.tempoDescansoMinutos }, opts.toleranciaMinutos);
  alertas.push(...resConformidade.alertas);

  // Classificação e completude
  const duracaoValida = duracaoTotalViagemMinutos !== undefined;
  const classificacaoOperacional = classificarOperacional({
    duracaoValida,
    duracaoTotalViagemMinutos,
    horasDisponiveis: v.horasDisponiveis,
    diasNecessariosInteiros,
    diasDisponiveis: v.diasDisponiveis,
    statusConformidade: resConformidade.status,
    velocidadeIncompativel,
    temAlertas: alertas.length > 0,
  });

  const temAtividades = [v.tempoCargaMinutos, v.tempoDescargaMinutos, v.tempoEsperaMinutos, v.tempoPausasMinutos, v.tempoDescansoMinutos].some((x) => x !== undefined);
  const nivelCompletude = determinarCompletude({
    temDuracaoBase: duracaoValida,
    temAtividades,
    temMotoristas: v.quantidadeMotoristas !== undefined,
    temCustoOuReceita: custoJornada !== undefined || receitaTotal !== undefined,
    temRegrasConformidade: (v.regrasConformidade?.length ?? 0) > 0,
  });

  return {
    dadosFaltantes,
    alertas,
    premissas,
    memoriaCalculo,
    custosIncluidos: resCusto.custosIncluidos,
    custosIgnorados: resCusto.custosIgnorados,
    tempoDirecaoMinutos,
    tempoTrabalhoSemDirecaoMinutos,
    jornadaTotalMinutos,
    duracaoTotalViagemMinutos,
    tempoProdutivoMinutos,
    diasNecessariosExatos,
    diasNecessariosInteiros,
    distanciaPossivelKm,
    velocidadeNecessariaKmH,
    velocidadeIncompativel,
    dataHoraChegadaEstimada,
    horarioSaidaNecessario,
    percentualDirecao,
    percentualEspera,
    percentualProdutivo,
    distanciaTotalKm: v.distanciaTotalKm,
    tempoEsperaMinutos: v.tempoEsperaMinutos,
    tempoDescansoMinutos: v.tempoDescansoMinutos,
    custoJornada,
    custoEspera,
    custoPorHoraTotal,
    custoPorHoraDirecao,
    receitaTotal,
    receitaPorHoraTotal,
    receitaPorHoraDirecao,
    lucroTotal,
    lucroPorHora,
    margemPercentual,
    statusConformidade: resConformidade.status,
    ocorrenciasConformidade: resConformidade.ocorrencias,
    regrasAplicadas: resConformidade.regrasAplicadas,
    classificacaoOperacional,
    nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Resumo textual — sempre a partir dos resultados calculados, nunca com
// números fixos no código.
// ---------------------------------------------------------------------------

function construirResumo(ag: AgregacaoJornada, entrada: CalcularJornadaEntrada): string {
  if (ag.erro) return ag.erro;

  const partes: string[] = [];
  if (entrada.distanciaTotalKm !== undefined && entrada.velocidadeMediaKmH !== undefined) {
    partes.push(`A operação possui ${formatarNumero(entrada.distanciaTotalKm)} km e velocidade média informada de ${formatarNumero(entrada.velocidadeMediaKmH)} km/h.`);
  }
  if (ag.tempoDirecaoMinutos !== undefined) {
    partes.push(`Tempo de direção estimado: ${formatarNumero(arredondar(ag.tempoDirecaoMinutos / 60, 2))} h.`);
  }
  if (ag.jornadaTotalMinutos !== undefined) {
    partes.push(`Jornada total: ${formatarNumero(arredondar(ag.jornadaTotalMinutos / 60, 2))} h.`);
  }
  if (ag.duracaoTotalViagemMinutos !== undefined) {
    partes.push(`Duração total da viagem: ${formatarNumero(arredondar(ag.duracaoTotalViagemMinutos / 60, 2))} h.`);
  }
  if (ag.dataHoraChegadaEstimada) {
    partes.push(`Chegada estimada em ${ag.dataHoraChegadaEstimada}.`);
  }
  if (ag.diasNecessariosInteiros !== undefined) {
    partes.push(`Necessários ${ag.diasNecessariosInteiros} dia(s) de operação.`);
  }
  if (ag.custoJornada !== undefined) {
    partes.push(`Custo total estimado da jornada: ${formatarBRL(ag.custoJornada)}${ag.custoPorHoraTotal !== undefined ? `, ${formatarBRL(ag.custoPorHoraTotal)} por hora total` : ""}.`);
  }
  if (ag.lucroTotal !== undefined) {
    partes.push(`Lucro estimado: ${formatarBRL(ag.lucroTotal)}${ag.margemPercentual !== undefined ? ` (margem de ${formatarNumero(ag.margemPercentual)}%)` : ""}.`);
  }
  if (ag.statusConformidade === "NAO_AVALIADO") {
    partes.push("A conformidade legal não foi avaliada porque nenhuma regra foi fornecida.");
  } else if (ag.statusConformidade) {
    partes.push(`Conformidade em relação às regras informadas: ${ag.statusConformidade}.`);
  }
  if (ag.velocidadeIncompativel) {
    partes.push("A velocidade necessária para cumprir o prazo ultrapassa o limite operacional informado — a programação não é recomendada nesta configuração.");
  }

  if (partes.length === 0) return "Não foi possível calcular a jornada com os dados informados.";
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Conversão de uma agregação em resultado principal / de cenário
// ---------------------------------------------------------------------------

function paraResultadoPrincipal(ag: AgregacaoJornada, entrada: CalcularJornadaEntrada): CalcularJornadaResultado {
  const sucesso = ag.erro === undefined;
  return {
    sucesso,
    modo: entrada.modo,
    identificacao: entrada.identificacao,
    descricao: entrada.descricao,
    origem: entrada.origem,
    destino: entrada.destino,
    dataHoraSaida: entrada.dataHoraSaida,
    dataHoraChegadaEstimada: ag.dataHoraChegadaEstimada,
    dataHoraChegadaDesejada: entrada.dataHoraChegadaDesejada,
    dataHoraChegadaReal: entrada.dataHoraChegadaReal,
    horarioSaidaNecessario: ag.horarioSaidaNecessario,
    distanciaTotalKm: entrada.distanciaTotalKm,
    velocidadeMediaKmH: entrada.velocidadeMediaKmH,
    velocidadeNecessariaKmH: ag.velocidadeNecessariaKmH !== undefined ? arredondar(ag.velocidadeNecessariaKmH, CASAS_DECIMAIS_VELOCIDADE_PADRAO) : undefined,
    tempoDirecaoMinutos: ag.tempoDirecaoMinutos,
    tempoTrabalhoSemDirecaoMinutos: ag.tempoTrabalhoSemDirecaoMinutos,
    tempoCargaMinutos: entrada.tempoCargaMinutos,
    tempoDescargaMinutos: entrada.tempoDescargaMinutos,
    tempoEsperaMinutos: entrada.tempoEsperaMinutos,
    tempoAbastecimentoMinutos: entrada.tempoAbastecimentoMinutos,
    tempoFiscalizacaoMinutos: entrada.tempoFiscalizacaoMinutos,
    tempoManutencaoMinutos: entrada.tempoManutencaoMinutos,
    tempoRefeicaoMinutos: entrada.tempoRefeicaoMinutos,
    tempoPausasMinutos: entrada.tempoPausasMinutos,
    tempoDescansoMinutos: entrada.tempoDescansoMinutos,
    tempoImprevistosMinutos: entrada.tempoImprevistosMinutos,
    jornadaTotalMinutos: ag.jornadaTotalMinutos,
    duracaoTotalViagemMinutos: ag.duracaoTotalViagemMinutos,
    diasNecessariosExatos: ag.diasNecessariosExatos !== undefined ? arredondar(ag.diasNecessariosExatos, CASAS_DECIMAIS_DIA_PADRAO) : undefined,
    diasNecessariosInteiros: ag.diasNecessariosInteiros,
    distanciaPossivelKm: ag.distanciaPossivelKm !== undefined ? arredondar(ag.distanciaPossivelKm, CASAS_DECIMAIS_KM_PADRAO) : undefined,
    percentualDirecao: ag.percentualDirecao !== undefined ? arredondar(ag.percentualDirecao, CASAS_DECIMAIS_PERCENTUAL_PADRAO) : undefined,
    percentualEspera: ag.percentualEspera !== undefined ? arredondar(ag.percentualEspera, CASAS_DECIMAIS_PERCENTUAL_PADRAO) : undefined,
    percentualProdutivo: ag.percentualProdutivo !== undefined ? arredondar(ag.percentualProdutivo, CASAS_DECIMAIS_PERCENTUAL_PADRAO) : undefined,
    quantidadeMotoristas: entrada.quantidadeMotoristas,
    custoJornada: ag.custoJornada,
    custoEspera: ag.custoEspera,
    custoPorHoraTotal: ag.custoPorHoraTotal,
    custoPorHoraDirecao: ag.custoPorHoraDirecao,
    receitaTotal: ag.receitaTotal,
    receitaPorHoraTotal: ag.receitaPorHoraTotal,
    receitaPorHoraDirecao: ag.receitaPorHoraDirecao,
    lucroTotal: ag.lucroTotal,
    lucroPorHora: ag.lucroPorHora,
    margemPercentual: ag.margemPercentual,
    classificacaoOperacional: ag.classificacaoOperacional,
    statusConformidade: ag.statusConformidade,
    ocorrenciasConformidade: ag.ocorrenciasConformidade,
    regrasAplicadas: ag.regrasAplicadas,
    nivelCompletude: ag.nivelCompletude,
    dadosPresentes: [],
    dadosFaltantes: ag.dadosFaltantes,
    indicadoresNaoAvaliados: [],
    limitacoes: LIMITACOES_PADRAO,
    alertas: ag.alertas,
    premissas: ag.premissas,
    mensagemResumo: construirResumo(ag, entrada),
    memoriaCalculo: ag.memoriaCalculo,
  };
}

// ---------------------------------------------------------------------------
// Motoristas — nunca divide a direção automaticamente; cada motorista
// precisa de seus próprios períodos informados.
// ---------------------------------------------------------------------------

function duracaoPeriodo(p: PeriodoJornada): number {
  if (p.duracaoMinutos !== undefined) return p.duracaoMinutos;
  if (p.inicio && p.fim) return diferencaMinutosIso(p.inicio, p.fim) ?? 0;
  return 0;
}

function somaPorTipos(periodos: PeriodoJornada[], tipos: TipoTempo[]): number {
  return periodos.filter((p) => tipos.includes(p.tipo)).reduce((acc, p) => acc + duracaoPeriodo(p), 0);
}

function calcularResultadoMotorista(m: MotoristaJornada): ResultadoMotoristaJornada {
  const periodos = m.periodos ?? [];
  if (periodos.length === 0) {
    return {
      identificacaoMotorista: m.identificacaoMotorista,
      nome: m.nome,
      custo: m.custoHora === undefined ? m.custoDiaria : undefined,
      alertas: [],
      nivelCompletude: "INSUFICIENTE",
    };
  }

  const tempoDirecaoMinutos = somaPorTipos(periodos, ["DIRECAO"]);
  const tempoTrabalhoSemDirecaoMinutos = somaPorTipos(periodos, ["TRABALHO_SEM_DIRECAO", "CARGA", "DESCARGA", "ABASTECIMENTO", "FISCALIZACAO", "MANUTENCAO"]);
  const tempoEsperaMinutos = somaPorTipos(periodos, ["ESPERA"]);
  const tempoPausaMinutos = somaPorTipos(periodos, ["PAUSA", "REFEICAO"]);
  const tempoDescansoMinutos = somaPorTipos(periodos, ["DESCANSO", "PERNOITE"]);
  const jornadaTotalMinutos = periodos.filter((p) => p.consideradoJornada !== false && p.tipo !== "DESCANSO" && p.tipo !== "PERNOITE").reduce((acc, p) => acc + duracaoPeriodo(p), 0);
  const quantidadeTurnos = new Set(periodos.map((p) => p.etapa).filter((e): e is string => !!e)).size || 1;
  const custo = m.custoHora !== undefined ? m.custoHora * (jornadaTotalMinutos / 60) : m.custoDiaria;

  return {
    identificacaoMotorista: m.identificacaoMotorista,
    nome: m.nome,
    tempoDirecaoMinutos,
    tempoTrabalhoSemDirecaoMinutos,
    tempoEsperaMinutos,
    tempoPausaMinutos,
    tempoDescansoMinutos,
    jornadaTotalMinutos,
    quantidadeTurnos,
    custo: custo !== undefined ? arredondar(custo, CASAS_DECIMAIS_MOEDA_PADRAO) : undefined,
    alertas: [],
    nivelCompletude: "COMPLETO",
  };
}

function construirCronologia(v: DadosJornadaVariante): PeriodoJornada[] {
  const todos: PeriodoJornada[] = [...(v.periodos ?? [])];
  for (const m of v.motoristas ?? []) {
    for (const p of m.periodos ?? []) {
      todos.push({ ...p, motoristaResponsavel: p.motoristaResponsavel ?? m.identificacaoMotorista ?? m.nome });
    }
  }
  return todos
    .filter((p) => p.inicio !== undefined)
    .sort((a, b) => (parseIso(a.inicio!)?.getTime() ?? 0) - (parseIso(b.inicio!)?.getTime() ?? 0));
}

// ---------------------------------------------------------------------------
// Múltiplas etapas — consolidação nunca por média simples de velocidade.
// ---------------------------------------------------------------------------

interface ConsolidacaoEtapas {
  distanciaTotalKm?: number;
  tempoDirecaoTotalMinutos?: number;
  velocidadeMediaConsolidadaKmH?: number;
  tempoCargaTotalMinutos: number;
  tempoDescargaTotalMinutos: number;
  tempoEsperaTotalMinutos: number;
  tempoOutrosTotalMinutos: number;
  erros: string[];
}

function consolidarEtapas(etapas: EtapaJornada[]): ConsolidacaoEtapas {
  const erros = detectarConflitosEtapas(etapas, "etapas");
  const distanciaTotalKm = etapas.some((e) => e.distanciaKm !== undefined) ? etapas.reduce((acc, e) => acc + (e.distanciaKm ?? 0), 0) : undefined;
  const tempoDirecaoTotalMinutos = somaDirecaoEtapas(etapas);
  const velocidadeMediaConsolidadaKmH =
    distanciaTotalKm !== undefined && tempoDirecaoTotalMinutos !== undefined && tempoDirecaoTotalMinutos > 0 ? distanciaTotalKm / (tempoDirecaoTotalMinutos / 60) : undefined;

  const tempoCargaTotalMinutos = etapas.reduce((acc, e) => acc + (e.tempoCargaMinutos ?? 0), 0);
  const tempoDescargaTotalMinutos = etapas.reduce((acc, e) => acc + (e.tempoDescargaMinutos ?? 0), 0);
  const tempoEsperaTotalMinutos = etapas.reduce((acc, e) => acc + (e.tempoEsperaMinutos ?? 0), 0);
  const tempoOutrosTotalMinutos = etapas.reduce(
    (acc, e) => acc + (e.tempoAbastecimentoMinutos ?? 0) + (e.tempoFiscalizacaoMinutos ?? 0) + (e.tempoManutencaoMinutos ?? 0) + (e.tempoPausaMinutos ?? 0) + (e.tempoDescansoMinutos ?? 0),
    0
  );

  return { distanciaTotalKm, tempoDirecaoTotalMinutos, velocidadeMediaConsolidadaKmH, tempoCargaTotalMinutos, tempoDescargaTotalMinutos, tempoEsperaTotalMinutos, tempoOutrosTotalMinutos, erros };
}

// ---------------------------------------------------------------------------
// Ranking, comparação de cenários e consolidação de veículos — mesmo padrão
// (ponderado, nunca média simples) já usado por calcular-custo-dia.ts e
// calcular-custo-veiculo-parado.ts.
// ---------------------------------------------------------------------------

function construirRanking(itens: Array<{ id: string; nome: string; valor: number | undefined }>, crescente: boolean): ItemRankingJornada[] {
  const validos = itens.filter((i): i is { id: string; nome: string; valor: number } => i.valor !== undefined);
  const ordenados = [...validos].sort((a, b) => (crescente ? a.valor - b.valor : b.valor - a.valor));
  return ordenados.map((item, idx) => ({ id: item.id, nome: item.nome, valor: item.valor, posicao: idx + 1 }));
}

function paraResultadoCenario(ag: AgregacaoJornada, id: string, nome: string): ResultadoCenarioJornada {
  return {
    sucesso: ag.erro === undefined,
    id,
    nome,
    distanciaTotalKm: ag.distanciaTotalKm,
    tempoDirecaoMinutos: ag.tempoDirecaoMinutos,
    jornadaTotalMinutos: ag.jornadaTotalMinutos,
    duracaoTotalViagemMinutos: ag.duracaoTotalViagemMinutos,
    diasNecessariosInteiros: ag.diasNecessariosInteiros,
    dataHoraChegadaEstimada: ag.dataHoraChegadaEstimada,
    custoJornada: ag.custoJornada,
    receitaTotal: ag.receitaTotal,
    lucroTotal: ag.lucroTotal,
    margemPercentual: ag.margemPercentual,
    tempoEsperaMinutos: ag.tempoEsperaMinutos,
    tempoDescansoMinutos: ag.tempoDescansoMinutos,
    percentualProdutivo: ag.percentualProdutivo,
    statusConformidade: ag.statusConformidade,
    classificacaoOperacional: ag.classificacaoOperacional,
    nivelCompletude: ag.nivelCompletude,
    alertas: ag.alertas,
    premissas: ag.premissas,
    dadosFaltantes: ag.dadosFaltantes,
    mensagemResumo: ag.erro ?? `Duração total: ${ag.duracaoTotalViagemMinutos !== undefined ? formatarNumero(arredondar(ag.duracaoTotalViagemMinutos / 60, 2)) + " h" : "não calculada"}.`,
  };
}

function compararCenarios(entrada: CalcularJornadaEntrada, opts: OpcoesNucleo): { comparacao: ComparacaoCenariosJornada; erro?: string } {
  const cenarios = entrada.cenarios ?? [];
  const resultados: ResultadoCenarioJornada[] = [];

  for (const cenario of cenarios) {
    const id = cenario.id ?? cenario.nome ?? `cenario_${resultados.length + 1}`;
    const nome = cenario.nome ?? id;
    const ag = calcularNucleo(cenario, opts, nome);
    resultados.push(paraResultadoCenario(ag, id, nome));
  }

  const validos = resultados.filter((r) => r.sucesso);
  const alertasGlobais: string[] = [];
  if (validos.length < resultados.length) {
    alertasGlobais.push(`${resultados.length - validos.length} de ${resultados.length} cenário(s) não puderam ser calculados — veja "alertas"/"dadosFaltantes" de cada um.`);
  }

  const comparacao: ComparacaoCenariosJornada = {
    cenarios: resultados,
    rankingPorMenorDuracao: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.duracaoTotalViagemMinutos })), true),
    rankingPorMenorCusto: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoJornada })), true),
    rankingPorMaiorLucro: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.lucroTotal })), false),
    rankingPorMenorEspera: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.tempoEsperaMinutos })), true),
    rankingPorMaiorProdutividade: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.percentualProdutivo })), false),
    rankingPorMelhorConformidade: construirRanking(
      validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.statusConformidade === "CONFORME" ? 2 : r.statusConformidade === "CONFORME_COM_ALERTA" ? 1 : 0 })),
      false
    ),
    alertas: alertasGlobais,
  };
  return { comparacao };
}

function consolidarVeiculos(entrada: CalcularJornadaEntrada, opts: OpcoesNucleo): { consolidado: ResultadoConsolidadoJornada; erro?: string } {
  const veiculos = entrada.veiculos ?? [];
  const resultados: ResultadoCenarioJornada[] = [];

  for (const veiculo of veiculos) {
    const id = veiculo.id ?? veiculo.identificacaoVeiculo ?? veiculo.placa ?? `veiculo_${resultados.length + 1}`;
    const nome = veiculo.identificacaoVeiculo ?? veiculo.placa ?? id;
    const ag = calcularNucleo(veiculo, opts, nome);
    resultados.push(paraResultadoCenario(ag, id, nome));
  }

  const validos = resultados.filter((r) => r.sucesso);
  const distanciaTotalConsolidada = veiculos.some((v) => v.distanciaTotalKm !== undefined) ? veiculos.reduce((acc, v) => acc + (v.distanciaTotalKm ?? 0), 0) : undefined;
  const tempoDirecaoTotal = validos.some((r) => r.tempoDirecaoMinutos !== undefined) ? validos.reduce((acc, r) => acc + (r.tempoDirecaoMinutos ?? 0), 0) : undefined;
  const velocidadeMediaConsolidada =
    distanciaTotalConsolidada !== undefined && tempoDirecaoTotal !== undefined && tempoDirecaoTotal > 0 ? distanciaTotalConsolidada / (tempoDirecaoTotal / 60) : undefined;
  const custoTotalConsolidado = validos.some((r) => r.custoJornada !== undefined) ? validos.reduce((acc, r) => acc + (r.custoJornada ?? 0), 0) : undefined;
  const receitaTotalConsolidada = validos.some((r) => r.receitaTotal !== undefined) ? validos.reduce((acc, r) => acc + (r.receitaTotal ?? 0), 0) : undefined;
  const lucroTotalConsolidado = custoTotalConsolidado !== undefined && receitaTotalConsolidada !== undefined ? receitaTotalConsolidada - custoTotalConsolidado : undefined;
  const margemConsolidadaPercentual = lucroTotalConsolidado !== undefined && receitaTotalConsolidada !== undefined && receitaTotalConsolidada > 0 ? (lucroTotalConsolidado / receitaTotalConsolidada) * 100 : undefined;

  const alertas: string[] = [];
  if (validos.length < resultados.length) alertas.push(`${resultados.length - validos.length} de ${resultados.length} veículo(s) não puderam ser calculados.`);

  const consolidado: ResultadoConsolidadoJornada = {
    quantidadeRegistros: resultados.length,
    distanciaTotalConsolidada: distanciaTotalConsolidada !== undefined ? arredondar(distanciaTotalConsolidada, CASAS_DECIMAIS_KM_PADRAO) : undefined,
    tempoDirecaoTotal,
    jornadaTotalConsolidada: validos.some((r) => r.jornadaTotalMinutos !== undefined) ? validos.reduce((acc, r) => acc + (r.jornadaTotalMinutos ?? 0), 0) : undefined,
    duracaoTotalConsolidada: validos.some((r) => r.duracaoTotalViagemMinutos !== undefined) ? validos.reduce((acc, r) => acc + (r.duracaoTotalViagemMinutos ?? 0), 0) : undefined,
    velocidadeMediaConsolidada: velocidadeMediaConsolidada !== undefined ? arredondar(velocidadeMediaConsolidada, CASAS_DECIMAIS_VELOCIDADE_PADRAO) : undefined,
    custoTotalConsolidado: custoTotalConsolidado !== undefined ? arredondar(custoTotalConsolidado, CASAS_DECIMAIS_MOEDA_PADRAO) : undefined,
    receitaTotalConsolidada: receitaTotalConsolidada !== undefined ? arredondar(receitaTotalConsolidada, CASAS_DECIMAIS_MOEDA_PADRAO) : undefined,
    lucroTotalConsolidado: lucroTotalConsolidado !== undefined ? arredondar(lucroTotalConsolidado, CASAS_DECIMAIS_MOEDA_PADRAO) : undefined,
    margemConsolidadaPercentual: margemConsolidadaPercentual !== undefined ? arredondar(margemConsolidadaPercentual, CASAS_DECIMAIS_PERCENTUAL_PADRAO) : undefined,
    resultadosIndividuais: resultados,
    rankingPorMenorDuracao: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.duracaoTotalViagemMinutos })), true),
    rankingPorMenorCusto: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.custoJornada })), true),
    rankingPorMaiorLucro: construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.lucroTotal })), false),
    alertas,
  };
  return { consolidado };
}

// ---------------------------------------------------------------------------
// Previsto x realizado
// ---------------------------------------------------------------------------

function diferencaJornada(previsto: number | undefined, realizado: number | undefined, casas: number): DiferencaJornada | undefined {
  if (previsto === undefined && realizado === undefined) return undefined;
  const diferenca = previsto !== undefined && realizado !== undefined ? realizado - previsto : undefined;
  const diferencaPercentual = diferenca !== undefined && previsto !== undefined && previsto !== 0 ? (diferenca / Math.abs(previsto)) * 100 : undefined;
  return {
    previsto: previsto !== undefined ? arredondar(previsto, casas) : undefined,
    realizado: realizado !== undefined ? arredondar(realizado, casas) : undefined,
    diferenca: diferenca !== undefined ? arredondar(diferenca, casas) : undefined,
    diferencaPercentual: diferencaPercentual !== undefined ? arredondar(diferencaPercentual, CASAS_DECIMAIS_PERCENTUAL_PADRAO) : undefined,
  };
}

function calcularPrevistoRealizado(entrada: CalcularJornadaEntrada, opts: OpcoesNucleo): { resultado?: PrevistoRealizadoJornada; erro?: string } {
  const previsto = entrada.previsto!;
  const realizado = entrada.realizado!;
  const agPrevisto = calcularNucleo(previsto, opts, "previsto");
  const agRealizado = calcularNucleo(realizado, opts, "realizado");
  if (agPrevisto.erro) return { erro: agPrevisto.erro };
  if (agRealizado.erro) return { erro: agRealizado.erro };

  const duracaoTotalViagemMinutos = diferencaJornada(agPrevisto.duracaoTotalViagemMinutos, agRealizado.duracaoTotalViagemMinutos, 0);
  const tempoDirecaoMinutos = diferencaJornada(agPrevisto.tempoDirecaoMinutos, agRealizado.tempoDirecaoMinutos, 0);
  const tempoEsperaMinutos = diferencaJornada(previsto.tempoEsperaMinutos, realizado.tempoEsperaMinutos, 0);
  const custoEspera = diferencaJornada(agPrevisto.custoEspera, agRealizado.custoEspera, CASAS_DECIMAIS_MOEDA_PADRAO);
  const custoJornada = diferencaJornada(agPrevisto.custoJornada, agRealizado.custoJornada, CASAS_DECIMAIS_MOEDA_PADRAO);
  const receitaTotal = diferencaJornada(agPrevisto.receitaTotal, agRealizado.receitaTotal, CASAS_DECIMAIS_MOEDA_PADRAO);
  const lucroTotal = diferencaJornada(agPrevisto.lucroTotal, agRealizado.lucroTotal, CASAS_DECIMAIS_MOEDA_PADRAO);
  const diasNecessarios = diferencaJornada(agPrevisto.diasNecessariosExatos, agRealizado.diasNecessariosExatos, CASAS_DECIMAIS_DIA_PADRAO);

  let atrasoMinutos: number | undefined;
  if (previsto.dataHoraChegadaDesejada && realizado.dataHoraChegadaReal) {
    atrasoMinutos = diferencaMinutosIso(previsto.dataHoraChegadaDesejada, realizado.dataHoraChegadaReal);
  } else if (duracaoTotalViagemMinutos?.diferenca !== undefined) {
    atrasoMinutos = duracaoTotalViagemMinutos.diferenca;
  }

  const categoriasAcimaDoPrevisto: string[] = [];
  const categoriasAbaixoDoPrevisto: string[] = [];
  const candidatosDesvio: Array<[string, DiferencaJornada | undefined]> = [
    ["Duração total", duracaoTotalViagemMinutos],
    ["Tempo de direção", tempoDirecaoMinutos],
    ["Tempo de espera", tempoEsperaMinutos],
    ["Custo da jornada", custoJornada],
    ["Receita", receitaTotal],
  ];
  for (const [nome, dif] of candidatosDesvio) {
    if (dif?.diferenca === undefined) continue;
    if (dif.diferenca > 0) categoriasAcimaDoPrevisto.push(nome);
    else if (dif.diferenca < 0) categoriasAbaixoDoPrevisto.push(nome);
  }

  let principalDesvio: string | undefined;
  let maiorPercentual = 0;
  for (const [nome, dif] of candidatosDesvio) {
    const pct = Math.abs(dif?.diferencaPercentual ?? 0);
    if (pct > maiorPercentual) {
      maiorPercentual = pct;
      principalDesvio = nome;
    }
  }

  const alertas: string[] = [];
  if (atrasoMinutos !== undefined && atrasoMinutos > 0) alertas.push(`A operação atrasou ${formatarNumero(arredondar(atrasoMinutos, 0))} min em relação ao previsto/desejado.`);
  if (custoJornada?.diferencaPercentual !== undefined && Math.abs(custoJornada.diferencaPercentual) >= 10) {
    alertas.push(`O custo da jornada realizado ficou ${formatarNumero(custoJornada.diferencaPercentual)}% em relação ao previsto.`);
  }

  return {
    resultado: {
      duracaoTotalViagemMinutos,
      tempoDirecaoMinutos,
      tempoEsperaMinutos,
      custoEspera,
      custoJornada,
      receitaTotal,
      lucroTotal,
      diasNecessarios,
      atrasoMinutos: atrasoMinutos !== undefined ? arredondar(atrasoMinutos, 0) : undefined,
      principalDesvio,
      categoriasAcimaDoPrevisto,
      categoriasAbaixoDoPrevisto,
      alertas,
    },
  };
}

function validarEstruturaTopo(entrada: CalcularJornadaEntrada): string[] {
  const erros: string[] = [];

  if (entrada.modo === "COMPARACAO_CENARIOS" && (!entrada.cenarios || entrada.cenarios.length < 2)) {
    erros.push("COMPARACAO_CENARIOS exige ao menos dois cenários em \"cenarios\".");
  }
  if (entrada.modo === "PREVISTO_X_REALIZADO" && (!entrada.previsto || !entrada.realizado)) {
    erros.push('PREVISTO_X_REALIZADO exige os blocos "previsto" e "realizado" completos.');
  }
  if (entrada.modo === "MULTIPLOS_VEICULOS" && (!entrada.veiculos || entrada.veiculos.length === 0)) {
    erros.push('MULTIPLOS_VEICULOS exige ao menos um veículo em "veiculos".');
  }
  if (entrada.modo === "MULTIPLOS_MOTORISTAS" && (!entrada.motoristas || entrada.motoristas.length === 0)) {
    erros.push('MULTIPLOS_MOTORISTAS exige ao menos um motorista em "motoristas".');
  }
  if (entrada.modo === "DOIS_MOTORISTAS" && (!entrada.motoristas || entrada.motoristas.length < 2)) {
    erros.push('DOIS_MOTORISTAS exige ao menos dois motoristas em "motoristas" (distribuição manual — a ferramenta nunca divide a direção automaticamente).');
  }
  if (entrada.modo === "REVEZAMENTO" && (!entrada.periodos || entrada.periodos.length === 0) && (!entrada.motoristas || entrada.motoristas.length === 0)) {
    erros.push('REVEZAMENTO exige turnos informados em "periodos" ou em "motoristas[].periodos".');
  }
  if (entrada.modo === "MULTIPLAS_ETAPAS" && (!entrada.etapas || entrada.etapas.length < 2)) {
    erros.push('MULTIPLAS_ETAPAS exige ao menos duas etapas em "etapas".');
  }
  if (entrada.modo === "CALCULAR_HORARIO_SAIDA" && (!entrada.dataHoraChegadaDesejada || !parseIso(entrada.dataHoraChegadaDesejada))) {
    erros.push('CALCULAR_HORARIO_SAIDA exige "dataHoraChegadaDesejada" válida.');
  }
  if (entrada.modo === "CALCULAR_HORARIO_CHEGADA" && (!entrada.dataHoraSaida || !parseIso(entrada.dataHoraSaida))) {
    erros.push('CALCULAR_HORARIO_CHEGADA exige "dataHoraSaida" válida.');
  }

  const MODOS_QUE_EXIGEM_DESLOCAMENTO: ModoJornada[] = ["CALCULAR_TEMPO_DIRECAO", "CALCULAR_VELOCIDADE_NECESSARIA"];
  if (MODOS_QUE_EXIGEM_DESLOCAMENTO.includes(entrada.modo) && entrada.distanciaTotalKm === 0) {
    erros.push(`O modo "${entrada.modo}" exige uma distância maior que zero — "distanciaTotalKm" foi informado como 0.`);
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Dispatcher principal
// ---------------------------------------------------------------------------

const MODOS_MOTORISTAS: ModoJornada[] = ["UM_MOTORISTA", "DOIS_MOTORISTAS", "MULTIPLOS_MOTORISTAS", "REVEZAMENTO"];

export function calcularJornada(entrada: CalcularJornadaEntrada): CalcularJornadaResultado {
  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) return respostaFalha(entrada, errosTopo.join(" "));

  const opts: OpcoesNucleo = {
    estrategiaSobreposicaoDuracao: entrada.estrategiaSobreposicaoDuracao ?? "REJEITAR_SOBREPOSICAO",
    estrategiaSobreposicaoCusto: entrada.estrategiaSobreposicaoCusto ?? "REJEITAR_SOBREPOSICAO",
    estrategiaSobreposicaoReceita: entrada.estrategiaSobreposicao ?? "REJEITAR_SOBREPOSICAO",
    toleranciaMinutos: entrada.toleranciaMinutos ?? TOLERANCIA_MINUTOS_PADRAO,
    casas: casasDecimaisDe(entrada),
  };

  if (entrada.modo === "COMPARACAO_CENARIOS") {
    const { comparacao } = compararCenarios(entrada, opts);
    const sucesso = comparacao.cenarios.some((c) => c.sucesso);
    return {
      sucesso,
      modo: entrada.modo,
      identificacao: entrada.identificacao,
      descricao: entrada.descricao,
      comparacaoCenarios: comparacao,
      nivelCompletude: sucesso ? "COMPLETO" : "INSUFICIENTE",
      dadosPresentes: [],
      dadosFaltantes: [],
      indicadoresNaoAvaliados: [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: comparacao.alertas,
      premissas: [],
      mensagemResumo: sucesso
        ? `Comparação entre ${comparacao.cenarios.length} cenário(s) concluída. Rankings separados por duração, custo, lucro, espera, produtividade e conformidade — nenhum cenário é escolhido automaticamente como "o melhor".`
        : "Nenhum cenário pôde ser calculado com os dados informados.",
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "MULTIPLOS_VEICULOS") {
    const { consolidado } = consolidarVeiculos(entrada, opts);
    const sucesso = consolidado.resultadosIndividuais.some((r) => r.sucesso);
    return {
      sucesso,
      modo: entrada.modo,
      identificacao: entrada.identificacao,
      descricao: entrada.descricao,
      consolidadoVeiculos: consolidado,
      nivelCompletude: sucesso ? "COMPLETO" : "INSUFICIENTE",
      dadosPresentes: [],
      dadosFaltantes: [],
      indicadoresNaoAvaliados: [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: consolidado.alertas,
      premissas: [],
      mensagemResumo: sucesso
        ? `Consolidação de ${consolidado.quantidadeRegistros} veículo(s): ${
            consolidado.distanciaTotalConsolidada !== undefined ? `${formatarNumero(consolidado.distanciaTotalConsolidada)} km, ` : ""
          }velocidade média consolidada ${
            consolidado.velocidadeMediaConsolidada !== undefined ? `${formatarNumero(consolidado.velocidadeMediaConsolidada)} km/h` : "não calculada"
          } (distância total ÷ direção total, nunca a média simples das velocidades individuais).`
        : "Nenhum veículo pôde ser calculado com os dados informados.",
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "PREVISTO_X_REALIZADO") {
    const { resultado, erro } = calcularPrevistoRealizado(entrada, opts);
    if (erro) return respostaFalha(entrada, erro);
    return {
      sucesso: true,
      modo: entrada.modo,
      identificacao: entrada.identificacao,
      descricao: entrada.descricao,
      previstoRealizado: resultado,
      atrasoMinutos: resultado?.atrasoMinutos,
      diferencaCusto: resultado?.custoJornada?.diferenca,
      diferencaReceita: resultado?.receitaTotal?.diferenca,
      nivelCompletude: "COMPLETO",
      dadosPresentes: [],
      dadosFaltantes: [],
      indicadoresNaoAvaliados: [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: resultado?.alertas ?? [],
      premissas: [],
      mensagemResumo: `Comparação previsto x realizado concluída.${resultado?.principalDesvio ? ` Principal desvio: ${resultado.principalDesvio}.` : ""}`,
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "MULTIPLAS_ETAPAS") {
    const etapas = entrada.etapas ?? [];
    const cons = consolidarEtapas(etapas);
    if (cons.erros.length > 0) return respostaFalha(entrada, cons.erros.join(" "));

    const variante: DadosJornadaVariante = {
      ...entrada,
      etapas: undefined,
      distanciaTotalKm: entrada.distanciaTotalKm ?? cons.distanciaTotalKm,
      tempoDirecaoMinutos: entrada.tempoDirecaoMinutos ?? cons.tempoDirecaoTotalMinutos,
      tempoCargaMinutos: entrada.tempoCargaMinutos ?? cons.tempoCargaTotalMinutos,
      tempoDescargaMinutos: entrada.tempoDescargaMinutos ?? cons.tempoDescargaTotalMinutos,
      tempoEsperaMinutos: entrada.tempoEsperaMinutos ?? cons.tempoEsperaTotalMinutos,
    };
    const ag = calcularNucleo(variante, opts, entrada.identificacao ?? "jornada");
    if (ag.erro) return respostaFalha(entrada, ag.erro, ag.dadosFaltantes);
    const resultado = paraResultadoPrincipal(ag, entrada);
    resultado.velocidadeMediaKmH = cons.velocidadeMediaConsolidadaKmH !== undefined ? arredondar(cons.velocidadeMediaConsolidadaKmH, CASAS_DECIMAIS_VELOCIDADE_PADRAO) : resultado.velocidadeMediaKmH;
    resultado.distanciaTotalKm = cons.distanciaTotalKm;
    resultado.memoriaCalculo.push(
      `Velocidade média consolidada: distância total (${formatarNumero(cons.distanciaTotalKm ?? 0)} km) ÷ tempo de direção total (${formatarNumero(
        (cons.tempoDirecaoTotalMinutos ?? 0) / 60
      )} h) — nunca a média simples das velocidades de cada etapa.`
    );
    return resultado;
  }

  if (MODOS_MOTORISTAS.includes(entrada.modo)) {
    const ag = calcularNucleo(entrada, opts, entrada.identificacao ?? "jornada");
    if (ag.erro) return respostaFalha(entrada, ag.erro, ag.dadosFaltantes);
    const resultado = paraResultadoPrincipal(ag, entrada);

    const motoristas = entrada.motoristas ?? [];
    if (motoristas.length > 0) {
      resultado.jornadaPorMotorista = motoristas.map((m) => calcularResultadoMotorista(m));
      const custosMotoristas = resultado.jornadaPorMotorista.filter((r) => r.custo !== undefined);
      if (custosMotoristas.length === resultado.jornadaPorMotorista.length && custosMotoristas.length > 0 && resultado.custoJornada === undefined) {
        resultado.custoJornada = arredondar(
          custosMotoristas.reduce((acc, r) => acc + (r.custo ?? 0), 0),
          CASAS_DECIMAIS_MOEDA_PADRAO
        );
        resultado.memoriaCalculo.push("Custo da jornada obtido pela soma do custo individual de cada motorista (custoHora × jornada, ou custoDiaria).");
      }
    }
    if (entrada.modo === "REVEZAMENTO") {
      resultado.cronologia = construirCronologia(entrada);
    }
    return resultado;
  }

  const ag = calcularNucleo(entrada, opts, entrada.identificacao ?? "jornada");
  if (ag.erro) return respostaFalha(entrada, ag.erro, ag.dadosFaltantes);

  // Reutiliza analisar-frete.ts (modo ANALISE_SIMPLES) para a viabilidade
  // prazo × custo × receita quando ambos estão disponíveis — sem duplicar
  // aquela lógica de classificação de viabilidade.
  if (ag.receitaTotal !== undefined && ag.custoJornada !== undefined && ag.duracaoTotalViagemMinutos !== undefined) {
    const resultadoFrete = analisarFrete({
      modo: "ANALISE_SIMPLES",
      distanciaIdaKm: entrada.distanciaTotalKm,
      valorFreteTotal: ag.receitaTotal,
      custoTotal: ag.custoJornada,
      diasViagem: ag.diasNecessariosExatos,
    });
    if (resultadoFrete.sucesso) {
      ag.memoriaCalculo.push(
        `Viabilidade prazo × custo × receita (via calcular_analisar_frete, modo ANALISE_SIMPLES): ${resultadoFrete.classificacaoGeral ?? "não classificada"}.`
      );
    }
  }

  return paraResultadoPrincipal(ag, entrada);
}

// ---------------------------------------------------------------------------
// Registro da ferramenta
// ---------------------------------------------------------------------------

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "Modo de cálculo da jornada.",
    valoresPossiveis: [
      "CALCULAR_DURACAO_VIAGEM",
      "CALCULAR_JORNADA_TOTAL",
      "CALCULAR_TEMPO_DIRECAO",
      "CALCULAR_HORARIO_CHEGADA",
      "CALCULAR_HORARIO_SAIDA",
      "CALCULAR_DIAS_NECESSARIOS",
      "CALCULAR_DISTANCIA_POSSIVEL",
      "CALCULAR_VELOCIDADE_NECESSARIA",
      "PLANEJAR_JORNADA",
      "ANALISAR_CONFORMIDADE",
      "ANALISAR_PAUSAS",
      "ANALISAR_DESCANSO",
      "ANALISAR_TEMPO_ESPERA",
      "ANALISAR_CARGA_DESCARGA",
      "CALCULAR_CUSTO_JORNADA",
      "CALCULAR_CUSTO_ESPERA",
      "CALCULAR_RECEITA_HORA",
      "CALCULAR_LUCRO_HORA",
      "UM_MOTORISTA",
      "DOIS_MOTORISTAS",
      "REVEZAMENTO",
      "PREVISTO_X_REALIZADO",
      "MULTIPLAS_ETAPAS",
      "MULTIPLOS_MOTORISTAS",
      "MULTIPLOS_VEICULOS",
      "COMPARACAO_CENARIOS",
    ],
  },
  { nome: "identificacao", tipo: "string", obrigatorio: false, descricao: "Identificação livre da jornada/viagem." },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre." },
  { nome: "origem", tipo: "string", obrigatorio: false, descricao: "Origem (informativo — a distância nunca é calculada automaticamente a partir dela)." },
  { nome: "destino", tipo: "string", obrigatorio: false, descricao: "Destino (informativo)." },
  { nome: "dataHoraSaida", tipo: "string", obrigatorio: false, descricao: "Data/hora de saída, ISO 8601 (ex.: 2026-07-26T08:00:00-03:00)." },
  { nome: "dataHoraChegadaDesejada", tipo: "string", obrigatorio: false, descricao: "Data/hora de chegada desejada, ISO 8601 — usada para calcular o horário de saída necessário." },
  { nome: "dataHoraChegadaReal", tipo: "string", obrigatorio: false, descricao: "Data/hora de chegada realizada, ISO 8601 — usada em PREVISTO_X_REALIZADO." },
  { nome: "fusoHorario", tipo: "string", obrigatorio: false, descricao: "Fuso horário informativo — nunca reinterpreta silenciosamente o offset da data/hora informada." },
  { nome: "distanciaTotalKm", tipo: "number", obrigatorio: false, descricao: "Distância total da viagem, em km." },
  { nome: "distanciaIdaKm", tipo: "number", obrigatorio: false, descricao: "Distância de ida, em km." },
  { nome: "distanciaVoltaKm", tipo: "number", obrigatorio: false, descricao: "Distância de volta, em km." },
  { nome: "velocidadeMediaKmH", tipo: "number", obrigatorio: false, descricao: "Velocidade média informada, em km/h — usada para derivar o tempo de direção quando ele não é informado diretamente." },
  { nome: "velocidadeMaximaOperacionalKmH", tipo: "number", obrigatorio: false, descricao: "Limite operacional de velocidade informado — nunca um limite legal presumido; usado para classificar a programação como incompatível sem recomendar excedê-lo." },
  { nome: "tempoDirecaoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de direção, em minutos — alternativa a distanciaTotalKm + velocidadeMediaKmH." },
  { nome: "tempoTrabalhoSemDirecaoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de trabalho sem direção — se ausente, é derivado da soma de carga+descarga+abastecimento+fiscalização+manutenção." },
  { nome: "tempoCargaMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de carga, em minutos." },
  { nome: "tempoDescargaMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de descarga, em minutos." },
  { nome: "tempoEsperaMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de espera, em minutos." },
  { nome: "tempoAbastecimentoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de abastecimento, em minutos." },
  { nome: "tempoFiscalizacaoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de fiscalização, em minutos." },
  { nome: "tempoManutencaoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de manutenção, em minutos." },
  { nome: "tempoRefeicaoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de refeição, em minutos." },
  { nome: "tempoPausasMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de pausas, em minutos." },
  { nome: "tempoDescansoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de descanso, em minutos — nunca contado como jornada." },
  { nome: "tempoImprevistosMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de imprevistos, em minutos." },
  { nome: "tempoMargemSegurancaMinutos", tipo: "number", obrigatorio: false, descricao: "Margem de segurança, em minutos — soma à duração total, não à jornada." },
  { nome: "etapas", tipo: "string", obrigatorio: false, descricao: "Lista de etapas da viagem (modo MULTIPLAS_ETAPAS, ao menos 2)." },
  { nome: "periodos", tipo: "string", obrigatorio: false, descricao: "Lista de períodos (linha do tempo) — usada em REVEZAMENTO, ANALISAR_PAUSAS, ANALISAR_DESCANSO e na detecção de conflitos." },
  { nome: "quantidadeMotoristas", tipo: "number", obrigatorio: false, descricao: "Quantidade de motoristas." },
  { nome: "quantidadeAjudantes", tipo: "number", obrigatorio: false, descricao: "Quantidade de ajudantes." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos." },
  { nome: "motoristas", tipo: "string", obrigatorio: false, descricao: "Lista de motoristas com seus períodos (UM_MOTORISTA, DOIS_MOTORISTAS, MULTIPLOS_MOTORISTAS, REVEZAMENTO) — a divisão da direção nunca é automática." },
  {
    nome: "estrategiaDistribuicaoMotoristas",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Estratégia de distribuição entre motoristas — padrão NAO_DISTRIBUIR (nunca otimiza escondido).",
    valoresPossiveis: ["MANUAL", "IGUALITARIA", "POR_TURNO", "POR_ETAPA", "OTIMIZAR_DURACAO", "OTIMIZAR_CUSTO", "NAO_DISTRIBUIR"],
  },
  { nome: "horasDisponiveis", tipo: "number", obrigatorio: false, descricao: "Horas de direção disponíveis — usadas em CALCULAR_DISTANCIA_POSSIVEL, CALCULAR_VELOCIDADE_NECESSARIA e na viabilidade por tempo." },
  { nome: "diasDisponiveis", tipo: "number", obrigatorio: false, descricao: "Dias disponíveis para a operação — usados na viabilidade por capacidade." },
  { nome: "horasPorDiaPlanejadas", tipo: "number", obrigatorio: false, descricao: "Capacidade operacional diária planejada, em horas — necessária para CALCULAR_DIAS_NECESSARIOS." },
  { nome: "receitaTotal", tipo: "number", obrigatorio: false, descricao: "Receita total já pronta." },
  { nome: "custoTotal", tipo: "number", obrigatorio: false, descricao: "Custo total da jornada já pronto." },
  { nome: "receitaPorKmInformada", tipo: "number", obrigatorio: false, descricao: "Receita por km, combinada com distanciaTotalKm (via calcular_receita_km) para obter a receita total." },
  { nome: "custoMotoristaHora", tipo: "number", obrigatorio: false, descricao: "Custo do motorista por hora." },
  { nome: "custoAjudanteHora", tipo: "number", obrigatorio: false, descricao: "Custo do ajudante por hora (exige quantidadeAjudantes)." },
  { nome: "custoVeiculoHora", tipo: "number", obrigatorio: false, descricao: "Custo do veículo por hora." },
  { nome: "custoEsperaHora", tipo: "number", obrigatorio: false, descricao: "Custo da espera por hora (via calcular_custo_veiculo_parado)." },
  { nome: "adicionalNoturnoValor", tipo: "number", obrigatorio: false, descricao: "Valor do adicional noturno já calculado." },
  { nome: "horasExtrasValor", tipo: "number", obrigatorio: false, descricao: "Valor das horas extras já calculado." },
  { nome: "despesasAdicionais", tipo: "number", obrigatorio: false, descricao: "Despesas adicionais diversas." },
  { nome: "resumoCustoViagem", tipo: "string", obrigatorio: false, descricao: "Resultado resumido de calcular_custo_viagem, como fonte alternativa de custoTotal." },
  { nome: "regrasConformidade", tipo: "string", obrigatorio: false, descricao: "Lista de regras de conformidade configuráveis e versionadas — sem regras, a conformidade fica NAO_AVALIADA." },
  { nome: "configuracaoJornada", tipo: "string", obrigatorio: false, descricao: "Configura quais categorias (espera, pausas, imprevistos) contam como jornada, e quais são produtivas." },
  { nome: "cenarios", tipo: "string", obrigatorio: false, descricao: "Lista de cenários a comparar (modo COMPARACAO_CENARIOS, ao menos 2)." },
  { nome: "veiculos", tipo: "string", obrigatorio: false, descricao: "Lista de veículos a consolidar (modo MULTIPLOS_VEICULOS)." },
  { nome: "previsto", tipo: "string", obrigatorio: false, descricao: "Bloco de dados previstos (modo PREVISTO_X_REALIZADO)." },
  { nome: "realizado", tipo: "string", obrigatorio: false, descricao: "Bloco de dados realizados (modo PREVISTO_X_REALIZADO)." },
  {
    nome: "estrategiaSobreposicaoDuracao",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Estratégia para tempo de direção informado por mais de uma fonte.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TEMPO_INFORMADO", "PRIORIZAR_DISTANCIA_VELOCIDADE", "PRIORIZAR_ETAPAS", "PRIORIZAR_HORARIOS", "PRIORIZAR_REALIZADO"],
  },
  {
    nome: "estrategiaSobreposicaoCusto",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Estratégia para custo da jornada informado por mais de uma fonte.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_FONTE_VIAGEM", "PRIORIZAR_DETALHADO"],
  },
  {
    nome: "estrategiaSobreposicao",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Estratégia para receita informada por mais de uma fonte (total x por km).",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"],
  },
  { nome: "toleranciaMinutos", tipo: "number", obrigatorio: false, descricao: "Tolerância, em minutos, para não gerar ocorrências de conformidade por pequenas diferenças." },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve todas as casas decimais padrão da saída." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Permite estimativas em pontos específicos do cálculo, sempre com premissa registrada." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaCalcularJornada: DefinicaoFerramenta<CalcularJornadaEntrada, CalcularJornadaResultado> = {
  nome: "calcular_jornada",
  descricao:
    "Planeja, consolida e analisa a jornada operacional de motoristas e veículos: duração da viagem, tempo de direção, jornada de trabalho, horários de saída/chegada, dias necessários, custo/receita/lucro por hora, espera, carga/descarga, um ou dois motoristas, revezamento, previsto x realizado, múltiplas etapas/veículos e comparação de cenários — sempre separando jornada operacional, jornada de trabalho, tempo de direção e conformidade (nunca afirmando conformidade legal sem regra fornecida).",
  objetivo:
    "Responder perguntas como 'quantas horas essa viagem vai levar', 'quantos dias serão necessários', 'que horas devo sair/chegar', 'essa programação cabe na jornada', 'quanto custa a jornada/espera', 'quanto estou lucrando por hora', 'vale a pena colocar dois motoristas' e 'quais dados faltam para a conformidade' — sem nunca inventar distância, velocidade, duração, horários, carga, descarga, espera, pausas, descanso, regras legais, motoristas, custos, receita, margem ou fuso horário.",
  parametros: PARAMETROS,
  executar: calcularJornada,
};
