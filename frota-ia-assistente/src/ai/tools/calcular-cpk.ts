import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";

/**
 * Ferramenta: calcular_cpk
 *
 * Calcula o Custo Por Quilômetro (CPK) de um veículo ou operação de
 * transporte, por categoria de custo ou no total, e permite comparar o CPK
 * de dois veículos/operações (ex.: pneu novo x recapado). Ferramenta
 * central: pensada para ser reutilizada por outras ferramentas (análise de
 * frete, comparação de pneus, custo de viagem, margem, valor mínimo de
 * frete, relatórios e dashboards).
 *
 * Sem APIs externas nesta fase — usa apenas os custos informados pelo
 * usuário. Nunca estima um custo que não foi informado: campos ausentes
 * simplesmente ficam de fora do cálculo e são listados em
 * `custosIgnorados`, nunca tratados como zero silenciosamente.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

/**
 * Faixas de referência (R$/km) usadas para classificar o CPK por categoria.
 * São valores iniciais e configuráveis, pensados para caminhões de carga —
 * NÃO representam um benchmark oficial do setor. Ajuste conforme o tipo de
 * veículo e o perfil da operação.
 */
export const LIMITES_CLASSIFICACAO_CPK: Record<
  CategoriaCpk,
  { excelenteAte: number; bomAte: number; atencaoAte: number }
> = {
  PNEUS: { excelenteAte: 0.1, bomAte: 0.18, atencaoAte: 0.28 },
  COMBUSTIVEL: { excelenteAte: 1.6, bomAte: 2.0, atencaoAte: 2.5 },
  MANUTENCAO: { excelenteAte: 0.2, bomAte: 0.35, atencaoAte: 0.55 },
  OPERACIONAL: { excelenteAte: 0.6, bomAte: 1.0, atencaoAte: 1.5 },
  TOTAL: { excelenteAte: 2.5, bomAte: 3.5, atencaoAte: 4.8 },
};

const PREMISSA_APENAS_INFORMADOS =
  "O CPK apresentado considera apenas os custos informados; custos não informados não fazem parte do valor calculado e não devem ser lidos como custo real absoluto.";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ModoCalculoCpk =
  | "CPK_PNEUS"
  | "CPK_COMBUSTIVEL"
  | "CPK_MANUTENCAO"
  | "CPK_OPERACIONAL"
  | "CPK_TOTAL"
  | "COMPARACAO_CPK";

/** Categorias "simples": cada uma soma um subconjunto fixo de campos de custo. */
export type CategoriaCpkSimples = "PNEUS" | "COMBUSTIVEL" | "MANUTENCAO" | "OPERACIONAL";

/** `TOTAL` soma as quatro categorias simples. */
export type CategoriaCpk = CategoriaCpkSimples | "TOTAL";

const ROTULO_CATEGORIA: Record<CategoriaCpk, string> = {
  PNEUS: "pneus",
  COMBUSTIVEL: "combustível",
  MANUTENCAO: "manutenção",
  OPERACIONAL: "custos operacionais",
  TOTAL: "custo total",
};

/** Todos os campos de custo aceitos, em R$, referentes ao mesmo período/trecho de `quilometragem`. */
export interface CustosCpk {
  custoPneus?: number;
  custoRecapagem?: number;
  custoCombustivel?: number;
  custoManutencaoPreventiva?: number;
  custoManutencaoCorretiva?: number;
  custoPecas?: number;
  custoMaoDeObra?: number;
  custoPedagios?: number;
  custoLubrificantes?: number;
  custoArla?: number;
  custoSeguros?: number;
  custoLicenciamento?: number;
  custoFinanciamento?: number;
  custoDepreciacao?: number;
  custoSalarios?: number;
  custoEncargos?: number;
  custoAdministracao?: number;
  custoRastreador?: number;
  custoOperacionalAdicional?: number;
  /** Qualquer custo não coberto pelos campos acima; use `descricaoCustoPersonalizado` para rotulá-lo. */
  custoPersonalizado?: number;
}

