// ============================================================================
// Cliente OpenAI (Responses API) — chamadas REST diretas via axios, sem SDK
// (mesmo estilo de lib/googleClient.js). A OPENAI_API_KEY nunca sai do
// backend nem é logada.
// ============================================================================
import axios from "axios";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const openaiConfigured = Boolean(OPENAI_API_KEY);

// Roteador de modelo por tarefa: cada endpoint de IA escolhe o modelo pela
// natureza da tarefa, não por uma % fixa. "simples" (extração/classificação
// estruturada, ex.: resumir visita) usa Luna; o resto (que exige julgamento
// comercial/tom) usa Terra. "complexo" (Sol) fica pronto pra análises pesadas
// futuras (relatório executivo, diagnóstico gerencial) quando existirem.
export const MODELOS = {
  simples: "gpt-5.6-luna",
  padrao: "gpt-5.6-terra",
  complexo: "gpt-5.6-sol",
};

// Preço por milhão de tokens (USD), conferido contra a página oficial de
// pricing em 2026-08-13. Usado só pra estimar custo em ia_consumo — não afeta
// cobrança real (isso é direto na fatura da OpenAI).
const PRECOS_POR_MILHAO = {
  "gpt-5.6-luna": { entrada: 0.20, saida: 1.20 },
  "gpt-5.6-terra": { entrada: 2, saida: 12 },
  "gpt-5.6-sol": { entrada: 5, saida: 30 },
};
export function calcularCustoEstimado(modelo, tokensEntrada, tokensSaida) {
  const preco = PRECOS_POR_MILHAO[modelo];
  if (!preco) return 0;
  return (tokensEntrada / 1e6) * preco.entrada + (tokensSaida / 1e6) * preco.saida;
}

async function criarResposta({ model, input, tools }) {
  const body = { model, input };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const { data } = await axios.post("https://api.openai.com/v1/responses", body, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    timeout: 60000,
  });
  return data;
}

function extrairTexto(resp) {
  if (resp.output_text) return resp.output_text;
  return (resp.output || [])
    .filter((o) => o.type === "message")
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

/**
 * Roda o loop de function calling: chama a Responses API, executa as funções
 * que o modelo pedir (via `executores`, já escopadas pelo chamador — a IA
 * nunca decide de qual empresa buscar dado, isso vem sempre fechado no
 * executor), devolve o resultado pra ela, repete até vir texto final.
 * Limite de rodadas por segurança (nunca loop infinito por erro de tool).
 */
export async function executarComFerramentas({ model, input, tools, executores }) {
  const entrada = [...input];
  let tokensEntrada = 0;
  let tokensSaida = 0;
  const chamadas = [];
  for (let rodada = 0; rodada < 5; rodada++) {
    const resp = await criarResposta({ model, input: entrada, tools });
    tokensEntrada += resp.usage?.input_tokens || 0;
    tokensSaida += resp.usage?.output_tokens || 0;
    const funcCalls = (resp.output || []).filter((o) => o.type === "function_call");
    if (!funcCalls.length) {
      return { textoFinal: extrairTexto(resp), chamadas, usage: { tokensEntrada, tokensSaida } };
    }
    entrada.push(...resp.output);
    for (const call of funcCalls) {
      const executor = executores[call.name];
      let resultado;
      try {
        const args = call.arguments ? JSON.parse(call.arguments) : {};
        resultado = executor ? await executor(args) : { erro: `Ferramenta desconhecida: ${call.name}` };
      } catch (err) {
        resultado = { erro: err.message };
      }
      chamadas.push({ nome: call.name, argumentos: call.arguments });
      entrada.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(resultado) });
    }
  }
  return {
    textoFinal: "Não consegui concluir — muitas etapas necessárias. Tente reformular sua pergunta.",
    chamadas, usage: { tokensEntrada, tokensSaida },
  };
}
