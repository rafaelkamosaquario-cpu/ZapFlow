import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, EstrategiaSobreposicao, NivelCompletude, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";
import { CASAS_DECIMAIS_DISTANCIA_PADRAO, CASAS_DECIMAIS_PESO_PADRAO } from "./calcular-custo-viagem";
import { calcularMargem, resolverValorOuAliquota } from "./calcular-margem";
import type { CalcularMargemEntrada, ClassificacaoMargem, DadosMargemVariante, ImpactoRetornoVazio, ResumoCustoViagem } from "./calcular-margem";

/**
 * Ferramenta: analisar_frete
 *
 * Ferramenta coordenadora/interpretativa: analisa se um frete ofertado é
 * viável, arriscado, insuficiente ou atrativo, respondendo perguntas como
 * "Este frete compensa?", "Vale a pena pegar esta carga?", "Quanto vai
 * sobrar?", "Preciso de quanto de capital de giro?". Nunca classifica um
 * frete apenas pelo valor bruto — considera distância, custo, receita
 * líquida, margem, retorno vazio, prazo, capital de giro, riscos e nível de
 * completude dos dados.
 *
 * Não reimplementa fórmulas já existentes: delega o núcleo financeiro
 * (receita líquida, deduções, custo total, lucro, margem, markup, ponto de
 * equilíbrio, receita para margem-alvo, receita/custo/lucro por km e por
 * tonelada, impacto do retorno vazio) para `calcular-margem.ts` via
 * `calcularMargem`, reaproveitando inclusive a resolução de sobreposição de
 * custo (custoTotal x categorias detalhadas x `resumoCustoViagem`) e a
 * função `resolverValorOuAliquota` (agora exportada por `calcular-margem.ts`
 * especificamente para este reuso) para a taxa de plataforma. Camadas
 * exclusivas desta ferramenta: dupla representação de distância (ida/volta
 * x carregada/vazia), capital de giro, análise de prazo, classificação de
 * riscos, classificação de viabilidade, comparação de propostas e
 * previsto x realizado com categorias adicionais (distância, capital de
 * giro, prazo).
 *
 * Sem APIs externas nesta fase (sem Google Routes/Maps, ANTT, ANP, pedágio,
 * plataformas de frete, Supabase, telemetria, clima, etc.) — usa apenas os
 * dados recebidos diretamente. Nunca inventa distância, consumo, preço de
 * diesel, pedágio, impostos, comissão, retorno, prazo, peso, valor mínimo,
 * margem ideal ou risco de cliente/carga/rota/documentação.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

const CASAS_DECIMAIS_TONELADA_PADRAO = CASAS_DECIMAIS_PESO_PADRAO;

/**
 * Limites de referência usados na classificação de viabilidade e de riscos.
 * Valores iniciais e configuráveis — não representam um padrão de mercado
 * nem um "ideal" universal; o nível adequado depende do tipo de operação,
 * risco, prazo, cliente e estrutura de custos (sempre reforçado em
 * `limitacoes`). Quando o usuário não informa `margemMinimaPercentual`, a
 * classificação usa apenas estes limites indicativos, deixando claro que
 * não há meta personalizada.
 */
export const LIMITES_CLASSIFICACAO_FRETE = {
  margemAtrativaPercentual: 25,
  percentualKmVazioAtencaoPercentual: 35,
  capitalGiroSobreLucroAtencaoPercentual: 100,
  prazoPagamentoElevadoDias: 45,
};

