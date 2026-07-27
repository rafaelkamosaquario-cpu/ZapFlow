import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Client Supabase tipado, aceito por injeção em todos os services desta pasta. */
export type SupabaseDbClient = SupabaseClient<Database>;
