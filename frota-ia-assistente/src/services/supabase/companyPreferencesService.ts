import { companyPreferencesUpdateSchema } from "@/lib/validation/schemas";
import type { CompanyPreferencesRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

/** Cria a linha de preferências (valores padrão) se ainda não existir. */
export async function getOrCreatePreferences(
  client: SupabaseDbClient,
  companyId: string
): Promise<CompanyPreferencesRow> {
  const { data: existing, error: selectError } = await client
    .from("company_preferences")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await client
    .from("company_preferences")
    .insert({ company_id: companyId })
    .select("*")
    .single();

  if (insertError) throw insertError;
  return created;
}

export async function updatePreferences(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: unknown
): Promise<CompanyPreferencesRow> {
  const parsed = companyPreferencesUpdateSchema.parse(input);

  const { data, error } = await client
    .from("company_preferences")
    .update({
      default_vehicle_id: parsed.defaultVehicleId,
      default_fuel_type: parsed.defaultFuelType,
      default_fuel_price: parsed.defaultFuelPrice,
      default_average_speed_kmh: parsed.defaultAverageSpeedKmh,
      default_target_margin_percent: parsed.defaultTargetMarginPercent,
      default_currency: parsed.defaultCurrency,
      distance_unit: parsed.distanceUnit,
      preferred_response_style: parsed.preferredResponseStyle,
      ask_before_saving_memory: parsed.askBeforeSavingMemory,
      allow_automatic_memory: parsed.allowAutomaticMemory,
      allow_analysis_history: parsed.allowAnalysisHistory,
      allow_tool_history: parsed.allowToolHistory,
      updated_by: userId,
    })
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
