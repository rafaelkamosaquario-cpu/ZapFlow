import { describe, it, expect } from "vitest";
import { calcularCombustivel } from "./calcular-combustivel";

describe("calcular_combustivel — PREVISAO_VIAGEM", () => {
  it("calcula litros e custo com distância e consumo informados", () => {
    const r = calcularCombustivel({
      modo: "PREVISAO_VIAGEM",
      distanciaKm: 500,
      consumoMedioKmLitro: 2.5,
      precoCombustivelLitro: 6,
    });
    expect(r.sucesso).toBe(true);
    expect(r.resultados.litrosNecessarios).toBe(200);
    expect(r.resultados.custoTotalCombustivel).toBe(1200);
    expect(r.resultados.custoCombustivelPorKm).toBe(2.4);
    expect(r.classificacao).toBe("VIAGEM_CALCULADA");
  });

  it("soma ida+volta quando os dois são informados", () => {
    const r = calcularCombustivel({
      modo: "PREVISAO_VIAGEM",
      distanciaIdaKm: 100,
      distanciaVoltaKm: 100,
      consumoMedioKmLitro: 2,
    });
    expect(r.resultados.distanciaTotalKm).toBe(200);
  });

  it("dobra a ida quando considerarIdaVolta é true e a volta não foi informada", () => {
    const r = calcularCombustivel({
      modo: "PREVISAO_VIAGEM",
      distanciaIdaKm: 150,
      considerarIdaVolta: true,
      consumoMedioKmLitro: 3,
    });
    expect(r.resultados.distanciaTotalKm).toBe(300);
  });

  it("aponta abastecimento necessário quando o tanque não é suficiente", () => {
    const r = calcularCombustivel({
      modo: "PREVISAO_VIAGEM",
      distanciaKm: 500,
      consumoMedioKmLitro: 2.5,
      litrosNoTanque: 100,
    });
    expect(r.classificacao).toBe("ABASTECIMENTO_NECESSARIO");
    expect(r.resultados.litrosFaltantes).toBe(100);
    expect(r.resultados.litrosRestantes).toBe(0);
    expect(r.alertas.length).toBeGreaterThan(0);
  });

  it("falha por dados faltantes sem inventar distância/consumo", () => {
    const r = calcularCombustivel({ modo: "PREVISAO_VIAGEM" });
    expect(r.sucesso).toBe(false);
    expect(r.dadosFaltantes).toContain("consumoMedioKmLitro");
  });

  it("rejeita distância total igual a zero", () => {
    const r = calcularCombustivel({ modo: "PREVISAO_VIAGEM", distanciaKm: 0, consumoMedioKmLitro: 2 });
    expect(r.sucesso).toBe(false);
  });

  it("rejeita consumo igual a zero", () => {
    const r = calcularCombustivel({ modo: "PREVISAO_VIAGEM", distanciaKm: 100, consumoMedioKmLitro: 0 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_combustivel — CONSUMO_REAL", () => {
  it("calcula km/l a partir de distância e litros consumidos", () => {
    const r = calcularCombustivel({ modo: "CONSUMO_REAL", distanciaKm: 400, litrosConsumidos: 100 });
    expect(r.sucesso).toBe(true);
    expect(r.resultados.consumoRealKmLitro).toBe(4);
    expect(r.resultados.litrosPor100Km).toBe(25);
  });

  it("usa hodômetro inicial/final quando informado em vez de distanciaKm", () => {
    const r = calcularCombustivel({
      modo: "CONSUMO_REAL",
      quilometragemInicial: 1000,
      quilometragemFinal: 1400,
      litrosConsumidos: 100,
    });
    expect(r.resultados.distanciaRealKm).toBe(400);
  });

  it("nunca assume litrosAbastecidos como litrosConsumidos", () => {
    // Nota: o alerta que explica por que litrosAbastecidos não foi usado é
    // descartado pela fábrica resultadoDadosFaltantes (sempre alertas: []) —
    // comportamento atual documentado aqui, não o ideal (reportado à parte).
    const r = calcularCombustivel({ modo: "CONSUMO_REAL", distanciaKm: 400, litrosAbastecidos: 100 });
    expect(r.sucesso).toBe(false);
    expect(r.dadosFaltantes).toContain("litrosConsumidos");
  });

  it("rejeita quilometragem final menor que a inicial", () => {
    const r = calcularCombustivel({
      modo: "CONSUMO_REAL",
      quilometragemInicial: 500,
      quilometragemFinal: 100,
      litrosConsumidos: 10,
    });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_combustivel — COMPARACAO_PREVISTO_REALIZADO", () => {
  it("classifica como dentro do esperado dentro da tolerância de 3%", () => {
    const r = calcularCombustivel({
      modo: "COMPARACAO_PREVISTO_REALIZADO",
      distanciaKm: 300,
      consumoPrevistoKmLitro: 3,
      consumoRealKmLitro: 3.05,
    });
    expect(r.classificacao).toBe("CONSUMO_DENTRO_DO_ESPERADO");
  });

  it("classifica como pior que o previsto fora da tolerância", () => {
    const r = calcularCombustivel({
      modo: "COMPARACAO_PREVISTO_REALIZADO",
      distanciaKm: 300,
      consumoPrevistoKmLitro: 3,
      consumoRealKmLitro: 2.5,
    });
    expect(r.classificacao).toBe("CONSUMO_PIOR_QUE_PREVISTO");
    expect(r.alertas.length).toBeGreaterThan(0);
  });

  it("classifica como melhor que o previsto fora da tolerância, acima", () => {
    const r = calcularCombustivel({
      modo: "COMPARACAO_PREVISTO_REALIZADO",
      distanciaKm: 300,
      consumoPrevistoKmLitro: 3,
      consumoRealKmLitro: 3.5,
    });
    expect(r.classificacao).toBe("CONSUMO_MELHOR_QUE_PREVISTO");
  });

  it("deriva consumo real de distância + litros consumidos quando não informado direto", () => {
    const r = calcularCombustivel({
      modo: "COMPARACAO_PREVISTO_REALIZADO",
      distanciaKm: 300,
      consumoPrevistoKmLitro: 3,
      litrosConsumidos: 100,
    });
    expect(r.sucesso).toBe(true);
    expect(r.resultados.consumoRealKmLitro).toBe(3);
  });
});

describe("calcular_combustivel — AUTONOMIA", () => {
  it("calcula autonomia teórica sem reserva", () => {
    const r = calcularCombustivel({ modo: "AUTONOMIA", litrosNoTanque: 100, consumoMedioKmLitro: 3 });
    expect(r.resultados.autonomiaTotalKm).toBe(300);
    expect(r.resultados.autonomiaUtilKm).toBeUndefined();
  });

  it("desconta a reserva informada e classifica corretamente", () => {
    const r = calcularCombustivel({
      modo: "AUTONOMIA",
      litrosNoTanque: 20,
      consumoMedioKmLitro: 2,
      percentualReserva: 50,
    });
    // 20L, 50% reserva => 10L úteis * 2 km/l = 20km => insuficiente (<= 50km)
    expect(r.resultados.autonomiaUtilKm).toBe(20);
    expect(r.classificacao).toBe("AUTONOMIA_INSUFICIENTE");
  });

  it("classifica autonomia suficiente acima do limite de alerta", () => {
    const r = calcularCombustivel({ modo: "AUTONOMIA", litrosNoTanque: 100, consumoMedioKmLitro: 3 });
    expect(r.classificacao).toBe("AUTONOMIA_SUFICIENTE");
  });
});

describe("calcular_combustivel — COMPARACAO_CENARIOS", () => {
  it("aponta o cenário mais econômico por custo/km", () => {
    const r = calcularCombustivel({
      modo: "COMPARACAO_CENARIOS",
      cenarioA: { descricaoCenario: "Rota A", distanciaKm: 100, consumoMedioKmLitro: 2, precoCombustivelLitro: 6 },
      cenarioB: { descricaoCenario: "Rota B", distanciaKm: 100, consumoMedioKmLitro: 4, precoCombustivelLitro: 6 },
    });
    expect(r.sucesso).toBe(true);
    expect(r.cenarioMaisEconomico).toBe("Rota B");
    expect(r.resultados.cenarioACustoPorKm).toBe(3);
    expect(r.resultados.cenarioBCustoPorKm).toBe(1.5);
  });

  it("falha por dados faltantes quando um cenário está incompleto", () => {
    const r = calcularCombustivel({
      modo: "COMPARACAO_CENARIOS",
      cenarioA: { distanciaKm: 100, consumoMedioKmLitro: 2, precoCombustivelLitro: 6 },
      cenarioB: { distanciaKm: 100 },
    });
    expect(r.sucesso).toBe(false);
    expect(r.dadosFaltantes).toContain("cenarioB.consumoMedioKmLitro");
  });
});
