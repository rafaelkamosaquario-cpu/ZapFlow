import type { Conversation } from "@/types";

/**
 * Histórico simulado exibido na barra lateral nesta fase. Sem persistência
 * real — serve apenas para validar a experiência visual do histórico.
 */
export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "mock-1",
    title: "Como calcular CPK?",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    messages: [
      {
        id: "mock-1-1",
        role: "user",
        content: "Como calcular CPK?",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
        status: "sent",
      },
      {
        id: "mock-1-2",
        role: "assistant",
        content: "Em breve este assistente será conectado à inteligência artificial.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5 + 2000).toISOString(),
        status: "sent",
      },
    ],
  },
  {
    id: "mock-2",
    title: "Esse frete compensa?",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    messages: [
      {
        id: "mock-2-1",
        role: "user",
        content: "Esse frete compensa?",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
        status: "sent",
      },
      {
        id: "mock-2-2",
        role: "assistant",
        content: "Em breve este assistente será conectado à inteligência artificial.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26 + 2000).toISOString(),
        status: "sent",
      },
    ],
  },
  {
    id: "mock-3",
    title: "Recapar ou comprar pneu novo",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    messages: [
      {
        id: "mock-3-1",
        role: "user",
        content: "Vale mais a pena recapar ou comprar um pneu novo?",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
        status: "sent",
      },
      {
        id: "mock-3-2",
        role: "assistant",
        content: "Em breve este assistente será conectado à inteligência artificial.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4 + 2000).toISOString(),
        status: "sent",
      },
    ],
  },
];
