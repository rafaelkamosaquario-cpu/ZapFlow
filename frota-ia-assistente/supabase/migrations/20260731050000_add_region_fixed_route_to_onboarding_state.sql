-- Onboarding redesenhado (WhatsApp): duas novas perguntas obrigatórias
-- entre "cidade base" e "quantidade de veículos" — região de atuação e se
-- trabalha com rota fixa. Detalhe de configuração de veículo/implemento
-- continua fora do onboarding (progressivo, perguntado sob demanda pela
-- IA quando uma ferramenta precisar), então não entra neste enum.
alter type public.onboarding_state add value if not exists 'awaiting_region' after 'awaiting_base_location';
alter type public.onboarding_state add value if not exists 'awaiting_fixed_route' after 'awaiting_region';
