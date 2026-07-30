import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AnalysisRunRow } from "@/lib/supabase/tables";

/**
 * Ferramenta: consultar_historico
 *
 * Igual a gerenciar_google_calendar, é uma ferramenta de I/O (não pura) —
 * consulta analysis_runs (Camada 3), nunca inventa um resultado. Não
 * interpreta datas relativas ("semana passada"): quem chama (a IA, via
 * system prompt com a data atual) resolve para um intervalo ISO antes de
 * chamar esta ferramenta, mesmo princípio já usado em gerenciar_google_calendar.
 *
 * Quando há mais de um resultado, a ferramenta só devolve a lista — é a IA
 * que decide apresentar como opções e perguntar qual o usuário quer (Camada
 * 6, seção 10 do prompt V1-WhatsApp).
 */

export interface ConsultarHistoricoEntrada {
  userId: string;
  companyId: string;
  conversationId?: string;
  /** Busca livre no pedido do usuário ou no resumo do resultado (ex.: "São Paulo", "pneus"). */
  buscaTexto?: string;
  /** Início do período, ISO 8601 — sem isso, não filtra por data. */
  dataInicio?: string;
  /** Fim do período, ISO 8601. */
  dataFim?: string;
  /** Máximo de resultados (padrão 5, limite 20). */
  limite?: number;
}

export interface ItemHistoricoResumo {
  id: string;
  tipo: string;
  resumo: string | null;
  pedidoUsuario: string | null;
  dataHora: string;
  veiculoId: string | null;
}

export interface ConsultarHistoricoResultado extends ResultadoFerramentaBase {
  itens: ItemHistoricoResumo[];
  totalEncontrado: number;
}

function mapaItem(run: AnalysisRunRow): ItemHistoricoResumo {
  return {
    id: run.id,
    tipo: run.analysis_type,
    resumo: run.result_summary,
    pedidoUsuario: run.user_request,
    dataHora: run.started_at,
    veiculoId: run.vehicle_id,
  };
}

async function executar(entrada: ConsultarHistoricoEntrada): Promise<ConsultarHistoricoResultado> {
  const { userId, companyId, buscaTexto, dataInicio, dataFim } = entrada;

  if (!userId || !companyId) {
    return {
      sucesso: false,
      itens: [],
      totalEncontrado: 0,
      alertas: ["Não foi possível identificar o usuário/empresa para consultar o histórico."],
      premissas: [],
      dadosFaltantes: ["userId", "companyId"],
      mensagemResumo: "Não foi possível consultar o histórico.",
    };
  }

  const limite = Math.min(Math.max(entrada.limite ?? 5, 1), 20);

  try {
    const admin = createAdminClient();
    let query = admin
      .from("analysis_runs")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("started_at", { ascending: false })
      .limit(limite);

    if (dataInicio) query = query.gte("started_at", dataInicio);
    if (dataFim) query = query.lte("started_at", dataFim);
    if (buscaTexto && buscaTexto.trim()) {
      const termo = buscaTexto.trim();
      query = query.or(`user_request.ilike.%${termo}%,result_summary.ilike.%${termo}%,analysis_type.ilike.%${termo}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const itens = (data ?? []).map(mapaItem);

    return {
      sucesso: true,
      itens,
      totalEncontrado: count ?? itens.length,
      alertas: [],
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo:
        itens.length === 0
          ? "Nenhuma análise encontrada no histórico com esses critérios."
          : `${itens.length} análise(s) encontrada(s) no histórico.`,
    };
  } catch {
    return {
      sucesso: false,
      itens: [],
      totalEncontrado: 0,
      alertas: ["Não foi possível consultar o histórico agora. Tente novamente em instantes."],
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: "Não foi possível consultar o histórico agora.",
    };
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "userId", tipo: "string", obrigatorio: true, descricao: "Usuário dono do histórico (do contexto da conversa, nunca da mensagem)." },
  { nome: "companyId", tipo: "string", obrigatorio: true, descricao: "Empresa dona do histórico (do contexto da conversa)." },
  { nome: "conversationId", tipo: "string", obrigatorio: false, descricao: "Conversa de origem." },
  { nome: "buscaTexto", tipo: "string", obrigatorio: false, descricao: "Busca livre no pedido do usuário, no resumo ou no tipo de análise (ex.: \"São Paulo\", \"pneus\")." },
  { nome: "dataInicio", tipo: "string", obrigatorio: false, descricao: "Início do período em ISO 8601, já resolvido a partir da data atual (ex.: \"semana passada\" → data absoluta). Nunca envie texto relativo." },
  { nome: "dataFim", tipo: "string", obrigatorio: false, descricao: "Fim do período em ISO 8601, mesma regra de dataInicio." },
  { nome: "limite", tipo: "number", obrigatorio: false, descricao: "Máximo de resultados (padrão 5, limite 20)." },
];

export const ferramentaConsultarHistorico: DefinicaoFerramenta<ConsultarHistoricoEntrada, ConsultarHistoricoResultado> = {
  nome: "consultar_historico",
  descricao: "Busca análises anteriores (fretes, custos, comparações etc.) já feitas para a empresa, com filtro por texto e período.",
  objetivo: "Permitir que o usuário recupere pelo WhatsApp uma análise antiga sem depender só da memória da conversa atual — sempre busca estruturada em analysis_runs, nunca inventa um resultado.",
  parametros: PARAMETROS,
  executar,
};
