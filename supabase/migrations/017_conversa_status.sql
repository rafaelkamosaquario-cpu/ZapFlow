-- Estado resolvida/pendente por conversa (achado da auditoria: existia
-- "Mover para etapa" e "Adicionar aos Clientes", mas nenhum conceito de
-- conversa resolvida). Chave é a mesma `key` usada em mensagens/tenant.conversas.
create table if not exists conversa_status (
  empresa_id  uuid not null references empresas (id) on delete cascade,
  key         text not null,
  resolvida   boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (empresa_id, key)
);
alter table conversa_status enable row level security;

notify pgrst, 'reload schema';
