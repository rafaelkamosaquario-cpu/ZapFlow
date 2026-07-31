/**
 * Registro central das ferramentas internas do Frota IA.
 *
 * Cada ferramenta segue o contrato de `DefinicaoFerramenta` (ver types.ts).
 * `FERRAMENTAS_FROTA_IA` reúne todas elas para uso futuro pelo mecanismo de
 * integração com o Claude (tool use) — ver README.md desta pasta para o
 * estado atual dessa integração.
 *
 * As 11 ferramentas de cálculo da primeira sequência —
 * `calcular_combustivel`, `calcular_cpk`, `comparar_pneus`,
 * `calcular_custo_viagem`, `calcular_margem`, `analisar_frete`,
 * `calcular_valor_minimo_frete`, `calcular_receita_km`,
 * `calcular_custo_dia`, `calcular_custo_veiculo_parado` e
 * `calcular_jornada` — têm a lógica implementada (ver README). A partir da
 * Camada 4, `gerenciar_google_calendar` (integração externa) também está
 * registrada aqui.
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
export * from "./gerenciar-google-calendar";
export * from "./consultar-historico";
export * from "./gerenciar-alerta";
export * from "./gerar-documento";
export * from "./verificar-piso-minimo-antt";
export * from "./consultar-rota";
export * from "./registrar-despesa";

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
import { ferramentaGerenciarGoogleCalendar } from "./gerenciar-google-calendar";
import { ferramentaConsultarHistorico } from "./consultar-historico";
import { ferramentaGerenciarAlerta } from "./gerenciar-alerta";
import { ferramentaGerarDocumento } from "./gerar-documento";
import { ferramentaVerificarPisoMinimoAntt } from "./verificar-piso-minimo-antt";
import { ferramentaConsultarRota } from "./consultar-rota";
import { ferramentaRegistrarDespesa } from "./registrar-despesa";
import type { DefinicaoFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Todas as ferramentas internas do Frota IA, na ordem em que aparecem na
 * pasta. As 11 primeiras — `calcular_combustivel`, `calcular_cpk`,
 * `comparar_pneus`, `calcular_custo_viagem`, `calcular_margem`,
 * `analisar_frete`, `calcular_valor_minimo_frete`, `calcular_receita_km`,
 * `calcular_custo_dia`, `calcular_custo_veiculo_parado` e
 * `calcular_jornada` — são puras (sem I/O). A partir da Camada 4,
 * `gerenciar_google_calendar` é a primeira ferramenta de integração externa
 * (I/O real com Google + Supabase, `executar` assíncrona — ver types.ts).
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
  ferramentaGerenciarGoogleCalendar,
  ferramentaConsultarHistorico,
  ferramentaGerenciarAlerta,
  ferramentaGerarDocumento,
  ferramentaVerificarPisoMinimoAntt,
  ferramentaConsultarRota,
  ferramentaRegistrarDespesa,
];
