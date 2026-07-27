import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConversationById, listMessages } from "@/services/supabase/conversationService";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page") ?? "0") || 0;

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const conversation = await getConversationById(supabase, id);
  if (!conversation || conversation.user_id !== authData.user.id) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  const messages = await listMessages(supabase, id, page);
  return NextResponse.json({ messages: messages.slice().reverse() });
}
