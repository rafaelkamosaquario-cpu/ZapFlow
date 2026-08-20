-- ============================================================================
-- ZapFlow — Estrutura mínima pra sustentar a experiência unificada de
-- "Próxima Ação" (horário, responsável, concluir), sem criar tabela nova.
-- Continua havendo 2 fontes (visitas e clientes) -- a normalização de qual
-- delas é a vigente passa a ser feita no backend, comparando datas.
-- ============================================================================

-- Hora da próxima ação manual do cliente (a data já existia desde a 016).
alter table clientes add column if not exists proxima_acao_hora text;

-- Responsável específico da próxima ação -- pode divergir do vendedor
-- responsável geral do cliente (vendedor_responsavel_id, da 010). Quando
-- nulo, o backend usa o vendedor_responsavel_id do cliente como padrão.
alter table clientes add column if not exists proxima_acao_responsavel_id uuid references usuarios (id) on delete set null;

-- Hora do retorno agendado na visita -- hoje só ia pro evento do Google
-- Calendar e se perdia no ZapFlow depois de criado.
alter table visitas add column if not exists proxima_visita_hora text;

-- Permite "concluir" uma próxima ação que veio de uma visita (resultado
-- "Retornar depois") sem precisar reabrir/alterar o resultado já registrado
-- da visita em si.
alter table visitas add column if not exists proxima_acao_resolvida boolean not null default false;

notify pgrst, 'reload schema';
