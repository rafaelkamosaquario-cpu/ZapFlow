/**
 * Camada de integração com o provedor de IA (Claude API).
 * Fase 2: chama a rota /api/chat (server-side, onde a ANTHROPIC_API_KEY
 * vive) — nunca fala com a Anthropic diretamente do navegador.
 */

export interface AICompletionRequest {
  conversationId?: string;
  message: string;
}

export interface AICompletionResponse {
  conversationId: string;
  message: {
    id: string;
    content: string;
    createdAt: string;
  };
}

export async function requestAICompletion(request: AICompletionRequest): Promise<AICompletionResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Não foi possível obter resposta do Frota IA agora.");
  }

  return response.json();
}
