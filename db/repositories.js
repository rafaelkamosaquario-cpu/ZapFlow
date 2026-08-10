// ============================================================================
// Camada ÚNICA de acesso ao banco (Supabase). Nenhum outro arquivo deve falar
// com o Supabase diretamente — tudo passa por aqui.
//
// Multi-tenant: toda função que lê/grava dado operacional recebe `empresaId`
// como primeiro parâmetro e filtra/grava por ele. Isso é o que garante
// isolamento entre empresas (não existem RLS policies — ver migration
// 003_multi_tenant.sql — então esta camada é a única barreira real).
// `requireEmpresaId` falha alto (fail-closed) se algum chamador esquecer de
// passar o id: é preferível quebrar na hora a devolver dado errado.
//
// Cada método recebe/devolve objetos no MESMO formato que o ZapFlow já usa em
// memória, para não quebrar os endpoints nem o frontend. O Supabase é a fonte
// da verdade: os dados são carregados na inicialização e gravados a cada
// alteração (write-through). Em caso de falha, o erro é propagado (sem fallback
// silencioso para arquivos).
// ============================================================================
import { getClient, assertOk } from "./supabase.js";

// Todas as consultas usam o cliente ativo (produção ou, em testes, o injetado).
const supabase = new Proxy({}, {
  get(_t, prop) {
    const c = getClient();
    const v = c[prop];
    return typeof v === "function" ? v.bind(c) : v;
  },
});

const ms = (iso) => (iso ? new Date(iso).getTime() : Date.now());
const iso = (msVal) => new Date(msVal || Date.now()).toISOString();

function requireEmpresaId(id, ctx) {
  if (!id) throw new Error(`[repositories] empresaId obrigatório em ${ctx}`);
  return id;
}

// ----------------------------------------------------------------------------
// empresas (cliente pagante)
// ----------------------------------------------------------------------------
export const empresasRepo = {
  async create({ name, zapiInstanceId, zapiInstanceToken, zapiClientToken, webhookSecret, maxVendedores }) {
    const { data, error } = await supabase.from("empresas").insert({
      name, zapi_instance_id: zapiInstanceId || null, zapi_instance_token: zapiInstanceToken || null,
      zapi_client_token: zapiClientToken || null, webhook_secret: webhookSecret,
      max_vendedores: maxVendedores ?? 5,
    }).select("*").single();
    assertOk(error, "empresas.create");
    return empresaFromRow(data);
  },
  async getById(id) {
    if (!id) return null;
    const { data, error } = await supabase.from("empresas").select("*").eq("id", id).maybeSingle();
    assertOk(error, "empresas.getById");
    return data ? empresaFromRow(data) : null;
  },
};
function empresaFromRow(r) {
  return {
    id: r.id, name: r.name, active: !!r.active, maxVendedores: r.max_vendedores,
    webhookSecret: r.webhook_secret,
    zapiInstanceId: r.zapi_instance_id || "", zapiInstanceToken: r.zapi_instance_token || "",
    zapiClientToken: r.zapi_client_token || "",
  };
}

