"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileSidebar } from "@/components/layout/MobileSidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { useConversations } from "@/hooks/useConversations";

export default function Home() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const {
    conversations,
    activeConversationId,
    activeConversation,
    startNewConversation,
    selectConversation,
    deleteConversation,
    persistConversation,
  } = useConversations();

  const sidebarProps = {
    conversations,
    activeConversationId,
    onSelectConversation: selectConversation,
    onNewConversation: startNewConversation,
    onDeleteConversation: deleteConversation,
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      <Header onOpenSidebar={() => setIsSidebarOpen(true)} onNewConversation={startNewConversation} />
      <div className="flex min-h-0 flex-1">
        <Sidebar {...sidebarProps} />
        <MobileSidebar open={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} {...sidebarProps} />
        <main className="flex min-h-0 flex-1 flex-col">
          <ChatWindow conversation={activeConversation} onPersist={persistConversation} />
        </main>
      </div>
    </div>
  );
}
