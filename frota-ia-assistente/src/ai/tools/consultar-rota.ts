import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { arredondar } from "./utils";
import { isGoogleMapsConfigured } from "@/lib/google/mapsConfig";
import { geocodificarEndereco, calcularRota, GoogleMapsApiError } from "@/lib/google/mapsClient";

/**
 * Ferramenta: consultar_rota
 *
 * Ferramenta de INTEGRAÇÃO (I/O real com Google Maps Platform — Geocoding
 * API + Routes API), mesmo padrão de `gerenciar_google_calendar`: não é
 * uma das 11 ferramentas de cálculo puro, `executar` é assíncrona.
 *
 * Resolve endereço em texto → distância/duração de rota, pra alimentar
 * `distanciaKm` nas outras ferramentas (calcular_custo_viagem,
 * analisar_frete, verificar_piso_minimo_antt etc.) sem o motorista
 * precisar informar o km manualmente. Sempre geocodifica origem e destino
 * primeiro (texto → coordenadas) e só então calcula a rota com
 * coordenadas — nunca manda endereço em texto direto pra Routes API.
 *
 * Diferente do Google Calendar, não depende de nenhum login/OAuth do
 * cliente — usa uma chave de API própria do servidor
 * (`GOOGLE_MAPS_API_KEY`). Se não estiver configurada, explica a
 * limitação em vez de falhar silenciosamente (mesmo princípio das outras
 * integrações do projeto).
 */

export type ModoConsultarRota = "GEOCODIFICAR_ENDERECO" | "CALCULAR_DISTANCIA_ROTA";

export interface ConsultarRotaEntrada {
  modo: ModoConsultarRota;
  /** Obrigatório em GEOCODIFICAR_ENDERECO. */
  endereco?: string;
  /** Obrigatórios em CALCULAR_DISTANCIA_ROTA — endereço em texto (cidade/UF, endereço completo etc.). */
  origem?: string;
  destino?: string;
}

export interface ConsultarRotaResultado extends ResultadoFerramentaBase {
  modo: ModoConsultarRota;

  enderecoConsultado?: string;
  enderecoFormatado?: string;
  latitude?: number;
  longitude?: number;

  origemFormatada?: string;
  destinoFormatado?: string;
  distanciaKm?: number;
  duracaoMinutos?: number;

  limitacoes: string[];
}

const LIMITACOES_PADRAO: string[] = [
  "Distância e duração são estimativas do Google Maps (rota rodoviária mais comum, considerando trânsito no momento da consulta) — não substituem a rota real percorrida, que pode variar por restrições de tráfego de caminhão, obras ou desvios.",
  "Não considera restrições específicas de veículos pesados (altura, peso, rotas proibidas para caminhões) — é a mesma rota sugerida para um carro de passeio.",
];

function semGoogleMapsConfigurado(modo: ModoConsultarRota): ConsultarRotaResultado {
  return {
    sucesso: false,
    modo,
    alertas: [],
    premissas: [],
    dadosFaltantes: [],
    mensagemResumo: "A integração com o Google Maps ainda não está configurada — peça ao motorista/transportadora a distância diretamente.",
    limitacoes: LIMITACOES_PADRAO,
  };
}

function erroSeguro(err: unknown): string {
  if (err instanceof GoogleMapsApiError) return err.message;
  return "Não consegui consultar o Google Maps agora. Tente novamente em instantes, ou informe a distância diretamente.";
}

