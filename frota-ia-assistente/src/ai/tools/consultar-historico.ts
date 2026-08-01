import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listGeneratedDocuments } from "@/services/supabase/generatedDocumentService";
import type { AnalysisRunRow } from "@/lib/supabase/tables";

/**
 * Ferramenta: consultar_historico
 *
 * Igual a gerenciar_google_calendar, é uma ferramenta de I/O (não pura) —
 * consulta analysis_runs (Camada 3) ou, com origem=DOCUMENTOS,
 * generated_documents (Camada 6 Fase D) — nunca inventa um resultado. Não
 * interpreta datas relativas ("semana passada"): quem chama (a IA, via
 * system prompt com a data atual) resolve para um intervalo ISO antes de
 * chamar esta ferramenta, mesmo princípio já usado em gerenciar_google_calendar.
 *
 * `origem=DOCUMENTOS` fecha uma lacuna real: gerar_documento sempre grava
 * em generated_documents (recordGeneratedDocument), mas até agora nenhuma
 * ferramenta lia essa tabela de volta — o cliente não conseguia perguntar
 * "quais documentos eu já gerei" e receber resposta real.
 *
 * Quando há mais de um resultado, a ferramenta só devolve a lista — é a IA
 * que decide apresentar como opções e perguntar qual o usuário quer (Camada
 * 6, seção 10 do prompt V1-WhatsApp).
 */

export type OrigemConsultarHistorico = "ANALISES" | "DOCUMENTOS";

export interface ConsultarHistoricoEntrada {
  userId: string;
  companyId: string;
  conversationId?: string;
  /** ANALISES (padrão): busca em analysis_runs. DOCUMENTOS: busca em generated_documents. */
  origem?: OrigemConsultarHistorico;
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

export interface ItemDocumentoResumo {
  id: string;
  tipoDocumento: string;
  titulo: string;
  nomeArquivo: string;
  entregue: boolean;
  dataHora: string;
  analysisRunId: string | null;
}

export interface ConsultarHistoricoResultado extends ResultadoFerramentaBase {
  origem: OrigemConsultarHistorico;
  itens: ItemHistoricoResumo[];
  documentos: ItemDocumentoResumo[];
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
  const origem = entrada.origem ?? "ANALISES";

  if (!userId || !companyId) {
    return {
      sucesso: false,
      origem,
      itens: [],
      documentos: [],
      totalEncontrado: 0,
      alertas: ["Não foi possível identificar o usuário/empresa para consultar o histórico."],
      premissas: [],
      dadosFaltantes: ["userId", "companyId"],
      mensagemResumo: "Não foi possível consultar o histórico.",
    };
  }

  const limite = Math.min(Math.max(entrada.limite ?? 5, 1), 20);
  const admin = createAdminClient();

  if (origem === "DOCUMENTOS") {
    try {
      const { itens: rows, total } = await listGeneratedDocuments(admin, { companyId, buscaTexto, dataInicio, dataFim, limite });
      const documentos: ItemDocumentoResumo[] = rows.map((d) => ({
        id: d.id,
        tipoDocumento: d.document_type,
        titulo: d.title,
        nomeArquivo: d.file_name,
        entregue: d.delivered,
        dataHora: d.created_at,
        analysisRunId: d.analysis_run_id,
      }));

      return {
        sucesso: true,
        origem,
        itens: [],
        documentos,
        totalEncontrado: total,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        mensagemResumo:
          documentos.length === 0 ? "Nenhum documento gerado encontrado com esses critérios." : `${documentos.length} documento(s) gerado(s) encontrado(s).`,
      };
    } catch {
      return {
        sucesso: false,
        origem,
        itens: [],
        documentos: [],
        totalEncontrado: 0,
        alertas: ["Não foi possível consultar os documentos gerados agora. Tente novamente em instantes."],
        premissas: [],
        dadosFaltantes: [],
        mensagemResumo: "Não foi possível consultar os documentos gerados agora.",
      };
    }
  }

  try {
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
      origem,
      itens,
      documentos: [],
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
      origem,
      itens: [],
      documentos: [],
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
  {
    nome: "origem",
    tipo: "enum",
    obrigatorio: false,
    descricao: "ANALISES (padrão): busca cálculos/análises já feitos. DOCUMENTOS: busca PDFs já gerados (gerar_documento) — use quando o cliente perguntar sobre documento/PDF que já mandou antes, não sobre um cálculo.",
    valoresPossiveis: ["ANALISES", "DOCUMENTOS"],
  },
  { nome: "buscaTexto", tipo: "string", obrigatorio: false, descricao: "Busca livre no pedido do usuário, no resumo/tipo de análise, ou no título/tipo do documento (ex.: \"São Paulo\", \"pneus\")." },
  { nome: "dataInicio", tipo: "string", obrigatorio: false, descricao: "Início do período em ISO 8601, já resolvido a partir da data atual (ex.: \"semana passada\" → data absoluta). Nunca envie texto relativo." },
  { nome: "dataFim", tipo: "string", obrigatorio: false, descricao: "Fim do período em ISO 8601, mesma regra de dataInicio." },
  { nome: "limite", tipo: "number", obrigatorio: false, descricao: "Máximo de resultados (padrão 5, limite 20)." },
];

export const ferramentaConsultarHistorico: DefinicaoFerramenta<ConsultarHistoricoEntrada, ConsultarHistoricoResultado> = {
  nome: "consultar_historico",
  descricao: "Busca análises anteriores (fretes, custos, comparações etc.) ou documentos PDF já gerados, com filtro por texto e período.",
  objetivo:
    "Permitir que o usuário recupere pelo WhatsApp uma análise ou documento antigo sem depender só da memória da conversa atual — sempre busca estruturada em analysis_runs ou generated_documents, nunca inventa um resultado.",
  parametros: PARAMETROS,
  executar,
};
