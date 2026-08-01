import { describe, it, expect } from "vitest";
import { calcularCustoVeiculoParado } from "./calcular-custo-veiculo-parado";

describe("calcular_custo_veiculo_parado — custo fixo direto", () => {
  it("CUSTO_POR_HORA_PARADA multiplica o valor por hora pelas horas paradas", () => {
    const r = calcularCustoVeiculoParado({ modo: "CUSTO_POR_HORA_PARADA", horasParadas: 10, custoFixoHoraInformado: 50 });
    expect(r.sucesso).toBe(true);
    expect(r.custoFixoParada).toBe(500);
    expect(r.custoDiretoParada).toBe(500);
  });

  it("CUSTO_POR_DIA_PARADO multiplica o valor diário pelos dias parados", () => {
    const r = calcularCustoVeiculoParado({ modo: "CUSTO_POR_DIA_PARADO", diasParados: 5, custoFixoDiarioInformado: 200 });
    expect(r.sucesso).toBe(true);
    expect(r.custoFixoParada).toBe(1000);
  });

  it("rejeita duração igual a zero", () => {
    const r = calcularCustoVeiculoParado({ modo: "CUSTO_POR_HORA_PARADA", horasParadas: 0, custoFixoHoraInformado: 50 });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_custo_veiculo_parado — validação", () => {
  it("rejeita custo fixo informado por mais de uma fonte (diária + hora)", () => {
    const r = calcularCustoVeiculoParado({
      modo: "CUSTO_DIRETO_PARADA",
      diasParados: 5,
      horasParadas: 10,
      custoFixoDiarioInformado: 200,
      custoFixoHoraInformado: 50,
    });
    expect(r.sucesso).toBe(false);
  });

  it("MULTIPLOS_VEICULOS exige a lista de veículos", () => {
    const r = calcularCustoVeiculoParado({ modo: "MULTIPLOS_VEICULOS" });
    expect(r.sucesso).toBe(false);
  });

  it("ANALISE_REDUCAO_TEMPO_PARADO exige diasReducaoAnalisados", () => {
    const r = calcularCustoVeiculoParado({ modo: "ANALISE_REDUCAO_TEMPO_PARADO", diasParados: 5, custoFixoDiarioInformado: 200 });
    expect(r.sucesso).toBe(false);
  });
});