async function executar(entrada: ConsultarRotaEntrada): Promise<ConsultarRotaResultado> {
  if (!isGoogleMapsConfigured()) return semGoogleMapsConfigurado(entrada.modo);

  if (entrada.modo === "GEOCODIFICAR_ENDERECO") {
    if (!entrada.endereco) {
      return {
        sucesso: false,
        modo: entrada.modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: ["endereco"],
        mensagemResumo: 'Falta o campo "endereco" para geocodificar.',
        limitacoes: LIMITACOES_PADRAO,
      };
    }

    try {
      const resultado = await geocodificarEndereco(entrada.endereco);
      if (!resultado) {
        return {
          sucesso: false,
          modo: entrada.modo,
          alertas: [],
          premissas: [],
          dadosFaltantes: [],
          mensagemResumo: `Não encontrei o endereço "${entrada.endereco}". Pode confirmar cidade e estado?`,
          limitacoes: LIMITACOES_PADRAO,
        };
      }
      return {
        sucesso: true,
        modo: entrada.modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        mensagemResumo: `Endereço localizado: ${resultado.enderecoFormatado}.`,
        enderecoConsultado: entrada.endereco,
        enderecoFormatado: resultado.enderecoFormatado,
        latitude: resultado.latitude,
        longitude: resultado.longitude,
        limitacoes: LIMITACOES_PADRAO,
      };
    } catch (err) {
      return {
        sucesso: false,
        modo: entrada.modo,
        alertas: [erroSeguro(err)],
        premissas: [],
        dadosFaltantes: [],
        mensagemResumo: erroSeguro(err),
        limitacoes: LIMITACOES_PADRAO,
      };
    }
  }

  // CALCULAR_DISTANCIA_ROTA
  const dadosFaltantes: string[] = [];
  if (!entrada.origem) dadosFaltantes.push("origem");
  if (!entrada.destino) dadosFaltantes.push("destino");
  if (dadosFaltantes.length > 0) {
    return {
      sucesso: false,
      modo: entrada.modo,
      alertas: [],
      premissas: [],
      dadosFaltantes,
      mensagemResumo: `Faltam dados: ${dadosFaltantes.join(", ")}.`,
      limitacoes: LIMITACOES_PADRAO,
    };
  }

  try {
    const [origemGeo, destinoGeo] = await Promise.all([
      geocodificarEndereco(entrada.origem as string),
      geocodificarEndereco(entrada.destino as string),
    ]);

    if (!origemGeo) {
      return {
        sucesso: false,
        modo: entrada.modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        mensagemResumo: `Não encontrei a origem "${entrada.origem}". Pode confirmar cidade e estado?`,
        limitacoes: LIMITACOES_PADRAO,
      };
    }
    if (!destinoGeo) {
      return {
        sucesso: false,
        modo: entrada.modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        mensagemResumo: `Não encontrei o destino "${entrada.destino}". Pode confirmar cidade e estado?`,
        limitacoes: LIMITACOES_PADRAO,
      };
    }

    const rota = await calcularRota(
      { latitude: origemGeo.latitude, longitude: origemGeo.longitude },
      { latitude: destinoGeo.latitude, longitude: destinoGeo.longitude }
    );

    const distanciaKm = arredondar(rota.distanciaMetros / 1000, 1);
    const duracaoMinutos = arredondar(rota.duracaoSegundos / 60, 0);

    return {
      sucesso: true,
      modo: entrada.modo,
      alertas: [],
      premissas: [`Rota calculada de "${origemGeo.enderecoFormatado}" até "${destinoGeo.enderecoFormatado}" (rota rodoviária mais comum, com trânsito no momento da consulta).`],
      dadosFaltantes: [],
      mensagemResumo: `Distância: ${distanciaKm} km — duração estimada: ${duracaoMinutos} min.`,
      origemFormatada: origemGeo.enderecoFormatado,
      destinoFormatado: destinoGeo.enderecoFormatado,
      distanciaKm,
      duracaoMinutos,
      limitacoes: LIMITACOES_PADRAO,
    };
  } catch (err) {
    return {
      sucesso: false,
      modo: entrada.modo,
      alertas: [erroSeguro(err)],
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: erroSeguro(err),
      limitacoes: LIMITACOES_PADRAO,
    };
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "GEOCODIFICAR_ENDERECO só confirma/localiza um endereço; CALCULAR_DISTANCIA_ROTA calcula distância e duração entre origem e destino.",
    valoresPossiveis: ["GEOCODIFICAR_ENDERECO", "CALCULAR_DISTANCIA_ROTA"],
  },
  { nome: "endereco", tipo: "string", obrigatorio: false, descricao: "Endereço a geocodificar — obrigatório em GEOCODIFICAR_ENDERECO." },
  { nome: "origem", tipo: "string", obrigatorio: false, descricao: "Endereço de origem (cidade/UF ou endereço completo) — obrigatório em CALCULAR_DISTANCIA_ROTA." },
  { nome: "destino", tipo: "string", obrigatorio: false, descricao: "Endereço de destino — obrigatório em CALCULAR_DISTANCIA_ROTA." },
];

export const ferramentaConsultarRota: DefinicaoFerramenta<ConsultarRotaEntrada, ConsultarRotaResultado> = {
  nome: "consultar_rota",
  descricao: "Consulta distância e duração de rota entre dois endereços (Google Maps), ou confirma/localiza um endereço.",
  objetivo:
    "Preencher distanciaKm automaticamente nas ferramentas de cálculo (calcular_custo_viagem, analisar_frete, verificar_piso_minimo_antt etc.) a partir de origem/destino em texto, sem exigir que o motorista informe o km manualmente. Se não configurada, explica a limitação — nunca inventa distância.",
  parametros: PARAMETROS,
  executar,
};
