import type { ChatMessage, MessageRole } from "@/types";
import { generateId } from "@/lib/utils";

/**
 * Fábrica e utilitários de mensagens. Fase 1: geração local apenas,
 * sem persistência remota — preparado para ser trocado por chamadas
 * de API na Fase 2.
 */

export function createMessage(role: MessageRole, content: string): ChatMessage {
  return {
    id: generateId(),
    role,
    content,
    createdAt: new Date().toISOString(),
    status: "sent",
  };
}
