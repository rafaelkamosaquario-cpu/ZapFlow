import type { Database } from "./database.types";

/**
 * Aliases Row/Insert/Update para as tabelas da Camada 3, para não repetir
 * `Database["public"]["Tables"][...]` em todo service. Gerado a partir de
 * database.types.ts — atualizar junto quando os tipos forem regerados.
 */

type PublicTables = Database["public"]["Tables"];
type PublicEnums = Database["public"]["Enums"];

export type ProfileRow = PublicTables["profiles"]["Row"];
export type ProfileUpdate = PublicTables["profiles"]["Update"];

export type CompanyRow = PublicTables["companies"]["Row"];
export type CompanyInsert = PublicTables["companies"]["Insert"];
export type CompanyUpdate = PublicTables["companies"]["Update"];

export type CompanyMemberRow = PublicTables["company_members"]["Row"];
export type CompanyMemberInsert = PublicTables["company_members"]["Insert"];
export type CompanyMemberUpdate = PublicTables["company_members"]["Update"];

export type UserChannelRow = PublicTables["user_channels"]["Row"];
export type UserChannelInsert = PublicTables["user_channels"]["Insert"];
export type UserChannelUpdate = PublicTables["user_channels"]["Update"];

export type VehicleRow = PublicTables["vehicles"]["Row"];
export type VehicleInsert = PublicTables["vehicles"]["Insert"];
export type VehicleUpdate = PublicTables["vehicles"]["Update"];

export type VehicleCostProfileRow = PublicTables["vehicle_cost_profiles"]["Row"];
export type VehicleCostProfileInsert = PublicTables["vehicle_cost_profiles"]["Insert"];
export type VehicleCostProfileUpdate = PublicTables["vehicle_cost_profiles"]["Update"];

export type VehicleTireProfileRow = PublicTables["vehicle_tire_profiles"]["Row"];
export type VehicleTireProfileInsert = PublicTables["vehicle_tire_profiles"]["Insert"];
export type VehicleTireProfileUpdate = PublicTables["vehicle_tire_profiles"]["Update"];

export type SavedRouteRow = PublicTables["saved_routes"]["Row"];
export type SavedRouteInsert = PublicTables["saved_routes"]["Insert"];
export type SavedRouteUpdate = PublicTables["saved_routes"]["Update"];

export type CompanyPreferencesRow = PublicTables["company_preferences"]["Row"];
export type CompanyPreferencesInsert = PublicTables["company_preferences"]["Insert"];
export type CompanyPreferencesUpdate = PublicTables["company_preferences"]["Update"];

export type ConversationRow = PublicTables["conversations"]["Row"];
export type ConversationInsert = PublicTables["conversations"]["Insert"];
export type ConversationUpdate = PublicTables["conversations"]["Update"];

export type MessageRow = PublicTables["messages"]["Row"];
export type MessageInsert = PublicTables["messages"]["Insert"];

export type AiMemoryRow = PublicTables["ai_memories"]["Row"];
export type AiMemoryInsert = PublicTables["ai_memories"]["Insert"];
export type AiMemoryUpdate = PublicTables["ai_memories"]["Update"];

export type AnalysisRunRow = PublicTables["analysis_runs"]["Row"];
export type AnalysisRunInsert = PublicTables["analysis_runs"]["Insert"];
export type AnalysisRunUpdate = PublicTables["analysis_runs"]["Update"];

export type ToolExecutionRow = PublicTables["tool_executions"]["Row"];
export type ToolExecutionInsert = PublicTables["tool_executions"]["Insert"];
export type ToolExecutionUpdate = PublicTables["tool_executions"]["Update"];

export type GoogleIntegrationRow = PublicTables["google_integrations"]["Row"];
export type GoogleIntegrationInsert = PublicTables["google_integrations"]["Insert"];
export type GoogleIntegrationUpdate = PublicTables["google_integrations"]["Update"];

export type CalendarActionLogRow = PublicTables["calendar_action_logs"]["Row"];
export type CalendarActionLogInsert = PublicTables["calendar_action_logs"]["Insert"];

export type OnboardingSessionRow = PublicTables["onboarding_sessions"]["Row"];
export type OnboardingSessionInsert = PublicTables["onboarding_sessions"]["Insert"];
export type OnboardingSessionUpdate = PublicTables["onboarding_sessions"]["Update"];

export type CompanyMemberRole = PublicEnums["company_member_role"];
export type OnboardingState = PublicEnums["onboarding_state"];
export type VehicleTypeEnum = PublicEnums["vehicle_type"];
export type FuelTypeEnum = PublicEnums["fuel_type"];
export type TireCategoryEnum = PublicEnums["tire_category"];
export type AiMemoryTypeEnum = PublicEnums["ai_memory_type"];
export type AiMemorySourceTypeEnum = PublicEnums["ai_memory_source_type"];
export type FrotaIaToolName = PublicEnums["frota_ia_tool_name"];
export type RunStatus = PublicEnums["run_status"];
