"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createMessage } from "@/services/messageService";
import { generateId } from "@/lib/utils";
import { PLACEHOLDER_RESPONSE } from "@/lib/constants";
import type { ChatMessage, Conversation } from "@/types";

const RESPONSE_DELAY_MS = 1100;
const EMPTY_MESSAGES: ChatMessage[] = [];

interface UseChatOptions {
  conversation: Conversation | null;
  onPersist: (id: string, messages: ChatMessage[], titleHint?: string) => void;
}

/**
 * Controla o envio de mensagens de uma conversa. As mensagens vêm sempre da
 * conversa ativa (fonte única de verdade); este hook só adiciona o estado
 * de "digitando" e a simulação de resposta.
 *
 * Fase 1: a "resposta" é sempre o texto fixo de PLACEHOLDER_RESPONSE. Na
 * Fase 2, o setTimeout abaixo é substituído pela chamada real a
 * aiService.requestAICompletion.
 */
export function useChat({ conversation, onPersist }: UseChatOptions) {
  const [isTyping, setIsTyping] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const messages = conversation?.messages ?? EMPTY_MESSAGES;

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isTyping) return;

      const conversationId = conversation?.id ?? generateId();
      const userMessage = createMessage("user", trimmed);
      const messagesWithUser = [...messages, userMessage];

      onPersist(conversationId, messagesWithUser, trimmed);
      setIsTyping(true);

      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        const assistantMessage = createMessage("assistant", PLACEHOLDER_RESPONSE);
        onPersist(conversationId, [...messagesWithUser, assistantMessage]);
        setIsTyping(false);
      }, RESPONSE_DELAY_MS);
    },
    [conversation?.id, messages, isTyping, onPersist]
  );

  return { messages, isTyping, sendMessage };
}
