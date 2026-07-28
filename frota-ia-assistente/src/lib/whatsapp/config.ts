import "server-only";

/**
 * Configuração da integração WhatsApp (Z-API) do Frota IA. Instância e
 * número próprios, isolados do ZapFlow (o outro app deste repositório, que
 * tem sua própria instância Z-API e não compartilha nada com este módulo).
 */

const REQUIRED_VARS = [
  "ZAPI_INSTANCE_ID",
  "ZAPI_INSTANCE_TOKEN",
  "ZAPI_CLIENT_TOKEN",
  "WHATSAPP_WEBHOOK_SECRET",
  "APP_URL",
] as const;

export type WhatsappConfig = Record<(typeof REQUIRED_VARS)[number], string>;

export class WhatsappConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Configuração do WhatsApp incompleta. Variáveis ausentes: ${missing.join(", ")}.`);
    this.name = "WhatsappConfigError";
  }
}

/** Lança WhatsappConfigError (nunca o valor da variável) se algo estiver faltando. */
export function getWhatsappConfig(): WhatsappConfig {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new WhatsappConfigError(missing);
  }

  return Object.fromEntries(REQUIRED_VARS.map((name) => [name, process.env[name] as string])) as WhatsappConfig;
}

/** Só checa disponibilidade, sem lançar. */
export function isWhatsappConfigured(): boolean {
  return REQUIRED_VARS.every((name) => Boolean(process.env[name]));
}
