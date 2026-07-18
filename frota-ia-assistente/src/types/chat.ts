export type MessageRole = "user" | "assistant";

export type MessageStatus = "sending" | "sent" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: MessageStatus;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionPrompt {
  id: string;
  label: string;
  prompt: string;
  icon: SuggestionIconName;
}

export type SuggestionIconName =
  | "truck"
  | "gauge"
  | "calculator"
  | "circleDot"
  | "trendingDown"
  | "wallet";
