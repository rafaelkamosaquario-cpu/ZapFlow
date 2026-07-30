"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCompanyWithOwner } from "@/services/supabase/companyService";
import { createVehicle } from "@/services/supabase/vehicleService";
import { loadCustomerContext } from "@/ai/context/customerContext";

export interface OnboardingActionState {
  error?: string;
}

export async function createCompanyAction(
  _prevState: OnboardingActionState,
  formData: FormData
): Promise<OnboardingActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const companyType = String(formData.get("companyType") ?? "autonomo");

  if (!name) {
    return { error: "Informe o nome da empresa (ou o seu, se for autônomo)." };
  }

  try {
    await createCompanyWithOwner(supabase, data.user.id, {
      name,
      companyType: companyType as "autonomo" | "transportadora" | "embarcador" | "outro",
    });
  } catch (err) {
    const { data: sessionData } = await supabase.auth.getSession();
    const jwtPayload = sessionData.session
      ? JSON.parse(Buffer.from(sessionData.session.access_token.split(".")[1], "base64").toString("utf8"))
      : null;
    console.error("[onboarding] falha ao criar empresa", {
      userId: data.user.id,
      hasSession: Boolean(sessionData.session),
      jwtRole: jwtPayload?.role,
      jwtSub: jwtPayload?.sub,
      jwtAud: jwtPayload?.aud,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return { error: "Não foi possível salvar a empresa. Tente novamente." };
  }

  redirect("/onboarding");
}

export async function createVehicleAction(
  _prevState: OnboardingActionState,
  formData: FormData
): Promise<OnboardingActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const context = await loadCustomerContext(supabase, data.user.id);
  if (!context.company) {
    return { error: "Crie a empresa antes de cadastrar um veículo." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const plate = String(formData.get("plate") ?? "").trim();
  const vehicleType = String(formData.get("vehicleType") ?? "") || undefined;
  const fuelType = String(formData.get("fuelType") ?? "") || undefined;
  const consumptionRaw = String(formData.get("averageConsumptionKmL") ?? "").trim();

  if (!name && !plate) {
    return { error: "Informe ao menos um nome/apelido ou a placa do veículo." };
  }

  try {
    await createVehicle(supabase, context.company.id, data.user.id, {
      name: name || undefined,
      plate: plate || undefined,
      vehicleType,
      fuelType,
      averageConsumptionKmL: consumptionRaw ? Number(consumptionRaw) : undefined,
    });
  } catch {
    return { error: "Não foi possível salvar o veículo. Confira os dados e tente novamente." };
  }

  redirect("/");
}

export async function skipVehicleAction(): Promise<void> {
  redirect("/");
}