/** Um veículo/operação a ser comparado no modo COMPARACAO_CPK. */
export interface OperacaoCpkComparacao extends CustosCpk {
  descricao?: string;
  quilometragem?: number;
  descricaoCustoPersonalizado?: string;
  quantidadePneus?: number;
  vidaUtilPneusKm?: number;
  valorResidual?: number;
}

export interface CalcularCpkEntrada extends CustosCpk {
  modo: ModoCalculoCpk;

  quilometragem?: number;
  descricaoCustoPersonalizado?: string;

  /**
   * Aceitos para uso futuro por outras ferramentas (ex.: comparar-pneus) e
   * para relatórios. Não alteram a fórmula de CPK_PNEUS nesta versão, que é
   * (custoPneus + custoRecapagem) ÷ quilometragem.
   */
  quantidadePneus?: number;
  vidaUtilPneusKm?: number;
  valorResidual?: number;

  periodoAnalisado?: string;
  descricao?: string;

  /** Usado apenas em COMPARACAO_CPK. Padrão: "TOTAL". */
  categoriaComparacao?: CategoriaCpk;
  operacaoA?: OperacaoCpkComparacao;
  operacaoB?: OperacaoCpkComparacao;

  arredondamentoCasasDecimais?: number;
}

export type ClassificacaoCpk = "EXCELENTE" | "BOM" | "ATENCAO" | "CRITICO";

export interface CpkPorCategoria {
  pneus?: number;
  combustivel?: number;
  manutencao?: number;
  operacional?: number;
}

export interface ResultadosCpk {
  quilometragem?: number;
  cpk?: number;
  cpkPorCategoria?: CpkPorCategoria;
  custoTotalConsiderado?: number;
  // Comparação
  cpkOperacaoA?: number;
  cpkOperacaoB?: number;
  operacaoMaisEconomica?: string;
  diferencaReaisPorKm?: number;
  diferencaPercentual?: number;
  economiaEstimada?: number;
}

export interface CalcularCpkResultado extends ResultadoFerramentaBase {
  modo: ModoCalculoCpk;
  dadosEntrada: CalcularCpkEntrada;
  /** Rótulos dos custos que entraram no cálculo — nunca ficam ocultos. */
  custosConsiderados: string[];
  /** Rótulos dos custos que existem no modelo mas não foram informados (por isso, de fora do cálculo). */
  custosIgnorados: string[];
  resultados: ResultadosCpk;
  classificacao?: ClassificacaoCpk | "DADOS_INSUFICIENTES";
}

// ---------------------------------------------------------------------------
// Mapa de campos de custo -> categoria
// ---------------------------------------------------------------------------

interface CampoCustoCpk {
  campo: keyof CustosCpk;
  rotulo: string;
  categoria: CategoriaCpkSimples;
}

const CAMPOS_CUSTO: CampoCustoCpk[] = [
  { campo: "custoPneus", rotulo: "Pneus", categoria: "PNEUS" },
  { campo: "custoRecapagem", rotulo: "Recapagem", categoria: "PNEUS" },
  { campo: "custoCombustivel", rotulo: "Combustível", categoria: "COMBUSTIVEL" },
  { campo: "custoManutencaoPreventiva", rotulo: "Manutenção preventiva", categoria: "MANUTENCAO" },
  { campo: "custoManutencaoCorretiva", rotulo: "Manutenção corretiva", categoria: "MANUTENCAO" },
  { campo: "custoPecas", rotulo: "Peças", categoria: "MANUTENCAO" },
  { campo: "custoMaoDeObra", rotulo: "Mão de obra", categoria: "MANUTENCAO" },
  { campo: "custoPedagios", rotulo: "Pedágios", categoria: "OPERACIONAL" },
  { campo: "custoLubrificantes", rotulo: "Lubrificantes", categoria: "OPERACIONAL" },
  { campo: "custoArla", rotulo: "Arla", categoria: "OPERACIONAL" },
  { campo: "custoSeguros", rotulo: "Seguros", categoria: "OPERACIONAL" },
  { campo: "custoLicenciamento", rotulo: "Licenciamento", categoria: "OPERACIONAL" },
  { campo: "custoFinanciamento", rotulo: "Financiamento", categoria: "OPERACIONAL" },
  { campo: "custoDepreciacao", rotulo: "Depreciação", categoria: "OPERACIONAL" },
  { campo: "custoSalarios", rotulo: "Salários", categoria: "OPERACIONAL" },
  { campo: "custoEncargos", rotulo: "Encargos", categoria: "OPERACIONAL" },
  { campo: "custoAdministracao", rotulo: "Administração", categoria: "OPERACIONAL" },
  { campo: "custoRastreador", rotulo: "Rastreador", categoria: "OPERACIONAL" },
  { campo: "custoOperacionalAdicional", rotulo: "Custo operacional adicional", categoria: "OPERACIONAL" },
  { campo: "custoPersonalizado", rotulo: "Custo personalizado", categoria: "OPERACIONAL" },
];

