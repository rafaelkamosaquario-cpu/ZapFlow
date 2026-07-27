import type { ChatMessage, Conversation } from "@/types";

/**
 * Camada de acesso a conversas — Fase 2: fala com as rotas /api/conversations,
 * que usam o client Supabase autenticado (RLS garante o isolamento por
 * usuário/empresa). Mapeia as linhas do banco (snake_case) para os tipos de
 * UI (`Conversation`/`ChatMessage`) já usados pelos componentes de chat.
 */

interface ConversationRowLike {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRowLike {
  id: string;
  role: string;
  content: string | null;
  created_at: string;
}

function mapMessage(row: MessageRowLike): ChatMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content ?? "",
    createdAt: row.created_at,
    status: "sent",
  };
}

function mapConversation(row: ConversationRowLike, messages: ChatMessage[] = []): Conversation {
  return {
    id: row.id,
    title: row.title ?? "Nova conversa",
    messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function parseJsonOrThrow(response: Response, mensagemErro: string) {
  if (!response.ok) {
    throw new Error(mensagemErro);
  }
  return response.json();
}

export async function listConversations(): Promise<Conversation[]> {
  const response = await fetch("/api/conversations");
  const data = await parseJsonOrThrow(response, "Não foi possível carregar o histórico de conversas.");
  return (data.conversations as ConversationRowLike[]).map((row) => mapConversation(row));
}

export async function listConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  const response = await fetch(`/api/conversations/${conversationId}/messages`);
  const data = await parseJsonOrThrow(response, "Não foi possível carregar as mensagens desta conversa.");
  return (data.messages as MessageRowLike[]).map(mapMessage);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error("Não foi possível excluir esta conversa.");
  }
}
