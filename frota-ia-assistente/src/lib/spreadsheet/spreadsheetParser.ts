import "server-only";
import ExcelJS from "exceljs";

/**
 * Converte planilha (.xlsx/.csv) recebida por WhatsApp em texto simples,
 * pra alimentar a conversa com o Claude — ele não lê .xlsx nativamente
 * (diferente de imagem/PDF), então essa etapa faz o mesmo papel da
 * transcrição de áudio: converte pra texto antes de chegar no modelo,
 * nunca interpreta o conteúdo por conta própria.
 *
 * `.xls` (formato binário antigo) não é suportado — exceljs só lê
 * xlsx/csv. Erro claro em vez de tentar e falhar silenciosamente.
 */

const MAX_LINHAS_POR_PLANILHA = 200;
const MAX_CARACTERES = 12_000;

export const MIME_TYPES_PLANILHA_SUPORTADOS = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
]);

export class SpreadsheetParseError extends Error {}

export async function planilhaParaTexto(bytes: Uint8Array, mimeType: string): Promise<string> {
  if (mimeType === "text/csv") {
    return truncar(Buffer.from(bytes).toString("utf-8"));
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    try {
      const workbook = new ExcelJS.Workbook();
      // O .d.ts do exceljs referencia um tipo Buffer ambiente incompatível
      // com o Buffer<ArrayBufferLike> do @types/node desta versão (duas
      // declarações "Buffer" distintas no projeto) — mesmo objeto em
      // runtime, só atrito de tipo; nenhum cast pra Buffer resolve os dois
      // ao mesmo tempo.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(bufferFrom(bytes) as any);
      return truncar(workbookParaTexto(workbook));
    } catch {
      throw new SpreadsheetParseError("Não consegui ler o conteúdo dessa planilha — o arquivo pode estar corrompido ou num formato inesperado.");
    }
  }

  throw new SpreadsheetParseError("Formato de planilha não suportado — envie em .xlsx ou .csv (o formato .xls antigo não é lido).");
}

function bufferFrom(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function workbookParaTexto(workbook: ExcelJS.Workbook): string {
  const partes: string[] = [];

  workbook.eachSheet((sheet) => {
    partes.push(`## Planilha: ${sheet.name}`);
    let linha = 0;

    sheet.eachRow((row) => {
      if (linha >= MAX_LINHAS_POR_PLANILHA) return;
      const valores = row.values as unknown[];
      const celulas = valores.slice(1).map(celulaParaTexto);
      partes.push(celulas.join(" | "));
      linha++;
    });

    if (linha >= MAX_LINHAS_POR_PLANILHA) {
      partes.push(`[...planilha truncada em ${MAX_LINHAS_POR_PLANILHA} linhas...]`);
    }
  });

  return partes.join("\n");
}

function celulaParaTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "object") {
    const obj = valor as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text ?? "").join("");
    if (obj.result !== undefined) return String(obj.result);
    if (obj.text !== undefined) return String(obj.text);
    return "";
  }
  return String(valor);
}

function truncar(texto: string): string {
  if (texto.length <= MAX_CARACTERES) return texto;
  return `${texto.slice(0, MAX_CARACTERES)}\n[...conteúdo truncado, planilha muito grande...]`;
}