const CATEGORIAS_SIMPLES: CategoriaCpkSimples[] = ["PNEUS", "COMBUSTIVEL", "MANUTENCAO", "OPERACIONAL"];

const MENSAGENS_DADOS_FALTANTES: Record<CategoriaCpkSimples, string> = {
  PNEUS: "Para calcular o CPK de pneus, informe a quilometragem e ao menos um custo de pneus (custoPneus e/ou custoRecapagem).",
  COMBUSTIVEL: "Para calcular o CPK de combustível, informe a quilometragem e o custo de combustível.",
  MANUTENCAO:
    "Para calcular o CPK de manutenção, informe a quilometragem e ao menos um custo de manutenção (preventiva, corretiva, peças ou mão de obra).",
  OPERACIONAL: "Para calcular o CPK operacional, informe a quilometragem e ao menos um dos custos operacionais.",
};

// ---------------------------------------------------------------------------
// Soma por categoria
// ---------------------------------------------------------------------------

type CustosComDescricao = CustosCpk & { descricaoCustoPersonalizado?: string };

function somarCategoria(
  entrada: CustosComDescricao,
  categoria: CategoriaCpkSimples
): { soma: number; considerados: string[]; ignorados: string[] } {
  let soma = 0;
  const considerados: string[] = [];
  const ignorados: string[] = [];

  for (const item of CAMPOS_CUSTO) {
    if (item.categoria !== categoria) continue;
    const valor = entrada[item.campo];
    const rotulo =
      item.campo === "custoPersonalizado" && entrada.descricaoCustoPersonalizado
        ? `Custo personalizado (${entrada.descricaoCustoPersonalizado})`
        : item.rotulo;
    if (valor !== undefined) {
      soma += valor;
      considerados.push(rotulo);
    } else {
      ignorados.push(rotulo);
    }
  }

  return { soma, considerados, ignorados };
}

