-- ============================================================================
-- ZapFlow — Estado do Guia ZapFlow (tutorial de uso interno), por usuário.
-- Progresso é próprio de quem está logado (owner e vendedor têm o seu),
-- nunca compartilhado entre usuários da mesma empresa. Um único campo JSON
-- guarda tudo (iniciou, etapas vistas, concluiu, dispensou) -- não precisa
-- de tabela nova nem de colunas separadas por etapa.
-- ============================================================================

alter table usuarios add column if not exists guide_state jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
