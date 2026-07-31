import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsappConfig, isWhatsappConfigured } from "@/lib/whatsapp/config";
import { sendWhatsappText, sendWhatsappOptionList, sendWhatsappButtons } from "@/lib/whatsapp/zapiClient";
import { baixarMidia, paraBase64 } from "@/lib/whatsapp/mediaDownloader";
import { toPhoneE164 } from "@/lib/identity/phoneNormalizer";
import { resolveOrCreateUserByPhone } from "@/services/supabase/userIdentityService";
import { getOnboardingSession, createOnboardingSession, updateOnboardingSession } from "@/services/supabase/onboardingSessionService";
import { firstOnboardingMessage, processOnboardingMessage, type OnboardingCollectedData, type OnboardingReply } from "@/ai/whatsapp/onboardingConversation";
import { finalizeOnboarding } from "@/ai/whatsapp/finalizeOnboarding";
import { loadCustomerContext, loadVehicleContext } from "@/ai/context/customerContext";
import { getOrCreateOpenConversation, appendMessage } from "@/services/supabase/conversationService";
import { gerarRespostaAssistente } from "@/ai/chat/gerarRespostaAssistente";
import { AnthropicConfigError } from "@/lib/anthropic/client";
import { isUniqueViolation } from "@/lib/supabase/errors";
import type { MessageInsert } from "@/lib/supabase/tables";

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
 *    processOnboardingMessage, sem passar pela IA (só entende texto);
 * 3. onboarding concluído → mesma engine de chat da web
 *    (gerarRespostaAssistente). Imagem e PDF são enviados de verdade pra
 *    IA (Claude lê imagem/documento nativamente); áudio e outros tipos de
 *    documento (planilha etc.) são reconhecidos e registrados, mas ainda
 *    não têm o conteúdo interpretado — ver limitações no
 *    docs/camada-6-whatsapp-v1.md (Fase F).
 */

