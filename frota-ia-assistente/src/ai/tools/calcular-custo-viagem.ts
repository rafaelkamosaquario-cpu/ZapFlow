import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_custo_viagem
 *
 * Objetivo: somar todos os custos estimados de uma viagem específica
 * (combustível, pedágio, alimentação, diárias, manutenção proporcional
 * etc.) para chegar ao custo total e ao custo por km daquela viagem.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface CalcularCustoViagemEntrada {
  distanciaTotalKm?: number;
  custoCombustivel?: number;
  custoPedagios?: number;
  custoAlimentacaoDiarias?: number;
  custoManutencaoProporcional?: number;
  outrosCustos?: number;
}

export interface CalcularCustoViagemResultado extends ResultadoFerramentaBase {
  resultados?: {
    custoTotalViagem?: number;
    custoPorKm?: number;
  };
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "distanciaTotalKm", tipo: "number", obrigatorio: true, descricao: "Distância total da viagem, em km." },
  { nome: "custoCombustivel", tipo: "number", obrigatorio: true, descricao: "Custo estimado de combustível para a viagem, em R$." },
  { nome: "custoPedagios", tipo: "number", obrigatorio: false, descricao: "Custo estimado com pedágios, em R$." },
  { nome: "custoAlimentacaoDiarias", tipo: "number", obrigatorio: false, descricao: "Custo estimado com alimentação e diárias, em R$." },
  { nome: "custoManutencaoProporcional", tipo: "number", obrigatorio: false, descricao: "Custo de manutenção proporcional à viagem, em R$." },
  { nome: "outrosCustos", tipo: "number", obrigatorio: false, descricao: "Outros custos não categorizados, em R$." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularCustoViagem(_entrada: CalcularCustoViagemEntrada): CalcularCustoViagemResultado {
  throw new Error("calcularCustoViagem: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularCustoViagem: DefinicaoFerramenta<CalcularCustoViagemEntrada, CalcularCustoViagemResultado> = {
  nome: "calcular_custo_viagem",
  descricao: "Soma os custos estimados de uma viagem específica e calcula o custo total e por km.",
  objetivo: "Consolidar o custo real esperado de uma viagem para embasar decisões de precificação e viabilidade.",
  parametros: PARAMETROS,
  executar: calcularCustoViagem,
};
