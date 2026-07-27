-- Camada 3 — RLS e isolamento multiempresa.
-- Habilita RLS em todas as tabelas com dados de usuário/empresa criadas nas
-- migrations anteriores e cria as policies. Funções auxiliares são
-- SECURITY DEFINER com search_path fixo para evitar recursão de RLS ao
-- consultar company_members a partir de uma policy sobre a própria tabela.

-- ── Funções auxiliares ───────────────────────────────────────────────────

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  );
$$;

comment on function public.is_company_member(uuid) is
  'True se o usuário autenticado é membro ativo da empresa informada. SECURITY DEFINER para evitar recursão de RLS sobre company_members.';

create or replace function public.has_company_role(target_company_id uuid, allowed_roles public.company_member_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = any(allowed_roles)
  );
$$;

comment on function public.has_company_role(uuid, public.company_member_role[]) is
  'True se o usuário autenticado é membro ativo da empresa com um dos papéis informados. SECURITY DEFINER para evitar recursão de RLS.';

create or replace function public.default_company_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select cm.company_id
  from public.company_members cm
  where cm.user_id = auth.uid()
    and cm.is_default = true
    and cm.status = 'active'
  limit 1;
$$;

comment on function public.default_company_id() is
  'Empresa padrão (is_default = true) do usuário autenticado, ou null se não houver.';

-- ── profiles ─────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Sem policy de insert/delete: o profile nasce só pelo trigger
-- on_auth_user_created (SECURITY DEFINER, ignora RLS). Operações
-- administrativas ficam restritas ao backend com service role.

-- ── companies ────────────────────────────────────────────────────────────

alter table public.companies enable row level security;

create policy companies_select_member on public.companies
  for select using (public.is_company_member(id));

create policy companies_insert_authenticated on public.companies
  for insert with check (auth.uid() is not null);

create policy companies_update_admin on public.companies
  for update using (public.has_company_role(id, array['owner', 'admin']::public.company_member_role[]))
  with check (public.has_company_role(id, array['owner', 'admin']::public.company_member_role[]));

-- ── company_members ──────────────────────────────────────────────────────

alter table public.company_members enable row level security;

create policy company_members_select_self_or_admin on public.company_members
  for select using (
    user_id = auth.uid()
    or public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[])
  );

-- Insert liberado para admin/owner da empresa, OU para o bootstrap: o
-- próprio criador se auto-inserindo como owner da primeira (e única)
-- linha de uma empresa recém-criada sem nenhum membro ainda.
create policy company_members_insert_admin_or_bootstrap on public.company_members
  for insert with check (
    public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[])
    or (
      user_id = auth.uid()
      and role = 'owner'::public.company_member_role
      and not exists (
        select 1 from public.company_members cm2 where cm2.company_id = company_members.company_id
      )
    )
  );

