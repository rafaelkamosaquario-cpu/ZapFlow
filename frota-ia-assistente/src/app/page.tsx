import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerContext, loadVehicleContext } from "@/ai/context/customerContext";
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

  const vehicleContext = await loadVehicleContext(supabase, context.company.id);
  if (!vehicleContext.vehicle) {
    redirect("/onboarding");
  }

  const calendarConnected = await checkCalendarConnection(data.user.id)
    .then((status) => status.connected)
    .catch(() => false);

  return <HomeClient calendarConnected={calendarConnected} />;
}
