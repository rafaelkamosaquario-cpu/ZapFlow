"use client";

import { useEffect, useState } from "react";
import { useChat } from "@/hooks/useChat";
import { useToast } from "@/hooks/useToast";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";
import { ChatInput } from "./ChatInput";
import type { ChatMessage, Conversation } from "@/types";

interface ChatWindowProps {
  conversation: Conversation | null;
  onPersist: (id: string, messages: ChatMessage[], titleHint?: string) => void;
}

export function ChatWindow({ conversation, onPersist }: ChatWindowProps) {
  const [draft, setDraft] = useState("");
  const { messages, isTyping, sendMessage, errorMessage } = useChat({ conversation, onPersist });
  const { showToast } = useToast();

  useEffect(() => {
    if (errorMessage) {
      showToast({ title: "Não foi possível responder", description: errorMessage, variant: "error" });
    }
  }, [errorMessage, showToast]);

  const handleSend = () => {
    if (!draft.trim()) return;
    sendMessage(draft);
    setDraft("");
  };

  const handleSelectSuggestion = (prompt: string) => {
    setDraft(prompt);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin px-4">
          <WelcomeScreen onSelectSuggestion={handleSelectSuggestion} />
        </div>
      ) : (
        <MessageList messages={messages} isTyping={isTyping} />
      )}
      <ChatInput value={draft} onChange={setDraft} onSend={handleSend} disabled={isTyping} />
    </div>
  );
}
