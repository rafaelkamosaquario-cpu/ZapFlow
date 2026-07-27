import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { truncate } from "@/lib/utils";
import { AnthropicConfigError, createAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic/client";
import { construirFerramentasAnthropic, CAMPOS_DE_CONTEXTO_RESERVADOS } from "@/lib/anthropic/tools";
import { construirSystemPrompt } from "@/lib/anthropic/systemPrompt";
import { loadCustomerContext, loadVehicleContext, saveToolExecution } from "@/ai/context/customerContext";
import {
  appendMessage,
  getConversationById,
  getOrCreateOpenConversation,
  listMessages,
} from "@/services/supabase/conversationService";
import { FERRAMENTAS_FROTA_IA } from "@/ai/tools";
import type { FrotaIaToolName, MessageRow } from "@/lib/supabase/tables";

const MAX_TOOL_ROUNDS = 4;
const MAX_TOKENS = 1536;

function paraMensagemAnthropic(row: MessageRow): Anthropic.MessageParam | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  if (!row.content) return null;
  return { role: row.role, content: row.content };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let body: { conversationId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const mensagemUsuario = body.message?.trim();
  if (!mensagemUsuario) {
    return NextResponse.json({ error: "Mensagem vazia." }, { status: 400 });
  }

  const userId = authData.user.id;
  const customerContext = await loadCustomerContext(supabase, userId);

  if (!customerContext.company) {
    return NextResponse.json({ error: "Cadastro incompleto. Finalize o onboarding antes de conversar." }, { status: 409 });
  }

  const companyId = customerContext.company.id;
  const vehicleContext = await loadVehicleContext(supabase, companyId);

  const conversation = body.conversationId
    ? await getConversationById(supabase, body.conversationId)
    : await getOrCreateOpenConversation(supabase, companyId, userId);

  if (!conversation || conversation.user_id !== userId) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  if (!conversation.title) {
    await supabase.from("conversations").update({ title: truncate(mensagemUsuario, 48) }).eq("id", conversation.id);
  }

  const historico = await listMessages(supabase, conversation.id, 0, 30);
  const mensagensAnthropic: Anthropic.MessageParam[] = historico
    .slice()
    .reverse()
    .map(paraMensagemAnthropic)
    .filter((m): m is Anthropic.MessageParam => m !== null);

  await appendMessage(supabase, {
    conversation_id: conversation.id,
    company_id: companyId,
    user_id: userId,
    role: "user",
    direction: "inbound",
    content: mensagemUsuario,
  });

  mensagensAnthropic.push({ role: "user", content: mensagemUsuario });

  let anthropic;
  try {
    anthropic = createAnthropicClient();
  } catch (err) {
    if (err instanceof AnthropicConfigError) {
      return NextResponse.json(
        { error: "A integração com a Claude API ainda não foi configurada (ANTHROPIC_API_KEY ausente)." },
        { status: 503 }
      );
    }
    throw err;
  }

  const system = construirSystemPrompt(customerContext, vehicleContext, new Date());
  const tools = construirFerramentasAnthropic();

  let textoFinal = "";

  try {
    for (let rodada = 0; rodada <= MAX_TOOL_ROUNDS; rodada++) {
      const resposta = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages: mensagensAnthropic,
      });

      const blocosTexto = resposta.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      const blocosFerramenta = resposta.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      textoFinal = blocosTexto.map((b) => b.text).join("\n").trim();

      if (resposta.stop_reason !== "tool_use" || blocosFerramenta.length === 0 || rodada === MAX_TOOL_ROUNDS) {
        break;
      }

      mensagensAnthropic.push({ role: "assistant", content: resposta.content });

      const resultadosFerramentas: Anthropic.ToolResultBlockParam[] = [];

      for (const bloco of blocosFerramenta) {
        const ferramenta = FERRAMENTAS_FROTA_IA.find((f) => f.nome === bloco.name);

        if (!ferramenta) {
          resultadosFerramentas.push({
            type: "tool_result",
            tool_use_id: bloco.id,
            content: `Ferramenta desconhecida: ${bloco.name}.`,
            is_error: true,
          });
          continue;
        }

        const inputDoModelo = (bloco.input ?? {}) as Record<string, unknown>;
        for (const campo of CAMPOS_DE_CONTEXTO_RESERVADOS) delete inputDoModelo[campo];

        const entradaFinal = {
          ...inputDoModelo,
          userId,
          companyId,
          conversationId: conversation.id,
        };

        try {
          const resultado = await saveToolExecution(
            supabase,
            companyId,
            { userId, toolName: bloco.name as FrotaIaToolName, inputData: entradaFinal, conversationId: conversation.id },
            () => ferramenta.executar(entradaFinal as never)
          );

          resultadosFerramentas.push({
            type: "tool_result",
            tool_use_id: bloco.id,
            content: JSON.stringify(resultado),
            is_error: !resultado.sucesso,
          });
        } catch {
          resultadosFerramentas.push({
            type: "tool_result",
            tool_use_id: bloco.id,
            content: "A ferramenta falhou ao processar os dados recebidos.",
            is_error: true,
          });
        }
      }

      mensagensAnthropic.push({ role: "user", content: resultadosFerramentas });
    }
  } catch {
    return NextResponse.json({ error: "Não foi possível obter resposta da IA agora. Tente novamente." }, { status: 502 });
  }

  if (!textoFinal) {
    textoFinal = "Não consegui concluir essa resposta agora. Pode reformular o pedido?";
  }

  const mensagemSalva = await appendMessage(supabase, {
    conversation_id: conversation.id,
    company_id: companyId,
    user_id: userId,
    role: "assistant",
    direction: "outbound",
    content: textoFinal,
  });

  return NextResponse.json({
    conversationId: conversation.id,
    message: { id: mensagemSalva.id, content: textoFinal, createdAt: mensagemSalva.created_at },
  });
}
