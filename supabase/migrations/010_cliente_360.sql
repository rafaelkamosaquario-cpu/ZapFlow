-- ============================================================================
-- ZapFlow — Item 6: Cliente 360°
--
-- vendedor_responsavel_id: dono do relacionamento comercial com o cliente,
-- agora que Vendedores é entidade própria (V4.2). Nullable + on delete set
-- null -- desativar um vendedor não pode apagar o histórico do cliente.
--
-- cliente_notas: o campo `clientes.notes` era um texto único (sem autor nem
-- data, sobrescrito a cada edição). Vira uma lista real -- não migramos o
-- texto antigo automaticamente (é anotação solta, não estruturada; fica
-- disponível só via acesso direto ao banco se precisar recuperar depois).
-- ============================================================================

alter table clientes add column if not exists vendedor_responsavel_id uuid references usuarios (id) on delete set null;

create table if not exists cliente_notas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas (id) on delete cascade,
  cliente_id  uuid not null references clientes (id) on delete cascade,
  autor_nome  text not null,
  autor_papel text not null,
  texto       text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cliente_notas_cliente_id on cliente_notas (cliente_id, created_at desc);
alter table cliente_notas enable row level security;

notify pgrst, 'reload schema';
