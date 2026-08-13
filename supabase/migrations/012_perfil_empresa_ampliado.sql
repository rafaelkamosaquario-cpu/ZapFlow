-- Amplia o perfil da empresa (configuracoes_ia) com os campos que a
-- auditoria apontou como faltantes vs a especificacao ideal do ZapFlow IA.
alter table configuracoes_ia
  add column if not exists cliente_ideal    text not null default '',
  add column if not exists prazo            text not null default '',
  add column if not exists garantias        text not null default '',
  add column if not exists politicas        text not null default '',
  add column if not exists palavras_evitar  text not null default '',
  add column if not exists site             text not null default '',
  add column if not exists instagram        text not null default '',
  add column if not exists observacoes_ia   text not null default '';

notify pgrst, 'reload schema';
