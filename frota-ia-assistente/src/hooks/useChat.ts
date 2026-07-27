"use client";

import { useState } from "react";
import { requestAICompletion } from "@/services/aiService";
import type { ChatMessage, Conversation } from "@/types";

const EMPTY_MESSAGES: ChatMessage[] = [];

interface UseChatOptions {
  conversation: Conversation | null;
  onPersist: (id: string, messages: ChatMessage[], titleHint?: string) => void;
}

/**
 * Controla o envio de mensagens de uma conversa. Fase 2: chama a Claude API
 * de verdade (via aiService -> /api/chat). O servidor já persiste as
 * mensagens no Supabase — este hook só mantém a mensagem do usuário
 * otimista na tela enquanto espera a resposta, e repassa o resultado final
 * para `onPersist` (que atualiza o cache local em useConversations).
 */
export function useChat({ conversation, onPersist }: UseChatOptions) {
  const [isTyping, setIsTyping] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const persistedMessages = conversation?.messages ?? EMPTY_MESSAGES;
  const messages = pendingUserMessage ? [...persistedMessages, pendingUserMessage] : persistedMessages;

  const conversationId = conversation?.id;

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || isTyping) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      status: "sending",
    };

    setPendingUserMessage(userMessage);
    setErrorMessage(null);
    setIsTyping(true);

    try {
      const response = await requestAICompletion({ conversationId, message: trimmed });

      const confirmedUserMessage: ChatMessage = { ...userMessage, status: "sent" };
      const assistantMessage: ChatMessage = {
        id: response.message.id,
        role: "assistant",
        content: response.message.content,
        createdAt: response.message.createdAt,
        status: "sent",
      };

      onPersist(response.conversationId, [...persistedMessages, confirmedUserMessage, assistantMessage], trimmed);
      setPendingUserMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Não foi possível enviar a mensagem.");
      setPendingUserMessage((current) => (current ? { ...current, status: "error" } : current));
    } finally {
      setIsTyping(false);
    }
  }

  return { messages, isTyping, sendMessage, errorMessage };
}
