import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { arredondar, formatarBRL, formatarNumero } from "./utils";
import { calcularCpk } from "./calcular-cpk";

/**
 * Ferramenta: comparar_pneus
 *
 * Compara duas ou mais opções de pneu (novo nacional/importado, recapado,
 * remoldado, marcas/modelos diferentes, cenário previsto x realizado) pelo
 * custo total do ciclo e pelo CPK — nunca apenas pelo preço de compra.
 *
 * Reutiliza `calcularCpk` (calcular-cpk.ts, modo `CPK_PNEUS`) para a divisão
 * custo ÷ quilometragem em si: esta ferramenta é responsável por agregar os
 * custos do ciclo de vida do pneu (aquisição, recapagens, custos
 * adicionais, valor residual) — algo que `calcular-cpk.ts` não modela (ele
 * soma custos de categoria fixa, sem dedução de valor residual) — e então
 * delega o cálculo final de CPK para a ferramenta já testada, em vez de
 * reimplementar a divisão/arredondamento/validação de quilometragem zero.
 * Nenhuma alteração foi necessária em `calcular-cpk.ts` para isso.
 *
 * Sem APIs externas nesta fase — usa apenas os dados informados na entrada.
 * Nunca estima preço, quilometragem, número de recapagens, vida útil ou
 * compatibilidade técnica.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

/** Casas decimais padrão por tipo de grandeza (sobrescritas em bloco por `casasDecimais` na entrada). */
export const CASAS_DECIMAIS_MOEDA_PADRAO = 2;
export const CASAS_DECIMAIS_CPK_PADRAO = 4;
export const CASAS_DECIMAIS_PERCENTUAL_PADRAO = 2;
export const CASAS_DECIMAIS_KM_PADRAO = 2;

/**
 * Faixas de referência (% de diferença de CPK) para classificar a
 * magnitude da vantagem entre a opção de menor e a de maior CPK. Valores
 * iniciais e configuráveis — não representam um padrão de mercado.
 */
export const LIMITES_CLASSIFICACAO_DIFERENCA_CPK = {
  pequenaAtePercentual: 5,
  moderadaAtePercentual: 15,
  relevanteAtePercentual: 30,
};

