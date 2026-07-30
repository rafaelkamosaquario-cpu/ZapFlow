-- Camada 6 (Fase D) — registro de documentos gerados (metadados, não o
-- arquivo em si: o PDF é gerado na hora e enviado por base64 direto pela
-- Z-API, sem precisar de um bucket de Storage).

create table public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  analysis_run_id uuid references public.analysis_runs (id) on delete set null,
  document_type text not null,
  title text not null,
  file_name text not null,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.generated_documents is
  'Metadados de documentos (PDF) gerados sob pedido do cliente — nunca guarda o arquivo em si aqui, só o registro para histórico/auditoria.';

alter table public.generated_documents enable row level security;

create policy generated_documents_select_member on public.generated_documents
  for select using (public.is_company_member(company_id));

-- Sem policy de insert: hoje só o backend (client admin, via a ferramenta
-- gerar_documento) grava aqui — nunca há sessão de navegador tocando nesta
-- tabela.
