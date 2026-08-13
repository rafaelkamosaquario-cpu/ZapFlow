-- Base de conhecimento por empresa (achado da auditoria: ausente, confirmado
-- sem equivalência). V1 pragmática: entradas de texto categorizadas, não
-- upload de documento/PDF -- isso cobre o caso de uso real (colar FAQ,
-- políticas, diferenciais) sem precisar de storage/parsing de arquivo.
-- Retrieval também é V1: relevância por palavra-chave (feita em
-- lib/ai/systemPrompt.js), não embeddings -- ver comentário lá.
create table if not exists company_knowledge (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas (id) on delete cascade,
  categoria    text not null,
  titulo       text not null,
  conteudo     text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_company_knowledge_empresa on company_knowledge (empresa_id, created_at desc);
create trigger trg_company_knowledge_updated before update on company_knowledge
  for each row execute function set_updated_at();
alter table company_knowledge enable row level security;

notify pgrst, 'reload schema';
