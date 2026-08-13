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
    description: "Lista as visitas em campo cujo resultado foi 'Retornar depois' — clientes que precisam de um retorno. Pode ser filtrado por vendedor.",
    parameters: {
      type: "object",
      properties: {
        vendedorNome: { type: "string", description: "Nome (ou parte do nome) de um vendedor específico, pra filtrar só os follow-ups dele. Deixe vazio pra todos." },
      },
      required: ["vendedorNome"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "buscar_cliente_detalhe",
    description: "Busca um cliente específico (por nome ou telefone) e traz tudo sobre ele: etapa, vendedor responsável, tags, valor potencial, última conversa, última visita, campanhas recebidas, próxima ação e notas. Use quando o usuário perguntar sobre UM cliente em particular.",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome (ou parte do nome) do cliente" },
        telefone: { type: "string", description: "Telefone do cliente, com ou sem formatação" },
      },
      required: ["nome", "telefone"],
      additionalProperties: false,
    },
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
 * `agregarDesempenhoEquipe`/`agregarClienteDetalhe`/`phoneKey` são injetados
 * pelo chamador (já existem em server.js, reaproveitados -- mesma agregação
 * usada pelas telas de Visitas do dono e Cliente 360°).
 */
export function criarExecutores(tenant, { agregarDesempenhoEquipe, agregarClienteDetalhe, phoneKey } = {}) {
  return {
    async buscar_clientes() {
      return tenant.clients.slice(0, 200).map((c) => ({
        nome: c.name || "(sem nome)", telefone: c.phone, etapa: c.stage,
        diasSemContato: diasDesde(c.lastSentAt), diasSemResposta: diasDesde(c.lastReplyAt),
      }));
    },
    async buscar_visitas_retornar({ vendedorNome } = {}) {
      let visitas = await repo.visitasRepo.listForEmpresa(tenant.empresa.id, "followup");
      if (vendedorNome) {
        const vendedores = await repo.usuariosRepo.listVendedores(tenant.empresa.id);
        const termo = vendedorNome.toLowerCase();
        const ids = new Set(vendedores.filter((v) => (v.name || v.username || "").toLowerCase().includes(termo)).map((v) => v.id));
        visitas = visitas.filter((v) => ids.has(v.vendedorId));
      }
      return visitas.map((v) => ({
        cliente: v.clienteNome, contato: v.contatoNome, telefone: v.contatoTelefone,
        observacao: v.observacao, proximaVisitaData: v.proximaVisitaData,
      }));
    },
    async buscar_cliente_detalhe({ nome, telefone } = {}) {
      let c = null;
      if (telefone && phoneKey) {
        const k = phoneKey(telefone);
        c = tenant.clients.find((x) => (x.key || phoneKey(x.phone)) === k);
      }
      if (!c && nome) {
        const termo = nome.toLowerCase();
        c = tenant.clients.find((x) => (x.name || "").toLowerCase().includes(termo));
      }
      if (!c) return { erro: "Cliente não encontrado com esse nome/telefone." };
      if (!agregarClienteDetalhe) return { erro: "Indisponível." };
      const d = await agregarClienteDetalhe(tenant, c);
      return {
        nome: d.client.displayName || d.client.name, telefone: d.client.phone, etapa: d.client.stage,
        tags: d.client.tags || [], origem: d.client.origem, vendedorResponsavel: d.vendedorResponsavelNome,
        valorPotencial: d.resumo.oportunidadeValor, ultimaConversaEm: d.resumo.ultimaConversaEm ? new Date(d.resumo.ultimaConversaEm).toLocaleString("pt-BR") : null,
        ultimaVisitaEm: d.resumo.ultimaVisitaEm ? new Date(d.resumo.ultimaVisitaEm).toLocaleString("pt-BR") : null,
        campanhasRecebidas: d.resumo.campanhasCount, proximaAcao: d.resumo.proximaAcao,
        notas: (d.notas || []).slice(0, 10).map((n) => n.texto),
        timelineRecente: (d.timeline || []).slice(0, 10).map((e) => ({ tipo: e.tipo, quando: new Date(e.ts).toLocaleString("pt-BR"), texto: e.texto })),
      };
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
