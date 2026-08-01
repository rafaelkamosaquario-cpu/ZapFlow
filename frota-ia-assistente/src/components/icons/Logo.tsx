import Image from "next/image";
import { cn } from "@/lib/utils";

/** Logo oficial (public/frota-ia-logo.jpg) — caminhão + circuito + mapa do Brasil, fundo circular escuro. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/frota-ia-logo.jpg"
      alt="Frota IA"
      width={64}
      height={64}
      className={cn("size-8 rounded-full object-cover", className)}
      priority
    />
  );
}

export function Logo({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className={iconClassName} />
      <span className="text-base font-semibold tracking-tight text-foreground">
        Frota IA <span className="font-normal text-muted-foreground">Assistente</span>
      </span>
    </div>
  );
}
