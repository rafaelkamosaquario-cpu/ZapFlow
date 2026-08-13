-- Adiciona "Suporte" como motivo de visita (achado da auditoria: a spec pedia
-- 7 opções, o código só tinha 6).
alter table visitas drop constraint if exists visitas_motivo_check;
alter table visitas add constraint visitas_motivo_check
  check (motivo = any (array['Prospecção','Apresentação','Negociação','Pós-venda','Cobrança','Suporte','Outro']));

notify pgrst, 'reload schema';
