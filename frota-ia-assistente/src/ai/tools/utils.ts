/**
 * Helpers numéricos e de formatação compartilhados entre as ferramentas de
 * cálculo. Mantém a regra comum a todas elas: nunca arredondar durante os
 * cálculos internos, apenas na saída.
 */

/** Casas decimais usadas por padrão no arredondamento da saída das ferramentas. */
export const CASAS_DECIMAIS_PADRAO = 2;

/**
 * Casas decimais padrão por tipo de grandeza, para ferramentas que
 * diferenciam moeda/CPK/percentual/etc. (ex.: `comparar_pneus`,
 * `calcular_custo_viagem`). Cada ferramenta pode ter suas próprias
 * constantes adicionais (ex.: casas de CPK, de km, de peso) quando o
 * valor padrão difere entre elas.
 */
export const CASAS_DECIMAIS_MOEDA_PADRAO = 2;
export const CASAS_DECIMAIS_PERCENTUAL_PADRAO = 2;

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
