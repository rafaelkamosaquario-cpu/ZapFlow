import type { ExpenseRow, ExpenseTypeEnum } from "@/lib/supabase/tables";
import type { SupabaseDbClient } from "./types";

export interface RecordExpenseInput {
  companyId: string;
  userId: string;
  conversationId?: string;
  vehicleId?: string;
  sourceMessageId?: string;
  expenseType: ExpenseTypeEnum;
  amount: number;
  /** Data da despesa (não a data de registro) — YYYY-MM-DD. */
  expenseDate: string;
  vendor?: string;
  description?: string;
}

export async function recordExpense(client: SupabaseDbClient, input: RecordExpenseInput): Promise<ExpenseRow> {
  const { data, error } = await client
    .from("expenses")
    .insert({
      company_id: input.companyId,
      user_id: input.userId,
      conversation_id: input.conversationId,
      vehicle_id: input.vehicleId,
      source_message_id: input.sourceMessageId,
      expense_type: input.expenseType,
      amount: input.amount,
      expense_date: input.expenseDate,
      vendor: input.vendor,
      description: input.description,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export interface ListExpensesFilter {
  companyId: string;
  vehicleId?: string;
  expenseType?: ExpenseTypeEnum;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export async function listExpenses(client: SupabaseDbClient, filter: ListExpensesFilter): Promise<ExpenseRow[]> {
  let query = client
    .from("expenses")
    .select("*")
    .eq("company_id", filter.companyId)
    .order("expense_date", { ascending: false })
    .limit(filter.limit ?? 50);

  if (filter.vehicleId) query = query.eq("vehicle_id", filter.vehicleId);
  if (filter.expenseType) query = query.eq("expense_type", filter.expenseType);
  if (filter.dateFrom) query = query.gte("expense_date", filter.dateFrom);
  if (filter.dateTo) query = query.lte("expense_date", filter.dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
