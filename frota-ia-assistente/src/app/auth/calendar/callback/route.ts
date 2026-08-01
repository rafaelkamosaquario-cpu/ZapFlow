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
  // Mesmo motivo do connect/route.ts: `origin` reflete o bind interno
  // (localhost:8080) atrás do proxy do Railway — usa APP_URL pra
  // redirecionar pro domínio público de verdade, inclusive no caminho de
  // sucesso (sem isso, até uma conexão bem-sucedida quebrava no final).
  const appOrigin = process.env.APP_URL ?? origin;

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${appOrigin}/?calendar_conectado=cancelado`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appOrigin}/?calendar_erro=parametros_ausentes`);
  }

  let payload: CalendarOAuthState;
  try {
    payload = verifySignedToken<CalendarOAuthState>(state);
  } catch {
    return NextResponse.redirect(`${appOrigin}/?calendar_erro=state_invalido`);
  }

  try {
    await connectGoogleCalendar({ userId: payload.userId, companyId: payload.companyId, code });
  } catch {
    return NextResponse.redirect(`${appOrigin}/?calendar_erro=falha_conexao`);
  }

  return NextResponse.redirect(`${appOrigin}/?calendar_conectado=1`);
}
