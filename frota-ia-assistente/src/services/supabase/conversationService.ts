import type { ConversationRow, MessageInsert, MessageRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

const MESSAGES_PAGE_SIZE = 30;

export async function getOpenConversation(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  channelId?: string
): Promise<ConversationRow | null> {
  let query = client
    .from("conversations")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1);

  if (channelId) query = query.eq("channel_id", channelId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function createConversation(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  channelId?: string,
  externalConversationId?: string
): Promise<ConversationRow> {
  const { data, error } = await client
    .from("conversations")
    .insert({
      company_id: companyId,
      user_id: userId,
      channel_id: channelId,
      external_conversation_id: externalConversationId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/** Busca (ou cria) a conversa aberta do usuário — nunca cria uma segunda em paralelo. */
export async function getOrCreateOpenConversation(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  channelId?: string
): Promise<ConversationRow> {
  const existing = await getOpenConversation(client, companyId, userId, channelId);
  if (existing) return existing;
  return createConversation(client, companyId, userId, channelId);
}

export async function getConversationById(
  client: SupabaseDbClient,
  conversationId: string
): Promise<ConversationRow | null> {
  const { data, error } = await client.from("conversations").select("*").eq("id", conversationId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Conversas mais recentes do usuário (não arquivadas), para a barra lateral. Sem select(*) sem limite. */
export async function listConversationsForUser(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  limit = 30
): Promise<ConversationRow[]> {
  const { data, error } = await client
    .from("conversations")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/** Soft delete: a conversa nunca é apagada, só sai da lista (status = 'archived'). */
export async function archiveConversation(client: SupabaseDbClient, conversationId: string): Promise<void> {
  const { error } = await client.from("conversations").update({ status: "archived" }).eq("id", conversationId);
  if (error) throw error;
}

/**
 * Histórico paginado, mais recentes primeiro. Nunca usar select('*') sem
 * limite — mensagens tendem a crescer sem teto.
 */
export async function listMessages(
  client: SupabaseDbClient,
  conversationId: string,
  page = 0,
  pageSize = MESSAGES_PAGE_SIZE
): Promise<MessageRow[]> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error } = await client
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return data ?? [];
}

/**
 * Grava a mensagem e atualiza last_message_at da conversa. Se
 * external_message_id já existir (reentrega de webhook), o índice único
 * idx_messages_external_message_id rejeita o insert — trate o erro 23505
 * como deduplicação bem-sucedida, não como falha.
 */
export async function appendMessage(client: SupabaseDbClient, input: MessageInsert): Promise<MessageRow> {
  const { data, error } = await client.from("messages").insert(input).select("*").single();
  if (error) throw error;

  await client
    .from("conversations")
    .update({ last_message_at: data.created_at })
    .eq("id", input.conversation_id);

  return data;
}
