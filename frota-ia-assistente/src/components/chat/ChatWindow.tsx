"use client";

import { useState } from "react";
import { useChat } from "@/hooks/useChat";
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
  const { messages, isTyping, sendMessage } = useChat({ conversation, onPersist });

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
