import { describe, it, expect } from "vitest";
import { calcularCustoDia } from "./calcular-custo-dia";

describe("calcular_custo_dia — custo informado direto + receita", () => {
  it("calcula lucro e margem diária e classifica como resultado positivo", () => {
    const r = calcularCustoDia({ modo: "CUSTO_TOTAL_DIARIO", custoTotalDiarioInformado: 500, receitaDia: 800 });
    expect(r.sucesso).toBe(true);
    expect(r.custoTotalDiario).toBe(500);
    expect(r.lucroDiario).toBe(300);
    expect(r.margemDiariaPercentual).toBe(37.5);
    expect(r.classificacao).toBe("RESULTADO_POSITIVO");
  });

  it("classifica como sem receita quando receitaDia não é informada", () => {
    const r = calcularCustoDia({ modo: "CUSTO_TOTAL_DIARIO", custoTotalDiarioInformado: 500 });
    expect(r.sucesso).toBe(true);
    expect(r.classificacao).toBe("SEM_RECEITA");
  });
});

describe("calcular_custo_dia — custos fixos rateados por periodicidade", () => {
  it("rateia um custo fixo mensal pelos dias corridos do período (tipoDia=CORRIDO)", () => {
    const r = calcularCustoDia({
      modo: "CUSTO_POR_DIA_CORRIDO",
      diasCorridosPeriodo: 30,
      custosFixos: [{ descricao: "Financiamento", valor: 3000, periodicidade: "MENSAL" }],
    });
    expect(r.sucesso).toBe(true);
    expect(r.custoFixoDiario).toBe(100); // 3000 / 30
    expect(r.custoTotalDiario).toBe(100);
  });

  it("falha quando um item MENSAL não tem base de dias para ratear", () => {
    const r = calcularCustoDia({
      modo: "CUSTO_TOTAL_DIARIO",
      custosFixos: [{ descricao: "Financiamento", valor: 3000, periodicidade: "MENSAL" }],
    });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_custo_dia — validação", () => {
  it("rejeita custo informado por mais de uma fonte", () => {
    const r = calcularCustoDia({
      modo: "CUSTO_TOTAL_DIARIO",
      custoTotalDiarioInformado: 500,
      custosFixos: [{ descricao: "Seguro", valor: 100, periodicidade: "DIARIO" }],
    });
    expect(r.sucesso).toBe(false);
  });

  it("MULTIPLOS_VEICULOS exige a lista de veículos", () => {
    const r = calcularCustoDia({ modo: "MULTIPLOS_VEICULOS" });
    expect(r.sucesso).toBe(false);
  });
});