// ----------------------------------------------------------------------------
// usuarios (login por empresa — papéis owner/vendedor)
// ----------------------------------------------------------------------------
export const usuariosRepo = {
  async findByUsername(username) {
    const u = String(username || "").trim().toLowerCase();
    if (!u) return null;
    const { data, error } = await supabase.from("usuarios").select("*").ilike("username", u).maybeSingle();
    assertOk(error, "usuarios.findByUsername");
    return data ? usuarioFromRow(data) : null;
  },
  async create({ empresaId, username, passwordHash, role, name, phone }) {
    requireEmpresaId(empresaId, "usuarios.create");
    const { data, error } = await supabase.from("usuarios").insert({
      empresa_id: empresaId, username: String(username).trim().toLowerCase(),
      password_hash: passwordHash, role, name: name || "", phone: phone || null,
    }).select("*").single();
    assertOk(error, "usuarios.create");
    return usuarioFromRow(data);
  },
  async countVendedores(empresaId) {
    requireEmpresaId(empresaId, "usuarios.countVendedores");
    const { count, error } = await supabase.from("usuarios").select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId).eq("role", "vendedor").eq("active", true);
    assertOk(error, "usuarios.countVendedores");
    return count || 0;
  },
  async listVendedores(empresaId) {
    requireEmpresaId(empresaId, "usuarios.listVendedores");
    const { data, error } = await supabase.from("usuarios").select("*")
      .eq("empresa_id", empresaId).eq("role", "vendedor").order("created_at");
    assertOk(error, "usuarios.listVendedores");
    return (data || []).map(usuarioFromRow);
  },
  async deactivate(empresaId, usuarioId) {
    requireEmpresaId(empresaId, "usuarios.deactivate");
    const { error } = await supabase.from("usuarios").update({ active: false })
      .eq("id", usuarioId).eq("empresa_id", empresaId);
    assertOk(error, "usuarios.deactivate");
  },
};
function usuarioFromRow(r) {
  return {
    id: r.id, empresaId: r.empresa_id, username: r.username, passwordHash: r.password_hash,
    role: r.role, name: r.name || "", phone: r.phone || "", active: !!r.active,
  };
}

// ----------------------------------------------------------------------------
// contatos (agenda)
// ----------------------------------------------------------------------------
export const contatosRepo = {
  async loadAll(empresaId) {
    requireEmpresaId(empresaId, "contatos.loadAll");
    const { data, error } = await supabase.from("contatos").select("*")
      .eq("empresa_id", empresaId).order("name");
    assertOk(error, "contatos.loadAll");
    return (data || []).map((r) => ({
      id: r.id, name: r.name || "", phone: r.phone, key: r.phone_key,
      origem: r.origem || "manual", createdAt: ms(r.created_at),
    }));
  },
  async upsertOne(empresaId, c) {
    requireEmpresaId(empresaId, "contatos.upsertOne");
    const { error } = await supabase.from("contatos").upsert({
      id: c.id, empresa_id: empresaId, phone_key: c.key, phone: c.phone, name: c.name || "",
      origem: c.origem || "manual", created_at: iso(c.createdAt),
    }, { onConflict: "empresa_id,phone_key" });
    assertOk(error, "contatos.upsertOne");
  },
  async deleteById(empresaId, id) {
    requireEmpresaId(empresaId, "contatos.deleteById");
    const { error } = await supabase.from("contatos").delete().eq("id", id).eq("empresa_id", empresaId);
    assertOk(error, "contatos.deleteById");
  },
};

// ----------------------------------------------------------------------------
// clientes
// ----------------------------------------------------------------------------
function clienteFromRow(r) {
  return {
    id: r.id, phone: r.phone, key: r.phone_key, name: r.name || "", waName: r.wa_name || undefined,
    stage: r.stage || "Novo", stageManual: !!r.stage_manual,
    tags: Array.isArray(r.tags) ? r.tags : [], notes: r.notes || "",
    lastSentAt: r.last_sent_at || undefined, lastReplyAt: r.last_reply_at || undefined,
    lastCampaignName: r.last_campaign_name || undefined,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
  };
}
export const clientesRepo = {
  async loadAll(empresaId) {
    requireEmpresaId(empresaId, "clientes.loadAll");
    const { data, error } = await supabase.from("clientes").select("*")
      .eq("empresa_id", empresaId).order("updated_at", { ascending: false });
    assertOk(error, "clientes.loadAll");
    return (data || []).map(clienteFromRow);
  },
  async upsertOne(empresaId, c) {
    requireEmpresaId(empresaId, "clientes.upsertOne");
    const { error } = await supabase.from("clientes").upsert({
      id: c.id, empresa_id: empresaId, phone_key: c.key, phone: c.phone, name: c.name || "", wa_name: c.waName || null,
      stage: c.stage || "Novo", stage_manual: !!c.stageManual,
      tags: c.tags || [], notes: c.notes || "",
      last_sent_at: c.lastSentAt || null, last_reply_at: c.lastReplyAt || null,
      last_campaign_name: c.lastCampaignName || null, created_at: iso(c.createdAt),
    }, { onConflict: "empresa_id,phone_key" });
    assertOk(error, "clientes.upsertOne");
  },
  async upsertMany(empresaId, list) {
    requireEmpresaId(empresaId, "clientes.upsertMany");
    if (!list.length) return;
    const rows = list.map((c) => ({
      id: c.id, empresa_id: empresaId, phone_key: c.key, phone: c.phone, name: c.name || "", wa_name: c.waName || null,
      stage: c.stage || "Novo", stage_manual: !!c.stageManual, tags: c.tags || [], notes: c.notes || "",
      last_sent_at: c.lastSentAt || null, last_reply_at: c.lastReplyAt || null,
      last_campaign_name: c.lastCampaignName || null, created_at: iso(c.createdAt),
    }));
    const { error } = await supabase.from("clientes").upsert(rows, { onConflict: "empresa_id,phone_key" });
    assertOk(error, "clientes.upsertMany");
  },
  async deleteById(empresaId, id) {
    requireEmpresaId(empresaId, "clientes.deleteById");
    const { error } = await supabase.from("clientes").delete().eq("id", id).eq("empresa_id", empresaId);
    assertOk(error, "clientes.deleteById");
  },
};

