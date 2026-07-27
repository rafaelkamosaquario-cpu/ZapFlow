import { companyCreateSchema, companyUpdateSchema } from "@/lib/validation/schemas";
import type { CompanyRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

/**
 * Cria uma empresa e o vínculo owner do criador. Não é atômico (duas
 * chamadas separadas) — se o segundo passo falhar, a empresa fica sem
 * membro e vira inacessível por RLS até alguém com service role corrigir.
 * Aceitável para a V1; documentado como limitação conhecida.
 */
export async function createCompanyWithOwner(
  client: SupabaseDbClient,
  userId: string,
  input: unknown
): Promise<CompanyRow> {
  const parsed = companyCreateSchema.parse(input);

  const { data: company, error: companyError } = await client
    .from("companies")
    .insert({
      name: parsed.name,
      trade_name: parsed.tradeName,
      document_type: parsed.documentType,
      document_number: parsed.documentNumber,
      company_type: parsed.companyType,
      city: parsed.city,
      state: parsed.state,
      country_code: parsed.countryCode,
      timezone: parsed.timezone,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();

  if (companyError) throw companyError;

  const { error: memberError } = await client.from("company_members").insert({
    company_id: company.id,
    user_id: userId,
    role: "owner",
    is_default: true,
  });

  if (memberError) throw memberError;

  return company;
}

export async function getCompany(client: SupabaseDbClient, companyId: string): Promise<CompanyRow | null> {
  const { data, error } = await client.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listMyCompanies(client: SupabaseDbClient): Promise<CompanyRow[]> {
  const { data, error } = await client.from("companies").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function updateCompany(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  input: unknown
): Promise<CompanyRow> {
  const parsed = companyUpdateSchema.parse(input);

  const { data, error } = await client
    .from("companies")
    .update({
      name: parsed.name,
      trade_name: parsed.tradeName,
      document_type: parsed.documentType,
      document_number: parsed.documentNumber,
      company_type: parsed.companyType,
      city: parsed.city,
      state: parsed.state,
      country_code: parsed.countryCode,
      timezone: parsed.timezone,
      updated_by: userId,
    })
    .eq("id", companyId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
