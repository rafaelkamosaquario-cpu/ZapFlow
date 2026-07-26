import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, NivelCompletude, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO, CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";
import { CASAS_DECIMAIS_DISTANCIA_PADRAO, CASAS_DECIMAIS_PESO_PADRAO } from "./calcular-custo-viagem";
import { calcularMargem } from "./calcular-margem";
import type { ResumoCustoViagem } from "./calcular-margem";
import { calcularCpk } from "./calcular-cpk";
import { calcularValorMinimoFrete } from "./calcular-valor-minimo-frete";
import type { ResumoCpkParaCusto } from "./calcular-valor-minimo-frete";
import type { EstrategiaSobreposicaoDeducao } from "./analisar-frete";

/**
 * Ferramenta: calcular_receita_km
 *
 * Calcula e interpreta a receita por quilômetro de um frete, viagem, rota,
 * veículo, operação, contrato, conjunto de viagens, frota ou período —
 * sempre diferenciando receita bruta, receita líquida, receita por km total
 * x carregado, custo por km, lucro por km, margem e receita mínima por km.
 * Nunca declara uma operação lucrativa só porque a receita por km é
 * positiva, e nunca usa média simples para consolidar viagens/veículos com
 * distâncias diferentes (usa sempre receita total ÷ distância total).
 *
 * Atua como coordenadora: reutiliza `calcularMargem` (modo `MARGEM_POR_KM`)
 * para todo o núcleo financeiro (receita líquida, deduções, custo, lucro,
 * margem, receita/custo/lucro por km via `quilometragemTotal`) em vez de
 * reimplementar essas fórmulas — a receita já é conhecida neste ponto (não
 * está sendo resolvida, como em `calcular_valor_minimo_frete`), então a
 * resolução de imposto/comissão/descontos/devoluções é delegada
 * integralmente a `calcularMargem` via `resolverValorOuAliquota` interna
 * daquela ferramenta. Reutiliza `calcularValorMinimoFrete` para obter a
 * receita mínima por km (ponto de equilíbrio ou margem-alvo) quando não
 * informada diretamente. Reutiliza `calcularCpk` (modo `CPK_PNEUS` como
 * divisor genérico valor ÷ km) para toda divisão adicional que
 * `calcularMargem` não expõe (receita bruta por km, receita por km
 * carregado, receita por km de retorno, tonelada-km, por dia, por veículo,
 * por viagem) — nunca reimplementa a lógica de divisão seguro contra zero.
 *
 * Aceita o custo de `calcular-custo-viagem.ts` via `resumoCustoViagem`
 * (mesma interface reexportada por `calcular-margem.ts`), o CPK de
 * `calcular-cpk.ts` via `resumoCpk` (tipo reexportado por
 * `calcular-valor-minimo-frete.ts` — não duplicado aqui) e um resumo
 * normalizado e desacoplado de `analisar-frete.ts` via `resumoAnaliseFrete`
 * — sem importar aquele módulo por valor, para não criar dependência
 * circular; só o tipo `EstrategiaSobreposicaoDeducao` é importado de lá
 * (mesmo conceito reaproveitado por `calcular-valor-minimo-frete.ts`).
 *
 * Sem APIs externas nesta fase. Nunca assume receita, distância, retorno,
 * impostos, comissão, custo, CPK, margem mínima, peso ou quantidade de
 * viagens não informados.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

const CASAS_DECIMAIS_TONELADA_KM_PADRAO = 4;

/** Tolerância padrão (em % do indicador) para não tratar ruído de ponto flutuante como classificação incorreta. */
const TOLERANCIA_CLASSIFICACAO_PERCENTUAL_PADRAO = 0.5;

