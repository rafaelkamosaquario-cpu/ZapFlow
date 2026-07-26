import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: analisar_frete
 *
 * Objetivo: avaliar se um frete ofertado é viável para o transportador,
 * cruzando receita, custos operacionais estimados da viagem e margem
 * mínima desejada, apontando se o valor cobre os custos e qual a margem
 * resultante.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface AnalisarFreteEntrada {
  /** Valor total ofertado pelo frete, em R$. */
  valorFreteOfertado?: number;
  /** Distância total da viagem (ida, ou ida e volta conforme o caso), em km. */
  distanciaTotalKm?: number;
  /** Custo operacional total estimado da viagem, em R$ (pode vir de calcular-custo-viagem). */
  custoOperacionalEstimado?: number;
  /** Margem mínima aceitável, em percentual sobre o custo. */
  margemMinimaDesejadaPercentual?: number;
  /** Peso ou volume da carga, quando relevante para o contexto. */
  descricaoCarga?: string;
}

export interface AnalisarFreteResultado extends ResultadoFerramentaBase {
  resultados?: {
    receitaPorKm?: number;
    margemResultantePercentual?: number;
    lucroEstimado?: number;
  };
  classificacao?: "FRETE_VIAVEL" | "FRETE_NO_LIMITE" | "FRETE_INVIAVEL" | "DADOS_INSUFICIENTES";
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "valorFreteOfertado", tipo: "number", obrigatorio: true, descricao: "Valor total ofertado pelo frete, em R$." },
  { nome: "distanciaTotalKm", tipo: "number", obrigatorio: true, descricao: "Distância total da viagem, em km." },
  { nome: "custoOperacionalEstimado", tipo: "number", obrigatorio: true, descricao: "Custo operacional total estimado da viagem, em R$." },
  { nome: "margemMinimaDesejadaPercentual", tipo: "number", obrigatorio: false, descricao: "Margem mínima aceitável, em percentual." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function analisarFrete(_entrada: AnalisarFreteEntrada): AnalisarFreteResultado {
  throw new Error("analisarFrete: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaAnalisarFrete: DefinicaoFerramenta<AnalisarFreteEntrada, AnalisarFreteResultado> = {
  nome: "analisar_frete",
  descricao: "Avalia se um frete ofertado cobre os custos operacionais da viagem e qual margem resulta.",
  objetivo: "Apoiar a decisao de aceitar ou recusar um frete com base em receita, custo e margem.",
  parametros: PARAMETROS,
  executar: analisarFrete,
};
