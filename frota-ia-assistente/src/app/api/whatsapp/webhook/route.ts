import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsappConfig, isWhatsappConfigured } from "@/lib/whatsapp/config";
import { sendWhatsappText } from "@/lib/whatsapp/zapiClient";
import { buildWhatsappConnectLink } from "@/services/whatsapp/whatsappConnectLink";
import { findChannelByExternalId } from "@/services/supabase/channelIdentityService";
import { loadCustomerContext, loadVehicleContext } from "@/ai/context/customerContext";
import { getOrCreateOpenConversation } from "@/services/supabase/conversationService";
import { gerarRespostaAssistente } from "@/ai/chat/gerarRespostaAssistente";
import { AnthropicConfigError } from "@/lib/anthropic/client";
import { isUniqueViolation } from "@/lib/supabase/errors";

/**
 * Webhook de mensagem recebida da instância Z-API própria do Frota IA
 * (separada da instância do ZapFlow — outro app deste repositório, sem
 * relação com este). Configurar no painel do Z-API, em "Webhook ao
 * receber": `${APP_URL}/api/whatsapp/webhook?token=<WHATSAPP_WEBHOOK_SECRET>`.
 * O token na query string é a validação de origem — a Z-API não assina o
 * corpo da requisição.
 *
 * Fluxo por mensagem recebida:
 * 1. número desconhecido → manda de volta um link seguro para vincular a
 *    conta (precisa já ter se cadastrado no site);
 * 2. número vinculado mas sem cadastro completo (empresa/veículo) → pede
 *    para terminar o cadastro no site;
 * 3. número vinculado e cadastro completo → mesma engine de chat da web
 *    (gerarRespostaAssistente), resposta enviada de volta por texto.
 */

interface ZApiWebhookBody {
  phone?: string;
  fromMe?: boolean;
  messageId?: string;
  senderName?: string;
  text?: { message?: string };
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  if (!isWhatsappConfigured()) {
    return NextResponse.json({ error: "WhatsApp não configurado." }, { status: 503 });
  }

  const { WHATSAPP_WEBHOOK_SECRET } = getWhatsappConfig();
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!tokensMatch(token, WHATSAPP_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Token inválido." }, { status: 401 });
  }

  let body: ZApiWebhookBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Ignora eco de mensagens que o próprio número enviou e callbacks sem telefone.
  if (body.fromMe || !body.phone) {
    return NextResponse.json({ ok: true });
  }

  const phoneDigits = body.phone.replace(/\D/g, "");
  const phoneE164 = `+${phoneDigits}`;
  const textoRecebido = body.text?.message?.trim();

  if (!textoRecebido) {
    await sendWhatsappText(phoneE164, "Por enquanto só consigo entender mensagens de texto.").catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const canal = await findChannelByExternalId(admin, "z_api", phoneDigits);

  if (!canal) {
    const link = buildWhatsappConnectLink(phoneE164, body.senderName);
    const { APP_URL } = getWhatsappConfig();
    await sendWhatsappText(
      phoneE164,
      `Olá! Ainda não conheço este número no Frota IA. Crie sua conta em ${APP_URL} e depois abra este link, já logado, para conectar este WhatsApp à sua conta:\n\n${link}`
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const customerContext = await loadCustomerContext(admin, canal.user_id);

  if (!customerContext.company) {
    await sendWhatsappText(
      phoneE164,
      "Falta concluir seu cadastro (empresa e veículo) no site do Frota IA antes de conversar por aqui."
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const companyId = customerContext.company.id;
  const vehicleContext = await loadVehicleContext(admin, companyId);
  const conversation = await getOrCreateOpenConversation(admin, companyId, canal.user_id, canal.id);

  try {
    const resposta = await gerarRespostaAssistente({
      client: admin,
      userId: canal.user_id,
      companyId,
      conversation,
      customerContext,
      vehicleContext,
      mensagemUsuario: textoRecebido,
      inboundMessageExtra: body.messageId ? { external_message_id: body.messageId } : undefined,
    });

    await sendWhatsappText(phoneE164, resposta.message.content);
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Reentrega do mesmo webhook (mesmo external_message_id) — já respondemos antes, não faz de novo.
      return NextResponse.json({ ok: true, deduped: true });
    }

    if (err instanceof AnthropicConfigError) {
      await sendWhatsappText(
        phoneE164,
        "Ainda não consigo responder automaticamente — a integração com a IA está sendo configurada. Tente novamente mais tarde."
      ).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    await sendWhatsappText(phoneE164, "Não consegui processar sua mensagem agora. Tente novamente em instantes.").catch(() => {});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
