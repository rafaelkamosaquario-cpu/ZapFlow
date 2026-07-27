-- Camada 3 — Perfis operacionais.
-- Cria vehicles, vehicle_cost_profiles, vehicle_tire_profiles, saved_routes
-- e company_preferences: os dados que a IA usa para personalizar cálculos
-- sem obrigar o cliente a repetir informação em toda conversa.

-- ── Enums ────────────────────────────────────────────────────────────────

create type public.vehicle_type as enum (
  'utilitario',
  'tres_quartos',
  'toco',
  'truck',
  'cavalo_mecanico',
  'carreta',
  'bitrem',
  'rodotrem',
  'onibus',
  'outro'
);

create type public.fuel_type as enum (
  'diesel_s10',
  'diesel_s500',
  'gasolina',
  'etanol',
  'eletrico',
  'outro'
);

create type public.tire_category as enum (
  'novo_nacional',
  'novo_importado',
  'recapado',
  'misto',
  'outro'
);

create type public.route_data_source as enum ('manual', 'google_routes', 'outro');

-- ── vehicles ─────────────────────────────────────────────────────────────

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text,
  plate text,
  vehicle_type public.vehicle_type,
  brand text,
  model text,
  model_year integer,
  fuel_type public.fuel_type,
  average_consumption_km_l numeric,
  average_speed_kmh numeric,
  load_capacity_kg numeric,
  current_odometer_km numeric,
  active boolean not null default true,
  is_default boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  constraint vehicles_consumption_positive check (average_consumption_km_l is null or average_consumption_km_l > 0),
  constraint vehicles_speed_plausible check (average_speed_kmh is null or (average_speed_kmh > 0 and average_speed_kmh <= 150)),
  constraint vehicles_capacity_non_negative check (load_capacity_kg is null or load_capacity_kg >= 0),
  constraint vehicles_odometer_non_negative check (current_odometer_km is null or current_odometer_km >= 0),
  constraint vehicles_model_year_plausible check (model_year is null or (model_year between 1970 and 2100))
);

comment on table public.vehicles is
  'Somente os dados que a IA precisa para personalizar cálculos e análises. Placa é opcional durante onboarding. Sem gestão de documentos, manutenção ou implementos nesta V1.';

create trigger set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

-- normaliza a placa (maiúscula, sem espaços nas pontas) quando informada
create or replace function public.normalize_vehicle_plate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.plate is not null then
    new.plate = upper(btrim(new.plate));
  end if;
  return new;
end;
$$;

comment on function public.normalize_vehicle_plate() is
  'Normaliza vehicles.plate para maiúsculas e sem espaços nas pontas antes de gravar.';

create trigger normalize_vehicle_plate
  before insert or update of plate on public.vehicles
  for each row execute function public.normalize_vehicle_plate();

-- garante no máximo um veículo padrão (is_default = true) por empresa
create or replace function public.ensure_single_default_vehicle()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.is_default then
    update public.vehicles
      set is_default = false
      where company_id = new.company_id
        and id <> new.id
        and is_default = true;
  end if;
  return new;
end;
$$;

comment on function public.ensure_single_default_vehicle() is
  'Garante no máximo um veículo padrão (is_default = true) por empresa em vehicles.';

create trigger ensure_single_default_vehicle
  before insert or update of is_default on public.vehicles
  for each row execute function public.ensure_single_default_vehicle();

-- ── vehicle_cost_profiles ────────────────────────────────────────────────

create table public.vehicle_cost_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  effective_from date not null default current_date,
  effective_to date,
  fuel_price_per_liter numeric,
  fixed_cost_per_day numeric,
  fixed_cost_per_month numeric,
  maintenance_cost_per_km numeric,
  tire_cost_per_km numeric,
  depreciation_cost_per_km numeric,
  driver_cost_per_day numeric,
  other_cost_per_km numeric,
  target_margin_percent numeric,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  constraint vehicle_cost_profiles_period_valid check (effective_to is null or effective_to >= effective_from),
  constraint vehicle_cost_profiles_fuel_price_non_negative check (fuel_price_per_liter is null or fuel_price_per_liter >= 0),
  constraint vehicle_cost_profiles_fixed_day_non_negative check (fixed_cost_per_day is null or fixed_cost_per_day >= 0),
  constraint vehicle_cost_profiles_fixed_month_non_negative check (fixed_cost_per_month is null or fixed_cost_per_month >= 0),
  constraint vehicle_cost_profiles_maintenance_non_negative check (maintenance_cost_per_km is null or maintenance_cost_per_km >= 0),
  constraint vehicle_cost_profiles_tire_non_negative check (tire_cost_per_km is null or tire_cost_per_km >= 0),
  constraint vehicle_cost_profiles_depreciation_non_negative check (depreciation_cost_per_km is null or depreciation_cost_per_km >= 0),
  constraint vehicle_cost_profiles_driver_non_negative check (driver_cost_per_day is null or driver_cost_per_day >= 0),
  constraint vehicle_cost_profiles_other_non_negative check (other_cost_per_km is null or other_cost_per_km >= 0),
  constraint vehicle_cost_profiles_margin_range check (target_margin_percent is null or (target_margin_percent >= 0 and target_margin_percent <= 100))
);

