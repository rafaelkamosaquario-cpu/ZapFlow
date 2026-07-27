import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerContext } from "@/ai/context/customerContext";
import { listConversationsForUser } from "@/services/supabase/conversationService";

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const context = await loadCustomerContext(supabase, authData.user.id);
  if (!context.company) {
    return NextResponse.json({ conversations: [] });
  }

  const conversations = await listConversationsForUser(supabase, context.company.id, authData.user.id);
  return NextResponse.json({ conversations });
}
