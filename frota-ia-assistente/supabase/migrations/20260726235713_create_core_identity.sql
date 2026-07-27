-- Camada 3 — Identidade central do Frota IA.
-- Cria profiles, companies, company_members e user_channels.
-- Projeto Supabase próprio e isolado (frotaia). Não reaproveita nada do ZapFlow.

create extension if not exists pgcrypto;

-- ── Enums ────────────────────────────────────────────────────────────────

create type public.company_type as enum ('autonomo', 'transportadora', 'embarcador', 'outro');

create type public.company_document_type as enum ('cpf', 'cnpj', 'outro');

create type public.company_member_role as enum ('owner', 'admin', 'operator', 'viewer');

create type public.company_member_status as enum ('active', 'invited', 'removed');

create type public.channel_type as enum ('whatsapp', 'web', 'outro');

create type public.channel_provider as enum ('z_api', 'internal', 'outro');

-- ── Função utilitária: updated_at automático ────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Atualiza updated_at antes de UPDATE. Reutilizada por todas as tabelas com essa coluna.';

-- ── profiles ─────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone_e164 text,
  avatar_url text,
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Complemento de auth.users (1 registro por usuário). Criado automaticamente pelo trigger on_auth_user_created. E-mail não é usado como chave de relacionamento — o id é sempre igual ao de auth.users.';

create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── criação automática de profile após novo auth.users ──────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'SECURITY DEFINER, search_path fixo. Cria o profile automaticamente após INSERT em auth.users. Tolerante a raw_user_meta_data ausente ou incompleto (ex.: login que não devolve nome/avatar).';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── companies ────────────────────────────────────────────────────────────

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_name text,
  document_type public.company_document_type,
  document_number text,
  company_type public.company_type not null default 'autonomo',
  city text,
  state text,
  country_code text not null default 'BR',
  timezone text not null default 'America/Sao_Paulo',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  constraint companies_name_not_blank check (btrim(name) <> '')
);

comment on table public.companies is
  'Empresa, transportadora, autônomo ou operação atendida pelo Frota IA. CNPJ não é obrigatório: a V1 precisa atender autônomos sem CNPJ.';

create trigger set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ── company_members ──────────────────────────────────────────────────────

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.company_member_role not null default 'owner',
  status public.company_member_status not null default 'active',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_members_unique_company_user unique (company_id, user_id)
);

comment on table public.company_members is
  'Vínculo usuário × empresa e papel. Um usuário pode pertencer a mais de uma empresa; uma empresa pode ter mais de um usuário.';

create trigger set_updated_at
  before update on public.company_members
  for each row execute function public.set_updated_at();

-- garante no máximo uma empresa padrão (is_default = true) por usuário
create or replace function public.ensure_single_default_company()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.is_default then
    update public.company_members
      set is_default = false
      where user_id = new.user_id
        and id <> new.id
        and is_default = true;
  end if;
  return new;
end;
$$;

comment on function public.ensure_single_default_company() is
  'Garante no máximo uma empresa padrão (is_default = true) por usuário em company_members.';

create trigger ensure_single_default_company_member
  before insert or update of is_default on public.company_members
  for each row execute function public.ensure_single_default_company();

-- impede remover/rebaixar o último owner ativo de uma empresa
create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner' and old.status = 'active')
     or (tg_op = 'UPDATE' and old.role = 'owner' and old.status = 'active'
         and (new.role <> 'owner' or new.status <> 'active')) then
    if (
      select count(*) from public.company_members cm
      where cm.company_id = old.company_id
        and cm.role = 'owner'
        and cm.status = 'active'
        and cm.id <> old.id
    ) = 0 then
      raise exception 'A empresa % precisa manter ao menos um owner ativo.', old.company_id;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.prevent_last_owner_removal() is
  'Impede que a última linha owner/active de uma empresa seja removida, rebaixada ou desativada, evitando empresa órfã sem administrador.';

create trigger prevent_last_owner_removal
  before update or delete on public.company_members
  for each row execute function public.prevent_last_owner_removal();

-- ── user_channels ────────────────────────────────────────────────────────

create table public.user_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  channel_type public.channel_type not null default 'whatsapp',
  provider public.channel_provider not null default 'z_api',
  external_user_id text not null,
  phone_e164 text,
  display_name text,
  verified boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_channels_unique_provider_external unique (provider, external_user_id)
);

comment on table public.user_channels is
  'Vincula uma identidade externa (principalmente WhatsApp) a um usuário do Frota IA. Nunca armazena credenciais/tokens da Z-API. metadata é só para dados auxiliares, não para o que já tem coluna própria.';

create trigger set_updated_at
  before update on public.user_channels
  for each row execute function public.set_updated_at();
