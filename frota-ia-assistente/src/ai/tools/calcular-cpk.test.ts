import { describe, it, expect } from "vitest";
import { calcularCpk } from "./calcular-cpk";

describe("calcular_cpk — categoria única", () => {
  it("calcula CPK de pneus somando os custos informados", () => {
    const r = calcularCpk({ modo: "CPK_PNEUS", quilometragem: 10000, custoPneus: 800, custoRecapagem: 200 });
    expect(r.sucesso).toBe(true);
    expect(r.resultados.cpk).toBe(0.1);
    expect(r.custosConsiderados).toEqual(["Pneus", "Recapagem"]);
  });

  it("lista custos não informados em custosIgnorados, sem tratá-los como zero", () => {
    const r = calcularCpk({ modo: "CPK_PNEUS", quilometragem: 10000, custoPneus: 800 });
    expect(r.custosIgnorados).toContain("Recapagem");
    expect(r.alertas.some((a) => a.includes("não representa o custo completo"))).toBe(true);
  });

  it("falha por dados faltantes quando nenhum custo da categoria foi informado", () => {
    const r = calcularCpk({ modo: "CPK_PNEUS", quilometragem: 10000 });
    expect(r.sucesso).toBe(false);
    expect(r.classificacao).toBe("DADOS_INSUFICIENTES");
  });

  it("rejeita quilometragem igual a zero", () => {
    const r = calcularCpk({ modo: "CPK_PNEUS", quilometragem: 0, custoPneus: 100 });
    expect(r.sucesso).toBe(false);
  });

  it("classifica CPK de combustível pelas faixas definidas", () => {
    // excelenteAte 1.6, bomAte 2.0, atencaoAte 2.5 (LIMITES_CLASSIFICACAO_CPK)
    const excelente = calcularCpk({ modo: "CPK_COMBUSTIVEL", quilometragem: 1000, custoCombustivel: 1500 });
    expect(excelente.classificacao).toBe("EXCELENTE");

    const critico = calcularCpk({ modo: "CPK_COMBUSTIVEL", quilometragem: 1000, custoCombustivel: 3000 });
    expect(critico.classificacao).toBe("CRITICO");
    expect(critico.alertas.some((a) => a.includes("crítico"))).toBe(true);
  });

  it("custo personalizado usa o rótulo informado", () => {
    const r = calcularCpk({
      modo: "CPK_OPERACIONAL",
      quilometragem: 1000,
      custoPersonalizado: 50,
      descricaoCustoPersonalizado: "Lavagem do caminhão",
    });
    expect(r.custosConsiderados).toContain("Custo personalizado (Lavagem do caminhão)");
  });
});

describe("calcular_cpk — CPK_TOTAL", () => {
  it("soma todas as categorias informadas e devolve o detalhamento por categoria", () => {
    const r = calcularCpk({
      modo: "CPK_TOTAL",
      quilometragem: 1000,
      custoPneus: 100,
      custoCombustivel: 1600,
      custoManutencaoPreventiva: 50,
    });
    expect(r.sucesso).toBe(true);
    expect(r.resultados.custoTotalConsiderado).toBe(1750);
    expect(r.resultados.cpk).toBe(1.75);
    expect(r.resultados.cpkPorCategoria?.pneus).toBe(0.1);
    expect(r.resultados.cpkPorCategoria?.combustivel).toBe(1.6);
    expect(r.resultados.cpkPorCategoria?.operacional).toBeUndefined();
  });
});

describe("calcular_cpk — COMPARACAO_CPK", () => {
  it("aponta a operação com menor CPK e calcula economia estimada", () => {
    const r = calcularCpk({
      modo: "COMPARACAO_CPK",
      categoriaComparacao: "PNEUS",
      operacaoA: { descricao: "Pneu novo", quilometragem: 10000, custoPneus: 1000 },
      operacaoB: { descricao: "Pneu recapado", quilometragem: 10000, custoPneus: 400 },
    });
    expect(r.sucesso).toBe(true);
    expect(r.resultados.operacaoMaisEconomica).toBe("Pneu recapado");
    expect(r.resultados.cpkOperacaoA).toBe(0.1);
    expect(r.resultados.cpkOperacaoB).toBe(0.04);
    expect(r.resultados.economiaEstimada).toBeCloseTo(600, 5);
  });

  it("falha por dados faltantes quando falta quilometragem de uma operação", () => {
    const r = calcularCpk({
      modo: "COMPARACAO_CPK",
      operacaoA: { descricao: "A", custoPneus: 100 },
      operacaoB: { descricao: "B", quilometragem: 1000, custoPneus: 100 },
    });
    expect(r.sucesso).toBe(false);
  });
});
