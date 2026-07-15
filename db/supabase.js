// ============================================================================
// Cliente único do Supabase para o backend do ZapFlow.
//
// Regras de segurança:
//   * Usa SOMENTE variáveis de ambiente (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//   * A SERVICE_ROLE_KEY fica apenas no backend (nunca vai para o navegador).
//   * Se as variáveis não estiverem configuradas, `supabaseEnabled` é false e o
//     app continua no modo de arquivos (comportamento anterior) — isso é apenas
//     o estado "Supabase ainda não configurado", NÃO um fallback após ativado.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let _client = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

/** Cliente ativo do Supabase (todas as consultas do backend passam por aqui). */
export function getClient() {
  return _client;
}

/** Injeta um cliente alternativo (usado apenas em testes automatizados). */
export function __setClientForTests(c) {
  _client = c;
}

/** Lança um erro claro quando uma operação do Supabase falha. */
export function assertOk(error, contexto) {
  if (error) {
    const msg = `[Supabase] Falha em ${contexto}: ${error.message || error}`;
    console.error(msg);
    throw new Error(msg);
  }
}
