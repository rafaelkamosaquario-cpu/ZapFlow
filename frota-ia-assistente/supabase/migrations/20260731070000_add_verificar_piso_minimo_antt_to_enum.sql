-- Nova ferramenta verificar_piso_minimo_antt (Camada 6, Fase I): calcula o
-- piso mínimo legal de frete (Lei 13.703/2018) e compara com um valor
-- ofertado. Precisa constar no enum para tool_executions gravar sem erro
-- (mesmo padrão de correção já aplicado a gerenciar_google_calendar,
-- consultar_historico, gerenciar_alerta e gerar_documento).
alter type public.frota_ia_tool_name add value if not exists 'verificar_piso_minimo_antt';
