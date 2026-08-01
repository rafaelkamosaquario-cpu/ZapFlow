import { describe, it, expect } from "vitest";
import { calcularJornada } from "./calcular-jornada";

describe("calcular_jornada — agregação básica de tempo", () => {
  it("soma direção + trabalho sem direção + espera na jornada total", () => {
    const r = calcularJornada({
      modo: "CALCULAR_JORNADA_TOTAL",
      tempoDirecaoMinutos: 300,
      tempoCargaMinutos: 60,
      tempoDescargaMinutos: 30,
      tempoEsperaMinutos: 20,
    });
    expect(r.sucesso).toBe(true);
    expect(r.tempoTrabalhoSemDirecaoMinutos).toBe(90);
    expect(r.jornadaTotalMinutos).toBe(410); // 300 + 90 + 20
    expect(r.duracaoTotalViagemMinutos).toBe(410); // sem descanso/margem informados
  });

  it("deriva o tempo de direção a partir de distância e velocidade média", () => {
    const r = calcularJornada({ modo: "CALCULAR_TEMPO_DIRECAO", distanciaTotalKm: 500, velocidadeMediaKmH: 50 });
    expect(r.sucesso).toBe(true);
    expect(r.tempoDirecaoMinutos).toBe(600); // (500/50) * 60
  });

  it("não inventa tempo de direção ausente — sucesso permanece true, mas sinaliza dado faltante", () => {
    const r = calcularJornada({ modo: "CALCULAR_JORNADA_TOTAL" });
    expect(r.sucesso).toBe(true);
    expect(r.jornadaTotalMinutos).toBeUndefined();
    expect(r.dadosFaltantes.some((d) => d.includes("tempoDirecaoMinutos"))).toBe(true);
  });
});

describe("calcular_jornada — validação e sobreposição", () => {
  it("rejeita velocidade média igual a zero", () => {
    const r = calcularJornada({ modo: "CALCULAR_TEMPO_DIRECAO", distanciaTotalKm: 500, velocidadeMediaKmH: 0 });
    expect(r.sucesso).toBe(false);
  });

  it("rejeita por padrão tempo de direção informado por mais de uma fonte", () => {
    const r = calcularJornada({
      modo: "CALCULAR_TEMPO_DIRECAO",
      tempoDirecaoMinutos: 500,
      distanciaTotalKm: 500,
      velocidadeMediaKmH: 50,
    });
    expect(r.sucesso).toBe(false);
  });
});

describe("calcular_jornada — conformidade sem regra informada", () => {
  it("marca conformidade como não avaliada quando nenhuma regra é fornecida", () => {
    const r = calcularJornada({
      modo: "ANALISAR_CONFORMIDADE",
      tempoDirecaoMinutos: 300,
    });
    expect(r.sucesso).toBe(true);
    expect(r.statusConformidade).toBe("NAO_AVALIADO");
  });
});