const LIMITACOES_PADRAO: string[] = [
  "A classificação de viabilidade não é um padrão de mercado nem uma meta universal — depende do tipo de operação, risco, prazo, cliente e estrutura de custos da transportadora.",
  "Esta ferramenta não calcula distância, consumo, pedágio, impostos, comissão ou risco de cliente/carga/rota automaticamente — todos os valores vêm do que foi informado.",
  "Riscos de carga, rota, cliente e documentação só são avaliados quando informados explicitamente; na ausência de dados, ficam marcados como \"não avaliado\" (nunca inferidos do nome da cidade, cliente ou carga).",
  "O lucro e a margem são sempre estimativas quando custos, impostos, comissão ou retorno não foram todos informados; nunca devem ser lidos como resultado contábil definitivo.",
  "A etapa \"prejuízo\" da classificação também cobre o caso de custos conhecidos não cobertos pela receita — não são tratados como categorias separadas.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoAnaliseFrete =
  | "ANALISE_SIMPLES"
  | "ANALISE_COMPLETA"
  | "IDA_E_VOLTA"
  | "RETORNO_VAZIO"
  | "FRETE_COM_RETORNO"
  | "COMPARACAO_PROPOSTAS"
  | "PREVISTO_X_REALIZADO"
  | "ANALISE_POR_KM"
  | "ANALISE_POR_TONELADA"
  | "ANALISE_CAPITAL_GIRO";

const MODOS_RETORNO_VAZIO: ModoAnaliseFrete[] = ["RETORNO_VAZIO"];

/**
 * Estratégia de sobreposição específica para deduções informadas como valor
 * fixo E percentual (ex.: taxa de plataforma). Rótulos próprios (diferentes
 * de `EstrategiaSobreposicao`, usada para fontes de custo/receita/distância)
 * porque aqui a escolha é entre "valor fixo" e "percentual", não entre
 * "total" e "detalhado".
 */
export type EstrategiaSobreposicaoDeducao = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_VALOR_FIXO" | "PRIORIZAR_PERCENTUAL";

function paraEstrategiaCusto(estrategia: EstrategiaSobreposicaoDeducao): EstrategiaSobreposicao {
  if (estrategia === "PRIORIZAR_VALOR_FIXO") return "PRIORIZAR_TOTAL";
  if (estrategia === "PRIORIZAR_PERCENTUAL") return "PRIORIZAR_DETALHADO";
  return "REJEITAR_SOBREPOSICAO";
}

export interface CustosAntecipadosFrete {
  combustivel?: number;
  pedagio?: number;
  alimentacao?: number;
  hospedagem?: number;
  diaria?: number;
  cargaDescarga?: number;
  outros?: number;
}

export type NivelRiscoFrete = "BAIXO" | "MODERADO" | "ALTO" | "CRITICO" | "NAO_AVALIADO";

/**
 * Conjunto completo de dados de um frete — usado tanto para a entrada
 * principal quanto para cada proposta em COMPARACAO_PROPOSTAS e para os
 * blocos `previsto`/`realizado` em PREVISTO_X_REALIZADO.
 */
export interface DadosFreteVariante {
  descricaoFrete?: string;
  identificacaoFrete?: string;
  origem?: string;
  destino?: string;
  tipoCarga?: string;
  pesoCargaToneladas?: number;
  quantidadeCarga?: number;
  unidadeCarga?: string;

  distanciaIdaKm?: number;
  distanciaVoltaKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  distanciaAdicionalKm?: number;

  receitaFreteIda?: number;
  receitaFreteVolta?: number;
  receitaAdicional?: number;
  valorFreteTotal?: number;

  descontos?: number;
  impostos?: number;
  aliquotaImpostosPercentual?: number;
  comissao?: number;
  aliquotaComissaoPercentual?: number;
  taxaPlataforma?: number;
  aliquotaTaxaPlataformaPercentual?: number;
  seguroCarga?: number;
  gerenciamentoRisco?: number;
  outrasDeducoesInformadas?: number;

  /** Alternativa 1: custo já pronto. */
  custoTotal?: number;
  /** Alternativa 2: categorias detalhadas (mesmos nomes de `calcular-margem.ts`, reaproveitados diretamente). */
  custosVariaveis?: number;
  custosFixosRateados?: number;
  custosDiretos?: number;
  custosIndiretos?: number;
  custoViagem?: number;
  custoRetorno?: number;
  custoAdministrativo?: number;
  outrosCustos?: number;
  /** Alternativa 3: resultado resumido de `calcular-custo-viagem.ts`. */
  resumoCustoViagem?: ResumoCustoViagem;
  /** Alternativa 4: CPK total (R$/km), combinado com a distância total para derivar o custo total. */
  cpkTotalReaisPorKm?: number;
  /** Alternativa 4b: resultado (ou resumo) de `calcular-cpk.ts` — usa apenas `cpk`. */
  resumoCpk?: { cpk?: number };

  adiantamento?: number;
  saldoReceber?: number;
  prazoPagamentoDias?: number;
  /** Necessário apenas quando `adiantamento` > receita bruta — nunca presumido. */
  justificativaAdiantamentoSuperiorAoFrete?: string;

  custosAntecipados?: CustosAntecipadosFrete;
  /** Só é usado para retorno sobre capital quando informado explicitamente — nunca derivado do capital de giro. */
  capitalProprioEmpregado?: number;

  margemMinimaPercentual?: number;
  markupAlvoPercentual?: number;

  quantidadeVeiculos?: number;
  quantidadeMotoristas?: number;
  diasViagem?: number;
  horasViagem?: number;

  /** Riscos de carga/rota/cliente/documentação: só entram na análise quando informados explicitamente. */
  riscoCargaNivel?: NivelRiscoFrete;
  riscoCargaDescricao?: string;
  riscoRotaNivel?: NivelRiscoFrete;
  riscoRotaDescricao?: string;
  riscoClienteNivel?: NivelRiscoFrete;
  riscoClienteDescricao?: string;
  riscoDocumentacaoNivel?: NivelRiscoFrete;
  riscoDocumentacaoDescricao?: string;
}

export interface PropostaFrete extends DadosFreteVariante {
  id?: string;
  nome?: string;
}

export interface AnalisarFreteEntrada extends DadosFreteVariante {
  modo: ModoAnaliseFrete;

  /** Usado apenas em COMPARACAO_PROPOSTAS — ao menos 2 propostas. */
  propostas?: PropostaFrete[];
  /** Usados apenas em PREVISTO_X_REALIZADO. */
  previsto?: DadosFreteVariante;
  realizado?: DadosFreteVariante;

  estrategiaSobreposicaoReceita?: EstrategiaSobreposicao;
  estrategiaSobreposicaoCusto?: EstrategiaSobreposicao;
  estrategiaSobreposicaoDistancia?: EstrategiaSobreposicao;
  estrategiaSobreposicaoDeducao?: EstrategiaSobreposicaoDeducao;

  casasDecimais?: number;
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type ClassificacaoViabilidadeFrete =
  | "DADOS_INSUFICIENTES"
  | "INVIAVEL"
  | "ALTO_RISCO"
  | "MARGEM_INSUFICIENTE"
  | "VIAVEL_COM_RESSALVAS"
  | "VIAVEL"
  | "ATRATIVO";

export type CategoriaRiscoFrete =
  | "FINANCEIRO"
  | "OPERACIONAL"
  | "DADOS_INCOMPLETOS"
  | "RETORNO_VAZIO"
  | "PRAZO_PAGAMENTO"
  | "MARGEM_BAIXA"
  | "PREJUIZO"
  | "CAPITAL_GIRO"
  | "CARGA"
  | "ROTA"
  | "CLIENTE"
  | "DOCUMENTACAO"
  | "OUTRO";

export interface RiscoFrete {
  categoria: CategoriaRiscoFrete;
  nivel: NivelRiscoFrete;
  descricao: string;
  evidencia?: string;
  impactoPotencial?: string;
  acaoRecomendada?: string;
  origemInformacao: string;
}

export interface ResultadoIndividualFrete extends ResultadoFerramentaBase {
  identificacao?: string;
  descricao?: string;
  origem?: string;
  destino?: string;

  receitaBruta?: number;
  deducoes?: number;
  receitaLiquida?: number;
  custoTotal?: number;
  lucro?: number;
  margemPercentual?: number;
  markupPercentual?: number;

  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  percentualKmVazio?: number;

  receitaPorKmTotal?: number;
  receitaPorKmCarregado?: number;
  custoPorKm?: number;
  lucroPorKm?: number;

  receitaPorTonelada?: number;
  custoPorTonelada?: number;
  lucroPorTonelada?: number;
  lucroPorVeiculo?: number;

  custoRetorno?: number;
  impactoRetornoVazio?: ImpactoRetornoVazio;

  adiantamento?: number;
  saldoReceber?: number;
  capitalGiroNecessario?: number;
  saldoOperacional?: number;
  prazoPagamentoDias?: number;
  margemMinima?: number;
  retornoSobreCapitalPercentual?: number;

  valorAdicionalEquilibrio?: number;
  valorAdicionalMargemAlvo?: number;

  riscos: RiscoFrete[];
  classificacao?: ClassificacaoViabilidadeFrete;
  nivelCompletude: NivelCompletude;

  custosIncluidos: string[];
  custosIgnorados: string[];
  limitacoes: string[];
  memoriaCalculo: string[];
}

export interface ItemRankingFrete {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface RankingPropostas {
  porLucro: ItemRankingFrete[];
  porMargem: ItemRankingFrete[];
  porLucroPorKm: ItemRankingFrete[];
  porReceitaPorKm: ItemRankingFrete[];
  porMenorCapitalGiro: ItemRankingFrete[];
  porMenorExposicaoRetornoVazio: ItemRankingFrete[];
  porMenorRisco: ItemRankingFrete[];
  porResultadoGeral: ItemRankingFrete[];
  alertas: string[];
}

interface DiferencaPrevistoRealizado {
  previsto?: number;
  realizado?: number;
  diferencaAbsoluta?: number;
  diferencaPercentual?: number;
}

export interface PrevistoRealizadoFrete {
  receita?: DiferencaPrevistoRealizado;
  custo?: DiferencaPrevistoRealizado;
  distancia?: DiferencaPrevistoRealizado;
  lucro?: DiferencaPrevistoRealizado;
  margemPercentual?: DiferencaPrevistoRealizado;
  capitalGiro?: DiferencaPrevistoRealizado;
  prazoPagamentoDias?: DiferencaPrevistoRealizado;
  principalDesvio?: string;
  categoriasAcimaDoPrevisto: string[];
  categoriasAbaixoDoPrevisto: string[];
  impactoNaMargem?: string;
  alertas: string[];
}

export interface AnalisarFreteResultado extends ResultadoFerramentaBase {
  modo: ModoAnaliseFrete;

  freteAnalisado?: ResultadoIndividualFrete;
  propostasAnalisadas?: ResultadoIndividualFrete[];
  ranking?: RankingPropostas;
  melhorProposta?: string;
  piorProposta?: string;
  criterioPrincipal?: string;

  previstoRealizado?: PrevistoRealizadoFrete;

  classificacaoGeral?: ClassificacaoViabilidadeFrete;
  nivelCompletude: NivelCompletude;
  riscosGerais: RiscoFrete[];
  limitacoes: string[];
  memoriaCalculo: string[];
}

// ---------------------------------------------------------------------------
// Casas decimais
// ---------------------------------------------------------------------------

interface CasasDecimais {
  moeda: number;
  percentual: number;
  custoPorKm: number;
  tonelada: number;
  distancia: number;
}

function casasDecimaisDe(entrada: AnalisarFreteEntrada): CasasDecimais {
  const override = entrada.casasDecimais;
  return {
    moeda: override ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    percentual: override ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    custoPorKm: override ?? CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO,
    tonelada: override ?? CASAS_DECIMAIS_TONELADA_PADRAO,
    distancia: override ?? CASAS_DECIMAIS_DISTANCIA_PADRAO,
  };
}

function dividirSeguro(valor: number | undefined, divisor: number | undefined, casas: number): number | undefined {
  if (valor === undefined || divisor === undefined || divisor <= 0) return undefined;
  return arredondar(valor / divisor, casas);
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const CAMPOS_CUSTO_DETALHADO_FRETE: Array<keyof DadosFreteVariante> = [
  "custosVariaveis",
  "custosFixosRateados",
  "custosDiretos",
  "custosIndiretos",
  "custoViagem",
  "custoRetorno",
  "custoAdministrativo",
  "outrosCustos",
];

function coletarCamposNumericos(v: DadosFreteVariante, rotulo: string): Array<[string, number | undefined]> {
  return [
    [`${rotulo}.pesoCargaToneladas`, v.pesoCargaToneladas],
    [`${rotulo}.quantidadeCarga`, v.quantidadeCarga],
    [`${rotulo}.distanciaIdaKm`, v.distanciaIdaKm],
    [`${rotulo}.distanciaVoltaKm`, v.distanciaVoltaKm],
    [`${rotulo}.distanciaCarregadaKm`, v.distanciaCarregadaKm],
    [`${rotulo}.distanciaVaziaKm`, v.distanciaVaziaKm],
    [`${rotulo}.distanciaAdicionalKm`, v.distanciaAdicionalKm],
    [`${rotulo}.receitaFreteIda`, v.receitaFreteIda],
    [`${rotulo}.receitaFreteVolta`, v.receitaFreteVolta],
    [`${rotulo}.receitaAdicional`, v.receitaAdicional],
    [`${rotulo}.valorFreteTotal`, v.valorFreteTotal],
    [`${rotulo}.descontos`, v.descontos],
    [`${rotulo}.impostos`, v.impostos],
    [`${rotulo}.comissao`, v.comissao],
    [`${rotulo}.taxaPlataforma`, v.taxaPlataforma],
    [`${rotulo}.seguroCarga`, v.seguroCarga],
    [`${rotulo}.gerenciamentoRisco`, v.gerenciamentoRisco],
    [`${rotulo}.outrasDeducoesInformadas`, v.outrasDeducoesInformadas],
    [`${rotulo}.custoTotal`, v.custoTotal],
    [`${rotulo}.custosVariaveis`, v.custosVariaveis],
    [`${rotulo}.custosFixosRateados`, v.custosFixosRateados],
    [`${rotulo}.custosDiretos`, v.custosDiretos],
    [`${rotulo}.custosIndiretos`, v.custosIndiretos],
    [`${rotulo}.custoViagem`, v.custoViagem],
    [`${rotulo}.custoRetorno`, v.custoRetorno],
    [`${rotulo}.custoAdministrativo`, v.custoAdministrativo],
    [`${rotulo}.outrosCustos`, v.outrosCustos],
    [`${rotulo}.cpkTotalReaisPorKm`, v.cpkTotalReaisPorKm],
    [`${rotulo}.adiantamento`, v.adiantamento],
    [`${rotulo}.saldoReceber`, v.saldoReceber],
    [`${rotulo}.prazoPagamentoDias`, v.prazoPagamentoDias],
    [`${rotulo}.capitalProprioEmpregado`, v.capitalProprioEmpregado],
    [`${rotulo}.quantidadeVeiculos`, v.quantidadeVeiculos],
    [`${rotulo}.quantidadeMotoristas`, v.quantidadeMotoristas],
    [`${rotulo}.diasViagem`, v.diasViagem],
    [`${rotulo}.horasViagem`, v.horasViagem],
    [`${rotulo}.custosAntecipados.combustivel`, v.custosAntecipados?.combustivel],
    [`${rotulo}.custosAntecipados.pedagio`, v.custosAntecipados?.pedagio],
    [`${rotulo}.custosAntecipados.alimentacao`, v.custosAntecipados?.alimentacao],
    [`${rotulo}.custosAntecipados.hospedagem`, v.custosAntecipados?.hospedagem],
    [`${rotulo}.custosAntecipados.diaria`, v.custosAntecipados?.diaria],
    [`${rotulo}.custosAntecipados.cargaDescarga`, v.custosAntecipados?.cargaDescarga],
    [`${rotulo}.custosAntecipados.outros`, v.custosAntecipados?.outros],
  ];
}

function validarVariante(v: DadosFreteVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) {
      erros.push(`O campo "${campo}" não pode ser negativo.`);
    }
  }

  for (const [campo, valor] of [
    [`${rotulo}.aliquotaImpostosPercentual`, v.aliquotaImpostosPercentual],
    [`${rotulo}.aliquotaComissaoPercentual`, v.aliquotaComissaoPercentual],
    [`${rotulo}.aliquotaTaxaPlataformaPercentual`, v.aliquotaTaxaPlataformaPercentual],
    [`${rotulo}.margemMinimaPercentual`, v.margemMinimaPercentual],
    [`${rotulo}.markupAlvoPercentual`, v.markupAlvoPercentual],
  ] as Array<[string, number | undefined]>) {
    if (valor !== undefined && (valor < 0 || valor > 100)) {
      erros.push(`"${campo}" deve estar entre 0 e 100.`);
    }
  }

  if (v.distanciaIdaKm === 0 && v.distanciaVoltaKm === undefined) erros.push(`${rotulo}: a distância não pode ser igual a zero.`);
  if (v.distanciaCarregadaKm === 0 && v.distanciaVaziaKm === undefined) erros.push(`${rotulo}: a distância carregada não pode ser igual a zero.`);

  if (v.valorFreteTotal === 0 && v.receitaFreteIda === undefined) {
    erros.push(`${rotulo}: a receita do frete não pode ser igual a zero.`);
  }

  if (v.adiantamento !== undefined) {
    const receitaConhecida = v.valorFreteTotal ?? (v.receitaFreteIda !== undefined ? v.receitaFreteIda + (v.receitaFreteVolta ?? 0) : undefined);
    if (receitaConhecida !== undefined && v.adiantamento > receitaConhecida && !v.justificativaAdiantamentoSuperiorAoFrete) {
      erros.push(
        `${rotulo}: o adiantamento (${formatarBRL(v.adiantamento)}) é maior que o valor do frete (${formatarBRL(
          receitaConhecida
        )}). Informe "justificativaAdiantamentoSuperiorAoFrete" se isso for esperado (ex.: frete com múltiplas cargas).`
      );
    }
    if (
      receitaConhecida !== undefined &&
      v.saldoReceber !== undefined &&
      Math.abs(v.adiantamento + v.saldoReceber - receitaConhecida) > 0.01
    ) {
      erros.push(
        `${rotulo}: adiantamento (${formatarBRL(v.adiantamento)}) + saldo a receber (${formatarBRL(
          v.saldoReceber
        )}) não é coerente com o valor do frete (${formatarBRL(receitaConhecida)}).`
      );
    }
  }

  return erros;
}

function validarEstruturaTopo(entrada: AnalisarFreteEntrada): string[] {
  const erros: string[] = [];
  if (entrada.modo === "COMPARACAO_PROPOSTAS" && (!entrada.propostas || entrada.propostas.length < 2)) {
    erros.push("COMPARACAO_PROPOSTAS exige ao menos duas propostas em \"propostas\".");
  }
  if (entrada.modo === "PREVISTO_X_REALIZADO" && (!entrada.previsto || !entrada.realizado)) {
    erros.push('PREVISTO_X_REALIZADO exige os blocos "previsto" e "realizado" completos.');
  }
  return erros;
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — receita
// ---------------------------------------------------------------------------

interface ReceitaResolvida {
  receitaFreteIda?: number;
  receitaFreteVolta?: number;
  alertas: string[];
  erro?: string;
}

function resolverReceita(v: DadosFreteVariante, estrategia: EstrategiaSobreposicao, rotulo: string): ReceitaResolvida {
  const temTotal = v.valorFreteTotal !== undefined;
  const temDetalhado = v.receitaFreteIda !== undefined || v.receitaFreteVolta !== undefined;
  const alertas: string[] = [];

  if (temTotal && temDetalhado) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return {
        alertas: [],
        erro: `${rotulo}: receita informada como "valorFreteTotal" e também como "receitaFreteIda"/"receitaFreteVolta". Informe apenas uma forma, ou defina "estrategiaSobreposicaoReceita".`,
      };
    }
    if (estrategia === "PRIORIZAR_TOTAL") {
      alertas.push(`${rotulo}: sobreposição de receita resolvida por "PRIORIZAR_TOTAL" — usado valorFreteTotal, ignorada a receita detalhada por trecho.`);
      return { receitaFreteIda: v.valorFreteTotal, receitaFreteVolta: undefined, alertas };
    }
    alertas.push(`${rotulo}: sobreposição de receita resolvida por "PRIORIZAR_DETALHADO" — usada a receita por trecho, ignorado valorFreteTotal.`);
    return { receitaFreteIda: v.receitaFreteIda, receitaFreteVolta: v.receitaFreteVolta, alertas };
  }

  if (temTotal) return { receitaFreteIda: v.valorFreteTotal, receitaFreteVolta: undefined, alertas };
  if (temDetalhado) return { receitaFreteIda: v.receitaFreteIda, receitaFreteVolta: v.receitaFreteVolta, alertas };
  return { alertas };
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — distância (ida/volta+adicional x carregada/vazia)
// ---------------------------------------------------------------------------

interface DistanciaResolvida {
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  alertas: string[];
  premissas: string[];
  erro?: string;
}

function resolverDistancia(v: DadosFreteVariante, modo: ModoAnaliseFrete, estrategia: EstrategiaSobreposicao, rotulo: string): DistanciaResolvida {
  const temIdaVolta = v.distanciaIdaKm !== undefined || v.distanciaVoltaKm !== undefined || v.distanciaAdicionalKm !== undefined;
  const temCarregadaVazia = v.distanciaCarregadaKm !== undefined || v.distanciaVaziaKm !== undefined;
  const alertas: string[] = [];
  const premissas: string[] = [];

  if (temIdaVolta && temCarregadaVazia) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return {
        alertas: [],
        premissas: [],
        erro: `${rotulo}: distância informada como ida/volta/adicional e também como carregada/vazia. Informe apenas uma forma, ou defina "estrategiaSobreposicaoDistancia".`,
      };
    }
    if (estrategia === "PRIORIZAR_TOTAL") {
      alertas.push(`${rotulo}: sobreposição de distância resolvida por "PRIORIZAR_TOTAL" — usada ida/volta/adicional, ignorada carregada/vazia.`);
      const total = (v.distanciaIdaKm ?? 0) + (v.distanciaVoltaKm ?? 0) + (v.distanciaAdicionalKm ?? 0);
      return { distanciaTotalKm: total, alertas, premissas };
    }
    alertas.push(`${rotulo}: sobreposição de distância resolvida por "PRIORIZAR_DETALHADO" — usada carregada/vazia, ignorado ida/volta/adicional.`);
    const total = (v.distanciaCarregadaKm ?? 0) + (v.distanciaVaziaKm ?? 0);
    return { distanciaTotalKm: total, distanciaCarregadaKm: v.distanciaCarregadaKm, distanciaVaziaKm: v.distanciaVaziaKm, alertas, premissas };
  }

  if (temCarregadaVazia) {
    const total = (v.distanciaCarregadaKm ?? 0) + (v.distanciaVaziaKm ?? 0);
    return { distanciaTotalKm: total, distanciaCarregadaKm: v.distanciaCarregadaKm, distanciaVaziaKm: v.distanciaVaziaKm, alertas, premissas };
  }

  if (temIdaVolta) {
    const total = (v.distanciaIdaKm ?? 0) + (v.distanciaVoltaKm ?? 0) + (v.distanciaAdicionalKm ?? 0);
    if (MODOS_RETORNO_VAZIO.includes(modo) && v.distanciaIdaKm !== undefined && v.distanciaVoltaKm !== undefined) {
      premissas.push(
        `${rotulo}: no modo RETORNO_VAZIO, a distância carregada foi assumida como a distância de ida (${formatarNumero(
          v.distanciaIdaKm
        )} km) e a distância vazia como a distância de volta (${formatarNumero(v.distanciaVoltaKm)} km), por não terem sido informadas separadamente.`
      );
      return { distanciaTotalKm: total, distanciaCarregadaKm: v.distanciaIdaKm, distanciaVaziaKm: v.distanciaVoltaKm, alertas, premissas };
    }
    return { distanciaTotalKm: total, alertas, premissas };
  }

  return { alertas, premissas };
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — custo (CPK/custo-por-km x demais fontes)
// ---------------------------------------------------------------------------

interface CustoBaseResolvido {
  custoTotal?: number;
  premissas: string[];
  erro?: string;
}

function resolverCustoBaseCpk(v: DadosFreteVariante, distanciaTotalKm: number | undefined, estrategia: EstrategiaSobreposicao, rotulo: string): CustoBaseResolvido {
  const cpkInformado = v.cpkTotalReaisPorKm ?? v.resumoCpk?.cpk;
  if (cpkInformado === undefined) return { premissas: [] };

  const temTotal = v.custoTotal !== undefined;
  const temResumo = v.resumoCustoViagem?.custoTotal !== undefined;
  const temDetalhado = CAMPOS_CUSTO_DETALHADO_FRETE.some((campo) => v[campo] !== undefined);

  if (temTotal || temResumo || temDetalhado) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return { premissas: [], erro: `${rotulo}: custo informado tanto por CPK/custo-por-km quanto por outra fonte de custo. Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".` };
    }
    if (estrategia === "PRIORIZAR_DETALHADO") {
      // A outra fonte (custoTotal/detalhado/resumo) prevalece; o CPK é ignorado aqui.
      return { premissas: [`${rotulo}: sobreposição de custo resolvida por "PRIORIZAR_DETALHADO" — ignorado o CPK/custo-por-km informado.`] };
    }
  }

  if (distanciaTotalKm === undefined || distanciaTotalKm <= 0) {
    return { premissas: [], erro: `${rotulo}: para usar CPK/custo-por-km como fonte de custo, é necessário informar a distância total.` };
  }

  const custoDerivado = cpkInformado * distanciaTotalKm;
  return {
    custoTotal: custoDerivado,
    premissas: [`${rotulo}: custo total derivado do CPK/custo por km informado (${formatarBRL(cpkInformado)}/km) × ${formatarNumero(distanciaTotalKm)} km.`],
  };
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — deduções extras (taxa de plataforma)
// ---------------------------------------------------------------------------

