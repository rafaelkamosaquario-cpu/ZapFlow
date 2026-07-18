"use client";

import { SidebarContent } from "./SidebarContent";
import type { Conversation } from "@/types";

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-border bg-surface lg:flex lg:flex-col">
      <SidebarContent {...props} />
    </aside>
  );
}
