import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: calcular_jornada
 *
 * Objetivo: calcular tempos de condução, descanso e jornada do motorista
 * conforme os limites da Lei do Motorista (Lei 13.103/2015), a partir dos
 * horários informados de início de jornada, paradas e condução.
 *
 * Fase atual: apenas estrutura (tipos, parâmetros, contrato). A lógica de
 * cálculo será implementada em etapa futura, com base no módulo de
 * conhecimento "Jornada do Motorista".
 */

export interface CalcularJornadaEntrada {
  /** Horário de início da jornada, formato "HH:mm". */
  horarioInicioJornada?: string;
  /** Tempo total de condução acumulado no dia, em minutos. */
  tempoConducaoAcumuladoMinutos?: number;
  /** Tempo de descanso já realizado no dia, em minutos. */
  tempoDescansoRealizadoMinutos?: number;
}

export interface CalcularJornadaResultado extends ResultadoFerramentaBase {
  resultados?: {
    tempoConducaoDisponivelMinutos?: number;
    tempoDescansoObrigatorioRestanteMinutos?: number;
  };
  classificacao?: "DENTRO_DO_LIMITE" | "PROXIMO_DO_LIMITE" | "LIMITE_EXCEDIDO" | "DADOS_INSUFICIENTES";
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "horarioInicioJornada", tipo: "string", obrigatorio: true, descricao: "Horário de início da jornada, formato HH:mm." },
  { nome: "tempoConducaoAcumuladoMinutos", tipo: "number", obrigatorio: true, descricao: "Tempo total de condução acumulado no dia, em minutos." },
  { nome: "tempoDescansoRealizadoMinutos", tipo: "number", obrigatorio: false, descricao: "Tempo de descanso já realizado no dia, em minutos." },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura final; corpo sera implementado em etapa futura
function calcularJornada(_entrada: CalcularJornadaEntrada): CalcularJornadaResultado {
  throw new Error("calcularJornada: logica ainda nao implementada (etapa de estrutura).");
}

export const ferramentaCalcularJornada: DefinicaoFerramenta<CalcularJornadaEntrada, CalcularJornadaResultado> = {
  nome: "calcular_jornada",
  descricao: "Calcula tempos de condução e descanso do motorista conforme os limites legais da jornada.",
  objetivo: "Alertar sobre limites de condução e descanso obrigatório antes que sejam ultrapassados.",
  parametros: PARAMETROS,
  executar: calcularJornada,
};
