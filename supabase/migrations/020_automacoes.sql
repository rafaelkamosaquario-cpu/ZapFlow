-- Automações além do chatbot por palavra-chave (item que ficou de fora da
-- auditoria por falta de especificação -- agora definido junto com o Rafael).
-- Gatilho -> ação, mesmo espírito do chatbot (regras/gatilhos), mas reagindo
-- a eventos do CRM/Visitas em vez de conteúdo de mensagem recebida.
-- Gatilhos por tempo/inatividade ficam de fora (exigiriam um job em
-- background que o ZapFlow ainda não tem) -- só eventos que já acontecem
-- dentro de uma requisição existente (mudar etapa, finalizar visita).
--
-- Nome da tabela: "automacao_regras", NÃO "automacoes" -- esse nome já é
-- usado pela tabela do chatbot por palavra-chave (enabled/rules/fallback,
-- migration 007-ish), achado ao tentar aplicar essa migration.
create table if not exists automacao_regras (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas (id) on delete cascade,
  nome          text not null,
  ativa         boolean not null default true,
  gatilho_tipo  text not null check (gatilho_tipo in ('mudanca_etapa', 'resultado_visita')),
  gatilho_valor text not null, -- etapa do funil OU resultado de visita que dispara
  acao_tipo     text not null check (acao_tipo in ('enviar_mensagem', 'criar_followup')),
  acao_texto    text not null default '', -- mensagem (aceita {{nome}}) OU texto do follow-up
  acao_dias     integer, -- só usado em criar_followup: dias a partir de hoje
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_automacao_regras_empresa on automacao_regras (empresa_id);
create trigger trg_automacao_regras_updated before update on automacao_regras
  for each row execute function set_updated_at();
alter table automacao_regras enable row level security;

notify pgrst, 'reload schema';
