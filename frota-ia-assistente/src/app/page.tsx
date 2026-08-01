import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerContext } from "@/ai/context/customerContext";
import { checkCalendarConnection } from "@/services/google/googleCalendarService";
import { isCustomerPanelEnabled } from "@/lib/featureFlags";
import { HomeClient } from "./HomeClient";

/**
 * Painel web (V1 centrada no WhatsApp — Camada 6): a experiência do
 * cliente comum é 100% pelo WhatsApp agora. Esta rota continua existindo
 * (nada foi removido) para administração/testes/V2 — com
 * CUSTOMER_PANEL_ENABLED=false, só quem tem profiles.is_admin=true entra.
 */
export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  const context = await loadCustomerContext(supabase, data.user.id);

  if (!isCustomerPanelEnabled() && !context.profile?.is_admin) {
    redirect("/login?painel_indisponivel=1");
  }

  if (!context.company) {
    redirect("/onboarding");
  }

  // Veiculo e opcional (mesmo principio do onboarding via WhatsApp: coleta
  // progressiva, perguntada sob demanda pela IA quando uma ferramenta
  // precisar — ver systemPrompt.ts). Nunca gatear a entrada no painel por
  // ele existir ou nao, senao "Cadastrar depois" (skipVehicleAction) vira
  // um loop infinito com o redirect de onboarding/page.tsx.
  const calendarConnected = await checkCalendarConnection(data.user.id)
    .then((status) => status.connected)
    .catch(() => false);

  return <HomeClient calendarConnected={calendarConnected} />;
}
