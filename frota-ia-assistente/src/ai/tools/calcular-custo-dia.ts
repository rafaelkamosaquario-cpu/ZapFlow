import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_custo_dia
 *
 * Objetivo: calcular o custo diário de operação do veículo, dividindo os
 * custos fixos mensais pelos dias operacionais e somando os custos
 * variáveis médios do dia.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface CalcularCustoDiaEntrada {
  custosFixosMensais?: number;
  diasOperacionaisMes?: number;
  custosVariaveisMediosDia?: number;
}

export interface CalcularCustoDiaResultado extends ResultadoFerramentaBase {
  resultados?: {
    custoFixoPorDia?: number;
    custoTotalPorDia?: number;
  };
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "custosFixosMensais", tipo: "number", obrigatorio: true, descricao: "Soma dos custos fixos mensais, em R$." },
  { nome: "diasOperacionaisMes", tipo: "number", obrigatorio: true, descricao: "Quantidade de dias operacionais no mês." },
  { nome: "custosVariaveisMediosDia", tipo: "number", obrigatorio: false, descricao: "Custos variáveis médios de um dia de operação, em R$." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularCustoDia(_entrada: CalcularCustoDiaEntrada): CalcularCustoDiaResultado {
  throw new Error("calcularCustoDia: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularCustoDia: DefinicaoFerramenta<CalcularCustoDiaEntrada, CalcularCustoDiaResultado> = {
  nome: "calcular_custo_dia",
  descricao: "Calcula o custo diário de operação do veículo a partir dos custos fixos mensais e variáveis médios.",
  objetivo: "Estimar quanto custa manter o veículo operando por dia, base para diárias e negociação de fretes curtos.",
  parametros: PARAMETROS,
  executar: calcularCustoDia,
};
