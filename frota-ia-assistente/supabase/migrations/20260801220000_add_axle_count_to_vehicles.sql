alter table public.vehicles
  add column axle_count integer;

alter table public.vehicles
  add constraint vehicles_axle_count_plausible
  check (axle_count is null or (axle_count between 1 and 12));

comment on column public.vehicles.axle_count is
  'Numero de eixos do veiculo/conjunto (informado pelo cliente, nunca estimado a partir de vehicle_type) - usado como referencia salva para verificar_piso_minimo_antt, evitando perguntar de novo a cada calculo.';
