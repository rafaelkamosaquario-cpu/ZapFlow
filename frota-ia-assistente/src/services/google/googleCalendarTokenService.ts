import "server-only";
import { refreshAccessToken, revokeGoogleToken } from "@/lib/google/calendarClient";
import type { SupabaseDbClient } from "@/services/supabase/types";

/**
 * Único lugar que lê/escreve o refresh token do Google Calendar. Sempre via
 * as funções SECURITY DEFINER do Vault (`store/read/delete_google_refresh_token`),
 * chamadas com o client admin (service_role — as funções revogam EXECUTE de
 * anon/authenticated). O access token nunca é persistido: cada chamada
 * troca o refresh token por um access token novo.
 */

export async function saveRefreshToken(
  adminClient: SupabaseDbClient,
  googleIntegrationId: string,
  refreshToken: string
): Promise<void> {
  const { error } = await adminClient.rpc("store_google_refresh_token", {
    p_google_integration_id: googleIntegrationId,
    p_refresh_token: refreshToken,
  });
  if (error) throw error;
}

export class GoogleCalendarNotConnectedError extends Error {
  constructor() {
    super("Integração com o Google Calendar não encontrada ou sem refresh token salvo.");
    this.name = "GoogleCalendarNotConnectedError";
  }
}

/** Troca o refresh token salvo por um access token válido, pronto para uso imediato. */
export async function getValidAccessToken(adminClient: SupabaseDbClient, googleIntegrationId: string): Promise<string> {
  const { data: refreshToken, error } = await adminClient.rpc("read_google_refresh_token", {
    p_google_integration_id: googleIntegrationId,
  });

  if (error) throw error;
  if (!refreshToken) throw new GoogleCalendarNotConnectedError();

  const { accessToken, expiresIn } = await refreshAccessToken(refreshToken);

  await adminClient
    .from("google_integrations")
    .update({
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      last_synced_at: new Date().toISOString(),
      connection_status: "connected",
    })
    .eq("id", googleIntegrationId);

  return accessToken;
}

/** Revoga no Google (melhor esforço) e apaga o segredo do Vault. Idempotente. */
export async function revokeAndDeleteToken(adminClient: SupabaseDbClient, googleIntegrationId: string): Promise<void> {
  const { data: refreshToken } = await adminClient.rpc("read_google_refresh_token", {
    p_google_integration_id: googleIntegrationId,
  });

  if (refreshToken) {
    try {
      await revokeGoogleToken(refreshToken);
    } catch {
      // Melhor esforço: mesmo se a revogação no Google falhar (ex.: já
      // revogado manualmente pelo usuário), ainda apagamos o segredo local.
    }
  }

  const { error } = await adminClient.rpc("delete_google_refresh_token", {
    p_google_integration_id: googleIntegrationId,
  });
  if (error) throw error;
}
