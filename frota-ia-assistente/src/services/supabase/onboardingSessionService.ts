import { toJson } from "@/lib/supabase/json";
import type { OnboardingSessionRow, OnboardingState } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

/**
 * Estado do onboarding conversacional (Camada 6, WhatsApp-first). Uma
 * pergunta por vez — collected_data é só rascunho até o estado virar
 * 'completed', quando os dados reais vão para companies/vehicles via os
 * services já existentes (companyService.createCompanyWithOwner,
 * vehicleService.createVehicle).
 */

export async function getOnboardingSession(
  client: SupabaseDbClient,
  userId: string
): Promise<OnboardingSessionRow | null> {
  const { data, error } = await client.from("onboarding_sessions").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createOnboardingSession(
  client: SupabaseDbClient,
  userId: string,
  state: OnboardingState = "awaiting_name"
): Promise<OnboardingSessionRow> {
  const { data, error } = await client
    .from("onboarding_sessions")
    .insert({ user_id: userId, channel: "whatsapp", state })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateOnboardingSession(
  client: SupabaseDbClient,
  userId: string,
  updates: { state?: OnboardingState; collectedData?: Record<string, unknown> }
): Promise<OnboardingSessionRow> {
  const { data, error } = await client
    .from("onboarding_sessions")
    .update({
      ...(updates.state ? { state: updates.state } : {}),
      ...(updates.collectedData ? { collected_data: toJson(updates.collectedData) } : {}),
    })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
