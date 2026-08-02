import { savedRouteCreateSchema, savedRouteUpdateSchema } from "@/lib/validation/schemas";
import type { SavedRouteRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function listRoutes(client: SupabaseDbClient, companyId: string): Promise<SavedRouteRow[]> {
  const { data, error } = await client
    .from("saved_routes")
    .select("*")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("is_favorite", { ascending: false })
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getRoute(client: SupabaseDbClient, routeId: string): Promise<SavedRouteRow | null> {
  const { data, error } = await client.from("saved_routes").select("*").eq("id", routeId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createRoute(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: unknown
): Promise<SavedRouteRow> {
  const parsed = savedRouteCreateSchema.parse(input);

  const { data, error } = await client
    .from("saved_routes")
    .insert({
      company_id: companyId,
      user_id: userId,
      vehicle_id: parsed.vehicleId,
      name: parsed.name,
      origin_name: parsed.originName,
      origin_city: parsed.originCity,
      origin_state: parsed.originState,
      destination_name: parsed.destinationName,
      destination_city: parsed.destinationCity,
      destination_state: parsed.destinationState,
      distance_km: parsed.distanceKm,
      estimated_duration_minutes: parsed.estimatedDurationMinutes,
      estimated_toll_cost: parsed.estimatedTollCost,
      average_consumption_km_l: parsed.averageConsumptionKmL,
      average_speed_kmh: parsed.averageSpeedKmh,
      is_favorite: parsed.isFavorite ?? false,
      data_source: "manual",
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/** `companyId` sempre exigido no filtro — mesmo princípio de vehicleService.updateVehicle: nunca confiar só num id vindo do modelo. */
export async function updateRoute(
  client: SupabaseDbClient,
  routeId: string,
  companyId: string,
  userId: string,
  input: unknown
): Promise<SavedRouteRow> {
  const parsed = savedRouteUpdateSchema.parse(input);

  const { data, error } = await client
    .from("saved_routes")
    .update({
      vehicle_id: parsed.vehicleId,
      name: parsed.name,
      origin_name: parsed.originName,
      origin_city: parsed.originCity,
      origin_state: parsed.originState,
      destination_name: parsed.destinationName,
      destination_city: parsed.destinationCity,
      destination_state: parsed.destinationState,
      distance_km: parsed.distanceKm,
      estimated_duration_minutes: parsed.estimatedDurationMinutes,
      estimated_toll_cost: parsed.estimatedTollCost,
      average_consumption_km_l: parsed.averageConsumptionKmL,
      average_speed_kmh: parsed.averageSpeedKmh,
      updated_by: userId,
    })
    .eq("id", routeId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function setFavoriteRoute(client: SupabaseDbClient, routeId: string, companyId: string, userId: string): Promise<SavedRouteRow> {
  const { data, error } = await client
    .from("saved_routes")
    .update({ is_favorite: true, updated_by: userId })
    .eq("id", routeId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deactivateRoute(client: SupabaseDbClient, routeId: string, companyId: string, userId: string): Promise<SavedRouteRow> {
  const { data, error } = await client
    .from("saved_routes")
    .update({ active: false, updated_by: userId })
    .eq("id", routeId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
