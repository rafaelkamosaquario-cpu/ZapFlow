import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: comparar_pneus
 *
 * Objetivo: comparar o custo por quilômetro entre pneu novo e pneu
 * recapado (ou entre duas opções de pneu), considerando preço de compra
 * e vida útil estimada em km.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura.
 */

export interface OpcaoPneu {
  descricao?: string;
  precoUnitario?: number;
  vidaUtilEstimadaKm?: number;
  quantidadeRecapagensEsperadas?: number;
}

export interface CompararPneusEntrada {
  pneuA?: OpcaoPneu;
  pneuB?: OpcaoPneu;
}

export interface CompararPneusResultado extends ResultadoFerramentaBase {
  resultados?: {
    custoPorKmPneuA?: number;
    custoPorKmPneuB?: number;
    diferencaCustoPorKm?: number;
  };
  classificacao?: "PNEU_A_MAIS_ECONOMICO" | "PNEU_B_MAIS_ECONOMICO" | "EQUIVALENTES" | "DADOS_INSUFICIENTES";
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "pneuA", tipo: "string", obrigatorio: true, descricao: "Dados da primeira opção de pneu (preço, vida útil em km)." },
  { nome: "pneuB", tipo: "string", obrigatorio: true, descricao: "Dados da segunda opção de pneu (preço, vida útil em km)." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function compararPneus(_entrada: CompararPneusEntrada): CompararPneusResultado {
  throw new Error("compararPneus: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCompararPneus: DefinicaoFerramenta<CompararPneusEntrada, CompararPneusResultado> = {
  nome: "comparar_pneus",
  descricao: "Compara o custo por quilômetro entre duas opções de pneu (ex.: novo vs. recapado).",
  objetivo: "Apoiar a decisão de compra de pneus com base no custo por km, não apenas no preço de compra.",
  parametros: PARAMETROS,
  executar: compararPneus,
};
