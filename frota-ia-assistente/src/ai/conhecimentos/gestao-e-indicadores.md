# Gestão e indicadores

> Referência geral pra interpretar resultado, nunca pra calculá-lo. Todo número (CPK, margem, receita por km) sempre vem de uma ferramenta do sistema — este arquivo só ajuda a explicar o que o número significa na prática.

## CPK (custo por quilômetro) — como ler o resultado

- CPK sozinho não diz se está "bom" ou "ruim" — só faz sentido comparado com a receita por km da mesma operação (`calcular_receita_km`) ou com o histórico do próprio veículo ao longo do tempo.
- CPK que sobe mês a mês sem mudança de rota geralmente aponta pra 3 causas mais comuns: combustível (preço ou consumo), manutenção corretiva não planejada, ou pneu desgastando mais rápido que o esperado — vale investigar por categoria, não só olhar o total.
- Comparar CPK entre veículos diferentes só é justo se a operação for parecida (tipo de carga, tipo de rota) — caminhão de rodovia asfaltada e caminhão de estrada de terra não são comparáveis diretamente.

## Margem — o que costuma passar despercebido

- Margem percentual e margem em reais contam histórias diferentes: um frete com margem % alta mas poucos km pode valer menos, em dinheiro, que um frete com margem % menor mas rota longa.
- Custo fixo (seguro, licenciamento, financiamento) continua existindo mesmo com o veículo parado — ignorar isso ao calcular "quanto sobrou" de um frete específico costuma inflar a margem aparente.
- Retorno vazio, quando existe, sempre deveria entrar na conta da viagem completa, não só da ida — senão a margem real fica mascarada.

## Sinais de que vale revisar a operação

- Custo por km subindo de forma consistente, não pontual.
- Dias parados (esperando carga, manutenção) aumentando mês a mês — `calcular_custo_veiculo_parado` ajuda a colocar isso em número.
- Margem "no papel" positiva, mas caixa apertado na prática — geralmente sinal de que algum custo real não está sendo contabilizado na análise.

## Como isso se conecta com o resto do sistema

- Todo indicador citado aqui (CPK, margem, receita/km, custo de parada) tem uma ferramenta própria que calcula o número real — este arquivo nunca substitui isso, só ajuda a interpretar o resultado depois de calculado.
