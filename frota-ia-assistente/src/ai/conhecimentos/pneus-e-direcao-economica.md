# Pneus e direção econômica

> Referência geral de boas práticas. Para a decisão de custo (novo x recapado, qual comprar), a ferramenta `comparar_pneus` é sempre a fonte do número — este arquivo é sobre como cuidar do pneu e dirigir de forma mais econômica, não sobre quanto custa.

## O que reduz a vida útil do pneu antes da hora

- Calibragem errada (pra menos ou pra mais) é uma das causas mais comuns de desgaste irregular e consumo maior de combustível — vale checagem regular, não só "quando parece murcho".
- Desalinhamento e desbalanceamento causam desgaste irregular mesmo com calibragem correta.
- Excesso de peso além da capacidade do eixo acelera desgaste e é também questão de segurança/legislação.
- Frenagem e arrancada bruscas desgastam mais rápido que condução suave, além de gastar mais combustível.

## Rodízio e inspeção

- Inspeção visual regular (cortes, bolhas, desgaste irregular entre pneus do mesmo eixo) ajuda a pegar problema antes de virar pane em viagem.
- Pneus do mesmo eixo com desgaste muito diferente entre si costuma indicar problema de calibragem, alinhamento ou suspensão — vale investigar a causa, não só trocar o pneu.

## Direção econômica — hábitos que tendem a reduzir consumo

- Manter velocidade constante gasta menos combustível que acelerar e frear repetidamente.
- Antecipar o tráfego à frente (soltar o acelerador cedo em vez de frear em cima da hora) economiza combustível e pneu/freio ao mesmo tempo.
- Usar o freio motor em descidas longas poupa o sistema de freio, mas o hábito de dirigir na faixa de rotação recomendada pelo fabricante costuma ter mais impacto no consumo geral.
- Ar-condicionado, excesso de peso não relacionado à carga e pneu mal calibrado são fatores que aumentam consumo de forma silenciosa — vale considerar quando o consumo real (`calcular_combustivel`, modo de consumo real) aparecer pior que o esperado.

## Como isso se conecta com o resto do sistema

- A comparação de custo entre pneu novo e recapado é sempre `comparar_pneus` — nunca uma estimativa de memória.
- Se o consumo real do veículo estiver consistentemente pior que o esperado, vale registrar e comparar via `calcular_combustivel` (modo de comparação previsto x realizado) — pode ser sinal de pneu, alinhamento ou hábito de direção, não só do veículo em si.
