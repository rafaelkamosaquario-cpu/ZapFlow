# Manutenção preventiva

> Referência geral — intervalos e sinais variam por fabricante, modelo, ano e tipo de operação (rodovia asfaltada x estrada não pavimentada, carga pesada constante etc.). O manual do fabricante e um mecânico de confiança sempre têm prioridade sobre esta referência. Nunca usar isto para diagnosticar um problema específico do veículo do cliente — só como conhecimento geral de apoio.

## Por que manutenção preventiva pesa no CPK

Cada dia de veículo parado por pane evitável tem custo duplo: o conserto em si, mais o frete que deixou de ser feito (ver `calcular_custo_veiculo_parado`). Manutenção preventiva bem feita normalmente custa menos, no total, que manutenção corretiva de emergência.

## Itens que costumam ter intervalo regular (como referência, não como regra fixa)

- **Óleo do motor e filtros** — intervalo varia bastante por tipo de óleo (mineral/sintético) e uso; o manual do veículo é a fonte correta.
- **Filtro de combustível e de ar** — sujeira acelera desgaste de bomba injetora e reduz eficiência de queima (afeta consumo).
- **Freios (lonas/pastilhas, cuíca)** — desgaste mais rápido em operação de serra/montanha; verificação visual periódica evita parada de emergência.
- **Suspensão e feixe de mola** — folga ou trinca não tratada cedo tende a virar problema maior (e mais caro) depois.
- **Correias e mangueiras** — ressecamento é mais comum pelo tempo do que pelo uso; vale inspeção mesmo em veículo pouco rodado.
- **Sistema de arrefecimento** — superaquecimento é uma das causas mais comuns de parada não planejada em viagem longa.

## Sinais de alerta que costumam anteceder pane maior

- Luz de alerta no painel que não passa depois de reiniciar.
- Ruído novo ou diferente do habitual (não "normalizar" um barulho estranho).
- Consumo de combustível subindo sem motivo aparente (pode indicar problema mecânico, não só direção).
- Vazamento de qualquer fluido debaixo do veículo, mesmo pequeno.

## Como isso se conecta com o resto do sistema

- Um gasto de manutenção real deve ser registrado com `registrar_despesa` — isso alimenta o CPK de verdade, não uma estimativa genérica.
- Uma manutenção programada pode virar lembrete com `gerenciar_alerta` ou evento com `gerenciar_google_calendar`.
- Se o veículo ficar parado pra manutenção, `calcular_custo_veiculo_parado` mostra o impacto financeiro real da parada, não só o custo da peça/serviço.
