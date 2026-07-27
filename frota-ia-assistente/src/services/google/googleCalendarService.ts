import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleIntegration, recordCalendarAction, upsertGoogleIntegrationStatus } from "@/services/supabase/googleIntegrationService";
import { getValidAccessToken, revokeAndDeleteToken, saveRefreshToken, GoogleCalendarNotConnectedError } from "./googleCalendarTokenService";
import {
  GoogleCalendarApiError,
  deleteEvent as apiDeleteEvent,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  getEvent as apiGetEvent,
  insertEvent,
  listCalendarList,
  listEvents,
  patchEvent,
  type EventInput,
  type GoogleCalendarEvent,
  type GoogleCalendarListEntry,
} from "@/lib/google/calendarClient";
import type { SupabaseDbClient } from "@/services/supabase/types";
import type { CalendarActionLogInsert, GoogleIntegrationRow } from "@/lib/supabase/tables";

export { GoogleCalendarNotConnectedError, GoogleCalendarApiError };

/**
 * Serviço centralizado da integração Google Calendar. Nenhum outro módulo
 * deve chamar `@/lib/google/calendarClient` diretamente — sempre por aqui,
 * para que autenticação, log em calendar_action_logs e tratamento de erro
 * fiquem em um único lugar.
 */

async function requireConnectedIntegration(admin: SupabaseDbClient, userId: string): Promise<GoogleIntegrationRow> {
  const integration = await getGoogleIntegration(admin, userId);
  if (!integration || integration.connection_status !== "connected") {
    throw new GoogleCalendarNotConnectedError();
  }
  return integration;
}

function resolveCalendarId(integration: GoogleIntegrationRow, calendarId?: string): string {
  return calendarId ?? integration.default_calendar_id ?? "primary";
}

async function logAction(
  admin: SupabaseDbClient,
  input: Omit<CalendarActionLogInsert, "id" | "created_at">
): Promise<void> {
  try {
    await recordCalendarAction(admin, input);
  } catch {
    // Registrar o log nunca deve derrubar a ação em si (o evento já foi
    // criado/alterado/excluído de verdade no Google quando chegamos aqui).
  }
}

// ── conexão ──────────────────────────────────────────────────────────────

export interface ConnectGoogleCalendarInput {
  userId: string;
  companyId: string | null;
  code: string;
}

export async function connectGoogleCalendar(input: ConnectGoogleCalendarInput): Promise<GoogleIntegrationRow> {
  const admin = createAdminClient();
  const tokens = await exchangeCodeForTokens(input.code);

  if (!tokens.refreshToken) {
    throw new Error(
      "O Google não devolveu um refresh token. Isso acontece quando o consentimento já tinha sido concedido antes sem ser revogado — desconecte e conecte novamente."
    );
  }

  const userInfo = await fetchGoogleUserInfo(tokens.accessToken);

  const integration = await upsertGoogleIntegrationStatus(admin, input.userId, input.companyId, userInfo.email, {
    google_subject_id: userInfo.subjectId,
    granted_scopes: tokens.scope.split(" ").filter(Boolean),
    connection_status: "connected",
    calendar_enabled: true,
    token_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
  });

  await saveRefreshToken(admin, integration.id, tokens.refreshToken);

  return integration;
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  const admin = createAdminClient();
  const integration = await getGoogleIntegration(admin, userId);
  if (!integration) return;
  await revokeAndDeleteToken(admin, integration.id);
}

export async function refreshGoogleAccessToken(userId: string): Promise<string> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, userId);
  return getValidAccessToken(admin, integration.id);
}

export interface CalendarConnectionStatus {
  connected: boolean;
  email: string | null;
  defaultCalendarId: string | null;
  scopes: string[];
  lastSyncedAt: string | null;
}

export async function checkCalendarConnection(userId: string): Promise<CalendarConnectionStatus> {
  const admin = createAdminClient();
  const integration = await getGoogleIntegration(admin, userId);

  if (!integration) {
    return { connected: false, email: null, defaultCalendarId: null, scopes: [], lastSyncedAt: null };
  }

  return {
    connected: integration.connection_status === "connected",
    email: integration.google_account_email,
    defaultCalendarId: integration.default_calendar_id,
    scopes: integration.granted_scopes ?? [],
    lastSyncedAt: integration.last_synced_at,
  };
}

// ── calendário padrão ────────────────────────────────────────────────────

export async function listCalendars(userId: string): Promise<GoogleCalendarListEntry[]> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, userId);
  const accessToken = await getValidAccessToken(admin, integration.id);
  return listCalendarList(accessToken);
}

export async function getDefaultCalendar(userId: string): Promise<string> {
  const admin = createAdminClient();
  const integration = await getGoogleIntegration(admin, userId);
  return integration?.default_calendar_id ?? "primary";
}

export async function setDefaultCalendar(userId: string, calendarId: string): Promise<void> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, userId);

  const { error } = await admin
    .from("google_integrations")
    .update({ default_calendar_id: calendarId })
    .eq("id", integration.id);

  if (error) throw error;
}

// ── consulta ─────────────────────────────────────────────────────────────

export interface ListUpcomingEventsInput {
  userId: string;
  calendarId?: string;
  from?: string;
  to?: string;
  maxResults?: number;
  query?: string;
}

