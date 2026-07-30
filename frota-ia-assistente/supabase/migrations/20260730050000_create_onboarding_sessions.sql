-- Camada 6 — Onboarding conversacional (WhatsApp-first) e flag de administrador.
-- Reaproveita profiles/companies/vehicles/user_channels já existentes desde
-- a Camada 3 — só adiciona o que realmente falta: o estado do onboarding
-- passo a passo e um jeito de distinguir usuário administrativo do painel.

create type public.onboarding_state as enum (
  'not_started',
  'awaiting_name',
  'awaiting_profile',
  'awaiting_base_location',
  'awaiting_vehicle_count',
  'awaiting_primary_vehicle',
  'completed',
  'paused'
);

create table public.onboarding_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  channel public.channel_type not null default 'whatsapp',
  state public.onboarding_state not null default 'not_started',
  collected_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.onboarding_sessions is
  'Estado do onboarding conversacional (uma pergunta por vez, pelo WhatsApp). collected_data guarda as respostas parciais antes de virar company/vehicle de verdade — nunca é a fonte definitiva desses dados, só o rascunho até completed.';

create trigger set_updated_at
  before update on public.onboarding_sessions
  for each row execute function public.set_updated_at();

alter table public.onboarding_sessions enable row level security;

create policy onboarding_sessions_select_own on public.onboarding_sessions
  for select using (user_id = auth.uid());

-- Sem policy de insert/update: hoje só o backend (client admin, service_role)
-- grava aqui, a partir do webhook do WhatsApp — nunca há sessão de navegador
-- nesse fluxo. Se o painel (V2) precisar editar isso pelo navegador, uma
-- policy de update "own row" entra numa migration futura, não antes de ser
-- realmente necessária.

-- ── Distinguir administrador (para a feature flag CUSTOMER_PANEL_ENABLED) ──

alter table public.profiles add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Acesso administrativo ao painel mesmo com CUSTOMER_PANEL_ENABLED=false. Nunca setado pelo próprio usuário — só via SQL direto por quem administra o projeto.';
