-- Camada 6 (Fase G) — regra de produto: 1 veículo ativo por conta/empresa
-- nesta V1 (motorista autônomo / operação pequena). gerenciar_veiculo (modo
-- CRIAR) já checa isso antes de escrever; este índice único parcial é o
-- mesmo padrão de defesa em profundidade já usado em
-- company_preferences_unique_company e vehicle_cost_profiles_no_active_overlap
-- — a regra vale mesmo se algo escrever direto no banco, não só pela ferramenta.
-- "where active" permite reativar um veículo (ex.: trocar de veículo)
-- desativando o antigo antes, sem violar a constraint.

create unique index vehicles_one_active_per_company_idx on public.vehicles (company_id) where active;
