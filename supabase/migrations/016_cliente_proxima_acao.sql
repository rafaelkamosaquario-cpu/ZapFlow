-- Próxima ação definida direto no cliente (não depende de existir uma
-- visita em aberto) -- usada quando o Cliente 360° não tem próxima ação
-- vinda de visita e o dono quer criar um follow-up mesmo assim.
alter table clientes add column if not exists proxima_acao_texto text not null default '';
alter table clientes add column if not exists proxima_acao_data date;

notify pgrst, 'reload schema';
