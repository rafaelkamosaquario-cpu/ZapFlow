import "server-only";
import { GOOGLE_CALENDAR_SCOPES, getGoogleCalendarConfig } from "./config";

/**
 * Único ponto de chamada direta à API do Google (OAuth + Calendar v3), via
 * fetch — sem a dependência pesada `googleapis`. Nenhum outro arquivo deve
 * chamar `accounts.google.com`/`googleapis.com` diretamente.
 */

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export class GoogleCalendarApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "GoogleCalendarApiError";
  }
}

/** Nunca inclui corpo da resposta do Google na mensagem — pode conter dados da conta do usuário. */
async function parseErrorSafely(response: Response): Promise<never> {
  throw new GoogleCalendarApiError(
    "Falha na comunicação com o Google Calendar.",
    response.status,
    `HTTP_${response.status}`
  );
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
}

export function buildAuthorizationUrl(state: string): string {
  const { GOOGLE_CLIENT_ID, GOOGLE_CALENDAR_REDIRECT_URI } = getGoogleCalendarConfig();

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALENDAR_REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state,
  });

  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI } = getGoogleCalendarConfig();

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_CALENDAR_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) return parseErrorSafely(response);

  const body = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in, scope: body.scope };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getGoogleCalendarConfig();

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) return parseErrorSafely(response);

  const body = (await response.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch(GOOGLE_OAUTH_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });

  // O Google retorna 200 mesmo se o token já estava inválido/expirado — só
  // tratamos como erro real problemas de rede/servidor (5xx) ou 400 puro.
  if (!response.ok && response.status !== 400) return parseErrorSafely(response);
}

export interface GoogleUserInfo {
  email: string;
  subjectId: string;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return parseErrorSafely(response);

  const body = (await response.json()) as { email: string; id: string };
  return { email: body.email, subjectId: body.id };
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
  accessRole: string;
}

export async function listCalendarList(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=writer`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return parseErrorSafely(response);

  const body = (await response.json()) as { items?: GoogleCalendarListEntry[] };
  return body.items ?? [];
}

export interface GoogleCalendarEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleCalendarEventDateTime;
  end: GoogleCalendarEventDateTime;
  htmlLink?: string;
}

export interface ListEventsParams {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  query?: string;
  pageToken?: string;
}

export async function listEvents(
  accessToken: string,
  calendarId: string,
  params: ListEventsParams = {}
): Promise<{ items: GoogleCalendarEvent[]; nextPageToken?: string }> {
  const search = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.min(params.maxResults ?? 20, 50)),
  });

  if (params.timeMin) search.set("timeMin", params.timeMin);
  if (params.timeMax) search.set("timeMax", params.timeMax);
  if (params.query) search.set("q", params.query);
  if (params.pageToken) search.set("pageToken", params.pageToken);

  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${search}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return parseErrorSafely(response);

  const body = (await response.json()) as { items?: GoogleCalendarEvent[]; nextPageToken?: string };
  return { items: body.items ?? [], nextPageToken: body.nextPageToken };
}

export async function getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleCalendarEvent> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 404) throw new GoogleCalendarApiError("Evento não encontrado.", 404, "EVENT_NOT_FOUND");
  if (!response.ok) return parseErrorSafely(response);

  return (await response.json()) as GoogleCalendarEvent;
}

export interface EventInput {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleCalendarEventDateTime;
  end: GoogleCalendarEventDateTime;
}

export async function insertEvent(accessToken: string, calendarId: string, event: EventInput): Promise<GoogleCalendarEvent> {
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  if (!response.ok) return parseErrorSafely(response);
  return (await response.json()) as GoogleCalendarEvent;
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Partial<EventInput>
): Promise<GoogleCalendarEvent> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );

  if (response.status === 404) throw new GoogleCalendarApiError("Evento não encontrado.", 404, "EVENT_NOT_FOUND");
  if (!response.ok) return parseErrorSafely(response);
  return (await response.json()) as GoogleCalendarEvent;
}

export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // 410 Gone = já estava excluído; tratamos como sucesso (idempotente).
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    return parseErrorSafely(response);
  }
}
