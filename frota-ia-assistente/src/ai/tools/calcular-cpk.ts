import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_cpk
 *
 * Objetivo: calcular o Custo Por Quilômetro (CPK) do veículo/operação,
 * somando custos fixos e variáveis e dividindo pela quilometragem rodada
 * no período.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface CalcularCpkEntrada {
  /** Soma dos custos fixos do período (parcela, seguro, salário, etc.), em R$. */
  custosFixosPeriodo?: number;
  /** Soma dos custos variáveis do período (combustível, pneus, manutenção, etc.), em R$. */
  custosVariaveisPeriodo?: number;
  /** Quilometragem total rodada no mesmo período, em km. */
  quilometragemPeriodo?: number;
}

export interface CalcularCpkResultado extends ResultadoFerramentaBase {
  resultados?: {
    custoTotalPeriodo?: number;
    cpk?: number;
    cpkFixo?: number;
    cpkVariavel?: number;
  };
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "custosFixosPeriodo", tipo: "number", obrigatorio: true, descricao: "Soma dos custos fixos do período, em R$." },
  { nome: "custosVariaveisPeriodo", tipo: "number", obrigatorio: true, descricao: "Soma dos custos variáveis do período, em R$." },
  { nome: "quilometragemPeriodo", tipo: "number", obrigatorio: true, descricao: "Quilometragem total rodada no período, em km." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularCpk(_entrada: CalcularCpkEntrada): CalcularCpkResultado {
  throw new Error("calcularCpk: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularCpk: DefinicaoFerramenta<CalcularCpkEntrada, CalcularCpkResultado> = {
  nome: "calcular_cpk",
  descricao: "Calcula o Custo Por Quilômetro (CPK) a partir dos custos fixos, variáveis e da quilometragem do período.",
  objetivo: "Fornecer o indicador de custo por km usado como base para precificação e análise de viabilidade.",
  parametros: PARAMETROS,
  executar: calcularCpk,
};
