import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AnthropicConfigError } from "@/lib/anthropic/client";
import { loadCustomerContext, loadVehicleContext } from "@/ai/context/customerContext";
import { getConversationById, getOrCreateOpenConversation } from "@/services/supabase/conversationService";
import { gerarRespostaAssistente } from "@/ai/chat/gerarRespostaAssistente";

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

  try {
    const resposta = await gerarRespostaAssistente({
      client: supabase,
      userId,
      companyId,
      conversation,
      customerContext,
      vehicleContext,
      mensagemUsuario,
    });

    return NextResponse.json(resposta);
  } catch (err) {
    if (err instanceof AnthropicConfigError) {
      return NextResponse.json(
        { error: "A integração com a Claude API ainda não foi configurada (ANTHROPIC_API_KEY ausente)." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Não foi possível obter resposta da IA agora. Tente novamente." }, { status: 502 });
  }
}
