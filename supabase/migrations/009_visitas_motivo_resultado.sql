-- ============================================================================
-- ZapFlow — Item 5.3: taxonomia de Motivo/Resultado da visita mais precisa
--
-- Motivo (por que visitou) e Resultado (o que saiu da visita) já eram campos
-- separados no schema -- essa migration só amplia/precisa o vocabulário de
-- cada um (ex.: "Venda" não fazia sentido como motivo, é resultado; faltava
-- "Proposta solicitada" como resultado intermediário). Só 2 linhas existem
-- em produção hoje, migradas manualmente antes de trocar os CHECK constraints.
-- ============================================================================

alter table visitas drop constraint if exists visitas_motivo_check;
alter table visitas drop constraint if exists visitas_resultado_check;

update visitas set motivo = 'Outro' where motivo = 'Venda';
update visitas set resultado = 'Em negociação' where resultado = 'Negociação';
update visitas set resultado = 'Venda fechada' where resultado = 'Pedido fechado';
update visitas set resultado = 'Retornar depois' where resultado = 'Retornar';

alter table visitas add constraint visitas_motivo_check
  check (motivo = any (array['Prospecção','Apresentação','Negociação','Pós-venda','Cobrança','Outro']));
alter table visitas add constraint visitas_resultado_check
  check (resultado = any (array['Sem contato','Interessado','Proposta solicitada','Em negociação','Venda fechada','Retornar depois','Sem interesse']));

notify pgrst, 'reload schema';
