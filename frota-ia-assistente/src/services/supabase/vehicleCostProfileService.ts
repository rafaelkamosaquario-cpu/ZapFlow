import { vehicleCostProfileCreateSchema } from "@/lib/validation/schemas";
import type { VehicleCostProfileRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

/** Perfil de custo ATIVO vigente hoje para o veículo, se houver. */
export async function getActiveCostProfile(
  client: SupabaseDbClient,
  vehicleId: string
): Promise<VehicleCostProfileRow | null> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await client
    .from("vehicle_cost_profiles")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .eq("active", true)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createCostProfile(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: unknown
): Promise<VehicleCostProfileRow> {
  const parsed = vehicleCostProfileCreateSchema.parse(input);

  const { data, error } = await client
    .from("vehicle_cost_profiles")
    .insert({
      company_id: companyId,
      vehicle_id: parsed.vehicleId,
      effective_from: parsed.effectiveFrom,
      effective_to: parsed.effectiveTo,
      fuel_price_per_liter: parsed.fuelPricePerLiter,
      fixed_cost_per_day: parsed.fixedCostPerDay,
      fixed_cost_per_month: parsed.fixedCostPerMonth,
      maintenance_cost_per_km: parsed.maintenanceCostPerKm,
      tire_cost_per_km: parsed.tireCostPerKm,
      depreciation_cost_per_km: parsed.depreciationCostPerKm,
      driver_cost_per_day: parsed.driverCostPerDay,
      other_cost_per_km: parsed.otherCostPerKm,
      target_margin_percent: parsed.targetMarginPercent,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();

  // A exclusion constraint vehicle_cost_profiles_no_active_overlap (Postgres
  // code 23P01) rejeita um segundo perfil ativo sobrepondo o período de um
  // já existente para o mesmo veículo — erro esperado, não um bug.
  if (error) throw error;
  return data;
}
