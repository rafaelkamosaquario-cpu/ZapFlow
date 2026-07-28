import "server-only";
import { getWhatsappConfig } from "./config";

/**
 * Cliente mínimo para a API REST do Z-API — só o envio de texto, sem
 * dependência da lib oficial (mesmo padrão de chamada HTTP direta usado em
 * src/lib/google/calendarClient.ts). Cada mensagem enviada é best-effort:
 * quem chama decide o que fazer se o envio falhar (normalmente logar e
 * seguir, nunca travar o processamento da mensagem recebida por causa
 * disso).
 */

export class ZApiRequestError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Z-API respondeu ${status} ao enviar mensagem.`);
    this.name = "ZApiRequestError";
  }
}

/** Z-API espera o telefone em dígitos, com DDI, sem "+" nem formatação. */
function normalizePhone(phoneE164: string): string {
  return phoneE164.replace(/\D/g, "");
}

export async function sendWhatsappText(phoneE164: string, message: string): Promise<void> {
  const { ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN } = getWhatsappConfig();

  const response = await fetch(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_INSTANCE_TOKEN}/send-text`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify({ phone: normalizePhone(phoneE164), message }),
    }
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new ZApiRequestError(response.status, bodyText);
  }
}
