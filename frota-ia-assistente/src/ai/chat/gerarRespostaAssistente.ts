import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic/client";
import { construirFerramentasAnthropic, CAMPOS_DE_CONTEXTO_RESERVADOS } from "@/lib/anthropic/tools";
import { construirSystemPrompt } from "@/lib/anthropic/systemPrompt";
import { saveToolExecution, type CustomerContext, type VehicleContext } from "@/ai/context/customerContext";
import { appendMessage, listMessages } from "@/services/supabase/conversationService";
import { startAnalysisRun, completeAnalysisRun, failAnalysisRun } from "@/services/supabase/analysisHistoryService";
import { FERRAMENTAS_FROTA_IA } from "@/ai/tools";
import { truncate } from "@/lib/utils";
import type { SupabaseDbClient } from "@/services/supabase/types";
import type { ConversationRow, FrotaIaToolName, MessageInsert, MessageRow } from "@/lib/supabase/tables";
import type { ResultadoFerramentaBase } from "@/ai/tools/types";

/**
 * As 11 ferramentas de cálculo puro viram um registro em analysis_runs
 * (Camada 3) — as ferramentas de integração (Agenda, alertas, histórico)
 * não são "análises", não geram linha aqui. Sem isso, consultar_historico
 * (Camada 6, Fase E) nunca encontraria nada: nada escrevia em
 * analysis_runs antes desta correção.
 */
const FERRAMENTAS_DE_ANALISE = new Set<string>([
  "analisar_frete",
  "calcular_combustivel",
  "calcular_cpk",
  "comparar_pneus",
  "calcular_custo_viagem",
  "calcular_margem",
  "calcular_valor_minimo_frete",
  "calcular_receita_km",
  "calcular_custo_dia",
  "calcular_custo_veiculo_parado",
  "calcular_jornada",
]);

/**
 * Motor de resposta do Frota IA (Fase 2): monta o histórico, chama a Claude
 * API com as ferramentas, executa o loop de tool use e persiste as
 * mensagens. Extraído de src/app/api/chat/route.ts para ser reaproveitado
 * também pelo webhook do WhatsApp (Camada 5) — o "roteador de ferramentas"
 * continua sendo a própria Claude, não importa o canal de origem.
 *
 * Quem chama decide o client (RLS via sessão do navegador, ou admin via
 * webhook sem sessão) e como tratar os erros (AnthropicConfigError etc.) —
 * esta função não sabe se está sendo chamada pela web ou pelo WhatsApp.
 */

const MAX_TOOL_ROUNDS = 4;
const MAX_TOKENS = 1536;

function paraMensagemAnthropic(row: MessageRow): Anthropic.MessageParam | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  if (!row.content) return null;
  return { role: row.role, content: row.content };
}

export interface GerarRespostaAssistenteParams {
  client: SupabaseDbClient;
  userId: string;
  companyId: string;
  conversation: ConversationRow;
  customerContext: CustomerContext;
  vehicleContext: VehicleContext;
  mensagemUsuario: string;
  /** Campos extras para a mensagem de entrada (ex.: external_message_id, para deduplicar reentregas de webhook). */
  inboundMessageExtra?: Partial<MessageInsert>;
}

export interface RespostaAssistente {
  conversationId: string;
  message: { id: string; content: string; createdAt: string };
}