function classificarCpk(cpk: number, categoria: CategoriaCpk): ClassificacaoCpk {
  const limites = LIMITES_CLASSIFICACAO_CPK[categoria];
  if (cpk <= limites.excelenteAte) return "EXCELENTE";
  if (cpk <= limites.bomAte) return "BOM";
  if (cpk <= limites.atencaoAte) return "ATENCAO";
  return "CRITICO";
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function validarBlocoCustos(rotulo: string, bloco: CustosComDescricao & { quilometragem?: number; quantidadePneus?: number; vidaUtilPneusKm?: number; valorResidual?: number }): string[] {
  const erros: string[] = [];
  const camposNumericos: Array<[string, number | undefined]> = [
    ...CAMPOS_CUSTO.map((c) => [c.campo, bloco[c.campo]] as [string, number | undefined]),
    ["quilometragem", bloco.quilometragem],
    ["quantidadePneus", bloco.quantidadePneus],
    ["vidaUtilPneusKm", bloco.vidaUtilPneusKm],
    ["valorResidual", bloco.valorResidual],
  ];
  for (const [campo, valor] of camposNumericos) {
    if (valor !== undefined && valor < 0) {
      erros.push(`O campo "${rotulo}${campo}" não pode ser negativo.`);
    }
  }
  return erros;
}

function validarValoresBasicos(entrada: CalcularCpkEntrada): string[] {
  const erros = validarBlocoCustos("", entrada);
  if (entrada.operacaoA) erros.push(...validarBlocoCustos("operacaoA.", entrada.operacaoA));
  if (entrada.operacaoB) erros.push(...validarBlocoCustos("operacaoB.", entrada.operacaoB));
  return erros;
}

// ---------------------------------------------------------------------------
// Fábricas de resultado
// ---------------------------------------------------------------------------

function resultadoDadosFaltantes(
  modo: ModoCalculoCpk,
  entrada: CalcularCpkEntrada,
  dadosFaltantes: string[],
  mensagemResumo: string
): CalcularCpkResultado {
  return {
    sucesso: false,
    modo,
    dadosEntrada: entrada,
    custosConsiderados: [],
    custosIgnorados: [],
    resultados: {},
    classificacao: "DADOS_INSUFICIENTES",
    alertas: [],
    premissas: [],
    dadosFaltantes,
    mensagemResumo,
  };
}

function resultadoInvalido(modo: ModoCalculoCpk, entrada: CalcularCpkEntrada, erros: string[]): CalcularCpkResultado {
  return {
    sucesso: false,
    modo,
    dadosEntrada: entrada,
    custosConsiderados: [],
    custosIgnorados: [],
    resultados: {},
    alertas: [],
    premissas: [],
    dadosFaltantes: [],
    mensagemResumo: erros.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Modos CPK_PNEUS / CPK_COMBUSTIVEL / CPK_MANUTENCAO / CPK_OPERACIONAL
// ---------------------------------------------------------------------------

function calcularCpkCategoriaUnica(
  entrada: CalcularCpkEntrada,
  categoria: CategoriaCpkSimples,
  casas: number
): CalcularCpkResultado {
  const dadosFaltantes: string[] = [];
  if (entrada.quilometragem === undefined) dadosFaltantes.push("quilometragem");

  const { soma, considerados, ignorados } = somarCategoria(entrada, categoria);
  if (considerados.length === 0) {
    dadosFaltantes.push(`ao menos um custo de ${ROTULO_CATEGORIA[categoria]}`);
  }

  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(entrada.modo, entrada, dadosFaltantes, MENSAGENS_DADOS_FALTANTES[categoria]);
  }

  if (entrada.quilometragem === 0) {
    return resultadoInvalido(entrada.modo, entrada, ["A quilometragem não pode ser igual a zero."]);
  }

  const km = entrada.quilometragem as number;
  const cpk = soma / km;
  const classificacao = classificarCpk(cpk, categoria);

  const premissas = [PREMISSA_APENAS_INFORMADOS];
  if (ignorados.length > 0) {
    premissas.push(`Custos de ${ROTULO_CATEGORIA[categoria]} não informados e por isso não incluídos: ${ignorados.join(", ")}.`);
  }
  if (entrada.periodoAnalisado) premissas.push(`Período analisado: ${entrada.periodoAnalisado}.`);

  const alertas: string[] = [];
  if (classificacao === "CRITICO") alertas.push(`O CPK de ${ROTULO_CATEGORIA[categoria]} está classificado como crítico.`);
  else if (classificacao === "ATENCAO") alertas.push(`O CPK de ${ROTULO_CATEGORIA[categoria]} requer atenção.`);
  if (ignorados.length > 0) {
    alertas.push(`Este CPK não representa o custo completo de ${ROTULO_CATEGORIA[categoria]}, pois parte dos custos não foi informada.`);
  }

  return {
    sucesso: true,
    modo: entrada.modo,
    dadosEntrada: entrada,
    custosConsiderados: considerados,
    custosIgnorados: ignorados,
    resultados: {
      quilometragem: arredondar(km, casas),
      cpk: arredondar(cpk, casas),
      custoTotalConsiderado: arredondar(soma, casas),
    },
    classificacao,
    alertas,
    premissas,
    dadosFaltantes: [],
    mensagemResumo: `CPK de ${ROTULO_CATEGORIA[categoria]}: ${formatarBRL(arredondar(cpk, casas))}/km (${formatarBRL(
      arredondar(soma, casas)
    )} em ${formatarNumero(arredondar(km, casas))} km).`,
  };
}

// ---------------------------------------------------------------------------
// Modo CPK_TOTAL
// ---------------------------------------------------------------------------

function calcularCpkTotal(entrada: CalcularCpkEntrada, casas: number): CalcularCpkResultado {
  const dadosFaltantes: string[] = [];
  if (entrada.quilometragem === undefined) dadosFaltantes.push("quilometragem");

  const somasPorCategoria = new Map<CategoriaCpkSimples, ReturnType<typeof somarCategoria>>();
  let custoTotal = 0;
  let considerados: string[] = [];
  let ignorados: string[] = [];

  for (const categoria of CATEGORIAS_SIMPLES) {
    const r = somarCategoria(entrada, categoria);
    somasPorCategoria.set(categoria, r);
    custoTotal += r.soma;
    considerados = considerados.concat(r.considerados);
    ignorados = ignorados.concat(r.ignorados);
  }

  if (considerados.length === 0) {
    dadosFaltantes.push("ao menos um custo (pneus, combustível, manutenção ou operacional)");
  }

  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(
      "CPK_TOTAL",
      entrada,
      dadosFaltantes,
      "Para calcular o CPK total, informe a quilometragem e ao menos um custo."
    );
  }

  if (entrada.quilometragem === 0) {
    return resultadoInvalido("CPK_TOTAL", entrada, ["A quilometragem não pode ser igual a zero."]);
  }

  const km = entrada.quilometragem as number;
  const cpkPorCategoria: CpkPorCategoria = {};
  const chavePorCategoria: Record<CategoriaCpkSimples, keyof CpkPorCategoria> = {
    PNEUS: "pneus",
    COMBUSTIVEL: "combustivel",
    MANUTENCAO: "manutencao",
    OPERACIONAL: "operacional",
  };
  for (const categoria of CATEGORIAS_SIMPLES) {
    const r = somasPorCategoria.get(categoria)!;
    if (r.considerados.length > 0) {
      cpkPorCategoria[chavePorCategoria[categoria]] = arredondar(r.soma / km, casas);
    }
  }

  const cpk = custoTotal / km;
  const classificacao = classificarCpk(cpk, "TOTAL");

  const premissas = [PREMISSA_APENAS_INFORMADOS];
  if (ignorados.length > 0) {
    premissas.push(`Custos não informados e por isso não incluídos no total: ${ignorados.join(", ")}.`);
  }
  if (entrada.periodoAnalisado) premissas.push(`Período analisado: ${entrada.periodoAnalisado}.`);

  const alertas: string[] = [];
  if (classificacao === "CRITICO") alertas.push("O CPK total está classificado como crítico.");
  else if (classificacao === "ATENCAO") alertas.push("O CPK total requer atenção.");
  if (ignorados.length > 0) {
    alertas.push("O CPK calculado não representa o custo real completo, pois parte dos custos não foi informada.");
  }

  return {
    sucesso: true,
    modo: "CPK_TOTAL",
    dadosEntrada: entrada,
    custosConsiderados: considerados,
    custosIgnorados: ignorados,
    resultados: {
      quilometragem: arredondar(km, casas),
      cpk: arredondar(cpk, casas),
      cpkPorCategoria,
      custoTotalConsiderado: arredondar(custoTotal, casas),
    },
    classificacao,
    alertas,
    premissas,
    dadosFaltantes: [],
    mensagemResumo: `CPK total: ${formatarBRL(arredondar(cpk, casas))}/km (${formatarBRL(arredondar(custoTotal, casas))} em ${formatarNumero(
      arredondar(km, casas)
    )} km).`,
  };
}

// ---------------------------------------------------------------------------
// Modo COMPARACAO_CPK
// ---------------------------------------------------------------------------

interface ResultadoOperandoCpk {
  cpk: number;
  considerados: string[];
  ignorados: string[];
  dadosFaltantes: string[];
}

function calcularCpkOperando(rotulo: string, operando: OperacaoCpkComparacao, categoria: CategoriaCpk): ResultadoOperandoCpk {
  const dadosFaltantes: string[] = [];
  if (operando.quilometragem === undefined) dadosFaltantes.push(`${rotulo}: quilometragem`);

  const categorias = categoria === "TOTAL" ? CATEGORIAS_SIMPLES : [categoria];
  let custoTotal = 0;
  let considerados: string[] = [];
  let ignorados: string[] = [];
  for (const cat of categorias) {
    const r = somarCategoria(operando, cat);
    custoTotal += r.soma;
    considerados = considerados.concat(r.considerados.map((c) => `${rotulo}: ${c}`));
    ignorados = ignorados.concat(r.ignorados.map((c) => `${rotulo}: ${c}`));
  }

  if (considerados.length === 0) {
    dadosFaltantes.push(`${rotulo}: ao menos um custo de ${ROTULO_CATEGORIA[categoria]}`);
  }

  const cpk = operando.quilometragem ? custoTotal / operando.quilometragem : 0;

  return { cpk, considerados, ignorados, dadosFaltantes };
}

function calcularComparacaoCpk(entrada: CalcularCpkEntrada, casas: number): CalcularCpkResultado {
  const categoria = entrada.categoriaComparacao ?? "TOTAL";
  const dadosFaltantes: string[] = [];

  if (!entrada.operacaoA) dadosFaltantes.push("operacaoA");
  if (!entrada.operacaoB) dadosFaltantes.push("operacaoB");
  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(
      "COMPARACAO_CPK",
      entrada,
      dadosFaltantes,
      "Para comparar, informe operacaoA e operacaoB, cada uma com quilometragem e os custos relevantes."
    );
  }

  const opA = entrada.operacaoA as OperacaoCpkComparacao;
  const opB = entrada.operacaoB as OperacaoCpkComparacao;
  const nomeA = opA.descricao ?? "Operação A";
  const nomeB = opB.descricao ?? "Operação B";

  const resultadoA = calcularCpkOperando(nomeA, opA, categoria);
  const resultadoB = calcularCpkOperando(nomeB, opB, categoria);

  const faltantes = [...resultadoA.dadosFaltantes, ...resultadoB.dadosFaltantes];
  if (faltantes.length > 0) {
    return resultadoDadosFaltantes(
      "COMPARACAO_CPK",
      entrada,
      faltantes,
      "Para comparar, cada operação precisa de quilometragem e ao menos um custo da categoria escolhida."
    );
  }

  if (opA.quilometragem === 0 || opB.quilometragem === 0) {
    return resultadoInvalido("COMPARACAO_CPK", entrada, ["A quilometragem de uma operação não pode ser igual a zero."]);
  }

  const cpkA = resultadoA.cpk;
  const cpkB = resultadoB.cpk;
  const ladoMenorCpk: "A" | "B" = cpkA <= cpkB ? "A" : "B";
  const operacaoMaisEconomica = ladoMenorCpk === "A" ? nomeA : nomeB;
  const maiorCpk = Math.max(cpkA, cpkB);
  const menorCpk = Math.min(cpkA, cpkB);
  const diferencaReaisPorKm = maiorCpk - menorCpk;
  const diferencaPercentual = maiorCpk > 0 ? (diferencaReaisPorKm / maiorCpk) * 100 : 0;
  const kmDoLadoMaisCaro = ladoMenorCpk === "A" ? (opB.quilometragem as number) : (opA.quilometragem as number);
  const economiaEstimada = diferencaReaisPorKm * kmDoLadoMaisCaro;

  const considerados = [...resultadoA.considerados, ...resultadoB.considerados];
  const ignorados = [...resultadoA.ignorados, ...resultadoB.ignorados];

  const premissas = [
    PREMISSA_APENAS_INFORMADOS,
    `A comparação usou a categoria "${ROTULO_CATEGORIA[categoria]}".`,
    `A economia estimada aplica a diferença de CPK à quilometragem do lado mais caro (${ladoMenorCpk === "A" ? nomeB : nomeA}).`,
  ];
  if (ignorados.length > 0) premissas.push(`Custos não informados e por isso não incluídos: ${ignorados.join(", ")}.`);

  const classificacao = classificarCpk(ladoMenorCpk === "A" ? cpkA : cpkB, categoria);

  return {
    sucesso: true,
    modo: "COMPARACAO_CPK",
    dadosEntrada: entrada,
    custosConsiderados: considerados,
    custosIgnorados: ignorados,
    resultados: {
      cpkOperacaoA: arredondar(cpkA, casas),
      cpkOperacaoB: arredondar(cpkB, casas),
      operacaoMaisEconomica,
      diferencaReaisPorKm: arredondar(diferencaReaisPorKm, casas),
      diferencaPercentual: arredondar(diferencaPercentual, casas),
      economiaEstimada: arredondar(economiaEstimada, casas),
    },
    classificacao,
    alertas: [],
    premissas,
    dadosFaltantes: [],
    mensagemResumo: `${operacaoMaisEconomica} tem o menor CPK: ${formatarBRL(arredondar(menorCpk, casas))}/km contra ${formatarBRL(
      arredondar(maiorCpk, casas)
    )}/km (diferença de ${formatarNumero(arredondar(diferencaPercentual, casas))}%, economia estimada de ${formatarBRL(
      arredondar(economiaEstimada, casas)
    )}).`,
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

export function calcularCpk(entrada: CalcularCpkEntrada): CalcularCpkResultado {
  const casas = entrada.arredondamentoCasasDecimais ?? CASAS_DECIMAIS_PADRAO;

  const errosBasicos = validarValoresBasicos(entrada);
  if (errosBasicos.length > 0) {
    return resultadoInvalido(entrada.modo, entrada, errosBasicos);
  }

  switch (entrada.modo) {
    case "CPK_PNEUS":
      return calcularCpkCategoriaUnica(entrada, "PNEUS", casas);
    case "CPK_COMBUSTIVEL":
      return calcularCpkCategoriaUnica(entrada, "COMBUSTIVEL", casas);
    case "CPK_MANUTENCAO":
      return calcularCpkCategoriaUnica(entrada, "MANUTENCAO", casas);
    case "CPK_OPERACIONAL":
      return calcularCpkCategoriaUnica(entrada, "OPERACIONAL", casas);
    case "CPK_TOTAL":
      return calcularCpkTotal(entrada, casas);
    case "COMPARACAO_CPK":
      return calcularComparacaoCpk(entrada, casas);
    default:
      return resultadoInvalido(entrada.modo, entrada, [`Modo de cálculo desconhecido: "${entrada.modo}".`]);
  }
}

// ---------------------------------------------------------------------------
// Registro da ferramenta
// ---------------------------------------------------------------------------

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "Tipo de cálculo de CPK desejado.",
    valoresPossiveis: ["CPK_PNEUS", "CPK_COMBUSTIVEL", "CPK_MANUTENCAO", "CPK_OPERACIONAL", "CPK_TOTAL", "COMPARACAO_CPK"],
  },
  { nome: "quilometragem", tipo: "number", obrigatorio: false, descricao: "Quilometragem do período/trecho analisado (não usado em COMPARACAO_CPK)." },
  { nome: "custoPneus", tipo: "number", obrigatorio: false, descricao: "Custo com pneus novos, em R$." },
  { nome: "custoRecapagem", tipo: "number", obrigatorio: false, descricao: "Custo com recapagem de pneus, em R$." },
  { nome: "custoCombustivel", tipo: "number", obrigatorio: false, descricao: "Custo com combustível, em R$." },
  { nome: "custoManutencaoPreventiva", tipo: "number", obrigatorio: false, descricao: "Custo com manutenção preventiva, em R$." },
  { nome: "custoManutencaoCorretiva", tipo: "number", obrigatorio: false, descricao: "Custo com manutenção corretiva, em R$." },
  { nome: "custoPecas", tipo: "number", obrigatorio: false, descricao: "Custo com peças, em R$." },
  { nome: "custoMaoDeObra", tipo: "number", obrigatorio: false, descricao: "Custo com mão de obra, em R$." },
  { nome: "custoPedagios", tipo: "number", obrigatorio: false, descricao: "Custo com pedágios, em R$." },
  { nome: "custoLubrificantes", tipo: "number", obrigatorio: false, descricao: "Custo com lubrificantes, em R$." },
  { nome: "custoArla", tipo: "number", obrigatorio: false, descricao: "Custo com Arla 32, em R$." },
  { nome: "custoSeguros", tipo: "number", obrigatorio: false, descricao: "Custo com seguros, em R$." },
  { nome: "custoLicenciamento", tipo: "number", obrigatorio: false, descricao: "Custo com licenciamento, em R$." },
  { nome: "custoFinanciamento", tipo: "number", obrigatorio: false, descricao: "Custo com financiamento/parcela, em R$." },
  { nome: "custoDepreciacao", tipo: "number", obrigatorio: false, descricao: "Custo com depreciação, em R$." },
  { nome: "custoSalarios", tipo: "number", obrigatorio: false, descricao: "Custo com salários, em R$." },
  { nome: "custoEncargos", tipo: "number", obrigatorio: false, descricao: "Custo com encargos trabalhistas, em R$." },
  { nome: "custoAdministracao", tipo: "number", obrigatorio: false, descricao: "Custo administrativo, em R$." },
  { nome: "custoRastreador", tipo: "number", obrigatorio: false, descricao: "Custo com rastreamento/telemetria, em R$." },
  { nome: "custoOperacionalAdicional", tipo: "number", obrigatorio: false, descricao: "Outro custo operacional não listado, em R$." },
  { nome: "custoPersonalizado", tipo: "number", obrigatorio: false, descricao: "Custo personalizado, em R$ (use com descricaoCustoPersonalizado)." },
  { nome: "descricaoCustoPersonalizado", tipo: "string", obrigatorio: false, descricao: "Rótulo do custoPersonalizado." },
  { nome: "quantidadePneus", tipo: "number", obrigatorio: false, descricao: "Quantidade de pneus do veículo (uso futuro)." },
  { nome: "vidaUtilPneusKm", tipo: "number", obrigatorio: false, descricao: "Vida útil estimada dos pneus, em km (uso futuro)." },
  { nome: "valorResidual", tipo: "number", obrigatorio: false, descricao: "Valor residual estimado do veículo/pneu, em R$ (uso futuro)." },
  { nome: "periodoAnalisado", tipo: "string", obrigatorio: false, descricao: "Rótulo do período analisado (ex.: \"Janeiro/2026\")." },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre do veículo/operação analisada." },
  { nome: "categoriaComparacao", tipo: "enum", obrigatorio: false, descricao: "Categoria usada em COMPARACAO_CPK (padrão: TOTAL).", valoresPossiveis: ["PNEUS", "COMBUSTIVEL", "MANUTENCAO", "OPERACIONAL", "TOTAL"] },
  { nome: "operacaoA", tipo: "string", obrigatorio: false, descricao: "Primeiro veículo/operação para COMPARACAO_CPK (mesmos campos de custo + quilometragem + descricao)." },
  { nome: "operacaoB", tipo: "string", obrigatorio: false, descricao: "Segundo veículo/operação para COMPARACAO_CPK." },
  { nome: "arredondamentoCasasDecimais", tipo: "number", obrigatorio: false, descricao: `Casas decimais na saída (padrão: ${CASAS_DECIMAIS_PADRAO}).` },
];

export const ferramentaCalcularCpk: DefinicaoFerramenta<CalcularCpkEntrada, CalcularCpkResultado> = {
  nome: "calcular_cpk",
  descricao:
    "Calcula o Custo Por Quilômetro (CPK) de um veículo/operação por categoria (pneus, combustível, manutenção, operacional) ou total, e compara o CPK entre dois veículos/operações.",
  objetivo:
    "Fornecer o indicador de custo por km — base para precificação, análise de frete, comparação de pneus e decisões de redução de custo — sem que o modelo de linguagem precise calcular sozinho.",
  parametros: PARAMETROS,
  executar: calcularCpk,
};
