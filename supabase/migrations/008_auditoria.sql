-- ============================================================================
-- ZapFlow — Item 8.12: Auditoria básica (quem fez o quê)
--
-- Log de leitura simples pras ações que mais importam pro dono acompanhar a
-- equipe: mudança de etapa de cliente, criação/desativação de vendedor. Sem
-- policies (mesmo padrão do resto do schema): isolamento garantido em
-- db/repositories.js. Guarda o nome do ator em texto (não só o id) pra não
-- depender de join pra exibir, e sobreviver mesmo se o usuário for removido
-- depois.
-- ============================================================================

create table if not exists auditoria (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas (id) on delete cascade,
  ator_nome      text not null,
  ator_papel     text not null,
  acao           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_auditoria_empresa_id on auditoria (empresa_id, created_at desc);
alter table auditoria enable row level security;

notify pgrst, 'reload schema';
