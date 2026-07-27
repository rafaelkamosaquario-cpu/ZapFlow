-- Camada 3 — Índices adicionais e constraints complementares.
-- Cada índice aqui tem uma justificativa de acesso real (FK, busca por
-- telefone, paginação de histórico, dedup, etc.) — não é indexação
-- indiscriminada de toda coluna.

-- ── company_members ──────────────────────────────────────────────────────

-- "quais empresas este usuário integra" além do índice único (company_id, user_id)
create index idx_company_members_user_id on public.company_members (user_id);

-- ── user_channels ────────────────────────────────────────────────────────

-- fluxo WhatsApp: localizar usuário rapidamente pelo telefone normalizado
create index idx_user_channels_phone_e164 on public.user_channels (phone_e164) where phone_e164 is not null;
create index idx_user_channels_user_id on public.user_channels (user_id);
create index idx_user_channels_company_id on public.user_channels (company_id) where company_id is not null;

-- ── profiles ─────────────────────────────────────────────────────────────

create index idx_profiles_phone_e164 on public.profiles (phone_e164) where phone_e164 is not null;

-- ── vehicles ─────────────────────────────────────────────────────────────

create index idx_vehicles_company_id on public.vehicles (company_id);
create index idx_vehicles_company_default on public.vehicles (company_id) where is_default;

-- ── vehicle_cost_profiles ────────────────────────────────────────────────

create index idx_vehicle_cost_profiles_company_id on public.vehicle_cost_profiles (company_id);
create index idx_vehicle_cost_profiles_vehicle_id on public.vehicle_cost_profiles (vehicle_id);

-- somente um perfil de custo ATIVO por veículo em uma mesma data —
-- exclusion constraint sobre o período [effective_from, effective_to].
create extension if not exists btree_gist;

alter table public.vehicle_cost_profiles
  add constraint vehicle_cost_profiles_no_active_overlap
  exclude using gist (
    vehicle_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
  where (active);

-- ── vehicle_tire_profiles ────────────────────────────────────────────────

create index idx_vehicle_tire_profiles_company_id on public.vehicle_tire_profiles (company_id);
create index idx_vehicle_tire_profiles_vehicle_id on public.vehicle_tire_profiles (vehicle_id);

-- ── saved_routes ─────────────────────────────────────────────────────────

create index idx_saved_routes_company_id on public.saved_routes (company_id);
create index idx_saved_routes_vehicle_id on public.saved_routes (vehicle_id) where vehicle_id is not null;
create index idx_saved_routes_user_id on public.saved_routes (user_id) where user_id is not null;
create index idx_saved_routes_favorite on public.saved_routes (company_id, is_favorite) where is_favorite;

-- ── conversations ────────────────────────────────────────────────────────

create index idx_conversations_company_id on public.conversations (company_id);
create index idx_conversations_user_id on public.conversations (user_id);
create index idx_conversations_channel_id on public.conversations (channel_id) where channel_id is not null;
create index idx_conversations_status on public.conversations (status);

-- ── messages ─────────────────────────────────────────────────────────────

-- paginação de histórico por conversa (nunca carregar tudo sem limite)
create index idx_messages_conversation_created on public.messages (conversation_id, created_at desc);
create index idx_messages_company_id on public.messages (company_id);

-- dedup por mensagem externa (evita reprocessar webhook duplicado da Z-API)
create unique index idx_messages_external_message_id on public.messages (external_message_id) where external_message_id is not null;

-- ── ai_memories ──────────────────────────────────────────────────────────

-- memórias ativas por empresa e tipo (consulta mais comum de contexto)
create index idx_ai_memories_company_type_status on public.ai_memories (company_id, memory_type, status) where status = 'active';
create index idx_ai_memories_user_id on public.ai_memories (user_id) where user_id is not null;
create index idx_ai_memories_vehicle_id on public.ai_memories (vehicle_id) where vehicle_id is not null;
create index idx_ai_memories_conversation_id on public.ai_memories (conversation_id) where conversation_id is not null;

-- ── analysis_runs ────────────────────────────────────────────────────────

create index idx_analysis_runs_company_id on public.analysis_runs (company_id);
create index idx_analysis_runs_user_id on public.analysis_runs (user_id);
create index idx_analysis_runs_vehicle_id on public.analysis_runs (vehicle_id) where vehicle_id is not null;
create index idx_analysis_runs_conversation_id on public.analysis_runs (conversation_id) where conversation_id is not null;
create index idx_analysis_runs_status on public.analysis_runs (status);

-- ── tool_executions ──────────────────────────────────────────────────────

create index idx_tool_executions_analysis_run_id on public.tool_executions (analysis_run_id) where analysis_run_id is not null;
create index idx_tool_executions_conversation_id on public.tool_executions (conversation_id) where conversation_id is not null;
create index idx_tool_executions_message_id on public.tool_executions (message_id) where message_id is not null;
create index idx_tool_executions_company_id on public.tool_executions (company_id);
create index idx_tool_executions_tool_name_created on public.tool_executions (tool_name, created_at desc);

-- ── google_integrations ──────────────────────────────────────────────────

create index idx_google_integrations_user_id on public.google_integrations (user_id);
create index idx_google_integrations_company_id on public.google_integrations (company_id) where company_id is not null;

-- ── calendar_action_logs ─────────────────────────────────────────────────

create index idx_calendar_action_logs_user_id on public.calendar_action_logs (user_id);
create index idx_calendar_action_logs_company_id on public.calendar_action_logs (company_id);
create index idx_calendar_action_logs_google_integration_id on public.calendar_action_logs (google_integration_id);
