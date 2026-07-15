// ============================================================================
// Camada ÚNICA de acesso ao banco (Supabase). Nenhum outro arquivo deve falar
// com o Supabase diretamente — tudo passa por aqui.
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

// ----------------------------------------------------------------------------
// contatos (agenda)
// ----------------------------------------------------------------------------
export const contatosRepo = {
  async loadAll() {
    const { data, error } = await supabase.from("contatos").select("*").order("name");
    assertOk(error, "contatos.loadAll");
    return (data || []).map((r) => ({
      id: r.id, name: r.name || "", phone: r.phone, key: r.phone_key,
      origem: r.origem || "manual", createdAt: ms(r.created_at),
    }));
  },
  async upsertOne(c) {
    const { error } = await supabase.from("contatos").upsert({
      id: c.id, phone_key: c.key, phone: c.phone, name: c.name || "",
      origem: c.origem || "manual", created_at: iso(c.createdAt),
    }, { onConflict: "phone_key" });
    assertOk(error, "contatos.upsertOne");
  },
  async deleteById(id) {
    const { error } = await supabase.from("contatos").delete().eq("id", id);
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
  async loadAll() {
    const { data, error } = await supabase.from("clientes").select("*").order("updated_at", { ascending: false });
    assertOk(error, "clientes.loadAll");
    return (data || []).map(clienteFromRow);
  },
  async upsertOne(c) {
    const { error } = await supabase.from("clientes").upsert({
      id: c.id, phone_key: c.key, phone: c.phone, name: c.name || "", wa_name: c.waName || null,
      stage: c.stage || "Novo", stage_manual: !!c.stageManual,
      tags: c.tags || [], notes: c.notes || "",
      last_sent_at: c.lastSentAt || null, last_reply_at: c.lastReplyAt || null,
      last_campaign_name: c.lastCampaignName || null, created_at: iso(c.createdAt),
    }, { onConflict: "phone_key" });
    assertOk(error, "clientes.upsertOne");
  },
  async upsertMany(list) {
    if (!list.length) return;
    const rows = list.map((c) => ({
      id: c.id, phone_key: c.key, phone: c.phone, name: c.name || "", wa_name: c.waName || null,
      stage: c.stage || "Novo", stage_manual: !!c.stageManual, tags: c.tags || [], notes: c.notes || "",
      last_sent_at: c.lastSentAt || null, last_reply_at: c.lastReplyAt || null,
      last_campaign_name: c.lastCampaignName || null, created_at: iso(c.createdAt),
    }));
    const { error } = await supabase.from("clientes").upsert(rows, { onConflict: "phone_key" });
    assertOk(error, "clientes.upsertMany");
  },
  async deleteById(id) {
    const { error } = await supabase.from("clientes").delete().eq("id", id);
    assertOk(error, "clientes.deleteById");
  },
};

// ----------------------------------------------------------------------------
// conversas (thread) + mensagens
// ----------------------------------------------------------------------------
export const conversasRepo = {
  async upsertThread(t) {
    const { data, error } = await supabase.from("conversas").upsert({
      phone_key: t.key, phone: t.phone, last_text: t.text, last_dir: t.dir,
      last_ts: t.ts, origem: t.origem || null,
    }, { onConflict: "phone_key" }).select("id").single();
    assertOk(error, "conversas.upsertThread");
    return data?.id || null;
  },
};

export const mensagensRepo = {
  async loadAll() {
    // Carrega as últimas mensagens (limite alto para caber a caixa de entrada)
    const { data, error } = await supabase.from("mensagens").select("phone_key,phone,text,dir,ts")
      .order("ts", { ascending: true }).limit(5000);
    assertOk(error, "mensagens.loadAll");
    return (data || []).map((r) => ({ key: r.phone_key, phone: r.phone, text: r.text, ts: r.ts, dir: r.dir }));
  },
  async insertOne(m, externalId, conversaId) {
    const { error } = await supabase.from("mensagens").insert({
      conversa_id: conversaId || null, phone_key: m.key, phone: m.phone,
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
  async loadAll() {
    const { data, error } = await supabase.from("campanhas").select("data").order("created_at", { ascending: true });
    assertOk(error, "campanhas.loadAll");
    return (data || []).map((r) => r.data).filter(Boolean);
  },
  async upsertOne(job) {
    const clean = sanitizeJob(job);
    const { error } = await supabase.from("campanhas").upsert({
      id: job.id, status: job.status || "pendente", immediate: !!job.immediate,
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
  async upsertMany(jobs) {
    if (!jobs.length) return;
    for (const job of jobs) await this.upsertOne(job);
  },
  async deleteById(id) {
    const { error } = await supabase.from("campanhas").delete().eq("id", id);
    assertOk(error, "campanhas.deleteById");
  },
  async deleteAll() {
    const { error } = await supabase.from("campanhas").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    assertOk(error, "campanhas.deleteAll");
  },
};

export const destinatariosRepo = {
  async replaceForCampaign(campanhaId, logs) {
    if (!Array.isArray(logs) || !logs.length) return;
    await supabase.from("destinatarios_campanha").delete().eq("campanha_id", campanhaId);
    const rows = logs.map((l) => ({
      campanha_id: campanhaId, phone: l.phone || null, name: l.name || null,
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
  async loadAll() {
    const { data, error } = await supabase.from("modelos_mensagem").select("*").order("created_at");
    assertOk(error, "modelos.loadAll");
    return (data || []).map((r) => ({
      id: r.id, name: r.name, message: r.message || "",
      imageUrls: Array.isArray(r.image_urls) ? r.image_urls : [],
    }));
  },
  async upsertOne(t) {
    const { error } = await supabase.from("modelos_mensagem").upsert({
      id: t.id, name: t.name, message: t.message || "", image_urls: t.imageUrls || [],
    }, { onConflict: "id" });
    assertOk(error, "modelos.upsertOne");
  },
  async deleteById(id) {
    const { error } = await supabase.from("modelos_mensagem").delete().eq("id", id);
    assertOk(error, "modelos.deleteById");
  },
};

// ----------------------------------------------------------------------------
// automacoes (chatbot — linha única)
// ----------------------------------------------------------------------------
export const automacoesRepo = {
  async load() {
    const { data, error } = await supabase.from("automacoes").select("*").eq("id", "chatbot").maybeSingle();
    assertOk(error, "automacoes.load");
    if (!data) return { enabled: false, rules: [], fallback: { enabled: false, reply: "" } };
    return {
      enabled: !!data.enabled,
      rules: Array.isArray(data.rules) ? data.rules : [],
      fallback: data.fallback || { enabled: false, reply: "" },
    };
  },
  async save(chatbot) {
    const { error } = await supabase.from("automacoes").upsert({
      id: "chatbot", enabled: !!chatbot.enabled, rules: chatbot.rules || [],
      fallback: chatbot.fallback || { enabled: false, reply: "" },
    }, { onConflict: "id" });
    assertOk(error, "automacoes.save");
  },
};

// ----------------------------------------------------------------------------
// respostas (metrics.responses)
// ----------------------------------------------------------------------------
export const respostasRepo = {
  async loadAll() {
    const { data, error } = await supabase.from("respostas").select("phone_key,phone,content,ts")
      .order("ts", { ascending: true }).limit(10000);
    assertOk(error, "respostas.loadAll");
    return (data || []).map((r) => ({ phone: r.phone, key: r.phone_key, ts: r.ts, content: r.content || "" }));
  },
  async insertOne(r, externalId) {
    const { error } = await supabase.from("respostas").insert({
      phone_key: r.key, phone: r.phone, content: r.content || "", ts: r.ts, external_id: externalId || null,
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
  async loadAll() {
    const { data, error } = await supabase.from("metricas_envios").select("ts,sent,failed,name")
      .order("ts", { ascending: true }).limit(10000);
    assertOk(error, "metricas.loadAll");
    return (data || []).map((r) => ({ ts: r.ts, sent: r.sent, failed: r.failed, name: r.name || "Campanha" }));
  },
  async insertOne(s) {
    const { error } = await supabase.from("metricas_envios").insert({
      ts: s.ts, sent: s.sent || 0, failed: s.failed || 0, name: s.name || "Campanha",
    });
    assertOk(error, "metricas.insertOne");
  },
};

// ----------------------------------------------------------------------------
// eventos_webhook (dedup de eventos da Z-API pelo id externo)
// ----------------------------------------------------------------------------
export const eventosRepo = {
  /** Registra o evento. Devolve { isNew } — false se o external_id já existir. */
  async record(externalId, phoneKey, fromMe, payload) {
    const { error } = await supabase.from("eventos_webhook").insert({
      external_id: externalId || null, phone_key: phoneKey || null,
      from_me: !!fromMe, payload, processed: false,
    });
    if (error && error.code === "23505") return { isNew: false }; // já processado
    assertOk(error, "eventos.record");
    return { isNew: true };
  },
  async markProcessed(externalId) {
    if (!externalId) return;
    await supabase.from("eventos_webhook").update({ processed: true }).eq("external_id", externalId);
  },
};

// ----------------------------------------------------------------------------
// Carga inicial (boot): devolve todas as coleções no formato em memória do app.
// ----------------------------------------------------------------------------
export async function loadEverything() {
  const [agenda, clients, conversasMsgs, jobs, templates, chatbot, responses, sends] = await Promise.all([
    contatosRepo.loadAll(),
    clientesRepo.loadAll(),
    mensagensRepo.loadAll(),
    campanhasRepo.loadAll(),
    modelosRepo.loadAll(),
    automacoesRepo.load(),
    respostasRepo.loadAll(),
    metricasRepo.loadAll(),
  ]);
  return { agenda, clients, conversas: conversasMsgs, jobs, templates, chatbot, responses, sends };
}
