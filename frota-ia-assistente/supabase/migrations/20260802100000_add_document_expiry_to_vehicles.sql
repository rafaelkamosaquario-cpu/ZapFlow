alter table public.vehicles
  add column insurance_expiry_date date,
  add column licensing_expiry_date date;

comment on column public.vehicles.insurance_expiry_date is
  'Data de vencimento do seguro do veiculo, extraida de foto do comprovante ou informada pelo cliente - usada pra oferecer criar um lembrete (gerenciar_alerta) antes de vencer.';

comment on column public.vehicles.licensing_expiry_date is
  'Data de vencimento do licenciamento/CRLV do veiculo, extraida de foto do documento ou informada pelo cliente - mesmo uso do seguro.';
