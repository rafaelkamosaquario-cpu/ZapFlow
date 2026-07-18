import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Toast as ToastData } from "@/hooks/useToast";

const variantStyles: Record<NonNullable<ToastData["variant"]>, string> = {
  default: "border-border bg-surface text-foreground",
  success: "border-success/30 bg-surface text-foreground",
  error: "border-danger/30 bg-surface text-foreground",
};

const variantIcon = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
};

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const variant = toast.variant ?? "default";
  const Icon = variantIcon[variant];

  return (
    <div
      role="status"
      className={cn(
        "animate-fade-in-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-4 shadow-lg",
        variantStyles[variant]
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          variant === "success" && "text-success",
          variant === "error" && "text-danger",
          variant === "default" && "text-primary"
        )}
        aria-hidden
      />
      <div className="flex-1 text-sm">
        <p className="font-medium">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-muted-foreground">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Fechar notificação"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
