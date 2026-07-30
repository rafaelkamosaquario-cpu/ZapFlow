import "server-only";
import { createCompanyWithOwner } from "@/services/supabase/companyService";
import { createVehicle } from "@/services/supabase/vehicleService";
import { saveMemory } from "@/services/supabase/memoryService";
import type { SupabaseDbClient } from "@/services/supabase/types";
import type { OnboardingCollectedData } from "./onboardingConversation";
import type { CompanyRow } from "@/lib/supabase/tables";
import { truncate } from "@/lib/utils";

/**
 * Transforma o rascunho do onboarding conversacional em dados reais —
 * reaproveita os mesmos services já usados pelo onboarding web (Fase 2),
 * nenhuma lógica de criação de empresa/veículo foi duplicada.
 *
 * A quantidade de veículos informada não tem coluna própria no schema —
 * vira uma memória estruturada (ai_memories) em vez de uma tabela nova,
 * já que é só um dado de contexto, não uma entidade operacional.
 */
export async function finalizeOnboarding(
  admin: SupabaseDbClient,
  userId: string,
  collectedData: OnboardingCollectedData
): Promise<CompanyRow> {
  const company = await createCompanyWithOwner(admin, userId, {
    name: collectedData.name ?? "Minha operação",
    companyType: collectedData.companyType ?? "autonomo",
    city: collectedData.baseCity,
    state: collectedData.baseState,
  });

  if (collectedData.vehicleCount && collectedData.vehicleCount > 0) {
    await saveMemory(admin, company.id, userId, {
      memoryType: "operational",
      key: "fleet_vehicle_count",
      valueJson: { count: collectedData.vehicleCount },
      summary: `Frota informada no onboarding: ${collectedData.vehicleCount} veículo(s).`,
      sourceType: "user_explicit",
      confirmedByUser: true,
    });
  }

  if (collectedData.primaryVehicleRaw && !collectedData.primaryVehicleSkipped) {
    await createVehicle(admin, company.id, userId, {
      name: truncate(collectedData.primaryVehicleRaw, 120),
      notes: collectedData.primaryVehicleRaw,
    }).catch(() => {
      // Texto livre pode não passar no schema estrito (ex.: excede algum
      // limite) — o onboarding já concluiu do ponto de vista do usuário,
      // então não travamos por causa do veículo opcional.
    });
  }

  return company;
}
