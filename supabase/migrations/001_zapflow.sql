-- ============================================================================
-- ZapFlow — Migration inicial (Supabase / PostgreSQL)
-- Representa os dados que já existem hoje no ZapFlow (uso exclusivo do dono).
-- Uso: cole e execute este arquivo inteiro no SQL Editor do Supabase.
--
-- Regras aplicadas:
--   * UUID como chave primária (gen_random_uuid()).
--   * created_at / updated_at em todas as tabelas.
--   * Chaves estrangeiras e índices (telefone, campanha, conversa, status, datas).
--   * Identificador externo único para impedir webhook/mensagem duplicada.
--   * RLS ATIVADO em todas as tabelas, SEM políticas públicas
--     (somente a service_role — usada apenas no backend — acessa os dados).
--   * NÃO cria estrutura multiempresa.
--   * Tokens da Z-API NUNCA são armazenados aqui (ficam em variáveis de ambiente).
-- ============================================================================

create extension if not exists pgcrypto;

-- Gatilho genérico para manter updated_at sempre atualizado
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- 1. contatos  (agenda de contatos: cadastrados, importados ou sincronizados)
-- ----------------------------------------------------------------------------
create table if not exists contatos (
  id          uuid primary key default gen_random_uuid(),
  phone_key   text not null unique,            -- chave canônica do telefone (dedup)
  phone       text not null,                   -- telefone "discável" (com DDI)
  name        text not null default '',
  origem      text not null default 'manual',  -- manual | planilha | chip
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_contatos_origem on contatos (origem);
create trigger trg_contatos_updated before update on contatos
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. clientes  (clientes identificados: pessoas encontradas nas conversas)
-- ----------------------------------------------------------------------------
create table if not exists clientes (
  id                 uuid primary key default gen_random_uuid(),
  phone_key          text not null unique,
  phone              text not null,
  name               text not null default '', -- nome vindo da campanha
  wa_name            text,                      -- nome recebido do WhatsApp/Z-API
  stage              text not null default 'Novo', -- Novo|Contatado|Respondeu|Negociando|Cliente|Perdido
  stage_manual       boolean not null default false,
  tags               jsonb not null default '[]'::jsonb,
  notes              text not null default '',
  last_sent_at       bigint,                    -- epoch ms do último envio
  last_reply_at      bigint,                    -- epoch ms da última resposta
  last_campaign_name text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_clientes_stage       on clientes (stage);
create index if not exists idx_clientes_last_reply  on clientes (last_reply_at);
create index if not exists idx_clientes_last_sent   on clientes (last_sent_at);
create index if not exists idx_clientes_updated     on clientes (updated_at);
create trigger trg_clientes_updated before update on clientes
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. conversas  (uma thread por contato — resumo da última mensagem)
-- ----------------------------------------------------------------------------
create table if not exists conversas (
  id          uuid primary key default gen_random_uuid(),
  phone_key   text not null unique,
  phone       text,
  last_text   text,
  last_dir    text,                             -- in | out
  last_ts     bigint,
  origem      text,                             -- snapshot informativo: campaign | daily
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_conversas_last_ts on conversas (last_ts);
create trigger trg_conversas_updated before update on conversas
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. mensagens  (cada mensagem trocada — recebida "in" ou enviada "out")
-- ----------------------------------------------------------------------------
create table if not exists mensagens (
  id           uuid primary key default gen_random_uuid(),
  conversa_id  uuid references conversas (id) on delete cascade,
  phone_key    text not null,
  phone        text,
  text         text,
  dir          text not null,                   -- in | out
  external_id  text,                            -- messageId da Z-API (dedup de webhook)
  ts           bigint not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_mensagens_phone_key on mensagens (phone_key);
create index if not exists idx_mensagens_ts         on mensagens (ts);
create index if not exists idx_mensagens_conversa   on mensagens (conversa_id);
-- Impede a mesma mensagem do WhatsApp de ser gravada duas vezes
create unique index if not exists uq_mensagens_external
  on mensagens (external_id) where external_id is not null;

-- ----------------------------------------------------------------------------
-- 5. campanhas  (cada campanha/disparo — imediata OU agendada)
--    Agendamentos = campanhas com status 'pendente' e scheduled_at no futuro,
--    por isso continuam existindo após reinício/novo deploy do Railway.
-- ----------------------------------------------------------------------------
create table if not exists campanhas (
  id             uuid primary key,              -- reaproveita o id do job
  status         text not null default 'pendente', -- pendente|enviando|concluido|erro
  immediate      boolean not null default false,
  message        text,
  had_image      boolean not null default false,
  image_count    int not null default 0,
  delay_ms       int,
  contacts_count int not null default 0,
  scheduled_at   bigint,
  started_at     bigint,
  finished_at    bigint,
  result         jsonb,
  error          text,
  label          text,
  data           jsonb,                         -- payload completo do job (sem credenciais/imagens)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_campanhas_status    on campanhas (status);
create index if not exists idx_campanhas_scheduled on campanhas (scheduled_at);
create index if not exists idx_campanhas_finished  on campanhas (finished_at);
create trigger trg_campanhas_updated before update on campanhas
  for each row execute function set_updated_at();

-- View de conveniência para ver os agendamentos pendentes
create or replace view agendamentos_pendentes as
  select id, message, scheduled_at, contacts_count, status, created_at
  from campanhas
  where status = 'pendente';

-- ----------------------------------------------------------------------------
-- 6. destinatarios_campanha  (para quem cada campanha foi enviada + resultado)
-- ----------------------------------------------------------------------------
create table if not exists destinatarios_campanha (
  id           uuid primary key default gen_random_uuid(),
  campanha_id  uuid not null references campanhas (id) on delete cascade,
  phone_key    text,
  phone        text,
  name         text,
  ok           boolean,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_dest_campanha  on destinatarios_campanha (campanha_id);
create index if not exists idx_dest_phone_key on destinatarios_campanha (phone_key);

-- ----------------------------------------------------------------------------
-- 7. modelos_mensagem  (modelos/rascunhos reutilizáveis)
-- ----------------------------------------------------------------------------
create table if not exists modelos_mensagem (
  id          uuid primary key,
  name        text not null,
  message     text not null default '',
  image_urls  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_modelos_updated before update on modelos_mensagem
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. automacoes  (regras do chatbot por palavra-chave — linha única "singleton")
-- ----------------------------------------------------------------------------
create table if not exists automacoes (
  id          text primary key default 'chatbot',
  enabled     boolean not null default false,
  rules       jsonb not null default '[]'::jsonb,
  fallback    jsonb not null default '{"enabled":false,"reply":""}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_automacoes_updated before update on automacoes
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 9. configuracoes  (chave/valor para configurações internas do app)
--    Observação: credenciais da Z-API NÃO ficam aqui — ficam em env vars.
-- ----------------------------------------------------------------------------
create table if not exists configuracoes (
  key         text primary key,
  value       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_config_updated before update on configuracoes
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 10. metricas_envios  (tally por campanha concluída: alimenta o dashboard)
-- ----------------------------------------------------------------------------
create table if not exists metricas_envios (
  id          uuid primary key default gen_random_uuid(),
  ts          bigint not null,                  -- epoch ms
  sent        int not null default 0,
  failed      int not null default 0,
  name        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_metricas_ts on metricas_envios (ts);

-- ----------------------------------------------------------------------------
-- 11. respostas  (respostas recebidas — alimenta taxa/melhor horário e a caixa)
-- ----------------------------------------------------------------------------
create table if not exists respostas (
  id          uuid primary key default gen_random_uuid(),
  phone_key   text not null,
  phone       text,
  content     text,
  ts          bigint not null,
  external_id text,                             -- dedup opcional pela messageId
  created_at  timestamptz not null default now()
);
create index if not exists idx_respostas_phone_key on respostas (phone_key);
create index if not exists idx_respostas_ts        on respostas (ts);
create unique index if not exists uq_respostas_external
  on respostas (external_id) where external_id is not null;

-- ----------------------------------------------------------------------------
-- 12. eventos_webhook  (registro cru de cada evento da Z-API — dedup por id)
-- ----------------------------------------------------------------------------
create table if not exists eventos_webhook (
  id          uuid primary key default gen_random_uuid(),
  external_id text unique,                      -- id do evento/mensagem na Z-API
  phone_key   text,
  from_me     boolean,
  payload     jsonb,
  processed   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_eventos_phone_key on eventos_webhook (phone_key);
create index if not exists idx_eventos_created   on eventos_webhook (created_at);

-- ============================================================================
-- RLS: ativado em todas as tabelas, SEM políticas.
-- Sem políticas => nenhum acesso para anon/authenticated.
-- A service_role (usada exclusivamente pelo backend do Railway) ignora a RLS.
-- ============================================================================
alter table contatos               enable row level security;
alter table clientes               enable row level security;
alter table conversas              enable row level security;
alter table mensagens              enable row level security;
alter table campanhas              enable row level security;
alter table destinatarios_campanha enable row level security;
alter table modelos_mensagem       enable row level security;
alter table automacoes             enable row level security;
alter table configuracoes          enable row level security;
alter table metricas_envios        enable row level security;
alter table respostas              enable row level security;
alter table eventos_webhook        enable row level security;
