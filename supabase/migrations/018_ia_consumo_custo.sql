-- Custo estimado por chamada de IA (achado da auditoria: só havia contagem
-- de tokens, sem nenhuma visibilidade de custo real em R$/US$).
alter table ia_consumo add column if not exists estimated_cost numeric(12,6) not null default 0;

notify pgrst, 'reload schema';
