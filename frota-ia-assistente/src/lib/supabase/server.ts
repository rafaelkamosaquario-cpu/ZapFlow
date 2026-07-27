import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * Cliente Supabase para uso em Server Components, Server Actions e Route
 * Handlers. Respeita a sessão do usuário via cookies — nunca usa a secret
 * key. Para operações administrativas (bypass de RLS), ver admin.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Chamado a partir de um Server Component: seguro ignorar
            // porque o middleware (ver middleware.ts) já cuida de manter
            // a sessão atualizada em cada requisição.
          }
        },
      },
    }
  );
}