// ----------------------------------------------------------------------------
// conversas (thread) + mensagens
// ----------------------------------------------------------------------------
export const conversasRepo = {
  async upsertThread(empresaId, t) {
    requireEmpresaId(empresaId, "conversas.upsertThread");
    const { data, error } = await supabase.from("conversas").upsert({
      empresa_id: empresaId, phone_key: t.key, phone: t.phone, last_text: t.text, last_dir: t.dir,
      last_ts: t.ts, origem: t.origem || null,
    }, { onConflict: "empresa_id,phone_key" }).select("id").single();
    assertOk(error, "conversas.upsertThread");
    return data?.id || null;
  },
};

export const mensagensRepo = {
  async loadAll(empresaId) {
    requireEmpresaId(empresaId, "mensagens.loadAll");
    // Carrega as últimas mensagens (limite alto para caber a caixa de entrada)
    const { data, error } = await supabase.from("mensagens").select("phone_key,phone,text,dir,ts")
      .eq("empresa_id", empresaId).order("ts", { ascending: true }).limit(5000);
    assertOk(error, "mensagens.loadAll");
    return (data || []).map((r) => ({ key: r.phone_key, phone: r.phone, text: r.text, ts: r.ts, dir: r.dir }));
  },
  async insertOne(empresaId, m, externalId, conversaId) {
    requireEmpresaId(empresaId, "mensagens.insertOne");
    const { error } = await supabase.from("mensagens").insert({
      empresa_id: empresaId, conversa_id: conversaId || null, phone_key: m.key, phone: m.phone,
      text: m.text, dir: m.dir, external_id: externalId || null, ts: m.ts,
    });
    // Conflito de external_id (mensagem duplicada) não é erro fatal: apenas ignora
    if (error && error.code === "23505") return false;
    assertOk(error, "mensagens.insertOne");
    return true;
  },
};

