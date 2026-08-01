import { describe, it, expect } from "vitest";
import { calcularMargem } from "./calcular-margem";

describe("calcular_margem — MARGEM_SIMPLES", () => {
  it("calcula lucro, margem e classificação com receita e custo total", () => {
    const r = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: 10000, custoTotal: 7000 });
    expect(r.sucesso).toBe(true);
    expect(r.receitaLiquida).toBe(10000);
    expect(r.lucroLiquidoEstimado).toBe(3000);
    expect(r.margemLiquidaPercentual).toBe(30);
    expect(r.classificacao).toBe("MARGEM_SAUDAVEL");
    // sem impostos/comissão/indiretos informados => PARCIAL
    expect(r.nivelCompletude).toBe("PARCIAL");
  });

  it("classifica prejuízo quando o custo supera a receita", () => {
    const r = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: 1000, custoTotal: 1500 });
    expect(r.lucroLiquidoEstimado).toBe(-500);
    expect(r.classificacao).toBe("PREJUIZO");
    expect(r.alertas.some((a) => a.includes("prejuízo"))).toBe(true);
  });

  it("falha por dados faltantes sem custo informado por nenhuma fonte", () => {
    const r = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: 1000 });
    expect(r.sucesso).toBe(false);
  });

  it("rejeita por padrão custo informado por mais de uma fonte", () => {
    const r = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: 1000, custoTotal: 700, custosVariaveis: 500 });
    expect(r.sucesso).toBe(false);
    expect(r.mensagemResumo).toContain("mais de uma fonte");
  });

  it("suprime lucro/margem quando permitirEstimativas é false e o nível é PARCIAL", () => {
    const r = calcularMargem({ modo: "MARGEM_SIMPLES", receitaBruta: 10000, custoTotal: 7000, permitirEstimativas: false });
    expect(r.sucesso).toBe(true);
    expect(r.lucroLiquidoEstimado).toBeUndefined();
    expect(r.classificacao).toBeUndefined();
  });
});

describe("calcular_margem — PONTO_EQUILIBRIO e MARGEM_ALVO", () => {
  it("calcula a receita de ponto de equilíbrio sem exigir receita bruta", () => {
    const r = calcularMargem({ modo: "PONTO_EQUILIBRIO", custoTotal: 7000 });
    expect(r.sucesso).toBe(true);
    expect(r.receitaPontoEquilibrio).toBe(7000);
    expect(r.nivelCompletude).toBe("COMPLETO");
  });

  it("calcula a receita necessária para uma margem-alvo", () => {
    const r = calcularMargem({ modo: "MARGEM_ALVO", custoTotal: 7000, margemAlvoPercentual: 30 });
    expect(r.sucesso).toBe(true);
    expect(r.receitaParaMargemAlvo).toBe(10000); // 7000 / (1 - 0.30)
  });

  it("MARGEM_ALVO exige margemAlvoPercentual", () => {
    const r = calcularMargem({ modo: "MARGEM_ALVO", custoTotal: 7000 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_margem — COMPARACAO_CENARIOS", () => {
  it("rankeia os cenários por lucro e aponta o de maior lucro no resumo", () => {
    const r = calcularMargem({
      modo: "COMPARACAO_CENARIOS",
      cenarios: [
        { nome: "Frete A", receitaBruta: 5000, custoTotal: 4000 },
        { nome: "Frete B", receitaBruta: 8000, custoTotal: 5000 },
      ],
    });
    expect(r.sucesso).toBe(true);
    expect(r.comparacaoCenarios?.rankingPorLucro[0].nome).toBe("Frete B");
    expect(r.mensagemResumo).toContain("Frete B");
  });

  it("exige ao menos dois cenários", () => {
    const r = calcularMargem({ modo: "COMPARACAO_CENARIOS", cenarios: [{ nome: "Único", receitaBruta: 1000, custoTotal: 500 }] });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_margem — PREVISTO_X_REALIZADO", () => {
  it("compara lucro previsto e realizado e aponta o principal desvio", () => {
    const r = calcularMargem({
      modo: "PREVISTO_X_REALIZADO",
      previsto: { receitaBruta: 10000, custoTotal: 7000 },
      realizado: { receitaBruta: 10000, custoTotal: 8000 },
    });
    expect(r.sucesso).toBe(true);
    expect(r.previstoRealizado?.lucroPrevisto).toBe(3000);
    expect(r.previstoRealizado?.lucroRealizado).toBe(2000);
    expect(r.previstoRealizado?.diferencaLucro).toBe(-1000);
    expect(r.previstoRealizado?.principalDesvio).toBe("Custo");
  });
});
