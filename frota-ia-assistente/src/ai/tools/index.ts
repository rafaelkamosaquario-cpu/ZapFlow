/**
 * Registro central das ferramentas internas do Frota IA.
 *
 * Cada ferramenta segue o contrato de `DefinicaoFerramenta` (ver types.ts).
 * `FERRAMENTAS_FROTA_IA` reúne todas elas para uso futuro pelo mecanismo de
 * integração com o Claude (tool use) — ver README.md desta pasta para o
 * estado atual dessa integração.
 *
 * `calcular_combustivel`, `calcular_cpk`, `comparar_pneus`,
 * `calcular_custo_viagem`, `calcular_margem`, `analisar_frete` e
 * `calcular_valor_minimo_frete` têm a lógica de cálculo implementada — as
 * demais expõem apenas a estrutura (ver README).
 */

export * from "./types";
export * from "./utils";

export * from "./analisar-frete";
export * from "./calcular-combustivel";
export * from "./calcular-cpk";
export * from "./comparar-pneus";
export * from "./calcular-custo-viagem";
export * from "./calcular-margem";
export * from "./calcular-valor-minimo-frete";
export * from "./calcular-receita-km";
export * from "./calcular-custo-dia";
export * from "./calcular-custo-veiculo-parado";
export * from "./calcular-jornada";

import { ferramentaAnalisarFrete } from "./analisar-frete";
import { ferramentaCalcularCombustivel } from "./calcular-combustivel";
import { ferramentaCalcularCpk } from "./calcular-cpk";
import { ferramentaCompararPneus } from "./comparar-pneus";
import { ferramentaCalcularCustoViagem } from "./calcular-custo-viagem";
import { ferramentaCalcularMargem } from "./calcular-margem";
import { ferramentaCalcularValorMinimoFrete } from "./calcular-valor-minimo-frete";
import { ferramentaCalcularReceitaKm } from "./calcular-receita-km";
import { ferramentaCalcularCustoDia } from "./calcular-custo-dia";
import { ferramentaCalcularCustoVeiculoParado } from "./calcular-custo-veiculo-parado";
import { ferramentaCalcularJornada } from "./calcular-jornada";
import type { DefinicaoFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Todas as ferramentas internas do Frota IA, na ordem em que aparecem na
 * pasta. `calcular_combustivel`, `calcular_cpk`, `comparar_pneus`,
 * `calcular_custo_viagem`, `calcular_margem`, `analisar_frete` e
 * `calcular_valor_minimo_frete` têm a lógica de cálculo implementada — as
 * demais expõem apenas a estrutura (ver README).
 */
export const FERRAMENTAS_FROTA_IA: ReadonlyArray<DefinicaoFerramenta<never, ResultadoFerramentaBase>> = [
  ferramentaAnalisarFrete,
  ferramentaCalcularCombustivel,
  ferramentaCalcularCpk,
  ferramentaCompararPneus,
  ferramentaCalcularCustoViagem,
  ferramentaCalcularMargem,
  ferramentaCalcularValorMinimoFrete,
  ferramentaCalcularReceitaKm,
  ferramentaCalcularCustoDia,
  ferramentaCalcularCustoVeiculoParado,
  ferramentaCalcularJornada,
];