create policy company_members_update_admin on public.company_members
  for update using (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

create policy company_members_delete_admin on public.company_members
  for delete using (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

-- ── user_channels ────────────────────────────────────────────────────────

alter table public.user_channels enable row level security;

create policy user_channels_select_own on public.user_channels
  for select using (user_id = auth.uid());

create policy user_channels_insert_own on public.user_channels
  for insert with check (user_id = auth.uid());

create policy user_channels_update_own on public.user_channels
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_channels_delete_own on public.user_channels
  for delete using (user_id = auth.uid());

-- Nota: o fluxo de identificação por WhatsApp (mensagem chega antes de
-- qualquer sessão autenticada) é feito pelo backend com service role, que
-- ignora RLS por padrão. As policies acima cobrem o caso de um usuário já
-- autenticado gerenciando os próprios canais pela web.

-- ── vehicles ─────────────────────────────────────────────────────────────

alter table public.vehicles enable row level security;

create policy vehicles_select_member on public.vehicles
  for select using (public.is_company_member(company_id));

create policy vehicles_insert_operator on public.vehicles
  for insert with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy vehicles_update_operator on public.vehicles
  for update using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy vehicles_delete_admin on public.vehicles
  for delete using (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

-- ── vehicle_cost_profiles ────────────────────────────────────────────────

alter table public.vehicle_cost_profiles enable row level security;

create policy vehicle_cost_profiles_select_member on public.vehicle_cost_profiles
  for select using (public.is_company_member(company_id));

create policy vehicle_cost_profiles_insert_operator on public.vehicle_cost_profiles
  for insert with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy vehicle_cost_profiles_update_operator on public.vehicle_cost_profiles
  for update using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy vehicle_cost_profiles_delete_admin on public.vehicle_cost_profiles
  for delete using (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

-- ── vehicle_tire_profiles ────────────────────────────────────────────────

alter table public.vehicle_tire_profiles enable row level security;

create policy vehicle_tire_profiles_select_member on public.vehicle_tire_profiles
  for select using (public.is_company_member(company_id));

create policy vehicle_tire_profiles_insert_operator on public.vehicle_tire_profiles
  for insert with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy vehicle_tire_profiles_update_operator on public.vehicle_tire_profiles
  for update using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy vehicle_tire_profiles_delete_admin on public.vehicle_tire_profiles
  for delete using (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

-- ── saved_routes ─────────────────────────────────────────────────────────

alter table public.saved_routes enable row level security;

create policy saved_routes_select_member on public.saved_routes
  for select using (public.is_company_member(company_id));

create policy saved_routes_insert_operator on public.saved_routes
  for insert with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy saved_routes_update_operator on public.saved_routes
  for update using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy saved_routes_delete_admin on public.saved_routes
  for delete using (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

-- ── company_preferences ──────────────────────────────────────────────────

alter table public.company_preferences enable row level security;

create policy company_preferences_select_member on public.company_preferences
  for select using (public.is_company_member(company_id));

create policy company_preferences_insert_admin on public.company_preferences
  for insert with check (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

create policy company_preferences_update_admin on public.company_preferences
  for update using (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.company_member_role[]));

-- ── conversations ────────────────────────────────────────────────────────

alter table public.conversations enable row level security;

create policy conversations_select_member on public.conversations
  for select using (public.is_company_member(company_id));

create policy conversations_insert_member on public.conversations
  for insert with check (public.is_company_member(company_id));

create policy conversations_update_member on public.conversations
  for update using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ── messages ─────────────────────────────────────────────────────────────

alter table public.messages enable row level security;

create policy messages_select_member on public.messages
  for select using (public.is_company_member(company_id));

create policy messages_insert_member on public.messages
  for insert with check (public.is_company_member(company_id));

-- Sem policy de update/delete: mensagens são um log. Alterações futuras de
-- privacidade (remoção de conteúdo) ficam a cargo do backend com service
-- role, não de um cliente autenticado comum.

-- ── ai_memories ──────────────────────────────────────────────────────────

alter table public.ai_memories enable row level security;

create policy ai_memories_select_member on public.ai_memories
  for select using (public.is_company_member(company_id));

create policy ai_memories_insert_operator on public.ai_memories
  for insert with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

create policy ai_memories_update_operator on public.ai_memories
  for update using (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin', 'operator']::public.company_member_role[]));

-- viewer não altera dados (inclusive memórias); pode ler e, pela regra do
-- produto, pedir correção/rejeição por meio de quem tiver papel permitido.

-- ── analysis_runs ────────────────────────────────────────────────────────

alter table public.analysis_runs enable row level security;

create policy analysis_runs_select_member on public.analysis_runs
  for select using (public.is_company_member(company_id));

-- Sem policy de insert/update para authenticated: analysis_runs é escrito
-- pelo backend (service role) quando a IA executa uma análise, nunca
-- fabricado diretamente por um cliente autenticado.

-- ── tool_executions ──────────────────────────────────────────────────────

alter table public.tool_executions enable row level security;

create policy tool_executions_select_member on public.tool_executions
  for select using (public.is_company_member(company_id));

-- Mesma lógica de analysis_runs: escrita só pelo backend.

-- ── google_integrations ──────────────────────────────────────────────────

alter table public.google_integrations enable row level security;

create policy google_integrations_select_own on public.google_integrations
  for select using (user_id = auth.uid());

create policy google_integrations_insert_own on public.google_integrations
  for insert with check (user_id = auth.uid());

create policy google_integrations_update_own on public.google_integrations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy google_integrations_delete_own on public.google_integrations
  for delete using (user_id = auth.uid());

-- ── calendar_action_logs ─────────────────────────────────────────────────

alter table public.calendar_action_logs enable row level security;

create policy calendar_action_logs_select_own on public.calendar_action_logs
  for select using (user_id = auth.uid());

create policy calendar_action_logs_insert_own on public.calendar_action_logs
  for insert with check (user_id = auth.uid());
