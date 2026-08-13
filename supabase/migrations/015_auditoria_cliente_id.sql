-- Permite ligar um registro de auditoria a um cliente específico (usado pra
-- mostrar "mudança de etapa" na timeline do Cliente 360°). Nullable porque
-- nem toda ação de auditoria é sobre um cliente (ex.: criar vendedor).
alter table auditoria add column if not exists cliente_id uuid references clientes (id) on delete set null;
create index if not exists idx_auditoria_cliente_id on auditoria (cliente_id) where cliente_id is not null;

notify pgrst, 'reload schema';
