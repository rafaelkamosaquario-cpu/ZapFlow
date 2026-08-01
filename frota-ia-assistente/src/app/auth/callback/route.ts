import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback do OAuth (Google, via Supabase Auth). Troca o code pela sessão e
 * redireciona. O trigger on_auth_user_created (migration 1) já cria o
 * profile automaticamente — nada a fazer aqui além de estabelecer a sessão.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  // `origin` reflete o bind interno (localhost:8080) atrás do proxy do
  // Railway, não o domínio público — usa APP_URL pra redirecionar certo
  // (ver mesmo fix em src/app/auth/calendar/connect|callback/route.ts).
  const appOrigin = process.env.APP_URL ?? origin;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${appOrigin}${next}`);
    }
  }

  return NextResponse.redirect(`${appOrigin}/?erro_login=1`);
}
