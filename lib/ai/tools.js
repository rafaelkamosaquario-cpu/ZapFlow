// ============================================================================
// Ferramentas do Zappy IA — cada uma reaproveita um repo/cliente já
// existente, nunca reimplementa lógica. `criarExecutores(tenant, ...)` fecha
// o empresaId por cima: a IA nunca escolhe de qual empresa buscar dado, isso
// vem sempre do tenant já autenticado no servidor (mesmo princípio de
// isolamento usado no resto do app).
// ============================================================================
import * as repo from "../../db/repositories.js";
import * as googleClient from "../googleClient.js";

export const FERRAMENTAS_DEFINICOES = [
  {
    type: "function",
    name: "buscar_clientes",
    description: "Lista os clientes do CRM da empresa, com quantos dias faz desde o último contato e desde a última resposta.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "buscar_visitas_retornar",
    description: "Lista as visitas em campo cujo resultado foi 'Retornar depois' — clientes que precisam de um retorno.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "buscar_conversas_aguardando",
    description: "Lista os contatos cuja última mensagem no WhatsApp foi recebida e ainda não foi respondida pela empresa.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "buscar_metricas",
    description: "Métricas de campanhas do mês atual: quantas mensagens enviadas, quantas respostas, quantas campanhas.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "criar_evento_google",
    description: "Cria um compromisso na Google Agenda da empresa. Só funciona se a empresa já tiver conectado a conta Google.",
    parameters: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "Título do compromisso" },
        inicio: { type: "string", description: "Data/hora de início, ISO 8601 (ex.: 2026-08-15T09:00:00)" },
        fim: { type: "string", description: "Data/hora de término, ISO 8601" },
        descricao: { type: "string", description: "Descrição opcional do compromisso" },
      },
      required: ["titulo", "inicio", "fim"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function diasDesde(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}

/**
 * `obterConexaoGoogle` é injetado pelo chamador (já existe em server.js,
 * reaproveitado em vez de duplicar a lógica de renovação de token do V3).
 */
export function criarExecutores(tenant, { obterConexaoGoogle }) {
  return {
    async buscar_clientes() {
      return tenant.clients.slice(0, 200).map((c) => ({
        nome: c.name || "(sem nome)", telefone: c.phone, etapa: c.stage,
        diasSemContato: diasDesde(c.lastSentAt), diasSemResposta: diasDesde(c.lastReplyAt),
      }));
    },
    async buscar_visitas_retornar() {
      const visitas = await repo.visitasRepo.listForEmpresa(tenant.empresa.id, "followup");
      return visitas.map((v) => ({
        cliente: v.clienteNome, contato: v.contatoNome, telefone: v.contatoTelefone,
        observacao: v.observacao, proximaVisitaData: v.proximaVisitaData,
      }));
    },
    async buscar_conversas_aguardando() {
      const porContato = new Map();
      for (const m of tenant.conversas) {
        const atual = porContato.get(m.key);
        if (!atual || m.ts > atual.ts) porContato.set(m.key, m);
      }
      return [...porContato.values()].filter((m) => m.dir === "in").map((m) => ({
        telefone: m.phone, ultimaMensagem: (m.text || "").slice(0, 200), diasAguardando: diasDesde(m.ts),
      }));
    },
    async buscar_metricas() {
      const now = new Date();
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const sends = tenant.metrics.sends.filter((s) => s.ts >= startMonth);
      const responses = tenant.metrics.responses.filter((r) => r.ts >= startMonth);
      return {
        enviadasNoMes: sends.reduce((a, s) => a + (s.sent || 0), 0),
        respostasNoMes: responses.length,
        campanhasNoMes: sends.length,
      };
    },
    async criar_evento_google({ titulo, inicio, fim, descricao }) {
      const accessToken = await obterConexaoGoogle(tenant.empresa.id);
      if (!accessToken) {
        return { erro: "A empresa ainda não conectou o Google. Avise o usuário para conectar na aba Calendário." };
      }
      const evento = await googleClient.criarEvento(accessToken, { titulo, inicio, fim, descricao });
      return { ok: true, link: evento.link };
    },
  };
}
