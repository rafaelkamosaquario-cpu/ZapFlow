-- ============================================================================
-- ZapFlow — V3: Google conectado (Calendar + Sheets + Drive)
--
-- Cada empresa conecta a PRÓPRIA conta Google (OAuth feito pelo dono,
-- diferente da Z-API que é configurada manualmente pelo Rafael). Singleton
-- por empresa, mesmo padrão de `automacoes` (PK = empresa_id).
-- ============================================================================

create table if not exists google_conexoes (
  empresa_id      uuid primary key references empresas (id) on delete cascade,
  access_token    text not null,
  refresh_token   text not null,
  token_expiry    timestamptz not null,
  scope           text not null,
  connected_email text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_google_conexoes_updated before update on google_conexoes
  for each row execute function set_updated_at();

alter table google_conexoes enable row level security;
-- Sem policies (mesmo padrão do resto do schema): isolamento garantido em
-- db/repositories.js (empresaId sempre exigido).

notify pgrst, 'reload schema';
