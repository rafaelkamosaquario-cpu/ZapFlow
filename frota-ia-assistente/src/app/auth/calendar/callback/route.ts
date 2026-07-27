import { NextResponse } from "next/server";
import { verifySignedToken } from "@/lib/google/signedToken";
import { connectGoogleCalendar } from "@/services/google/googleCalendarService";

interface CalendarOAuthState extends Record<string, unknown> {
  userId: string;
  companyId: string | null;
}

/**
 * Callback do OAuth complementar do Google Calendar (não é o mesmo callback
 * do login/Supabase Auth em src/app/auth/callback). Troca o `code` por
 * tokens, salva o refresh token no Vault e liga a conta ao usuário
 * identificado pelo `state` assinado.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${origin}/?calendar_conectado=cancelado`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/?calendar_erro=parametros_ausentes`);
  }

  let payload: CalendarOAuthState;
  try {
    payload = verifySignedToken<CalendarOAuthState>(state);
  } catch {
    return NextResponse.redirect(`${origin}/?calendar_erro=state_invalido`);
  }

  try {
    await connectGoogleCalendar({ userId: payload.userId, companyId: payload.companyId, code });
  } catch {
    return NextResponse.redirect(`${origin}/?calendar_erro=falha_conexao`);
  }

  return NextResponse.redirect(`${origin}/?calendar_conectado=1`);
}
