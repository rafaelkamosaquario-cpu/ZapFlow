// ============================================================================
// Diagnóstico da base (Supabase). Testa cada tabela usada pelo backend com um
// SELECT leve (limit 1) usando o MESMO cliente do app. Não registra nem devolve
// credenciais nem dados de clientes — apenas o nome da tabela e o status.
// ============================================================================
import { getClient, projectRef, SUPABASE_SCHEMA } from "./supabase.js";

// Tabelas realmente usadas pelo código (chamadas .from(...) em db/repositories.js).
export const EXPECTED_TABLES = [
  "contatos",
  "clientes",
  "conversas",
  "mensagens",
  "campanhas",
  "destinatarios_campanha",
  "modelos_mensagem",
  "automacoes",
  "respostas",
  "metricas_envios",
  "eventos_webhook",
];

/** Classifica o erro do Supabase em uma causa legível (sem expor dados). */
function classify(error) {
  if (!error) return "ok";
  const code = error.code || "";
  const msg = String(error.message || "").toLowerCase();
  if (code === "PGRST205" || msg.includes("schema cache")) return "schema_cache";
  if (code === "42P01" || msg.includes("does not exist")) return "missing";
  if (code === "42501" || msg.includes("permission denied")) return "permission_denied";
  if (msg.includes("invalid path")) return "bad_url";
  if (msg.includes("jwt") || msg.includes("api key") || msg.includes("unauthorized")) return "auth";
  return "error";
}

const STATUS_LABEL = {
  ok: "encontrada",
  schema_cache: "ausente no cache do schema (rode NOTIFY pgrst)",
  missing: "tabela não existe",
  permission_denied: "permissão negada para service_role",
  bad_url: "URL inválida",
  auth: "chave/autenticação inválida",
  error: "erro",
};

/** Testa uma tabela com SELECT leve (limit 1). Devolve { name, status, label }. */
async function checkTable(name) {
  try {
    // "*" (não uma coluna fixa como "id") porque `automacoes` não tem mais
    // coluna `id` desde a migration 003 (a PK virou `empresa_id`).
    const { error } = await getClient().from(name).select("*", { head: true, count: "exact" }).limit(1);
    const status = classify(error);
    return { name, status, label: STATUS_LABEL[status] || status };
  } catch (err) {
    const status = classify(err.supabase ? { code: err.supabase.code, message: err.message } : err);
    return { name, status, label: STATUS_LABEL[status] || status };
  }
}

/**
 * Roda o diagnóstico completo. Devolve um objeto pronto para o /api/health/database
 * (sem credenciais): connected, projectRef, schema e a lista de tabelas verificadas.
 */
export async function checkDatabase() {
  if (!getClient()) {
    return { connected: false, projectRef, schema: SUPABASE_SCHEMA, tables: [], error: "Supabase não configurado." };
  }
  const tables = [];
  for (const name of EXPECTED_TABLES) tables.push(await checkTable(name));
  const connected = tables.every((t) => t.status === "ok");
  const problemas = tables.filter((t) => t.status !== "ok");
  return {
    connected,
    projectRef,
    schema: SUPABASE_SCHEMA,
    tables,
    ...(problemas.length ? { error: `${problemas.length} tabela(s) com problema: ${problemas.map((p) => p.name + " (" + p.status + ")").join(", ")}` } : {}),
  };
}
