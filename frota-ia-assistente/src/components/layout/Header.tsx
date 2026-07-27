"use client";

import { CalendarPlus, LogOut, Menu, SquarePen } from "lucide-react";
import { Logo, LogoMark } from "@/components/icons/Logo";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onOpenSidebar: () => void;
  onNewConversation: () => void;
  calendarConnected?: boolean;
  onLogout?: () => void;
}

export function Header({ onOpenSidebar, onNewConversation, calendarConnected, onLogout }: HeaderProps) {
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
        {calendarConnected === false && (
          <a
            href="/auth/calendar/connect"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-transparent px-3 text-sm font-medium text-foreground transition-colors duration-150",
              "hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            )}
          >
            <CalendarPlus className="size-4" aria-hidden />
            <span className="hidden sm:inline">Conectar Agenda</span>
          </a>
        )}
        <Button variant="outline" size="sm" onClick={onNewConversation} className="gap-1.5">
          <SquarePen className="size-4" aria-hidden />
          <span className="hidden sm:inline">Nova conversa</span>
        </Button>
        <ThemeToggle />
        {onLogout && (
          <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Sair">
            <LogOut className="size-4.5" aria-hidden />
          </Button>
        )}
      </div>
    </header>
  );
}
