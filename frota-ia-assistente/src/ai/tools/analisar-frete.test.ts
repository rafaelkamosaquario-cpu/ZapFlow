import { describe, it, expect } from "vitest";
import { analisarFrete } from "./analisar-frete";

describe("analisar_frete — ANALISE_SIMPLES", () => {
  it("calcula lucro/margem e classifica como viável com ressalvas (nível PARCIAL por padrão)", () => {
    const r = analisarFrete({
      modo: "ANALISE_SIMPLES",
      receitaFreteIda: 5000,
      distanciaIdaKm: 1000,
      custoTotal: 3000,
    });
    expect(r.sucesso).toBe(true);
    expect(r.freteAnalisado?.lucro).toBe(2000);
    expect(r.freteAnalisado?.margemPercentual).toBe(40);
    expect(r.classificacaoGeral).toBe("VIAVEL_COM_RESSALVAS");
    expect(r.nivelCompletude).toBe("PARCIAL");
  });

  it("classifica como inviável e sinaliza risco crítico de prejuízo quando o custo supera a receita", () => {
    const r = analisarFrete({
      modo: "ANALISE_SIMPLES",
      receitaFreteIda: 2000,
      distanciaIdaKm: 1000,
      custoTotal: 3000,
    });
    expect(r.sucesso).toBe(true);
    expect(r.freteAnalisado?.lucro).toBe(-1000);
    expect(r.classificacaoGeral).toBe("INVIAVEL");
    expect(r.riscosGerais.some((risco) => risco.categoria === "PREJUIZO" && risco.nivel === "CRITICO")).toBe(true);
  });

  it("falha por distância igual a zero", () => {
    const r = analisarFrete({ modo: "ANALISE_SIMPLES", receitaFreteIda: 1000, distanciaIdaKm: 0, custoTotal: 500 });
    expect(r.sucesso).toBe(false);
  });

  it("rejeita por padrão receita informada como total e também detalhada por trecho", () => {
    const r = analisarFrete({
      modo: "ANALISE_SIMPLES",
      valorFreteTotal: 5000,
      receitaFreteIda: 4000,
      distanciaIdaKm: 1000,
      custoTotal: 3000,
    });
    expect(r.sucesso).toBe(false);
  });
});

describe("analisar_frete — RETORNO_VAZIO", () => {
  it("assume carregada = ida e vazia = volta, e sinaliza risco de retorno vazio quando relevante", () => {
    const r = analisarFrete({
      modo: "RETORNO_VAZIO",
      receitaFreteIda: 3000,
      distanciaIdaKm: 400,
      distanciaVoltaKm: 300,
      custoTotal: 1000,
    });
    expect(r.sucesso).toBe(true);
    expect(r.freteAnalisado?.distanciaCarregadaKm).toBe(400);
    expect(r.freteAnalisado?.distanciaVaziaKm).toBe(300);
    expect(r.freteAnalisado?.percentualKmVazio).toBeCloseTo(42.86, 1);
    expect(r.freteAnalisado?.riscos.some((risco) => risco.categoria === "RETORNO_VAZIO")).toBe(true);
  });
});

describe("analisar_frete — COMPARACAO_PROPOSTAS", () => {
  it("elege a proposta com melhor resultado geral (lucro, margem e risco)", () => {
    const r = analisarFrete({
      modo: "COMPARACAO_PROPOSTAS",
      propostas: [
        { nome: "Proposta A", receitaFreteIda: 5000, distanciaIdaKm: 1000, custoTotal: 4000 },
        { nome: "Proposta B", receitaFreteIda: 5000, distanciaIdaKm: 1000, custoTotal: 2000 },
      ],
    });
    expect(r.sucesso).toBe(true);
    expect(r.melhorProposta).toBe("Proposta B");
  });

  it("exige ao menos duas propostas", () => {
    const r = analisarFrete({
      modo: "COMPARACAO_PROPOSTAS",
      propostas: [{ nome: "Única", receitaFreteIda: 5000, distanciaIdaKm: 1000, custoTotal: 4000 }],
    });
    expect(r.sucesso).toBe(false);
  });
});
