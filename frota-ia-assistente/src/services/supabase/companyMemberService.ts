import type { CompanyMemberRole, CompanyMemberRow } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export async function listMembers(client: SupabaseDbClient, companyId: string): Promise<CompanyMemberRow[]> {
  const { data, error } = await client
    .from("company_members")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

/** Só funciona se o chamador for owner/admin da empresa (garantido por RLS). */
export async function inviteMember(
  client: SupabaseDbClient,
  companyId: string,
  userId: string,
  role: CompanyMemberRole = "operator"
): Promise<CompanyMemberRow> {
  const { data, error } = await client
    .from("company_members")
    .insert({ company_id: companyId, user_id: userId, role })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateMemberRole(
  client: SupabaseDbClient,
  memberId: string,
  role: CompanyMemberRole
): Promise<CompanyMemberRow> {
  const { data, error } = await client
    .from("company_members")
    .update({ role })
    .eq("id", memberId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function removeMember(client: SupabaseDbClient, memberId: string): Promise<void> {
  const { error } = await client.from("company_members").delete().eq("id", memberId);
  if (error) throw error;
}

/** Marca companyId como empresa padrão do usuário (o trigger cuida de zerar os outros is_default). */
export async function setDefaultCompany(
  client: SupabaseDbClient,
  userId: string,
  companyId: string
): Promise<void> {
  const { error } = await client
    .from("company_members")
    .update({ is_default: true })
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) throw error;
}
