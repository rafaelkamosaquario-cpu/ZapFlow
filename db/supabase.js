// ============================================================================
// Cliente único do Supabase para o backend do ZapFlow.
//
// Regras de segurança:
//   * Usa SOMENTE variáveis de ambiente (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//   * A SERVICE_ROLE_KEY fica apenas no backend (nunca vai para o navegador,
//     nunca é impressa em log).
//   * Cliente criado apenas no backend, com schema "public".
// ============================================================================
import { createClient } from "@supabase/supabase-js";

// Limpa aspas acidentais e espaços, e remove barra(s) no final da URL.
function clean(v) {
  return String(v || "").trim().replace(/^["']|["']$/g, "").trim();
}

const SUPABASE_URL = clean(process.env.SUPABASE_URL).replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
export const SUPABASE_SCHEMA = "public";

// Referência do projeto extraída do hostname (ex.: kqquswdrtcqicyfcvvuv).
export const projectRef = (() => {
  const m = /^https:\/\/([a-z0-9-]+)\.supabase\.(co|in|net)$/i.exec(SUPABASE_URL);
  return m ? m[1] : null;
})();

// Aviso claro se a URL não parecer a "Project URL" da API (sem imprimir a chave).
if (SUPABASE_URL && !projectRef) {
  console.warn(
    `[Supabase] Atenção: SUPABASE_URL não parece a Project URL da API ("${SUPABASE_URL}").\n` +
    `           O valor correto é https://<seu-projeto>.supabase.co (sem caminho, sem barra no final).`
  );
}

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let _client = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: SUPABASE_SCHEMA },
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

/** Lança um erro claro quando uma operação do Supabase falha (sem expor credenciais). */
export function assertOk(error, contexto) {
  if (error) {
    const msg = `[Supabase] Falha em ${contexto}: ${error.message || error}`;
    console.error(msg);
    const e = new Error(msg);
    e.supabase = { context: contexto, code: error.code, details: error.details, hint: error.hint };
    throw e;
  }
}
