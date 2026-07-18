"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { SidebarContent } from "./SidebarContent";
import { Logo } from "@/components/icons/Logo";
import { cn } from "@/lib/utils";
import { useHasMounted } from "@/hooks/useHasMounted";
import type { Conversation } from "@/types";

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export function MobileSidebar({ open, onClose, ...contentProps }: MobileSidebarProps) {
  const hasMounted = useHasMounted();

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!hasMounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 lg:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col border-r border-border bg-surface shadow-xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Histórico de conversas"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <Logo iconClassName="size-7" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            aria-label="Fechar menu"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <SidebarContent
          {...contentProps}
          onSelectConversation={(id) => {
            contentProps.onSelectConversation(id);
            onClose();
          }}
          onNewConversation={() => {
            contentProps.onNewConversation();
            onClose();
          }}
        />
      </div>
    </div>,
    document.body
  );
}
