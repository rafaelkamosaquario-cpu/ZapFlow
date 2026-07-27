import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Cliente com a secret key — ignora RLS (bypass total). Uso restrito a
 * código que roda só no backend: webhook do WhatsApp, jobs, rotas server-side
 * que precisam agir em nome do sistema (ex.: gravar tool_executions).
 *
 * O import de "server-only" faz o build falhar se este arquivo acabar sendo
 * importado por engano em um Client Component. Nunca reexportar a instância
 * criada aqui para código client-side.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "createAdminClient: variáveis SUPABASE_SECRET_KEY e/ou NEXT_PUBLIC_SUPABASE_URL não configuradas."
    );
  }

  return createSupabaseClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
