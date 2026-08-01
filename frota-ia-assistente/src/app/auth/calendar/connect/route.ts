import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizationUrl } from "@/lib/google/calendarClient";
import { isGoogleCalendarConfigured } from "@/lib/google/config";
import { createSignedToken } from "@/lib/google/signedToken";
import { verifyConnectLink } from "@/services/google/googleCalendarConnectLink";
import { loadCustomerContext } from "@/ai/context/customerContext";

const STATE_TTL_SECONDS = 10 * 60;

/**
 * Início do fluxo de conexão da Agenda Google. Aceita duas origens:
 * - `?link=<token assinado>` — vindo de um link seguro enviado pelo
 *   WhatsApp (não exige sessão de navegador ativa);
 * - sessão do Supabase Auth já aberta no navegador.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  // `origin` vem de `request.url`, que atrás do proxy do Railway reflete o
  // bind interno (http://localhost:8080), não o domínio público — usar
  // APP_URL (mesma variável já usada em buildSecureConnectLink) evita
  // redirecionar o navegador do cliente para um endereço que só existe
  // dentro do container.
  const appOrigin = process.env.APP_URL ?? origin;

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(`${appOrigin}/?calendar_erro=nao_configurado`);
  }

  const supabase = await createClient();
  let userId: string | null = null;
  let companyId: string | null = null;

  const link = searchParams.get("link");
  if (link) {
    try {
      const payload = verifyConnectLink(link);
      userId = payload.userId;
      companyId = payload.companyId;
    } catch {
      return NextResponse.redirect(`${appOrigin}/?calendar_erro=link_invalido`);
    }
  } else {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return NextResponse.redirect(`${appOrigin}/?calendar_erro=login_necessario`);
    }
    userId = data.user.id;
    const context = await loadCustomerContext(supabase, userId);
    companyId = context.company?.id ?? null;
  }

  const state = createSignedToken({ userId, companyId }, STATE_TTL_SECONDS);
  return NextResponse.redirect(buildAuthorizationUrl(state));
}
