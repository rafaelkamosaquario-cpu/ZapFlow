-- ============================================================================
-- ZapFlow — V2: Visitas em Campo
--
-- Registro de visitas comerciais feitas por vendedores (papel `vendedor`,
-- criado pelo `owner` da empresa dentro do próprio ZapFlow). Sem Geocoding/
-- Places/Maps JS nesta versão (fase futura, junto com o Google conectado) —
-- só latitude/longitude brutas, capturadas pelo navegador do vendedor.
-- ============================================================================

create table if not exists visitas (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas (id) on delete cascade,
  vendedor_id         uuid not null references usuarios (id) on delete cascade,
  cliente_nome        text not null,
  contato_nome        text not null default '',
  contato_telefone    text,
  latitude            double precision,
  longitude           double precision,
  motivo              text not null check (motivo in ('Venda','Prospecção','Cobrança','Pós-venda','Outro')),
  resultado           text not null check (resultado in ('Interessado','Negociação','Sem interesse','Pedido fechado','Retornar')),
  observacao          text not null default '',
  proxima_acao        text not null default '',
  proxima_visita_data date,
  valor_potencial     numeric,
  data_hora           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_visitas_empresa_id on visitas (empresa_id);
create index if not exists idx_visitas_vendedor_id on visitas (vendedor_id);
create index if not exists idx_visitas_data_hora on visitas (data_hora);
create index if not exists idx_visitas_proxima_visita on visitas (proxima_visita_data)
  where proxima_visita_data is not null;

create trigger trg_visitas_updated before update on visitas
  for each row execute function set_updated_at();

alter table visitas enable row level security;
-- Sem policies (mesmo padrão do resto do schema): isolamento garantido em
-- db/repositories.js (empresaId + vendedorId sempre exigidos conforme o papel).

notify pgrst, 'reload schema';
