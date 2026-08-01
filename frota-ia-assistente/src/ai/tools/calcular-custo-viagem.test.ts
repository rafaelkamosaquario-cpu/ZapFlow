import { describe, it, expect } from "vitest";
import { calcularCustoViagem } from "./calcular-custo-viagem";

describe("calcular_custo_viagem — VIAGEM_SIMPLES", () => {
  it("soma combustível + pedágio e calcula custo/km (nível PARCIAL sem custo fixo)", () => {
    const r = calcularCustoViagem({
      modo: "VIAGEM_SIMPLES",
      distanciaIdaKm: 500,
      veiculo: { consumoMedioKmLitro: 2.5, precoCombustivelLitro: 6 },
      pedagios: { valorTotal: 50 },
    });
    expect(r.sucesso).toBe(true);
    expect(r.distanciaTotalKm).toBe(500);
    expect(r.custoTotal).toBe(1250); // 200L * 6 + 50 pedágio
    expect(r.custoPorKm).toBe(2.5);
    expect(r.nivelCompletude).toBe("PARCIAL"); // sem nenhum custo fixo informado
  });

  it("alcança nível COMPLETO quando há combustível e ao menos um custo fixo (rateado por km)", () => {
    const r = calcularCustoViagem({
      modo: "VIAGEM_SIMPLES",
      distanciaIdaKm: 1000,
      veiculo: { consumoMedioKmLitro: 2, precoCombustivelLitro: 5 },
      custosFixos: { seguroVeiculo: { valor: 0.05, base: "POR_KM" } },
    });
    expect(r.sucesso).toBe(true);
    expect(r.custoTotal).toBe(2550); // 500L*5 + 0.05*1000km
    expect(r.nivelCompletude).toBe("COMPLETO");
  });

  it("falha por dados faltantes sem distanciaIdaKm", () => {
    const r = calcularCustoViagem({ modo: "VIAGEM_SIMPLES", veiculo: { consumoMedioKmLitro: 2, precoCombustivelLitro: 5 } });
    expect(r.sucesso).toBe(false);
    expect(r.dadosFaltantes).toContain("distanciaIdaKm");
  });

  it("rejeita distância igual a zero", () => {
    const r = calcularCustoViagem({ modo: "VIAGEM_SIMPLES", distanciaIdaKm: 0 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_custo_viagem — IDA_E_VOLTA", () => {
  it("exige distanciaVoltaKm e rejeita zero", () => {
    const semVolta = calcularCustoViagem({ modo: "IDA_E_VOLTA", distanciaIdaKm: 100 });
    expect(semVolta.sucesso).toBe(false);
    expect(semVolta.dadosFaltantes).toContain("distanciaVoltaKm");

    const voltaZero = calcularCustoViagem({ modo: "IDA_E_VOLTA", distanciaIdaKm: 100, distanciaVoltaKm: 0 });
    expect(voltaZero.sucesso).toBe(false);
  });
});

describe("calcular_custo_viagem — sobreposição de custos", () => {
  const base = {
    modo: "VIAGEM_SIMPLES" as const,
    distanciaIdaKm: 500,
    custoCombustivelInformado: 800,
    veiculo: { consumoMedioKmLitro: 2, precoCombustivelLitro: 5 },
  };

  it("rejeita por padrão quando combustível vem informado de duas formas", () => {
    const r = calcularCustoViagem(base);
    expect(r.sucesso).toBe(false);
    expect(r.mensagemResumo).toContain("sobreposição");
  });

  it("PRIORIZAR_TOTAL usa o valor pronto e ignora consumo/preço", () => {
    const r = calcularCustoViagem({ ...base, estrategiaSobreposicao: "PRIORIZAR_TOTAL" });
    expect(r.sucesso).toBe(true);
    const combustivel = r.custosPorCategoria.find((c) => c.categoria === "Combustível");
    expect(combustivel?.valor).toBe(800);
    expect(r.alertas.some((a) => a.includes("sobreposição resolvida"))).toBe(true);
  });

  it("PRIORIZAR_DETALHADO recalcula pelo consumo/preço e ignora o valor pronto", () => {
    const r = calcularCustoViagem({ ...base, estrategiaSobreposicao: "PRIORIZAR_DETALHADO" });
    expect(r.sucesso).toBe(true);
    const combustivel = r.custosPorCategoria.find((c) => c.categoria === "Combustível");
    expect(combustivel?.valor).toBe(1250); // (500/2) * 5
  });
});

describe("calcular_custo_viagem — COMPARACAO_PREVISTO_REALIZADO", () => {
  it("compara custo previsto e realizado e aponta o principal desvio", () => {
    const r = calcularCustoViagem({
      modo: "COMPARACAO_PREVISTO_REALIZADO",
      previsto: { distanciaIdaKm: 500, veiculo: { consumoMedioKmLitro: 2.5, precoCombustivelLitro: 6 }, pedagios: { valorTotal: 50 } },
      realizado: { distanciaIdaKm: 500, veiculo: { consumoMedioKmLitro: 2, precoCombustivelLitro: 6 }, pedagios: { valorTotal: 80 } },
    });
    expect(r.sucesso).toBe(true);
    expect(r.comparacaoPrevistoRealizado?.custoPrevisto).toBe(1250);
    // realizado: (500/2)*6 + 80 = 1500 + 80 = 1580
    expect(r.comparacaoPrevistoRealizado?.custoRealizado).toBe(1580);
    expect(r.comparacaoPrevistoRealizado?.diferencaValor).toBe(330);
    expect(r.comparacaoPrevistoRealizado?.categoriasAcimaDoPrevisto).toContain("Combustível");
  });

  it("falha quando falta o bloco previsto ou realizado", () => {
    const r = calcularCustoViagem({ modo: "COMPARACAO_PREVISTO_REALIZADO", previsto: { distanciaIdaKm: 100 } });
    expect(r.sucesso).toBe(false);
    expect(r.dadosFaltantes).toContain("realizado");
  });
});

describe("calcular_custo_viagem — MULTIPLOS_VEICULOS", () => {
  it("multiplica o custo por veículo pela quantidade de veículos", () => {
    const r = calcularCustoViagem({
      modo: "MULTIPLOS_VEICULOS",
      distanciaIdaKm: 500,
      quantidadeVeiculos: 3,
      veiculo: { consumoMedioKmLitro: 2.5, precoCombustivelLitro: 6 },
    });
    expect(r.sucesso).toBe(true);
    expect(r.custoPorVeiculo).toBe(1200); // 200L * 6
    expect(r.custoTotal).toBe(3600); // 1200 * 3 veículos
  });
});
