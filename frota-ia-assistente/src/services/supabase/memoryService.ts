import { aiMemoryCreateSchema } from "@/lib/validation/schemas";
import { toJson } from "@/lib/supabase/json";
import type { AiMemoryRow, AiMemoryTypeEnum } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function listActiveMemories(
  client: SupabaseDbClient,
  companyId: string,
  memoryType?: AiMemoryTypeEnum
): Promise<AiMemoryRow[]> {
  let query = client
    .from("ai_memories")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "active");

  if (memoryType) query = query.eq("memory_type", memoryType);

  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Salva uma memória nova. Se já existir uma memória ATIVA com a mesma
 * (company_id, memory_type, key), marca a antiga como 'superseded' em vez
 * de sobrescrever silenciosamente — histórico de correções fica preservado.
 */
export async function saveMemory(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: unknown
): Promise<AiMemoryRow> {
  const parsed = aiMemoryCreateSchema.parse(input);

  const { data: previous, error: findError } = await client
    .from("ai_memories")
    .select("id")
    .eq("company_id", companyId)
    .eq("memory_type", parsed.memoryType)
    .eq("key", parsed.key)
    .eq("status", "active")
    .maybeSingle();

  if (findError) throw findError;

  if (previous) {
    const { error: supersedeError } = await client
      .from("ai_memories")
      .update({ status: "superseded", updated_by: userId })
      .eq("id", previous.id);
    if (supersedeError) throw supersedeError;
  }

  const { data, error } = await client
    .from("ai_memories")
    .insert({
      company_id: companyId,
      user_id: parsed.userId,
      vehicle_id: parsed.vehicleId,
      conversation_id: parsed.conversationId,
      memory_type: parsed.memoryType,
      key: parsed.key,
      value_json: toJson(parsed.valueJson),
      summary: parsed.summary,
      source_type: parsed.sourceType,
      source_message_id: parsed.sourceMessageId,
      confidence: parsed.confidence,
      confirmed_by_user: parsed.confirmedByUser ?? false,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function rejectMemory(client: SupabaseDbClient, memoryId: string, userId: string): Promise<void> {
  const { error } = await client
    .from("ai_memories")
    .update({ status: "rejected", updated_by: userId })
    .eq("id", memoryId);
  if (error) throw error;
}

/** Soft delete: nunca remove a linha, só marca status = 'deleted'. */
export async function deleteMemory(client: SupabaseDbClient, memoryId: string, userId: string): Promise<void> {
  const { error } = await client
    .from("ai_memories")
    .update({ status: "deleted", updated_by: userId })
    .eq("id", memoryId);
  if (error) throw error;
}
