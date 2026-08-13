// ============================================================================
// Ferramentas do Zappy IA — cada uma reaproveita um repo/cliente já
// existente, nunca reimplementa lógica. `criarExecutores(tenant, ...)` fecha
// o empresaId por cima: a IA nunca escolhe de qual empresa buscar dado, isso
// vem sempre do tenant já autenticado no servidor (mesmo princípio de
// isolamento usado no resto do app).
// ============================================================================
import * as repo from "../../db/repositories.js";

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
    name: "buscar_desempenho_equipe",
    description: "Desempenho de cada vendedor no período: visitas realizadas, concluídas, pendentes, follow-ups e valor potencial em oportunidades abertas. Use pra perguntas tipo 'como minha equipe trabalhou' ou 'quantas visitas o João fez'.",
    parameters: {
      type: "object",
      properties: {
        periodo: { type: "string", enum: ["hoje", "7d", "30d", "mes"], description: "Período a considerar. Padrão: hoje." },
      },
      required: ["periodo"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "buscar_insights_dashboard",
    description: "Panorama geral do negócio no período: funil comercial (quantos clientes em cada etapa), follow-ups pendentes e métricas de campanhas (enviadas/respostas/taxa). Use pra perguntas gerais tipo 'como está o negócio' ou 'me dê um resumo'.",
    parameters: {
      type: "object",
      properties: {
        periodo: { type: "string", enum: ["hoje", "7d", "30d", "mes"], description: "Período a considerar. Padrão: hoje." },
      },
      required: ["periodo"],
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
 * `agregarDesempenhoEquipe` é injetado pelo chamador (já existe em server.js,
 * reaproveitado -- é a mesma agregação usada pela tela de Visitas do dono).
 */
export function criarExecutores(tenant, { agregarDesempenhoEquipe } = {}) {
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
    async buscar_desempenho_equipe({ periodo }) {
      if (!agregarDesempenhoEquipe) return { erro: "Indisponível." };
      const r = await agregarDesempenhoEquipe(tenant, periodo || "hoje");
      return {
        periodo: r.period,
        total: r.total,
        porVendedor: r.vendedores.map((v) => ({
          vendedor: v.vendedorNome, visitas: v.visitas, concluidas: v.concluidas,
          pendentes: v.pendentes, followups: v.followups, valorPotencial: v.potencial,
        })),
      };
    },
    async buscar_insights_dashboard({ periodo }) {
      const desde = periodoParaTs(periodo || "hoje");
      const sends = tenant.metrics.sends.filter((s) => s.ts >= desde);
      const responses = tenant.metrics.responses.filter((r) => r.ts >= desde);
      const enviadas = sends.reduce((a, s) => a + (s.sent || 0), 0);
      const funil = {};
      for (const c of tenant.clients) funil[c.stage] = (funil[c.stage] || 0) + 1;
      const followupsPendentes = (await repo.visitasRepo.listForEmpresa(tenant.empresa.id, "followup")).length;
      const equipe = agregarDesempenhoEquipe ? await agregarDesempenhoEquipe(tenant, periodo || "hoje") : null;
      return {
        periodo: periodo || "hoje",
        funilPorEtapa: funil,
        campanhas: { enviadas, respostas: responses.length, taxaResposta: enviadas ? Math.round((responses.length / enviadas) * 1000) / 10 : 0 },
        followupsPendentes,
        oportunidadesValorPotencial: equipe?.total.potencial ?? null,
      };
    },
  };
}

function periodoParaTs(periodo) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (periodo === "7d") { const d = new Date(dayStart); d.setDate(d.getDate() - 6); return d.getTime(); }
  if (periodo === "30d") { const d = new Date(dayStart); d.setDate(d.getDate() - 29); return d.getTime(); }
  if (periodo === "mes") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return dayStart.getTime();
}
