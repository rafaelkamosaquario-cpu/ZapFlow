import { createClient } from "@/lib/supabase/client";

/**
 * Login com Google via Supabase Auth. O client_secret do Google fica
 * configurado no painel do Supabase (Authentication > Providers > Google) —
 * nunca neste código. Ver docs/camada-3-supabase.md para o checklist manual
 * do Google Cloud Console.
 */
export async function signInWithGoogle(redirectPath = "/auth/callback") {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${redirectPath}`,
    },
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
