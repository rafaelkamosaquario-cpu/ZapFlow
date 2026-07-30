import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsappText } from "@/lib/whatsapp/zapiClient";
import { isWhatsappConfigured } from "@/lib/whatsapp/config";
import { listDueAlerts, markAlertSent, markAlertFailed } from "@/services/supabase/alertService";
import { listChannelsForUser } from "@/services/supabase/channelIdentityService";

/**
 * Job de disparo dos alertas agendados (Camada 6, Fase C). Não é chamado
 * pelo usuário nem pela IA — é uma rota protegida para ser chamada por um
 * cron externo ao processo do Next.js (o Next/Railway não têm cron nativo
 * dentro do próprio serviço web).
 *
 * Configuração recomendada no Railway: criar um segundo serviço do tipo
 * "Cron Job" no mesmo projeto, agendado para rodar a cada 5 minutos, com o
 * comando `curl -fsS "$APP_URL/api/alerts/dispatch?token=$ALERTS_DISPATCH_SECRET"`.
 * Ver docs/camada-6-whatsapp-v1.md para o passo a passo completo.
 */

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function GET(request: Request) {
  const secret = process.env.ALERTS_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "ALERTS_DISPATCH_SECRET não configurado." }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!tokensMatch(token, secret)) {
    return NextResponse.json({ error: "Token inválido." }, { status: 401 });
  }

  if (!isWhatsappConfigured()) {
    return NextResponse.json({ error: "WhatsApp não configurado." }, { status: 503 });
  }

  const admin = createAdminClient();
  const devidos = await listDueAlerts(admin);

  let enviados = 0;
  let falhas = 0;

  for (const alerta of devidos) {
    const canais = await listChannelsForUser(admin, alerta.user_id);
    const canalWhatsapp = canais.find((c) => c.channel_type === "whatsapp" && c.phone_e164);

    if (!canalWhatsapp?.phone_e164) {
      await markAlertFailed(admin, alerta.id, "Sem número de WhatsApp vinculado ao usuário.");
      falhas += 1;
      continue;
    }

    try {
      const partes = [`🔔 ${alerta.title}`];
      if (alerta.notes) partes.push(alerta.notes);
      await sendWhatsappText(canalWhatsapp.phone_e164, partes.join("\n\n"));
      await markAlertSent(admin, alerta.id);
      enviados += 1;
    } catch {
      await markAlertFailed(admin, alerta.id, "Falha ao enviar a mensagem pelo WhatsApp.");
      falhas += 1;
    }
  }

  return NextResponse.json({ ok: true, verificados: devidos.length, enviados, falhas });
}
