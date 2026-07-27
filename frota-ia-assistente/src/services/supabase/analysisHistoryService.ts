import { analysisRunCreateSchema } from "@/lib/validation/schemas";
import { toJson } from "@/lib/supabase/json";
import type { AnalysisRunRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function startAnalysisRun(
  client: SupabaseDbClient,
  companyId: string,
  input: unknown
): Promise<AnalysisRunRow> {
  const parsed = analysisRunCreateSchema.parse(input);

  const { data, error } = await client
    .from("analysis_runs")
    .insert({
      company_id: companyId,
      user_id: parsed.userId,
      vehicle_id: parsed.vehicleId,
      conversation_id: parsed.conversationId,
      analysis_type: parsed.analysisType,
      user_request: parsed.userRequest,
      input_snapshot: toJson(parsed.inputSnapshot),
      status: "started",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function completeAnalysisRun(
  client: SupabaseDbClient,
  analysisRunId: string,
  resultSummary: string,
  resultData: Record<string, unknown>
): Promise<AnalysisRunRow> {
  const { data, error } = await client
    .from("analysis_runs")
    .update({
      status: "completed",
      result_summary: resultSummary,
      result_data: toJson(resultData),
      completed_at: new Date().toISOString(),
    })
    .eq("id", analysisRunId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function failAnalysisRun(
  client: SupabaseDbClient,
  analysisRunId: string,
  errorCode: string,
  errorMessageSafe: string
): Promise<AnalysisRunRow> {
  const { data, error } = await client
    .from("analysis_runs")
    .update({
      status: "failed",
      error_code: errorCode,
      error_message_safe: errorMessageSafe,
      completed_at: new Date().toISOString(),
    })
    .eq("id", analysisRunId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function listAnalysisRuns(
  client: SupabaseDbClient,
  companyId: string,
  limit = 20
): Promise<AnalysisRunRow[]> {
  const { data, error } = await client
    .from("analysis_runs")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
