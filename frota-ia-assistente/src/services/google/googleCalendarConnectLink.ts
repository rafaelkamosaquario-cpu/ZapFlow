import "server-only";
import { createSignedToken, verifySignedToken } from "@/lib/google/signedToken";
import { getGoogleCalendarConfig } from "@/lib/google/config";

/**
 * Link seguro de conexão, para enviar pelo WhatsApp quando a Agenda não
 * está conectada. Não carrega nenhum segredo — só identifica o usuário
 * (assinado, expira em 15 minutos) para a rota /auth/calendar/connect
 * poder iniciar o OAuth sem exigir uma sessão de navegador já aberta.
 */

const LINK_TTL_SECONDS = 15 * 60;

export interface ConnectLinkPayload extends Record<string, unknown> {
  userId: string;
  companyId: string | null;
}

export function buildSecureConnectLink(userId: string, companyId: string | null): string {
  const { APP_URL } = getGoogleCalendarConfig();
  const link = createSignedToken({ userId, companyId }, LINK_TTL_SECONDS);
  return `${APP_URL}/auth/calendar/connect?link=${encodeURIComponent(link)}`;
}

export function verifyConnectLink(link: string): ConnectLinkPayload {
  return verifySignedToken<ConnectLinkPayload>(link);
}