// ----------------------------------------------------------------------------
// campanhas (jobs) + destinatarios
// ----------------------------------------------------------------------------
/** Cópia do job sem credenciais nem imagens pesadas (nunca gravar tokens/base64). */
function sanitizeJob(job) {
  const copy = { ...job };
  delete copy.credentials;
  delete copy.imageBase64;
  delete copy.images;
  return copy;
}
export const campanhasRepo = {
  async loadAll(empresaId) {
    requireEmpresaId(empresaId, "campanhas.loadAll");
    const { data, error } = await supabase.from("campanhas").select("data")
      .eq("empresa_id", empresaId).order("created_at", { ascending: true });
    assertOk(error, "campanhas.loadAll");
    return (data || []).map((r) => r.data).filter(Boolean);
  },
  async upsertOne(empresaId, job) {
    requireEmpresaId(empresaId, "campanhas.upsertOne");
    const clean = sanitizeJob(job);
    const { error } = await supabase.from("campanhas").upsert({
      id: job.id, empresa_id: empresaId, status: job.status || "pendente", immediate: !!job.immediate,
      message: job.message || null, had_image: !!(job.hadImage || job.imageCount),
      image_count: job.imageCount || 0, delay_ms: job.delayMs ?? null,
      contacts_count: job.contacts?.length || clean.contacts?.length || 0,
      scheduled_at: job.scheduledAt || null, started_at: job.startedAt || null,
      finished_at: job.finishedAt || null, result: job.result || null,
      error: job.error || null, label: job.label || null,
      data: clean, created_at: iso(job.createdAt),
    }, { onConflict: "id" });
    assertOk(error, "campanhas.upsertOne");
  },
  async upsertMany(empresaId, jobs) {
    if (!jobs.length) return;
    for (const job of jobs) await this.upsertOne(empresaId, job);
  },
  async deleteById(empresaId, id) {
    requireEmpresaId(empresaId, "campanhas.deleteById");
    const { error } = await supabase.from("campanhas").delete().eq("id", id).eq("empresa_id", empresaId);
    assertOk(error, "campanhas.deleteById");
  },
  async deleteAllForEmpresa(empresaId) {
    requireEmpresaId(empresaId, "campanhas.deleteAllForEmpresa");
    const { error } = await supabase.from("campanhas").delete().eq("empresa_id", empresaId);
    assertOk(error, "campanhas.deleteAllForEmpresa");
  },
  /** Usado só pelo agendador: pendentes vencidas de TODAS as empresas, sem carregar estado nenhum. */
  async loadDueAcrossEmpresas() {
    const { data, error } = await supabase.from("campanhas").select("id,empresa_id,scheduled_at")
      .eq("status", "pendente").lte("scheduled_at", Date.now());
    assertOk(error, "campanhas.loadDueAcrossEmpresas");
    return data || [];
  },
};

export const destinatariosRepo = {
  async replaceForCampaign(empresaId, campanhaId, logs) {
    requireEmpresaId(empresaId, "destinatarios.replaceForCampaign");
    if (!Array.isArray(logs) || !logs.length) return;
    await supabase.from("destinatarios_campanha").delete().eq("campanha_id", campanhaId).eq("empresa_id", empresaId);
    const rows = logs.map((l) => ({
      campanha_id: campanhaId, empresa_id: empresaId, phone: l.phone || null, name: l.name || null,
      ok: !!l.ok, error: l.error || null,
    }));
    const { error } = await supabase.from("destinatarios_campanha").insert(rows);
    // Metadado auxiliar: falha aqui é registrada mas não perde a campanha (que já
    // está salva por completo em campanhas.data).
    if (error) console.error("[Supabase] destinatarios_campanha:", error.message);
  },
};

// ----------------------------------------------------------------------------
// modelos_mensagem (templates)
// ----------------------------------------------------------------------------
export const modelosRepo = {
  async loadAll(empresaId) {
    requireEmpresaId(empresaId, "modelos.loadAll");
    const { data, error } = await supabase.from("modelos_mensagem").select("*")
      .eq("empresa_id", empresaId).order("created_at");
    assertOk(error, "modelos.loadAll");
    return (data || []).map((r) => ({
      id: r.id, name: r.name, message: r.message || "",
      imageUrls: Array.isArray(r.image_urls) ? r.image_urls : [],
    }));
  },
  async upsertOne(empresaId, t) {
    requireEmpresaId(empresaId, "modelos.upsertOne");
    const { error } = await supabase.from("modelos_mensagem").upsert({
      id: t.id, empresa_id: empresaId, name: t.name, message: t.message || "", image_urls: t.imageUrls || [],
    }, { onConflict: "id" });
    assertOk(error, "modelos.upsertOne");
  },
  async deleteById(empresaId, id) {
    requireEmpresaId(empresaId, "modelos.deleteById");
    const { error } = await supabase.from("modelos_mensagem").delete().eq("id", id).eq("empresa_id", empresaId);
    assertOk(error, "modelos.deleteById");
  },
};

