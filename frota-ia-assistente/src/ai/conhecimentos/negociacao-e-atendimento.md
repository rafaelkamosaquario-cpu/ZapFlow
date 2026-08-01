# Negociação de frete e atendimento

> Referência geral de boas práticas — nunca um número ou regra fixa. Sempre combinada com os dados reais da viagem (calculados pelas ferramentas do sistema), nunca no lugar deles.

## Como ler uma oferta de frete antes de responder

- O valor ofertado sozinho não diz nada — só faz sentido comparado ao custo real da viagem (`calcular_custo_viagem`/`analisar_frete`) e, quando aplicável, ao piso legal (`verificar_piso_minimo_antt`).
- Prazo de pagamento longo (30, 45, 60 dias) reduz o valor real do frete pelo custo de capital de quem precisa pagar diesel/pedágio adiantado — vale considerar isso na análise, não só o valor de face.
- Retorno vazio "escondido" é o erro mais comum: uma oferta que parece boa na ida pode não compensar se não houver carga de volta. Sempre perguntar/confirmar isso antes de fechar.
- Carga que exige espera longa pra carregar/descarregar (chapa, fila, agendamento apertado) tem custo de tempo parado que raramente está no valor ofertado — vale perguntar sobre isso.

## Sinais de alerta comuns (referência, não acusação)

- Pressa incomum pra fechar sem detalhar a carga, rota exata ou forma de pagamento.
- Pedido pra sair sem contrato/CT-e ou com documentação incompleta.
- Valor muito acima do mercado pra rota/tipo de carga, sem explicação — vale checar com mais cuidado antes de aceitar.
- Nenhuma referência verificável do contratante (histórico, outros motoristas que já trabalharam com ele).

Esses são pontos de atenção pra o próprio motorista avaliar — a Frota IA nunca acusa nem afirma fraude, só sinaliza o padrão pra decisão do usuário.

## Negociação — pontos de partida úteis

- Ter o custo real calculado (CPK, custo da viagem) *antes* de negociar é a maior vantagem — dá segurança pra recusar valor abaixo do piso econômico sem "no olho".
- Negociar com base em variável concreta (km rodado vazio, tempo de espera, pedágio) tende a ser mais eficaz do que negociar só "o valor está baixo".
- Vale sempre deixar claro o que está incluso no valor (pedágio, ajudante, seguro de carga) — desentendimento sobre isso é fonte comum de prejuízo depois.

## Atendimento e comunicação com o contratante/embarcador

- Confirmar por escrito (mensagem, e-mail) os pontos-chave acordados — valor, prazo de pagamento, quem paga pedágio, data/hora de carga — reduz disputa depois.
- Avisar com antecedência qualquer atraso ou imprevisto tende a preservar a relação melhor do que justificar depois do fato.
