-- ============================================================================
-- ZapFlow — Relação explícita entre Visita e Cliente (substitui o join só por
-- telefone, frágil). Nullable: visitas antigas continuam válidas sem cliente_id
-- (fallback por telefone permanece no código pra elas). Uma visita só pode
-- apontar para um cliente da MESMA empresa — reforçado no backend, não só
-- pela FK (a FK sozinha não impede cliente de outra empresa, só cliente
-- inexistente).
-- ============================================================================

alter table visitas add column if not exists cliente_id uuid references clientes (id) on delete set null;

create index if not exists idx_visitas_cliente_id on visitas (cliente_id) where cliente_id is not null;

notify pgrst, 'reload schema';
