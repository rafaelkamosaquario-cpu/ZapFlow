import "server-only";

/**
 * Download seguro de mídia recebida via webhook da Z-API (Camada 6, Fase
 * F). A Z-API manda a URL do arquivo no próprio payload do webhook — nunca
 * expomos essa URL de volta pro usuário (ela nunca aparece em nenhuma
 * mensagem de resposta nem é persistida em texto puro).
 */

const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // 15 MB — mesma ordem de grandeza do limite prático da Claude API para anexos.
const TIMEOUT_MS = 15_000;

export interface MidiaBaixada {
  bytes: Uint8Array;
  contentType: string;
}

export async function baixarMidia(url: string): Promise<MidiaBaixada | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_MEDIA_BYTES) return null;

    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_MEDIA_BYTES) return null;

    return { bytes: buffer, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function paraBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
