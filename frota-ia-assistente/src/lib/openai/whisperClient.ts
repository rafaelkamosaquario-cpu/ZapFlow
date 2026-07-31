import "server-only";
import { getWhisperConfig } from "./whisperConfig";

/**
 * Cliente mínimo da API de transcrição da OpenAI (`gpt-4o-mini-transcribe`)
 * via fetch direto — mesmo padrão de "sem SDK oficial" usado em
 * calendarClient.ts, zapiClient.ts e mapsClient.ts. Único ponto de chamada
 * direta a api.openai.com/v1/audio/transcriptions.
 *
 * O WhatsApp manda o áudio como .ogg (codec Opus) — a documentação
 * oficial da OpenAI não confirma esse formato de forma inequívoca (relatos
 * de desenvolvedores variam), então isso só é validado com teste real,
 * nunca assumido como garantido.
 */

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const MODELO_TRANSCRICAO = "gpt-4o-mini-transcribe";

export class WhisperApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "WhisperApiError";
  }
}

function extensaoDoMimeType(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  return "ogg";
}

/** Lança WhisperApiError em qualquer falha (rede, formato rejeitado, transcrição vazia) — nunca devolve texto inventado. */
export async function transcreverAudio(bytes: Uint8Array, mimeType: string): Promise<string> {
  const { OPENAI_API_KEY } = getWhisperConfig();

  const formData = new FormData();
  const nomeArquivo = `audio.${extensaoDoMimeType(mimeType)}`;
  formData.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType || "audio/ogg" }), nomeArquivo);
  formData.append("model", MODELO_TRANSCRICAO);
  formData.append("language", "pt");

  const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    throw new WhisperApiError("Falha na comunicação com a API de transcrição.", response.status);
  }

  const body = (await response.json()) as { text?: string };
  if (!body.text || !body.text.trim()) {
    throw new WhisperApiError("A transcrição voltou vazia.");
  }

  return body.text.trim();
}
