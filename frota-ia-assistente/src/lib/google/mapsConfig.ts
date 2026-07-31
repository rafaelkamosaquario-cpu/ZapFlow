import "server-only";

/**
 * Configuração do Google Maps Platform (Routes API + Geocoding API).
 * Diferente do Google Calendar (Camada 4, OAuth por usuário), o Maps usa
 * uma única chave de API do servidor — não depende de nenhum cliente
 * conectar a conta Google dele. Nunca vaza o valor da variável em mensagem
 * de erro, só o nome.
 */

const REQUIRED_VARS = ["GOOGLE_MAPS_API_KEY"] as const;

export type GoogleMapsConfig = Record<(typeof REQUIRED_VARS)[number], string>;

export class GoogleMapsConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Configuração do Google Maps incompleta. Variáveis ausentes: ${missing.join(", ")}.`);
    this.name = "GoogleMapsConfigError";
  }
}

export function getGoogleMapsConfig(): GoogleMapsConfig {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new GoogleMapsConfigError(missing);
  return Object.fromEntries(REQUIRED_VARS.map((name) => [name, process.env[name] as string])) as GoogleMapsConfig;
}

/** Só checa disponibilidade, sem lançar — para a ferramenta explicar a limitação em vez de quebrar. */
export function isGoogleMapsConfigured(): boolean {
  return REQUIRED_VARS.every((name) => Boolean(process.env[name]));
}
