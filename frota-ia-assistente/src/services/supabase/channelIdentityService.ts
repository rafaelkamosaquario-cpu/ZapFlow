import { channelIdentitySchema } from "@/lib/validation/schemas";
import { toJson } from "@/lib/supabase/json";
import type { UserChannelRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

/**
 * Localiza o canal (ex.: WhatsApp) pelo par provider + external_user_id.
 * Usado pelo fluxo de entrada do WhatsApp — normalmente chamado com o
 * client admin (a mensagem chega antes de qualquer sessão autenticada).
 */
export async function findChannelByExternalId(
  client: SupabaseDbClient,
  provider: UserChannelRow["provider"],
  externalUserId: string
): Promise<UserChannelRow | null> {
  const { data, error } = await client
    .from("user_channels")
    .select("*")
    .eq("provider", provider)
    .eq("external_user_id", externalUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listChannelsForUser(client: SupabaseDbClient, userId: string): Promise<UserChannelRow[]> {
  const { data, error } = await client.from("user_channels").select("*").eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function linkChannel(
  client: SupabaseDbClient,
  userId: string,
  companyId: string | null,
  input: unknown
): Promise<UserChannelRow> {
  const parsed = channelIdentitySchema.parse(input);

  const { data, error } = await client
    .from("user_channels")
    .insert({
      user_id: userId,
      company_id: companyId,
      channel_type: parsed.channelType,
      provider: parsed.provider,
      external_user_id: parsed.externalUserId,
      phone_e164: parsed.phoneE164,
      display_name: parsed.displayName,
      metadata: toJson(parsed.metadata),
      verified: false,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
