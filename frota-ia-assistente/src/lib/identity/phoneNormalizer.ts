/**
 * Normalização de telefone recebido pela Z-API. Nunca usar o telefone como
 * chave primária — ele só serve para localizar o `user_id` interno em
 * `user_channels` (external_user_id). Ver src/services/supabase/userIdentityService.ts.
 */

/** Remove espaços, traços, parênteses e qualquer símbolo — só dígitos sobram. */
export function toDigitsOnly(rawPhone: string): string {
  return rawPhone.replace(/\D/g, "");
}

/**
 * Corrige a duplicidade de DDI mais comum vinda de integrações de WhatsApp
 * (o mesmo código de país aparece duas vezes, ex.: "5555119999..." em vez
 * de "5511999..."). Só corrige quando o prefixo "55" aparece duplicado no
 * início — não tenta adivinhar outros países.
 */
export function stripDuplicateCountryCode(digits: string): string {
  if (digits.startsWith("5555") && digits.length > 13) {
    return digits.slice(2);
  }
  return digits;
}

/** external_user_id estável para user_channels: só dígitos, sem "+". */
export function normalizePhoneDigits(rawPhone: string): string {
  return stripDuplicateCountryCode(toDigitsOnly(rawPhone));
}

/** Formato E.164 (com "+") para exibição e para chamadas à Z-API. */
export function toPhoneE164(rawPhone: string): string {
  return `+${normalizePhoneDigits(rawPhone)}`;
}
