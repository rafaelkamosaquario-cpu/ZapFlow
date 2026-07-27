import type { CalendarActionLogInsert, GoogleIntegrationRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function getGoogleIntegration(
  client: SupabaseDbClient,
  userId: string
): Promise<GoogleIntegrationRow | null> {
  const { data, error } = await client
    .from("google_integrations")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Cria ou atualiza o metadado (não sensível) da conexão Google. NUNCA
 * recebe/grava access_token ou refresh_token — essa tabela não tem coluna
 * para isso (ver migration 4 e a documentação da Camada 3).
 */
export async function upsertGoogleIntegrationStatus(
  client: SupabaseDbClient,
  userId: string,
  companyId: string | null,
  googleAccountEmail: string,
  input: Partial<
    Pick<
      GoogleIntegrationRow,
      "google_subject_id" | "calendar_enabled" | "default_calendar_id" | "granted_scopes" | "connection_status" | "token_expires_at"
    >
  >
): Promise<GoogleIntegrationRow> {
  const { data, error } = await client
    .from("google_integrations")
    .upsert(
      {
        user_id: userId,
        company_id: companyId,
        google_account_email: googleAccountEmail,
        ...input,
      },
      { onConflict: "user_id,google_account_email" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function recordCalendarAction(
  client: SupabaseDbClient,
  input: CalendarActionLogInsert
): Promise<void> {
  const { error } = await client.from("calendar_action_logs").insert(input);
  if (error) throw error;
}
