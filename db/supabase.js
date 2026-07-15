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

// Normaliza a URL: remove espaços e barra(s) no final (evita caminho inválido
// como ".../supabase.co//rest/v1" que causa "Invalid path specified in request URL").
let SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Aviso claro se a URL não parecer a "Project URL" da API (ex.: colaram a URL do
// painel por engano). A URL correta é https://<ref>.supabase.co
if (SUPABASE_URL && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(SUPABASE_URL)) {
  console.warn(
    `[Supabase] Atenção: SUPABASE_URL="${SUPABASE_URL}" não parece a Project URL da API.\n` +
    `           O valor correto é algo como https://<seu-projeto>.supabase.co (sem caminho, sem barra no final).`
  );
}

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
