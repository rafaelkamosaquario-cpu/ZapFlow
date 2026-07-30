import type { GeneratedDocumentRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export interface RecordGeneratedDocumentInput {
  companyId: string;
  userId: string;
  conversationId?: string;
  analysisRunId?: string;
  documentType: string;
  title: string;
  fileName: string;
  delivered: boolean;
}

/** Só o registro do que foi gerado — nunca guarda o PDF em si (ver src/services/documents/pdfGenerator.ts). */
export async function recordGeneratedDocument(
  client: SupabaseDbClient,
  input: RecordGeneratedDocumentInput
): Promise<GeneratedDocumentRow> {
  const { data, error } = await client
    .from("generated_documents")
    .insert({
      company_id: input.companyId,
      user_id: input.userId,
      conversation_id: input.conversationId,
      analysis_run_id: input.analysisRunId,
      document_type: input.documentType,
      title: input.title,
      file_name: input.fileName,
      delivered: input.delivered,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