interface ZApiWebhookBody {
  phone?: string;
  fromMe?: boolean;
  messageId?: string;
  senderName?: string;
  text?: { message?: string };
  image?: { imageUrl?: string; caption?: string; mimeType?: string };
  document?: { documentUrl?: string; fileName?: string; mimeType?: string; caption?: string };
  audio?: { audioUrl?: string; mimeType?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contact?: { displayName?: string; vcard?: string };
  listResponseMessage?: { selectedRowId?: string; title?: string; message?: string };
  buttonsResponseMessage?: { buttonId?: string; message?: string };
}

const TIPOS_IMAGEM_SUPORTADOS = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Resolve a entrada do onboarding a partir do que o WhatsApp mandou: toque
 * numa lista (`listResponseMessage.selectedRowId`), toque num botão
 * (`buttonsResponseMessage.buttonId`) ou texto livre — nessa ordem de
 * prioridade, já que uma mesma mensagem nunca traz mais de um desses tipos.
 */
function resolverEntradaOnboarding(body: ZApiWebhookBody): string | undefined {
  return body.listResponseMessage?.selectedRowId ?? body.buttonsResponseMessage?.buttonId ?? body.text?.message?.trim();
}

/** Envia a `reply` estruturada do onboarding usando o método certo da Z-API conforme o `kind`. */
async function enviarRespostaOnboarding(phoneE164: string, reply: OnboardingReply): Promise<void> {
  if (reply.kind === "list") {
    await sendWhatsappOptionList(phoneE164, reply.text, reply.title, reply.buttonLabel, reply.options);
    return;
  }
  if (reply.kind === "buttons") {
    await sendWhatsappButtons(phoneE164, reply.text, reply.options);
    return;
  }
  await sendWhatsappText(phoneE164, reply.text);
}

function extrairTelefoneDoVcard(vcard?: string): string | null {
  const match = vcard?.match(/TEL[^:]*:([+\d()\-\s]+)/i);
  return match?.[1]?.trim() ?? null;
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
  const textoDireto = body.text?.message?.trim();
  const entradaOnboarding = resolverEntradaOnboarding(body);

  // Callback sem nenhum tipo reconhecido (ex.: status de entrega/leitura) — ignora.
  if (!entradaOnboarding && !body.image && !body.document && !body.audio && !body.location && !body.contact) {
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
    if (!entradaOnboarding) {
      await sendWhatsappText(phoneE164, "Por enquanto, durante o cadastro, preciso que você responda em texto ou toque numa das opções.").catch(() => {});
      return NextResponse.json({ ok: true });
    }

    const resultado = processOnboardingMessage(
      session.state,
      (session.collected_data ?? {}) as OnboardingCollectedData,
      entradaOnboarding
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

    await enviarRespostaOnboarding(phoneE164, resultado.reply).catch(() => {});
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
  const inboundBase: Partial<MessageInsert> = body.messageId ? { external_message_id: body.messageId } : {};

  // Resolve o conteúdo desta mensagem: texto direto, ou mídia (Fase F).
  let mensagemUsuario: string | null = null;
  let conteudoMultimodal: Anthropic.ContentBlockParam[] | undefined;
  let inboundExtra: Partial<MessageInsert> = inboundBase;

  if (textoDireto) {
    mensagemUsuario = textoDireto;
  } else if (body.image?.imageUrl) {
    const mimeType = body.image.mimeType ?? "image/jpeg";
    if (!TIPOS_IMAGEM_SUPORTADOS.has(mimeType)) {
      await appendMessage(admin, {
        conversation_id: conversation.id,
        company_id: companyId,
        user_id: userId,
        role: "user",
        direction: "inbound",
        content: "[imagem recebida — formato não suportado]",
        content_type: "image",
        metadata: { mimeType },
        ...inboundBase,
      });
      await sendWhatsappText(phoneE164, "Recebi a imagem, mas esse formato ainda não é suportado. Pode mandar em JPEG, PNG, GIF ou WebP?").catch(() => {});
      return NextResponse.json({ ok: true });
    }

    const midia = await baixarMidia(body.image.imageUrl);
    if (!midia) {
      await sendWhatsappText(phoneE164, "Não consegui baixar a imagem agora. Pode tentar enviar de novo?").catch(() => {});
      return NextResponse.json({ ok: true });
    }

    mensagemUsuario = body.image.caption?.trim() || "[imagem recebida]";
    conteudoMultimodal = [{ type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg", data: paraBase64(midia.bytes) } }];
    inboundExtra = { ...inboundBase, content_type: "image", metadata: { mimeType, hadCaption: Boolean(body.image.caption) } };
  } else if (body.document?.documentUrl) {
    const mimeType = body.document.mimeType ?? "application/octet-stream";
    const fileName = body.document.fileName ?? "documento";

    if (mimeType !== "application/pdf") {
      await appendMessage(admin, {
        conversation_id: conversation.id,
        company_id: companyId,
        user_id: userId,
        role: "user",
        direction: "inbound",
        content: `[documento recebido: ${fileName} — conteúdo não interpretado]`,
        content_type: "document",
        metadata: { fileName, mimeType },
        ...inboundBase,
      });
      await sendWhatsappText(
        phoneE164,
        "Recebi o arquivo, mas por enquanto só consigo ler o conteúdo de PDFs — outros formatos de documento ainda não são interpretados."
      ).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    const midia = await baixarMidia(body.document.documentUrl);
    if (!midia) {
      await sendWhatsappText(phoneE164, "Não consegui baixar o documento agora. Pode tentar enviar de novo?").catch(() => {});
      return NextResponse.json({ ok: true });
    }

    mensagemUsuario = body.document.caption?.trim() || `[documento recebido: ${fileName}]`;
    conteudoMultimodal = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: paraBase64(midia.bytes) } }];
    inboundExtra = { ...inboundBase, content_type: "document", metadata: { fileName, mimeType } };
  } else if (body.audio) {
    await appendMessage(admin, {
      conversation_id: conversation.id,
      company_id: companyId,
      user_id: userId,
      role: "user",
      direction: "inbound",
      content: "[áudio recebido — não transcrito]",
      content_type: "audio",
      metadata: { mimeType: body.audio.mimeType ?? null },
      ...inboundBase,
    });
    await sendWhatsappText(phoneE164, "Recebi seu áudio, mas ainda não consigo entender mensagens de voz — pode escrever, por favor?").catch(() => {});
    return NextResponse.json({ ok: true });
  } else if (body.location) {
    const { latitude, longitude, name, address } = body.location;
    const partes = [name, address].filter(Boolean).join(", ");
    mensagemUsuario = `Localização recebida${partes ? ` (${partes})` : ""}: latitude ${latitude}, longitude ${longitude}.`;
    inboundExtra = { ...inboundBase, content_type: "location", metadata: { latitude: latitude ?? null, longitude: longitude ?? null, name: name ?? null, address: address ?? null } };
  } else if (body.contact) {
    const telefone = extrairTelefoneDoVcard(body.contact.vcard);
    mensagemUsuario = `Contato recebido: ${body.contact.displayName ?? "sem nome"}${telefone ? ` (${telefone})` : ""}.`;
    inboundExtra = { ...inboundBase, content_type: "contact", metadata: { displayName: body.contact.displayName ?? null, telefone } };
  }

  if (!mensagemUsuario) {
    return NextResponse.json({ ok: true });
  }

  try {
    const resposta = await gerarRespostaAssistente({
      client: admin,
      userId,
      companyId,
      conversation,
      customerContext,
      vehicleContext,
      mensagemUsuario,
      conteudoMultimodal,
      inboundMessageExtra: inboundExtra,
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