const LIMITACOES_PADRAO: string[] = [
  "Esta ferramenta não calcula distância, receita, custo, CPK, impostos, comissão, retorno ou período automaticamente — todos os valores vêm do que foi informado.",
  'A receita por km carregado distribui a receita apenas pelos km carregados/remunerados — a receita efetiva sobre toda a operação (incluindo o retorno vazio) é sempre a "receita por km total", nunca a por km carregado.',
  "Uma receita por km positiva não significa operação lucrativa — a classificação de rentabilidade só é feita quando há custo ou CPK informado; sem eles, a análise financeira fica marcada como não avaliada.",
  "A consolidação de múltiplas viagens/veículos usa sempre receita total ÷ distância total (média ponderada pela distância), nunca a média simples das receitas por km individuais.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoReceitaKm =
  | "RECEITA_BRUTA_POR_KM"
  | "RECEITA_LIQUIDA_POR_KM"
  | "RECEITA_POR_KM_TOTAL"
  | "RECEITA_POR_KM_CARREGADO"
  | "RECEITA_E_CUSTO_POR_KM"
  | "LUCRO_POR_KM"
  | "MARGEM_POR_KM"
  | "RETORNO_VAZIO"
  | "FRETE_COM_RETORNO"
  | "MULTIPLAS_VIAGENS"
  | "MULTIPLOS_VEICULOS"
  | "ANALISE_POR_PERIODO"
  | "PREVISTO_X_REALIZADO"
  | "COMPARACAO_CENARIOS"
  | "COMPARAR_COM_VALOR_MINIMO"
  | "RECEITA_TONELADA_KM";

const MODOS_QUE_EXIGEM_KM_CARREGADO: ModoReceitaKm[] = ["RECEITA_POR_KM_CARREGADO", "RECEITA_TONELADA_KM"];
const MODOS_QUE_EXIGEM_PESO: ModoReceitaKm[] = ["RECEITA_TONELADA_KM"];

export type EstrategiaSobreposicaoReceita = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_TOTAL" | "PRIORIZAR_DETALHADO" | "PRIORIZAR_RECEITA_LIQUIDA_INFORMADA";

/** Mesmo conceito de `EstrategiaSobreposicaoCusto` de `calcular-valor-minimo-frete.ts`, com uma 4ª opção (`PRIORIZAR_CPK`) para o conflito específico "custo total x CPK". Local a este arquivo — a granularidade das fontes de custo é diferente. */
export type EstrategiaSobreposicaoCustoReceitaKm = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_TOTAL" | "PRIORIZAR_CPK" | "PRIORIZAR_DETALHADO";

export type EstrategiaSobreposicaoDistancia = "REJEITAR_SOBREPOSICAO" | "PRIORIZAR_IDA_VOLTA" | "PRIORIZAR_CARREGADA_VAZIA";

export type BaseCalculoPercentuaisReceitaKm = "RECEITA_BRUTA" | "RECEITA_APOS_DESCONTOS" | "RECEITA_APOS_IMPOSTOS" | "VALOR_FIXO";

export type TipoPeriodoReceitaKm = "DIA" | "SEMANA" | "MES" | "ANO" | "PERIODO_PERSONALIZADO";

/** Resumo normalizado de `calcular-margem.ts` como fonte de custo — não importa `CalcularMargemResultado` inteiro, só o campo relevante. */
export interface ResumoMargemParaCusto {
  custoTotalFinal?: number;
}

/** Resumo normalizado e desacoplado de `analisar-frete.ts` — evita importar aquele módulo por valor. */
export interface ResumoAnaliseFreteParaReceitaKm {
  receitaBrutaTotal?: number;
  custoTotal?: number;
  distanciaTotalKm?: number;
}

/**
 * Conjunto completo de dados usado pelo cálculo direto, por cada cenário em
 * `COMPARACAO_CENARIOS` e pelos blocos `previsto`/`realizado`.
 */
export interface DadosReceitaKmVariante {
  identificacao?: string;
  descricao?: string;
  origem?: string;
  destino?: string;
  periodoInicio?: string;
  periodoFim?: string;
  tipoPeriodo?: TipoPeriodoReceitaKm;

  /** Alternativa 1: receita bruta total já pronta. */
  receitaBruta?: number;
  /** Alternativa 2: receita separada por trecho. */
  receitaIda?: number;
  receitaVolta?: number;
  receitasAdicionais?: number;
  /** Alternativa 3 (bypassa a resolução de deduções abaixo): receita líquida já calculada. */
  receitaLiquidaInformada?: number;
  /** Alternativa 4: resumo normalizado de `analisar-frete.ts`. */
  resumoAnaliseFrete?: ResumoAnaliseFreteParaReceitaKm;
  /** Alternativa 5: valor por unidade × quantidade. */
  valorPorUnidade?: number;
  quantidadeUnidades?: number;
  /** Alternativa 6: valor por tonelada (usa `pesoCargaToneladas`, abaixo). */
  valorPorTonelada?: number;
  /** Alternativa 7: valor por km informado direto (usa a distância carregada, ou total). */
  valorPorKmInformado?: number;

  descontos?: number;
  devolucoes?: number;
  impostoValor?: number;
  impostoPercentual?: number;
  comissaoValor?: number;
  comissaoPercentual?: number;
  taxaPlataformaValor?: number;
  taxaPlataformaPercentual?: number;
  outrasDeducoesValor?: number;
  outrasDeducoesPercentual?: number;

  distanciaIdaKm?: number;
  distanciaVoltaKm?: number;
  distanciaAdicionalKm?: number;
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;

  /** Alternativa 1: custo total já pronto. */
  custoTotal?: number;
  /** Alternativa 2: custo por km, multiplicado pela distância total. */
  custoPorKm?: number;
  /** Alternativa 3: CPK total (R$/km), multiplicado pela distância total. */
  cpkTotal?: number;
  /** Alternativa 4: resultado resumido de `calcular-custo-viagem.ts`. */
  resumoCustoViagem?: ResumoCustoViagem;
  /** Alternativa 5: resultado resumido de `calcular-cpk.ts`. */
  resumoCpk?: ResumoCpkParaCusto;
  /** Alternativa 6: resultado resumido de `calcular-margem.ts`. */
  resumoMargem?: ResumoMargemParaCusto;

  valorMinimoPorKm?: number;
  valorMinimoTotal?: number;
  margemAlvoPercentual?: number;

  pesoCargaToneladas?: number;
  quantidadeViagens?: number;
  quantidadeVeiculos?: number;
  quantidadeDiasOperados?: number;
}

export interface CenarioReceitaKm extends DadosReceitaKmVariante {
  id?: string;
  nome?: string;
}

/** Entrada por viagem, para `MULTIPLAS_VIAGENS`. */
export interface ViagemReceitaKm {
  identificacaoViagem?: string;
  origem?: string;
  destino?: string;
  data?: string;
  receitaBruta?: number;
  receitaLiquidaInformada?: number;
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  custoTotal?: number;
  custoPorKm?: number;
  pesoCargaToneladas?: number;
  quantidadeVeiculos?: number;
  observacoes?: string;
}

/** Entrada por veículo, para `MULTIPLOS_VEICULOS`. */
export interface VeiculoReceitaKm {
  identificacaoVeiculo?: string;
  placa?: string;
  tipoVeiculo?: string;
  receitaBruta?: number;
  receitaLiquidaInformada?: number;
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  custoTotal?: number;
  cpkTotal?: number;
  quantidadeViagens?: number;
  diasOperados?: number;
  observacoes?: string;
}

export interface CalcularReceitaKmEntrada extends DadosReceitaKmVariante {
  modo: ModoReceitaKm;

  /** Usado apenas em COMPARACAO_CENARIOS — ao menos 2 cenários. */
  cenarios?: CenarioReceitaKm[];
  /** Usado apenas em MULTIPLAS_VIAGENS. */
  viagens?: ViagemReceitaKm[];
  /** Usado apenas em MULTIPLOS_VEICULOS. */
  veiculos?: VeiculoReceitaKm[];
  /** Usados apenas em PREVISTO_X_REALIZADO. */
  previsto?: DadosReceitaKmVariante;
  realizado?: DadosReceitaKmVariante;

  estrategiaSobreposicaoReceita?: EstrategiaSobreposicaoReceita;
  estrategiaSobreposicaoDeducao?: EstrategiaSobreposicaoDeducao;
  estrategiaSobreposicaoCusto?: EstrategiaSobreposicaoCustoReceitaKm;
  estrategiaSobreposicaoDistancia?: EstrategiaSobreposicaoDistancia;
  baseCalculoPercentuais?: BaseCalculoPercentuaisReceitaKm;
  toleranciaClassificacaoPercentual?: number;

  casasDecimais?: number;
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type ClassificacaoReceitaKm =
  | "ABAIXO_DO_CUSTO"
  | "PONTO_DE_EQUILIBRIO"
  | "ABAIXO_DO_VALOR_MINIMO"
  | "ACIMA_DO_CUSTO"
  | "ATINGE_VALOR_MINIMO"
  | "ACIMA_DO_VALOR_MINIMO"
  | "DADOS_INSUFICIENTES";

export interface ImpactoRetornoVazioReceitaKm {
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  percentualKmVazio?: number;
  receitaPorKmTotal?: number;
  receitaPorKmCarregado?: number;
  diferencaPorKm?: number;
}

export interface ItemRankingReceitaKm {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface ResultadoCenarioReceitaKm extends ResultadoFerramentaBase {
  id: string;
  nome: string;
  receitaBrutaTotal?: number;
  receitaLiquida?: number;
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  percentualKmVazio?: number;
  receitaBrutaPorKm?: number;
  receitaLiquidaPorKm?: number;
  custoPorKm?: number;
  lucroPorKm?: number;
  margemPercentual?: number;
  receitaMinimaPorKm?: number;
  diferencaParaMinimoPorKm?: number;
  nivelCompletude: NivelCompletude;
}

export interface ComparacaoCenariosReceitaKm {
  cenarios: ResultadoCenarioReceitaKm[];
  rankingPorMaiorReceitaLiquidaPorKm: ItemRankingReceitaKm[];
  rankingPorMaiorLucroPorKm: ItemRankingReceitaKm[];
  rankingPorMaiorMargem: ItemRankingReceitaKm[];
  rankingPorMenorPercentualKmVazio: ItemRankingReceitaKm[];
  rankingPorMaiorReceitaTotal: ItemRankingReceitaKm[];
  alertas: string[];
}

export interface DiferencaReceitaKm {
  previsto?: number;
  realizado?: number;
  diferenca?: number;
  diferencaPercentual?: number;
}

export interface PrevistoRealizadoReceitaKm {
  receitaPorKm?: DiferencaReceitaKm;
  receitaTotal?: DiferencaReceitaKm;
  distanciaTotal?: DiferencaReceitaKm;
  custoTotal?: DiferencaReceitaKm;
  lucroPorKm?: DiferencaReceitaKm;
  margemPercentual?: DiferencaReceitaKm;
  principalDesvio?: string;
  alertas: string[];
}

export interface ResultadoConsolidadoReceitaKm {
  quantidadeRegistros: number;
  receitaBrutaConsolidada?: number;
  receitaLiquidaConsolidada?: number;
  distanciaTotalConsolidada?: number;
  distanciaCarregadaConsolidada?: number;
  distanciaVaziaConsolidada?: number;
  custoTotalConsolidado?: number;
  lucroTotalConsolidado?: number;
  receitaPorKmConsolidada?: number;
  custoPorKmConsolidado?: number;
  lucroPorKmConsolidado?: number;
  margemConsolidadaPercentual?: number;
  percentualKmVazioConsolidado?: number;
  resultadosIndividuais: ResultadoCenarioReceitaKm[];
  rankingPorMaiorReceitaPorKm: ItemRankingReceitaKm[];
  rankingPorMaiorLucroPorKm: ItemRankingReceitaKm[];
  registrosAbaixoDoCusto: string[];
  registrosAbaixoDoValorMinimo: string[];
  melhorResultadoPorReceitaKm?: string;
  melhorResultadoPorLucroKm?: string;
  piorResultado?: string;
  alertas: string[];
}

export interface CalcularReceitaKmResultado extends ResultadoFerramentaBase {
  modo: ModoReceitaKm;
  identificacao?: string;
  descricao?: string;
  origem?: string;
  destino?: string;

  receitaBrutaTotal?: number;
  deducoesTotais?: number;
  receitaLiquida?: number;

  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  percentualKmVazio?: number;

  receitaBrutaPorKm?: number;
  receitaLiquidaPorKm?: number;
  receitaPorKmCarregado?: number;
  receitaPorKmRetorno?: number;

  custoTotal?: number;
  custoPorKm?: number;
  cpkTotal?: number;

  lucroTotal?: number;
  lucroPorKm?: number;
  margemPercentual?: number;

  indiceCoberturaCpk?: number;
  diferencaReceitaCpkPorKm?: number;

  receitaMinimaPorKm?: number;
  diferencaParaMinimoPorKm?: number;
  valorAdicionalNecessario?: number;

  receitaPorToneladaKm?: number;
  custoPorToneladaKm?: number;
  lucroPorToneladaKm?: number;

  receitaPorViagem?: number;
  receitaPorVeiculo?: number;
  receitaPorDia?: number;
  lucroPorDia?: number;
  kmPorDia?: number;

  impactoRetornoVazio?: ImpactoRetornoVazioReceitaKm;

  consolidadoViagens?: ResultadoConsolidadoReceitaKm;
  consolidadoVeiculos?: ResultadoConsolidadoReceitaKm;
  comparacaoCenarios?: ComparacaoCenariosReceitaKm;
  previstoRealizado?: PrevistoRealizadoReceitaKm;

  classificacao?: ClassificacaoReceitaKm;
  nivelCompletude: NivelCompletude;
  dadosPresentes: string[];
  dadosFaltantesInformativo: string[];
  indicadoresNaoAvaliados: string[];
  limitacoes: string[];
  memoriaCalculo: string[];
}

// ---------------------------------------------------------------------------
// Casas decimais
// ---------------------------------------------------------------------------

interface CasasDecimaisReceitaKm {
  moeda: number;
  percentual: number;
  receitaPorKm: number;
  distancia: number;
  toneladaKm: number;
  peso: number;
}

function casasDecimaisDe(entrada: CalcularReceitaKmEntrada): CasasDecimaisReceitaKm {
  const override = entrada.casasDecimais;
  return {
    moeda: override ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    percentual: override ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    receitaPorKm: override ?? CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO,
    distancia: override ?? CASAS_DECIMAIS_DISTANCIA_PADRAO,
    toneladaKm: override ?? CASAS_DECIMAIS_TONELADA_KM_PADRAO,
    peso: override ?? CASAS_DECIMAIS_PESO_PADRAO,
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
// Validação
// ---------------------------------------------------------------------------

function coletarCamposNumericos(v: DadosReceitaKmVariante, rotulo: string): Array<[string, number | undefined]> {
  return [
    [`${rotulo}.receitaBruta`, v.receitaBruta],
    [`${rotulo}.receitaIda`, v.receitaIda],
    [`${rotulo}.receitaVolta`, v.receitaVolta],
    [`${rotulo}.receitasAdicionais`, v.receitasAdicionais],
    [`${rotulo}.receitaLiquidaInformada`, v.receitaLiquidaInformada],
    [`${rotulo}.valorPorUnidade`, v.valorPorUnidade],
    [`${rotulo}.quantidadeUnidades`, v.quantidadeUnidades],
    [`${rotulo}.valorPorTonelada`, v.valorPorTonelada],
    [`${rotulo}.valorPorKmInformado`, v.valorPorKmInformado],
    [`${rotulo}.descontos`, v.descontos],
    [`${rotulo}.devolucoes`, v.devolucoes],
    [`${rotulo}.impostoValor`, v.impostoValor],
    [`${rotulo}.comissaoValor`, v.comissaoValor],
    [`${rotulo}.taxaPlataformaValor`, v.taxaPlataformaValor],
    [`${rotulo}.outrasDeducoesValor`, v.outrasDeducoesValor],
    [`${rotulo}.distanciaIdaKm`, v.distanciaIdaKm],
    [`${rotulo}.distanciaVoltaKm`, v.distanciaVoltaKm],
    [`${rotulo}.distanciaAdicionalKm`, v.distanciaAdicionalKm],
    [`${rotulo}.distanciaTotalKm`, v.distanciaTotalKm],
    [`${rotulo}.distanciaCarregadaKm`, v.distanciaCarregadaKm],
    [`${rotulo}.distanciaVaziaKm`, v.distanciaVaziaKm],
    [`${rotulo}.custoTotal`, v.custoTotal],
    [`${rotulo}.custoPorKm`, v.custoPorKm],
    [`${rotulo}.cpkTotal`, v.cpkTotal],
    [`${rotulo}.valorMinimoPorKm`, v.valorMinimoPorKm],
    [`${rotulo}.valorMinimoTotal`, v.valorMinimoTotal],
    [`${rotulo}.pesoCargaToneladas`, v.pesoCargaToneladas],
    [`${rotulo}.quantidadeViagens`, v.quantidadeViagens],
    [`${rotulo}.quantidadeVeiculos`, v.quantidadeVeiculos],
    [`${rotulo}.quantidadeDiasOperados`, v.quantidadeDiasOperados],
  ];
}

function validarVariante(v: DadosReceitaKmVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) erros.push(`O campo "${campo}" não pode ser negativo.`);
  }

  for (const [campo, valor] of [
    [`${rotulo}.impostoPercentual`, v.impostoPercentual],
    [`${rotulo}.comissaoPercentual`, v.comissaoPercentual],
    [`${rotulo}.taxaPlataformaPercentual`, v.taxaPlataformaPercentual],
    [`${rotulo}.outrasDeducoesPercentual`, v.outrasDeducoesPercentual],
    [`${rotulo}.margemAlvoPercentual`, v.margemAlvoPercentual],
  ] as Array<[string, number | undefined]>) {
    if (valor !== undefined && (valor < 0 || valor > 100)) erros.push(`"${campo}" deve estar entre 0 e 100.`);
  }

  // Sobreposição: receita total x receitas detalhadas.
  const temReceitaTotal = v.receitaBruta !== undefined;
  const temReceitaDetalhada = v.receitaIda !== undefined || v.receitaVolta !== undefined;
  if (temReceitaTotal && temReceitaDetalhada) {
    erros.push(`${rotulo}: receita informada tanto por "receitaBruta" quanto por "receitaIda"/"receitaVolta" — conflito tratado em resolverReceita (verifique estrategiaSobreposicaoReceita).`);
  }

  // Sobreposição: receita líquida informada + deduções recalculadas.
  const temDeducaoFresca =
    v.impostoValor !== undefined ||
    v.impostoPercentual !== undefined ||
    v.comissaoValor !== undefined ||
    v.comissaoPercentual !== undefined ||
    v.taxaPlataformaValor !== undefined ||
    v.taxaPlataformaPercentual !== undefined ||
    v.outrasDeducoesValor !== undefined ||
    v.outrasDeducoesPercentual !== undefined ||
    v.descontos !== undefined ||
    v.devolucoes !== undefined;
  if (v.receitaLiquidaInformada !== undefined && (temReceitaTotal || temReceitaDetalhada || temDeducaoFresca)) {
    erros.push(`${rotulo}: "receitaLiquidaInformada" foi informado junto de receita bruta/detalhada ou de deduções — risco de dedução duplicada (verifique estrategiaSobreposicaoReceita).`);
  }

  // Sobreposição: custo total x custo por km x CPK x detalhado.
  const fontesCusto = [v.custoTotal !== undefined, v.custoPorKm !== undefined, v.cpkTotal !== undefined, v.resumoCustoViagem?.custoTotal !== undefined, v.resumoCpk?.cpk !== undefined, v.resumoMargem?.custoTotalFinal !== undefined].filter(Boolean).length;
  if (fontesCusto > 1) {
    erros.push(`${rotulo}: custo informado por mais de uma fonte (custoTotal/custoPorKm/cpkTotal/resumoCustoViagem/resumoCpk/resumoMargem) — conflito tratado em resolverCusto (verifique estrategiaSobreposicaoCusto).`);
  }

  // Distância carregada/vazia maior que a distância total explícita.
  if (v.distanciaTotalKm !== undefined) {
    if (v.distanciaCarregadaKm !== undefined && v.distanciaCarregadaKm > v.distanciaTotalKm) {
      erros.push(`${rotulo}: "distanciaCarregadaKm" (${v.distanciaCarregadaKm}) é maior que "distanciaTotalKm" (${v.distanciaTotalKm}).`);
    }
    if (v.distanciaVaziaKm !== undefined && v.distanciaVaziaKm > v.distanciaTotalKm) {
      erros.push(`${rotulo}: "distanciaVaziaKm" (${v.distanciaVaziaKm}) é maior que "distanciaTotalKm" (${v.distanciaTotalKm}).`);
    }
    if (v.distanciaCarregadaKm !== undefined && v.distanciaVaziaKm !== undefined) {
      const soma = v.distanciaCarregadaKm + v.distanciaVaziaKm;
      if (Math.abs(soma - v.distanciaTotalKm) > 0.01) {
        erros.push(`${rotulo}: "distanciaCarregadaKm" + "distanciaVaziaKm" (${soma}) é incompatível com "distanciaTotalKm" (${v.distanciaTotalKm}).`);
      }
    }
  }

  return erros;
}

function validarEstruturaTopo(entrada: CalcularReceitaKmEntrada): string[] {
  const erros: string[] = [];

  if (entrada.modo === "COMPARACAO_CENARIOS" && (!entrada.cenarios || entrada.cenarios.length < 2)) {
    erros.push("COMPARACAO_CENARIOS exige ao menos dois cenários em \"cenarios\".");
  }
  if (entrada.modo === "PREVISTO_X_REALIZADO" && (!entrada.previsto || !entrada.realizado)) {
    erros.push('PREVISTO_X_REALIZADO exige os blocos "previsto" e "realizado" completos.');
  }
  if (entrada.modo === "MULTIPLAS_VIAGENS") {
    if (!entrada.viagens || entrada.viagens.length === 0) {
      erros.push('MULTIPLAS_VIAGENS exige ao menos uma viagem em "viagens".');
    }
    if (entrada.viagens && entrada.viagens.length > 0 && (entrada.receitaBruta !== undefined || entrada.distanciaTotalKm !== undefined)) {
      erros.push('MULTIPLAS_VIAGENS: "viagens" foi informado junto de totais consolidados diretos ("receitaBruta"/"distanciaTotalKm") — informe apenas uma fonte.');
    }
  }
  if (entrada.modo === "MULTIPLOS_VEICULOS") {
    if (!entrada.veiculos || entrada.veiculos.length === 0) {
      erros.push('MULTIPLOS_VEICULOS exige ao menos um veículo em "veiculos".');
    }
    if (entrada.veiculos && entrada.veiculos.length > 0 && (entrada.receitaBruta !== undefined || entrada.distanciaTotalKm !== undefined)) {
      erros.push('MULTIPLOS_VEICULOS: "veiculos" foi informado junto de totais consolidados diretos ("receitaBruta"/"distanciaTotalKm") — informe apenas uma fonte.');
    }
  }
  if (MODOS_QUE_EXIGEM_KM_CARREGADO.includes(entrada.modo) && !(entrada.distanciaCarregadaKm !== undefined && entrada.distanciaCarregadaKm > 0)) {
    erros.push(`O modo ${entrada.modo} exige "distanciaCarregadaKm" maior que zero.`);
  }
  if (MODOS_QUE_EXIGEM_PESO.includes(entrada.modo) && !(entrada.pesoCargaToneladas !== undefined && entrada.pesoCargaToneladas > 0)) {
    erros.push(`O modo ${entrada.modo} exige "pesoCargaToneladas" maior que zero.`);
  }
  if (
    !["MULTIPLAS_VIAGENS", "MULTIPLOS_VEICULOS", "COMPARACAO_CENARIOS", "PREVISTO_X_REALIZADO"].includes(entrada.modo) &&
    entrada.distanciaTotalKm === undefined &&
    entrada.distanciaIdaKm === undefined &&
    entrada.distanciaVoltaKm === undefined &&
    !(entrada.distanciaCarregadaKm !== undefined && entrada.distanciaVaziaKm !== undefined)
  ) {
    erros.push(`O modo ${entrada.modo} exige uma distância total (direta, por ida/volta, ou por carregada+vazia).`);
  } else if (entrada.distanciaTotalKm !== undefined && entrada.distanciaTotalKm <= 0 && !["MULTIPLAS_VIAGENS", "MULTIPLOS_VEICULOS", "COMPARACAO_CENARIOS", "PREVISTO_X_REALIZADO"].includes(entrada.modo)) {
    erros.push(`O modo ${entrada.modo} exige "distanciaTotalKm" maior que zero.`);
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Resolução de distância
// ---------------------------------------------------------------------------

interface DistanciaResolvida {
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  alertas: string[];
  premissas: string[];
  erro?: string;
}

function resolverDistancia(v: DadosReceitaKmVariante, estrategia: EstrategiaSobreposicaoDistancia, rotulo: string): DistanciaResolvida {
  const alertas: string[] = [];
  const premissas: string[] = [];

  const candidatos: Array<{ chave: string; rotulo: string; valor: number }> = [];
  if (v.distanciaTotalKm !== undefined) candidatos.push({ chave: "total", rotulo: "distanciaTotalKm", valor: v.distanciaTotalKm });
  if (v.distanciaIdaKm !== undefined || v.distanciaVoltaKm !== undefined || v.distanciaAdicionalKm !== undefined) {
    candidatos.push({ chave: "idaVolta", rotulo: "distanciaIdaKm + distanciaVoltaKm + distanciaAdicionalKm", valor: (v.distanciaIdaKm ?? 0) + (v.distanciaVoltaKm ?? 0) + (v.distanciaAdicionalKm ?? 0) });
  }
  if (v.distanciaCarregadaKm !== undefined && v.distanciaVaziaKm !== undefined) {
    candidatos.push({ chave: "carregadaVazia", rotulo: "distanciaCarregadaKm + distanciaVaziaKm", valor: v.distanciaCarregadaKm + v.distanciaVaziaKm });
  }

  let distanciaTotalKm: number | undefined;
  if (candidatos.length === 0) {
    distanciaTotalKm = undefined;
  } else if (candidatos.length === 1) {
    distanciaTotalKm = candidatos[0].valor;
  } else {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return { alertas, premissas, erro: `${rotulo}: distância total informada por mais de uma forma (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoDistancia".` };
    }
    const preferida = estrategia === "PRIORIZAR_IDA_VOLTA" ? candidatos.find((c) => c.chave === "idaVolta") : candidatos.find((c) => c.chave === "carregadaVazia");
    const vencedor = preferida ?? candidatos[0];
    distanciaTotalKm = vencedor.valor;
    alertas.push(`${rotulo}: sobreposição de distância resolvida por "${estrategia}" — usado ${vencedor.rotulo}, ignoradas as demais formas.`);
  }

  return { distanciaTotalKm, distanciaCarregadaKm: v.distanciaCarregadaKm, distanciaVaziaKm: v.distanciaVaziaKm, alertas, premissas };
}

// ---------------------------------------------------------------------------
// Resolução de receita
// ---------------------------------------------------------------------------

interface ReceitaResolvida {
  receitaBrutaParaMargem?: number;
  receitaAdicionalParaMargem?: number;
  usaReceitaLiquidaInformada: boolean;
  origem?: string;
  alertas: string[];
  premissas: string[];
  erro?: string;
}

function resolverReceita(v: DadosReceitaKmVariante, distancia: DistanciaResolvida, estrategia: EstrategiaSobreposicaoReceita, rotulo: string): ReceitaResolvida {
  const alertas: string[] = [];
  const premissas: string[] = [];

  const temReceitaTotal = v.receitaBruta !== undefined;
  const temReceitaDetalhada = v.receitaIda !== undefined || v.receitaVolta !== undefined;
  const temDeducaoFresca =
    v.impostoValor !== undefined ||
    v.impostoPercentual !== undefined ||
    v.comissaoValor !== undefined ||
    v.comissaoPercentual !== undefined ||
    v.taxaPlataformaValor !== undefined ||
    v.taxaPlataformaPercentual !== undefined ||
    v.outrasDeducoesValor !== undefined ||
    v.outrasDeducoesPercentual !== undefined ||
    v.descontos !== undefined ||
    v.devolucoes !== undefined;

  if (v.receitaLiquidaInformada !== undefined) {
    const conflito = temReceitaTotal || temReceitaDetalhada || temDeducaoFresca;
    if (conflito) {
      if (estrategia === "REJEITAR_SOBREPOSICAO") {
        return { usaReceitaLiquidaInformada: false, alertas, premissas, erro: `${rotulo}: "receitaLiquidaInformada" em conflito com receita bruta/detalhada ou deduções. Informe apenas uma forma, ou defina "estrategiaSobreposicaoReceita".` };
      }
      if (estrategia === "PRIORIZAR_RECEITA_LIQUIDA_INFORMADA") {
        alertas.push(`${rotulo}: sobreposição resolvida por "PRIORIZAR_RECEITA_LIQUIDA_INFORMADA" — usado o valor já líquido, ignoradas receita detalhada e deduções.`);
        return { receitaBrutaParaMargem: v.receitaLiquidaInformada, usaReceitaLiquidaInformada: true, origem: "receitaLiquidaInformada", alertas, premissas };
      }
      alertas.push(`${rotulo}: sobreposição resolvida por "${estrategia}" — ignorado "receitaLiquidaInformada", recalculada a receita líquida a partir da receita bruta/detalhada e das deduções.`);
    } else {
      return { receitaBrutaParaMargem: v.receitaLiquidaInformada, usaReceitaLiquidaInformada: true, origem: "receitaLiquidaInformada", alertas, premissas };
    }
  }

  const candidatos: Array<{ rotulo: string; valor: number }> = [];
  if (temReceitaTotal) candidatos.push({ rotulo: "receitaBruta", valor: v.receitaBruta as number });
  if (temReceitaDetalhada) candidatos.push({ rotulo: "receitaIda + receitaVolta", valor: (v.receitaIda ?? 0) + (v.receitaVolta ?? 0) });
  if (v.resumoAnaliseFrete?.receitaBrutaTotal !== undefined) candidatos.push({ rotulo: "resumoAnaliseFrete.receitaBrutaTotal", valor: v.resumoAnaliseFrete.receitaBrutaTotal });
  if (v.valorPorUnidade !== undefined && v.quantidadeUnidades !== undefined) candidatos.push({ rotulo: "valorPorUnidade × quantidadeUnidades", valor: v.valorPorUnidade * v.quantidadeUnidades });
  if (v.valorPorTonelada !== undefined && v.pesoCargaToneladas !== undefined) candidatos.push({ rotulo: "valorPorTonelada × pesoCargaToneladas", valor: v.valorPorTonelada * v.pesoCargaToneladas });
  if (v.valorPorKmInformado !== undefined) {
    const divisor = distancia.distanciaCarregadaKm ?? distancia.distanciaTotalKm;
    if (divisor !== undefined && divisor > 0) candidatos.push({ rotulo: "valorPorKmInformado × distância", valor: v.valorPorKmInformado * divisor });
  }

  if (candidatos.length === 0) return { usaReceitaLiquidaInformada: false, alertas, premissas };

  if (candidatos.length > 1 && estrategia === "REJEITAR_SOBREPOSICAO") {
    return { usaReceitaLiquidaInformada: false, alertas, premissas, erro: `${rotulo}: receita informada por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoReceita".` };
  }
  if (candidatos.length > 1) {
    alertas.push(`${rotulo}: mais de uma fonte de receita informada (${candidatos.map((c) => c.rotulo).join(", ")}) — usada "${candidatos[0].rotulo}" por ordem de prioridade.`);
  }

  return { receitaBrutaParaMargem: candidatos[0].valor, receitaAdicionalParaMargem: v.receitasAdicionais, usaReceitaLiquidaInformada: false, origem: candidatos[0].rotulo, alertas, premissas };
}

// ---------------------------------------------------------------------------
// Resolução de custo (também usada para a comparação com CPK)
// ---------------------------------------------------------------------------

interface CustoResolvido {
  custoTotal?: number;
  custoPorKmOrigemDireta: boolean;
  alertas: string[];
  erro?: string;
}

function resolverCusto(v: DadosReceitaKmVariante, distanciaTotalKm: number | undefined, estrategia: EstrategiaSobreposicaoCustoReceitaKm, rotulo: string): CustoResolvido {
  const alertas: string[] = [];
  const candidatos: Array<{ chave: string; rotulo: string; valor: number }> = [];

  if (v.custoTotal !== undefined) candidatos.push({ chave: "total", rotulo: "custoTotal", valor: v.custoTotal });
  if (v.resumoCustoViagem?.custoTotal !== undefined) candidatos.push({ chave: "total", rotulo: "resumoCustoViagem.custoTotal", valor: v.resumoCustoViagem.custoTotal });
  if (v.resumoMargem?.custoTotalFinal !== undefined) candidatos.push({ chave: "total", rotulo: "resumoMargem.custoTotalFinal", valor: v.resumoMargem.custoTotalFinal });
  if (v.resumoAnaliseFrete?.custoTotal !== undefined) candidatos.push({ chave: "total", rotulo: "resumoAnaliseFrete.custoTotal", valor: v.resumoAnaliseFrete.custoTotal });
  if (v.custoPorKm !== undefined && distanciaTotalKm !== undefined && distanciaTotalKm > 0) candidatos.push({ chave: "cpk", rotulo: "custoPorKm × distância", valor: v.custoPorKm * distanciaTotalKm });
  if (v.cpkTotal !== undefined && distanciaTotalKm !== undefined && distanciaTotalKm > 0) candidatos.push({ chave: "cpk", rotulo: "cpkTotal × distância", valor: v.cpkTotal * distanciaTotalKm });
  if (v.resumoCpk?.cpk !== undefined && distanciaTotalKm !== undefined && distanciaTotalKm > 0) candidatos.push({ chave: "cpk", rotulo: "resumoCpk.cpk × distância", valor: v.resumoCpk.cpk * distanciaTotalKm });

  if (candidatos.length === 0) return { custoTotal: undefined, custoPorKmOrigemDireta: false, alertas: [] };

  if (candidatos.length > 1) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return { custoTotal: undefined, custoPorKmOrigemDireta: false, alertas: [], erro: `${rotulo}: custo informado por mais de uma fonte (${candidatos.map((c) => c.rotulo).join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicaoCusto".` };
    }
    let vencedor = candidatos[0];
    if (estrategia === "PRIORIZAR_CPK") vencedor = candidatos.find((c) => c.chave === "cpk") ?? candidatos[0];
    if (estrategia === "PRIORIZAR_TOTAL") vencedor = candidatos.find((c) => c.chave === "total") ?? candidatos[0];
    alertas.push(`${rotulo}: sobreposição de custo resolvida por "${estrategia}" — usado ${vencedor.rotulo}, ignoradas as demais fontes.`);
    return { custoTotal: vencedor.valor, custoPorKmOrigemDireta: vencedor.chave === "cpk", alertas };
  }

  return { custoTotal: candidatos[0].valor, custoPorKmOrigemDireta: candidatos[0].chave === "cpk", alertas };
}

// ---------------------------------------------------------------------------
// Núcleo de cálculo
// ---------------------------------------------------------------------------

interface AgregacaoReceitaKm {
  receitaBrutaTotal?: number;
  deducoesTotais?: number;
  receitaLiquida?: number;

  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  distanciaVaziaKm?: number;
  percentualKmVazio?: number;

  receitaBrutaPorKm?: number;
  receitaLiquidaPorKm?: number;
  receitaPorKmCarregado?: number;
  receitaPorKmRetorno?: number;

  custoTotal?: number;
  custoPorKm?: number;
  cpkTotal?: number;

  lucroTotal?: number;
  lucroPorKm?: number;
  margemPercentual?: number;

  indiceCoberturaCpk?: number;
  diferencaReceitaCpkPorKm?: number;

  receitaMinimaPorKm?: number;
  diferencaParaMinimoPorKm?: number;
  valorAdicionalNecessario?: number;

  receitaPorToneladaKm?: number;
  custoPorToneladaKm?: number;
  lucroPorToneladaKm?: number;

  receitaPorViagem?: number;
  receitaPorVeiculo?: number;
  receitaPorDia?: number;
  lucroPorDia?: number;
  kmPorDia?: number;

  impactoRetornoVazio?: ImpactoRetornoVazioReceitaKm;

  classificacao?: ClassificacaoReceitaKm;

  dadosPresentes: string[];
  indicadoresNaoAvaliados: string[];
  alertas: string[];
  premissas: string[];
  dadosFaltantes: string[];
  errosValidacao: string[];

  receitaValida: boolean;
  distanciaValida: boolean;
}

interface ConfigReceitaKm {
  estrategiaReceita: EstrategiaSobreposicaoReceita;
  estrategiaDeducao: EstrategiaSobreposicaoDeducao;
  estrategiaCusto: EstrategiaSobreposicaoCustoReceitaKm;
  estrategiaDistancia: EstrategiaSobreposicaoDistancia;
  toleranciaPercentual: number;
  casas: CasasDecimaisReceitaKm;
}

function calcularNucleo(v: DadosReceitaKmVariante, modo: ModoReceitaKm, config: ConfigReceitaKm, rotulo: string): AgregacaoReceitaKm {
  const alertas: string[] = [];
  const premissas: string[] = [];
  const dadosFaltantes: string[] = [];
  const dadosPresentes: string[] = [];
  const indicadoresNaoAvaliados: string[] = [];
  const errosValidacao: string[] = [];

  const distancia = resolverDistancia(v, config.estrategiaDistancia, rotulo);
  if (distancia.erro) errosValidacao.push(distancia.erro);
  alertas.push(...distancia.alertas);
  premissas.push(...distancia.premissas);

  const distanciaTotalKm = distancia.distanciaTotalKm;
  if (distanciaTotalKm === undefined || distanciaTotalKm <= 0) {
    dadosFaltantes.push(`${rotulo}.distanciaTotalKm (direta, ou por ida/volta, ou por carregada+vazia)`);
  } else {
    dadosPresentes.push("distanciaTotalKm");
  }

  const receita = resolverReceita(v, distancia, config.estrategiaReceita, rotulo);
  if (receita.erro) errosValidacao.push(receita.erro);
  alertas.push(...receita.alertas);
  premissas.push(...receita.premissas);

  if (receita.receitaBrutaParaMargem === undefined) {
    dadosFaltantes.push(`${rotulo}.receitaBruta (ou fonte equivalente)`);
  } else {
    dadosPresentes.push("receita");
  }

  if (errosValidacao.length > 0 || dadosFaltantes.length > 0) {
    return {
      dadosPresentes,
      indicadoresNaoAvaliados,
      alertas,
      premissas,
      dadosFaltantes,
      errosValidacao,
      receitaValida: receita.receitaBrutaParaMargem !== undefined,
      distanciaValida: distanciaTotalKm !== undefined && distanciaTotalKm > 0,
    };
  }

  const custo = resolverCusto(v, distanciaTotalKm, config.estrategiaCusto, rotulo);
  if (custo.erro) errosValidacao.push(custo.erro);
  alertas.push(...custo.alertas);
  if (custo.custoTotal !== undefined) dadosPresentes.push("custo");

  if (errosValidacao.length > 0) {
    return {
      dadosPresentes,
      indicadoresNaoAvaliados,
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      receitaValida: true,
      distanciaValida: true,
    };
  }

  // Núcleo financeiro delegado a calcular-margem.ts (MARGEM_POR_KM) — receita
  // já é conhecida neste ponto, então imposto/comissão/descontos/devoluções
  // são resolvidos pela própria calcularMargem via resolverValorOuAliquota.
  const usaReceitaLiquidaInformada = receita.usaReceitaLiquidaInformada;
  const resultadoMargem = calcularMargem({
    modo: "MARGEM_POR_KM",
    receitaBruta: receita.receitaBrutaParaMargem,
    receitaAdicional: usaReceitaLiquidaInformada ? undefined : receita.receitaAdicionalParaMargem,
    descontos: usaReceitaLiquidaInformada ? undefined : v.descontos,
    devolucoes: usaReceitaLiquidaInformada ? undefined : v.devolucoes,
    impostos: usaReceitaLiquidaInformada ? undefined : v.impostoValor,
    aliquotaImpostosPercentual: usaReceitaLiquidaInformada ? undefined : v.impostoPercentual,
    comissoes: usaReceitaLiquidaInformada ? undefined : v.comissaoValor,
    aliquotaComissaoPercentual: usaReceitaLiquidaInformada ? undefined : v.comissaoPercentual,
    outrasDeducoes: usaReceitaLiquidaInformada ? undefined : resolverOutrasDeducoesFlat(v, config.estrategiaDeducao, receita.receitaBrutaParaMargem, rotulo, alertas, premissas),
    // calcularMargem exige custoTotal em todo modo (só PONTO_EQUILIBRIO/MARGEM_ALVO
    // dispensam receita, nunca custo). Quando não há custo real, usa-se 0 apenas
    // para obter a receita líquida/deduções — os campos derivados de custo
    // (custoPorKm/lucroPorKm/margem) são descartados abaixo quando custo.custoTotal
    // for undefined, para nunca sugerir uma rentabilidade não avaliada.
    custoTotal: custo.custoTotal ?? 0,
    quilometragemTotal: distanciaTotalKm,
    quantidadeVeiculos: v.quantidadeVeiculos,
    quantidadeViagens: v.quantidadeViagens,
    estrategiaSobreposicao: "REJEITAR_SOBREPOSICAO",
    casasDecimais: undefined,
  });

  if (!resultadoMargem.sucesso) {
    errosValidacao.push(...resultadoMargem.dadosFaltantes);
    return {
      dadosPresentes,
      indicadoresNaoAvaliados,
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao: errosValidacao.length > 0 ? errosValidacao : [resultadoMargem.mensagemResumo],
      receitaValida: true,
      distanciaValida: true,
    };
  }
  alertas.push(...resultadoMargem.alertas);
  premissas.push(...resultadoMargem.premissas);

  const c = config.casas.moeda;
  const p = config.casas.percentual;
  const rpk = config.casas.receitaPorKm;

  const receitaBrutaTotal = resultadoMargem.receitaBrutaTotal ?? receita.receitaBrutaParaMargem;
  const receitaLiquida = resultadoMargem.receitaLiquida;
  const deducoesTotais = receitaBrutaTotal !== undefined && receitaLiquida !== undefined ? arredondar(receitaBrutaTotal - receitaLiquida, c) : undefined;

  const receitaBrutaPorKm = receitaBrutaTotal !== undefined ? dividirViaCpk(receitaBrutaTotal, distanciaTotalKm as number, rpk) : undefined;
  const receitaLiquidaPorKm = resultadoMargem.receitaPorKm;
  // Só expõe indicadores derivados de custo quando um custo real foi resolvido
  // (custo.custoTotal) — o 0 acima é um placeholder interno, nunca um custo real.
  const custoPorKm = custo.custoTotal !== undefined ? resultadoMargem.custoPorKm : undefined;
  const lucroPorKm = custo.custoTotal !== undefined ? resultadoMargem.lucroPorKm : undefined;
  const lucroTotal = custo.custoTotal !== undefined ? resultadoMargem.lucroLiquidoEstimado : undefined;
  const margemPercentual = custo.custoTotal !== undefined ? resultadoMargem.margemLiquidaPercentual : undefined;
  if (custo.custoTotal === undefined) {
    indicadoresNaoAvaliados.push("custoPorKm", "lucroPorKm", "margemPercentual");
  }

  const distanciaCarregadaKm = distancia.distanciaCarregadaKm;
  const distanciaVaziaKm = distancia.distanciaVaziaKm;
  const percentualKmVazio = distanciaVaziaKm !== undefined && distanciaTotalKm ? arredondar((distanciaVaziaKm / distanciaTotalKm) * 100, p) : undefined;

  let receitaPorKmCarregado: number | undefined;
  if (distanciaCarregadaKm !== undefined && distanciaCarregadaKm > 0 && receitaLiquida !== undefined) {
    receitaPorKmCarregado = dividirViaCpk(receitaLiquida, distanciaCarregadaKm, rpk);
    if (distanciaVaziaKm !== undefined && distanciaVaziaKm > 0) {
      alertas.push("A receita por km carregado distribui a receita apenas pelos km carregados — os km vazios ficam fora desse divisor. Use a receita por km total para o resultado efetivo de toda a operação.");
    }
  }

  let receitaPorKmRetorno: number | undefined;
  if (v.receitaVolta !== undefined && v.distanciaVoltaKm !== undefined && v.distanciaVoltaKm > 0) {
    receitaPorKmRetorno = dividirViaCpk(v.receitaVolta, v.distanciaVoltaKm, rpk);
  }

  // CPK: comparação — usa cpkTotal/resumoCpk/custoPorKm quando informado
  // diretamente; senão deriva do custo total resolvido ÷ distância.
  let cpkParaComparacao: number | undefined;
  if (v.cpkTotal !== undefined) cpkParaComparacao = v.cpkTotal;
  else if (v.resumoCpk?.cpk !== undefined) cpkParaComparacao = v.resumoCpk.cpk;
  else if (v.custoPorKm !== undefined) cpkParaComparacao = v.custoPorKm;
  else if (custo.custoTotal !== undefined) cpkParaComparacao = custoPorKm;

  let indiceCoberturaCpk: number | undefined;
  let diferencaReceitaCpkPorKm: number | undefined;
  if (cpkParaComparacao !== undefined && cpkParaComparacao > 0 && receitaLiquidaPorKm !== undefined) {
    indiceCoberturaCpk = arredondar(receitaLiquidaPorKm / cpkParaComparacao, 4);
    diferencaReceitaCpkPorKm = arredondar(receitaLiquidaPorKm - cpkParaComparacao, rpk);
  }

  // Receita mínima por km — reutiliza calcular-valor-minimo-frete.ts.
  let receitaMinimaPorKm: number | undefined;
  let receitaMinimaTotal: number | undefined;
  if (v.valorMinimoTotal !== undefined) {
    receitaMinimaTotal = v.valorMinimoTotal;
    receitaMinimaPorKm = dividirViaCpk(v.valorMinimoTotal, distanciaTotalKm as number, rpk);
  } else if (v.valorMinimoPorKm !== undefined) {
    receitaMinimaPorKm = v.valorMinimoPorKm;
    receitaMinimaTotal = arredondar(v.valorMinimoPorKm * (distanciaTotalKm as number), c);
  } else if (custo.custoTotal !== undefined && !custo.custoPorKmOrigemDireta) {
    // Só deriva um "valor mínimo" a partir de um custo genuíno (não de um CPK,
    // que é um benchmark de comparação, não necessariamente a meta de preço).
    const resultadoMinimo = calcularValorMinimoFrete({
      modo: v.margemAlvoPercentual !== undefined ? "MARGEM_ALVO" : "PONTO_EQUILIBRIO",
      custoTotal: custo.custoTotal,
      margemAlvoPercentual: v.margemAlvoPercentual,
      distanciaTotalKm,
    });
    if (resultadoMinimo.sucesso) {
      receitaMinimaTotal = resultadoMinimo.valorMinimoComMargem ?? resultadoMinimo.valorPontoEquilibrio;
      receitaMinimaPorKm = resultadoMinimo.valorMinimoPorKm;
      premissas.push(`${rotulo}: receita mínima por km derivada via calcular_valor_minimo_frete (${v.margemAlvoPercentual !== undefined ? "margem-alvo" : "ponto de equilíbrio"}).`);
    }
  }
  if (receitaMinimaTotal !== undefined) {
    premissas.push(`${rotulo}: receita mínima total considerada = ${formatarBRL(receitaMinimaTotal)}.`);
  }

  let diferencaParaMinimoPorKm: number | undefined;
  let valorAdicionalNecessario: number | undefined;
  if (receitaMinimaPorKm !== undefined && receitaLiquidaPorKm !== undefined) {
    diferencaParaMinimoPorKm = arredondar(receitaLiquidaPorKm - receitaMinimaPorKm, rpk);
    valorAdicionalNecessario = arredondar(Math.max(0, (receitaMinimaPorKm - receitaLiquidaPorKm) * (distanciaTotalKm as number)), c);
  }

  // Tonelada-quilômetro.
  let receitaPorToneladaKm: number | undefined;
  let custoPorToneladaKm: number | undefined;
  let lucroPorToneladaKm: number | undefined;
  if (v.pesoCargaToneladas !== undefined && v.pesoCargaToneladas > 0 && distanciaCarregadaKm !== undefined && distanciaCarregadaKm > 0) {
    const divisorToneladaKm = v.pesoCargaToneladas * distanciaCarregadaKm;
    if (receitaLiquida !== undefined) receitaPorToneladaKm = dividirViaCpk(receitaLiquida, divisorToneladaKm, config.casas.toneladaKm);
    if (custo.custoTotal !== undefined) custoPorToneladaKm = dividirViaCpk(custo.custoTotal, divisorToneladaKm, config.casas.toneladaKm);
    if (lucroTotal !== undefined) lucroPorToneladaKm = dividirViaCpk(lucroTotal, divisorToneladaKm, config.casas.toneladaKm);
  } else if (MODOS_QUE_EXIGEM_PESO.includes(modo)) {
    indicadoresNaoAvaliados.push("receitaPorToneladaKm");
  }

  // Médias por viagem/veículo/dia.
  const receitaPorViagem = v.quantidadeViagens !== undefined && v.quantidadeViagens > 0 && receitaLiquida !== undefined ? dividirViaCpk(receitaLiquida, v.quantidadeViagens, c) : undefined;
  const receitaPorVeiculo = v.quantidadeVeiculos !== undefined && v.quantidadeVeiculos > 0 && receitaLiquida !== undefined ? dividirViaCpk(receitaLiquida, v.quantidadeVeiculos, c) : undefined;
  const receitaPorDia = v.quantidadeDiasOperados !== undefined && v.quantidadeDiasOperados > 0 && receitaLiquida !== undefined ? dividirViaCpk(receitaLiquida, v.quantidadeDiasOperados, c) : undefined;
  const lucroPorDia = v.quantidadeDiasOperados !== undefined && v.quantidadeDiasOperados > 0 && lucroTotal !== undefined ? dividirViaCpk(lucroTotal, v.quantidadeDiasOperados, c) : undefined;
  const kmPorDia = v.quantidadeDiasOperados !== undefined && v.quantidadeDiasOperados > 0 ? dividirViaCpk(distanciaTotalKm as number, v.quantidadeDiasOperados, config.casas.distancia) : undefined;

  // Impacto do retorno vazio — apenas diferença de indicador (nunca custo isolado).
  let impactoRetornoVazio: ImpactoRetornoVazioReceitaKm | undefined;
  if (distanciaVaziaKm !== undefined && distanciaVaziaKm > 0 && receitaPorKmCarregado !== undefined && receitaLiquidaPorKm !== undefined) {
    impactoRetornoVazio = {
      distanciaTotalKm: arredondar(distanciaTotalKm as number, config.casas.distancia),
      distanciaCarregadaKm: distanciaCarregadaKm !== undefined ? arredondar(distanciaCarregadaKm, config.casas.distancia) : undefined,
      distanciaVaziaKm: arredondar(distanciaVaziaKm, config.casas.distancia),
      percentualKmVazio,
      receitaPorKmTotal: receitaLiquidaPorKm,
      receitaPorKmCarregado,
      diferencaPorKm: arredondar(receitaPorKmCarregado - receitaLiquidaPorKm, rpk),
    };
  }

  // Classificação.
  let classificacao: ClassificacaoReceitaKm | undefined;
  const baseComparacao = cpkParaComparacao;
  if (receitaLiquidaPorKm === undefined) {
    classificacao = "DADOS_INSUFICIENTES";
  } else if (receitaMinimaPorKm !== undefined) {
    const tol = receitaMinimaPorKm * (config.toleranciaPercentual / 100);
    if (receitaLiquidaPorKm < receitaMinimaPorKm - tol) classificacao = "ABAIXO_DO_VALOR_MINIMO";
    else if (Math.abs(receitaLiquidaPorKm - receitaMinimaPorKm) <= tol) classificacao = "ATINGE_VALOR_MINIMO";
    else classificacao = "ACIMA_DO_VALOR_MINIMO";
  } else if (baseComparacao !== undefined) {
    const tol = baseComparacao * (config.toleranciaPercentual / 100);
    if (receitaLiquidaPorKm < baseComparacao - tol) classificacao = "ABAIXO_DO_CUSTO";
    else if (Math.abs(receitaLiquidaPorKm - baseComparacao) <= tol) classificacao = "PONTO_DE_EQUILIBRIO";
    else classificacao = "ACIMA_DO_CUSTO";
  } else {
    classificacao = "DADOS_INSUFICIENTES";
    indicadoresNaoAvaliados.push("classificacao (sem custo, CPK ou valor mínimo informado)");
  }

  return {
    receitaBrutaTotal: receitaBrutaTotal !== undefined ? arredondar(receitaBrutaTotal, c) : undefined,
    deducoesTotais,
    receitaLiquida: receitaLiquida !== undefined ? arredondar(receitaLiquida, c) : undefined,

    distanciaTotalKm: arredondar(distanciaTotalKm as number, config.casas.distancia),
    distanciaCarregadaKm: distanciaCarregadaKm !== undefined ? arredondar(distanciaCarregadaKm, config.casas.distancia) : undefined,
    distanciaVaziaKm: distanciaVaziaKm !== undefined ? arredondar(distanciaVaziaKm, config.casas.distancia) : undefined,
    percentualKmVazio,

    receitaBrutaPorKm,
    receitaLiquidaPorKm,
    receitaPorKmCarregado,
    receitaPorKmRetorno,

    custoTotal: custo.custoTotal !== undefined ? arredondar(custo.custoTotal, c) : undefined,
    custoPorKm,
    cpkTotal: cpkParaComparacao !== undefined ? arredondar(cpkParaComparacao, rpk) : undefined,

    lucroTotal: lucroTotal !== undefined ? arredondar(lucroTotal, c) : undefined,
    lucroPorKm,
    margemPercentual,

    indiceCoberturaCpk,
    diferencaReceitaCpkPorKm,

    receitaMinimaPorKm,
    diferencaParaMinimoPorKm,
    valorAdicionalNecessario,

    receitaPorToneladaKm,
    custoPorToneladaKm,
    lucroPorToneladaKm,

    receitaPorViagem,
    receitaPorVeiculo,
    receitaPorDia,
    lucroPorDia,
    kmPorDia,

    impactoRetornoVazio,
    classificacao,

    dadosPresentes,
    indicadoresNaoAvaliados,
    alertas,
    premissas,
    dadosFaltantes: [],
    errosValidacao: [],
    receitaValida: true,
    distanciaValida: true,
  };
}

/** Resolve taxaPlataforma + outrasDeducoes num único flat, para caber no campo `outrasDeducoes` (flat-only) de `calcularMargem`. Mesma técnica usada por `analisar-frete.ts` (`resolverDeducoesExtras`). */
function resolverOutrasDeducoesFlat(
  v: DadosReceitaKmVariante,
  estrategiaDeducao: EstrategiaSobreposicaoDeducao,
  receitaBase: number | undefined,
  rotulo: string,
  alertas: string[],
  premissas: string[]
): number | undefined {
  if (
    v.taxaPlataformaValor === undefined &&
    v.taxaPlataformaPercentual === undefined &&
    v.outrasDeducoesValor === undefined &&
    v.outrasDeducoesPercentual === undefined
  ) {
    return undefined;
  }

  let soma = 0;
  for (const [flat, percentual, nome] of [
    [v.taxaPlataformaValor, v.taxaPlataformaPercentual, "taxa de plataforma"],
    [v.outrasDeducoesValor, v.outrasDeducoesPercentual, "outras deduções"],
  ] as Array<[number | undefined, number | undefined, string]>) {
    if (flat === undefined && percentual === undefined) continue;
    if (flat !== undefined && percentual !== undefined && estrategiaDeducao === "REJEITAR_SOBREPOSICAO") {
      alertas.push(`${rotulo}: "${nome}" informada como valor fixo e percentual ao mesmo tempo — use apenas uma forma.`);
      continue;
    }
    const usarFlat = flat !== undefined && (percentual === undefined || estrategiaDeducao === "PRIORIZAR_VALOR_FIXO");
    if (usarFlat) {
      soma += flat as number;
      premissas.push(`${rotulo}: ${nome} = ${formatarBRL(flat as number)} (valor fixo).`);
    } else if (percentual !== undefined && receitaBase !== undefined) {
      const valor = (receitaBase * percentual) / 100;
      soma += valor;
      premissas.push(`${rotulo}: ${nome} = ${formatarNumero(percentual)}% sobre a receita bruta (${formatarBRL(valor)}).`);
    }
  }
  return soma;
}

// ---------------------------------------------------------------------------
// Nível de completude
// ---------------------------------------------------------------------------

function determinarCompletude(ag: AgregacaoReceitaKm): NivelCompletude {
  if (!ag.receitaValida || !ag.distanciaValida) return "INSUFICIENTE";
  if (ag.custoTotal === undefined && ag.cpkTotal === undefined) return "PARCIAL";
  if (ag.receitaMinimaPorKm === undefined) return "PARCIAL";
  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirMemoriaCalculo(rotulo: string, ag: AgregacaoReceitaKm): string[] {
  const linhas: string[] = [];
  if (ag.receitaBrutaTotal !== undefined) linhas.push(`${rotulo}: receita bruta total = ${formatarBRL(ag.receitaBrutaTotal)}.`);
  if (ag.deducoesTotais !== undefined) linhas.push(`${rotulo}: deduções totais = ${formatarBRL(ag.deducoesTotais)}; receita líquida = ${formatarBRL(ag.receitaLiquida ?? 0)}.`);
  if (ag.distanciaTotalKm !== undefined) linhas.push(`${rotulo}: distância total = ${formatarNumero(ag.distanciaTotalKm)} km.`);
  if (ag.receitaLiquidaPorKm !== undefined) linhas.push(`${rotulo}: receita líquida por km = ${formatarBRL(ag.receitaLiquida ?? 0)} ÷ ${formatarNumero(ag.distanciaTotalKm ?? 0)} km = ${formatarBRL(ag.receitaLiquidaPorKm)}/km.`);
  if (ag.custoPorKm !== undefined) linhas.push(`${rotulo}: custo por km = ${formatarBRL(ag.custoPorKm)}/km.`);
  if (ag.lucroPorKm !== undefined) linhas.push(`${rotulo}: lucro por km = receita líquida/km − custo/km = ${formatarBRL(ag.lucroPorKm)}/km.`);
  if (ag.receitaMinimaPorKm !== undefined) linhas.push(`${rotulo}: receita mínima por km = ${formatarBRL(ag.receitaMinimaPorKm)}/km.`);
  return linhas;
}

function construirResumo(ag: AgregacaoReceitaKm, nivelCompletude: NivelCompletude): string {
  if (ag.receitaLiquidaPorKm === undefined) {
    return "Não foi possível calcular a receita por km com os dados informados. Verifique os campos faltantes.";
  }

  const partes: string[] = [];
  if (ag.receitaBrutaTotal !== undefined) {
    partes.push(`A operação gerou receita bruta de ${formatarBRL(ag.receitaBrutaTotal)} e receita líquida de ${formatarBRL(ag.receitaLiquida ?? 0)}.`);
  }
  partes.push(`Considerando ${formatarNumero(ag.distanciaTotalKm ?? 0)} km totais, a receita líquida foi de ${formatarBRL(ag.receitaLiquidaPorKm)} por km.`);
  if (ag.custoPorKm !== undefined && ag.lucroPorKm !== undefined) {
    partes.push(`O custo informado foi de ${formatarBRL(ag.custoPorKm)} por km, resultando em lucro estimado de ${formatarBRL(ag.lucroPorKm)} por km.`);
  }
  if (ag.distanciaVaziaKm !== undefined && ag.distanciaVaziaKm > 0 && ag.receitaPorKmCarregado !== undefined) {
    partes.push(
      `Dos ${formatarNumero(ag.distanciaTotalKm ?? 0)} km percorridos, ${formatarNumero(ag.distanciaVaziaKm)} km foram vazios. Por isso, a receita por quilômetro carregado foi de ${formatarBRL(
        ag.receitaPorKmCarregado
      )}, mas a receita efetiva sobre a operação completa permaneceu em ${formatarBRL(ag.receitaLiquidaPorKm)} por km.`
    );
  }
  if (ag.classificacao) partes.push(`Classificação: ${ag.classificacao}.`);
  if (nivelCompletude === "PARCIAL") {
    partes.push("A análise foi classificada como parcial porque custo, CPK ou meta financeira não foram totalmente informados.");
  } else if (nivelCompletude === "INSUFICIENTE") {
    partes.push("A análise foi classificada como insuficiente para um resultado confiável.");
  }
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Pipeline por variante
// ---------------------------------------------------------------------------

function analisarVariante(v: DadosReceitaKmVariante, modo: ModoReceitaKm, rotulo: string, config: ConfigReceitaKm): AgregacaoReceitaKm {
  const errosEstrutura = validarVariante(v, rotulo);
  const ag = calcularNucleo(v, modo, config, rotulo);
  if (errosEstrutura.length > 0) ag.errosValidacao = [...errosEstrutura, ...ag.errosValidacao];
  return ag;
}

function paraResultadoCenario(id: string, nome: string, ag: AgregacaoReceitaKm): ResultadoCenarioReceitaKm {
  const sucesso = ag.errosValidacao.length === 0 && ag.dadosFaltantes.length === 0 && ag.receitaLiquidaPorKm !== undefined;
  const nivelCompletude = determinarCompletude(ag);
  return {
    id,
    nome,
    sucesso,
    alertas: ag.alertas,
    premissas: ag.premissas,
    dadosFaltantes: [...ag.dadosFaltantes, ...ag.errosValidacao],
    mensagemResumo: sucesso ? construirResumo(ag, nivelCompletude) : "Não foi possível calcular este registro — verifique os dados faltantes.",
    receitaBrutaTotal: ag.receitaBrutaTotal,
    receitaLiquida: ag.receitaLiquida,
    distanciaTotalKm: ag.distanciaTotalKm,
    distanciaCarregadaKm: ag.distanciaCarregadaKm,
    distanciaVaziaKm: ag.distanciaVaziaKm,
    percentualKmVazio: ag.percentualKmVazio,
    receitaBrutaPorKm: ag.receitaBrutaPorKm,
    receitaLiquidaPorKm: ag.receitaLiquidaPorKm,
    custoPorKm: ag.custoPorKm,
    lucroPorKm: ag.lucroPorKm,
    margemPercentual: ag.margemPercentual,
    receitaMinimaPorKm: ag.receitaMinimaPorKm,
    diferencaParaMinimoPorKm: ag.diferencaParaMinimoPorKm,
    nivelCompletude,
  };
}

function construirRanking(itens: Array<{ id: string; nome: string; valor: number | undefined }>, maiorMelhor: boolean): ItemRankingReceitaKm[] {
  const validos = itens.filter((i): i is { id: string; nome: string; valor: number } => i.valor !== undefined);
  const ordenados = [...validos].sort((a, b) => (maiorMelhor ? b.valor - a.valor : a.valor - b.valor));
  return ordenados.map((item, indice) => ({ id: item.id, nome: item.nome, valor: item.valor, posicao: indice + 1 }));
}

// ---------------------------------------------------------------------------
// Comparação de cenários
// ---------------------------------------------------------------------------

function compararCenarios(entrada: CalcularReceitaKmEntrada, config: ConfigReceitaKm): { comparacao: ComparacaoCenariosReceitaKm; nivelCompletude: NivelCompletude } {
  const cenarios = entrada.cenarios as CenarioReceitaKm[];
  const resultados = cenarios.map((cen, indice) => {
    const id = cen.id ?? `cenario-${indice + 1}`;
    const nome = cen.nome ?? cen.id ?? `Cenário ${indice + 1}`;
    const ag = analisarVariante(cen, "RECEITA_E_CUSTO_POR_KM", nome, config);
    return paraResultadoCenario(id, nome, ag);
  });

  const rankingPorMaiorReceitaLiquidaPorKm = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.receitaLiquidaPorKm })), true);
  const rankingPorMaiorLucroPorKm = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.lucroPorKm })), true);
  const rankingPorMaiorMargem = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.margemPercentual })), true);
  const rankingPorMenorPercentualKmVazio = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.percentualKmVazio })), false);
  const rankingPorMaiorReceitaTotal = construirRanking(resultados.map((r) => ({ id: r.id, nome: r.nome, valor: r.receitaLiquida })), true);

  const alertas: string[] = [];
  if (rankingPorMaiorReceitaTotal.length > 0 && rankingPorMaiorReceitaLiquidaPorKm.length > 0 && rankingPorMaiorReceitaTotal[0].id !== rankingPorMaiorReceitaLiquidaPorKm[0].id) {
    alertas.push("O cenário de maior receita total não é o mesmo de maior receita por km — faturamento não é o mesmo que eficiência.");
  }

  const nivelCompletude: NivelCompletude = resultados.every((r) => r.nivelCompletude === "COMPLETO") ? "COMPLETO" : "PARCIAL";

  return {
    comparacao: {
      cenarios: resultados,
      rankingPorMaiorReceitaLiquidaPorKm,
      rankingPorMaiorLucroPorKm,
      rankingPorMaiorMargem,
      rankingPorMenorPercentualKmVazio,
      rankingPorMaiorReceitaTotal,
      alertas,
    },
    nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Consolidação de múltiplas viagens / veículos
// ---------------------------------------------------------------------------

function consolidar(registros: Array<{ id: string; nome: string; v: DadosReceitaKmVariante }>, modo: ModoReceitaKm, config: ConfigReceitaKm): { consolidado: ResultadoConsolidadoReceitaKm; nivelCompletude: NivelCompletude } {
  const resultados = registros.map(({ id, nome, v }) => paraResultadoCenario(id, nome, analisarVariante(v, modo, nome, config)));

  const validos = resultados.filter((r) => r.sucesso);
  const somaReceitaBruta = validos.reduce((acc, r) => acc + (r.receitaBrutaTotal ?? 0), 0);
  const somaReceitaLiquida = validos.reduce((acc, r) => acc + (r.receitaLiquida ?? 0), 0);
  const somaDistanciaTotal = validos.reduce((acc, r) => acc + (r.distanciaTotalKm ?? 0), 0);
  const somaDistanciaCarregada = validos.reduce((acc, r) => acc + (r.distanciaCarregadaKm ?? 0), 0);
  const somaDistanciaVazia = validos.reduce((acc, r) => acc + (r.distanciaVaziaKm ?? 0), 0);
  const temTodosCustos = validos.length > 0 && validos.every((r) => r.custoPorKm !== undefined && r.distanciaTotalKm !== undefined);
  const somaCustoTotal = temTodosCustos ? validos.reduce((acc, r) => acc + (r.custoPorKm as number) * (r.distanciaTotalKm as number), 0) : undefined;

  const c = config.casas.moeda;
  const rpk = config.casas.receitaPorKm;
  const p = config.casas.percentual;

  const receitaPorKmConsolidada = somaDistanciaTotal > 0 ? dividirViaCpk(somaReceitaLiquida, somaDistanciaTotal, rpk) : undefined;
  const custoPorKmConsolidado = somaCustoTotal !== undefined && somaDistanciaTotal > 0 ? dividirViaCpk(somaCustoTotal, somaDistanciaTotal, rpk) : undefined;
  const lucroTotalConsolidado = somaCustoTotal !== undefined ? somaReceitaLiquida - somaCustoTotal : undefined;
  const lucroPorKmConsolidado = lucroTotalConsolidado !== undefined && somaDistanciaTotal > 0 ? arredondar(lucroTotalConsolidado / somaDistanciaTotal, rpk) : undefined;
  const margemConsolidadaPercentual = lucroTotalConsolidado !== undefined && somaReceitaLiquida > 0 ? arredondar((lucroTotalConsolidado / somaReceitaLiquida) * 100, p) : undefined;
  const percentualKmVazioConsolidado = somaDistanciaTotal > 0 ? arredondar((somaDistanciaVazia / somaDistanciaTotal) * 100, p) : undefined;

  const rankingPorMaiorReceitaPorKm = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.receitaLiquidaPorKm })), true);
  const rankingPorMaiorLucroPorKm = construirRanking(validos.map((r) => ({ id: r.id, nome: r.nome, valor: r.lucroPorKm })), true);

  const registrosAbaixoDoCusto = validos.filter((r) => r.receitaLiquidaPorKm !== undefined && r.custoPorKm !== undefined && r.receitaLiquidaPorKm < r.custoPorKm).map((r) => r.nome);
  const registrosAbaixoDoValorMinimo = validos
    .filter((r) => r.receitaMinimaPorKm !== undefined && r.receitaLiquidaPorKm !== undefined && r.receitaLiquidaPorKm < r.receitaMinimaPorKm)
    .map((r) => r.nome);

  const alertas: string[] = [];
  if (rankingPorMaiorReceitaPorKm.length > 1) {
    alertas.push("A consolidação usa receita total ÷ distância total (média ponderada pela distância) — não é a média simples das receitas por km individuais.");
  }

  const nivelCompletude: NivelCompletude = resultados.length === 0 ? "INSUFICIENTE" : validos.length === resultados.length && temTodosCustos ? "COMPLETO" : validos.length > 0 ? "PARCIAL" : "INSUFICIENTE";

  return {
    consolidado: {
      quantidadeRegistros: registros.length,
      receitaBrutaConsolidada: validos.length > 0 ? arredondar(somaReceitaBruta, c) : undefined,
      receitaLiquidaConsolidada: validos.length > 0 ? arredondar(somaReceitaLiquida, c) : undefined,
      distanciaTotalConsolidada: validos.length > 0 ? arredondar(somaDistanciaTotal, config.casas.distancia) : undefined,
      distanciaCarregadaConsolidada: somaDistanciaCarregada > 0 ? arredondar(somaDistanciaCarregada, config.casas.distancia) : undefined,
      distanciaVaziaConsolidada: somaDistanciaVazia > 0 ? arredondar(somaDistanciaVazia, config.casas.distancia) : undefined,
      custoTotalConsolidado: somaCustoTotal !== undefined ? arredondar(somaCustoTotal, c) : undefined,
      lucroTotalConsolidado: lucroTotalConsolidado !== undefined ? arredondar(lucroTotalConsolidado, c) : undefined,
      receitaPorKmConsolidada,
      custoPorKmConsolidado,
      lucroPorKmConsolidado,
      margemConsolidadaPercentual,
      percentualKmVazioConsolidado,
      resultadosIndividuais: resultados,
      rankingPorMaiorReceitaPorKm,
      rankingPorMaiorLucroPorKm,
      registrosAbaixoDoCusto,
      registrosAbaixoDoValorMinimo,
      melhorResultadoPorReceitaKm: rankingPorMaiorReceitaPorKm[0]?.nome,
      melhorResultadoPorLucroKm: rankingPorMaiorLucroPorKm[0]?.nome,
      piorResultado: rankingPorMaiorReceitaPorKm[rankingPorMaiorReceitaPorKm.length - 1]?.nome,
      alertas,
    },
    nivelCompletude,
  };
}

