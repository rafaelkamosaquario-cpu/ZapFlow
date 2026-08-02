import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listRoutes, getRoute, createRoute, updateRoute, setFavoriteRoute, deactivateRoute } from "@/services/supabase/savedRouteService";
import type { SavedRouteRow } from "@/lib/supabase/tables";

/**
 * Ferramenta: gerenciar_rota_salva
 *
 * Ferramenta de INTEGRAÇÃO (I/O real com Supabase — saved_routes), mesmo
 * padrão de `gerenciar_veiculo`. Fecha uma lacuna real encontrada na
 * auditoria da V1: a tabela `saved_routes` e o serviço básico
 * (listRoutes/createRoute) já existiam desde a Camada 3, mas nenhuma
 * ferramenta os expunha à conversa — o onboarding pergunta "você trabalha
 * com rota fixa?" e a resposta nunca era usada depois disso.
 *
 * Guarda rota frequente (origem/destino/distância/pedágio estimado/consumo)
 * pra não precisar recalcular do zero toda vez que o motorista roda a mesma
 * rota. Nunca inventa distância/pedágio/consumo — esses valores só entram
 * se informados pelo usuário ou vindos de uma ferramenta que já os
 * calculou nesta conversa (ex.: consultar_rota), nunca estimados por esta
 * ferramenta.
 *
 * `routeId` sempre verificado contra `companyId` antes de qualquer escrita
 * (mesmo princípio de `gerenciar_veiculo`/`gerenciar_alerta`) — nunca confia
 * só no id que o modelo mandou.
 */

export type ModoGerenciarRotaSalva = "CRIAR" | "LISTAR" | "ATUALIZAR" | "DEFINIR_FAVORITA" | "EXCLUIR";

export interface GerenciarRotaSalvaEntrada {
  modo: ModoGerenciarRotaSalva;
  userId: string;
  companyId: string;
  conversationId?: string;
  /** Obrigatório em ATUALIZAR/DEFINIR_FAVORITA/EXCLUIR. */
  routeId?: string;

  veiculoId?: string;
  nome?: string;
  origemNome?: string;
  origemCidade?: string;
  origemUf?: string;
  destinoNome?: string;
  destinoCidade?: string;
  destinoUf?: string;
  distanciaKm?: number;
  duracaoEstimadaMinutos?: number;
  pedagioEstimado?: number;
  consumoMedioKmL?: number;
  velocidadeMediaKmh?: number;
  /** Só usado em CRIAR — em DEFINIR_FAVORITA não precisa, já é o propósito do modo. */
  favorita?: boolean;
}

export interface RotaSalvaResumo {
  id: string;
  nome: string | null;
  veiculoId: string | null;
  origemNome: string | null;
  origemCidade: string | null;
  origemUf: string | null;
  destinoNome: string | null;
  destinoCidade: string | null;
  destinoUf: string | null;
  distanciaKm: number | null;
  duracaoEstimadaMinutos: number | null;
  pedagioEstimado: number | null;
  consumoMedioKmL: number | null;
  velocidadeMediaKmh: number | null;
  favorita: boolean;
}

export interface GerenciarRotaSalvaResultado extends ResultadoFerramentaBase {
  modo: ModoGerenciarRotaSalva;
  rota?: RotaSalvaResumo;
  rotas?: RotaSalvaResumo[];
}

function mapaRota(row: SavedRouteRow): RotaSalvaResumo {
  return {
    id: row.id,
    nome: row.name,
    veiculoId: row.vehicle_id,
    origemNome: row.origin_name,
    origemCidade: row.origin_city,
    origemUf: row.origin_state,
    destinoNome: row.destination_name,
    destinoCidade: row.destination_city,
    destinoUf: row.destination_state,
    distanciaKm: row.distance_km,
    duracaoEstimadaMinutos: row.estimated_duration_minutes,
    pedagioEstimado: row.estimated_toll_cost,
    consumoMedioKmL: row.average_consumption_km_l,
    velocidadeMediaKmh: row.average_speed_kmh,
    favorita: row.is_favorite,
  };
}

