import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerContext, loadVehicleContext } from "@/ai/context/customerContext";
import { isCustomerPanelEnabled } from "@/lib/featureFlags";
import { OnboardingFlow } from "./OnboardingFlow";

/**
 * Onboarding pelo painel web — mantido no código para administração/testes/V2
 * (ver src/app/page.tsx). Na V1, o onboarding de clientes acontece pelo
 * WhatsApp (src/ai/whatsapp/onboardingConversation.ts), não aqui.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  const context = await loadCustomerContext(supabase, data.user.id);

  if (!isCustomerPanelEnabled() && !context.profile?.is_admin) {
    redirect("/login?painel_indisponivel=1");
  }

  if (context.company) {
    const vehicleContext = await loadVehicleContext(supabase, context.company.id);
    if (vehicleContext.vehicle) {
      redirect("/");
    }
  }

  return <OnboardingFlow companyName={context.company?.name ?? null} />;
}
