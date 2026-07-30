-- Camada 6 (Fase C) — alertas agendados enviados pelo WhatsApp.
-- Nenhuma tabela existente reaproveitável para isso (calendar_action_logs
-- é só log de ações já feitas na Agenda, não um agendador de disparo).

create type public.scheduled_alert_status as enum ('pending', 'sent', 'cancelled', 'failed');

create table public.scheduled_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  title text not null,
  notes text,
  category text,
  scheduled_for timestamptz not null,
  status public.scheduled_alert_status not null default 'pending',
  sent_at timestamptz,
  error_message_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_alerts_title_not_blank check (btrim(title) <> '')
);

comment on table public.scheduled_alerts is
  'Alertas planejados (sem telemetria/rastreador) que o agendador do backend dispara pelo WhatsApp no horário previsto. Não é o mesmo que um evento do Google Calendar — o usuário pode ter as duas coisas (evento na Agenda + alerta aqui), criadas independentemente.';

create trigger set_updated_at
  before update on public.scheduled_alerts
  for each row execute function public.set_updated_at();

create index scheduled_alerts_dispatch_idx on public.scheduled_alerts (status, scheduled_for) where status = 'pending';

alter table public.scheduled_alerts enable row level security;

create policy scheduled_alerts_select_member on public.scheduled_alerts
  for select using (public.is_company_member(company_id));

-- Sem policy de insert/update/delete: hoje só o backend (client admin) cria,
-- via a ferramenta gerenciar_alerta e o job de disparo — nunca há sessão de
-- navegador tocando nesta tabela.
