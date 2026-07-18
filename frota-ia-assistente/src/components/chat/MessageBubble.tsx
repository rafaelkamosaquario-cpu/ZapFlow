import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full animate-fade-in-up gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-surface-muted text-foreground" : "bg-primary text-primary-foreground"
        )}
      >
        {isUser ? <User className="size-4" aria-hidden /> : <Bot className="size-4" aria-hidden />}
      </div>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border border-border bg-surface text-foreground"
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
