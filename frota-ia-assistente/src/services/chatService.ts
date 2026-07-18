import type { Conversation } from "@/types";

/**
 * Camada de acesso a conversas. Fase 1: nenhuma persistência real —
 * apenas a interface que a Fase 2 irá implementar (API + banco).
 */

export async function listConversations(): Promise<Conversation[]> {
  throw new Error("chatService: persistência de conversas ainda não implementada (Fase 2).");
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  throw new Error(
    `chatService: persistência de conversas ainda não implementada (Fase 2). Conversa: ${conversation.id}.`
  );
}

export async function deleteConversation(conversationId: string): Promise<void> {
  throw new Error(
    `chatService: persistência de conversas ainda não implementada (Fase 2). Conversa: ${conversationId}.`
  );
}
