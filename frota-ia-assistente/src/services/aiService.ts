import type { ChatMessage } from "@/types";

/**
 * Camada de integração com o provedor de IA (Claude API).
 * Fase 1: apenas a interface. Nenhuma chamada real é feita ainda.
 */

export interface AICompletionRequest {
  messages: ChatMessage[];
}

export interface AICompletionResponse {
  content: string;
}

export async function requestAICompletion(
  request: AICompletionRequest
): Promise<AICompletionResponse> {
  throw new Error(
    `aiService: integração com IA ainda não implementada (Fase 2). Recebeu ${request.messages.length} mensagem(ns).`
  );
}