export async function gerarRespostaAssistente(params: GerarRespostaAssistenteParams): Promise<RespostaAssistente> {
  const { client, userId, companyId, conversation, customerContext, vehicleContext, mensagemUsuario } = params;

  if (!conversation.title) {
    await client.from("conversations").update({ title: truncate(mensagemUsuario, 48) }).eq("id", conversation.id);
  }

  const historico = await listMessages(client, conversation.id, 0, 30);
  const mensagensAnthropic: Anthropic.MessageParam[] = historico
    .slice()
    .reverse()
    .map(paraMensagemAnthropic)
    .filter((m): m is Anthropic.MessageParam => m !== null);

  await appendMessage(client, {
    conversation_id: conversation.id,
    company_id: companyId,
    user_id: userId,
    role: "user",
    direction: "inbound",
    content: mensagemUsuario,
    ...params.inboundMessageExtra,
  });

  mensagensAnthropic.push({ role: "user", content: mensagemUsuario });

  const anthropic = createAnthropicClient();
  const system = construirSystemPrompt(customerContext, vehicleContext, new Date());
  const tools = construirFerramentasAnthropic();

  let textoFinal = "";

  for (let rodada = 0; rodada <= MAX_TOOL_ROUNDS; rodada++) {
    const resposta = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      messages: mensagensAnthropic,
    });

    const blocosTexto = resposta.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const blocosFerramenta = resposta.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    textoFinal = blocosTexto.map((b) => b.text).join("\n").trim();

    if (resposta.stop_reason !== "tool_use" || blocosFerramenta.length === 0 || rodada === MAX_TOOL_ROUNDS) {
      break;
    }

    mensagensAnthropic.push({ role: "assistant", content: resposta.content });

    const resultadosFerramentas: Anthropic.ToolResultBlockParam[] = [];

    for (const bloco of blocosFerramenta) {
      const ferramenta = FERRAMENTAS_FROTA_IA.find((f) => f.nome === bloco.name);

      if (!ferramenta) {
        resultadosFerramentas.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: `Ferramenta desconhecida: ${bloco.name}.`,
          is_error: true,
        });
        continue;
      }

      const inputDoModelo = (bloco.input ?? {}) as Record<string, unknown>;
      for (const campo of CAMPOS_DE_CONTEXTO_RESERVADOS) delete inputDoModelo[campo];

      const entradaFinal = {
        ...inputDoModelo,
        userId,
        companyId,
        conversationId: conversation.id,
      };

      const ehAnalise = FERRAMENTAS_DE_ANALISE.has(bloco.name);
      const analysisRunId = ehAnalise
        ? await startAnalysisRun(client, companyId, {
            userId,
            vehicleId: vehicleContext.vehicle?.id,
            conversationId: conversation.id,
            analysisType: bloco.name,
            userRequest: mensagemUsuario,
            inputSnapshot: entradaFinal,
          })
            .then((run) => run.id)
            .catch(() => undefined)
        : undefined;

      try {
        const resultado = await saveToolExecution(
          client,
          companyId,
          { userId, toolName: bloco.name as FrotaIaToolName, inputData: entradaFinal, conversationId: conversation.id, analysisRunId },
          () => ferramenta.executar(entradaFinal as never)
        );

        if (analysisRunId) {
          const resultadoBase = resultado as ResultadoFerramentaBase;
          if (resultadoBase.sucesso) {
            await completeAnalysisRun(client, analysisRunId, resultadoBase.mensagemResumo, { ...resultadoBase }).catch(() => {});
          } else {
            await failAnalysisRun(client, analysisRunId, "TOOL_FAILURE", resultadoBase.mensagemResumo).catch(() => {});
          }
        }

        resultadosFerramentas.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: JSON.stringify(analysisRunId ? { ...resultado, analysisRunId } : resultado),
          is_error: !resultado.sucesso,
        });
      } catch {
        if (analysisRunId) {
          await failAnalysisRun(client, analysisRunId, "EXECUTION_ERROR", "A ferramenta falhou ao processar os dados recebidos.").catch(() => {});
        }
        resultadosFerramentas.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: "A ferramenta falhou ao processar os dados recebidos.",
          is_error: true,
        });
      }
    }

    mensagensAnthropic.push({ role: "user", content: resultadosFerramentas });
  }

  if (!textoFinal) {
    textoFinal = "Não consegui concluir essa resposta agora. Pode reformular o pedido?";
  }

  const mensagemSalva = await appendMessage(client, {
    conversation_id: conversation.id,
    company_id: companyId,
    user_id: userId,
    role: "assistant",
    direction: "outbound",
    content: textoFinal,
  });

  return {
    conversationId: conversation.id,
    message: { id: mensagemSalva.id, content: textoFinal, createdAt: mensagemSalva.created_at },
  };
}
