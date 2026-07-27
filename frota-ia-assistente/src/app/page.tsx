import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerContext, loadVehicleContext } from "@/ai/context/customerContext";
import { checkCalendarConnection } from "@/services/google/googleCalendarService";
import { HomeClient } from "./HomeClient";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  const context = await loadCustomerContext(supabase, data.user.id);
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
