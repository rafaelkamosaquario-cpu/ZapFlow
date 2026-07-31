-- Camada 6 (Fase G) — despesas registradas pelo cliente (ex.: foto de nota
-- fiscal/cupom de abastecimento ou manutenção). O Claude já lê a imagem
-- nativamente (visão); esta tabela é onde o valor extraído vira um registro
-- estruturado, em vez de só ficar mencionado na conversa. Alimenta
-- calcular_cpk/calcular_custo_dia por consulta explícita (registrar_despesa,
-- modo CONSULTAR) — nunca é somada automaticamente dentro dessas ferramentas.

create type public.expense_type as enum (
  'combustivel',
  'manutencao',
  'pedagio',
  'alimentacao',
  'hospedagem',
  'documentacao',
  'pneu',
  'seguro',
  'multa',
  'outro'
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  source_message_id uuid references public.messages (id) on delete set null,
  expense_type public.expense_type not null,
  amount numeric not null,
  expense_date date not null,
  vendor text,
  description text,
  created_at timestamptz not null default now(),
  constraint expenses_amount_positive check (amount > 0)
);

comment on table public.expenses is
  'Despesa registrada pelo cliente (tipicamente a partir de uma foto de nota/cupom fiscal lida pelo Claude). source_message_id aponta para a mensagem (imagem/PDF) de origem, quando houver, para auditoria. Nunca populada automaticamente — sempre com valor confirmado pelo usuário na conversa.';

create index expenses_company_period_idx on public.expenses (company_id, expense_date);
create index expenses_vehicle_period_idx on public.expenses (vehicle_id, expense_date) where vehicle_id is not null;

alter table public.expenses enable row level security;

create policy expenses_select_member on public.expenses
  for select using (public.is_company_member(company_id));

-- Sem policy de insert/update/delete: hoje só o backend (client admin, via a
-- ferramenta registrar_despesa) grava aqui — nunca há sessão de navegador
-- tocando nesta tabela, mesmo padrão de generated_documents/scheduled_alerts.
