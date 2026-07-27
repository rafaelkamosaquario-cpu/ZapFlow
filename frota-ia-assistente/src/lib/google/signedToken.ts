import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getGoogleCalendarConfig } from "./config";

/**
 * Tokens assinados (HMAC-SHA256) de curta duração, sem estado no servidor.
 * Usados para o parâmetro `state` do OAuth (proteção CSRF) e para o link
 * seguro de conexão enviado pelo WhatsApp (identifica o usuário sem exigir
 * uma sessão de navegador ativa). GOOGLE_CALENDAR_ENCRYPTION_KEY assina —
 * o refresh token em si é protegido separadamente pelo Supabase Vault
 * (ver migration create_google_calendar_vault), não por esta chave.
 */

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload: string): string {
  const { GOOGLE_CALENDAR_ENCRYPTION_KEY } = getGoogleCalendarConfig();
  return createHmac("sha256", GOOGLE_CALENDAR_ENCRYPTION_KEY).update(payload).digest("base64url");
}

export class InvalidSignedTokenError extends Error {
  constructor(reason: string) {
    super(`Token inválido: ${reason}`);
    this.name = "InvalidSignedTokenError";
  }
}

export function createSignedToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = base64UrlEncode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifySignedToken<T extends Record<string, unknown>>(token: string): T {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new InvalidSignedTokenError("formato inesperado.");

  const expectedSignature = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidSignedTokenError("assinatura não confere.");
  }

  const parsed = JSON.parse(base64UrlDecode(body)) as T & { exp: number };

  if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new InvalidSignedTokenError("expirado.");
  }

  return parsed;
}