comment on table public.vehicle_cost_profiles is
  'Parâmetros de entrada usados pelas ferramentas de cálculo (custo_por_dia é diário, custo_por_mes é mensal — nunca convertidos silenciosamente). Contém entradas/premissas, não resultados definitivos: quem calcula continua sendo as 11 ferramentas.';

create trigger set_updated_at
  before update on public.vehicle_cost_profiles
  for each row execute function public.set_updated_at();

-- ── vehicle_tire_profiles ────────────────────────────────────────────────

create table public.vehicle_tire_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  tire_category public.tire_category not null default 'outro',
  brand text,
  model text,
  size text,
  acquisition_cost numeric,
  expected_life_km numeric,
  number_of_recaps integer,
  recap_cost numeric,
  expected_recap_life_km numeric,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  constraint vehicle_tire_profiles_acquisition_non_negative check (acquisition_cost is null or acquisition_cost >= 0),
  constraint vehicle_tire_profiles_life_non_negative check (expected_life_km is null or expected_life_km >= 0),
  constraint vehicle_tire_profiles_recaps_non_negative check (number_of_recaps is null or number_of_recaps >= 0),
  constraint vehicle_tire_profiles_recap_cost_non_negative check (recap_cost is null or recap_cost >= 0),
  constraint vehicle_tire_profiles_recap_life_non_negative check (expected_recap_life_km is null or expected_recap_life_km >= 0)
);

comment on table public.vehicle_tire_profiles is
  'Premissas usadas pela IA para calcular_cpk e comparar_pneus. NÃO é gestão completa de pneus: sem posição por eixo, estoque, movimentação ou sucata — isso pertence a versões futuras ou ao FrotaBot.';

create trigger set_updated_at
  before update on public.vehicle_tire_profiles
  for each row execute function public.set_updated_at();

-- ── saved_routes ─────────────────────────────────────────────────────────

create table public.saved_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  name text,
  origin_name text,
  origin_city text,
  origin_state text,
  destination_name text,
  destination_city text,
  destination_state text,
  distance_km numeric,
  estimated_duration_minutes integer,
  estimated_toll_cost numeric,
  average_consumption_km_l numeric,
  average_speed_kmh numeric,
  data_source public.route_data_source not null default 'manual',
  is_favorite boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  constraint saved_routes_distance_non_negative check (distance_km is null or distance_km >= 0),
  constraint saved_routes_duration_non_negative check (estimated_duration_minutes is null or estimated_duration_minutes >= 0),
  constraint saved_routes_toll_non_negative check (estimated_toll_cost is null or estimated_toll_cost >= 0)
);

comment on table public.saved_routes is
  'Rotas frequentes informadas pelo cliente. data_source registra a origem (manual por padrão): nesta fase não há integração com Google Routes, pedágio ou clima, então dado manual nunca deve ser tratado como oficial.';

create trigger set_updated_at
  before update on public.saved_routes
  for each row execute function public.set_updated_at();

-- ── company_preferences ──────────────────────────────────────────────────

create table public.company_preferences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  default_vehicle_id uuid references public.vehicles (id) on delete set null,
  default_fuel_type public.fuel_type,
  default_fuel_price numeric,
  default_average_speed_kmh numeric,
  default_target_margin_percent numeric,
  default_currency text not null default 'BRL',
  distance_unit text not null default 'km',
  preferred_response_style text not null default 'objetivo',
  ask_before_saving_memory boolean not null default true,
  allow_automatic_memory boolean not null default true,
  allow_analysis_history boolean not null default true,
  allow_tool_history boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  constraint company_preferences_unique_company unique (company_id),
  constraint company_preferences_fuel_price_non_negative check (default_fuel_price is null or default_fuel_price >= 0),
  constraint company_preferences_speed_plausible check (default_average_speed_kmh is null or (default_average_speed_kmh > 0 and default_average_speed_kmh <= 150)),
  constraint company_preferences_margin_range check (default_target_margin_percent is null or (default_target_margin_percent >= 0 and default_target_margin_percent <= 100))
);

comment on table public.company_preferences is
  'Uma linha por empresa (unique company_id). Configurações padrão iniciais: moeda BRL, distância em km, idioma pt-BR, respostas objetivas, memória automática configurável. user_preferences não existe nesta V1 — só será criada se houver necessidade real de preferência individual diferente da empresa.';

create trigger set_updated_at
  before update on public.company_preferences
  for each row execute function public.set_updated_at();
