import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAlert, listUpcomingAlerts, cancelAlert } from "@/services/supabase/alertService";
import type { ScheduledAlertRow } from "@/lib/supabase/tables";

/**
 * Ferramenta: gerenciar_alerta
 *
 * Alertas planejados (sem telemetria/rastreador) disparados pelo WhatsApp
 * no horário previsto — ver src/app/api/alerts/dispatch/route.ts para o
 * job que efetivamente envia. Independente de gerenciar_google_calendar:
 * o usuário pode ter as duas coisas (evento na Agenda + alerta aqui),
 * criadas separadamente — esta ferramenta nunca mexe no Google Calendar.
 *
 * Mesmo princípio das outras ferramentas de I/O: nunca interpreta "daqui a
 * 15 dias" — quem chama (a IA, com a data/hora atual do system prompt)
 * resolve para scheduledFor absoluto antes de chamar.
 */

export type ModoGerenciarAlerta = "CRIAR" | "LISTAR" | "CANCELAR";

export interface GerenciarAlertaEntrada {
  modo: ModoGerenciarAlerta;
  userId: string;
  companyId: string;
  conversationId?: string;
  vehicleId?: string;

  // CRIAR
  title?: string;
  /** ISO 8601 com offset absoluto — nunca uma expressão relativa. */
  scheduledFor?: string;
  notes?: string;
  category?: string;

  // CANCELAR
  alertId?: string;
}

export interface AlertaResumo {
  id: string;
  titulo: string;
  categoria: string | null;
  quando: string;
  observacoes: string | null;
}

export interface GerenciarAlertaResultado extends ResultadoFerramentaBase {
  modo: ModoGerenciarAlerta;
  alerta?: AlertaResumo;
  alertas_agendados?: AlertaResumo[];
}

function mapaAlerta(row: ScheduledAlertRow): AlertaResumo {
  return { id: row.id, titulo: row.title, categoria: row.category, quando: row.scheduled_for, observacoes: row.notes };
}

const ISO_COM_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

function respostaFalha(modo: ModoGerenciarAlerta, alertas: string[], dadosFaltantes: string[] = []): GerenciarAlertaResultado {
  return { sucesso: false, modo, alertas, premissas: [], dadosFaltantes, mensagemResumo: alertas[0] ?? "Não foi possível concluir a ação de alerta." };
}

async function executar(entrada: GerenciarAlertaEntrada): Promise<GerenciarAlertaResultado> {
  const { modo, userId, companyId } = entrada;

  if (!userId || !companyId) {
    return respostaFalha(modo, ["Não foi possível identificar o usuário/empresa para o alerta."], ["userId", "companyId"]);
  }

  const admin = createAdminClient();

  try {
    switch (modo) {
      case "CRIAR": {
        const faltando: string[] = [];
        if (!entrada.title) faltando.push("title");
        if (!entrada.scheduledFor) faltando.push("scheduledFor");
        if (faltando.length > 0) {
          return respostaFalha(modo, ["Faltam dados para criar o alerta — nunca invento título ou horário."], faltando);
        }
        if (!ISO_COM_OFFSET.test(entrada.scheduledFor!)) {
          return respostaFalha(modo, [
            "scheduledFor precisa ser data e horário absolutos com fuso (ex.: 2026-08-14T08:00:00-03:00) — expressões relativas como \"daqui a 15 dias\" devem ser resolvidas antes de chamar esta ferramenta.",
          ]);
        }

        const criado = await createAlert(admin, {
          companyId,
          userId,
          conversationId: entrada.conversationId,
          vehicleId: entrada.vehicleId,
          title: entrada.title!,
          notes: entrada.notes,
          category: entrada.category,
          scheduledFor: entrada.scheduledFor!,
        });

        return {
          sucesso: true,
          modo,
          alertas: [],
          premissas: [],
          dadosFaltantes: [],
          alerta: mapaAlerta(criado),
          mensagemResumo: `Alerta "${criado.title}" agendado.`,
        };
      }

      case "LISTAR": {
        const proximos = await listUpcomingAlerts(admin, companyId);
        const resumo = proximos.map(mapaAlerta);
        return {
          sucesso: true,
          modo,
          alertas: [],
          premissas: [],
          dadosFaltantes: [],
          alertas_agendados: resumo,
          mensagemResumo: resumo.length === 0 ? "Nenhum alerta agendado." : `${resumo.length} alerta(s) agendado(s).`,
        };
      }

      case "CANCELAR": {
        if (!entrada.alertId) {
          return respostaFalha(modo, ["Preciso saber exatamente qual alerta cancelar (alertId)."], ["alertId"]);
        }
        await cancelAlert(admin, entrada.alertId, companyId);
        return {
          sucesso: true,
          modo,
          alertas: [],
          premissas: [],
          dadosFaltantes: [],
          mensagemResumo: "Alerta cancelado.",
        };
      }

      default: {
        const modoNuncaVisto: never = modo;
        return respostaFalha(modoNuncaVisto as ModoGerenciarAlerta, [`Modo desconhecido: ${String(modoNuncaVisto)}.`]);
      }
    }
  } catch {
    return respostaFalha(modo, ["Não foi possível concluir a ação de alerta agora. Tente novamente em instantes."]);
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "modo", tipo: "enum", obrigatorio: true, descricao: "Operação a executar.", valoresPossiveis: ["CRIAR", "LISTAR", "CANCELAR"] },
  { nome: "userId", tipo: "string", obrigatorio: true, descricao: "Usuário dono do alerta (do contexto da conversa, nunca da mensagem)." },
  { nome: "companyId", tipo: "string", obrigatorio: true, descricao: "Empresa dona do alerta (do contexto da conversa)." },
  { nome: "conversationId", tipo: "string", obrigatorio: false, descricao: "Conversa de origem." },
  { nome: "vehicleId", tipo: "string", obrigatorio: false, descricao: "Veículo relacionado ao alerta, quando identificado." },
  { nome: "title", tipo: "string", obrigatorio: false, descricao: "Título do alerta (CRIAR), ex.: \"Revisão dos pneus\"." },
  { nome: "scheduledFor", tipo: "string", obrigatorio: false, descricao: "Data/hora absoluta em ISO 8601 com offset — nunca expressão relativa (CRIAR)." },
  { nome: "notes", tipo: "string", obrigatorio: false, descricao: "Observações adicionais do alerta." },
  { nome: "category", tipo: "string", obrigatorio: false, descricao: "Categoria livre (ex.: manutenção, documento, jornada, pausa)." },
  { nome: "alertId", tipo: "string", obrigatorio: false, descricao: "Id do alerta a cancelar (CANCELAR)." },
];

export const ferramentaGerenciarAlerta: DefinicaoFerramenta<GerenciarAlertaEntrada, GerenciarAlertaResultado> = {
  nome: "gerenciar_alerta",
  descricao: "Cria, lista ou cancela alertas planejados enviados pelo WhatsApp no horário previsto (revisão, manutenção, documentos, jornada, pausas etc.).",
  objetivo: "Permitir que o usuário seja avisado proativamente pelo WhatsApp em compromissos operacionais, sem depender de rastreamento — o alerta é baseado no planejamento informado, não em telemetria.",
  parametros: PARAMETROS,
  executar,
};
