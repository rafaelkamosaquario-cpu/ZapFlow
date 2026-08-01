import { describe, it, expect } from "vitest";
import { arredondar, formatarBRL, formatarNumero } from "./utils";

describe("arredondar", () => {
  it("arredonda para o número de casas pedido", () => {
    expect(arredondar(1.2345, 2)).toBe(1.23);
    expect(arredondar(1.005, 2)).toBe(1.01);
    expect(arredondar(1.999, 0)).toBe(2);
  });

  it("não introduz erro de ponto flutuante em casos clássicos", () => {
    expect(arredondar(0.1 + 0.2, 2)).toBe(0.3);
    expect(arredondar(1.115, 2)).toBe(1.12);
  });

  it("lida com zero e negativos", () => {
    expect(arredondar(0, 2)).toBe(0);
    expect(arredondar(-1.2345, 2)).toBe(-1.23);
  });
});

describe("formatarBRL", () => {
  it("formata em Real brasileiro", () => {
    expect(formatarBRL(1234.5)).toBe(
      (1234.5).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    );
    expect(formatarBRL(0)).toContain("0,00");
  });
});

describe("formatarNumero", () => {
  it("formata usando separador pt-BR", () => {
    expect(formatarNumero(1234.5)).toBe((1234.5).toLocaleString("pt-BR"));
  });
});
