-- ============================================================================
-- ZapFlow — Correção de permissões do service_role + recarga do schema cache.
--
-- Causa do erro "Could not find the table 'public.<x>' in the schema cache"
-- (PGRST205): após reativar o projeto e criar as tabelas, a Data API (PostgREST)
-- não recarregou a lista de tabelas / o service_role ficou sem os privilégios
-- necessários para elas aparecerem no cache.
--
-- Este script é IDEMPOTENTE e SEGURO:
--   * NÃO apaga dados nem tabelas.
--   * As tabelas já são criadas por 001_zapflow.sql (create table if not exists).
--   * Concede ao service_role acesso total às tabelas do schema public.
--   * NÃO concede nada para o papel público "anon".
--   * Recarrega o schema do PostgREST no final.
--
-- Uso: cole e execute este arquivo inteiro no SQL Editor do Supabase.
-- ============================================================================

-- Permissões do service_role (usado exclusivamente pelo backend do ZapFlow)
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

-- Recarrega o cache de schema do PostgREST (Data API) para enxergar as tabelas
NOTIFY pgrst, 'reload schema';
