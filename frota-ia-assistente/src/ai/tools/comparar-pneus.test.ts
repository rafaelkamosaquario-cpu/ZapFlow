import { describe, it, expect } from "vitest";
import { compararPneus } from "./comparar-pneus";

describe("comparar_pneus — validação estrutural", () => {
  it("exige ao menos duas opções", () => {
    const r = compararPneus({ modo: "COMPARACAO_SIMPLES", opcoes: [{ nome: "Único", custoAquisicao: 100, quilometragemPrevista: 1000 }] });
    expect(r.sucesso).toBe(false);
  });

  it("rejeita ids duplicados entre opções", () => {
    const r = compararPneus({
      modo: "COMPARACAO_SIMPLES",
      opcoes: [
        { id: "x", custoAquisicao: 100, quilometragemPrevista: 1000 },
        { id: "x", custoAquisicao: 200, quilometragemPrevista: 2000 },
      ],
    });
    expect(r.sucesso).toBe(false);
  });
});

describe("comparar_pneus — COMPARACAO_SIMPLES", () => {
  it("elege a opção de menor CPK e calcula diferença/economia em relação à de maior CPK", () => {
    const r = compararPneus({
      modo: "COMPARACAO_SIMPLES",
      opcoes: [
        { nome: "A", custoAquisicao: 1000, quilometragemPrevista: 100000 },
        { nome: "B", custoAquisicao: 1000, quilometragemPrevista: 50000 },
      ],
    });
    expect(r.sucesso).toBe(true);
    expect(r.melhorOpcao).toBe("A");
    expect(r.opcaoReferencia).toBe("B");
    expect(r.resultadosPorOpcao.find((o) => o.nome === "A")?.cpkPrevisto).toBe(0.01);
    expect(r.resultadosPorOpcao.find((o) => o.nome === "B")?.cpkPrevisto).toBe(0.02);
    expect(r.diferencaPercentual).toBe(50);
    expect(r.classificacaoDiferenca).toBe("VANTAGEM_ELEVADA");
    expect(r.economiaPorPneu).toBe(500); // 0.01 diferença × 50000 km de referência
  });
});

describe("comparar_pneus — COMPARACAO_CICLO_COMPLETO", () => {
  it("agrega recapagens e valor residual, e marca PARCIAL quando falta o residual de uma opção", () => {
    const r = compararPneus({
      modo: "COMPARACAO_CICLO_COMPLETO",
      opcoes: [
        {
          nome: "Novo",
          custoAquisicao: 1000,
          quilometragemPrevista: 80000,
          numeroRecapagensPrevistas: 2,
          custoPorRecapagem: 300,
          quilometragemPorRecapagem: 40000,
          valorResidual: 100,
        },
        { nome: "Recapado", custoAquisicao: 400, quilometragemPrevista: 40000 },
      ],
    });

    expect(r.sucesso).toBe(true);
    const novo = r.resultadosPorOpcao.find((o) => o.nome === "Novo")!;
    const recapado = r.resultadosPorOpcao.find((o) => o.nome === "Recapado")!;

    // custoTotalCiclo: 1000 + (2*300) - 100 = 1500; km: 80000 + 2*40000 = 160000
    expect(novo.custoTotalCiclo).toBe(1500);
    expect(novo.quilometragemPrevista).toBe(160000);
    expect(novo.nivelCompletude).toBe("COMPLETO");

    expect(recapado.custoTotalCiclo).toBe(400);
    expect(recapado.nivelCompletude).toBe("PARCIAL");
    expect(recapado.premissas.some((p) => p.includes("valor residual não informado"))).toBe(true);

    expect(r.melhorOpcao).toBe("Novo");
  });

  it("suprime a conclusão financeira quando permitirEstimativas é false e há dados incompletos", () => {
    const r = compararPneus({
      modo: "COMPARACAO_CICLO_COMPLETO",
      permitirEstimativas: false,
      opcoes: [
        { nome: "Novo", custoAquisicao: 1000, quilometragemPrevista: 80000, valorResidual: 100 },
        { nome: "Recapado", custoAquisicao: 400, quilometragemPrevista: 40000 },
      ],
    });
    expect(r.sucesso).toBe(true);
    expect(r.melhorOpcao).toBeUndefined();
    expect(r.mensagemResumo).toContain("permitirEstimativas");
  });
});

describe("comparar_pneus — COMPARACAO_FROTA", () => {
  it("alerta quando faltam pneusPorVeiculo/quantidadeVeiculos para projetar a frota", () => {
    const r = compararPneus({
      modo: "COMPARACAO_FROTA",
      opcoes: [
        { nome: "A", custoAquisicao: 1000, quilometragemPrevista: 100000, valorResidual: 0 },
        { nome: "B", custoAquisicao: 1000, quilometragemPrevista: 50000, valorResidual: 0 },
      ],
    });
    expect(r.alertas.some((a) => a.includes("pneusPorVeiculo"))).toBe(true);
    expect(r.economiaFrota).toBeUndefined();
  });

  it("projeta economia da frota quando pneusPorVeiculo e quantidadeVeiculos são informados", () => {
    const r = compararPneus({
      modo: "COMPARACAO_FROTA",
      pneusPorVeiculo: 6,
      quantidadeVeiculos: 10,
      opcoes: [
        { nome: "A", custoAquisicao: 1000, quilometragemPrevista: 100000, valorResidual: 0 },
        { nome: "B", custoAquisicao: 1000, quilometragemPrevista: 50000, valorResidual: 0 },
      ],
    });
    expect(r.economiaPorVeiculo).toBe(r.economiaPorPneu! * 6);
    expect(r.economiaFrota).toBe(r.economiaPorPneu! * 6 * 10);
  });
});
