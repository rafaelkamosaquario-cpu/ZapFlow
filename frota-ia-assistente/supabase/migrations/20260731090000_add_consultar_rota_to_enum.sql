-- Nova ferramenta consultar_rota (Camada 6, Fase J — Google Maps Platform:
-- Geocoding API + Routes API). Precisa constar no enum para
-- tool_executions gravar sem erro (mesmo padrão de correção já aplicado
-- às ferramentas de integração anteriores).
alter type public.frota_ia_tool_name add value if not exists 'consultar_rota';
