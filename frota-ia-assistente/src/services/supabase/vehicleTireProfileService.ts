import { vehicleTireProfileCreateSchema } from "@/lib/validation/schemas";
import type { VehicleTireProfileRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function listTireProfiles(
  client: SupabaseDbClient,
  vehicleId: string
): Promise<VehicleTireProfileRow[]> {
  const { data, error } = await client
    .from("vehicle_tire_profiles")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .eq("active", true);
  if (error) throw error;
  return data ?? [];
}

export async function createTireProfile(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: unknown
): Promise<VehicleTireProfileRow> {
  const parsed = vehicleTireProfileCreateSchema.parse(input);

  const { data, error } = await client
    .from("vehicle_tire_profiles")
    .insert({
      company_id: companyId,
      vehicle_id: parsed.vehicleId,
      tire_category: parsed.tireCategory,
      brand: parsed.brand,
      model: parsed.model,
      size: parsed.size,
      acquisition_cost: parsed.acquisitionCost,
      expected_life_km: parsed.expectedLifeKm,
      number_of_recaps: parsed.numberOfRecaps,
      recap_cost: parsed.recapCost,
      expected_recap_life_km: parsed.expectedRecapLifeKm,
      notes: parsed.notes,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