// ----------------------------------------------------------------------------
// automacoes (chatbot — linha única POR EMPRESA; empresa_id é a própria PK)
// ----------------------------------------------------------------------------
export const automacoesRepo = {
  async load(empresaId) {
    requireEmpresaId(empresaId, "automacoes.load");
    const { data, error } = await supabase.from("automacoes").select("*").eq("empresa_id", empresaId).maybeSingle();
    assertOk(error, "automacoes.load");
    if (!data) return { enabled: false, rules: [], fallback: { enabled: false, reply: "" } };
    return {
      enabled: !!data.enabled,
      rules: Array.isArray(data.rules) ? data.rules : [],
      fallback: data.fallback || { enabled: false, reply: "" },
    };
  },
  async save(empresaId, chatbot) {
    requireEmpresaId(empresaId, "automacoes.save");
    const { error } = await supabase.from("automacoes").upsert({
      empresa_id: empresaId, enabled: !!chatbot.enabled, rules: chatbot.rules || [],
      fallback: chatbot.fallback || { enabled: false, reply: "" },
    }, { onConflict: "empresa_id" });
    assertOk(error, "automacoes.save");
  },
};

// ----------------------------------------------------------------------------
// respostas (metrics.responses)
// ----------------------------------------------------------------------------
export const respostasRepo = {
  async loadAll(empresaId) {
    requireEmpresaId(empresaId, "respostas.loadAll");
    const { data, error } = await supabase.from("respostas").select("phone_key,phone,content,ts")
      .eq("empresa_id", empresaId).order("ts", { ascending: true }).limit(10000);
    assertOk(error, "respostas.loadAll");
    return (data || []).map((r) => ({ phone: r.phone, key: r.phone_key, ts: r.ts, content: r.content || "" }));
  },
  async insertOne(empresaId, r, externalId) {
    requireEmpresaId(empresaId, "respostas.insertOne");
    const { error } = await supabase.from("respostas").insert({
      empresa_id: empresaId, phone_key: r.key, phone: r.phone, content: r.content || "", ts: r.ts,
      external_id: externalId || null,
    });
    if (error && error.code === "23505") return false;
    assertOk(error, "respostas.insertOne");
    return true;
  },
};

// ----------------------------------------------------------------------------
// metricas_envios (metrics.sends)
// ----------------------------------------------------------------------------
export const metricasRepo = {
  async loadAll(empresaId) {
    requireEmpresaId(empresaId, "metricas.loadAll");
    const { data, error } = await supabase.from("metricas_envios").select("ts,sent,failed,name")
      .eq("empresa_id", empresaId).order("ts", { ascending: true }).limit(10000);
    assertOk(error, "metricas.loadAll");
    return (data || []).map((r) => ({ ts: r.ts, sent: r.sent, failed: r.failed, name: r.name || "Campanha" }));
  },
  async insertOne(empresaId, s) {
    requireEmpresaId(empresaId, "metricas.insertOne");
    const { error } = await supabase.from("metricas_envios").insert({
      empresa_id: empresaId, ts: s.ts, sent: s.sent || 0, failed: s.failed || 0, name: s.name || "Campanha",
    });
    assertOk(error, "metricas.insertOne");
  },
};

// ----------------------------------------------------------------------------
// eventos_webhook (dedup de eventos da Z-API pelo id externo, por empresa)
// ----------------------------------------------------------------------------
export const eventosRepo = {
  /** Registra o evento. Devolve { isNew } — false se o external_id já existir NESSA empresa. */
  async record(empresaId, externalId, phoneKey, fromMe, payload) {
    requireEmpresaId(empresaId, "eventos.record");
    const { error } = await supabase.from("eventos_webhook").insert({
      empresa_id: empresaId, external_id: externalId || null, phone_key: phoneKey || null,
      from_me: !!fromMe, payload, processed: false,
    });
    if (error && error.code === "23505") return { isNew: false }; // já processado
    assertOk(error, "eventos.record");
    return { isNew: true };
  },
  async markProcessed(empresaId, externalId) {
    if (!externalId) return;
    await supabase.from("eventos_webhook").update({ processed: true })
      .eq("empresa_id", empresaId).eq("external_id", externalId);
  },
};

