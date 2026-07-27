import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { archiveConversation, getConversationById } from "@/services/supabase/conversationService";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const conversation = await getConversationById(supabase, id);
  if (!conversation || conversation.user_id !== authData.user.id) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  await archiveConversation(supabase, id);
  return NextResponse.json({ ok: true });
}
