import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_valor_minimo_frete
 *
 * Objetivo: calcular o valor mínimo que um frete precisa pagar para
 * cobrir o custo operacional da viagem e ainda garantir a margem mínima
 * desejada pelo transportador.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface CalcularValorMinimoFreteEntrada {
  custoOperacionalViagem?: number;
  margemMinimaDesejadaPercentual?: number;
  distanciaTotalKm?: number;
}

export interface CalcularValorMinimoFreteResultado extends ResultadoFerramentaBase {
  resultados?: {
    valorMinimoFrete?: number;
    valorMinimoPorKm?: number;
  };
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "custoOperacionalViagem", tipo: "number", obrigatorio: true, descricao: "Custo operacional total estimado da viagem, em R$." },
  { nome: "margemMinimaDesejadaPercentual", tipo: "number", obrigatorio: true, descricao: "Margem mínima desejada sobre o custo, em percentual." },
  { nome: "distanciaTotalKm", tipo: "number", obrigatorio: false, descricao: "Distância total da viagem, em km (para calcular o valor mínimo por km)." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularValorMinimoFrete(_entrada: CalcularValorMinimoFreteEntrada): CalcularValorMinimoFreteResultado {
  throw new Error("calcularValorMinimoFrete: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularValorMinimoFrete: DefinicaoFerramenta<
  CalcularValorMinimoFreteEntrada,
  CalcularValorMinimoFreteResultado
> = {
  nome: "calcular_valor_minimo_frete",
  descricao: "Calcula o valor mínimo que um frete deve pagar para cobrir custos e garantir a margem mínima desejada.",
  objetivo: "Definir um piso de negociação para o transportador antes de aceitar um frete.",
  parametros: PARAMETROS,
  executar: calcularValorMinimoFrete,
};
