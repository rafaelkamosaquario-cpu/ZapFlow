-- ============================================================================
-- ZapFlow — V2.1: ciclo de vida da visita (Iniciar → Durante → Finalizar)
--
-- motivo/resultado deixam de ser obrigatórios na criação — só são exigidos
-- no momento de Finalizar. objetivo é o texto livre capturado ao Iniciar.
-- finished_at nulo = visita em andamento. fotos guarda o array de anexos já
-- enviados ao Google Drive (V3). google_evento_id liga a visita a um evento
-- criado na Google Agenda quando o retorno é agendado.
-- ============================================================================

alter table visitas alter column motivo drop not null;
alter table visitas alter column resultado drop not null;
alter table visitas add column if not exists objetivo text;
alter table visitas add column if not exists finished_at timestamptz;
alter table visitas add column if not exists fotos jsonb not null default '[]'::jsonb;
alter table visitas add column if not exists google_evento_id text;

create index if not exists idx_visitas_em_andamento on visitas (vendedor_id) where finished_at is null;

notify pgrst, 'reload schema';
