"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileSidebar } from "@/components/layout/MobileSidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { useConversations } from "@/hooks/useConversations";
import { signOut } from "@/services/supabase/authService";

interface HomeClientProps {
  calendarConnected: boolean;
}

export function HomeClient({ calendarConnected }: HomeClientProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const router = useRouter();
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

  async function handleLogout() {
    await signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <Header
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onNewConversation={startNewConversation}
        calendarConnected={calendarConnected}
        onLogout={handleLogout}
      />
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
