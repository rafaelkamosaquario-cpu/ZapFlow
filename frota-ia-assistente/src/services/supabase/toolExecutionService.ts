import { toolExecutionCreateSchema } from "@/lib/validation/schemas";
import { toJson } from "@/lib/supabase/json";
import type { ToolExecutionRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

interface RecordToolExecutionResult {
  outputData: Record<string, unknown>;
  durationMs: number;
  errorCode?: string;
  errorMessageSafe?: string;
}

/**
 * Registra a execução de uma ferramenta já concluída (as 11 ferramentas em
 * src/ai/tools são síncronas e puras — não recalcula nada aqui, só grava
 * entrada/saída para auditoria e reaproveitamento de contexto).
 */
export async function recordToolExecution(
  client: SupabaseDbClient,
  companyId: string,
  input: unknown,
  result: RecordToolExecutionResult
): Promise<ToolExecutionRow> {
  const parsed = toolExecutionCreateSchema.parse(input);

  const { data, error } = await client
    .from("tool_executions")
    .insert({
      company_id: companyId,
      user_id: parsed.userId,
      analysis_run_id: parsed.analysisRunId,
      conversation_id: parsed.conversationId,
      message_id: parsed.messageId,
      tool_name: parsed.toolName,
      tool_version: parsed.toolVersion,
      input_data: toJson(parsed.inputData),
      output_data: toJson(result.outputData),
      status: result.errorCode ? "failed" : "completed",
      duration_ms: result.durationMs,
      error_code: result.errorCode,
      error_message_safe: result.errorMessageSafe,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function listToolExecutions(
  client: SupabaseDbClient,
  companyId: string,
  limit = 20
): Promise<ToolExecutionRow[]> {
  const { data, error } = await client
    .from("tool_executions")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
