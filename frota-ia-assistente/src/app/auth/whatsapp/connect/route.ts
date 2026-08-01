import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyWhatsappConnectLink } from "@/services/whatsapp/whatsappConnectLink";
import { linkChannel } from "@/services/supabase/channelIdentityService";
import { loadCustomerContext } from "@/ai/context/customerContext";
import { isUniqueViolation } from "@/lib/supabase/errors";

/**
 * Confirma o vínculo de um número de WhatsApp à conta do usuário logado.
 * Aberto a partir do link enviado pelo webhook (src/app/api/whatsapp/webhook)
 * quando uma mensagem chega de um número ainda não conhecido. Exige sessão
 * de navegador ativa (ao contrário do webhook, que não tem uma) — por isso
 * redireciona para /login se necessário, preservando o link para tentar de
 * novo depois do login.
 */
export async function GET(request: Request) {
  const { searchParams, origin, pathname, search } = new URL(request.url);
  // `origin` reflete o bind interno (localhost:8080) atrás do proxy do
  // Railway, não o domínio público — usa APP_URL pra redirecionar certo
  // (ver mesmo fix em src/app/auth/calendar/connect|callback/route.ts).
  // `pathname + search` (sem origin) é seguro pra recompor o "voltar pra
  // cá depois do login", já que não carrega o host interno.
  const appOrigin = process.env.APP_URL ?? origin;
  const link = searchParams.get("link");

  if (!link) {
    return NextResponse.redirect(`${appOrigin}/?whatsapp_erro=link_ausente`);
  }

  let payload;
  try {
    payload = verifyWhatsappConnectLink(link);
  } catch {
    return NextResponse.redirect(`${appOrigin}/?whatsapp_erro=link_invalido`);
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.redirect(`${appOrigin}/login?next=${encodeURIComponent(pathname + search)}`);
  }

  const context = await loadCustomerContext(supabase, data.user.id);
  const externalUserId = payload.phoneE164.replace(/\D/g, "");

  try {
    await linkChannel(supabase, data.user.id, context.company?.id ?? null, {
      channelType: "whatsapp",
      provider: "z_api",
      externalUserId,
      phoneE164: payload.phoneE164,
      displayName: payload.displayName,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) {
      return NextResponse.redirect(`${appOrigin}/?whatsapp_erro=falha_vinculo`);
    }
    // Já vinculado antes (reenvio do mesmo link, ou o usuário clicou 2x) — segue normalmente.
  }

  return NextResponse.redirect(`${appOrigin}/?whatsapp_conectado=1`);
}
