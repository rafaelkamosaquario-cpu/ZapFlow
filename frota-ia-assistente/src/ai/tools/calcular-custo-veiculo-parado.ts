import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_custo_veiculo_parado
 *
 * Objetivo: calcular quanto custa manter o veículo parado (custos fixos
 * que continuam existindo mesmo sem rodar: parcela, seguro, salário do
 * motorista, etc.), por dia ou pelo período parado informado.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface CalcularCustoVeiculoParadoEntrada {
  custosFixosMensais?: number;
  diasParado?: number;
}

export interface CalcularCustoVeiculoParadoResultado extends ResultadoFerramentaBase {
  resultados?: {
    custoFixoPorDia?: number;
    custoTotalPeriodoParado?: number;
  };
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "custosFixosMensais", tipo: "number", obrigatorio: true, descricao: "Soma dos custos fixos mensais, em R$." },
  { nome: "diasParado", tipo: "number", obrigatorio: true, descricao: "Quantidade de dias em que o veículo ficou parado." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularCustoVeiculoParado(_entrada: CalcularCustoVeiculoParadoEntrada): CalcularCustoVeiculoParadoResultado {
  throw new Error("calcularCustoVeiculoParado: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularCustoVeiculoParado: DefinicaoFerramenta<
  CalcularCustoVeiculoParadoEntrada,
  CalcularCustoVeiculoParadoResultado
> = {
  nome: "calcular_custo_veiculo_parado",
  descricao: "Calcula o custo de manter o veículo parado, com base nos custos fixos mensais e nos dias parado.",
  objetivo: "Mostrar o impacto financeiro de um veículo ocioso (manutenção, espera de carga, quebra, etc.).",
  parametros: PARAMETROS,
  executar: calcularCustoVeiculoParado,
};