export async function listUpcomingEvents(
  input: ListUpcomingEventsInput
): Promise<{ items: GoogleCalendarEvent[]; nextPageToken?: string; calendarId: string }> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, input.userId);
  const accessToken = await getValidAccessToken(admin, integration.id);
  const calendarId = resolveCalendarId(integration, input.calendarId);

  const result = await listEvents(accessToken, calendarId, {
    timeMin: input.from ?? new Date().toISOString(),
    timeMax: input.to,
    maxResults: input.maxResults,
    query: input.query,
  });

  return { ...result, calendarId };
}

export interface GetEventInput {
  userId: string;
  calendarId?: string;
  eventId: string;
}

export async function getEvent(input: GetEventInput): Promise<GoogleCalendarEvent> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, input.userId);
  const accessToken = await getValidAccessToken(admin, integration.id);
  return apiGetEvent(accessToken, resolveCalendarId(integration, input.calendarId), input.eventId);
}

// ── criação, alteração e exclusão ───────────────────────────────────────

export interface CreateEventInput {
  userId: string;
  companyId: string;
  calendarId?: string;
  title: string;
  startIso: string;
  endIso: string;
  timezone: string;
  description?: string;
  location?: string;
  conversationId?: string;
}

export async function createEvent(input: CreateEventInput): Promise<GoogleCalendarEvent> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, input.userId);
  const accessToken = await getValidAccessToken(admin, integration.id);
  const calendarId = resolveCalendarId(integration, input.calendarId);

  const eventBody: EventInput = {
    summary: input.title,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startIso, timeZone: input.timezone },
    end: { dateTime: input.endIso, timeZone: input.timezone },
  };

  let created: GoogleCalendarEvent | undefined;
  let status: "success" | "failed" = "success";
  let errorCode: string | undefined;

  try {
    created = await insertEvent(accessToken, calendarId, eventBody);
    return created;
  } catch (err) {
    status = "failed";
    errorCode = err instanceof GoogleCalendarApiError ? err.code : "UNKNOWN_ERROR";
    throw err;
  } finally {
    await logAction(admin, {
      user_id: input.userId,
      company_id: input.companyId,
      conversation_id: input.conversationId,
      google_integration_id: integration.id,
      external_event_id: created?.id,
      action_type: "create",
      event_title: input.title,
      event_start: input.startIso,
      event_end: input.endIso,
      timezone: input.timezone,
      status,
      error_code: errorCode,
    });
  }
}

export interface UpdateEventInput {
  userId: string;
  companyId: string;
  calendarId?: string;
  eventId: string;
  title?: string;
  startIso?: string;
  endIso?: string;
  timezone?: string;
  description?: string;
  location?: string;
  conversationId?: string;
}

export async function updateEvent(input: UpdateEventInput): Promise<GoogleCalendarEvent> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, input.userId);
  const accessToken = await getValidAccessToken(admin, integration.id);
  const calendarId = resolveCalendarId(integration, input.calendarId);

  const patch: Partial<EventInput> = {
    summary: input.title,
    description: input.description,
    location: input.location,
  };

  if (input.startIso) patch.start = { dateTime: input.startIso, timeZone: input.timezone };
  if (input.endIso) patch.end = { dateTime: input.endIso, timeZone: input.timezone };

  let updated: GoogleCalendarEvent | undefined;
  let status: "success" | "failed" = "success";
  let errorCode: string | undefined;

  try {
    updated = await patchEvent(accessToken, calendarId, input.eventId, patch);
    return updated;
  } catch (err) {
    status = "failed";
    errorCode = err instanceof GoogleCalendarApiError ? err.code : "UNKNOWN_ERROR";
    throw err;
  } finally {
    await logAction(admin, {
      user_id: input.userId,
      company_id: input.companyId,
      conversation_id: input.conversationId,
      google_integration_id: integration.id,
      external_event_id: input.eventId,
      action_type: "update",
      event_title: input.title,
      event_start: input.startIso,
      event_end: input.endIso,
      timezone: input.timezone,
      status,
      error_code: errorCode,
    });
  }
}

export interface DeleteEventInput {
  userId: string;
  companyId: string;
  calendarId?: string;
  eventId: string;
  conversationId?: string;
}

/**
 * Exclui um evento. Não pede confirmação aqui — a confirmação explícita
 * (regra da seção 6/9 do módulo) é responsabilidade da camada de IA antes
 * de chamar esta função, via o campo `confirmation` da ferramenta interna.
 */
export async function deleteEvent(input: DeleteEventInput): Promise<void> {
  const admin = createAdminClient();
  const integration = await requireConnectedIntegration(admin, input.userId);
  const accessToken = await getValidAccessToken(admin, integration.id);
  const calendarId = resolveCalendarId(integration, input.calendarId);

  let status: "success" | "failed" = "success";
  let errorCode: string | undefined;

  try {
    await apiDeleteEvent(accessToken, calendarId, input.eventId);
  } catch (err) {
    status = "failed";
    errorCode = err instanceof GoogleCalendarApiError ? err.code : "UNKNOWN_ERROR";
    throw err;
  } finally {
    await logAction(admin, {
      user_id: input.userId,
      company_id: input.companyId,
      conversation_id: input.conversationId,
      google_integration_id: integration.id,
      external_event_id: input.eventId,
      action_type: "delete",
      status,
      error_code: errorCode,
    });
  }
}
