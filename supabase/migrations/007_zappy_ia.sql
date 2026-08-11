-- ============================================================================
-- ZapFlow — V4: Zappy IA (fundação)
--
-- configuracoes_ia: perfil comercial da empresa, injetado no prompt a cada
-- chamada (singleton por empresa, mesmo padrão de automacoes/google_conexoes).
-- ia_consumo: log bruto de cada chamada à OpenAI (tokens reais devolvidos
-- pela API) — só registro nesta versão, sem bloqueio por cota/plano.
-- ============================================================================

create table if not exists configuracoes_ia (
  empresa_id            uuid primary key references empresas (id) on delete cascade,
  segmento              text not null default '',
  descricao             text not null default '',
  produtos_servicos     text not null default '',
  publico_alvo          text not null default '',
  regiao                text not null default '',
  diferenciais          text not null default '',
  tom_comunicacao       text not null default '',
  condicoes_comerciais  text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_configuracoes_ia_updated before update on configuracoes_ia
  for each row execute function set_updated_at();
alter table configuracoes_ia enable row level security;

create table if not exists ia_consumo (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas (id) on delete cascade,
  usuario_id     uuid not null references usuarios (id) on delete cascade,
  modelo         text not null,
  acao           text not null,
  tokens_entrada integer not null default 0,
  tokens_saida   integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_ia_consumo_empresa_id on ia_consumo (empresa_id, created_at);
alter table ia_consumo enable row level security;
-- Sem policies (mesmo padrão do resto do schema): isolamento garantido em db/repositories.js.

notify pgrst, 'reload schema';
