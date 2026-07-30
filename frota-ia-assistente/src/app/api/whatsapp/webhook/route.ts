import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsappConfig, isWhatsappConfigured } from "@/lib/whatsapp/config";
import { sendWhatsappText } from "@/lib/whatsapp/zapiClient";
import { toPhoneE164 } from "@/lib/identity/phoneNormalizer";
import { resolveOrCreateUserByPhone } from "@/services/supabase/userIdentityService";
import { getOnboardingSession, createOnboardingSession, updateOnboardingSession } from "@/services/supabase/onboardingSessionService";
import { firstOnboardingMessage, processOnboardingMessage, type OnboardingCollectedData } from "@/ai/whatsapp/onboardingConversation";
import { finalizeOnboarding } from "@/ai/whatsapp/finalizeOnboarding";
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
 * Camada 6 (V1 centrada no WhatsApp) — fluxo por mensagem recebida:
 * 1. número desconhecido → cria o usuário na hora (WhatsApp é a porta de
 *    entrada, não exige painel/senha) e inicia o onboarding conversacional;
 * 2. onboarding em andamento → processa uma pergunta por vez via
 *    processOnboardingMessage, sem passar pela IA;
 * 3. onboarding concluído → mesma engine de chat da web
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

  const phoneE164 = toPhoneE164(body.phone);
  const textoRecebido = body.text?.message?.trim();

  if (!textoRecebido) {
    await sendWhatsappText(phoneE164, "Por enquanto só consigo entender mensagens de texto.").catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const { userId, channelId, isNew } = await resolveOrCreateUserByPhone(admin, body.phone, body.senderName);

  if (isNew) {
    // resolveOrCreateUserByPhone já criou a sessão de onboarding em awaiting_name.
    await sendWhatsappText(phoneE164, firstOnboardingMessage()).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  let session = await getOnboardingSession(admin, userId);

  if (!session) {
    // Usuário anterior à Camada 6 (ex.: veio do vínculo web da Camada 5).
    // Se já tem empresa, trata como onboarding concluído — nunca reabre o
    // onboarding de quem já usa o Frota IA. Se não tem, inicia agora.
    const contextoExistente = await loadCustomerContext(admin, userId);
    if (contextoExistente.company) {
      session = await createOnboardingSession(admin, userId, "completed");
    } else {
      session = await createOnboardingSession(admin, userId, "awaiting_name");
      await sendWhatsappText(phoneE164, firstOnboardingMessage()).catch(() => {});
      return NextResponse.json({ ok: true });
    }
  }

  if (session.state !== "completed") {
    const resultado = processOnboardingMessage(
      session.state,
      (session.collected_data ?? {}) as OnboardingCollectedData,
      textoRecebido
    );

    await updateOnboardingSession(admin, userId, {
      state: resultado.nextState,
      collectedData: resultado.collectedData as Record<string, unknown>,
    });

    if (resultado.finalize) {
      try {
        await finalizeOnboarding(admin, userId, resultado.collectedData);
      } catch {
        await sendWhatsappText(
          phoneE164,
          "Tive um problema ao salvar seu cadastro agora. Pode mandar novamente sua última resposta?"
        ).catch(() => {});
        await updateOnboardingSession(admin, userId, { state: "awaiting_primary_vehicle" });
        return NextResponse.json({ ok: true });
      }
    }

    await sendWhatsappText(phoneE164, resultado.reply).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const customerContext = await loadCustomerContext(admin, userId);

  if (!customerContext.company) {
    await sendWhatsappText(
      phoneE164,
      "Falta concluir seu cadastro antes de conversar por aqui. Pode me dizer seu nome para começarmos?"
    ).catch(() => {});
    await updateOnboardingSession(admin, userId, { state: "awaiting_name" });
    return NextResponse.json({ ok: true });
  }

  const companyId = customerContext.company.id;
  const vehicleContext = await loadVehicleContext(admin, companyId);
  const conversation = await getOrCreateOpenConversation(admin, companyId, userId, channelId);

  try {
    const resposta = await gerarRespostaAssistente({
      client: admin,
      userId,
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