interface DeducoesExtrasResolvidas {
  outrasDeducoes: number;
  alertas: string[];
  premissas: string[];
  erro?: string;
}

function resolverDeducoesExtras(v: DadosFreteVariante, receitaBrutaTotal: number | undefined, estrategiaDeducao: EstrategiaSobreposicaoDeducao, rotulo: string): DeducoesExtrasResolvidas {
  const taxaResolvida = resolverValorOuAliquota(v.taxaPlataforma, v.aliquotaTaxaPlataformaPercentual, receitaBrutaTotal, "taxaPlataforma", paraEstrategiaCusto(estrategiaDeducao));
  if (taxaResolvida.erro) return { outrasDeducoes: 0, alertas: [], premissas: [], erro: `${rotulo}: ${taxaResolvida.erro}` };

  const alertas: string[] = [];
  const premissas: string[] = [];
  if (taxaResolvida.alerta) alertas.push(`${rotulo}: ${taxaResolvida.alerta}`);
  if (taxaResolvida.origem) premissas.push(`${rotulo}: taxa de plataforma calculada com base em ${taxaResolvida.origem}.`);

  const outrasDeducoes = (taxaResolvida.valor ?? 0) + (v.seguroCarga ?? 0) + (v.gerenciamentoRisco ?? 0) + (v.outrasDeducoesInformadas ?? 0);
  return { outrasDeducoes, alertas, premissas };
}

// ---------------------------------------------------------------------------
// Capital de giro
// ---------------------------------------------------------------------------

interface CapitalGiroResolvido {
  desembolsoAntesRecebimento?: number;
  capitalGiroNecessario?: number;
  saldoOperacional?: number;
  itensIncluidos: string[];
}

function calcularCapitalGiro(v: DadosFreteVariante, casas: CasasDecimais): CapitalGiroResolvido {
  const c = v.custosAntecipados;
  if (!c) return { itensIncluidos: [] };

  const itens: Array<[string, number | undefined]> = [
    ["combustível", c.combustivel],
    ["pedágio", c.pedagio],
    ["alimentação", c.alimentacao],
    ["hospedagem", c.hospedagem],
    ["diária", c.diaria],
    ["carga/descarga", c.cargaDescarga],
    ["outros", c.outros],
  ];
  const informados = itens.filter(([, valor]) => valor !== undefined);
  if (informados.length === 0) return { itensIncluidos: [] };

  const desembolso = informados.reduce((soma, [, valor]) => soma + (valor as number), 0);
  const adiantamento = v.adiantamento ?? 0;
  const capitalGiroNecessario = desembolso - adiantamento;
  const saldoOperacional = Math.max(0, capitalGiroNecessario);

  return {
    desembolsoAntesRecebimento: arredondar(desembolso, casas.moeda),
    capitalGiroNecessario: arredondar(capitalGiroNecessario, casas.moeda),
    saldoOperacional: arredondar(saldoOperacional, casas.moeda),
    itensIncluidos: informados.map(([nome]) => nome),
  };
}

// ---------------------------------------------------------------------------
// Núcleo: monta a entrada de calcular-margem.ts e delega o cálculo financeiro
// ---------------------------------------------------------------------------

interface NucleoFreteResultado {
  sucesso: boolean;
  mensagemErro?: string;
  dadosFaltantes: string[];

  receitaBrutaTotal?: number;
  deducoes?: number;
  receitaLiquida?: number;
  custoTotal?: number;
  lucro?: number;
  margemPercentual?: number;
  markupPercentual?: number;

  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  percentualKmVazio?: number;

  receitaPorKmTotal?: number;
  receitaPorKmCarregado?: number;
  custoPorKm?: number;
  lucroPorKm?: number;

  receitaPorTonelada?: number;
  custoPorTonelada?: number;
  lucroPorTonelada?: number;
  lucroPorVeiculo?: number;

