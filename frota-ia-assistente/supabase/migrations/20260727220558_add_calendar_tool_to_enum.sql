-- Adiciona gerenciar_google_calendar ao enum de nomes de ferramentas, para
-- que tool_executions cubra as 12 ferramentas (11 de cálculo + a de
-- integração com o Google Calendar) de forma uniforme. Não é destrutivo:
-- linhas existentes não são afetadas, só um novo valor passa a ser aceito.
alter type public.frota_ia_tool_name add value if not exists 'gerenciar_google_calendar';