function respostaFalha(modo: ModoGerenciarRotaSalva, alertas: string[], dadosFaltantes: string[] = []): GerenciarRotaSalvaResultado {
  return { sucesso: false, modo, alertas, premissas: [], dadosFaltantes, mensagemResumo: alertas[0] ?? "Não foi possível concluir a ação de rota salva." };
}

async function executar(entrada: GerenciarRotaSalvaEntrada): Promise<GerenciarRotaSalvaResultado> {
  const { modo, userId, companyId } = entrada;

  if (!userId || !companyId) {
    return respostaFalha(modo, ["Não foi possível identificar o usuário/empresa para a rota salva."], ["userId", "companyId"]);
  }

  const admin = createAdminClient();

  try {
    if (modo === "CRIAR") {
      if (!entrada.origemCidade && !entrada.origemNome) {
        return respostaFalha(modo, ["Preciso de ao menos a origem (nome ou cidade) para salvar a rota."], ["origemCidade"]);
      }
      if (!entrada.destinoCidade && !entrada.destinoNome) {
        return respostaFalha(modo, ["Preciso de ao menos o destino (nome ou cidade) para salvar a rota."], ["destinoCidade"]);
      }

      const criada = await createRoute(admin, companyId, userId, {
        vehicleId: entrada.veiculoId,
        name: entrada.nome,
        originName: entrada.origemNome,
        originCity: entrada.origemCidade,
        originState: entrada.origemUf,
        destinationName: entrada.destinoNome,
        destinationCity: entrada.destinoCidade,
        destinationState: entrada.destinoUf,
        distanceKm: entrada.distanciaKm,
        estimatedDurationMinutes: entrada.duracaoEstimadaMinutos,
        estimatedTollCost: entrada.pedagioEstimado,
        averageConsumptionKmL: entrada.consumoMedioKmL,
        averageSpeedKmh: entrada.velocidadeMediaKmh,
        isFavorite: entrada.favorita,
      });

      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        rota: mapaRota(criada),
        mensagemResumo: `Rota "${criada.name ?? `${criada.origin_city ?? criada.origin_name} → ${criada.destination_city ?? criada.destination_name}`}" salva.`,
      };
    }

    if (modo === "LISTAR") {
      const rotas = (await listRoutes(admin, companyId)).map(mapaRota);
      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        rotas,
        mensagemResumo: rotas.length === 0 ? "Nenhuma rota salva ainda." : `${rotas.length} rota(s) salva(s).`,
      };
    }

    // ATUALIZAR / DEFINIR_FAVORITA / EXCLUIR exigem routeId, sempre verificado contra a empresa.
    if (!entrada.routeId) {
      return respostaFalha(modo, ["Preciso saber exatamente qual rota (routeId) — use LISTAR antes se houver dúvida sobre qual é."], ["routeId"]);
    }

    const rotaAtual = await getRoute(admin, entrada.routeId);
    if (!rotaAtual || rotaAtual.company_id !== companyId) {
      return respostaFalha(modo, ["Não encontrei essa rota para esta empresa."], ["routeId"]);
    }

    if (modo === "ATUALIZAR") {
      const atualizada = await updateRoute(admin, entrada.routeId, companyId, userId, {
        vehicleId: entrada.veiculoId,
        name: entrada.nome,
        originName: entrada.origemNome,
        originCity: entrada.origemCidade,
        originState: entrada.origemUf,
        destinationName: entrada.destinoNome,
        destinationCity: entrada.destinoCidade,
        destinationState: entrada.destinoUf,
        distanceKm: entrada.distanciaKm,
        estimatedDurationMinutes: entrada.duracaoEstimadaMinutos,
        estimatedTollCost: entrada.pedagioEstimado,
        averageConsumptionKmL: entrada.consumoMedioKmL,
        averageSpeedKmh: entrada.velocidadeMediaKmh,
      });

      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        rota: mapaRota(atualizada),
        mensagemResumo: `Rota "${atualizada.name ?? atualizada.id}" atualizada.`,
      };
    }

    if (modo === "DEFINIR_FAVORITA") {
      const atualizada = await setFavoriteRoute(admin, entrada.routeId, companyId, userId);
      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        rota: mapaRota(atualizada),
        mensagemResumo: `"${atualizada.name ?? atualizada.id}" agora é a rota favorita.`,
      };
    }

    // EXCLUIR
    const excluida = await deactivateRoute(admin, entrada.routeId, companyId, userId);
    return {
      sucesso: true,
      modo,
      alertas: [],
      premissas: [],
      dadosFaltantes: [],
      rota: mapaRota(excluida),
      mensagemResumo: `Rota "${excluida.name ?? excluida.id}" removida.`,
    };
  } catch {
    return respostaFalha(modo, ["Não foi possível concluir a ação de rota salva agora. Confira os dados e tente novamente."]);
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "modo", tipo: "enum", obrigatorio: true, descricao: "Operação a executar.", valoresPossiveis: ["CRIAR", "LISTAR", "ATUALIZAR", "DEFINIR_FAVORITA", "EXCLUIR"] },
  { nome: "userId", tipo: "string", obrigatorio: true, descricao: "Usuário dono da empresa (do contexto da conversa, nunca da mensagem)." },
  { nome: "companyId", tipo: "string", obrigatorio: true, descricao: "Empresa dona da(s) rota(s) (do contexto da conversa)." },
  { nome: "conversationId", tipo: "string", obrigatorio: false, descricao: "Conversa de origem." },
  { nome: "routeId", tipo: "string", obrigatorio: false, descricao: "Id da rota — obrigatório em ATUALIZAR/DEFINIR_FAVORITA/EXCLUIR. Use LISTAR antes se não tiver certeza de qual é." },
  { nome: "veiculoId", tipo: "string", obrigatorio: false, descricao: "Veículo associado à rota, se relevante." },
  { nome: "nome", tipo: "string", obrigatorio: false, descricao: "Nome/apelido da rota (ex.: \"Sorriso → Santos\")." },
  { nome: "origemNome", tipo: "string", obrigatorio: false, descricao: "Nome/endereço da origem." },
  { nome: "origemCidade", tipo: "string", obrigatorio: false, descricao: "Cidade de origem." },
  { nome: "origemUf", tipo: "string", obrigatorio: false, descricao: "UF de origem." },
  { nome: "destinoNome", tipo: "string", obrigatorio: false, descricao: "Nome/endereço do destino." },
  { nome: "destinoCidade", tipo: "string", obrigatorio: false, descricao: "Cidade de destino." },
  { nome: "destinoUf", tipo: "string", obrigatorio: false, descricao: "UF de destino." },
  { nome: "distanciaKm", tipo: "number", obrigatorio: false, descricao: "Distância da rota em km — de preferência vinda de consultar_rota nesta conversa, nunca estimada de memória." },
  { nome: "duracaoEstimadaMinutos", tipo: "number", obrigatorio: false, descricao: "Duração estimada em minutos." },
  { nome: "pedagioEstimado", tipo: "number", obrigatorio: false, descricao: "Valor estimado de pedágio da rota, se o cliente informar — nunca calculado por esta ferramenta." },
  { nome: "consumoMedioKmL", tipo: "number", obrigatorio: false, descricao: "Consumo médio do veículo nessa rota, se diferente do consumo geral salvo." },
  { nome: "velocidadeMediaKmh", tipo: "number", obrigatorio: false, descricao: "Velocidade média nessa rota." },
  { nome: "favorita", tipo: "boolean", obrigatorio: false, descricao: "Marcar como rota favorita já na criação (alternativa a DEFINIR_FAVORITA depois)." },
];

export const ferramentaGerenciarRotaSalva: DefinicaoFerramenta<GerenciarRotaSalvaEntrada, GerenciarRotaSalvaResultado> = {
  nome: "gerenciar_rota_salva",
  descricao: "Salva, lista, atualiza e remove rotas frequentes do cliente (origem, destino, distância, pedágio/consumo estimados).",
  objetivo:
    "Evitar que o cliente informe a mesma rota (e seus dados) do zero toda vez que roda o mesmo trajeto — sobretudo útil pra quem indicou 'rota fixa' no cadastro. Nunca inventa distância, pedágio ou consumo: só salva o que foi informado ou já calculado nesta conversa por outra ferramenta (ex.: consultar_rota).",
  parametros: PARAMETROS,
  executar,
};
