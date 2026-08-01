import { describe, it, expect } from "vitest";
import { calcularReceitaKm } from "./calcular-receita-km";

describe("calcular_receita_km — RECEITA_BRUTA_POR_KM", () => {
  it("calcula receita bruta/líquida por km e marca classificação como dados insuficientes sem custo/CPK", () => {
    const r = calcularReceitaKm({ modo: "RECEITA_BRUTA_POR_KM", receitaBruta: 5000, distanciaTotalKm: 1000 });
    expect(r.sucesso).toBe(true);
    expect(r.receitaBrutaPorKm).toBe(5);
    expect(r.receitaLiquidaPorKm).toBe(5);
    expect(r.classificacao).toBe("DADOS_INSUFICIENTES");
  });

  it("falha quando não há nenhuma forma de distância informada", () => {
    const r = calcularReceitaKm({ modo: "RECEITA_BRUTA_POR_KM", receitaBruta: 5000 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_receita_km — RECEITA_E_CUSTO_POR_KM", () => {
  it("calcula custo/lucro por km e classifica acima do valor mínimo (ponto de equilíbrio derivado)", () => {
    const r = calcularReceitaKm({
      modo: "RECEITA_E_CUSTO_POR_KM",
      receitaBruta: 5000,
      distanciaTotalKm: 1000,
      custoTotal: 3000,
    });
    expect(r.sucesso).toBe(true);
    expect(r.custoPorKm).toBe(3);
    expect(r.lucroPorKm).toBe(2);
    expect(r.margemPercentual).toBe(40);
    expect(r.receitaMinimaPorKm).toBe(3); // ponto de equilíbrio derivado via calcular_valor_minimo_frete
    expect(r.classificacao).toBe("ACIMA_DO_VALOR_MINIMO");
  });
});

describe("calcular_receita_km — validação", () => {
  it("rejeita receita informada como total e também detalhada por trecho", () => {
    const r = calcularReceitaKm({
      modo: "RECEITA_BRUTA_POR_KM",
      receitaBruta: 5000,
      receitaIda: 3000,
      distanciaTotalKm: 1000,
    });
    expect(r.sucesso).toBe(false);
  });

  it("rejeita custo informado por mais de uma fonte", () => {
    const r = calcularReceitaKm({
      modo: "RECEITA_E_CUSTO_POR_KM",
      receitaBruta: 5000,
      distanciaTotalKm: 1000,
      custoTotal: 3000,
      cpkTotal: 3,
    });
    expect(r.sucesso).toBe(false);
  });

  it("MULTIPLAS_VIAGENS exige a lista de viagens", () => {
    const r = calcularReceitaKm({ modo: "MULTIPLAS_VIAGENS" });
    expect(r.sucesso).toBe(false);
  });
});
