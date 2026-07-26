/**
 * Helpers numéricos e de formatação compartilhados entre as ferramentas de
 * cálculo. Mantém a regra comum a todas elas: nunca arredondar durante os
 * cálculos internos, apenas na saída.
 */

/** Casas decimais usadas por padrão no arredondamento da saída das ferramentas. */
export const CASAS_DECIMAIS_PADRAO = 2;

export function arredondar(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

export function formatarBRL(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}
