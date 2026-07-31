import "server-only";
import { getGoogleMapsConfig } from "./mapsConfig";

/**
 * Cliente mínimo do Google Maps Platform (Geocoding API + Routes API) via
 * fetch direto — mesmo padrão de "sem SDK oficial" já usado em
 * calendarClient.ts e zapiClient.ts. Único ponto de chamada direta a
 * maps.googleapis.com/routes.googleapis.com — nenhum outro arquivo deve
 * chamar essas URLs diretamente.
 *
 * Fluxo sempre: geocodificar origem e destino (texto → coordenadas) e só
 * então calcular a rota com coordenadas — nunca manda endereço em texto
 * direto pra Routes API, para não depender de um formato de campo
 * (`address` vs `location`) não verificado contra a documentação oficial.
 */

const GEOCODING_API_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
const ROUTES_API_COMPUTE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

export class GoogleMapsApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly googleStatus?: string
  ) {
    super(message);
    this.name = "GoogleMapsApiError";
  }
}

export interface CoordenadasGeocodificadas {
  latitude: number;
  longitude: number;
  enderecoFormatado: string;
}

/** Devolve `null` quando o endereço não é encontrado (status ZERO_RESULTS) — nunca lança nesse caso, é um resultado válido de "não achei". */
export async function geocodificarEndereco(endereco: string): Promise<CoordenadasGeocodificadas | null> {
  const { GOOGLE_MAPS_API_KEY } = getGoogleMapsConfig();

  const url = new URL(GEOCODING_API_BASE);
  url.searchParams.set("address", endereco);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "br");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new GoogleMapsApiError("Falha na comunicação com a Geocoding API.", response.status);
  }

  const body = (await response.json()) as {
    status: string;
    results: Array<{ geometry: { location: { lat: number; lng: number } }; formatted_address: string }>;
  };

  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK" || body.results.length === 0) {
    throw new GoogleMapsApiError(`Geocoding API retornou status inesperado: ${body.status}.`, response.status, body.status);
  }

  const [primeiro] = body.results;
  return {
    latitude: primeiro.geometry.location.lat,
    longitude: primeiro.geometry.location.lng,
    enderecoFormatado: primeiro.formatted_address,
  };
}

export interface RotaCalculada {
  distanciaMetros: number;
  duracaoSegundos: number;
}

export async function calcularRota(
  origem: { latitude: number; longitude: number },
  destino: { latitude: number; longitude: number }
): Promise<RotaCalculada> {
  const { GOOGLE_MAPS_API_KEY } = getGoogleMapsConfig();

  const response = await fetch(ROUTES_API_COMPUTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origem.latitude, longitude: origem.longitude } } },
      destination: { location: { latLng: { latitude: destino.latitude, longitude: destino.longitude } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      languageCode: "pt-BR",
      units: "METRIC",
    }),
  });

  if (!response.ok) {
    throw new GoogleMapsApiError("Falha na comunicação com a Routes API.", response.status);
  }

  const body = (await response.json()) as {
    routes?: Array<{ distanceMeters: number; duration: string }>;
  };

  if (!body.routes || body.routes.length === 0) {
    throw new GoogleMapsApiError("Routes API não encontrou uma rota entre os pontos informados.");
  }

  const [rota] = body.routes;
  const duracaoSegundos = Number(rota.duration.replace("s", ""));

  return { distanciaMetros: rota.distanceMeters, duracaoSegundos };
}
