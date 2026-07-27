import { profileUpdateSchema } from "@/lib/validation/schemas";
import type { ProfileRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function getProfile(client: SupabaseDbClient, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  client: SupabaseDbClient,
  userId: string,
  input: unknown
): Promise<ProfileRow> {
  const parsed = profileUpdateSchema.parse(input);

  const { data, error } = await client
    .from("profiles")
    .update({
      full_name: parsed.fullName,
      phone_e164: parsed.phoneE164,
      avatar_url: parsed.avatarUrl,
      timezone: parsed.timezone,
      locale: parsed.locale,
      onboarding_completed: parsed.onboardingCompleted,
    })
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
