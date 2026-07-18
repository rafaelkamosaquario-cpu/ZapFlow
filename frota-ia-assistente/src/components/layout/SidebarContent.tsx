"use client";

import { useState } from "react";
import { MessageSquareText, SquarePen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatRelativeDate, truncate } from "@/lib/utils";
import type { Conversation } from "@/types";

interface SidebarContentProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export function SidebarContent({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: SidebarContentProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingConversation = conversations.find((c) => c.id === pendingDeleteId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start gap-2" onClick={onNewConversation}>
          <SquarePen className="size-4" aria-hidden />
          Nova conversa
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3">
        <p className="px-1 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Histórico
        </p>

        {conversations.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="Nenhuma conversa ainda"
            description="Suas conversas com o assistente vão aparecer aqui."
            className="py-8"
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;
              return (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded-lg pr-1",
                      isActive ? "bg-surface-muted" : "hover:bg-surface-muted"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectConversation(conversation.id)}
                      className="flex-1 truncate px-2.5 py-2 text-left text-sm text-foreground"
                      title={conversation.title}
                    >
                      <span className="block truncate">{truncate(conversation.title, 32)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatRelativeDate(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(conversation.id)}
                      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Excluir conversa: ${conversation.title}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={pendingConversation !== null}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingConversation) onDeleteConversation(pendingConversation.id);
        }}
        title="Excluir conversa"
        description={`Tem certeza que deseja excluir "${pendingConversation?.title ?? ""}"? Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        variant="danger"
      />
    </div>
  );
}
