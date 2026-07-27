import { vehicleCreateSchema, vehicleUpdateSchema } from "@/lib/validation/schemas";
import type { VehicleRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function listVehicles(client: SupabaseDbClient, companyId: string): Promise<VehicleRow[]> {
  const { data, error } = await client
    .from("vehicles")
    .select("*")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getVehicle(client: SupabaseDbClient, vehicleId: string): Promise<VehicleRow | null> {
  const { data, error } = await client.from("vehicles").select("*").eq("id", vehicleId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Veículo padrão da empresa (is_default = true), quando existir. */
export async function resolveDefaultVehicle(
  client: SupabaseDbClient,
  companyId: string
): Promise<VehicleRow | null> {
  const { data, error } = await client
    .from("vehicles")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createVehicle(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: unknown
): Promise<VehicleRow> {
  const parsed = vehicleCreateSchema.parse(input);

  const { data, error } = await client
    .from("vehicles")
    .insert({
      company_id: companyId,
      name: parsed.name,
      plate: parsed.plate,
      vehicle_type: parsed.vehicleType,
      brand: parsed.brand,
      model: parsed.model,
      model_year: parsed.modelYear,
      fuel_type: parsed.fuelType,
      average_consumption_km_l: parsed.averageConsumptionKmL,
      average_speed_kmh: parsed.averageSpeedKmh,
      load_capacity_kg: parsed.loadCapacityKg,
      current_odometer_km: parsed.currentOdometerKm,
      notes: parsed.notes,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateVehicle(
  client: SupabaseDbClient,
  vehicleId: string,
  userId: string,
  input: unknown
): Promise<VehicleRow> {
  const parsed = vehicleUpdateSchema.parse(input);

  const { data, error } = await client
    .from("vehicles")
    .update({
      name: parsed.name,
      plate: parsed.plate,
      vehicle_type: parsed.vehicleType,
      brand: parsed.brand,
      model: parsed.model,
      model_year: parsed.modelYear,
      fuel_type: parsed.fuelType,
      average_consumption_km_l: parsed.averageConsumptionKmL,
      average_speed_kmh: parsed.averageSpeedKmh,
      load_capacity_kg: parsed.loadCapacityKg,
      current_odometer_km: parsed.currentOdometerKm,
      notes: parsed.notes,
      updated_by: userId,
    })
    .eq("id", vehicleId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