function viagemParaVariante(viagem: ViagemReceitaKm): DadosReceitaKmVariante {
  return {
    receitaBruta: viagem.receitaBruta,
    receitaLiquidaInformada: viagem.receitaLiquidaInformada,
    distanciaTotalKm: viagem.distanciaTotalKm,
    distanciaCarregadaKm: viagem.distanciaCarregadaKm,
    distanciaVaziaKm: viagem.distanciaVaziaKm,
    custoTotal: viagem.custoTotal,
    custoPorKm: viagem.custoPorKm,
    pesoCargaToneladas: viagem.pesoCargaToneladas,
    quantidadeVeiculos: viagem.quantidadeVeiculos,
  };
}

function veiculoParaVariante(veiculo: VeiculoReceitaKm): DadosReceitaKmVariante {
  return {
    receitaBruta: veiculo.receitaBruta,
    receitaLiquidaInformada: veiculo.receitaLiquidaInformada,
    distanciaTotalKm: veiculo.distanciaTotalKm,
    distanciaCarregadaKm: veiculo.distanciaCarregadaKm,
    distanciaVaziaKm: veiculo.distanciaVaziaKm,
    custoTotal: veiculo.custoTotal,
    cpkTotal: veiculo.cpkTotal,
    quantidadeViagens: veiculo.quantidadeViagens,
    quantidadeDiasOperados: veiculo.diasOperados,
  };
}

