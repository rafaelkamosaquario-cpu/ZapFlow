import type { GeneratedDocumentRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export interface ListGeneratedDocumentsFilter {
  companyId: string;
  buscaTexto?: string;
  dataInicio?: string;
  dataFim?: string;
  limite?: number;
}

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

/** Espelha a mesma forma de filtro/paginação de consultar_historico (analysis_runs), aplicada a generated_documents. */
export async function listGeneratedDocuments(
  client: SupabaseDbClient,
  filtro: ListGeneratedDocumentsFilter
): Promise<{ itens: GeneratedDocumentRow[]; total: number }> {
  const limite = Math.min(Math.max(filtro.limite ?? 5, 1), 20);

  let query = client
    .from("generated_documents")
    .select("*", { count: "exact" })
    .eq("company_id", filtro.companyId)
    .order("created_at", { ascending: false })
    .limit(limite);

  if (filtro.dataInicio) query = query.gte("created_at", filtro.dataInicio);
  if (filtro.dataFim) query = query.lte("created_at", filtro.dataFim);
  if (filtro.buscaTexto && filtro.buscaTexto.trim()) {
    const termo = filtro.buscaTexto.trim();
    query = query.or(`title.ilike.%${termo}%,document_type.ilike.%${termo}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return { itens: data ?? [], total: count ?? (data?.length ?? 0) };
}
