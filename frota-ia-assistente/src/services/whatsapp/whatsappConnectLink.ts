import "server-only";
import { createSignedToken, verifySignedToken } from "@/lib/security/signedToken";
import { getWhatsappConfig } from "@/lib/whatsapp/config";

/**
 * Link seguro de vínculo, enviado pelo WhatsApp quando o número que
 * mandou mensagem ainda não está ligado a nenhuma conta. Não carrega
 * nenhum segredo — só identifica o telefone (assinado, expira em 15
 * minutos) para a rota /auth/whatsapp/connect poder confirmar o vínculo
 * assim que o usuário abrir o link já logado no navegador.
 */

const LINK_TTL_SECONDS = 15 * 60;

export interface WhatsappConnectLinkPayload extends Record<string, unknown> {
  phoneE164: string;
  displayName?: string;
}

export function buildWhatsappConnectLink(phoneE164: string, displayName?: string): string {
  const { APP_URL, WHATSAPP_WEBHOOK_SECRET } = getWhatsappConfig();
  const link = createSignedToken({ phoneE164, displayName }, LINK_TTL_SECONDS, WHATSAPP_WEBHOOK_SECRET);
  return `${APP_URL}/auth/whatsapp/connect?link=${encodeURIComponent(link)}`;
}

export function verifyWhatsappConnectLink(link: string): WhatsappConnectLinkPayload {
  const { WHATSAPP_WEBHOOK_SECRET } = getWhatsappConfig();
  return verifySignedToken<WhatsappConnectLinkPayload>(link, WHATSAPP_WEBHOOK_SECRET);
}
