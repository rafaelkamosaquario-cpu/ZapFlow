-- Persiste a origem do cliente (achado da auditoria: só existia inferida
-- em tempo de leitura via nameSource, que reflete de onde veio o NOME, não
-- de onde veio o cadastro). Registros existentes recebem 'manual' como
-- default honesto -- não dá pra reconstruir a origem real retroativamente.
alter table clientes add column if not exists origem text not null default 'manual';

notify pgrst, 'reload schema';
