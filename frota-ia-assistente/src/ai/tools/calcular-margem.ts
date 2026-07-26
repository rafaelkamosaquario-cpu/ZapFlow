import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, EstrategiaSobreposicao, NivelCompletude, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO, CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";
import { calcularCpk } from "./calcular-cpk";

/**
 * Ferramenta: calcular_margem
 *
 * Calcula a margem financeira de uma viagem, frete, operação, veículo,
 * contrato ou período — sempre diferenciando faturamento, receita bruta,
 * receita líquida, custo, lucro, margem, markup e preço mínimo. Nunca trata
 * margem e markup como o mesmo indicador, nunca declara uma operação
 * lucrativa só porque a receita supera alguns custos isolados, e nunca
 * apresenta lucro líquido como definitivo quando impostos, comissões ou
 * custos indiretos relevantes não foram informados.
 *
 * Reutiliza `calcular-cpk.ts` (modo `CPK_PNEUS`, reaproveitado como divisor
 * genérico valor ÷ km) para `receitaPorKm` e `custoPorKm` — grandezas que
 * nunca são negativas. `lucroPorKm`, `lucroPorTonelada`, `lucroPorVeiculo`
 * e `lucroPorViagem` são calculados diretamente nesta ferramenta porque
 * `calcular-cpk.ts` rejeita valores negativos e a margem, por definição,
 * precisa suportar prejuízo — não há lógica reaproveitável nesse caso.
 *
 * Aceita o custo de uma viagem já calculado por `calcular-custo-viagem.ts`
 * via `resumoCustoViagem` (tipagem estruturalmente compatível com o
 * resultado daquela ferramenta — não precisa importar seus tipos).
 * `comparar-pneus.ts` não é usado diretamente por esta ferramenta.
 *
 * Sem APIs externas nesta fase. Nunca assume alíquota de imposto, comissão,
 * margem desejada, distância ou peso de carga não informados.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

const CASAS_DECIMAIS_TONELADA_PADRAO = 2;

/**
 * Faixas de referência (% de margem líquida, ou a mais completa disponível)
 * para classificar o resultado. Valores iniciais e configuráveis — não
 * representam um padrão de mercado nem um "ideal" universal: o nível
 * adequado depende do tipo de operação, risco, prazo, cliente e estrutura
 * de custos (sempre reforçado em `limitacoes`).
 */
export const LIMITES_CLASSIFICACAO_MARGEM = {
  baixaAtePercentual: 5,
  moderadaAtePercentual: 15,
  saudavelAtePercentual: 30,
};

