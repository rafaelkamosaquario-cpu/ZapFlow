import type { ScheduledAlertRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export interface CreateAlertInput {
  companyId: string;
  userId: string;
  conversationId?: string;
  vehicleId?: string;
  title: string;
  notes?: string;
  category?: string;
  /** ISO 8601 com offset — sempre absoluto, resolvido antes de chegar aqui. */
  scheduledFor: string;
}

export async function createAlert(client: SupabaseDbClient, input: CreateAlertInput): Promise<ScheduledAlertRow> {
  const { data, error } = await client
    .from("scheduled_alerts")
    .insert({
      company_id: input.companyId,
      user_id: input.userId,
      conversation_id: input.conversationId,
      vehicle_id: input.vehicleId,
      title: input.title,
      notes: input.notes,
      category: input.category,
      scheduled_for: input.scheduledFor,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function listUpcomingAlerts(
  client: SupabaseDbClient,
  companyId: string,
  limit = 10
): Promise<ScheduledAlertRow[]> {
  const { data, error } = await client
    .from("scheduled_alerts")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function cancelAlert(client: SupabaseDbClient, alertId: string, companyId: string): Promise<void> {
  const { error } = await client
    .from("scheduled_alerts")
    .update({ status: "cancelled" })
    .eq("id", alertId)
    .eq("company_id", companyId)
    .eq("status", "pending");

  if (error) throw error;
}

/** Alertas pendentes com scheduled_for já vencido — usado pelo job de disparo. */
export async function listDueAlerts(client: SupabaseDbClient, limit = 50): Promise<ScheduledAlertRow[]> {
  const { data, error } = await client
    .from("scheduled_alerts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function markAlertSent(client: SupabaseDbClient, alertId: string): Promise<void> {
  const { error } = await client
    .from("scheduled_alerts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", alertId);

  if (error) throw error;
}

export async function markAlertFailed(client: SupabaseDbClient, alertId: string, errorMessageSafe: string): Promise<void> {
  const { error } = await client
    .from("scheduled_alerts")
    .update({ status: "failed", error_message_safe: errorMessageSafe })
    .eq("id", alertId);

  if (error) throw error;
}
