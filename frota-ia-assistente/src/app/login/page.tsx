"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/icons/Logo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Loading";
import { useAuth } from "@/components/providers/AuthProvider";
import { signInWithGoogle } from "@/services/supabase/authService";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  async function handleGoogleLogin() {
    setError(null);
    setIsRedirecting(true);
    try {
      await signInWithGoogle("/auth/callback?next=/");
    } catch {
      setError("Não foi possível iniciar o login com Google. Verifique se o provider está configurado no Supabase.");
      setIsRedirecting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-5 flex justify-center">
          <LogoMark className="size-12" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Frota IA Assistente</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Entre para acessar sua frota, seus veículos e o histórico de conversas.
        </p>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="mt-7 w-full"
          onClick={handleGoogleLogin}
          isLoading={isRedirecting}
        >
          {!isRedirecting && <GoogleIcon />}
          Continuar com Google
        </Button>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {loading && (
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Verificando sessão…
          </div>
        )}
      </Card>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.74Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3a7.4 7.4 0 0 1-11-3.9H1.06v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.07 14.2a7.2 7.2 0 0 1 0-4.6V6.51H1.06a12 12 0 0 0 0 10.98l4.01-3.29Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.06 6.51l4.01 3.09A7.16 7.16 0 0 1 12 4.75Z"
      />
    </svg>
  );
}
