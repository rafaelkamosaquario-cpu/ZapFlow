import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_margem
 *
 * Objetivo: calcular a margem de lucro (nominal e percentual) a partir
 * da receita e do custo total de uma operação, viagem ou período.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface CalcularMargemEntrada {
  receitaTotal?: number;
  custoTotal?: number;
}

export interface CalcularMargemResultado extends ResultadoFerramentaBase {
  resultados?: {
    lucroNominal?: number;
    margemPercentual?: number;
  };
  classificacao?: "MARGEM_POSITIVA" | "MARGEM_NULA" | "MARGEM_NEGATIVA" | "DADOS_INSUFICIENTES";
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "receitaTotal", tipo: "number", obrigatorio: true, descricao: "Receita total da operação, em R$." },
  { nome: "custoTotal", tipo: "number", obrigatorio: true, descricao: "Custo total da operação, em R$." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularMargem(_entrada: CalcularMargemEntrada): CalcularMargemResultado {
  throw new Error("calcularMargem: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularMargem: DefinicaoFerramenta<CalcularMargemEntrada, CalcularMargemResultado> = {
  nome: "calcular_margem",
  descricao: "Calcula o lucro nominal e a margem percentual a partir da receita e do custo total.",
  objetivo: "Mostrar de forma clara se uma operação é lucrativa e em que proporção.",
  parametros: PARAMETROS,
  executar: calcularMargem,
};
