import "server-only";
import { normalizePhoneDigits, toPhoneE164 } from "@/lib/identity/phoneNormalizer";
import { findChannelByExternalId } from "./channelIdentityService";
import { createOnboardingSession } from "./onboardingSessionService";
import type { SupabaseDbClient } from "./types";

export interface ResolvedWhatsappUser {
  userId: string;
  channelId: string;
  isNew: boolean;
}

/**
 * Ponto de entrada da identificação por telefone (Camada 6, seção 2 do
 * prompt V1-WhatsApp): dado o número que mandou a mensagem na Z-API,
 * encontra o user_id existente em user_channels ou cria um usuário novo.
 *
 * Usuário novo = uma linha real em auth.users, criada via Admin API com o
 * telefone (não e-mail/senha) — nunca inventamos um "usuário fantasma" fora
 * de auth.users, porque todo o resto do schema (companies, vehicles,
 * RLS via auth.uid()) depende de um auth.users.id válido. O número é
 * considerado verificado de imediato: a mensagem chegou por aquele número
 * diretamente na instância Z-API.
 *
 * Precisa do client admin (service role) — não existe sessão de navegador
 * neste fluxo.
 */
export async function resolveOrCreateUserByPhone(
  admin: SupabaseDbClient,
  rawPhone: string,
  displayName?: string
): Promise<ResolvedWhatsappUser> {
  const digits = normalizePhoneDigits(rawPhone);
  const phoneE164 = toPhoneE164(rawPhone);

  const existing = await findChannelByExternalId(admin, "z_api", digits);
  if (existing) {
    return { userId: existing.user_id, channelId: existing.id, isNew: false };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    phone: digits,
    phone_confirm: true,
    user_metadata: { source: "whatsapp", display_name: displayName },
  });

  if (createError || !created.user) {
    throw createError ?? new Error("Falha ao criar usuário a partir do WhatsApp.");
  }

  const userId = created.user.id;

  const { data: channel, error: channelError } = await admin
    .from("user_channels")
    .insert({
      user_id: userId,
      channel_type: "whatsapp",
      provider: "z_api",
      external_user_id: digits,
      phone_e164: phoneE164,
      display_name: displayName,
      verified: true,
    })
    .select("*")
    .single();

  if (channelError) throw channelError;

  await createOnboardingSession(admin, userId, "awaiting_name");

  return { userId, channelId: channel.id, isNew: true };
}
