import { describe, it, expect } from "vitest";
import { calcularValorMinimoFrete } from "./calcular-valor-minimo-frete";

describe("calcular_valor_minimo_frete — PONTO_EQUILIBRIO e MARGEM_ALVO", () => {
  it("ponto de equilíbrio sem deduções é igual ao custo total", () => {
    const r = calcularValorMinimoFrete({ modo: "PONTO_EQUILIBRIO", custoTotal: 7000 });
    expect(r.sucesso).toBe(true);
    expect(r.valorPontoEquilibrio).toBe(7000);
  });

  it("valor mínimo com margem-alvo aplica a fórmula base/(1-margem)", () => {
    const r = calcularValorMinimoFrete({ modo: "MARGEM_ALVO", custoTotal: 7000, margemAlvoPercentual: 30 });
    expect(r.sucesso).toBe(true);
    expect(r.valorMinimoComMargem).toBe(10000); // 7000 / (1 - 0.30)
  });

  it("MARGEM_ALVO exige margemAlvoPercentual", () => {
    const r = calcularValorMinimoFrete({ modo: "MARGEM_ALVO", custoTotal: 7000 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_valor_minimo_frete — VALOR_MINIMO_POR_KM", () => {
  it("divide o valor mínimo (ponto de equilíbrio, sem margem informada) pela distância total", () => {
    const r = calcularValorMinimoFrete({ modo: "VALOR_MINIMO_POR_KM", custoTotal: 7000, distanciaTotalKm: 1000 });
    expect(r.sucesso).toBe(true);
    expect(r.valorMinimoPorKm).toBe(7);
  });

  it("exige distanciaTotalKm maior que zero", () => {
    const r = calcularValorMinimoFrete({ modo: "VALOR_MINIMO_POR_KM", custoTotal: 7000 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_valor_minimo_frete — COMPARAR_COM_OFERTA", () => {
  it("classifica oferta abaixo do custo", () => {
    const r = calcularValorMinimoFrete({ modo: "COMPARAR_COM_OFERTA", custoTotal: 7000, valorFreteOferecido: 6000 });
    expect(r.sucesso).toBe(true);
    expect(r.classificacaoOferta).toBe("ABAIXO_DO_CUSTO");
  });

  it("classifica oferta que atende exatamente a margem-alvo", () => {
    const r = calcularValorMinimoFrete({
      modo: "COMPARAR_COM_OFERTA",
      custoTotal: 7000,
      margemAlvoPercentual: 30,
      valorFreteOferecido: 10000,
    });
    expect(r.sucesso).toBe(true);
    expect(r.classificacaoOferta).toBe("ATENDE_MARGEM_ALVO");
  });

  it("exige valorFreteOferecido", () => {
    const r = calcularValorMinimoFrete({ modo: "COMPARAR_COM_OFERTA", custoTotal: 7000 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_valor_minimo_frete — validação e sobreposição", () => {
  it("rejeita por padrão custo informado por mais de uma fonte total", () => {
    const r = calcularValorMinimoFrete({ modo: "PONTO_EQUILIBRIO", custoTotal: 7000, custoIda: 3000, custoVolta: 4000 });
    expect(r.sucesso).toBe(false);
  });

  it("exige interpretacaoAdicionalRisco quando adicionalRiscoPercentual é informado", () => {
    const r = calcularValorMinimoFrete({ modo: "PONTO_EQUILIBRIO", custoTotal: 7000, adicionalRiscoPercentual: 5 });
    expect(r.sucesso).toBe(false);
  });
});
