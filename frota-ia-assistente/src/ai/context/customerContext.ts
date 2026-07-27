import { z } from "zod";
import { aiMemoryCreateSchema } from "@/lib/validation/schemas";
import { getProfile } from "@/services/supabase/profileService";
import { getOrCreatePreferences } from "@/services/supabase/companyPreferencesService";
import { getVehicle, resolveDefaultVehicle as resolveDefaultVehicleRow } from "@/services/supabase/vehicleService";
import { getActiveCostProfile } from "@/services/supabase/vehicleCostProfileService";
import { listTireProfiles } from "@/services/supabase/vehicleTireProfileService";
import { saveMemory } from "@/services/supabase/memoryService";
import { recordToolExecution } from "@/services/supabase/toolExecutionService";
import type { SupabaseDbClient } from "@/services/supabase/types";
import type {
  CompanyMemberRole,
  CompanyPreferencesRow,
  CompanyRow,
  ProfileRow,
  VehicleCostProfileRow,
  VehicleRow,
  VehicleTireProfileRow,
} from "@/lib/supabase/tables";
import type { FrotaIaToolName } from "@/lib/supabase/tables";

/**
 * Camada de contexto entre o Supabase e as 11 ferramentas puras de
 * src/ai/tools. Nenhuma ferramenta importa isto — é sempre o chamador
 * (rota da API / fluxo do WhatsApp) que monta a `entrada` da ferramenta a
 * partir do que este módulo carrega. Isso preserva as ferramentas puras e
 * testáveis (ver src/ai/tools/README.md).
 *
 * Precedência ao resolver um valor (nunca inventar um dado faltante):
 * 1. valor informado na mensagem atual;
 * 2. valor confirmado recentemente pelo usuário;
 * 3. perfil ativo do veículo (vehicle_cost_profiles / vehicle_tire_profiles);
 * 4. preferência da empresa (company_preferences);
 * 5. memória ativa confiável (ai_memories);
 * 6. perguntar ao usuário.
 * Esse merge é responsabilidade de quem monta a entrada da ferramenta —
 * este módulo só entrega os dados brutos de cada camada.
 */

export interface CustomerContext {
  profile: ProfileRow | null;
  company: CompanyRow | null;
  role: CompanyMemberRole | null;
  preferences: CompanyPreferencesRow | null;
}

export async function loadCustomerContext(client: SupabaseDbClient, userId: string): Promise<CustomerContext> {
  const profile = await getProfile(client, userId);

  const { data: membership, error } = await client
    .from("company_members")
    .select("role, companies(*)")
    .eq("user_id", userId)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;

  if (!membership || !membership.companies) {
    return { profile, company: null, role: null, preferences: null };
  }

  const company = membership.companies as CompanyRow;
  const preferences = await getOrCreatePreferences(client, company.id);

  return { profile, company, role: membership.role, preferences };
}

export interface VehicleContext {
  vehicle: VehicleRow | null;
  costProfile: VehicleCostProfileRow | null;
  tireProfiles: VehicleTireProfileRow[];
}

/** Se vehicleId não for informado, usa o veículo padrão (is_default) da empresa. */
export async function loadVehicleContext(
  client: SupabaseDbClient,
  companyId: string,
  vehicleId?: string
): Promise<VehicleContext> {
  const vehicle = vehicleId ? await getVehicle(client, vehicleId) : await resolveDefaultVehicleRow(client, companyId);

  if (!vehicle) {
    return { vehicle: null, costProfile: null, tireProfiles: [] };
  }

  const [costProfile, tireProfiles] = await Promise.all([
    getActiveCostProfile(client, vehicle.id),
    listTireProfiles(client, vehicle.id),
  ]);

  return { vehicle, costProfile, tireProfiles };
}

export const resolveDefaultVehicle = resolveDefaultVehicleRow;

export { startAnalysisRun as saveAnalysisRun } from "@/services/supabase/analysisHistoryService";

/**
 * Executa uma das 11 ferramentas puras e registra a execução em
 * tool_executions, medindo a duração real. Não altera o resultado da
 * ferramenta de forma alguma — só mede e grava em volta dela.
 */
export async function saveToolExecution<TSaida>(
  client: SupabaseDbClient,
  companyId: string,
  params: {
    userId: string;
    toolName: FrotaIaToolName;
    inputData: Record<string, unknown>;
    analysisRunId?: string;
    conversationId?: string;
    messageId?: string;
    toolVersion?: string;
  },
  executar: () => TSaida
): Promise<TSaida> {
  const start = performance.now();

  try {
    const output = executar();
    const durationMs = Math.round(performance.now() - start);

    await recordToolExecution(
      client,
      companyId,
      {
        userId: params.userId,
        toolName: params.toolName,
        inputData: params.inputData,
        analysisRunId: params.analysisRunId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        toolVersion: params.toolVersion,
      },
      { outputData: output as Record<string, unknown>, durationMs }
    );

    return output;
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);

    await recordToolExecution(
      client,
      companyId,
      {
        userId: params.userId,
        toolName: params.toolName,
        inputData: params.inputData,
        analysisRunId: params.analysisRunId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        toolVersion: params.toolVersion,
      },
      {
        outputData: {},
        durationMs,
        errorCode: "EXECUTION_ERROR",
        errorMessageSafe: "Falha ao executar a ferramenta. Detalhes técnicos não são persistidos aqui por segurança.",
      }
    );

    throw err;
  }
}

type ConfirmedMemoryInput = Omit<z.infer<typeof aiMemoryCreateSchema>, "sourceType" | "confirmedByUser">;

/** Variante de saveMemory para quando o cliente confirmou o dado explicitamente. */
export async function saveConfirmedMemory(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: ConfirmedMemoryInput
) {
  return saveMemory(client, companyId, userId, {
    ...input,
    sourceType: "user_explicit",
    confirmedByUser: true,
  });
}
