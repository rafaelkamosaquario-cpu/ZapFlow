-- ============================================================================
-- ZapFlow — Fase A: fundação multi-tenant
--
-- Cria `empresas` (1 linha por cliente pagante) e `usuarios` (login por
-- empresa, papéis `owner`/`vendedor`), e isola todas as tabelas operacionais
-- por `empresa_id`.
--
-- ATENÇÃO — decisão confirmada com o dono do produto: não há backfill dos
-- dados atuais (uso interno, tratados como descartáveis). As 11 tabelas
-- operacionais abaixo são ESVAZIADAS (TRUNCATE) antes de receberem a coluna
-- `empresa_id not null` — não dá pra ter `not null` sem valor em linhas que
-- já existem, e a decisão foi começar limpo em vez de inventar uma empresa
-- "dona" das linhas antigas.
--
-- Uso: colar e executar este arquivo inteiro no SQL Editor do Supabase,
-- depois `NOTIFY pgrst, 'reload schema'` (feito ao final deste arquivo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. empresas (cliente pagante) e usuarios (login por empresa)
-- ----------------------------------------------------------------------------
create table if not exists empresas (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  zapi_instance_id     text,
  zapi_instance_token  text,
  zapi_client_token    text,
  webhook_secret       text not null unique,
  max_vendedores       integer not null default 5,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_empresas_updated before update on empresas
  for each row execute function set_updated_at();

create table if not exists usuarios (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas (id) on delete cascade,
  username       text not null,
  password_hash  text not null,
  role           text not null check (role in ('owner', 'vendedor')),
  name           text not null default '',
  phone          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists usuarios_username_lower_idx on usuarios (lower(username));
create index if not exists idx_usuarios_empresa_id on usuarios (empresa_id);
create trigger trg_usuarios_updated before update on usuarios
  for each row execute function set_updated_at();

alter table empresas enable row level security;
alter table usuarios enable row level security;
-- Sem policies (mesmo padrão do restante do schema): só service_role acessa.

-- ----------------------------------------------------------------------------
-- 2. Esvazia as tabelas operacionais (decisão: começar limpo, sem backfill)
-- ----------------------------------------------------------------------------
truncate table
  destinatarios_campanha,
  campanhas,
  mensagens,
  conversas,
  respostas,
  eventos_webhook,
  metricas_envios,
  clientes,
  contatos,
  modelos_mensagem,
  automacoes
  restart identity cascade;

-- ----------------------------------------------------------------------------
-- 3. contatos — empresa_id + unique (empresa_id, phone_key)
-- ----------------------------------------------------------------------------
alter table contatos add column empresa_id uuid references empresas (id) on delete cascade;
alter table contatos alter column empresa_id set not null;
alter table contatos drop constraint if exists contatos_phone_key_key;
alter table contatos drop constraint if exists contatos_phone_key;
alter table contatos add constraint contatos_empresa_phone_key unique (empresa_id, phone_key);
create index if not exists idx_contatos_empresa_id on contatos (empresa_id);

-- ----------------------------------------------------------------------------
-- 4. clientes — empresa_id + unique (empresa_id, phone_key)
-- ----------------------------------------------------------------------------
alter table clientes add column empresa_id uuid references empresas (id) on delete cascade;
alter table clientes alter column empresa_id set not null;
alter table clientes drop constraint if exists clientes_phone_key_key;
alter table clientes drop constraint if exists clientes_phone_key;
alter table clientes add constraint clientes_empresa_phone_key unique (empresa_id, phone_key);
create index if not exists idx_clientes_empresa_id on clientes (empresa_id);

-- ----------------------------------------------------------------------------
-- 5. conversas — empresa_id + unique (empresa_id, phone_key)
-- ----------------------------------------------------------------------------
alter table conversas add column empresa_id uuid references empresas (id) on delete cascade;
alter table conversas alter column empresa_id set not null;
alter table conversas drop constraint if exists conversas_phone_key_key;
alter table conversas drop constraint if exists conversas_phone_key;
alter table conversas add constraint conversas_empresa_phone_key unique (empresa_id, phone_key);
create index if not exists idx_conversas_empresa_id on conversas (empresa_id);

-- ----------------------------------------------------------------------------
-- 6. mensagens — empresa_id + dedup por (empresa_id, external_id)
-- ----------------------------------------------------------------------------
alter table mensagens add column empresa_id uuid references empresas (id) on delete cascade;
alter table mensagens alter column empresa_id set not null;
drop index if exists uq_mensagens_external;
create unique index if not exists uq_mensagens_empresa_external
  on mensagens (empresa_id, external_id) where external_id is not null;
create index if not exists idx_mensagens_empresa_id on mensagens (empresa_id);

-- ----------------------------------------------------------------------------
-- 7. campanhas — empresa_id + índice para o agendador cross-empresa
-- ----------------------------------------------------------------------------
alter table campanhas add column empresa_id uuid references empresas (id) on delete cascade;
alter table campanhas alter column empresa_id set not null;
create index if not exists idx_campanhas_empresa_id on campanhas (empresa_id);
create index if not exists idx_campanhas_pendentes on campanhas (status, scheduled_at)
  where status = 'pendente';

-- ----------------------------------------------------------------------------
-- 8. destinatarios_campanha — empresa_id (denormalizado, evita join)
-- ----------------------------------------------------------------------------
alter table destinatarios_campanha add column empresa_id uuid references empresas (id) on delete cascade;
alter table destinatarios_campanha alter column empresa_id set not null;
create index if not exists idx_dest_empresa_id on destinatarios_campanha (empresa_id);

-- ----------------------------------------------------------------------------
-- 9. modelos_mensagem — empresa_id
-- ----------------------------------------------------------------------------
alter table modelos_mensagem add column empresa_id uuid references empresas (id) on delete cascade;
alter table modelos_mensagem alter column empresa_id set not null;
create index if not exists idx_modelos_empresa_id on modelos_mensagem (empresa_id);

-- ----------------------------------------------------------------------------
-- 10. automacoes — vira singleton POR EMPRESA (empresa_id substitui `id`)
-- ----------------------------------------------------------------------------
alter table automacoes add column empresa_id uuid references empresas (id) on delete cascade;
alter table automacoes alter column empresa_id set not null;
alter table automacoes drop constraint automacoes_pkey;
alter table automacoes add primary key (empresa_id);
alter table automacoes drop column id;

-- ----------------------------------------------------------------------------
-- 11. metricas_envios — empresa_id
-- ----------------------------------------------------------------------------
alter table metricas_envios add column empresa_id uuid references empresas (id) on delete cascade;
alter table metricas_envios alter column empresa_id set not null;
create index if not exists idx_metricas_empresa_id on metricas_envios (empresa_id);

-- ----------------------------------------------------------------------------
-- 12. respostas — empresa_id + dedup por (empresa_id, external_id)
-- ----------------------------------------------------------------------------
alter table respostas add column empresa_id uuid references empresas (id) on delete cascade;
alter table respostas alter column empresa_id set not null;
drop index if exists uq_respostas_external;
create unique index if not exists uq_respostas_empresa_external
  on respostas (empresa_id, external_id) where external_id is not null;
create index if not exists idx_respostas_empresa_id on respostas (empresa_id);

-- ----------------------------------------------------------------------------
-- 13. eventos_webhook — empresa_id + dedup por (empresa_id, external_id)
-- ----------------------------------------------------------------------------
alter table eventos_webhook add column empresa_id uuid references empresas (id) on delete cascade;
alter table eventos_webhook alter column empresa_id set not null;
alter table eventos_webhook drop constraint if exists eventos_webhook_external_id_key;
alter table eventos_webhook add constraint eventos_webhook_empresa_external unique (empresa_id, external_id);
create index if not exists idx_eventos_empresa_id on eventos_webhook (empresa_id);

-- Nota: `configuracoes` não recebe empresa_id — tabela morta, não usada em
-- nenhum repositório do backend hoje.

notify pgrst, 'reload schema';