// ----------------------------------------------------------------------------
// visitas (V2 — Visitas em Campo)
// ----------------------------------------------------------------------------
function visitaFromRow(r) {
  return {
    id: r.id, vendedorId: r.vendedor_id, clienteNome: r.cliente_nome,
    contatoNome: r.contato_nome || "", contatoTelefone: r.contato_telefone || "",
    latitude: r.latitude, longitude: r.longitude,
    motivo: r.motivo, resultado: r.resultado, observacao: r.observacao || "",
    proximaAcao: r.proxima_acao || "", proximaVisitaData: r.proxima_visita_data || null,
    valorPotencial: r.valor_potencial ?? null,
    dataHora: ms(r.data_hora), createdAt: ms(r.created_at),
  };
}
/** "Hoje": visitas registradas hoje OU com retorno (proxima_visita_data) vencido/hoje. */
function aplicarFiltroHoje(query, hoje) {
  if (!hoje) return query;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const hojeDate = start.toISOString().slice(0, 10);
  return query.or(
    `and(data_hora.gte.${start.toISOString()},data_hora.lt.${end.toISOString()}),proxima_visita_data.lte.${hojeDate}`
  );
}
export const visitasRepo = {
  async create(empresaId, vendedorId, v) {
    requireEmpresaId(empresaId, "visitas.create");
    const { data, error } = await supabase.from("visitas").insert({
      empresa_id: empresaId, vendedor_id: vendedorId,
      cliente_nome: v.clienteNome, contato_nome: v.contatoNome || "", contato_telefone: v.contatoTelefone || null,
      latitude: v.latitude ?? null, longitude: v.longitude ?? null,
      motivo: v.motivo, resultado: v.resultado, observacao: v.observacao || "",
      proxima_acao: v.proximaAcao || "", proxima_visita_data: v.proximaVisitaData || null,
      valor_potencial: v.valorPotencial ?? null,
    }).select("*").single();
    assertOk(error, "visitas.create");
    return visitaFromRow(data);
  },
  async listForVendedor(empresaId, vendedorId, { hoje } = {}) {
    requireEmpresaId(empresaId, "visitas.listForVendedor");
    let q = supabase.from("visitas").select("*").eq("empresa_id", empresaId).eq("vendedor_id", vendedorId);
    q = aplicarFiltroHoje(q, hoje);
    const { data, error } = await q.order("data_hora", { ascending: false });
    assertOk(error, "visitas.listForVendedor");
    return (data || []).map(visitaFromRow);
  },
  async listForEmpresa(empresaId, { hoje } = {}) {
    requireEmpresaId(empresaId, "visitas.listForEmpresa");
    let q = supabase.from("visitas").select("*").eq("empresa_id", empresaId);
    q = aplicarFiltroHoje(q, hoje);
    const { data, error } = await q.order("data_hora", { ascending: false });
    assertOk(error, "visitas.listForEmpresa");
    return (data || []).map(visitaFromRow);
  },
};

// ----------------------------------------------------------------------------
// Carga inicial (por empresa): devolve todas as coleções no formato em
// memória do app, escopadas para uma única empresa.
// ----------------------------------------------------------------------------
export async function loadEverything(empresaId) {
  requireEmpresaId(empresaId, "loadEverything");
  const [agenda, clients, conversasMsgs, jobs, templates, chatbot, responses, sends] = await Promise.all([
    contatosRepo.loadAll(empresaId),
    clientesRepo.loadAll(empresaId),
    mensagensRepo.loadAll(empresaId),
    campanhasRepo.loadAll(empresaId),
    modelosRepo.loadAll(empresaId),
    automacoesRepo.load(empresaId),
    respostasRepo.loadAll(empresaId),
    metricasRepo.loadAll(empresaId),
  ]);
  return { agenda, clients, conversas: conversasMsgs, jobs, templates, chatbot, responses, sends };
}
