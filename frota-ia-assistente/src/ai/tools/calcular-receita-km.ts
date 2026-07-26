import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_receita_km
 *
 * Objetivo: calcular a receita por quilômetro rodado em um período ou
 * viagem, indicador usado para comparar a eficiência de diferentes
 * fretes, rotas ou veículos.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface CalcularReceitaKmEntrada {
  receitaTotalPeriodo?: number;
  quilometragemPeriodo?: number;
}

export interface CalcularReceitaKmResultado extends ResultadoFerramentaBase {
  resultados?: {
    receitaPorKm?: number;
  };
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "receitaTotalPeriodo", tipo: "number", obrigatorio: true, descricao: "Receita total do período ou viagem, em R$." },
  { nome: "quilometragemPeriodo", tipo: "number", obrigatorio: true, descricao: "Quilometragem total rodada no mesmo período, em km." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularReceitaKm(_entrada: CalcularReceitaKmEntrada): CalcularReceitaKmResultado {
  throw new Error("calcularReceitaKm: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularReceitaKm: DefinicaoFerramenta<CalcularReceitaKmEntrada, CalcularReceitaKmResultado> = {
  nome: "calcular_receita_km",
  descricao: "Calcula a receita por quilômetro rodado em um período ou viagem.",
  objetivo: "Fornecer um indicador comparável de eficiência de receita entre viagens, rotas ou veículos.",
  parametros: PARAMETROS,
  executar: calcularReceitaKm,
};