const LIMITACOES_PADRAO: string[] = [
  "O nível de margem considerado adequado depende do tipo de operação, risco, prazo, cliente e estrutura de custos — a classificação aqui não é um padrão universal.",
  "Esta ferramenta não calcula tributos, comissões ou custos automaticamente — todos os valores vêm do que foi informado.",
  "O lucro líquido é sempre uma estimativa quando impostos, comissões ou custos indiretos não foram todos informados; nunca deve ser lido como resultado contábil definitivo.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoCalculoMargem =
  | "MARGEM_SIMPLES"
  | "MARGEM_OPERACIONAL"
  | "MARGEM_LIQUIDA_ESTIMADA"
  | "MARGEM_POR_VIAGEM"
  | "MARGEM_POR_KM"
  | "MARGEM_POR_TONELADA"
  | "COMPARACAO_CENARIOS"
  | "PREVISTO_X_REALIZADO"
  | "MARGEM_ALVO"
  | "PONTO_EQUILIBRIO";

const MODOS_SEM_RECEITA_OBRIGATORIA: ModoCalculoMargem[] = ["MARGEM_ALVO", "PONTO_EQUILIBRIO"];

/**
 * Resumo estruturalmente compatível com o resultado de
 * `calcular-custo-viagem.ts` (`CalcularCustoViagemResultado`) — não importa
 * o tipo de lá para manter as ferramentas desacopladas; qualquer objeto com
 * esses campos (inclusive o resultado completo daquela ferramenta) pode ser
 * passado aqui diretamente.
 */
export interface ResumoCustoViagem {
  custoTotal?: number;
  custosVariaveis?: number;
  custosFixosProporcionais?: number;
  custosDiretos?: number;
  custosIndiretos?: number;
  distanciaTotalKm?: number;
  quantidadeVeiculos?: number;
  nivelCompletude?: NivelCompletude;
}

/**
 * Conjunto completo de dados de receita/custo — usado tanto para o cálculo
 * direto (a própria entrada) quanto para cada cenário em COMPARACAO_CENARIOS
 * e para os blocos `previsto`/`realizado` em PREVISTO_X_REALIZADO.
 */
export interface DadosMargemVariante {
  receitaBruta?: number;
  receitaAdicional?: number;
  descontos?: number;
  devolucoes?: number;

  impostos?: number;
  aliquotaImpostosPercentual?: number;
  comissoes?: number;
  aliquotaComissaoPercentual?: number;
  outrasDeducoes?: number;

  /** Alternativa 1: custo já pronto. */
  custoTotal?: number;
  /** Alternativa 2: categorias detalhadas (podem ser usadas em conjunto). */
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

  /** Usados para o impacto do retorno vazio/com carga. */
  receitaIda?: number;
  receitaRetorno?: number;

  quilometragemTotal?: number;
  distanciaCarregadaKm?: number;
  pesoCargaToneladas?: number;
  quantidadeVeiculos?: number;
  quantidadeViagens?: number;

  margemAlvoPercentual?: number;
  markupAlvoPercentual?: number;
}

export interface CenarioMargem extends DadosMargemVariante {
  id?: string;
  nome?: string;
}

export interface CalcularMargemEntrada extends DadosMargemVariante {
  modo: ModoCalculoMargem;
  descricao?: string;

  /** Usado apenas em COMPARACAO_CENARIOS — ao menos 2 cenários. */
  cenarios?: CenarioMargem[];
  /** Usados apenas em PREVISTO_X_REALIZADO. */
  previsto?: DadosMargemVariante;
  realizado?: DadosMargemVariante;

  estrategiaSobreposicao?: EstrategiaSobreposicao;
  casasDecimais?: number;
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type ClassificacaoMargem = "PREJUIZO" | "MARGEM_BAIXA" | "MARGEM_MODERADA" | "MARGEM_SAUDAVEL" | "MARGEM_ELEVADA";

export interface ImpactoRetornoVazio {
  custoIda?: number;
  custoRetorno?: number;
  receitaIda?: number;
  receitaRetorno?: number;
  lucroComRetorno?: number;
  margemComRetornoPercentual?: number;
  lucroSoIda?: number;
  margemSoIdaPercentual?: number;
  diferencaLucro?: number;
  diferencaMargemPercentual?: number;
}

export interface ResultadoCenarioMargem {
  id: string;
  nome: string;
  receitaLiquida?: number;
  custoTotalFinal?: number;
  lucroLiquidoEstimado?: number;
  margemLiquidaPercentual?: number;
  markupPercentual?: number;
  receitaPorKm?: number;
  custoPorKm?: number;
  lucroPorKm?: number;
  classificacao?: ClassificacaoMargem;
  alertas: string[];
  nivelCompletude: NivelCompletude;
}

export interface ItemRankingMargem {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface ComparacaoCenariosMargem {
  cenarios: ResultadoCenarioMargem[];
  rankingPorLucro: ItemRankingMargem[];
  rankingPorMargem: ItemRankingMargem[];
  rankingPorLucroPorKm: ItemRankingMargem[];
  /** Proxy simples (maior margem líquida = menor risco); não é um modelo de risco. */
  rankingPorMenorRiscoPrejuizo: ItemRankingMargem[];
  rankingPorReceitaLiquida: ItemRankingMargem[];
  alertas: string[];
}

export interface PrevistoRealizadoMargem {
  receitaPrevista?: number;
  receitaRealizada?: number;
  custoPrevisto?: number;
  custoRealizado?: number;
  lucroPrevisto?: number;
  lucroRealizado?: number;
  margemPrevistaPercentual?: number;
  margemRealizadaPercentual?: number;
  diferencaReceita?: number;
  diferencaCusto?: number;
  diferencaLucro?: number;
  diferencaMargemPercentual?: number;
  principalDesvio?: string;
  alertas: string[];
}

export interface CalcularMargemResultado extends ResultadoFerramentaBase {
  modo: ModoCalculoMargem;
  descricao?: string;

  receitaBrutaTotal?: number;
  descontos?: number;
  devolucoes?: number;
  impostos?: number;
  comissoes?: number;
  outrasDeducoes?: number;
  receitaLiquida?: number;

  custosDiretos?: number;
  custosVariaveis?: number;
  custosFixosRateados?: number;
  custosIndiretos?: number;
  custoTotalFinal?: number;

  lucroBruto?: number;
  lucroOperacional?: number;
  lucroLiquidoEstimado?: number;

  margemBrutaPercentual?: number;
  margemOperacionalPercentual?: number;
  margemLiquidaPercentual?: number;
  markupPercentual?: number;
  fatorMarkup?: number;

  receitaPorKm?: number;
  custoPorKm?: number;
  lucroPorKm?: number;
  receitaPorTonelada?: number;
  custoPorTonelada?: number;
  lucroPorTonelada?: number;
  lucroPorVeiculo?: number;
  lucroPorViagem?: number;

  receitaPontoEquilibrio?: number;
  receitaParaMargemAlvo?: number;
  /** Preço com markup-alvo — não está na lista original de campos, mas a fórmula 18 e o teste 12 exigem o valor. */
  receitaComMarkupAlvo?: number;
  valorAdicionalParaEquilibrio?: number;
  valorAdicionalParaMargemAlvo?: number;

  impactoRetornoVazio?: ImpactoRetornoVazio;
  comparacaoCenarios?: ComparacaoCenariosMargem;
  previstoRealizado?: PrevistoRealizadoMargem;

  classificacao?: ClassificacaoMargem;
  nivelCompletude: NivelCompletude;
  custosIncluidos: string[];
  custosIgnorados: string[];
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
}

function casasDecimaisDe(entrada: CalcularMargemEntrada): CasasDecimais {
  const override = entrada.casasDecimais;
  return {
    moeda: override ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    percentual: override ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    custoPorKm: override ?? CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO,
    tonelada: override ?? CASAS_DECIMAIS_TONELADA_PADRAO,
  };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function coletarCamposNumericos(v: DadosMargemVariante, rotulo: string): Array<[string, number | undefined]> {
  return [
    [`${rotulo}.receitaBruta`, v.receitaBruta],
    [`${rotulo}.receitaAdicional`, v.receitaAdicional],
    [`${rotulo}.descontos`, v.descontos],
    [`${rotulo}.devolucoes`, v.devolucoes],
    [`${rotulo}.impostos`, v.impostos],
    [`${rotulo}.comissoes`, v.comissoes],
    [`${rotulo}.outrasDeducoes`, v.outrasDeducoes],
    [`${rotulo}.custoTotal`, v.custoTotal],
    [`${rotulo}.custosVariaveis`, v.custosVariaveis],
    [`${rotulo}.custosFixosRateados`, v.custosFixosRateados],
    [`${rotulo}.custosDiretos`, v.custosDiretos],
    [`${rotulo}.custosIndiretos`, v.custosIndiretos],
    [`${rotulo}.custoViagem`, v.custoViagem],
    [`${rotulo}.custoRetorno`, v.custoRetorno],
    [`${rotulo}.custoAdministrativo`, v.custoAdministrativo],
    [`${rotulo}.outrosCustos`, v.outrosCustos],
    [`${rotulo}.receitaIda`, v.receitaIda],
    [`${rotulo}.receitaRetorno`, v.receitaRetorno],
    [`${rotulo}.quilometragemTotal`, v.quilometragemTotal],
    [`${rotulo}.distanciaCarregadaKm`, v.distanciaCarregadaKm],
    [`${rotulo}.pesoCargaToneladas`, v.pesoCargaToneladas],
    [`${rotulo}.quantidadeVeiculos`, v.quantidadeVeiculos],
    [`${rotulo}.quantidadeViagens`, v.quantidadeViagens],
  ];
}

function validarVariante(v: DadosMargemVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) {
      erros.push(`O campo "${campo}" não pode ser negativo.`);
    }
  }

  if (v.receitaBruta === 0) {
    erros.push(`${rotulo}: a receita não pode ser igual a zero.`);
  }

  for (const [campo, valor] of [
    [`${rotulo}.aliquotaImpostosPercentual`, v.aliquotaImpostosPercentual],
    [`${rotulo}.aliquotaComissaoPercentual`, v.aliquotaComissaoPercentual],
    [`${rotulo}.margemAlvoPercentual`, v.margemAlvoPercentual],
  ] as Array<[string, number | undefined]>) {
    if (valor !== undefined && (valor < 0 || valor > 100)) {
      erros.push(`"${campo}" deve estar entre 0 e 100.`);
    }
  }

  if (v.markupAlvoPercentual !== undefined && v.markupAlvoPercentual < 0) {
    erros.push(`"${rotulo}.markupAlvoPercentual" não pode ser negativo.`);
  }

  if (v.resumoCustoViagem) {
    const r = v.resumoCustoViagem;
    for (const [campo, valor] of [
      [`${rotulo}.resumoCustoViagem.custoTotal`, r.custoTotal],
      [`${rotulo}.resumoCustoViagem.custosVariaveis`, r.custosVariaveis],
      [`${rotulo}.resumoCustoViagem.custosFixosProporcionais`, r.custosFixosProporcionais],
      [`${rotulo}.resumoCustoViagem.custosDiretos`, r.custosDiretos],
      [`${rotulo}.resumoCustoViagem.custosIndiretos`, r.custosIndiretos],
      [`${rotulo}.resumoCustoViagem.distanciaTotalKm`, r.distanciaTotalKm],
      [`${rotulo}.resumoCustoViagem.quantidadeVeiculos`, r.quantidadeVeiculos],
    ] as Array<[string, number | undefined]>) {
      if (valor !== undefined && valor < 0) erros.push(`O campo "${campo}" não pode ser negativo.`);
    }
  }

  return erros;
}

function validarEstruturaTopo(entrada: CalcularMargemEntrada): string[] {
  const erros: string[] = [];

  if (entrada.modo === "COMPARACAO_CENARIOS") {
    if (!entrada.cenarios || entrada.cenarios.length < 2) {
      erros.push("COMPARACAO_CENARIOS exige ao menos dois cenários em \"cenarios\".");
    }
  }
  if (entrada.modo === "PREVISTO_X_REALIZADO") {
    if (!entrada.previsto || !entrada.realizado) {
      erros.push('PREVISTO_X_REALIZADO exige os blocos "previsto" e "realizado" completos.');
    }
  }
  if (entrada.modo === "MARGEM_ALVO" && entrada.margemAlvoPercentual === undefined) {
    erros.push('O modo MARGEM_ALVO exige "margemAlvoPercentual".');
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — custo (total x resumo x detalhado)
// ---------------------------------------------------------------------------

interface FonteCustoResolvida {
  custoTotalFinal?: number;
  custosDiretos?: number;
  custosVariaveis?: number;
  custosFixosRateados?: number;
  custosIndiretos?: number;
  custosIncluidos: string[];
  custosIgnorados: string[];
  alertas: string[];
  erro?: string;
}

const CAMPOS_CUSTO_DETALHADO: Array<[keyof DadosMargemVariante, string]> = [
  ["custosVariaveis", "custosVariaveis"],
  ["custosFixosRateados", "custosFixosRateados"],
  ["custosDiretos", "custosDiretos"],
  ["custosIndiretos", "custosIndiretos"],
  ["custoViagem", "custoViagem"],
  ["custoRetorno", "custoRetorno"],
  ["custoAdministrativo", "custoAdministrativo"],
  ["outrosCustos", "outrosCustos"],
];

function resolverCustoTotalFinal(v: DadosMargemVariante, estrategia: EstrategiaSobreposicao, rotulo: string): FonteCustoResolvida {
  const temTotal = v.custoTotal !== undefined;
  const temResumo = v.resumoCustoViagem?.custoTotal !== undefined;
  const camposDetalhadosPresentes = CAMPOS_CUSTO_DETALHADO.filter(([campo]) => v[campo] !== undefined);
  const temDetalhado = camposDetalhadosPresentes.length > 0;

  const quantidadeFontes = [temTotal, temResumo, temDetalhado].filter(Boolean).length;

  if (quantidadeFontes === 0) {
    return { custosIncluidos: [], custosIgnorados: [], alertas: [] };
  }

  if (quantidadeFontes > 1 && estrategia === "REJEITAR_SOBREPOSICAO") {
    const nomes: string[] = [];
    if (temTotal) nomes.push("custoTotal");
    if (temResumo) nomes.push("resumoCustoViagem");
    if (temDetalhado) nomes.push("categorias detalhadas (custosVariaveis/custosFixosRateados/custosDiretos/custosIndiretos/custoViagem/custoRetorno/custoAdministrativo/outrosCustos)");
    return {
      custosIncluidos: [],
      custosIgnorados: [],
      alertas: [],
      erro: `${rotulo}: custo informado por mais de uma fonte (${nomes.join(", ")}). Informe apenas uma, ou defina "estrategiaSobreposicao".`,
    };
  }

  let usarTotalOuResumo = temTotal || temResumo;
  let usarDetalhado = temDetalhado;
  const alertas: string[] = [];

  if (quantidadeFontes > 1) {
    if (estrategia === "PRIORIZAR_TOTAL") {
      usarDetalhado = false;
      alertas.push(`${rotulo}: sobreposição de custo resolvida por "PRIORIZAR_TOTAL" — usado ${temTotal ? "custoTotal" : "resumoCustoViagem"}, ignorado o detalhamento.`);
    } else {
      usarTotalOuResumo = false;
      alertas.push(`${rotulo}: sobreposição de custo resolvida por "PRIORIZAR_DETALHADO" — usado o detalhamento, ignorado ${temTotal ? "custoTotal" : "resumoCustoViagem"}.`);
    }
  }

  if (usarTotalOuResumo) {
    const valor = temTotal ? (v.custoTotal as number) : (v.resumoCustoViagem?.custoTotal as number);
    const origem = temTotal ? "custoTotal" : "resumoCustoViagem.custoTotal";
    return {
      custoTotalFinal: valor,
      custosDiretos: v.resumoCustoViagem?.custosDiretos,
      custosVariaveis: v.resumoCustoViagem?.custosVariaveis,
      custosFixosRateados: v.resumoCustoViagem?.custosFixosProporcionais,
      custosIndiretos: v.resumoCustoViagem?.custosIndiretos,
      custosIncluidos: [origem],
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
      custoTotalFinal: soma,
      custosDiretos: v.custosDiretos,
      custosVariaveis: v.custosVariaveis,
      custosFixosRateados: v.custosFixosRateados,
      custosIndiretos: v.custosIndiretos,
      custosIncluidos: incluidos,
      custosIgnorados: ignorados,
      alertas,
    };
  }

  return { custosIncluidos: [], custosIgnorados: [], alertas: [] };
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição — valor fixo x percentual (impostos/comissão)
// ---------------------------------------------------------------------------

interface ValorOuAliquotaResolvido {
  valor?: number;
  modoUsado?: "FLAT" | "PERCENTUAL";
  origem?: string;
  alerta?: string;
  erro?: string;
}

function resolverValorOuAliquota(
  valorFlat: number | undefined,
  aliquotaPercentual: number | undefined,
  base: number | undefined,
  rotuloCampo: string,
  estrategia: EstrategiaSobreposicao
): ValorOuAliquotaResolvido {
  // Sem receita conhecida (ex.: PONTO_EQUILIBRIO/MARGEM_ALVO sem receitaBruta), um
  // percentual não vira um valor em R$ concreto — ficaria enganoso mostrar "R$ 0,00".
  // O percentual em si ainda é usado (via `modoUsado`) nas fórmulas de equilíbrio/alvo.
  const calcularValorPercentual = (percentual: number) => (base !== undefined ? (base * percentual) / 100 : undefined);

  if (valorFlat !== undefined && aliquotaPercentual !== undefined) {
    if (estrategia === "REJEITAR_SOBREPOSICAO") {
      return { erro: `${rotuloCampo} informado como valor fixo e também como percentual. Informe apenas um, ou defina "estrategiaSobreposicao".` };
    }
    if (estrategia === "PRIORIZAR_TOTAL") {
      return {
        valor: valorFlat,
        modoUsado: "FLAT",
        origem: `${rotuloCampo} (valor informado)`,
        alerta: `Sobreposição em ${rotuloCampo} resolvida por "PRIORIZAR_TOTAL" — usado o valor fixo, ignorado o percentual.`,
      };
    }
    return {
      valor: calcularValorPercentual(aliquotaPercentual),
      modoUsado: "PERCENTUAL",
      origem: `${rotuloCampo} (${formatarNumero(aliquotaPercentual)}% sobre a receita bruta)`,
      alerta: `Sobreposição em ${rotuloCampo} resolvida por "PRIORIZAR_DETALHADO" — usado o percentual, ignorado o valor fixo.`,
    };
  }
  if (valorFlat !== undefined) return { valor: valorFlat, modoUsado: "FLAT", origem: `${rotuloCampo} (valor informado)` };
  if (aliquotaPercentual !== undefined) {
    return {
      valor: calcularValorPercentual(aliquotaPercentual),
      modoUsado: "PERCENTUAL",
      origem: `${rotuloCampo} (${formatarNumero(aliquotaPercentual)}% sobre a receita bruta)`,
    };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Delegação a calcular-cpk.ts (divisões que nunca são negativas)
// ---------------------------------------------------------------------------

function dividirViaCpk(valor: number, divisor: number, casas: number): number | undefined {
  const resultado = calcularCpk({
    modo: "CPK_PNEUS",
    custoPneus: valor,
    quilometragem: divisor,
    arredondamentoCasasDecimais: casas,
  });
  return resultado.sucesso ? resultado.resultados.cpk : undefined;
}

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

function classificarMargem(margemPercentual: number): ClassificacaoMargem {
  if (margemPercentual < 0) return "PREJUIZO";
  if (margemPercentual <= LIMITES_CLASSIFICACAO_MARGEM.baixaAtePercentual) return "MARGEM_BAIXA";
  if (margemPercentual <= LIMITES_CLASSIFICACAO_MARGEM.moderadaAtePercentual) return "MARGEM_MODERADA";
  if (margemPercentual <= LIMITES_CLASSIFICACAO_MARGEM.saudavelAtePercentual) return "MARGEM_SAUDAVEL";
  return "MARGEM_ELEVADA";
}

// ---------------------------------------------------------------------------
// Núcleo de cálculo (usado pelo modo direto, por cada cenário e por previsto/realizado)
// ---------------------------------------------------------------------------

interface AgregacaoMargem {
  receitaBrutaTotal?: number;
  descontos: number;
  devolucoes: number;
  impostos?: number;
  comissoes?: number;
  outrasDeducoes: number;
  receitaLiquida?: number;

  custosDiretos?: number;
  custosVariaveis?: number;
  custosFixosRateados?: number;
  custosIndiretos?: number;
  custoTotalFinal?: number;

  lucroBruto?: number;
  lucroOperacional?: number;
  lucroLiquidoEstimado?: number;

  margemBrutaPercentual?: number;
  margemOperacionalPercentual?: number;
  margemLiquidaPercentual?: number;
  markupPercentual?: number;
  fatorMarkup?: number;

  receitaPorKm?: number;
  custoPorKm?: number;
  lucroPorKm?: number;
  receitaPorTonelada?: number;
  custoPorTonelada?: number;
  lucroPorTonelada?: number;
  lucroPorVeiculo?: number;
  lucroPorViagem?: number;

  receitaPontoEquilibrio?: number;
  receitaParaMargemAlvo?: number;
  receitaComMarkupAlvo?: number;
  valorAdicionalParaEquilibrio?: number;
  valorAdicionalParaMargemAlvo?: number;

  impostoInformado: boolean;
  comissaoInformado: boolean;
  indiretoInformado: boolean;

  custosIncluidos: string[];
  custosIgnorados: string[];
  alertas: string[];
  premissas: string[];
  dadosFaltantes: string[];
  errosValidacao: string[];

  receitaValida: boolean;
  custoValido: boolean;
}

function calcularNucleo(
  v: DadosMargemVariante,
  modo: ModoCalculoMargem,
  estrategia: EstrategiaSobreposicao,
  rotulo: string,
  casas: CasasDecimais
): AgregacaoMargem {
  const alertas: string[] = [];
  const premissas: string[] = [];
  const dadosFaltantes: string[] = [];
  const errosValidacao: string[] = [];

  const exigeReceita = !MODOS_SEM_RECEITA_OBRIGATORIA.includes(modo);

  let receitaBrutaTotal: number | undefined;
  if (v.receitaBruta !== undefined) {
    receitaBrutaTotal = v.receitaBruta + (v.receitaAdicional ?? 0);
  } else if (exigeReceita) {
    dadosFaltantes.push(`${rotulo}.receitaBruta`);
  }

  const fonteCusto = resolverCustoTotalFinal(v, estrategia, rotulo);
  if (fonteCusto.erro) errosValidacao.push(fonteCusto.erro);
  alertas.push(...fonteCusto.alertas);
  if (fonteCusto.custoTotalFinal === undefined) {
    dadosFaltantes.push(`${rotulo}.custoTotal (ou categorias detalhadas, ou resumoCustoViagem)`);
  }

  if (modo === "MARGEM_POR_KM" && (v.quilometragemTotal === undefined || v.quilometragemTotal <= 0)) {
    dadosFaltantes.push(`${rotulo}.quilometragemTotal`);
  }
  if (modo === "MARGEM_POR_TONELADA" && (v.pesoCargaToneladas === undefined || v.pesoCargaToneladas <= 0)) {
    dadosFaltantes.push(`${rotulo}.pesoCargaToneladas`);
  }

  if (errosValidacao.length > 0 || dadosFaltantes.length > 0) {
    return {
      descontos: 0,
      devolucoes: 0,
      outrasDeducoes: 0,
      impostoInformado: false,
      comissaoInformado: false,
      indiretoInformado: false,
      custosIncluidos: [],
      custosIgnorados: [],
      alertas,
      premissas,
      dadosFaltantes,
      errosValidacao,
      receitaValida: receitaBrutaTotal !== undefined,
      custoValido: fonteCusto.custoTotalFinal !== undefined,
    };
  }

  const impostoResolvido = resolverValorOuAliquota(v.impostos, v.aliquotaImpostosPercentual, receitaBrutaTotal, "impostos", estrategia);
  if (impostoResolvido.erro) errosValidacao.push(`${rotulo}: ${impostoResolvido.erro}`);
  if (impostoResolvido.alerta) alertas.push(`${rotulo}: ${impostoResolvido.alerta}`);
  if (impostoResolvido.origem) premissas.push(`${rotulo}: imposto calculado com base em ${impostoResolvido.origem}.`);

  const comissaoResolvida = resolverValorOuAliquota(v.comissoes, v.aliquotaComissaoPercentual, receitaBrutaTotal, "comissoes", estrategia);
  if (comissaoResolvida.erro) errosValidacao.push(`${rotulo}: ${comissaoResolvida.erro}`);
  if (comissaoResolvida.alerta) alertas.push(`${rotulo}: ${comissaoResolvida.alerta}`);
  if (comissaoResolvida.origem) premissas.push(`${rotulo}: comissão calculada com base em ${comissaoResolvida.origem}.`);

  if (errosValidacao.length > 0) {
    return {
      descontos: 0,
      devolucoes: 0,
      outrasDeducoes: 0,
      impostoInformado: false,
      comissaoInformado: false,
      indiretoInformado: false,
      custosIncluidos: [],
      custosIgnorados: [],
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      receitaValida: receitaBrutaTotal !== undefined,
      custoValido: fonteCusto.custoTotalFinal !== undefined,
    };
  }

  const descontos = v.descontos ?? 0;
  const devolucoes = v.devolucoes ?? 0;
  const outrasDeducoes = v.outrasDeducoes ?? 0;
  const impostosValor = impostoResolvido.valor;
  const comissoesValor = comissaoResolvida.valor;

  let receitaLiquida: number | undefined;
  if (receitaBrutaTotal !== undefined) {
    receitaLiquida = receitaBrutaTotal - descontos - devolucoes - (impostosValor ?? 0) - (comissoesValor ?? 0) - outrasDeducoes;
  }

  const custoTotalFinal = fonteCusto.custoTotalFinal;

  let lucroBruto: number | undefined;
  if (receitaBrutaTotal !== undefined && fonteCusto.custosDiretos !== undefined) {
    lucroBruto = receitaBrutaTotal - fonteCusto.custosDiretos;
  }

  const temBucketOperacional =
    fonteCusto.custosVariaveis !== undefined ||
    fonteCusto.custosFixosRateados !== undefined ||
    fonteCusto.custosDiretos !== undefined ||
    fonteCusto.custosIndiretos !== undefined;
  let lucroOperacional: number | undefined;
  if (receitaLiquida !== undefined && temBucketOperacional) {
    const somaBuckets =
      (fonteCusto.custosVariaveis ?? 0) + (fonteCusto.custosFixosRateados ?? 0) + (fonteCusto.custosDiretos ?? 0) + (fonteCusto.custosIndiretos ?? 0);
    lucroOperacional = receitaLiquida - somaBuckets;
  }

  let lucroLiquidoEstimado: number | undefined;
  if (receitaLiquida !== undefined && custoTotalFinal !== undefined) {
    lucroLiquidoEstimado = receitaLiquida - custoTotalFinal;
  }

  let margemBrutaPercentual: number | undefined;
  if (lucroBruto !== undefined && receitaBrutaTotal !== undefined && receitaBrutaTotal > 0) {
    margemBrutaPercentual = (lucroBruto / receitaBrutaTotal) * 100;
  }
  let margemOperacionalPercentual: number | undefined;
  if (lucroOperacional !== undefined && receitaLiquida !== undefined && receitaLiquida !== 0) {
    margemOperacionalPercentual = (lucroOperacional / receitaLiquida) * 100;
  }
  let margemLiquidaPercentual: number | undefined;
  if (lucroLiquidoEstimado !== undefined && receitaLiquida !== undefined && receitaLiquida !== 0) {
    margemLiquidaPercentual = (lucroLiquidoEstimado / receitaLiquida) * 100;
  }

  let markupPercentual: number | undefined;
  let fatorMarkup: number | undefined;
  if (receitaLiquida !== undefined && custoTotalFinal !== undefined && custoTotalFinal > 0) {
    fatorMarkup = receitaLiquida / custoTotalFinal;
    markupPercentual = (fatorMarkup - 1) * 100;
  }

  let receitaPorKm: number | undefined;
  let custoPorKm: number | undefined;
  let lucroPorKm: number | undefined;
  if (v.quilometragemTotal !== undefined && v.quilometragemTotal > 0) {
    if (receitaLiquida !== undefined) receitaPorKm = dividirViaCpk(receitaLiquida, v.quilometragemTotal, casas.custoPorKm);
    if (custoTotalFinal !== undefined) custoPorKm = dividirViaCpk(custoTotalFinal, v.quilometragemTotal, casas.custoPorKm);
    if (lucroLiquidoEstimado !== undefined) lucroPorKm = arredondar(lucroLiquidoEstimado / v.quilometragemTotal, casas.custoPorKm);
  }

  let receitaPorTonelada: number | undefined;
  let custoPorTonelada: number | undefined;
  let lucroPorTonelada: number | undefined;
  if (v.pesoCargaToneladas !== undefined && v.pesoCargaToneladas > 0) {
    if (receitaLiquida !== undefined) receitaPorTonelada = dividirViaCpk(receitaLiquida, v.pesoCargaToneladas, casas.tonelada);
    if (custoTotalFinal !== undefined) custoPorTonelada = dividirViaCpk(custoTotalFinal, v.pesoCargaToneladas, casas.tonelada);
    if (lucroLiquidoEstimado !== undefined) lucroPorTonelada = arredondar(lucroLiquidoEstimado / v.pesoCargaToneladas, casas.tonelada);
  }

  let lucroPorVeiculo: number | undefined;
  if (v.quantidadeVeiculos !== undefined && v.quantidadeVeiculos > 0 && lucroLiquidoEstimado !== undefined) {
    lucroPorVeiculo = arredondar(lucroLiquidoEstimado / v.quantidadeVeiculos, casas.moeda);
  }
  let lucroPorViagem: number | undefined;
  if (v.quantidadeViagens !== undefined && v.quantidadeViagens > 0 && lucroLiquidoEstimado !== undefined) {
    lucroPorViagem = arredondar(lucroLiquidoEstimado / v.quantidadeViagens, casas.moeda);
  }

  const percentualImpostoEfetivo = impostoResolvido.modoUsado === "PERCENTUAL" ? (v.aliquotaImpostosPercentual ?? 0) : 0;
  const percentualComissaoEfetivo = comissaoResolvida.modoUsado === "PERCENTUAL" ? (v.aliquotaComissaoPercentual ?? 0) : 0;
  const percentualDeducoesDecimal = (percentualImpostoEfetivo + percentualComissaoEfetivo) / 100;

  const flatImposto = impostoResolvido.modoUsado === "FLAT" ? (impostoResolvido.valor ?? 0) : 0;
  const flatComissao = comissaoResolvida.modoUsado === "FLAT" ? (comissaoResolvida.valor ?? 0) : 0;
  const deducoesFlat = descontos + devolucoes + flatImposto + flatComissao + outrasDeducoes;

  let receitaPontoEquilibrio: number | undefined;
  if (custoTotalFinal !== undefined) {
    if (percentualDeducoesDecimal >= 1) {
      errosValidacao.push(
        `${rotulo}: o percentual de deduções (${formatarNumero(percentualDeducoesDecimal * 100)}%) é maior ou igual a 100%; não é possível calcular o ponto de equilíbrio.`
      );
    } else {
      receitaPontoEquilibrio = (custoTotalFinal + deducoesFlat) / (1 - percentualDeducoesDecimal);
    }
  }

  let receitaParaMargemAlvo: number | undefined;
  if (custoTotalFinal !== undefined && v.margemAlvoPercentual !== undefined) {
    const margemAlvoDecimal = v.margemAlvoPercentual / 100;
    const denominador = 1 - margemAlvoDecimal - percentualDeducoesDecimal;
    if (denominador <= 0) {
      errosValidacao.push(
        `${rotulo}: a margem-alvo somada às deduções percentuais resulta em denominador inválido (${formatarNumero(denominador)}); ajuste a margem-alvo ou as alíquotas.`
      );
    } else {
      receitaParaMargemAlvo = (custoTotalFinal + deducoesFlat) / denominador;
    }
  }

  let receitaComMarkupAlvo: number | undefined;
  if (custoTotalFinal !== undefined && v.markupAlvoPercentual !== undefined) {
    receitaComMarkupAlvo = custoTotalFinal * (1 + v.markupAlvoPercentual / 100);
  }

  if (errosValidacao.length > 0) {
    return {
      descontos,
      devolucoes,
      outrasDeducoes,
      impostoInformado: impostosValor !== undefined,
      comissaoInformado: comissoesValor !== undefined,
      indiretoInformado: fonteCusto.custosIndiretos !== undefined || v.custoAdministrativo !== undefined,
      custosIncluidos: fonteCusto.custosIncluidos,
      custosIgnorados: fonteCusto.custosIgnorados,
      alertas,
      premissas,
      dadosFaltantes: [],
      errosValidacao,
      receitaValida: receitaBrutaTotal !== undefined,
      custoValido: custoTotalFinal !== undefined,
    };
  }

  const valorAdicionalParaEquilibrio =
    receitaPontoEquilibrio !== undefined && receitaBrutaTotal !== undefined ? receitaPontoEquilibrio - receitaBrutaTotal : undefined;
  const valorAdicionalParaMargemAlvo =
    receitaParaMargemAlvo !== undefined && receitaBrutaTotal !== undefined ? receitaParaMargemAlvo - receitaBrutaTotal : undefined;

  const c = casas.moeda;
  const p = casas.percentual;

  return {
    receitaBrutaTotal: receitaBrutaTotal !== undefined ? arredondar(receitaBrutaTotal, c) : undefined,
    descontos: arredondar(descontos, c),
    devolucoes: arredondar(devolucoes, c),
    impostos: impostosValor !== undefined ? arredondar(impostosValor, c) : undefined,
    comissoes: comissoesValor !== undefined ? arredondar(comissoesValor, c) : undefined,
    outrasDeducoes: arredondar(outrasDeducoes, c),
    receitaLiquida: receitaLiquida !== undefined ? arredondar(receitaLiquida, c) : undefined,

    custosDiretos: fonteCusto.custosDiretos !== undefined ? arredondar(fonteCusto.custosDiretos, c) : undefined,
    custosVariaveis: fonteCusto.custosVariaveis !== undefined ? arredondar(fonteCusto.custosVariaveis, c) : undefined,
    custosFixosRateados: fonteCusto.custosFixosRateados !== undefined ? arredondar(fonteCusto.custosFixosRateados, c) : undefined,
    custosIndiretos: fonteCusto.custosIndiretos !== undefined ? arredondar(fonteCusto.custosIndiretos, c) : undefined,
    custoTotalFinal: custoTotalFinal !== undefined ? arredondar(custoTotalFinal, c) : undefined,

    lucroBruto: lucroBruto !== undefined ? arredondar(lucroBruto, c) : undefined,
    lucroOperacional: lucroOperacional !== undefined ? arredondar(lucroOperacional, c) : undefined,
    lucroLiquidoEstimado: lucroLiquidoEstimado !== undefined ? arredondar(lucroLiquidoEstimado, c) : undefined,

    margemBrutaPercentual: margemBrutaPercentual !== undefined ? arredondar(margemBrutaPercentual, p) : undefined,
    margemOperacionalPercentual: margemOperacionalPercentual !== undefined ? arredondar(margemOperacionalPercentual, p) : undefined,
    margemLiquidaPercentual: margemLiquidaPercentual !== undefined ? arredondar(margemLiquidaPercentual, p) : undefined,
    markupPercentual: markupPercentual !== undefined ? arredondar(markupPercentual, p) : undefined,
    fatorMarkup: fatorMarkup !== undefined ? arredondar(fatorMarkup, casas.custoPorKm) : undefined,

    receitaPorKm,
    custoPorKm,
    lucroPorKm,
    receitaPorTonelada,
    custoPorTonelada,
    lucroPorTonelada,
    lucroPorVeiculo,
    lucroPorViagem,

    receitaPontoEquilibrio: receitaPontoEquilibrio !== undefined ? arredondar(receitaPontoEquilibrio, c) : undefined,
    receitaParaMargemAlvo: receitaParaMargemAlvo !== undefined ? arredondar(receitaParaMargemAlvo, c) : undefined,
    receitaComMarkupAlvo: receitaComMarkupAlvo !== undefined ? arredondar(receitaComMarkupAlvo, c) : undefined,
    valorAdicionalParaEquilibrio: valorAdicionalParaEquilibrio !== undefined ? arredondar(valorAdicionalParaEquilibrio, c) : undefined,
    valorAdicionalParaMargemAlvo: valorAdicionalParaMargemAlvo !== undefined ? arredondar(valorAdicionalParaMargemAlvo, c) : undefined,

    impostoInformado: impostosValor !== undefined,
    comissaoInformado: comissoesValor !== undefined,
    indiretoInformado: fonteCusto.custosIndiretos !== undefined || v.custoAdministrativo !== undefined,

    custosIncluidos: fonteCusto.custosIncluidos,
    custosIgnorados: fonteCusto.custosIgnorados,
    alertas,
    premissas,
    dadosFaltantes: [],
    errosValidacao: [],
    receitaValida: receitaBrutaTotal !== undefined,
    custoValido: custoTotalFinal !== undefined,
  };
}

// ---------------------------------------------------------------------------
// Nível de completude
// ---------------------------------------------------------------------------

function determinarCompletude(modo: ModoCalculoMargem, ag: AgregacaoMargem): NivelCompletude {
  if (!ag.custoValido) return "INSUFICIENTE";
  if (!MODOS_SEM_RECEITA_OBRIGATORIA.includes(modo) && !ag.receitaValida) return "INSUFICIENTE";
  if (MODOS_SEM_RECEITA_OBRIGATORIA.includes(modo)) return "COMPLETO";

  if (!ag.impostoInformado || !ag.comissaoInformado || !ag.indiretoInformado) return "PARCIAL";
  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Impacto do retorno vazio
// ---------------------------------------------------------------------------

function calcularImpactoRetornoVazio(v: DadosMargemVariante, casas: CasasDecimais): ImpactoRetornoVazio | undefined {
  if (v.custoViagem === undefined || v.custoRetorno === undefined || v.receitaIda === undefined) return undefined;

  const receitaRetorno = v.receitaRetorno ?? 0;
  const custoTotal = v.custoViagem + v.custoRetorno;
  const receitaTotal = v.receitaIda + receitaRetorno;
  const lucroComRetorno = receitaTotal - custoTotal;
  const margemComRetornoPercentual = receitaTotal > 0 ? (lucroComRetorno / receitaTotal) * 100 : undefined;

  const lucroSoIda = v.receitaIda - v.custoViagem;
  const margemSoIdaPercentual = v.receitaIda > 0 ? (lucroSoIda / v.receitaIda) * 100 : undefined;

  return {
    custoIda: arredondar(v.custoViagem, casas.moeda),
    custoRetorno: arredondar(v.custoRetorno, casas.moeda),
    receitaIda: arredondar(v.receitaIda, casas.moeda),
    receitaRetorno: arredondar(receitaRetorno, casas.moeda),
    lucroComRetorno: arredondar(lucroComRetorno, casas.moeda),
    margemComRetornoPercentual: margemComRetornoPercentual !== undefined ? arredondar(margemComRetornoPercentual, casas.percentual) : undefined,
    lucroSoIda: arredondar(lucroSoIda, casas.moeda),
    margemSoIdaPercentual: margemSoIdaPercentual !== undefined ? arredondar(margemSoIdaPercentual, casas.percentual) : undefined,
    diferencaLucro: arredondar(lucroSoIda - lucroComRetorno, casas.moeda),
    diferencaMargemPercentual:
      margemComRetornoPercentual !== undefined && margemSoIdaPercentual !== undefined
        ? arredondar(margemSoIdaPercentual - margemComRetornoPercentual, casas.percentual)
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirResumo(ag: AgregacaoMargem, nivelCompletude: NivelCompletude, classificacao: ClassificacaoMargem | undefined): string {
  if (ag.receitaLiquida === undefined || ag.custoTotalFinal === undefined) {
    return "Não foi possível concluir o cálculo com os dados informados. Verifique os campos faltantes.";
  }

  const partes: string[] = [];
  partes.push(`A operação apresentou receita líquida de ${formatarBRL(ag.receitaLiquida)} e custo total estimado de ${formatarBRL(ag.custoTotalFinal)}.`);

  if (ag.lucroLiquidoEstimado !== undefined) {
    const verbo = ag.lucroLiquidoEstimado >= 0 ? "lucro" : "prejuízo";
    partes.push(
      `O ${verbo} estimado foi de ${formatarBRL(Math.abs(ag.lucroLiquidoEstimado))}${
        ag.margemLiquidaPercentual !== undefined ? `, correspondente a uma margem de ${formatarNumero(ag.margemLiquidaPercentual)}% sobre a receita líquida` : ""
      }.`
    );
  }

  if (classificacao) {
    partes.push(`Classificação: ${classificacao}.`);
  }

  if (nivelCompletude === "PARCIAL") {
    const faltando: string[] = [];
    if (!ag.impostoInformado) faltando.push("impostos");
    if (!ag.comissaoInformado) faltando.push("comissão");
    if (!ag.indiretoInformado) faltando.push("custos indiretos/administrativos");
    partes.push(`O resultado foi classificado como parcial porque não foram informados: ${faltando.join(", ")}.`);
  } else if (nivelCompletude === "INSUFICIENTE") {
    partes.push("O resultado foi classificado como insuficiente para uma conclusão financeira confiável.");
  }

  return partes.join(" ");
}

function construirMemoriaCalculo(rotulo: string, ag: AgregacaoMargem): string[] {
  const linhas: string[] = [];
  if (ag.receitaBrutaTotal !== undefined) {
    linhas.push(
      `${rotulo}: receita bruta total ${formatarBRL(ag.receitaBrutaTotal)} − descontos ${formatarBRL(ag.descontos)} − devoluções ${formatarBRL(
        ag.devolucoes
      )} − impostos ${formatarBRL(ag.impostos ?? 0)} − comissões ${formatarBRL(ag.comissoes ?? 0)} − outras deduções ${formatarBRL(
        ag.outrasDeducoes
      )} = receita líquida ${formatarBRL(ag.receitaLiquida ?? 0)}.`
    );
  }
  if (ag.receitaLiquida !== undefined && ag.custoTotalFinal !== undefined) {
    linhas.push(
      `${rotulo}: lucro líquido estimado = ${formatarBRL(ag.receitaLiquida)} − ${formatarBRL(ag.custoTotalFinal)} = ${formatarBRL(
        ag.lucroLiquidoEstimado ?? 0
      )}.`
    );
  }
  if (ag.receitaPontoEquilibrio !== undefined) {
    linhas.push(`${rotulo}: receita de ponto de equilíbrio = ${formatarBRL(ag.receitaPontoEquilibrio)}.`);
  }
  if (ag.receitaParaMargemAlvo !== undefined) {
    linhas.push(`${rotulo}: receita necessária para a margem-alvo = ${formatarBRL(ag.receitaParaMargemAlvo)}.`);
  }
  if (ag.receitaComMarkupAlvo !== undefined) {
    linhas.push(`${rotulo}: receita com markup-alvo = ${formatarBRL(ag.receitaComMarkupAlvo)}.`);
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Fábrica de resposta de falha
// ---------------------------------------------------------------------------

function respostaFalha(entrada: CalcularMargemEntrada, mensagemResumo: string, dadosFaltantes: string[] = []): CalcularMargemResultado {
  return {
    sucesso: false,
    modo: entrada.modo,
    descricao: entrada.descricao,
    nivelCompletude: "INSUFICIENTE",
    custosIncluidos: [],
    custosIgnorados: [],
    limitacoes: LIMITACOES_PADRAO,
    alertas: [],
    premissas: [],
    dadosFaltantes,
    mensagemResumo,
    memoriaCalculo: [],
  };
}

// ---------------------------------------------------------------------------
// Comparação de cenários
// ---------------------------------------------------------------------------

function nomeCenario(cenario: CenarioMargem, index: number): string {
  return cenario.nome ?? cenario.id ?? `Cenário ${index + 1}`;
}

function construirRankingMargem(itens: ResultadoCenarioMargem[], extrair: (r: ResultadoCenarioMargem) => number | undefined): ItemRankingMargem[] {
  return itens
    .filter((r) => extrair(r) !== undefined)
    .sort((a, b) => (extrair(b) as number) - (extrair(a) as number))
    .map((r, i) => ({ id: r.id, nome: r.nome, valor: extrair(r) as number, posicao: i + 1 }));
}

function calcularComparacaoCenarios(
  entrada: CalcularMargemEntrada,
  estrategia: EstrategiaSobreposicao,
  casas: CasasDecimais
): { resultado?: ComparacaoCenariosMargem; erros: string[] } {
  const cenarios = entrada.cenarios as CenarioMargem[];
  const erros: string[] = [];
  const resultados: ResultadoCenarioMargem[] = [];
  const alertasGerais: string[] = [];

  cenarios.forEach((cenario, index) => {
    const nome = nomeCenario(cenario, index);
    const id = cenario.id ?? `cenario-${index + 1}`;
    const errosEstrutura = validarVariante(cenario, nome);
    if (errosEstrutura.length > 0) {
      erros.push(...errosEstrutura);
      return;
    }
    const ag = calcularNucleo(cenario, "MARGEM_SIMPLES", estrategia, nome, casas);
    if (ag.errosValidacao.length > 0) {
      erros.push(...ag.errosValidacao);
      return;
    }
    const nivelCompletude = determinarCompletude("MARGEM_SIMPLES", ag);
    resultados.push({
      id,
      nome,
      receitaLiquida: ag.receitaLiquida,
      custoTotalFinal: ag.custoTotalFinal,
      lucroLiquidoEstimado: ag.lucroLiquidoEstimado,
      margemLiquidaPercentual: ag.margemLiquidaPercentual,
      markupPercentual: ag.markupPercentual,
      receitaPorKm: ag.receitaPorKm,
      custoPorKm: ag.custoPorKm,
      lucroPorKm: ag.lucroPorKm,
      classificacao: ag.margemLiquidaPercentual !== undefined ? classificarMargem(ag.margemLiquidaPercentual) : undefined,
      alertas: ag.alertas,
      nivelCompletude,
    });
  });

  if (erros.length > 0) return { erros };

  const rankingPorLucro = construirRankingMargem(resultados, (r) => r.lucroLiquidoEstimado);
  const rankingPorMargem = construirRankingMargem(resultados, (r) => r.margemLiquidaPercentual);
  const rankingPorLucroPorKm = construirRankingMargem(resultados, (r) => r.lucroPorKm);
  const rankingPorMenorRiscoPrejuizo = rankingPorMargem;
  const rankingPorReceitaLiquida = construirRankingMargem(resultados, (r) => r.receitaLiquida);

  if (rankingPorReceitaLiquida[0] && rankingPorLucro[0] && rankingPorReceitaLiquida[0].id !== rankingPorLucro[0].id) {
    alertasGerais.push(
      `"${rankingPorReceitaLiquida[0].nome}" tem a maior receita líquida, mas não é o cenário com maior lucro ("${rankingPorLucro[0].nome}") — maior faturamento não significa automaticamente o melhor resultado.`
    );
  }

  return {
    resultado: {
      cenarios: resultados,
      rankingPorLucro,
      rankingPorMargem,
      rankingPorLucroPorKm,
      rankingPorMenorRiscoPrejuizo,
      rankingPorReceitaLiquida,
      alertas: alertasGerais,
    },
    erros: [],
  };
}

// ---------------------------------------------------------------------------
// Previsto x realizado
// ---------------------------------------------------------------------------

function calcularPrevistoRealizado(
  entrada: CalcularMargemEntrada,
  estrategia: EstrategiaSobreposicao,
  casas: CasasDecimais
): { resultado?: PrevistoRealizadoMargem; erros: string[]; dadosFaltantes: string[] } {
  const previsto = entrada.previsto as DadosMargemVariante;
  const realizado = entrada.realizado as DadosMargemVariante;

  const errosPrevisto = validarVariante(previsto, "previsto");
  const errosRealizado = validarVariante(realizado, "realizado");
  if (errosPrevisto.length > 0 || errosRealizado.length > 0) {
    return { erros: [...errosPrevisto, ...errosRealizado], dadosFaltantes: [] };
  }

  const agPrevisto = calcularNucleo(previsto, "MARGEM_SIMPLES", estrategia, "previsto", casas);
  const agRealizado = calcularNucleo(realizado, "MARGEM_SIMPLES", estrategia, "realizado", casas);

  if (agPrevisto.errosValidacao.length > 0 || agRealizado.errosValidacao.length > 0) {
    return { erros: [...agPrevisto.errosValidacao, ...agRealizado.errosValidacao], dadosFaltantes: [] };
  }
  if (agPrevisto.dadosFaltantes.length > 0 || agRealizado.dadosFaltantes.length > 0) {
    return { erros: [], dadosFaltantes: [...agPrevisto.dadosFaltantes, ...agRealizado.dadosFaltantes] };
  }

  const diferencaReceita =
    agPrevisto.receitaLiquida !== undefined && agRealizado.receitaLiquida !== undefined
      ? arredondar(agRealizado.receitaLiquida - agPrevisto.receitaLiquida, casas.moeda)
      : undefined;
  const diferencaCusto =
    agPrevisto.custoTotalFinal !== undefined && agRealizado.custoTotalFinal !== undefined
      ? arredondar(agRealizado.custoTotalFinal - agPrevisto.custoTotalFinal, casas.moeda)
      : undefined;
  const diferencaLucro =
    agPrevisto.lucroLiquidoEstimado !== undefined && agRealizado.lucroLiquidoEstimado !== undefined
      ? arredondar(agRealizado.lucroLiquidoEstimado - agPrevisto.lucroLiquidoEstimado, casas.moeda)
      : undefined;
  const diferencaMargemPercentual =
    agPrevisto.margemLiquidaPercentual !== undefined && agRealizado.margemLiquidaPercentual !== undefined
      ? arredondar(agRealizado.margemLiquidaPercentual - agPrevisto.margemLiquidaPercentual, casas.percentual)
      : undefined;

  let principalDesvio: string | undefined;
  const desvioReceita = diferencaReceita !== undefined ? Math.abs(diferencaReceita) : -1;
  const desvioCusto = diferencaCusto !== undefined ? Math.abs(diferencaCusto) : -1;
  if (desvioReceita >= 0 || desvioCusto >= 0) {
    principalDesvio = desvioReceita >= desvioCusto ? "Receita" : "Custo";
  }

  const alertas: string[] = [];
  if (principalDesvio !== undefined) {
    alertas.push(
      `A categoria com maior desvio entre previsto e realizado foi "${principalDesvio}". A causa não foi informada — pode ser variação de mercado, negociação, desvio de rota ou operação adicional.`
    );
  }

  return {
    resultado: {
      receitaPrevista: agPrevisto.receitaLiquida,
      receitaRealizada: agRealizado.receitaLiquida,
      custoPrevisto: agPrevisto.custoTotalFinal,
      custoRealizado: agRealizado.custoTotalFinal,
      lucroPrevisto: agPrevisto.lucroLiquidoEstimado,
      lucroRealizado: agRealizado.lucroLiquidoEstimado,
      margemPrevistaPercentual: agPrevisto.margemLiquidaPercentual,
      margemRealizadaPercentual: agRealizado.margemLiquidaPercentual,
      diferencaReceita,
      diferencaCusto,
      diferencaLucro,
      diferencaMargemPercentual,
      principalDesvio,
      alertas,
    },
    erros: [],
    dadosFaltantes: [],
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

export function calcularMargem(entrada: CalcularMargemEntrada): CalcularMargemResultado {
  const casas = casasDecimaisDe(entrada);
  const estrategia = entrada.estrategiaSobreposicao ?? "REJEITAR_SOBREPOSICAO";

  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) {
    return respostaFalha(entrada, errosTopo.join(" "));
  }

  if (entrada.modo === "COMPARACAO_CENARIOS") {
    const errosCenarios = (entrada.cenarios as CenarioMargem[]).flatMap((c, i) => validarVariante(c, nomeCenario(c, i)));
    if (errosCenarios.length > 0) {
      return respostaFalha(entrada, errosCenarios.join(" "));
    }

    const { resultado, erros } = calcularComparacaoCenarios(entrada, estrategia, casas);
    if (erros.length > 0) {
      return respostaFalha(entrada, erros.join(" "));
    }
    const comparacao = resultado as ComparacaoCenariosMargem;
    const nivelCompletude: NivelCompletude = comparacao.cenarios.some((c) => c.nivelCompletude !== "COMPLETO") ? "PARCIAL" : "COMPLETO";

    return {
      sucesso: true,
      modo: entrada.modo,
      descricao: entrada.descricao,
      comparacaoCenarios: comparacao,
      nivelCompletude,
      custosIncluidos: [],
      custosIgnorados: [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: comparacao.alertas,
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: comparacao.rankingPorLucro[0]
        ? `"${comparacao.rankingPorLucro[0].nome}" apresentou o maior lucro estimado (${formatarBRL(comparacao.rankingPorLucro[0].valor)}) entre os ${comparacao.cenarios.length} cenários comparados.`
        : "Não foi possível comparar os cenários com os dados informados.",
      memoriaCalculo: [],
    };
  }

  if (entrada.modo === "PREVISTO_X_REALIZADO") {
    const { resultado, erros, dadosFaltantes } = calcularPrevistoRealizado(entrada, estrategia, casas);
    if (erros.length > 0) return respostaFalha(entrada, erros.join(" "));
    if (dadosFaltantes.length > 0) {
      return respostaFalha(entrada, `Para comparar previsto e realizado, informe: ${dadosFaltantes.join(", ")}.`, dadosFaltantes);
    }
    const pr = resultado as PrevistoRealizadoMargem;

    return {
      sucesso: true,
      modo: entrada.modo,
      descricao: entrada.descricao,
      previstoRealizado: pr,
      nivelCompletude: "COMPLETO",
      custosIncluidos: [],
      custosIgnorados: [],
      limitacoes: LIMITACOES_PADRAO,
      alertas: pr.alertas,
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: `Lucro previsto: ${formatarBRL(pr.lucroPrevisto ?? 0)}. Lucro realizado: ${formatarBRL(pr.lucroRealizado ?? 0)}. Diferença: ${formatarBRL(
        pr.diferencaLucro ?? 0
      )}${pr.diferencaMargemPercentual !== undefined ? ` (margem variou ${formatarNumero(pr.diferencaMargemPercentual)} p.p.)` : ""}.`,
      memoriaCalculo: [],
    };
  }

  // Modos de variante única
  const errosVariante = validarVariante(entrada, "entrada");
  if (errosVariante.length > 0) {
    return respostaFalha(entrada, errosVariante.join(" "));
  }

  const ag = calcularNucleo(entrada, entrada.modo, estrategia, "entrada", casas);
  if (ag.errosValidacao.length > 0) {
    return respostaFalha(entrada, ag.errosValidacao.join(" "));
  }
  if (ag.dadosFaltantes.length > 0) {
    return respostaFalha(
      entrada,
      `Para calcular a margem, informe: ${ag.dadosFaltantes.join(", ")}.`,
      ag.dadosFaltantes
    );
  }

  const nivelCompletude = determinarCompletude(entrada.modo, ag);
  const classificacao = ag.margemLiquidaPercentual !== undefined ? classificarMargem(ag.margemLiquidaPercentual) : undefined;
  const impactoRetornoVazio = calcularImpactoRetornoVazio(entrada, casas);

  const alertas = [...ag.alertas];
  if (classificacao === "PREJUIZO") {
    alertas.push("A operação está classificada como prejuízo nos dados informados.");
  }
  if (impactoRetornoVazio) {
    alertas.push(
      `O retorno vazio reduziu o lucro em ${formatarBRL(impactoRetornoVazio.diferencaLucro ?? 0)}${
        impactoRetornoVazio.diferencaMargemPercentual !== undefined ? ` (${formatarNumero(impactoRetornoVazio.diferencaMargemPercentual)} p.p. de margem)` : ""
      } em relação a considerar apenas a ida.`
    );
  }

  const permitirEstimativas = entrada.permitirEstimativas ?? true;
  const bloquearConclusao = !permitirEstimativas && nivelCompletude === "PARCIAL";
  if (bloquearConclusao) {
    alertas.push('Conclusão financeira parcial: "permitirEstimativas" está desativado e há categorias relevantes não informadas (impostos, comissão ou custos indiretos).');
  }

  const mensagemResumo = bloquearConclusao
    ? "Não é possível apresentar uma conclusão financeira definitiva: dados incompletos e \"permitirEstimativas\" está desativado."
    : construirResumo(ag, nivelCompletude, classificacao);

  return {
    sucesso: true,
    modo: entrada.modo,
    descricao: entrada.descricao,
    receitaBrutaTotal: ag.receitaBrutaTotal,
    descontos: ag.descontos,
    devolucoes: ag.devolucoes,
    impostos: ag.impostos,
    comissoes: ag.comissoes,
    outrasDeducoes: ag.outrasDeducoes,
    receitaLiquida: ag.receitaLiquida,
    custosDiretos: ag.custosDiretos,
    custosVariaveis: ag.custosVariaveis,
    custosFixosRateados: ag.custosFixosRateados,
    custosIndiretos: ag.custosIndiretos,
    custoTotalFinal: ag.custoTotalFinal,
    lucroBruto: ag.lucroBruto,
    lucroOperacional: ag.lucroOperacional,
    lucroLiquidoEstimado: bloquearConclusao ? undefined : ag.lucroLiquidoEstimado,
    margemBrutaPercentual: ag.margemBrutaPercentual,
    margemOperacionalPercentual: ag.margemOperacionalPercentual,
    margemLiquidaPercentual: bloquearConclusao ? undefined : ag.margemLiquidaPercentual,
    markupPercentual: ag.markupPercentual,
    fatorMarkup: ag.fatorMarkup,
    receitaPorKm: ag.receitaPorKm,
    custoPorKm: ag.custoPorKm,
    lucroPorKm: ag.lucroPorKm,
    receitaPorTonelada: ag.receitaPorTonelada,
    custoPorTonelada: ag.custoPorTonelada,
    lucroPorTonelada: ag.lucroPorTonelada,
    lucroPorVeiculo: ag.lucroPorVeiculo,
    lucroPorViagem: ag.lucroPorViagem,
    receitaPontoEquilibrio: ag.receitaPontoEquilibrio,
    receitaParaMargemAlvo: ag.receitaParaMargemAlvo,
    receitaComMarkupAlvo: ag.receitaComMarkupAlvo,
    valorAdicionalParaEquilibrio: ag.valorAdicionalParaEquilibrio,
    valorAdicionalParaMargemAlvo: ag.valorAdicionalParaMargemAlvo,
    impactoRetornoVazio,
    classificacao: bloquearConclusao ? undefined : classificacao,
    nivelCompletude,
    custosIncluidos: ag.custosIncluidos,
    custosIgnorados: ag.custosIgnorados,
    limitacoes: LIMITACOES_PADRAO,
    alertas,
    premissas: ag.premissas,
    dadosFaltantes: [],
    mensagemResumo,
    memoriaCalculo: construirMemoriaCalculo("entrada", ag),
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
    descricao: "Tipo de cálculo de margem desejado.",
    valoresPossiveis: [
      "MARGEM_SIMPLES",
      "MARGEM_OPERACIONAL",
      "MARGEM_LIQUIDA_ESTIMADA",
      "MARGEM_POR_VIAGEM",
      "MARGEM_POR_KM",
      "MARGEM_POR_TONELADA",
      "COMPARACAO_CENARIOS",
      "PREVISTO_X_REALIZADO",
      "MARGEM_ALVO",
      "PONTO_EQUILIBRIO",
    ],
  },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre da operação." },
  { nome: "receitaBruta", tipo: "number", obrigatorio: true, descricao: "Receita bruta, em R$ (não exigida em MARGEM_ALVO/PONTO_EQUILIBRIO)." },
  { nome: "receitaAdicional", tipo: "number", obrigatorio: false, descricao: "Receita adicional a somar à receita bruta, em R$." },
  { nome: "descontos", tipo: "number", obrigatorio: false, descricao: "Descontos concedidos, em R$." },
  { nome: "devolucoes", tipo: "number", obrigatorio: false, descricao: "Devoluções, em R$." },
  { nome: "impostos", tipo: "number", obrigatorio: false, descricao: "Impostos, em R$ (alternativa a aliquotaImpostosPercentual)." },
  { nome: "aliquotaImpostosPercentual", tipo: "number", obrigatorio: false, descricao: "Alíquota de impostos sobre a receita bruta, em % (alternativa a impostos)." },
  { nome: "comissoes", tipo: "number", obrigatorio: false, descricao: "Comissões, em R$ (alternativa a aliquotaComissaoPercentual)." },
  { nome: "aliquotaComissaoPercentual", tipo: "number", obrigatorio: false, descricao: "Alíquota de comissão sobre a receita bruta, em % (alternativa a comissoes)." },
  { nome: "outrasDeducoes", tipo: "number", obrigatorio: false, descricao: "Outras deduções sobre a receita, em R$." },
  { nome: "custoTotal", tipo: "number", obrigatorio: false, descricao: "Custo total já calculado, em R$ (uma das 3 fontes de custo — nunca junto com as outras)." },
  { nome: "custosVariaveis", tipo: "number", obrigatorio: false, descricao: "Custos variáveis, em R$ (fonte \"categorias detalhadas\")." },
  { nome: "custosFixosRateados", tipo: "number", obrigatorio: false, descricao: "Custos fixos já rateados, em R$." },
  { nome: "custosDiretos", tipo: "number", obrigatorio: false, descricao: "Custos diretos, em R$." },
  { nome: "custosIndiretos", tipo: "number", obrigatorio: false, descricao: "Custos indiretos/administrativos, em R$." },
  { nome: "custoViagem", tipo: "number", obrigatorio: false, descricao: "Custo da ida, em R$ (usado também no impacto do retorno vazio)." },
  { nome: "custoRetorno", tipo: "number", obrigatorio: false, descricao: "Custo do retorno, em R$ (usado também no impacto do retorno vazio)." },
  { nome: "custoAdministrativo", tipo: "number", obrigatorio: false, descricao: "Custo administrativo, em R$." },
  { nome: "outrosCustos", tipo: "number", obrigatorio: false, descricao: "Outros custos, em R$." },
  { nome: "resumoCustoViagem", tipo: "string", obrigatorio: false, descricao: "Resultado (ou resumo) de calcular_custo_viagem — terceira fonte de custo, nunca junto com as outras." },
  { nome: "receitaIda", tipo: "number", obrigatorio: false, descricao: "Receita da ida, em R$ (impacto do retorno vazio)." },
  { nome: "receitaRetorno", tipo: "number", obrigatorio: false, descricao: "Receita do retorno, em R$ (0 quando vazio)." },
  { nome: "quilometragemTotal", tipo: "number", obrigatorio: false, descricao: "Quilometragem total, para os cálculos por km (obrigatório em MARGEM_POR_KM)." },
  { nome: "pesoCargaToneladas", tipo: "number", obrigatorio: false, descricao: "Peso da carga, em toneladas (obrigatório em MARGEM_POR_TONELADA)." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos, para o lucro por veículo." },
  { nome: "quantidadeViagens", tipo: "number", obrigatorio: false, descricao: "Quantidade de viagens, para o lucro por viagem." },
  { nome: "margemAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "Margem desejada, em % (obrigatório em MARGEM_ALVO)." },
  { nome: "markupAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "Markup desejado, em %." },
  { nome: "cenarios", tipo: "string", obrigatorio: false, descricao: "Lista com ao menos 2 cenários (mesmos campos desta entrada) — obrigatório em COMPARACAO_CENARIOS." },
  { nome: "previsto", tipo: "string", obrigatorio: false, descricao: "Bloco completo de dados previstos — obrigatório em PREVISTO_X_REALIZADO." },
  { nome: "realizado", tipo: "string", obrigatorio: false, descricao: "Bloco completo de dados realizados — obrigatório em PREVISTO_X_REALIZADO." },
  {
    nome: "estrategiaSobreposicao",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Como resolver quando custo (ou impostos/comissão) é informado de mais de uma forma. Padrão: REJEITAR_SOBREPOSICAO.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"],
  },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve as casas decimais padrão (moeda 2, margem/markup 2, custo por km 4, tonelada 2)." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Quando false, suprime lucro/margem se dados relevantes estiverem ausentes (nível PARCIAL). Padrão: true." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaCalcularMargem: DefinicaoFerramenta<CalcularMargemEntrada, CalcularMargemResultado> = {
  nome: "calcular_margem",
  descricao:
    "Calcula receita líquida, lucro, margem e markup de uma viagem, frete, operação, veículo, contrato ou período — inclusive ponto de equilíbrio, receita necessária para uma margem-alvo, impacto do retorno vazio e comparação previsto x realizado ou entre cenários. Use apenas quando o usuário pedir um cálculo financeiro concreto com números; não use para perguntas gerais sobre lucratividade sem dados para calcular.",
  objetivo:
    "Mostrar de forma clara e nunca enganosa se uma operação é lucrativa e em que proporção, diferenciando sempre receita, lucro, margem e markup, e nunca apresentando um resultado parcial como definitivo.",
  parametros: PARAMETROS,
  executar: calcularMargem,
};
