import "server-only";

/**
 * Configuração da transcrição de áudio (OpenAI). Único uso da OpenAI no
 * projeto — transformar áudio recebido no WhatsApp em texto, nada além
 * disso. O "cérebro" (entender a mensagem, escolher ferramenta, calcular,
 * responder) continua sendo inteiramente a Claude — ver
 * docs/camada-6-whatsapp-v1.md (Fase K) para o racional dessa divisão.
 */

const REQUIRED_VARS = ["OPENAI_API_KEY"] as const;

export type WhisperConfig = Record<(typeof REQUIRED_VARS)[number], string>;

export class WhisperConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Configuração da transcrição de áudio incompleta. Variáveis ausentes: ${missing.join(", ")}.`);
    this.name = "WhisperConfigError";
  }
}

export function getWhisperConfig(): WhisperConfig {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new WhisperConfigError(missing);
  return Object.fromEntries(REQUIRED_VARS.map((name) => [name, process.env[name] as string])) as WhisperConfig;
}

/** Só checa disponibilidade, sem lançar — para o webhook explicar a limitação em vez de quebrar. */
export function isWhisperConfigured(): boolean {
  return REQUIRED_VARS.every((name) => Boolean(process.env[name]));
}
