import { Bot } from "lucide-react";
import { TypingDots } from "@/components/ui/Loading";

export function TypingIndicator() {
  return (
    <div className="flex w-full animate-fade-in-up gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Bot className="size-4" aria-hidden />
      </div>
      <div className="flex items-center rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3">
        <TypingDots />
      </div>
    </div>
  );
}
