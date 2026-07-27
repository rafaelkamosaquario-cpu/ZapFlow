-- Camada 3 — Metadados da integração com conta Google (login + futura Agenda).
-- Cria google_integrations e calendar_action_logs.
--
-- IMPORTANTE: nenhuma destas tabelas armazena access_token, refresh_token ou
-- client_secret. Esta V1 não tem mecanismo seguro de criptografia de token
-- disponível — persistir um provider refresh token fica pendente para a
-- Camada 4 (ver documentação da Camada 3). O que existe aqui é só metadado
-- não sensível: status da conexão, e-mail da conta, escopos concedidos e
-- registro (log) de ações de agenda.

create type public.google_connection_status as enum (
  'pending', 'connected', 'expired', 'revoked', 'error'
);

create type public.calendar_action_type as enum ('create', 'read', 'update', 'delete');

create type public.calendar_action_status as enum ('pending', 'success', 'failed');

-- ── google_integrations ──────────────────────────────────────────────────

create table public.google_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  google_account_email text not null,
  google_subject_id text,
  calendar_enabled boolean not null default false,
  default_calendar_id text,
  granted_scopes text[] not null default '{}',
  connection_status public.google_connection_status not null default 'pending',
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_integrations_unique_user_account unique (user_id, google_account_email)
);

comment on table public.google_integrations is
  'Metadados não sensíveis da conexão Google de um usuário. Tokens de acesso/refresh NÃO são persistidos aqui nesta fase (ver nota no topo do arquivo). connection_status reflete o estado da conexão sem expor credencial.';

create trigger set_updated_at
  before update on public.google_integrations
  for each row execute function public.set_updated_at();

-- ── calendar_action_logs ─────────────────────────────────────────────────

create table public.calendar_action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  google_integration_id uuid not null references public.google_integrations (id) on delete cascade,
  external_event_id text,
  action_type public.calendar_action_type not null,
  event_title text,
  event_start timestamptz,
  event_end timestamptz,
  timezone text,
  status public.calendar_action_status not null default 'pending',
  error_code text,
  created_at timestamptz not null default now(),
  constraint calendar_action_logs_event_period check (event_end is null or event_start is null or event_end >= event_start)
);

comment on table public.calendar_action_logs is
  'Log de ações de Google Calendar. Nesta V1 a Google Calendar API real ainda não é chamada — a tabela só está preparada para quando isso for autorizado (prioridade futura: criar evento e consultar próximos eventos; atualizar/excluir ficam para depois).';
