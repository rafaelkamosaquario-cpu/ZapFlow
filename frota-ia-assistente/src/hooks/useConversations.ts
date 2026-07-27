"use client";

import { useEffect, useState } from "react";
import { deleteConversation as deleteConversationRemote, listConversationMessages, listConversations } from "@/services/chatService";
import { truncate } from "@/lib/utils";
import type { ChatMessage, Conversation } from "@/types";

/**
 * Gerencia a lista de conversas exibida na barra lateral (histórico).
 * Fase 2: backend real (Supabase, via chatService) — a lista vem do
 * servidor; as mensagens de cada conversa são buscadas sob demanda (só
 * quando ela vira a conversa ativa) e ficam em cache local aqui.
 */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>({});

  useEffect(() => {
    listConversations()
      .then(setConversations)
      .catch(() => setConversations([]));
  }, []);

  const activeConversationBase = conversations.find((c) => c.id === activeConversationId) ?? null;
  const activeConversation: Conversation | null = activeConversationBase
    ? { ...activeConversationBase, messages: messagesByConversation[activeConversationBase.id] ?? activeConversationBase.messages }
    : null;

  function startNewConversation() {
    setActiveConversationId(null);
  }

  function selectConversation(id: string) {
    setActiveConversationId(id);

    if (!(id in messagesByConversation)) {
      listConversationMessages(id)
        .then((messages) => {
          setMessagesByConversation((prev) => ({ ...prev, [id]: messages }));
        })
        .catch(() => {
          // Mantém a conversa selecionada mesmo se o histórico falhar ao
          // carregar — o usuário ainda pode enviar uma mensagem nova.
        });
    }
  }

  function deleteConversation(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setMessagesByConversation((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
    setActiveConversationId((current) => (current === id ? null : current));
    deleteConversationRemote(id).catch(() => {
      // Melhor esforço: se falhar no servidor, a conversa reaparece no
      // próximo carregamento da lista — não é uma perda de dado real.
    });
  }

  /**
   * Chamado pelo useChat depois que /api/chat já persistiu as mensagens no
   * servidor — aqui só atualiza o cache local para refletir na tela sem
   * precisar buscar de novo.
   */
  function persistConversation(id: string, messages: ChatMessage[], titleHint?: string) {
    setMessagesByConversation((prev) => ({ ...prev, [id]: messages }));

    setConversations((prev) => {
      const now = new Date().toISOString();
      const existing = prev.find((c) => c.id === id);

      if (existing) {
        const updated = { ...existing, updatedAt: now };
        return [updated, ...prev.filter((c) => c.id !== id)];
      }

      const created: Conversation = {
        id,
        title: titleHint ? truncate(titleHint, 48) : "Nova conversa",
        messages,
        createdAt: now,
        updatedAt: now,
      };
      return [created, ...prev];
    });

    setActiveConversationId(id);
  }

  return {
    conversations,
    activeConversationId,
    activeConversation,
    startNewConversation,
    selectConversation,
    deleteConversation,
    persistConversation,
  };
}