  impactoRetornoVazio?: ImpactoRetornoVazio;
  valorAdicionalEquilibrio?: number;
  valorAdicionalMargemAlvo?: number;

  custosIncluidos: string[];
  custosIgnorados: string[];
  alertas: string[];
  premissas: string[];

  classificacaoMargem?: ClassificacaoMargem;
  nivelCompletudeFinanceiro: NivelCompletude;
}

function calcularNucleoFrete(
  v: DadosFreteVariante,
  modo: ModoAnaliseFrete,
  estrategiaReceita: EstrategiaSobreposicao,
  estrategiaCusto: EstrategiaSobreposicao,
  estrategiaDistancia: EstrategiaSobreposicao,
  estrategiaDeducao: EstrategiaSobreposicaoDeducao,
  casas: CasasDecimais,
  rotulo: string
): NucleoFreteResultado {
  const alertasPrevios: string[] = [];
  const premissasPrevias: string[] = [];

  const receitaResolvida = resolverReceita(v, estrategiaReceita, rotulo);
  if (receitaResolvida.erro) {
    return { sucesso: false, mensagemErro: receitaResolvida.erro, dadosFaltantes: [], custosIncluidos: [], custosIgnorados: [], alertas: [], premissas: [], nivelCompletudeFinanceiro: "INSUFICIENTE" };
  }
  alertasPrevios.push(...receitaResolvida.alertas);

  const distanciaResolvida = resolverDistancia(v, modo, estrategiaDistancia, rotulo);
  if (distanciaResolvida.erro) {
    return { sucesso: false, mensagemErro: distanciaResolvida.erro, dadosFaltantes: [], custosIncluidos: [], custosIgnorados: [], alertas: [], premissas: [], nivelCompletudeFinanceiro: "INSUFICIENTE" };
  }
  if (distanciaResolvida.distanciaTotalKm === 0) {
    return { sucesso: false, mensagemErro: `${rotulo}: a distância total não pode ser igual a zero.`, dadosFaltantes: [], custosIncluidos: [], custosIgnorados: [], alertas: [], premissas: [], nivelCompletudeFinanceiro: "INSUFICIENTE" };
  }
  alertasPrevios.push(...distanciaResolvida.alertas);
  premissasPrevias.push(...distanciaResolvida.premissas);

  const receitaBrutaEstimada =
    receitaResolvida.receitaFreteIda !== undefined ? receitaResolvida.receitaFreteIda + (receitaResolvida.receitaFreteVolta ?? 0) + (v.receitaAdicional ?? 0) : undefined;

  const custoBaseCpk = resolverCustoBaseCpk(v, distanciaResolvida.distanciaTotalKm, estrategiaCusto, rotulo);
  if (custoBaseCpk.erro) {
    return { sucesso: false, mensagemErro: custoBaseCpk.erro, dadosFaltantes: [], custosIncluidos: [], custosIgnorados: [], alertas: [], premissas: [], nivelCompletudeFinanceiro: "INSUFICIENTE" };
  }
  premissasPrevias.push(...custoBaseCpk.premissas);

  const deducoesExtras = resolverDeducoesExtras(v, receitaBrutaEstimada, estrategiaDeducao, rotulo);
  if (deducoesExtras.erro) {
    return { sucesso: false, mensagemErro: deducoesExtras.erro, dadosFaltantes: [], custosIncluidos: [], custosIgnorados: [], alertas: [], premissas: [], nivelCompletudeFinanceiro: "INSUFICIENTE" };
  }
  alertasPrevios.push(...deducoesExtras.alertas);
  premissasPrevias.push(...deducoesExtras.premissas);

  const dadosMargem: DadosMargemVariante = {
    receitaBruta: receitaResolvida.receitaFreteIda,
    receitaAdicional: (receitaResolvida.receitaFreteVolta ?? 0) + (v.receitaAdicional ?? 0),
    descontos: v.descontos,
    impostos: v.impostos,
    aliquotaImpostosPercentual: v.aliquotaImpostosPercentual,
    comissoes: v.comissao,
    aliquotaComissaoPercentual: v.aliquotaComissaoPercentual,
    outrasDeducoes: deducoesExtras.outrasDeducoes > 0 ? deducoesExtras.outrasDeducoes : undefined,
    custoTotal: custoBaseCpk.custoTotal ?? v.custoTotal,
    custosVariaveis: v.custosVariaveis,
    custosFixosRateados: v.custosFixosRateados,
    custosDiretos: v.custosDiretos,
    custosIndiretos: v.custosIndiretos,
    custoViagem: v.custoViagem,
    custoRetorno: v.custoRetorno,
    custoAdministrativo: v.custoAdministrativo,
    outrosCustos: v.outrosCustos,
    resumoCustoViagem: v.resumoCustoViagem,
    receitaIda: v.receitaFreteIda,
    receitaRetorno: v.receitaFreteVolta,
    quilometragemTotal: distanciaResolvida.distanciaTotalKm,
    pesoCargaToneladas: v.pesoCargaToneladas,
    quantidadeVeiculos: v.quantidadeVeiculos,
    margemAlvoPercentual: v.margemMinimaPercentual,
    markupAlvoPercentual: v.markupAlvoPercentual,
  };

  const entradaMargem: CalcularMargemEntrada = {
    modo: "MARGEM_SIMPLES",
    descricao: v.descricaoFrete,
    casasDecimais: casas.moeda !== CASAS_DECIMAIS_MOEDA_PADRAO ? casas.moeda : undefined,
    estrategiaSobreposicao: estrategiaCusto,
    ...dadosMargem,
  };

  const resultadoMargem = calcularMargem(entradaMargem);

  if (!resultadoMargem.sucesso) {
    return {
      sucesso: false,
      mensagemErro: resultadoMargem.mensagemResumo,
      dadosFaltantes: resultadoMargem.dadosFaltantes,
      custosIncluidos: [],
      custosIgnorados: [],
      alertas: alertasPrevios,
      premissas: premissasPrevias,
      nivelCompletudeFinanceiro: "INSUFICIENTE",
    };
  }

  const receitaPorKmCarregado = dividirSeguro(resultadoMargem.receitaLiquida, distanciaResolvida.distanciaCarregadaKm, casas.custoPorKm);
  const percentualKmVazio =
    distanciaResolvida.distanciaVaziaKm !== undefined && distanciaResolvida.distanciaTotalKm
      ? arredondar((distanciaResolvida.distanciaVaziaKm / distanciaResolvida.distanciaTotalKm) * 100, casas.percentual)
      : undefined;

  return {
    sucesso: true,
    dadosFaltantes: [],
    receitaBrutaTotal: resultadoMargem.receitaBrutaTotal,
    deducoes:
      resultadoMargem.receitaBrutaTotal !== undefined && resultadoMargem.receitaLiquida !== undefined
        ? arredondar(resultadoMargem.receitaBrutaTotal - resultadoMargem.receitaLiquida, casas.moeda)
        : undefined,
    receitaLiquida: resultadoMargem.receitaLiquida,
    custoTotal: resultadoMargem.custoTotalFinal,
    lucro: resultadoMargem.lucroLiquidoEstimado,
    margemPercentual: resultadoMargem.margemLiquidaPercentual,
    markupPercentual: resultadoMargem.markupPercentual,
    distanciaTotalKm: distanciaResolvida.distanciaTotalKm !== undefined ? arredondar(distanciaResolvida.distanciaTotalKm, casas.distancia) : undefined,
    distanciaCarregadaKm: distanciaResolvida.distanciaCarregadaKm !== undefined ? arredondar(distanciaResolvida.distanciaCarregadaKm, casas.distancia) : undefined,
    distanciaVaziaKm: distanciaResolvida.distanciaVaziaKm !== undefined ? arredondar(distanciaResolvida.distanciaVaziaKm, casas.distancia) : undefined,
    percentualKmVazio,
    receitaPorKmTotal: resultadoMargem.receitaPorKm,
    receitaPorKmCarregado,
    custoPorKm: resultadoMargem.custoPorKm,
    lucroPorKm: resultadoMargem.lucroPorKm,
    receitaPorTonelada: resultadoMargem.receitaPorTonelada,
    custoPorTonelada: resultadoMargem.custoPorTonelada,
    lucroPorTonelada: resultadoMargem.lucroPorTonelada,
    lucroPorVeiculo: resultadoMargem.lucroPorVeiculo,
    impactoRetornoVazio: resultadoMargem.impactoRetornoVazio,
    valorAdicionalEquilibrio: resultadoMargem.valorAdicionalParaEquilibrio,
    valorAdicionalMargemAlvo: resultadoMargem.valorAdicionalParaMargemAlvo,
    custosIncluidos: resultadoMargem.custosIncluidos,
    custosIgnorados: resultadoMargem.custosIgnorados,
    alertas: [...alertasPrevios, ...resultadoMargem.alertas],
    premissas: [...premissasPrevias, ...resultadoMargem.premissas],
    classificacaoMargem: resultadoMargem.classificacao,
    nivelCompletudeFinanceiro: resultadoMargem.nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Riscos
// ---------------------------------------------------------------------------

function analisarRiscos(v: DadosFreteVariante, nucleo: NucleoFreteResultado, casas: CasasDecimais): RiscoFrete[] {
  const riscos: RiscoFrete[] = [];

  if (nucleo.lucro !== undefined && nucleo.lucro < 0) {
    riscos.push({
      categoria: "PREJUIZO",
      nivel: "CRITICO",
      descricao: "O frete resulta em prejuízo com os dados informados.",
      evidencia: `Lucro estimado: ${formatarBRL(nucleo.lucro)}.`,
      impactoPotencial: "Perda financeira direta na operação.",
      acaoRecomendada: "Renegociar o valor do frete ou reduzir custos antes de aceitar.",
      origemInformacao: "Calculado a partir da receita e do custo informados.",
    });
  }

  if (v.margemMinimaPercentual !== undefined && nucleo.margemPercentual !== undefined && nucleo.margemPercentual < v.margemMinimaPercentual && (nucleo.lucro ?? 0) >= 0) {
    riscos.push({
      categoria: "MARGEM_BAIXA",
      nivel: "ALTO",
      descricao: `A margem obtida (${formatarNumero(nucleo.margemPercentual)}%) está abaixo da margem mínima informada (${formatarNumero(v.margemMinimaPercentual)}%).`,
      evidencia: nucleo.valorAdicionalMargemAlvo !== undefined ? `Seriam necessários ${formatarBRL(nucleo.valorAdicionalMargemAlvo)} adicionais de receita para atingir a meta.` : undefined,
      impactoPotencial: "Operação lucrativa, porém abaixo do retorno desejado pela transportadora.",
      acaoRecomendada: "Negociar valor adicional ou avaliar redução de custos.",
      origemInformacao: "Comparação entre margem calculada e margemMinimaPercentual informada.",
    });
  }

  if (nucleo.percentualKmVazio !== undefined && nucleo.percentualKmVazio >= LIMITES_CLASSIFICACAO_FRETE.percentualKmVazioAtencaoPercentual) {
    riscos.push({
      categoria: "RETORNO_VAZIO",
      nivel: nucleo.percentualKmVazio >= 50 ? "ALTO" : "MODERADO",
      descricao: `O retorno vazio representa ${formatarNumero(nucleo.percentualKmVazio)}% da distância total.`,
      impactoPotencial: "Reduz a receita e a margem por km em relação a considerar apenas o trecho carregado.",
      acaoRecomendada: "Buscar carga de retorno ou embutir o custo do retorno vazio no valor negociado.",
      origemInformacao: "Calculado a partir da distância carregada e vazia informadas.",
    });
  }

  if (v.prazoPagamentoDias === undefined) {
    riscos.push({
      categoria: "PRAZO_PAGAMENTO",
      nivel: "NAO_AVALIADO",
      descricao: "O prazo de pagamento não foi informado.",
      origemInformacao: "Ausência de \"prazoPagamentoDias\" na entrada.",
    });
  } else {
    if (v.adiantamento === undefined) {
      riscos.push({
        categoria: "PRAZO_PAGAMENTO",
        nivel: "MODERADO",
        descricao: `Prazo de pagamento de ${v.prazoPagamentoDias} dias sem adiantamento informado.`,
        impactoPotencial: "Pode exigir capital de giro próprio para cobrir custos antecipados.",
        acaoRecomendada: "Negociar adiantamento, especialmente se houver custos antecipados relevantes.",
        origemInformacao: "prazoPagamentoDias informado, adiantamento ausente.",
      });
    }
    if (v.prazoPagamentoDias >= LIMITES_CLASSIFICACAO_FRETE.prazoPagamentoElevadoDias && nucleo.margemPercentual !== undefined && nucleo.margemPercentual <= 15) {
      riscos.push({
        categoria: "PRAZO_PAGAMENTO",
        nivel: "MODERADO",
        descricao: `Prazo de pagamento elevado (${v.prazoPagamentoDias} dias) para o nível de margem obtido (${formatarNumero(nucleo.margemPercentual)}%).`,
        impactoPotencial: "Pressão de caixa desproporcional ao retorno da operação.",
        acaoRecomendada: "Avaliar se a operação comporta esse prazo sem comprometer o caixa.",
        origemInformacao: "Comparação entre prazoPagamentoDias e a margem calculada.",
      });
    }
  }

  const capitalGiro = calcularCapitalGiro(v, casas);
  if (capitalGiro.capitalGiroNecessario !== undefined && capitalGiro.capitalGiroNecessario > 0) {
    const proporcaoLucro = nucleo.lucro !== undefined && nucleo.lucro > 0 ? (capitalGiro.capitalGiroNecessario / nucleo.lucro) * 100 : undefined;
    const nivel: NivelRiscoFrete =
      proporcaoLucro !== undefined && proporcaoLucro >= LIMITES_CLASSIFICACAO_FRETE.capitalGiroSobreLucroAtencaoPercentual ? "ALTO" : "MODERADO";
    riscos.push({
      categoria: "CAPITAL_GIRO",
      nivel,
      descricao: `A operação exige ${formatarBRL(capitalGiro.capitalGiroNecessario)} de capital de giro próprio antes do recebimento.`,
      evidencia: `Custos antecipados considerados: ${capitalGiro.itensIncluidos.join(", ")}.`,
      impactoPotencial: "Pressão sobre o caixa da transportadora até o recebimento do frete.",
      acaoRecomendada: "Negociar adiantamento maior ou confirmar disponibilidade de caixa antes de aceitar.",
      origemInformacao: "custosAntecipados informados menos o adiantamento recebido.",
    });
  }

  if (v.quantidadeVeiculos !== undefined && v.quantidadeMotoristas !== undefined && v.quantidadeMotoristas < v.quantidadeVeiculos) {
    riscos.push({
      categoria: "OPERACIONAL",
      nivel: "MODERADO",
      descricao: `Quantidade de motoristas (${v.quantidadeMotoristas}) menor que a de veículos (${v.quantidadeVeiculos}).`,
      impactoPotencial: "Pode inviabilizar a operação simultânea de todos os veículos.",
      acaoRecomendada: "Confirmar escala de motoristas antes de aceitar o frete.",
      origemInformacao: "Comparação entre quantidadeVeiculos e quantidadeMotoristas informados.",
    });
  }

  if (nucleo.nivelCompletudeFinanceiro !== "COMPLETO") {
    riscos.push({
      categoria: "DADOS_INCOMPLETOS",
      nivel: "MODERADO",
      descricao: "Nem todos os custos ou deduções relevantes foram informados.",
      evidencia: nucleo.custosIgnorados.length > 0 ? `Categorias não informadas: ${nucleo.custosIgnorados.join(", ")}.` : undefined,
      impactoPotencial: "O resultado financeiro pode ser mais favorável ou desfavorável do que o calculado.",
      acaoRecomendada: "Buscar as informações faltantes antes de uma decisão definitiva.",
      origemInformacao: "Nível de completude do cálculo financeiro.",
    });
  }

  const riscosExplicitos: Array<[CategoriaRiscoFrete, NivelRiscoFrete | undefined, string | undefined]> = [
    ["CARGA", v.riscoCargaNivel, v.riscoCargaDescricao],
    ["ROTA", v.riscoRotaNivel, v.riscoRotaDescricao],
    ["CLIENTE", v.riscoClienteNivel, v.riscoClienteDescricao],
    ["DOCUMENTACAO", v.riscoDocumentacaoNivel, v.riscoDocumentacaoDescricao],
  ];
  for (const [categoria, nivel, descricao] of riscosExplicitos) {
    riscos.push({
      categoria,
      nivel: nivel ?? "NAO_AVALIADO",
      descricao: descricao ?? `Risco de ${categoria.toLowerCase()} não avaliado — nenhum dado foi informado.`,
      origemInformacao:
        nivel !== undefined
          ? `Informado explicitamente (risco${categoria.charAt(0)}${categoria.slice(1).toLowerCase()}Nivel).`
          : "Nenhum dado informado; nunca inferido do nome de origem/destino/cliente/carga.",
    });
  }

  return riscos;
}

// ---------------------------------------------------------------------------
// Nível de completude (específico de frete)
// ---------------------------------------------------------------------------

function determinarCompletudeFrete(v: DadosFreteVariante, nucleo: NucleoFreteResultado): NivelCompletude {
  if (!nucleo.sucesso) return "INSUFICIENTE";
  if (nucleo.nivelCompletudeFinanceiro === "INSUFICIENTE") return "INSUFICIENTE";

  const faltamCamposFrete =
    v.prazoPagamentoDias === undefined ||
    (nucleo.distanciaVaziaKm === undefined && nucleo.percentualKmVazio === undefined && v.receitaFreteVolta === undefined);

  if (nucleo.nivelCompletudeFinanceiro === "PARCIAL" || faltamCamposFrete) return "PARCIAL";
  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Classificação de viabilidade
// ---------------------------------------------------------------------------

function classificarViabilidade(nucleo: NucleoFreteResultado, riscos: RiscoFrete[], nivelCompletude: NivelCompletude, margemMinima: number | undefined): ClassificacaoViabilidadeFrete {
  if (nivelCompletude === "INSUFICIENTE" || nucleo.lucro === undefined || nucleo.margemPercentual === undefined) {
    return "DADOS_INSUFICIENTES";
  }
  if (nucleo.lucro < 0) return "INVIAVEL";
  if (riscos.some((r) => r.nivel === "CRITICO")) return "ALTO_RISCO";
  if (margemMinima !== undefined && nucleo.margemPercentual < margemMinima) return "MARGEM_INSUFICIENTE";

  const temRessalva =
    nivelCompletude === "PARCIAL" ||
    riscos.some((r) => r.nivel === "ALTO") ||
    (nucleo.percentualKmVazio !== undefined && nucleo.percentualKmVazio >= LIMITES_CLASSIFICACAO_FRETE.percentualKmVazioAtencaoPercentual);

  if (temRessalva) return "VIAVEL_COM_RESSALVAS";

  if (nucleo.margemPercentual >= LIMITES_CLASSIFICACAO_FRETE.margemAtrativaPercentual && nivelCompletude === "COMPLETO") {
    return "ATRATIVO";
  }
  return "VIAVEL";
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirResumoFrete(
  nucleo: NucleoFreteResultado,
  classificacao: ClassificacaoViabilidadeFrete | undefined,
  nivelCompletude: NivelCompletude,
  capitalGiro: CapitalGiroResolvido,
  v: DadosFreteVariante
): string {
  if (nucleo.receitaLiquida === undefined || nucleo.custoTotal === undefined) {
    return "Não foi possível concluir a análise com os dados informados. Verifique os campos faltantes.";
  }

  const partes: string[] = [];
  partes.push(`O frete possui receita líquida estimada de ${formatarBRL(nucleo.receitaLiquida)} e custo total estimado de ${formatarBRL(nucleo.custoTotal)}.`);

  if (nucleo.lucro !== undefined) {
    const verbo = nucleo.lucro >= 0 ? "lucro" : "prejuízo";
    partes.push(
      `O ${verbo} projetado é de ${formatarBRL(Math.abs(nucleo.lucro))}${
        nucleo.margemPercentual !== undefined ? `, com margem de ${formatarNumero(nucleo.margemPercentual)}%` : ""
      }.`
    );
  }

  if (nucleo.distanciaTotalKm !== undefined && nucleo.lucroPorKm !== undefined) {
    partes.push(`Considerando ${formatarNumero(nucleo.distanciaTotalKm)} km totais, o lucro estimado é de ${formatarBRL(nucleo.lucroPorKm)} por km.`);
  }

  if (nucleo.percentualKmVazio !== undefined) {
    partes.push(`O retorno vazio representa ${formatarNumero(nucleo.percentualKmVazio)}% da distância total.`);
  }

  if (classificacao) {
    const rotulos: Record<ClassificacaoViabilidadeFrete, string> = {
      DADOS_INSUFICIENTES: "com dados insuficientes para uma conclusão",
      INVIAVEL: "inviável",
      ALTO_RISCO: "de alto risco",
      MARGEM_INSUFICIENTE: "com margem insuficiente frente à meta informada",
      VIAVEL_COM_RESSALVAS: "viável com ressalvas",
      VIAVEL: "viável",
      ATRATIVO: "atrativa",
    };
    partes.push(
      `A operação foi classificada como ${rotulos[classificacao]}${
        v.prazoPagamentoDias !== undefined ? ` considerando o prazo de pagamento de ${v.prazoPagamentoDias} dias` : ""
      }${
        capitalGiro.capitalGiroNecessario !== undefined && capitalGiro.capitalGiroNecessario > 0
          ? ` e a necessidade de ${formatarBRL(capitalGiro.capitalGiroNecessario)} de capital de giro`
          : ""
      }.`
    );
  }

  if (nivelCompletude === "PARCIAL") {
    const faltando: string[] = [];
    if (nucleo.custosIgnorados.length > 0) faltando.push(...nucleo.custosIgnorados);
    if (v.prazoPagamentoDias === undefined) faltando.push("prazo de pagamento");
    partes.push(`A análise é parcial porque ${faltando.length > 0 ? faltando.join(", ") : "nem todos os dados relevantes"} não foram informados.`);
  } else if (nivelCompletude === "INSUFICIENTE") {
    partes.push("A análise foi classificada como insuficiente para uma conclusão confiável sobre a viabilidade do frete.");
  }

  return partes.join(" ");
}

function construirMemoriaCalculoFrete(rotulo: string, nucleo: NucleoFreteResultado, capitalGiro: CapitalGiroResolvido): string[] {
  const linhas: string[] = [];
  if (nucleo.receitaBrutaTotal !== undefined && nucleo.deducoes !== undefined) {
    linhas.push(`${rotulo}: receita bruta ${formatarBRL(nucleo.receitaBrutaTotal)} − deduções ${formatarBRL(nucleo.deducoes)} = receita líquida ${formatarBRL(nucleo.receitaLiquida ?? 0)}.`);
  }
  if (nucleo.receitaLiquida !== undefined && nucleo.custoTotal !== undefined) {
    linhas.push(`${rotulo}: lucro = ${formatarBRL(nucleo.receitaLiquida)} − ${formatarBRL(nucleo.custoTotal)} = ${formatarBRL(nucleo.lucro ?? 0)}.`);
  }
  if (nucleo.distanciaTotalKm !== undefined) {
    linhas.push(
      `${rotulo}: distância total = ${formatarNumero(nucleo.distanciaTotalKm)} km${
        nucleo.distanciaVaziaKm !== undefined ? ` (vazia: ${formatarNumero(nucleo.distanciaVaziaKm)} km)` : ""
      }.`
    );
  }
  if (capitalGiro.capitalGiroNecessario !== undefined && capitalGiro.desembolsoAntesRecebimento !== undefined) {
    const adiantamentoConsiderado = capitalGiro.desembolsoAntesRecebimento - capitalGiro.capitalGiroNecessario;
    linhas.push(
      `${rotulo}: capital de giro = ${formatarBRL(capitalGiro.desembolsoAntesRecebimento)} (custos antecipados) − ${formatarBRL(
        adiantamentoConsiderado
      )} (adiantamento) = ${formatarBRL(capitalGiro.capitalGiroNecessario)}.`
    );
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Pipeline por variante (frete único, proposta ou bloco previsto/realizado)
// ---------------------------------------------------------------------------

function analisarVariante(v: DadosFreteVariante, modo: ModoAnaliseFrete, entrada: AnalisarFreteEntrada, casas: CasasDecimais, rotulo: string): ResultadoIndividualFrete {
  const estrategiaReceita = entrada.estrategiaSobreposicaoReceita ?? "REJEITAR_SOBREPOSICAO";
  const estrategiaCusto = entrada.estrategiaSobreposicaoCusto ?? "REJEITAR_SOBREPOSICAO";
  const estrategiaDistancia = entrada.estrategiaSobreposicaoDistancia ?? "REJEITAR_SOBREPOSICAO";
  const estrategiaDeducao = entrada.estrategiaSobreposicaoDeducao ?? "REJEITAR_SOBREPOSICAO";

  const errosValidacao = validarVariante(v, rotulo);
  if (errosValidacao.length > 0) {
    return {
      sucesso: false,
      identificacao: v.identificacaoFrete,
      descricao: v.descricaoFrete,
      origem: v.origem,
      destino: v.destino,
      riscos: [],
      nivelCompletude: "INSUFICIENTE",
      custosIncluidos: [],
      custosIgnorados: [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: [],
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: errosValidacao.join(" "),
      memoriaCalculo: [],
    };
  }

  const nucleo = calcularNucleoFrete(v, modo, estrategiaReceita, estrategiaCusto, estrategiaDistancia, estrategiaDeducao, casas, rotulo);

  if (!nucleo.sucesso) {
    return {
      sucesso: false,
      identificacao: v.identificacaoFrete,
      descricao: v.descricaoFrete,
      origem: v.origem,
      destino: v.destino,
      riscos: [],
      nivelCompletude: "INSUFICIENTE",
      custosIncluidos: [],
      custosIgnorados: [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: nucleo.alertas,
      premissas: nucleo.premissas,
      dadosFaltantes: nucleo.dadosFaltantes,
      mensagemResumo:
        nucleo.mensagemErro ?? (nucleo.dadosFaltantes.length > 0 ? `Para analisar o frete, informe: ${nucleo.dadosFaltantes.join(", ")}.` : "Não foi possível analisar o frete com os dados informados."),
      memoriaCalculo: [],
    };
  }

  const capitalGiro = calcularCapitalGiro(v, casas);
  const riscos = analisarRiscos(v, nucleo, casas);
  const nivelCompletude = determinarCompletudeFrete(v, nucleo);
  const classificacao = classificarViabilidade(nucleo, riscos, nivelCompletude, v.margemMinimaPercentual);

  const retornoSobreCapitalPercentual =
    v.capitalProprioEmpregado !== undefined && v.capitalProprioEmpregado > 0 && nucleo.lucro !== undefined
      ? arredondar((nucleo.lucro / v.capitalProprioEmpregado) * 100, casas.percentual)
      : undefined;

  const alertasFinais = [...nucleo.alertas];
  if (classificacao === "INVIAVEL") alertasFinais.push("O frete está classificado como inviável nos dados informados.");
  if (classificacao === "DADOS_INSUFICIENTES") alertasFinais.push("Dados insuficientes para uma recomendação — não é possível concluir se o frete compensa.");
  if (capitalGiro.capitalGiroNecessario !== undefined && capitalGiro.capitalGiroNecessario > 0 && nucleo.lucro !== undefined && nucleo.lucro > 0) {
    alertasFinais.push(`Resultado positivo, mas a operação exige ${formatarBRL(capitalGiro.capitalGiroNecessario)} de capital de giro antes do recebimento.`);
  }

  const mensagemResumo = construirResumoFrete(nucleo, classificacao, nivelCompletude, capitalGiro, v);

  return {
    sucesso: true,
    identificacao: v.identificacaoFrete,
    descricao: v.descricaoFrete,
    origem: v.origem,
    destino: v.destino,
    receitaBruta: nucleo.receitaBrutaTotal,
    deducoes: nucleo.deducoes,
    receitaLiquida: nucleo.receitaLiquida,
    custoTotal: nucleo.custoTotal,
    lucro: nucleo.lucro,
    margemPercentual: nucleo.margemPercentual,
    markupPercentual: nucleo.markupPercentual,
    distanciaTotalKm: nucleo.distanciaTotalKm,
    distanciaCarregadaKm: nucleo.distanciaCarregadaKm,
    distanciaVaziaKm: nucleo.distanciaVaziaKm,
    percentualKmVazio: nucleo.percentualKmVazio,
    receitaPorKmTotal: nucleo.receitaPorKmTotal,
    receitaPorKmCarregado: nucleo.receitaPorKmCarregado,
    custoPorKm: nucleo.custoPorKm,
    lucroPorKm: nucleo.lucroPorKm,
    receitaPorTonelada: nucleo.receitaPorTonelada,
    custoPorTonelada: nucleo.custoPorTonelada,
    lucroPorTonelada: nucleo.lucroPorTonelada,
    lucroPorVeiculo: nucleo.lucroPorVeiculo,
    custoRetorno: v.custoRetorno,
    impactoRetornoVazio: nucleo.impactoRetornoVazio,
    adiantamento: v.adiantamento,
    saldoReceber: v.saldoReceber,
    capitalGiroNecessario: capitalGiro.capitalGiroNecessario,
    saldoOperacional: capitalGiro.saldoOperacional,
    prazoPagamentoDias: v.prazoPagamentoDias,
    margemMinima: v.margemMinimaPercentual,
    retornoSobreCapitalPercentual,
    valorAdicionalEquilibrio: nucleo.valorAdicionalEquilibrio,
    valorAdicionalMargemAlvo: nucleo.valorAdicionalMargemAlvo,
    riscos,
    classificacao,
    nivelCompletude,
    custosIncluidos: nucleo.custosIncluidos,
    custosIgnorados: nucleo.custosIgnorados,
    limitacoes: LIMITACOES_PADRAO,
    alertas: alertasFinais,
    premissas: nucleo.premissas,
    dadosFaltantes: [],
    mensagemResumo,
    memoriaCalculo: construirMemoriaCalculoFrete(rotulo, nucleo, capitalGiro),
  };
}

// ---------------------------------------------------------------------------
// Comparação de propostas
// ---------------------------------------------------------------------------

function nomeProposta(p: PropostaFrete, index: number): string {
  return p.nome ?? p.id ?? p.identificacaoFrete ?? `Proposta ${index + 1}`;
}

function pontuacaoRisco(riscos: RiscoFrete[]): number {
  const pesos: Record<NivelRiscoFrete, number> = { CRITICO: 4, ALTO: 3, MODERADO: 2, BAIXO: 1, NAO_AVALIADO: 0 };
  return riscos.reduce((soma, r) => soma + pesos[r.nivel], 0);
}

function construirRankingFrete(itens: Array<{ id: string; nome: string }>, extrair: (id: string) => number | undefined, menorMelhor = false): ItemRankingFrete[] {
  return itens
    .map((i) => ({ id: i.id, nome: i.nome, valor: extrair(i.id) }))
    .filter((i): i is { id: string; nome: string; valor: number } => i.valor !== undefined)
    .sort((a, b) => (menorMelhor ? a.valor - b.valor : b.valor - a.valor))
    .map((i, idx) => ({ ...i, posicao: idx + 1 }));
}

function compararPropostas(entrada: AnalisarFreteEntrada, casas: CasasDecimais): { resultados: ResultadoIndividualFrete[]; ranking?: RankingPropostas; erros: string[] } {
  const propostas = entrada.propostas as PropostaFrete[];
  const erros: string[] = [];
  const resultados: ResultadoIndividualFrete[] = [];
  const identidades: Array<{ id: string; nome: string }> = [];

  propostas.forEach((p, index) => {
    const nome = nomeProposta(p, index);
    const id = p.id ?? `proposta-${index + 1}`;
    identidades.push({ id, nome });
    const resultado = analisarVariante(p, entrada.modo, entrada, casas, nome);
    if (!resultado.sucesso) {
      erros.push(`${nome}: ${resultado.mensagemResumo}`);
    }
    resultados.push({ ...resultado, identificacao: resultado.identificacao ?? id });
  });

  if (erros.length > 0) return { resultados: [], erros };

  const porId = new Map(resultados.map((r, i) => [identidades[i].id, r]));
  const valorPorId = (campo: keyof ResultadoIndividualFrete, id: string): number | undefined => {
    const r = porId.get(id);
    return r ? (r[campo] as number | undefined) : undefined;
  };

  const ranking: RankingPropostas = {
    porLucro: construirRankingFrete(identidades, (id) => valorPorId("lucro", id)),
    porMargem: construirRankingFrete(identidades, (id) => valorPorId("margemPercentual", id)),
    porLucroPorKm: construirRankingFrete(identidades, (id) => valorPorId("lucroPorKm", id)),
    porReceitaPorKm: construirRankingFrete(identidades, (id) => valorPorId("receitaPorKmTotal", id)),
    porMenorCapitalGiro: construirRankingFrete(identidades, (id) => valorPorId("capitalGiroNecessario", id), true),
    porMenorExposicaoRetornoVazio: construirRankingFrete(identidades, (id) => valorPorId("percentualKmVazio", id), true),
    porMenorRisco: construirRankingFrete(
      identidades,
      (id) => {
        const r = porId.get(id);
        return r ? pontuacaoRisco(r.riscos) : undefined;
      },
      true
    ),
    porResultadoGeral: [],
    alertas: [],
  };

  // Resultado geral: combina posição no lucro, margem e risco (menor soma de posições = melhor).
  const posicaoPorId = (rank: ItemRankingFrete[], id: string) => rank.find((r) => r.id === id)?.posicao ?? rank.length + 1;
  ranking.porResultadoGeral = identidades
    .map((i) => ({
      id: i.id,
      nome: i.nome,
      valor: posicaoPorId(ranking.porLucro, i.id) + posicaoPorId(ranking.porMargem, i.id) + posicaoPorId(ranking.porMenorRisco, i.id),
    }))
    .sort((a, b) => a.valor - b.valor)
    .map((i, idx) => ({ ...i, posicao: idx + 1 }));

  if (ranking.porReceitaPorKm[0] && ranking.porLucro[0] && ranking.porReceitaPorKm[0].id !== ranking.porLucro[0].id) {
    ranking.alertas.push(
      `"${ranking.porReceitaPorKm[0].nome}" tem a maior receita por km, mas não é a proposta com maior lucro ("${ranking.porLucro[0].nome}") — maior faturamento não significa automaticamente a melhor proposta.`
    );
  }

  return { resultados, ranking, erros: [] };
}

// ---------------------------------------------------------------------------
// Previsto x realizado
// ---------------------------------------------------------------------------

function diferenca(previsto: number | undefined, realizado: number | undefined, casas: number): DiferencaPrevistoRealizado | undefined {
  if (previsto === undefined || realizado === undefined) return undefined;
  const diferencaAbsoluta = arredondar(realizado - previsto, casas);
  const diferencaPercentual = previsto !== 0 ? arredondar((diferencaAbsoluta / Math.abs(previsto)) * 100, CASAS_DECIMAIS_PERCENTUAL_PADRAO) : undefined;
  return { previsto: arredondar(previsto, casas), realizado: arredondar(realizado, casas), diferencaAbsoluta, diferencaPercentual };
}

function calcularPrevistoRealizadoFrete(
  entrada: AnalisarFreteEntrada,
  casas: CasasDecimais
): { resultado?: PrevistoRealizadoFrete; classificacaoGeral?: ClassificacaoViabilidadeFrete; nivelCompletude: NivelCompletude; erros: string[]; freteAnalisado?: ResultadoIndividualFrete } {
  const previsto = entrada.previsto as DadosFreteVariante;
  const realizado = entrada.realizado as DadosFreteVariante;

  const resultadoPrevisto = analisarVariante(previsto, entrada.modo, entrada, casas, "previsto");
  const resultadoRealizado = analisarVariante(realizado, entrada.modo, entrada, casas, "realizado");

  if (!resultadoPrevisto.sucesso || !resultadoRealizado.sucesso) {
    return {
      erros: [
        ...(!resultadoPrevisto.sucesso ? [`previsto: ${resultadoPrevisto.mensagemResumo}`] : []),
        ...(!resultadoRealizado.sucesso ? [`realizado: ${resultadoRealizado.mensagemResumo}`] : []),
      ],
      nivelCompletude: "INSUFICIENTE",
    };
  }

  const receita = diferenca(resultadoPrevisto.receitaLiquida, resultadoRealizado.receitaLiquida, casas.moeda);
  const custo = diferenca(resultadoPrevisto.custoTotal, resultadoRealizado.custoTotal, casas.moeda);
  const distancia = diferenca(resultadoPrevisto.distanciaTotalKm, resultadoRealizado.distanciaTotalKm, casas.distancia);
  const lucro = diferenca(resultadoPrevisto.lucro, resultadoRealizado.lucro, casas.moeda);
  const margemPercentual = diferenca(resultadoPrevisto.margemPercentual, resultadoRealizado.margemPercentual, casas.percentual);
  const capitalGiro = diferenca(resultadoPrevisto.capitalGiroNecessario, resultadoRealizado.capitalGiroNecessario, casas.moeda);
  const prazoPagamentoDias = diferenca(resultadoPrevisto.prazoPagamentoDias, resultadoRealizado.prazoPagamentoDias, 0);

  const candidatos: Array<[string, DiferencaPrevistoRealizado | undefined]> = [
    ["Receita", receita],
    ["Custo", custo],
    ["Distância", distancia],
  ];
  let principalDesvio: string | undefined;
  let maiorDesvio = -1;
  for (const [nome, d] of candidatos) {
    if (d?.diferencaAbsoluta !== undefined && Math.abs(d.diferencaAbsoluta) > maiorDesvio) {
      maiorDesvio = Math.abs(d.diferencaAbsoluta);
      principalDesvio = nome;
    }
  }

  const categoriasAcimaDoPrevisto = candidatos.filter(([, d]) => d?.diferencaAbsoluta !== undefined && d.diferencaAbsoluta > 0).map(([nome]) => nome);
  const categoriasAbaixoDoPrevisto = candidatos.filter(([, d]) => d?.diferencaAbsoluta !== undefined && d.diferencaAbsoluta < 0).map(([nome]) => nome);

  const alertas: string[] = [];
  if (principalDesvio) {
    alertas.push(
      `A categoria com maior desvio entre previsto e realizado foi "${principalDesvio}". A causa não foi informada — pode ser variação de mercado, negociação, desvio de rota ou operação adicional.`
    );
  }

  const impactoNaMargem =
    margemPercentual?.diferencaAbsoluta !== undefined
      ? `A margem variou ${formatarNumero(margemPercentual.diferencaAbsoluta)} p.p. entre o previsto e o realizado.`
      : undefined;

  const resultado: PrevistoRealizadoFrete = {
    receita,
    custo,
    distancia,
    lucro,
    margemPercentual,
    capitalGiro,
    prazoPagamentoDias,
    principalDesvio,
    categoriasAcimaDoPrevisto,
    categoriasAbaixoDoPrevisto,
    impactoNaMargem,
    alertas,
  };

  const nivelCompletude: NivelCompletude = resultadoPrevisto.nivelCompletude === "COMPLETO" && resultadoRealizado.nivelCompletude === "COMPLETO" ? "COMPLETO" : "PARCIAL";

  return { resultado, classificacaoGeral: resultadoRealizado.classificacao, nivelCompletude, erros: [], freteAnalisado: resultadoRealizado };
}

// ---------------------------------------------------------------------------
// Fábrica de resposta de falha
// ---------------------------------------------------------------------------

function respostaFalha(entrada: AnalisarFreteEntrada, mensagemResumo: string, dadosFaltantes: string[] = []): AnalisarFreteResultado {
  return {
    sucesso: false,
    modo: entrada.modo,
    nivelCompletude: "INSUFICIENTE",
    riscosGerais: [],
    limitacoes: LIMITACOES_PADRAO,
    alertas: [],
    premissas: [],
    dadosFaltantes,
    mensagemResumo,
    memoriaCalculo: [],
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

export function analisarFrete(entrada: AnalisarFreteEntrada): AnalisarFreteResultado {
  const casas = casasDecimaisDe(entrada);

  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) {
    return respostaFalha(entrada, errosTopo.join(" "));
  }

  if (entrada.modo === "COMPARACAO_PROPOSTAS") {
    const { resultados, ranking, erros } = compararPropostas(entrada, casas);
    if (erros.length > 0) {
      return respostaFalha(entrada, erros.join(" "));
    }
    const nivelCompletude: NivelCompletude = resultados.some((r) => r.nivelCompletude !== "COMPLETO") ? "PARCIAL" : "COMPLETO";
    const melhor = ranking?.porResultadoGeral[0];
    const pior = ranking?.porResultadoGeral[ranking.porResultadoGeral.length - 1];
    const riscosGerais = resultados.flatMap((r) => r.riscos.filter((risco) => risco.nivel === "CRITICO" || risco.nivel === "ALTO"));
    const resultadoMelhor = melhor ? resultados.find((r) => r.identificacao === melhor.id) : undefined;

    return {
      sucesso: true,
      modo: entrada.modo,
      propostasAnalisadas: resultados,
      ranking,
      melhorProposta: melhor?.nome,
      piorProposta: pior && pior.id !== melhor?.id ? pior.nome : undefined,
      criterioPrincipal: "Combinação de lucro, margem e risco (nunca apenas o valor bruto do frete).",
      classificacaoGeral: resultadoMelhor?.classificacao,
      nivelCompletude,
      riscosGerais,
      limitacoes: LIMITACOES_PADRAO,
      alertas: ranking?.alertas ?? [],
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: melhor
        ? `"${melhor.nome}" apresentou o melhor resultado geral entre as ${resultados.length} propostas comparadas (combinação de lucro, margem e risco).`
        : "Não foi possível comparar as propostas com os dados informados.",
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "PREVISTO_X_REALIZADO") {
    const { resultado, classificacaoGeral, nivelCompletude, erros, freteAnalisado } = calcularPrevistoRealizadoFrete(entrada, casas);
    if (erros.length > 0) {
      return respostaFalha(entrada, erros.join(" "));
    }
    const pr = resultado as PrevistoRealizadoFrete;

    return {
      sucesso: true,
      modo: entrada.modo,
      freteAnalisado,
      previstoRealizado: pr,
      classificacaoGeral,
      nivelCompletude,
      riscosGerais: freteAnalisado?.riscos.filter((r) => r.nivel === "CRITICO" || r.nivel === "ALTO") ?? [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: pr.alertas,
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: `Lucro previsto: ${formatarBRL(pr.lucro?.previsto ?? 0)}. Lucro realizado: ${formatarBRL(pr.lucro?.realizado ?? 0)}. Diferença: ${formatarBRL(
        pr.lucro?.diferencaAbsoluta ?? 0
      )}${pr.margemPercentual?.diferencaAbsoluta !== undefined ? ` (margem variou ${formatarNumero(pr.margemPercentual.diferencaAbsoluta)} p.p.)` : ""}.`,
      memoriaCalculo: [],
    };
  }

  // Modos de frete único (ANALISE_SIMPLES, ANALISE_COMPLETA, IDA_E_VOLTA, RETORNO_VAZIO,
  // FRETE_COM_RETORNO, ANALISE_POR_KM, ANALISE_POR_TONELADA, ANALISE_CAPITAL_GIRO).
  const resultado = analisarVariante(entrada, entrada.modo, entrada, casas, "frete");

  if (!resultado.sucesso) {
    return respostaFalha(entrada, resultado.mensagemResumo, resultado.dadosFaltantes);
  }

  return {
    sucesso: true,
    modo: entrada.modo,
    freteAnalisado: resultado,
    classificacaoGeral: resultado.classificacao,
    nivelCompletude: resultado.nivelCompletude,
    riscosGerais: resultado.riscos.filter((r) => r.nivel === "CRITICO" || r.nivel === "ALTO"),
    limitacoes: LIMITACOES_PADRAO,
    alertas: resultado.alertas,
    premissas: resultado.premissas,
    dadosFaltantes: [],
    mensagemResumo: resultado.mensagemResumo,
    memoriaCalculo: resultado.memoriaCalculo,
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
    descricao: "Tipo de análise de frete desejada.",
    valoresPossiveis: [
      "ANALISE_SIMPLES",
      "ANALISE_COMPLETA",
      "IDA_E_VOLTA",
      "RETORNO_VAZIO",
      "FRETE_COM_RETORNO",
      "COMPARACAO_PROPOSTAS",
      "PREVISTO_X_REALIZADO",
      "ANALISE_POR_KM",
      "ANALISE_POR_TONELADA",
      "ANALISE_CAPITAL_GIRO",
    ],
  },
  { nome: "descricaoFrete", tipo: "string", obrigatorio: false, descricao: "Descrição livre do frete." },
  { nome: "identificacaoFrete", tipo: "string", obrigatorio: false, descricao: "Identificação/número do frete." },
  { nome: "origem", tipo: "string", obrigatorio: false, descricao: "Origem — apenas informativo, nunca usado para calcular distância." },
  { nome: "destino", tipo: "string", obrigatorio: false, descricao: "Destino — apenas informativo, nunca usado para calcular distância." },
  { nome: "tipoCarga", tipo: "string", obrigatorio: false, descricao: "Tipo de carga transportada." },
  { nome: "pesoCargaToneladas", tipo: "number", obrigatorio: false, descricao: "Peso da carga, em toneladas (obrigatório em ANALISE_POR_TONELADA)." },
  { nome: "distanciaIdaKm", tipo: "number", obrigatorio: false, descricao: "Distância de ida, em km." },
  { nome: "distanciaVoltaKm", tipo: "number", obrigatorio: false, descricao: "Distância de volta, em km." },
  { nome: "distanciaCarregadaKm", tipo: "number", obrigatorio: false, descricao: "Distância carregada, em km (alternativa a ida/volta)." },
  { nome: "distanciaVaziaKm", tipo: "number", obrigatorio: false, descricao: "Distância vazia (retorno sem carga), em km." },
  { nome: "distanciaAdicionalKm", tipo: "number", obrigatorio: false, descricao: "Distância adicional, em km." },
  { nome: "receitaFreteIda", tipo: "number", obrigatorio: false, descricao: "Receita da ida, em R$ (alternativa a valorFreteTotal)." },
  { nome: "receitaFreteVolta", tipo: "number", obrigatorio: false, descricao: "Receita do retorno, em R$ (0 quando vazio)." },
  { nome: "receitaAdicional", tipo: "number", obrigatorio: false, descricao: "Receita adicional, em R$." },
  { nome: "valorFreteTotal", tipo: "number", obrigatorio: false, descricao: "Valor total do frete, em R$ (alternativa a receitaFreteIda/receitaFreteVolta — nunca as duas)." },
  { nome: "descontos", tipo: "number", obrigatorio: false, descricao: "Descontos concedidos, em R$." },
  { nome: "impostos", tipo: "number", obrigatorio: false, descricao: "Impostos, em R$ (alternativa a aliquotaImpostosPercentual)." },
  { nome: "aliquotaImpostosPercentual", tipo: "number", obrigatorio: false, descricao: "Alíquota de impostos, em %." },
  { nome: "comissao", tipo: "number", obrigatorio: false, descricao: "Comissão, em R$ (alternativa a aliquotaComissaoPercentual)." },
  { nome: "aliquotaComissaoPercentual", tipo: "number", obrigatorio: false, descricao: "Alíquota de comissão, em %." },
  { nome: "taxaPlataforma", tipo: "number", obrigatorio: false, descricao: "Taxa da plataforma/agenciador, em R$ (alternativa a aliquotaTaxaPlataformaPercentual)." },
  { nome: "aliquotaTaxaPlataformaPercentual", tipo: "number", obrigatorio: false, descricao: "Alíquota da taxa da plataforma, em %." },
  { nome: "seguroCarga", tipo: "number", obrigatorio: false, descricao: "Seguro da carga, em R$." },
  { nome: "gerenciamentoRisco", tipo: "number", obrigatorio: false, descricao: "Gerenciamento de risco, em R$." },
  { nome: "outrasDeducoesInformadas", tipo: "number", obrigatorio: false, descricao: "Outras deduções sobre a receita, em R$." },
  { nome: "custoTotal", tipo: "number", obrigatorio: false, descricao: "Custo total já calculado, em R$ (uma das fontes de custo — nunca junto com as outras)." },
  { nome: "custosVariaveis", tipo: "number", obrigatorio: false, descricao: "Custos variáveis, em R$ (fonte \"categorias detalhadas\")." },
  { nome: "custosFixosRateados", tipo: "number", obrigatorio: false, descricao: "Custos fixos já rateados, em R$." },
  { nome: "custosDiretos", tipo: "number", obrigatorio: false, descricao: "Custos diretos, em R$." },
  { nome: "custosIndiretos", tipo: "number", obrigatorio: false, descricao: "Custos indiretos/administrativos, em R$." },
  { nome: "custoViagem", tipo: "number", obrigatorio: false, descricao: "Custo da ida, em R$ (usado também no impacto do retorno vazio)." },
  { nome: "custoRetorno", tipo: "number", obrigatorio: false, descricao: "Custo do retorno, em R$ (usado também no impacto do retorno vazio)." },
  { nome: "custoAdministrativo", tipo: "number", obrigatorio: false, descricao: "Custo administrativo, em R$." },
  { nome: "outrosCustos", tipo: "number", obrigatorio: false, descricao: "Outros custos, em R$." },
  { nome: "resumoCustoViagem", tipo: "string", obrigatorio: false, descricao: "Resultado (ou resumo) de calcular_custo_viagem — fonte de custo, nunca junto com as outras." },
  { nome: "cpkTotalReaisPorKm", tipo: "number", obrigatorio: false, descricao: "CPK total ou custo por km já calculado, em R$/km — combinado com a distância total." },
  { nome: "resumoCpk", tipo: "string", obrigatorio: false, descricao: "Resultado (ou resumo) de calcular_cpk — alternativa a cpkTotalReaisPorKm." },
  { nome: "adiantamento", tipo: "number", obrigatorio: false, descricao: "Valor do adiantamento recebido, em R$." },
  { nome: "saldoReceber", tipo: "number", obrigatorio: false, descricao: "Saldo a receber, em R$." },
  { nome: "prazoPagamentoDias", tipo: "number", obrigatorio: false, descricao: "Prazo de pagamento, em dias." },
  { nome: "justificativaAdiantamentoSuperiorAoFrete", tipo: "string", obrigatorio: false, descricao: "Obrigatório apenas quando o adiantamento é maior que o valor do frete." },
  { nome: "custosAntecipados", tipo: "string", obrigatorio: false, descricao: "Custos pagos antes do recebimento (combustível, pedágio, alimentação, hospedagem, diária, carga/descarga, outros) — usados no cálculo de capital de giro." },
  { nome: "capitalProprioEmpregado", tipo: "number", obrigatorio: false, descricao: "Capital próprio empregado, em R$ — usado apenas para o retorno sobre capital, nunca inferido." },
  { nome: "margemMinimaPercentual", tipo: "number", obrigatorio: false, descricao: "Margem mínima desejada, em %." },
  { nome: "markupAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "Markup desejado, em %." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos envolvidos." },
  { nome: "quantidadeMotoristas", tipo: "number", obrigatorio: false, descricao: "Quantidade de motoristas envolvidos." },
  { nome: "diasViagem", tipo: "number", obrigatorio: false, descricao: "Duração estimada da viagem, em dias." },
  { nome: "horasViagem", tipo: "number", obrigatorio: false, descricao: "Duração estimada da viagem, em horas." },
  { nome: "riscoCargaNivel", tipo: "enum", obrigatorio: false, descricao: "Nível de risco da carga, se avaliado (nunca inferido do tipo de carga).", valoresPossiveis: ["BAIXO", "MODERADO", "ALTO", "CRITICO"] },
  { nome: "riscoRotaNivel", tipo: "enum", obrigatorio: false, descricao: "Nível de risco da rota, se avaliado (nunca inferido de origem/destino).", valoresPossiveis: ["BAIXO", "MODERADO", "ALTO", "CRITICO"] },
  { nome: "riscoClienteNivel", tipo: "enum", obrigatorio: false, descricao: "Nível de risco do cliente, se avaliado (nunca inferido do nome do cliente).", valoresPossiveis: ["BAIXO", "MODERADO", "ALTO", "CRITICO"] },
  { nome: "riscoDocumentacaoNivel", tipo: "enum", obrigatorio: false, descricao: "Nível de risco de documentação, se avaliado.", valoresPossiveis: ["BAIXO", "MODERADO", "ALTO", "CRITICO"] },
  { nome: "propostas", tipo: "string", obrigatorio: false, descricao: "Lista com ao menos 2 propostas (mesmos campos desta entrada) — obrigatório em COMPARACAO_PROPOSTAS." },
  { nome: "previsto", tipo: "string", obrigatorio: false, descricao: "Bloco completo de dados previstos — obrigatório em PREVISTO_X_REALIZADO." },
  { nome: "realizado", tipo: "string", obrigatorio: false, descricao: "Bloco completo de dados realizados — obrigatório em PREVISTO_X_REALIZADO." },
  {
    nome: "estrategiaSobreposicaoReceita",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Como resolver receita informada por mais de uma forma. Padrão: REJEITAR_SOBREPOSICAO.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"],
  },
  {
    nome: "estrategiaSobreposicaoCusto",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Como resolver custo informado por mais de uma forma. Padrão: REJEITAR_SOBREPOSICAO.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"],
  },
  {
    nome: "estrategiaSobreposicaoDistancia",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Como resolver distância informada por mais de uma forma (ida/volta/adicional x carregada/vazia). Padrão: REJEITAR_SOBREPOSICAO.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"],
  },
  {
    nome: "estrategiaSobreposicaoDeducao",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Como resolver a taxa de plataforma quando informada como valor fixo e percentual. Padrão: REJEITAR_SOBREPOSICAO.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_VALOR_FIXO", "PRIORIZAR_PERCENTUAL"],
  },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve as casas decimais padrão (moeda 2, percentual 2, custo/km 4, distância 2, tonelada 3)." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Repassado ao cálculo financeiro subjacente. Padrão: true." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaAnalisarFrete: DefinicaoFerramenta<AnalisarFreteEntrada, AnalisarFreteResultado> = {
  nome: "analisar_frete",
  descricao:
    "Analisa se um frete ofertado é viável, arriscado, insuficiente ou atrativo — considerando receita, custo, margem, retorno vazio, prazo de pagamento, capital de giro e riscos. Use para perguntas como \"Este frete compensa?\", \"Vale a pena pegar essa carga?\", \"Quanto vai sobrar?\", \"Qual proposta é melhor?\" ou \"Preciso de quanto de capital de giro?\". Nunca classifica um frete apenas pelo valor bruto.",
  objetivo:
    "Apoiar a decisão de aceitar, recusar ou renegociar um frete com uma visão completa e transparente de receita, custo, margem, retorno vazio, prazo, capital de giro e riscos — nunca escondendo dados ausentes nem apresentando uma análise parcial como definitiva.",
  parametros: PARAMETROS,
  executar: analisarFrete,
};
