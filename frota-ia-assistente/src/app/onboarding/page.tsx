import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerContext, loadVehicleContext } from "@/ai/context/customerContext";
import { OnboardingFlow } from "./OnboardingFlow";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  const context = await loadCustomerContext(supabase, data.user.id);

  if (context.company) {
    const vehicleContext = await loadVehicleContext(supabase, context.company.id);
    if (vehicleContext.vehicle) {
      redirect("/");
    }
  }

  return <OnboardingFlow companyName={context.company?.name ?? null} />;
}
