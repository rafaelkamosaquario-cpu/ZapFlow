import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback do OAuth (Google, via Supabase Auth). Troca o code pela sessão e
 * redireciona. O trigger on_auth_user_created (migration 1) já cria o
 * profile automaticamente — nada a fazer aqui além de estabelecer a sessão.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/?erro_login=1`);
}
