import "server-only";
import {
  createSignedToken as createGenericSignedToken,
  verifySignedToken as verifyGenericSignedToken,
  InvalidSignedTokenError,
} from "@/lib/security/signedToken";
import { getGoogleCalendarConfig } from "./config";

/**
 * Tokens assinados (HMAC-SHA256) de curta duração, sem estado no servidor.
 * Usados para o parâmetro `state` do OAuth (proteção CSRF) e para o link
 * seguro de conexão da Agenda enviado pelo WhatsApp (identifica o usuário
 * sem exigir uma sessão de navegador ativa). GOOGLE_CALENDAR_ENCRYPTION_KEY
 * assina — o refresh token em si é protegido separadamente pelo Supabase
 * Vault (ver migration create_google_calendar_vault), não por esta chave.
 *
 * Wrapper fino sobre a implementação genérica em src/lib/security —
 * mantém a mesma assinatura pública de antes (sem segredo explícito) para
 * não quebrar os chamadores já existentes desta Camada 4.
 */

export { InvalidSignedTokenError };

export function createSignedToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const { GOOGLE_CALENDAR_ENCRYPTION_KEY } = getGoogleCalendarConfig();
  return createGenericSignedToken(payload, ttlSeconds, GOOGLE_CALENDAR_ENCRYPTION_KEY);
}

export function verifySignedToken<T extends Record<string, unknown>>(token: string): T {
  const { GOOGLE_CALENDAR_ENCRYPTION_KEY } = getGoogleCalendarConfig();
  return verifyGenericSignedToken<T>(token, GOOGLE_CALENDAR_ENCRYPTION_KEY);
}
