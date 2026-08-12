-- Renomeia a etapa do funil "Cliente" para "Fechado" (nome final não confundir
-- com o substantivo "cliente" usado em todo o resto do produto).
update clientes set stage = 'Fechado' where stage = 'Cliente';

comment on column clientes.stage is 'Novo|Contatado|Respondeu|Negociando|Fechado|Perdido';

notify pgrst, 'reload schema';
