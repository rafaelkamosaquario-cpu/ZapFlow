import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} aria-hidden />;
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)} role="status" aria-label="Assistente digitando">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-1.5 animate-bounce-dot rounded-full bg-muted-foreground"
          style={{ animationDelay: `${dot * 0.15}s` }}
        />
      ))}
    </div>
  );
}
