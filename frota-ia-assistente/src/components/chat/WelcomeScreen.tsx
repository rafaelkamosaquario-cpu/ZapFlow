import { LogoMark } from "@/components/icons/Logo";
import { APP_TAGLINE } from "@/lib/constants";
import { SuggestionCards } from "./SuggestionCards";

interface WelcomeScreenProps {
  onSelectSuggestion: (prompt: string) => void;
}

export function WelcomeScreen({ onSelectSuggestion }: WelcomeScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8 px-4 py-10 text-center">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="size-14" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Como posso ajudar com sua frota hoje?
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">{APP_TAGLINE}</p>
        </div>
      </div>
      <SuggestionCards onSelect={onSelectSuggestion} />
    </div>
  );
}