// ---------------------------------------------------------------------------
// Previsto x realizado
// ---------------------------------------------------------------------------

function diferenca(previsto: number | undefined, realizado: number | undefined, casas: number): DiferencaReceitaKm | undefined {
  if (previsto === undefined || realizado === undefined) return undefined;
  const diferencaAbsoluta = realizado - previsto;
  return {
    previsto: arredondar(previsto, casas),
    realizado: arredondar(realizado, casas),
    diferenca: arredondar(diferencaAbsoluta, casas),
    diferencaPercentual: previsto !== 0 ? arredondar((diferencaAbsoluta / previsto) * 100, 2) : undefined,
  };
}

function calcularPrevistoRealizado(entrada: CalcularReceitaKmEntrada, config: ConfigReceitaKm): { resultado?: PrevistoRealizadoReceitaKm; agPrevisto: AgregacaoReceitaKm; agRealizado: AgregacaoReceitaKm } {
  const agPrevisto = analisarVariante(entrada.previsto as DadosReceitaKmVariante, "RECEITA_E_CUSTO_POR_KM", "previsto", config);
  const agRealizado = analisarVariante(entrada.realizado as DadosReceitaKmVariante, "RECEITA_E_CUSTO_POR_KM", "realizado", config);

  if (agPrevisto.errosValidacao.length > 0 || agPrevisto.dadosFaltantes.length > 0 || agRealizado.errosValidacao.length > 0 || agRealizado.dadosFaltantes.length > 0) {
    return { agPrevisto, agRealizado };
  }

  const c = config.casas.moeda;
  const rpk = config.casas.receitaPorKm;
  const p = config.casas.percentual;

  const receitaPorKm = diferenca(agPrevisto.receitaLiquidaPorKm, agRealizado.receitaLiquidaPorKm, rpk);
  const receitaTotal = diferenca(agPrevisto.receitaLiquida, agRealizado.receitaLiquida, c);
  const distanciaTotal = diferenca(agPrevisto.distanciaTotalKm, agRealizado.distanciaTotalKm, config.casas.distancia);
  const custoTotalDif = diferenca(agPrevisto.custoTotal, agRealizado.custoTotal, c);
  const lucroPorKm = diferenca(agPrevisto.lucroPorKm, agRealizado.lucroPorKm, rpk);
  const margemPercentual = diferenca(agPrevisto.margemPercentual, agRealizado.margemPercentual, p);

  const candidatosDesvio: Array<[string, number | undefined]> = [
    ["Receita por km", receitaPorKm?.diferenca !== undefined ? Math.abs(receitaPorKm.diferenca) : undefined],
    ["Distância", distanciaTotal?.diferenca !== undefined ? Math.abs(distanciaTotal.diferenca) : undefined],
    ["Custo", custoTotalDif?.diferenca !== undefined ? Math.abs(custoTotalDif.diferenca) : undefined],
  ];
  const maiorDesvio = candidatosDesvio.filter(([, v]) => v !== undefined).sort((a, b) => (b[1] as number) - (a[1] as number))[0];

  const alertas: string[] = [];
  if (receitaPorKm && Math.abs(receitaPorKm.diferencaPercentual ?? 0) >= 10) alertas.push(`A receita por km realizada ficou ${formatarNumero(receitaPorKm.diferencaPercentual ?? 0)}% em relação à prevista.`);

  return {
    resultado: {
      receitaPorKm,
      receitaTotal,
      distanciaTotal,
      custoTotal: custoTotalDif,
      lucroPorKm,
      margemPercentual,
      principalDesvio: maiorDesvio?.[0],
      alertas,
    },
    agPrevisto,
    agRealizado,
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

function respostaFalha(modo: ModoReceitaKm, dadosFaltantes: string[], erros: string[], alertas: string[] = []): CalcularReceitaKmResultado {
  return {
    sucesso: false,
    modo,
    alertas,
    premissas: [],
    dadosFaltantes: [...dadosFaltantes, ...erros],
    mensagemResumo: erros.length > 0 ? `Não foi possível calcular: ${erros.join(" ")}` : `Dados insuficientes para calcular a receita por km. Faltam: ${dadosFaltantes.join(", ")}.`,
    nivelCompletude: "INSUFICIENTE",
    dadosPresentes: [],
    dadosFaltantesInformativo: dadosFaltantes,
    indicadoresNaoAvaliados: [],
    limitacoes: LIMITACOES_PADRAO,
    memoriaCalculo: [],
  };
}

export function calcularReceitaKm(entrada: CalcularReceitaKmEntrada): CalcularReceitaKmResultado {
  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) return respostaFalha(entrada.modo, [], errosTopo);

  const casas = casasDecimaisDe(entrada);
  const config: ConfigReceitaKm = {
    estrategiaReceita: entrada.estrategiaSobreposicaoReceita ?? "REJEITAR_SOBREPOSICAO",
    estrategiaDeducao: entrada.estrategiaSobreposicaoDeducao ?? "REJEITAR_SOBREPOSICAO",
    estrategiaCusto: entrada.estrategiaSobreposicaoCusto ?? "REJEITAR_SOBREPOSICAO",
    estrategiaDistancia: entrada.estrategiaSobreposicaoDistancia ?? "REJEITAR_SOBREPOSICAO",
    toleranciaPercentual: entrada.toleranciaClassificacaoPercentual ?? TOLERANCIA_CLASSIFICACAO_PERCENTUAL_PADRAO,
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
        ? `Comparação entre ${comparacao.cenarios.length} cenários concluída. Maior receita por km: ${comparacao.rankingPorMaiorReceitaLiquidaPorKm[0]?.nome ?? "—"}.`
        : "Nenhum cenário pôde ser calculado com os dados informados.",
      nivelCompletude,
      dadosPresentes: [],
      dadosFaltantesInformativo: [],
      indicadoresNaoAvaliados: [],
      comparacaoCenarios: comparacao,
      limitacoes: LIMITACOES_PADRAO,
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "MULTIPLAS_VIAGENS") {
    const registros = (entrada.viagens as ViagemReceitaKm[]).map((viagem, indice) => ({
      id: viagem.identificacaoViagem ?? `viagem-${indice + 1}`,
      nome: viagem.identificacaoViagem ?? `Viagem ${indice + 1}`,
      v: viagemParaVariante(viagem),
    }));
    const { consolidado, nivelCompletude } = consolidar(registros, entrada.modo, config);
    return {
      sucesso: consolidado.receitaPorKmConsolidada !== undefined,
      modo: entrada.modo,
      alertas: consolidado.alertas,
      premissas: [],
      dadosFaltantes: consolidado.receitaPorKmConsolidada === undefined ? ["Nenhuma viagem pôde ser calculada — verifique os dados de cada viagem."] : [],
      mensagemResumo:
        consolidado.receitaPorKmConsolidada !== undefined
          ? `${consolidado.quantidadeRegistros} viagens consolidadas: receita por km de ${formatarBRL(consolidado.receitaPorKmConsolidada)} (${formatarBRL(consolidado.receitaLiquidaConsolidada ?? 0)} ÷ ${formatarNumero(consolidado.distanciaTotalConsolidada ?? 0)} km).`
          : "Não foi possível consolidar as viagens informadas.",
      nivelCompletude,
      dadosPresentes: [],
      dadosFaltantesInformativo: [],
      indicadoresNaoAvaliados: [],
      consolidadoViagens: consolidado,
      limitacoes: LIMITACOES_PADRAO,
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "MULTIPLOS_VEICULOS") {
    const registros = (entrada.veiculos as VeiculoReceitaKm[]).map((veic, indice) => ({
      id: veic.identificacaoVeiculo ?? veic.placa ?? `veiculo-${indice + 1}`,
      nome: veic.identificacaoVeiculo ?? veic.placa ?? `Veículo ${indice + 1}`,
      v: veiculoParaVariante(veic),
    }));
    const { consolidado, nivelCompletude } = consolidar(registros, entrada.modo, config);
    return {
      sucesso: consolidado.receitaPorKmConsolidada !== undefined,
      modo: entrada.modo,
      alertas: consolidado.alertas,
      premissas: [],
      dadosFaltantes: consolidado.receitaPorKmConsolidada === undefined ? ["Nenhum veículo pôde ser calculado — verifique os dados de cada veículo."] : [],
      mensagemResumo:
        consolidado.receitaPorKmConsolidada !== undefined
          ? `${consolidado.quantidadeRegistros} veículos consolidados: receita por km de ${formatarBRL(consolidado.receitaPorKmConsolidada)} (frota).`
          : "Não foi possível consolidar os veículos informados.",
      nivelCompletude,
      dadosPresentes: [],
      dadosFaltantesInformativo: [],
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
      mensagemResumo: `Receita por km prevista de ${formatarBRL(resultado.receitaPorKm?.previsto ?? 0)} x realizada de ${formatarBRL(resultado.receitaPorKm?.realizado ?? 0)} (diferença de ${formatarNumero(
        resultado.receitaPorKm?.diferencaPercentual ?? 0
      )}%).`,
      nivelCompletude: "COMPLETO",
      dadosPresentes: [],
      dadosFaltantesInformativo: [],
      indicadoresNaoAvaliados: [],
      previstoRealizado: resultado,
      limitacoes: LIMITACOES_PADRAO,
      memoriaCalculo: [],
    };
  }

  const errosVariante = validarVariante(entrada, "frete");
  const ag = calcularNucleo(entrada, entrada.modo, config, "frete");

  if (errosVariante.length > 0) return respostaFalha(entrada.modo, ag.dadosFaltantes, [...errosVariante, ...ag.errosValidacao], ag.alertas);
  if (ag.dadosFaltantes.length > 0 || ag.errosValidacao.length > 0) return respostaFalha(entrada.modo, ag.dadosFaltantes, ag.errosValidacao, ag.alertas);

  const nivelCompletude = determinarCompletude(ag);
  const memoriaCalculo = construirMemoriaCalculo("frete", ag);
  const mensagemResumo = construirResumo(ag, nivelCompletude);

  return {
    sucesso: true,
    modo: entrada.modo,
    identificacao: entrada.identificacao,
    descricao: entrada.descricao,
    origem: entrada.origem,
    destino: entrada.destino,

    receitaBrutaTotal: ag.receitaBrutaTotal,
    deducoesTotais: ag.deducoesTotais,
    receitaLiquida: ag.receitaLiquida,

    distanciaTotalKm: ag.distanciaTotalKm,
    distanciaCarregadaKm: ag.distanciaCarregadaKm,
    distanciaVaziaKm: ag.distanciaVaziaKm,
    percentualKmVazio: ag.percentualKmVazio,

    receitaBrutaPorKm: ag.receitaBrutaPorKm,
    receitaLiquidaPorKm: ag.receitaLiquidaPorKm,
    receitaPorKmCarregado: ag.receitaPorKmCarregado,
    receitaPorKmRetorno: ag.receitaPorKmRetorno,

    custoTotal: ag.custoTotal,
    custoPorKm: ag.custoPorKm,
    cpkTotal: ag.cpkTotal,

    lucroTotal: ag.lucroTotal,
    lucroPorKm: ag.lucroPorKm,
    margemPercentual: ag.margemPercentual,

    indiceCoberturaCpk: ag.indiceCoberturaCpk,
    diferencaReceitaCpkPorKm: ag.diferencaReceitaCpkPorKm,

    receitaMinimaPorKm: ag.receitaMinimaPorKm,
    diferencaParaMinimoPorKm: ag.diferencaParaMinimoPorKm,
    valorAdicionalNecessario: ag.valorAdicionalNecessario,

    receitaPorToneladaKm: ag.receitaPorToneladaKm,
    custoPorToneladaKm: ag.custoPorToneladaKm,
    lucroPorToneladaKm: ag.lucroPorToneladaKm,

    receitaPorViagem: ag.receitaPorViagem,
    receitaPorVeiculo: ag.receitaPorVeiculo,
    receitaPorDia: ag.receitaPorDia,
    lucroPorDia: ag.lucroPorDia,
    kmPorDia: ag.kmPorDia,

    impactoRetornoVazio: ag.impactoRetornoVazio,

    classificacao: ag.classificacao,
    nivelCompletude,
    dadosPresentes: ag.dadosPresentes,
    dadosFaltantesInformativo: [],
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
    descricao: "Modo de cálculo da receita por km.",
    valoresPossiveis: [
      "RECEITA_BRUTA_POR_KM",
      "RECEITA_LIQUIDA_POR_KM",
      "RECEITA_POR_KM_TOTAL",
      "RECEITA_POR_KM_CARREGADO",
      "RECEITA_E_CUSTO_POR_KM",
      "LUCRO_POR_KM",
      "MARGEM_POR_KM",
      "RETORNO_VAZIO",
      "FRETE_COM_RETORNO",
      "MULTIPLAS_VIAGENS",
      "MULTIPLOS_VEICULOS",
      "ANALISE_POR_PERIODO",
      "PREVISTO_X_REALIZADO",
      "COMPARACAO_CENARIOS",
      "COMPARAR_COM_VALOR_MINIMO",
      "RECEITA_TONELADA_KM",
    ],
  },
  { nome: "identificacao", tipo: "string", obrigatorio: false, descricao: "Identificador livre da operação." },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre." },
  { nome: "origem", tipo: "string", obrigatorio: false, descricao: "Origem (informativo nesta fase)." },
  { nome: "destino", tipo: "string", obrigatorio: false, descricao: "Destino (informativo nesta fase)." },
  { nome: "periodoInicio", tipo: "string", obrigatorio: false, descricao: "Início do período analisado (informativo)." },
  { nome: "periodoFim", tipo: "string", obrigatorio: false, descricao: "Fim do período analisado (informativo)." },
  { nome: "tipoPeriodo", tipo: "enum", obrigatorio: false, descricao: "Tipo de período.", valoresPossiveis: ["DIA", "SEMANA", "MES", "ANO", "PERIODO_PERSONALIZADO"] },
  { nome: "receitaBruta", tipo: "number", obrigatorio: false, descricao: "Receita bruta total, em R$." },
  { nome: "receitaIda", tipo: "number", obrigatorio: false, descricao: "Receita do trecho de ida, em R$." },
  { nome: "receitaVolta", tipo: "number", obrigatorio: false, descricao: "Receita do trecho de volta/retorno, em R$." },
  { nome: "receitasAdicionais", tipo: "number", obrigatorio: false, descricao: "Receitas adicionais, em R$." },
  { nome: "receitaLiquidaInformada", tipo: "number", obrigatorio: false, descricao: "Receita líquida já calculada (bypassa a resolução de deduções)." },
  { nome: "valorPorUnidade", tipo: "number", obrigatorio: false, descricao: "Valor recebido por unidade, usado com quantidadeUnidades." },
  { nome: "quantidadeUnidades", tipo: "number", obrigatorio: false, descricao: "Quantidade de unidades transportadas." },
  { nome: "valorPorTonelada", tipo: "number", obrigatorio: false, descricao: "Valor recebido por tonelada, usado com pesoCargaToneladas." },
  { nome: "valorPorKmInformado", tipo: "number", obrigatorio: false, descricao: "Valor recebido por km, informado diretamente." },
  { nome: "descontos", tipo: "number", obrigatorio: false, descricao: "Descontos, em R$." },
  { nome: "devolucoes", tipo: "number", obrigatorio: false, descricao: "Devoluções, em R$." },
  { nome: "impostoValor", tipo: "number", obrigatorio: false, descricao: "Imposto em valor fixo." },
  { nome: "impostoPercentual", tipo: "number", obrigatorio: false, descricao: "Imposto em percentual sobre a receita." },
  { nome: "comissaoValor", tipo: "number", obrigatorio: false, descricao: "Comissão em valor fixo." },
  { nome: "comissaoPercentual", tipo: "number", obrigatorio: false, descricao: "Comissão em percentual sobre a receita." },
  { nome: "taxaPlataformaValor", tipo: "number", obrigatorio: false, descricao: "Taxa de plataforma em valor fixo." },
  { nome: "taxaPlataformaPercentual", tipo: "number", obrigatorio: false, descricao: "Taxa de plataforma em percentual sobre a receita." },
  { nome: "outrasDeducoesValor", tipo: "number", obrigatorio: false, descricao: "Outras deduções em valor fixo." },
  { nome: "outrasDeducoesPercentual", tipo: "number", obrigatorio: false, descricao: "Outras deduções em percentual sobre a receita." },
  { nome: "distanciaIdaKm", tipo: "number", obrigatorio: false, descricao: "Distância da ida, em km." },
  { nome: "distanciaVoltaKm", tipo: "number", obrigatorio: false, descricao: "Distância da volta, em km." },
  { nome: "distanciaAdicionalKm", tipo: "number", obrigatorio: false, descricao: "Distância adicional, em km." },
  { nome: "distanciaTotalKm", tipo: "number", obrigatorio: false, descricao: "Distância total, em km." },
  { nome: "distanciaCarregadaKm", tipo: "number", obrigatorio: false, descricao: "Distância percorrida com carga, em km." },
  { nome: "distanciaVaziaKm", tipo: "number", obrigatorio: false, descricao: "Distância percorrida vazia, em km." },
  { nome: "custoTotal", tipo: "number", obrigatorio: false, descricao: "Custo total, em R$." },
  { nome: "custoPorKm", tipo: "number", obrigatorio: false, descricao: "Custo por km, em R$/km." },
  { nome: "cpkTotal", tipo: "number", obrigatorio: false, descricao: "CPK total (R$/km), usado como referência de comparação." },
  { nome: "valorMinimoPorKm", tipo: "number", obrigatorio: false, descricao: "Valor mínimo por km, se já calculado." },
  { nome: "valorMinimoTotal", tipo: "number", obrigatorio: false, descricao: "Valor mínimo total, se já calculado." },
  { nome: "margemAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "Margem-alvo, usada para derivar a receita mínima por km quando não informada diretamente." },
  { nome: "pesoCargaToneladas", tipo: "number", obrigatorio: false, descricao: "Peso da carga, em toneladas." },
  { nome: "quantidadeViagens", tipo: "number", obrigatorio: false, descricao: "Quantidade de viagens do período." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos envolvidos." },
  { nome: "quantidadeDiasOperados", tipo: "number", obrigatorio: false, descricao: "Quantidade de dias operados no período." },
  { nome: "cenarios", tipo: "string", obrigatorio: false, descricao: "Lista de cenários a comparar (modo COMPARACAO_CENARIOS, ao menos 2)." },
  { nome: "viagens", tipo: "string", obrigatorio: false, descricao: "Lista de viagens a consolidar (modo MULTIPLAS_VIAGENS)." },
  { nome: "veiculos", tipo: "string", obrigatorio: false, descricao: "Lista de veículos a consolidar (modo MULTIPLOS_VEICULOS)." },
  { nome: "estrategiaSobreposicaoReceita", tipo: "enum", obrigatorio: false, descricao: "Estratégia para receita informada por mais de uma fonte.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO", "PRIORIZAR_RECEITA_LIQUIDA_INFORMADA"] },
  { nome: "estrategiaSobreposicaoDeducao", tipo: "enum", obrigatorio: false, descricao: "Estratégia para dedução informada como valor fixo e percentual.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_VALOR_FIXO", "PRIORIZAR_PERCENTUAL"] },
  { nome: "estrategiaSobreposicaoCusto", tipo: "enum", obrigatorio: false, descricao: "Estratégia para custo informado por mais de uma fonte.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_CPK", "PRIORIZAR_DETALHADO"] },
  { nome: "estrategiaSobreposicaoDistancia", tipo: "enum", obrigatorio: false, descricao: "Estratégia para distância informada por mais de uma forma.", valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_IDA_VOLTA", "PRIORIZAR_CARREGADA_VAZIA"] },
  { nome: "toleranciaClassificacaoPercentual", tipo: "number", obrigatorio: false, descricao: "Tolerância (%) para classificação da receita por km." },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve todas as casas decimais padrão da saída." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Sinaliza que parte dos dados são estimativas." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaCalcularReceitaKm: DefinicaoFerramenta<CalcularReceitaKmEntrada, CalcularReceitaKmResultado> = {
  nome: "calcular_receita_km",
  descricao: "Calcula e interpreta a receita por quilômetro de um frete, viagem, rota, veículo, operação, contrato, conjunto de viagens, frota ou período.",
  objetivo: "Fornecer indicadores comparáveis de receita/custo/lucro por km e comparar com CPK e valor mínimo.",
  parametros: PARAMETROS,
  executar: calcularReceitaKm,
};
