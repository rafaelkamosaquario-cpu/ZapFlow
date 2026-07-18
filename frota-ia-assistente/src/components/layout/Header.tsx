"use client";

import { Menu, SquarePen } from "lucide-react";
import { Logo, LogoMark } from "@/components/icons/Logo";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "./ThemeToggle";

interface HeaderProps {
  onOpenSidebar: () => void;
  onNewConversation: () => void;
}

export function Header({ onOpenSidebar, onNewConversation }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface/80 px-3 backdrop-blur-md sm:px-4">
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenSidebar}
          aria-label="Abrir menu"
        >
          <Menu className="size-5" aria-hidden />
        </Button>
        <LogoMark className="size-7 lg:hidden" />
        <Logo className="hidden lg:flex" />
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={onNewConversation} className="gap-1.5">
          <SquarePen className="size-4" aria-hidden />
          <span className="hidden sm:inline">Nova conversa</span>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