/** Sempre presentes no resultado — a ferramenta nunca garante segurança ou adequação técnica. */
const LIMITACOES_PADRAO: string[] = [
  "Esta ferramenta não valida compatibilidade técnica (medida, índice de carga, índice de velocidade, aplicação, eixo). Confirme a adequação com o fabricante, reformador credenciado ou responsável técnico antes de aplicar a escolha.",
  "O resultado usa apenas os dados informados nesta chamada; nenhum preço, vida útil, número de recapagens ou compatibilidade foi consultado automaticamente.",
  "Estimativas não substituem o desempenho real: acompanhe o resultado realizado (quilometragemRealizada) para validar as premissas previstas.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoComparacaoPneus =
  | "COMPARACAO_SIMPLES"
  | "COMPARACAO_CPK"
  | "COMPARACAO_CICLO_COMPLETO"
  | "COMPARACAO_RECAPAGEM"
  | "COMPARACAO_FROTA"
  | "COMPARACAO_REALIZADO_PREVISTO";

export type TipoPneu = "NOVO_NACIONAL" | "NOVO_IMPORTADO" | "RECAPADO" | "REMOLDADO" | "USADO" | "OUTRO";

export type DesenhoPneu =
  | "LISO"
  | "BORRACHUDO"
  | "MISTO"
  | "DIRECIONAL"
  | "REGIONAL"
  | "RODOVIARIO"
  | "FORA_DE_ESTRADA"
  | "OUTRO";

export type CriterioPrincipalComparacao =
  | "MENOR_PRECO"
  | "MENOR_CPK"
  | "MAIOR_QUILOMETRAGEM"
  | "MENOR_CUSTO_TOTAL"
  | "MELHOR_CICLO"
  | "MAIOR_ECONOMIA";

/** Um evento de recapagem, com custo e quilometragem próprios — usado quando o ciclo não é uniforme. */
export interface RecapagemPneu {
  custo?: number;
  quilometragemPrevista?: number;
  quilometragemRealizada?: number;
  descricao?: string;
}

/**
 * Uma opção de pneu a ser comparada.
 *
 * Convenção de valores (para eliminar ambiguidade "por pneu" x "por
 * conjunto" x "por evento"):
 * - `custoAquisicao` e `custoPorRecapagem` (e cada item de `custosRecapagens`)
 *   são valores **por pneu, por evento**. São multiplicados por
 *   `quantidadePneus` ao formar o custo do conjunto.
 * - Os custos adicionais (`custoMontagem`, `custoDesmontagem`, `custoConserto`,
 *   `custoCamara`, `custoProtetor`, `custoFrete`, `custoDescarte`,
 *   `outrosCustos`) e `valorResidual` são **totais já para o conjunto**
 *   (`quantidadePneus`) desta opção — não são multiplicados novamente.
 */
export interface OpcaoPneu {
  id?: string;
  nome?: string;
  marca?: string;
  modelo?: string;
  medida?: string;
  tipo?: TipoPneu;
  aplicacao?: string;
  desenho?: DesenhoPneu;
  eixo?: string;

  /** Preço de aquisição, por pneu, em R$. */
  custoAquisicao?: number;
  /** Quantidade de pneus desta opção sendo avaliada. Se omitido, considera-se 1. */
  quantidadePneus?: number;

  quilometragemPrevista?: number;
  quilometragemRealizada?: number;

  numeroRecapagensPrevistas?: number;
  numeroRecapagensRealizadas?: number;
  /** Custo de cada recapagem, por pneu, em R$ — usado quando `custosRecapagens` não é informado. */
  custoPorRecapagem?: number;
  /**
   * Histórico/planejamento detalhado de recapagens, por pneu. Quando
   * informado, tem prioridade sobre `custoPorRecapagem` +
   * `numeroRecapagensPrevistas`/`numeroRecapagensRealizadas` para evitar
   * contar o mesmo custo duas vezes.
   */
  custosRecapagens?: RecapagemPneu[];
  /** Km adicionados por recapagem, usado apenas quando `custosRecapagens` não detalha por evento. */
  quilometragemPorRecapagem?: number;

  /** Valor residual total da opção (todos os pneus do conjunto) ao final do ciclo, em R$. */
  valorResidual?: number;

  /** Custos adicionais — cada campo é o total já para `quantidadePneus`, ver convenção acima. */
  custoMontagem?: number;
  custoDesmontagem?: number;
  custoConserto?: number;
  custoCamara?: number;
  custoProtetor?: number;
  custoFrete?: number;
  custoDescarte?: number;
  outrosCustos?: number;
  descricaoOutrosCustos?: string;

  indiceCarga?: string;
  indiceVelocidade?: string;
  capacidadeCarga?: number;
  observacoes?: string;
}

export interface CompararPneusEntrada {
  modo: ModoComparacaoPneus;
  opcoes: OpcaoPneu[];

  /** Usados em COMPARACAO_FROTA (e, se informados, em qualquer modo) para projetar economia total. */
  quantidadeVeiculos?: number;
  pneusPorVeiculo?: number;

  periodoAnalise?: string;
  /** Sobrescreve, para moeda/CPK/percentual/km, os padrões documentados nas constantes CASAS_DECIMAIS_*_PADRAO. */
  casasDecimais?: number;
  criterioPrincipal?: CriterioPrincipalComparacao;
  /** Quando `false`, a ferramenta não declara opção mais vantajosa se algum dado relevante estiver ausente (nível PARCIAL). Padrão: `true`. */
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export type NivelCompletude = "COMPLETO" | "PARCIAL" | "INSUFICIENTE";

export type ClassificacaoDiferencaCpk =
  | "DIFERENCA_PEQUENA"
  | "VANTAGEM_MODERADA"
  | "VANTAGEM_RELEVANTE"
  | "VANTAGEM_ELEVADA";

export interface ResultadoPorOpcao {
  id: string;
  nome: string;
  dadosRecebidos: OpcaoPneu;

  custoInicial?: number;
  custoRecapagens?: number;
  custosAdicionais?: number;
  valorResidual?: number;
  custoTotalCiclo?: number;

  quilometragemPrevista?: number;
  quilometragemRealizada?: number;

  /** CPK previsto, obtido via `calcularCpk` (calcular-cpk.ts, modo CPK_PNEUS). */
  cpkPrevisto?: number;
  /** CPK realizado, mesma via, quando há dados de quilometragem/recapagens realizadas. */
  cpkRealizado?: number;

  quantidadePneusConsiderada: number;
  numeroRecapagensConsideradas: number;

  custosIncluidos: string[];
  custosNaoInformados: string[];

  alertas: string[];
  premissas: string[];
  nivelCompletude: NivelCompletude;
  dadosFaltantes: string[];
}

export interface ItemRanking {
  id: string;
  nome: string;
  valor: number;
  posicao: number;
}

export interface RankingComparacao {
  porCpk: ItemRanking[];
  porCustoInicial: ItemRanking[];
  porCustoTotal: ItemRanking[];
  porQuilometragem: ItemRanking[];
}

export interface CompararPneusResultado extends ResultadoFerramentaBase {
  modo: ModoComparacaoPneus;
  criterioPrincipal: CriterioPrincipalComparacao;
  opcoesAnalisadas: number;
  resultadosPorOpcao: ResultadoPorOpcao[];
  ranking?: RankingComparacao;
  /** Nome da opção vencedora segundo `criterioPrincipal`. */
  melhorOpcao?: string;
  piorOpcao?: string;
  /**
   * Nome da opção usada como referência para `diferencaCpk`/`diferencaPercentual`/economia
   * (sempre a de maior CPK entre as comparáveis) — independente de `criterioPrincipal`,
   * pois essas fórmulas são sempre definidas em termos de CPK, conforme especificado.
   */
  opcaoReferencia?: string;
  diferencaCpk?: number;
  diferencaPercentual?: number;
  classificacaoDiferenca?: ClassificacaoDiferencaCpk;
  economiaPorPneu?: number;
  economiaPorVeiculo?: number;
  economiaFrota?: number;
  periodoAnalise?: string;
  /** Sempre presente — limitações fixas da ferramenta (ver LIMITACOES_PADRAO). */
  limitacoes: string[];
  /**
   * Memória de cálculo: principais valores usados por opção, em linguagem
   * natural. Não expõe estruturas internas do sistema.
   */
  memoriaCalculo: string[];
}

// ---------------------------------------------------------------------------
// Helpers de rótulo
// ---------------------------------------------------------------------------

function rotuloOpcao(opcao: OpcaoPneu, index: number): string {
  return opcao.nome ?? opcao.id ?? `Opção ${index + 1}`;
}

function idOpcao(opcao: OpcaoPneu, index: number): string {
  return opcao.id ?? `opcao-${index + 1}`;
}

// ---------------------------------------------------------------------------
// Validação estrutural (antes de qualquer agregação)
// ---------------------------------------------------------------------------

function camposNumericosOpcao(opcao: OpcaoPneu): Array<[string, number | undefined]> {
  return [
    ["custoAquisicao", opcao.custoAquisicao],
    ["quantidadePneus", opcao.quantidadePneus],
    ["quilometragemPrevista", opcao.quilometragemPrevista],
    ["quilometragemRealizada", opcao.quilometragemRealizada],
    ["numeroRecapagensPrevistas", opcao.numeroRecapagensPrevistas],
    ["numeroRecapagensRealizadas", opcao.numeroRecapagensRealizadas],
    ["custoPorRecapagem", opcao.custoPorRecapagem],
    ["quilometragemPorRecapagem", opcao.quilometragemPorRecapagem],
    ["valorResidual", opcao.valorResidual],
    ["custoMontagem", opcao.custoMontagem],
    ["custoDesmontagem", opcao.custoDesmontagem],
    ["custoConserto", opcao.custoConserto],
    ["custoCamara", opcao.custoCamara],
    ["custoProtetor", opcao.custoProtetor],
    ["custoFrete", opcao.custoFrete],
    ["custoDescarte", opcao.custoDescarte],
    ["outrosCustos", opcao.outrosCustos],
    ["capacidadeCarga", opcao.capacidadeCarga],
  ];
}

function validarEstrutura(entrada: CompararPneusEntrada): string[] {
  const erros: string[] = [];

  if (!entrada.opcoes || entrada.opcoes.length < 2) {
    erros.push("São necessárias ao menos duas opções para comparar.");
    return erros;
  }

  const idsVistos = new Set<string>();
  entrada.opcoes.forEach((opcao, index) => {
    const rotulo = rotuloOpcao(opcao, index);

    if (opcao.id) {
      if (idsVistos.has(opcao.id)) erros.push(`O id "${opcao.id}" está duplicado entre as opções.`);
      idsVistos.add(opcao.id);
    }

    for (const [campo, valor] of camposNumericosOpcao(opcao)) {
      if (valor !== undefined && valor < 0) {
        erros.push(`O campo "${rotulo}.${campo}" não pode ser negativo.`);
      }
    }
    if (opcao.quantidadePneus !== undefined && opcao.quantidadePneus <= 0) {
      erros.push(`"${rotulo}.quantidadePneus" deve ser maior que zero.`);
    }

    opcao.custosRecapagens?.forEach((recap, i) => {
      if (recap.custo !== undefined && recap.custo < 0) {
        erros.push(`"${rotulo}.custosRecapagens[${i}].custo" não pode ser negativo.`);
      }
      if (recap.quilometragemPrevista !== undefined && recap.quilometragemPrevista < 0) {
        erros.push(`"${rotulo}.custosRecapagens[${i}].quilometragemPrevista" não pode ser negativo.`);
      }
      if (recap.quilometragemRealizada !== undefined && recap.quilometragemRealizada < 0) {
        erros.push(`"${rotulo}.custosRecapagens[${i}].quilometragemRealizada" não pode ser negativo.`);
      }
    });
  });

  if (entrada.quantidadeVeiculos !== undefined && entrada.quantidadeVeiculos <= 0) {
    erros.push('"quantidadeVeiculos" deve ser maior que zero.');
  }
  if (entrada.pneusPorVeiculo !== undefined && entrada.pneusPorVeiculo <= 0) {
    erros.push('"pneusPorVeiculo" deve ser maior que zero.');
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Agregação do ciclo por opção (previsto ou realizado)
// ---------------------------------------------------------------------------

const CAMPOS_CUSTO_ADICIONAL: Array<{ campo: keyof OpcaoPneu; rotulo: string }> = [
  { campo: "custoMontagem", rotulo: "Montagem" },
  { campo: "custoDesmontagem", rotulo: "Desmontagem" },
  { campo: "custoConserto", rotulo: "Conserto" },
  { campo: "custoCamara", rotulo: "Câmara" },
  { campo: "custoProtetor", rotulo: "Protetor" },
  { campo: "custoFrete", rotulo: "Frete" },
  { campo: "custoDescarte", rotulo: "Descarte" },
  { campo: "outrosCustos", rotulo: "Outros custos" },
];

interface ResultadoAgregacao {
  custoInicial?: number;
  custoTotalRecapagens: number;
  custosAdicionais: number;
  valorResidualAplicado: number;
  custoTotalCiclo?: number;
  quilometragemTotal?: number;
  numeroRecapagensConsideradas: number;
  custosIncluidos: string[];
  custosNaoInformados: string[];
  alertas: string[];
  premissas: string[];
  dadosFaltantes: string[];
  errosValidacao: string[];
  recapagensIncompletas: boolean;
  residualNaoInformado: boolean;
  cpkComputavel: boolean;
}

function agregarVariante(
  opcao: OpcaoPneu,
  rotulo: string,
  variante: "PREVISTO" | "REALIZADO",
  nivelDetalhe: "SIMPLES" | "COMPLETO"
): ResultadoAgregacao {
  const custosIncluidos: string[] = [];
  const custosNaoInformados: string[] = [];
  const alertas: string[] = [];
  const premissas: string[] = [];
  const dadosFaltantes: string[] = [];
  const errosValidacao: string[] = [];
  let recapagensIncompletas = false;
  let residualNaoInformado = false;

  const quantidadePneus = opcao.quantidadePneus ?? 1;
  if (opcao.quantidadePneus === undefined) {
    premissas.push(`${rotulo}: "quantidadePneus" não informado; foi considerado 1 pneu.`);
  }

  let custoInicial: number | undefined;
  if (opcao.custoAquisicao === undefined) {
    dadosFaltantes.push(`${rotulo}.custoAquisicao`);
  } else {
    custoInicial = opcao.custoAquisicao * quantidadePneus;
    custosIncluidos.push(`${rotulo}: Aquisição`);
  }

  const rotuloKm = variante === "PREVISTO" ? "quilometragemPrevista" : "quilometragemRealizada";
  const quilometragemBase = variante === "PREVISTO" ? opcao.quilometragemPrevista : opcao.quilometragemRealizada;
  if (quilometragemBase === undefined) {
    dadosFaltantes.push(`${rotulo}.${rotuloKm}`);
  } else if (quilometragemBase === 0) {
    errosValidacao.push(
      `${rotulo}: a quilometragem ${variante === "PREVISTO" ? "prevista" : "realizada"} não pode ser igual a zero.`
    );
  }

  let custoTotalRecapagens = 0;
  let quilometragemRecapagens = 0;
  let numeroRecapagensConsideradas = 0;

  if (nivelDetalhe === "COMPLETO") {
    if (opcao.custosRecapagens && opcao.custosRecapagens.length > 0) {
      opcao.custosRecapagens.forEach((recap, i) => {
        const custoItem = recap.custo;
        const kmItem = variante === "PREVISTO" ? recap.quilometragemPrevista : recap.quilometragemRealizada;
        const rotuloItem = recap.descricao ?? `Recapagem ${i + 1}`;

        if (custoItem === undefined) {
          custosNaoInformados.push(`${rotulo}: ${rotuloItem} (custo)`);
          recapagensIncompletas = true;
        } else {
          custoTotalRecapagens += custoItem * quantidadePneus;
          custosIncluidos.push(`${rotulo}: ${rotuloItem} (custo)`);
          numeroRecapagensConsideradas += 1;
        }
        if (kmItem === undefined) {
          custosNaoInformados.push(`${rotulo}: ${rotuloItem} (quilometragem ${variante === "PREVISTO" ? "prevista" : "realizada"})`);
          recapagensIncompletas = true;
        } else {
          quilometragemRecapagens += kmItem;
        }
      });
    } else {
      const numero = variante === "PREVISTO" ? opcao.numeroRecapagensPrevistas : opcao.numeroRecapagensRealizadas;
      if (numero !== undefined && numero > 0) {
        numeroRecapagensConsideradas = numero;

        if (opcao.custoPorRecapagem === undefined) {
          custosNaoInformados.push(`${rotulo}: Recapagens (custoPorRecapagem)`);
          alertas.push(`${rotulo}: número de recapagens informado sem "custoPorRecapagem"; o custo das recapagens não entrou no cálculo.`);
          recapagensIncompletas = true;
        } else {
          custoTotalRecapagens = numero * opcao.custoPorRecapagem * quantidadePneus;
          custosIncluidos.push(`${rotulo}: Recapagens (${numero} × custoPorRecapagem)`);
        }

        if (opcao.quilometragemPorRecapagem === undefined) {
          custosNaoInformados.push(`${rotulo}: quilometragemPorRecapagem`);
          alertas.push(`${rotulo}: número de recapagens informado sem "quilometragemPorRecapagem"; a quilometragem total pode estar subestimada.`);
          recapagensIncompletas = true;
        } else {
          quilometragemRecapagens = numero * opcao.quilometragemPorRecapagem;
        }
      }
    }
  }

  let custosAdicionais = 0;
  if (nivelDetalhe === "COMPLETO") {
    for (const item of CAMPOS_CUSTO_ADICIONAL) {
      const valor = opcao[item.campo] as number | undefined;
      const rotuloCusto =
        item.campo === "outrosCustos" && opcao.descricaoOutrosCustos
          ? `Outros custos (${opcao.descricaoOutrosCustos})`
          : item.rotulo;
      if (valor !== undefined) {
        custosAdicionais += valor;
        custosIncluidos.push(`${rotulo}: ${rotuloCusto}`);
      } else {
        custosNaoInformados.push(`${rotulo}: ${rotuloCusto}`);
      }
    }
  }

  let valorResidualAplicado = 0;
  if (nivelDetalhe === "COMPLETO") {
    if (opcao.valorResidual === undefined) {
      custosNaoInformados.push(`${rotulo}: Valor residual`);
      premissas.push(`${rotulo}: valor residual não informado; foi considerado R$ 0,00 nesta simulação.`);
      residualNaoInformado = true;
    } else {
      valorResidualAplicado = opcao.valorResidual;
      custosIncluidos.push(`${rotulo}: Valor residual (dedução)`);
    }
  }

  let custoTotalCiclo: number | undefined;
  if (custoInicial !== undefined) {
    const custoBruto = custoInicial + custoTotalRecapagens + custosAdicionais;
    if (valorResidualAplicado > custoBruto) {
      errosValidacao.push(
        `${rotulo}: o valor residual (${formatarBRL(valorResidualAplicado)}) não pode ser maior que o custo bruto do ciclo (${formatarBRL(custoBruto)}) sem justificativa.`
      );
    } else {
      custoTotalCiclo = custoBruto - valorResidualAplicado;
    }
  }

  const quilometragemTotal =
    quilometragemBase !== undefined && quilometragemBase > 0 ? quilometragemBase + quilometragemRecapagens : undefined;

  return {
    custoInicial,
    custoTotalRecapagens,
    custosAdicionais,
    valorResidualAplicado,
    custoTotalCiclo,
    quilometragemTotal,
    numeroRecapagensConsideradas,
    custosIncluidos,
    custosNaoInformados,
    alertas,
    premissas,
    dadosFaltantes,
    errosValidacao,
    recapagensIncompletas,
    residualNaoInformado,
    cpkComputavel: custoTotalCiclo !== undefined && quilometragemTotal !== undefined && quilometragemTotal > 0,
  };
}

// ---------------------------------------------------------------------------
// Delegação do CPK para calcular-cpk.ts
// ---------------------------------------------------------------------------

function calcularCpkViaFerramenta(custoTotalCiclo: number, quilometragemTotal: number, casasCpk: number): number | undefined {
  const resultado = calcularCpk({
    modo: "CPK_PNEUS",
    custoPneus: custoTotalCiclo,
    quilometragem: quilometragemTotal,
    arredondamentoCasasDecimais: casasCpk,
  });
  return resultado.sucesso ? resultado.resultados.cpk : undefined;
}

// ---------------------------------------------------------------------------
// Nível de completude
// ---------------------------------------------------------------------------

const MODOS_CICLO_COMPLETO: ModoComparacaoPneus[] = [
  "COMPARACAO_CICLO_COMPLETO",
  "COMPARACAO_RECAPAGEM",
  "COMPARACAO_FROTA",
  "COMPARACAO_REALIZADO_PREVISTO",
];

function determinarCompletude(
  modo: ModoComparacaoPneus,
  agPrevisto: ResultadoAgregacao,
  agRealizado: ResultadoAgregacao | undefined
): NivelCompletude {
  if (!agPrevisto.cpkComputavel) return "INSUFICIENTE";
  if (modo === "COMPARACAO_REALIZADO_PREVISTO" && (!agRealizado || !agRealizado.cpkComputavel)) return "INSUFICIENTE";

  if (agPrevisto.recapagensIncompletas) return "PARCIAL";
  if (MODOS_CICLO_COMPLETO.includes(modo) && agPrevisto.residualNaoInformado) return "PARCIAL";
  if (agRealizado?.recapagensIncompletas) return "PARCIAL";

  return "COMPLETO";
}

// ---------------------------------------------------------------------------
// Resultado por opção
// ---------------------------------------------------------------------------

function construirResultadoOpcao(
  opcao: OpcaoPneu,
  index: number,
  modo: ModoComparacaoPneus,
  agPrevisto: ResultadoAgregacao,
  agRealizado: ResultadoAgregacao | undefined,
  casasMoeda: number,
  casasCpk: number,
  casasKm: number
): ResultadoPorOpcao {
  const nome = rotuloOpcao(opcao, index);
  const id = idOpcao(opcao, index);

  const cpkPrevisto =
    agPrevisto.cpkComputavel && agPrevisto.custoTotalCiclo !== undefined && agPrevisto.quilometragemTotal !== undefined
      ? calcularCpkViaFerramenta(agPrevisto.custoTotalCiclo, agPrevisto.quilometragemTotal, casasCpk)
      : undefined;

  const cpkRealizado =
    agRealizado?.cpkComputavel && agRealizado.custoTotalCiclo !== undefined && agRealizado.quilometragemTotal !== undefined
      ? calcularCpkViaFerramenta(agRealizado.custoTotalCiclo, agRealizado.quilometragemTotal, casasCpk)
      : undefined;

  const alertas = [...agPrevisto.alertas, ...(agRealizado?.alertas ?? [])];
  const premissas = [...agPrevisto.premissas, ...(agRealizado?.premissas ?? [])];

  if (
    agPrevisto.quilometragemTotal !== undefined &&
    agRealizado?.quilometragemTotal !== undefined &&
    agRealizado.quilometragemTotal < agPrevisto.quilometragemTotal
  ) {
    alertas.push(
      `${nome}: a quilometragem realizada (${formatarNumero(agRealizado.quilometragemTotal)} km) ficou abaixo da prevista (${formatarNumero(
        agPrevisto.quilometragemTotal
      )} km).`
    );
  }

  const dadosFaltantes = [...agPrevisto.dadosFaltantes, ...(agRealizado?.dadosFaltantes ?? [])];
  const nivelCompletude = determinarCompletude(modo, agPrevisto, agRealizado);

  return {
    id,
    nome,
    dadosRecebidos: opcao,
    custoInicial: agPrevisto.custoInicial !== undefined ? arredondar(agPrevisto.custoInicial, casasMoeda) : undefined,
    custoRecapagens: arredondar(agPrevisto.custoTotalRecapagens, casasMoeda),
    custosAdicionais: arredondar(agPrevisto.custosAdicionais, casasMoeda),
    valorResidual: arredondar(agPrevisto.valorResidualAplicado, casasMoeda),
    custoTotalCiclo: agPrevisto.custoTotalCiclo !== undefined ? arredondar(agPrevisto.custoTotalCiclo, casasMoeda) : undefined,
    quilometragemPrevista: agPrevisto.quilometragemTotal !== undefined ? arredondar(agPrevisto.quilometragemTotal, casasKm) : undefined,
    quilometragemRealizada:
      agRealizado?.quilometragemTotal !== undefined ? arredondar(agRealizado.quilometragemTotal, casasKm) : undefined,
    cpkPrevisto,
    cpkRealizado,
    quantidadePneusConsiderada: opcao.quantidadePneus ?? 1,
    numeroRecapagensConsideradas: agPrevisto.numeroRecapagensConsideradas,
    custosIncluidos: agPrevisto.custosIncluidos,
    custosNaoInformados: agPrevisto.custosNaoInformados,
    alertas,
    premissas,
    nivelCompletude,
    dadosFaltantes,
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function construirRankingMetrica(
  resultados: ResultadoPorOpcao[],
  extrair: (r: ResultadoPorOpcao) => number | undefined,
  ascendente: boolean
): ItemRanking[] {
  return resultados
    .filter((r) => extrair(r) !== undefined)
    .sort((a, b) => {
      const va = extrair(a) as number;
      const vb = extrair(b) as number;
      return ascendente ? va - vb : vb - va;
    })
    .map((r, i) => ({ id: r.id, nome: r.nome, valor: extrair(r) as number, posicao: i + 1 }));
}

function construirRanking(resultados: ResultadoPorOpcao[]): RankingComparacao {
  return {
    porCpk: construirRankingMetrica(resultados, (r) => r.cpkPrevisto, true),
    porCustoInicial: construirRankingMetrica(resultados, (r) => r.custoInicial, true),
    porCustoTotal: construirRankingMetrica(resultados, (r) => r.custoTotalCiclo, true),
    porQuilometragem: construirRankingMetrica(resultados, (r) => r.quilometragemPrevista, false),
  };
}

// ---------------------------------------------------------------------------
// Critério principal (melhor/pior opção)
// ---------------------------------------------------------------------------

const EXTRATORES_CRITERIO: Record<
  CriterioPrincipalComparacao,
  { extrair: (r: ResultadoPorOpcao) => number | undefined; melhorEhMenor: boolean }
> = {
  MENOR_PRECO: { extrair: (r) => r.custoInicial, melhorEhMenor: true },
  MENOR_CPK: { extrair: (r) => r.cpkPrevisto, melhorEhMenor: true },
  MAIOR_QUILOMETRAGEM: { extrair: (r) => r.quilometragemPrevista, melhorEhMenor: false },
  MENOR_CUSTO_TOTAL: { extrair: (r) => r.custoTotalCiclo, melhorEhMenor: true },
  MELHOR_CICLO: { extrair: (r) => r.cpkPrevisto, melhorEhMenor: true },
  MAIOR_ECONOMIA: { extrair: (r) => r.cpkPrevisto, melhorEhMenor: true },
};

function selecionarMelhorPior(
  resultados: ResultadoPorOpcao[],
  criterio: CriterioPrincipalComparacao
): { melhor?: ResultadoPorOpcao; pior?: ResultadoPorOpcao } {
  const config = EXTRATORES_CRITERIO[criterio] ?? EXTRATORES_CRITERIO.MENOR_CPK;
  const candidatos = resultados.filter((r) => config.extrair(r) !== undefined);
  if (candidatos.length === 0) return {};

  const ordenados = [...candidatos].sort((a, b) => {
    const va = config.extrair(a) as number;
    const vb = config.extrair(b) as number;
    return config.melhorEhMenor ? va - vb : vb - va;
  });

  return { melhor: ordenados[0], pior: ordenados[ordenados.length - 1] };
}

// ---------------------------------------------------------------------------
// Diferença de CPK e economia (sempre em relação à opção de maior CPK)
// ---------------------------------------------------------------------------

function classificarDiferenca(diferencaPercentual: number | undefined): ClassificacaoDiferencaCpk | undefined {
  if (diferencaPercentual === undefined) return undefined;
  const abs = Math.abs(diferencaPercentual);
  if (abs <= LIMITES_CLASSIFICACAO_DIFERENCA_CPK.pequenaAtePercentual) return "DIFERENCA_PEQUENA";
  if (abs <= LIMITES_CLASSIFICACAO_DIFERENCA_CPK.moderadaAtePercentual) return "VANTAGEM_MODERADA";
  if (abs <= LIMITES_CLASSIFICACAO_DIFERENCA_CPK.relevanteAtePercentual) return "VANTAGEM_RELEVANTE";
  return "VANTAGEM_ELEVADA";
}

interface ResultadoDiferencaEconomia {
  diferencaCpk?: number;
  diferencaPercentual?: number;
  economiaPorPneu?: number;
  economiaPorVeiculo?: number;
  economiaFrota?: number;
  premissas: string[];
}

function calcularDiferencasEconomia(
  melhor: ResultadoPorOpcao | undefined,
  referencia: ResultadoPorOpcao | undefined,
  entrada: CompararPneusEntrada,
  casasMoeda: number,
  casasCpk: number,
  casasPercentual: number
): ResultadoDiferencaEconomia {
  const premissas: string[] = [];
  if (!melhor || !referencia || melhor.cpkPrevisto === undefined || referencia.cpkPrevisto === undefined || melhor.id === referencia.id) {
    return { premissas };
  }

  const diferencaCpk = arredondar(referencia.cpkPrevisto - melhor.cpkPrevisto, casasCpk);
  const diferencaPercentual =
    referencia.cpkPrevisto > 0 ? arredondar((diferencaCpk / referencia.cpkPrevisto) * 100, casasPercentual) : 0;

  premissas.push(`"${referencia.nome}" foi usada como referência (maior CPK) para o cálculo de diferença e economia.`);

  let economiaPorPneu: number | undefined;
  if (referencia.quilometragemPrevista !== undefined) {
    economiaPorPneu = arredondar(diferencaCpk * referencia.quilometragemPrevista, casasMoeda);
    premissas.push(
      `A economia por pneu aplica a diferença de CPK à quilometragem prevista de "${referencia.nome}" (${formatarNumero(referencia.quilometragemPrevista)} km).`
    );
  }

  let economiaPorVeiculo: number | undefined;
  let economiaFrota: number | undefined;
  if (economiaPorPneu !== undefined && entrada.pneusPorVeiculo !== undefined) {
    economiaPorVeiculo = arredondar(economiaPorPneu * entrada.pneusPorVeiculo, casasMoeda);
    if (entrada.quantidadeVeiculos !== undefined) {
      economiaFrota = arredondar(economiaPorVeiculo * entrada.quantidadeVeiculos, casasMoeda);
    }
  }

  return { diferencaCpk, diferencaPercentual, economiaPorPneu, economiaPorVeiculo, economiaFrota, premissas };
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirResumo(
  entrada: CompararPneusEntrada,
  melhor: ResultadoPorOpcao | undefined,
  referencia: ResultadoPorOpcao | undefined,
  diferencaCpk: number | undefined,
  diferencaPercentual: number | undefined,
  economiaFrota: number | undefined,
  economiaPorPneu: number | undefined,
  completudeGeral: NivelCompletude,
  camposFaltantesResumo: string[]
): string {
  if (!melhor || !referencia || diferencaCpk === undefined || melhor.cpkPrevisto === undefined || referencia.cpkPrevisto === undefined) {
    return "Não foi possível concluir a comparação com os dados informados. Verifique os campos faltantes por opção.";
  }

  const partes: string[] = [];
  partes.push(`Com os valores e as quilometragens informados, "${melhor.nome}" apresentou o menor CPK previsto nos dados informados.`);
  partes.push(
    `O CPK estimado foi de ${formatarBRL(melhor.cpkPrevisto)}/km, contra ${formatarBRL(referencia.cpkPrevisto)}/km de "${referencia.nome}".`
  );
  if (diferencaPercentual !== undefined) {
    partes.push(
      `A diferença estimada é de ${formatarBRL(diferencaCpk)}/km, equivalente a aproximadamente ${formatarNumero(diferencaPercentual)}% em relação a "${referencia.nome}".`
    );
  }
  if (economiaFrota !== undefined && entrada.pneusPorVeiculo !== undefined && entrada.quantidadeVeiculos !== undefined) {
    partes.push(
      `Para ${entrada.quantidadeVeiculos} veículos com ${entrada.pneusPorVeiculo} pneus cada, a economia projetada seria de ${formatarBRL(economiaFrota)}.`
    );
  } else if (economiaPorPneu !== undefined) {
    partes.push(`A economia projetada por pneu, na quilometragem de referência, seria de ${formatarBRL(economiaPorPneu)}.`);
  }
  if (completudeGeral === "PARCIAL") {
    partes.push(`A análise é parcial porque não foram informados: ${camposFaltantesResumo.join(", ")}.`);
  } else if (completudeGeral === "INSUFICIENTE") {
    partes.push("A análise é insuficiente para uma conclusão financeira confiável, por falta de dados essenciais em ao menos uma opção.");
  }
  partes.push("Este resultado depende das premissas informadas e não substitui validação técnica de compatibilidade.");

  return partes.join(" ");
}

function construirMemoriaCalculo(r: ResultadoPorOpcao): string[] {
  const linhas: string[] = [];
  if (r.custoTotalCiclo === undefined) {
    linhas.push(`${r.nome}: dados insuficientes para compor o custo do ciclo (${r.dadosFaltantes.join(", ") || "ver dadosFaltantes"}).`);
    return linhas;
  }

  const partes: string[] = [`custoInicial ${formatarBRL(r.custoInicial ?? 0)}`];
  if (r.custoRecapagens) partes.push(`+ recapagens ${formatarBRL(r.custoRecapagens)}`);
  if (r.custosAdicionais) partes.push(`+ adicionais ${formatarBRL(r.custosAdicionais)}`);
  if (r.valorResidual) partes.push(`− residual ${formatarBRL(r.valorResidual)}`);
  linhas.push(`${r.nome}: ${partes.join(" ")} = custoTotalCiclo ${formatarBRL(r.custoTotalCiclo)}.`);

  if (r.quilometragemPrevista !== undefined && r.cpkPrevisto !== undefined) {
    linhas.push(
      `${r.nome}: CPK previsto = ${formatarBRL(r.custoTotalCiclo)} ÷ ${formatarNumero(r.quilometragemPrevista)} km = ${formatarBRL(r.cpkPrevisto)}/km.`
    );
  }
  if (r.quilometragemRealizada !== undefined && r.cpkRealizado !== undefined) {
    linhas.push(`${r.nome}: CPK realizado = ÷ ${formatarNumero(r.quilometragemRealizada)} km realizados = ${formatarBRL(r.cpkRealizado)}/km.`);
  }

  return linhas;
}

// ---------------------------------------------------------------------------
// Fábrica de resposta de falha
// ---------------------------------------------------------------------------

function respostaFalha(
  entrada: CompararPneusEntrada,
  criterioPrincipal: CriterioPrincipalComparacao,
  mensagemResumo: string,
  dadosFaltantes: string[] = [],
  resultadosPorOpcao: ResultadoPorOpcao[] = []
): CompararPneusResultado {
  return {
    sucesso: false,
    modo: entrada.modo,
    criterioPrincipal,
    opcoesAnalisadas: entrada.opcoes?.length ?? 0,
    resultadosPorOpcao,
    alertas: [],
    premissas: [],
    limitacoes: LIMITACOES_PADRAO,
    dadosFaltantes,
    mensagemResumo,
    memoriaCalculo: [],
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

export function compararPneus(entrada: CompararPneusEntrada): CompararPneusResultado {
  const casasMoeda = entrada.casasDecimais ?? CASAS_DECIMAIS_MOEDA_PADRAO;
  const casasCpk = entrada.casasDecimais ?? CASAS_DECIMAIS_CPK_PADRAO;
  const casasPercentual = entrada.casasDecimais ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO;
  const casasKm = entrada.casasDecimais ?? CASAS_DECIMAIS_KM_PADRAO;
  const criterioPrincipal = entrada.criterioPrincipal ?? "MENOR_CPK";

  const errosEstruturais = validarEstrutura(entrada);
  if (errosEstruturais.length > 0) {
    return respostaFalha(entrada, criterioPrincipal, errosEstruturais.join(" "));
  }

  const opcoes = entrada.opcoes;
  const nivelDetalhe: "SIMPLES" | "COMPLETO" = entrada.modo === "COMPARACAO_SIMPLES" ? "SIMPLES" : "COMPLETO";

  const agregacoesPrevisto: ResultadoAgregacao[] = [];
  const agregacoesRealizado: Array<ResultadoAgregacao | undefined> = [];
  const errosAgregacao: string[] = [];

  opcoes.forEach((opcao, index) => {
    const rotulo = rotuloOpcao(opcao, index);

    const agPrevisto = agregarVariante(opcao, rotulo, "PREVISTO", nivelDetalhe);
    agregacoesPrevisto.push(agPrevisto);
    errosAgregacao.push(...agPrevisto.errosValidacao);

    const temDadosRealizado =
      opcao.quilometragemRealizada !== undefined ||
      opcao.numeroRecapagensRealizadas !== undefined ||
      (opcao.custosRecapagens?.some((r) => r.quilometragemRealizada !== undefined) ?? false);

    if (nivelDetalhe === "COMPLETO" && (temDadosRealizado || entrada.modo === "COMPARACAO_REALIZADO_PREVISTO")) {
      const agRealizado = agregarVariante(opcao, rotulo, "REALIZADO", nivelDetalhe);
      agregacoesRealizado.push(agRealizado);
      errosAgregacao.push(...agRealizado.errosValidacao);
    } else {
      agregacoesRealizado.push(undefined);
    }
  });

  if (errosAgregacao.length > 0) {
    return respostaFalha(entrada, criterioPrincipal, errosAgregacao.join(" "));
  }

  const resultadosPorOpcao: ResultadoPorOpcao[] = opcoes.map((opcao, index) =>
    construirResultadoOpcao(opcao, index, entrada.modo, agregacoesPrevisto[index], agregacoesRealizado[index], casasMoeda, casasCpk, casasKm)
  );

  const comCpkValido = resultadosPorOpcao.filter((r) => r.cpkPrevisto !== undefined);
  const dadosFaltantesGeral = resultadosPorOpcao.flatMap((r) => r.dadosFaltantes.map((c) => `${r.nome}: ${c}`));

  if (comCpkValido.length < 2) {
    return respostaFalha(
      entrada,
      criterioPrincipal,
      "Não há dados suficientes em ao menos duas opções para uma conclusão financeira. Verifique os campos faltantes por opção.",
      dadosFaltantesGeral,
      resultadosPorOpcao
    );
  }

  const ranking = construirRanking(comCpkValido);
  const { melhor, pior } = selecionarMelhorPior(comCpkValido, criterioPrincipal);

  const ordenadosPorCpk = [...comCpkValido].sort((a, b) => (a.cpkPrevisto as number) - (b.cpkPrevisto as number));
  const melhorPorCpk = ordenadosPorCpk[0];
  const referencia = ordenadosPorCpk[ordenadosPorCpk.length - 1];

  const {
    diferencaCpk,
    diferencaPercentual,
    economiaPorPneu,
    economiaPorVeiculo,
    economiaFrota,
    premissas: premissasDiferenca,
  } = calcularDiferencasEconomia(melhorPorCpk, referencia, entrada, casasMoeda, casasCpk, casasPercentual);

  const classificacaoDiferenca = classificarDiferenca(diferencaPercentual);

  const alertasGerais: string[] = [];
  if (entrada.modo === "COMPARACAO_FROTA") {
    if (entrada.pneusPorVeiculo === undefined || entrada.quantidadeVeiculos === undefined) {
      alertasGerais.push('Para projetar a economia da frota, informe "pneusPorVeiculo" e "quantidadeVeiculos".');
    } else {
      opcoes.forEach((opcao, index) => {
        if (opcao.quantidadePneus !== undefined && opcao.quantidadePneus > 1) {
          alertasGerais.push(
            `"${rotuloOpcao(opcao, index)}": "quantidadePneus" (${opcao.quantidadePneus}) foi informado junto com "pneusPorVeiculo"; confirme que não há dupla contagem — a projeção de frota já multiplica por pneusPorVeiculo × quantidadeVeiculos.`
          );
        }
      });
    }
  }

  const completudeGeral: NivelCompletude = resultadosPorOpcao.some((r) => r.nivelCompletude === "INSUFICIENTE" || r.nivelCompletude === "PARCIAL")
    ? "PARCIAL"
    : "COMPLETO";

  const permitirEstimativas = entrada.permitirEstimativas ?? true;
  const bloquearConclusao = !permitirEstimativas && completudeGeral === "PARCIAL";

  const camposFaltantesResumo = Array.from(new Set(resultadosPorOpcao.flatMap((r) => r.custosNaoInformados)));

  if (bloquearConclusao) {
    alertasGerais.push('Conclusão financeira suprimida: "permitirEstimativas" está desativado e há dados incompletos em ao menos uma opção.');
  }

  const mensagemResumo = bloquearConclusao
    ? `A comparação não pôde concluir qual opção é mais vantajosa porque "permitirEstimativas" está desativado e há dados incompletos (${camposFaltantesResumo.join(", ")}). Informe os dados faltantes ou permita estimativas.`
    : construirResumo(entrada, melhorPorCpk, referencia, diferencaCpk, diferencaPercentual, economiaFrota, economiaPorPneu, completudeGeral, camposFaltantesResumo);

  const memoriaCalculo = resultadosPorOpcao.flatMap((r) => construirMemoriaCalculo(r));

  return {
    sucesso: true,
    modo: entrada.modo,
    criterioPrincipal,
    opcoesAnalisadas: opcoes.length,
    resultadosPorOpcao,
    ranking,
    melhorOpcao: bloquearConclusao ? undefined : melhor?.nome,
    piorOpcao: bloquearConclusao ? undefined : pior?.nome,
    opcaoReferencia: bloquearConclusao ? undefined : referencia?.nome,
    diferencaCpk: bloquearConclusao ? undefined : diferencaCpk,
    diferencaPercentual: bloquearConclusao ? undefined : diferencaPercentual,
    classificacaoDiferenca: bloquearConclusao ? undefined : classificacaoDiferenca,
    economiaPorPneu: bloquearConclusao ? undefined : economiaPorPneu,
    economiaPorVeiculo: bloquearConclusao ? undefined : economiaPorVeiculo,
    economiaFrota: bloquearConclusao ? undefined : economiaFrota,
    periodoAnalise: entrada.periodoAnalise,
    alertas: [...alertasGerais, ...resultadosPorOpcao.flatMap((r) => r.alertas)],
    premissas: [...premissasDiferenca, ...resultadosPorOpcao.flatMap((r) => r.premissas)],
    limitacoes: LIMITACOES_PADRAO,
    dadosFaltantes: [],
    mensagemResumo,
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
    descricao: "Tipo de comparação desejada.",
    valoresPossiveis: [
      "COMPARACAO_SIMPLES",
      "COMPARACAO_CPK",
      "COMPARACAO_CICLO_COMPLETO",
      "COMPARACAO_RECAPAGEM",
      "COMPARACAO_FROTA",
      "COMPARACAO_REALIZADO_PREVISTO",
    ],
  },
  {
    nome: "opcoes",
    tipo: "string",
    obrigatorio: true,
    descricao:
      "Lista com ao menos 2 opções de pneu a comparar. Cada opção aceita: id, nome, marca, modelo, medida, tipo, aplicacao, desenho, eixo, custoAquisicao (por pneu), quantidadePneus, quilometragemPrevista/Realizada, numeroRecapagensPrevistas/Realizadas, custoPorRecapagem (por pneu), custosRecapagens (lista detalhada), quilometragemPorRecapagem, valorResidual (total do conjunto), custoMontagem/Desmontagem/Conserto/Camara/Protetor/Frete/Descarte/outrosCustos (totais do conjunto), indiceCarga, indiceVelocidade, capacidadeCarga, observacoes.",
  },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos da frota (usado em COMPARACAO_FROTA)." },
  { nome: "pneusPorVeiculo", tipo: "number", obrigatorio: false, descricao: "Quantidade de pneus por veículo (usado em COMPARACAO_FROTA)." },
  { nome: "periodoAnalise", tipo: "string", obrigatorio: false, descricao: "Rótulo do período analisado." },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve as casas decimais padrão (moeda: 2, CPK: 4, percentual: 2, km: 2)." },
  {
    nome: "criterioPrincipal",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Critério para eleger a opção vencedora. Padrão: MENOR_CPK.",
    valoresPossiveis: ["MENOR_PRECO", "MENOR_CPK", "MAIOR_QUILOMETRAGEM", "MENOR_CUSTO_TOTAL", "MELHOR_CICLO", "MAIOR_ECONOMIA"],
  },
  {
    nome: "permitirEstimativas",
    tipo: "boolean",
    obrigatorio: false,
    descricao: "Quando false, suprime a conclusão financeira se houver dados incompletos (nível PARCIAL). Padrão: true.",
  },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres sobre a comparação." },
];

export const ferramentaCompararPneus: DefinicaoFerramenta<CompararPneusEntrada, CompararPneusResultado> = {
  nome: "comparar_pneus",
  descricao:
    "Compara duas ou mais opções de pneu (novo, importado, recapado, remoldado, marcas/modelos diferentes) pelo custo total do ciclo e pelo CPK — não apenas pelo preço de compra. Aceita cenários previstos e realizados e projeta o impacto de uma escolha na frota. Não valida automaticamente compatibilidade técnica. Use apenas quando o usuário pedir uma comparação numérica concreta entre opções de pneu; não use para perguntas gerais sobre pneus sem dados para calcular.",
  objetivo:
    "Apoiar a decisão entre alternativas de pneu com base em custo total do ciclo e CPK, sem afirmar superioridade técnica/segurança e sem inventar preço, quilometragem, número de recapagens, vida útil ou compatibilidade.",
  parametros: PARAMETROS,
  executar: compararPneus,
};
