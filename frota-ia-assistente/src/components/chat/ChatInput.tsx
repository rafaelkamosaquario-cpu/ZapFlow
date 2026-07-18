"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

const MAX_HEIGHT_PX = 200;

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-surface/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-4 sm:pb-4">
      <div className="mx-auto flex w-full max-w-2xl items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte algo sobre sua frota…"
          rows={1}
          className="max-h-[200px] flex-1 border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
        />
        <Button
          type="button"
          size="icon"
          className="mb-0.5 rounded-full"
          disabled={!value.trim() || disabled}
          onClick={onSend}
          aria-label="Enviar mensagem"
        >
          <ArrowUp className="size-4.5" aria-hidden />
        </Button>
      </div>
      <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-muted-foreground">
        O Frota IA Assistente pode cometer erros. Verifique informações importantes.
      </p>
    </div>
  );
}
