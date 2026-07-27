-- Camada 3 — Conversas, memória operacional e execuções de ferramentas.
-- Cria conversations, messages, ai_memories, analysis_runs e tool_executions.

-- ── Enums ────────────────────────────────────────────────────────────────

create type public.conversation_status as enum ('open', 'closed', 'archived');

create type public.message_role as enum ('user', 'assistant', 'system', 'tool');

create type public.message_direction as enum ('inbound', 'outbound', 'internal');

create type public.ai_memory_type as enum (
  'profile', 'vehicle', 'cost', 'tire', 'route', 'preference', 'operational', 'other'
);

create type public.ai_memory_source_type as enum (
  'user_explicit', 'conversation', 'calculation', 'system'
);

create type public.ai_memory_status as enum ('active', 'superseded', 'rejected', 'deleted');

create type public.run_status as enum ('started', 'completed', 'failed', 'cancelled');

-- Nomes reais das 11 ferramentas internas (src/ai/tools/*.ts), usados para
-- validar tool_executions.tool_name. Atualizar esta lista junto com o
-- registro em src/ai/tools/index.ts caso uma ferramenta seja renomeada ou
-- uma nova seja adicionada.
create type public.frota_ia_tool_name as enum (
  'analisar_frete',
  'calcular_combustivel',
  'calcular_cpk',
  'comparar_pneus',
  'calcular_custo_viagem',
  'calcular_margem',
  'calcular_valor_minimo_frete',
  'calcular_receita_km',
  'calcular_custo_dia',
  'calcular_custo_veiculo_parado',
  'calcular_jornada'
);

-- ── conversations ────────────────────────────────────────────────────────

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid references public.user_channels (id) on delete set null,
  external_conversation_id text,
  title text,
  status public.conversation_status not null default 'open',
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.conversations is
  'Uma conversa (WhatsApp ou web) entre um usuário e o Frota IA, sempre associada a uma empresa.';

create trigger set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ── messages ─────────────────────────────────────────────────────────────

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  role public.message_role not null,
  direction public.message_direction not null,
  external_message_id text,
  content text,
  content_type text not null default 'text',
  tool_call_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.messages is
  'Mensagens de uma conversa. Não guarda o prompt mestre completo nem segredos. external_message_id permite deduplicar mensagens vindas da Z-API. Sem select(*) em listas de histórico — sempre paginado pelo service.';

-- ── ai_memories ──────────────────────────────────────────────────────────

create table public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  memory_type public.ai_memory_type not null,
  key text not null,
  value_json jsonb not null default '{}'::jsonb,
  summary text,
  source_type public.ai_memory_source_type not null,
  source_message_id uuid references public.messages (id) on delete set null,
  confidence numeric,
  status public.ai_memory_status not null default 'active',
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  confirmed_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  constraint ai_memories_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint ai_memories_valid_period check (valid_until is null or valid_until >= valid_from)
);

comment on table public.ai_memories is
  'Fatos duradouros úteis sobre o cliente, complementares às tabelas estruturadas (vehicles, vehicle_cost_profiles, vehicle_tire_profiles, saved_routes já são preferidas para esse tipo de dado). Memórias inferidas têm confidence e podem ser supersededs, rejeitadas ou apagadas — nunca sobrescritas silenciosamente. Não é para gravar toda frase do usuário.';

create trigger set_updated_at
  before update on public.ai_memories
  for each row execute function public.set_updated_at();

-- ── analysis_runs ────────────────────────────────────────────────────────

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  analysis_type text not null,
  user_request text,
  input_snapshot jsonb not null default '{}'::jsonb,
  result_summary text,
  result_data jsonb,
  status public.run_status not null default 'started',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  error_message_safe text,
  created_at timestamptz not null default now()
);

comment on table public.analysis_runs is
  'Registro de uma análise pedida pelo cliente (pode envolver uma ou mais ferramentas). input_snapshot/result_data são cópias dos dados usados/gerados — não recalcula nada, apenas registra o que as ferramentas já calcularam.';

-- ── tool_executions ──────────────────────────────────────────────────────

create table public.tool_executions (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid references public.analysis_runs (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  tool_name public.frota_ia_tool_name not null,
  tool_version text,
  input_data jsonb not null default '{}'::jsonb,
  output_data jsonb,
  status public.run_status not null default 'started',
  duration_ms integer,
  error_code text,
  error_message_safe text,
  created_at timestamptz not null default now(),
  constraint tool_executions_duration_non_negative check (duration_ms is null or duration_ms >= 0)
);

comment on table public.tool_executions is
  'Registra a execução de uma das 11 ferramentas puras de src/ai/tools — não recalcula nada aqui, só guarda entrada/saída para auditoria e reaproveitamento de contexto. tool_name é restrito por enum aos nomes reais das ferramentas.';

-- messages.tool_call_id só pode ser adicionado como FK depois que
-- tool_executions existe (evita referência para a frente dentro da mesma migration).
alter table public.messages
  add constraint messages_tool_call_id_fkey
  foreign key (tool_call_id) references public.tool_executions (id) on delete set null;
