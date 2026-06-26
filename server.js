import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_DELAY_MS = Number(process.env.DEFAULT_DELAY_MS || 3000);

// Diretório de dados (para persistir agendamentos, métricas e modelos). Em
// produção (ex.: Railway) recomenda-se apontar para um volume.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const METRICS_FILE = path.join(DATA_DIR, "metrics.json");
const TEMPLATES_FILE = path.join(DATA_DIR, "templates.json");

// --- Autenticação simples (opcional, ativada via .env) ---
const APP_USER = process.env.APP_USER || "";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const AUTH_ENABLED = Boolean(APP_USER && APP_PASSWORD);
const SESSION_HOURS = 8;
const AUTH_SECRET = crypto.createHash("sha256").update("zapflow:" + APP_PASSWORD).digest();

function makeToken() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(String(exp)).digest("hex");
  return Buffer.from(`${exp}.${sig}`).toString("base64url");
}
function validToken(token) {
  try {
    const [exp, sig] = Buffer.from(token, "base64url").toString().split(".");
    if (!exp || !sig) return false;
    const expect = crypto.createHmac("sha256", AUTH_SECRET).update(exp).digest("hex");
    return sig === expect && Number(exp) > Date.now();
  } catch {
    return false;
  }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  return validToken(parseCookies(req).zapflow_session || "");
}

app.use(express.json({ limit: "50mb" }));

// Middleware de autenticação (libera login, webhook e os assets da tela de login)
const PUBLIC_PATHS = new Set([
  "/login", "/login.html", "/login.js",
  "/style.css", "/zappy.svg", "/icon.svg",
  "/manifest.json", "/sw.js", "/favicon.ico",
]);
app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();
  const p = req.path;
  if (PUBLIC_PATHS.has(p) || p === "/api/login" || p === "/api/logout" || p === "/api/webhook") {
    return next();
  }
  if (isAuthed(req)) return next();
  if (p.startsWith("/api/")) return res.status(401).json({ error: "Não autenticado." });
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (isAuthed(req)) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  const { user, password } = req.body || {};
  if (user === APP_USER && password === APP_PASSWORD) {
    res.cookie("zapflow_session", makeToken(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_HOURS * 3600 * 1000,
    });
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: "Usuário ou senha incorretos." });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("zapflow_session");
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

// Uploads ficam em memória (não gravamos arquivos sensíveis em disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normaliza um número de telefone para o formato esperado pela Z-API.
 * Remove tudo que não for dígito e adiciona o DDI 55 (Brasil) quando ausente.
 */
function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // Remove zeros à esquerda
  digits = digits.replace(/^0+/, "");

  // Se já vier com DDI 55, mantém. Caso contrário, assume Brasil.
  if (!digits.startsWith("55")) {
    // Número nacional típico: 10 (fixo) ou 11 (celular) dígitos com DDD
    if (digits.length === 10 || digits.length === 11) {
      digits = "55" + digits;
    }
  }

  // Validação mínima de tamanho (DDI + DDD + número)
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

/**
 * Resolve as credenciais da Z-API priorizando o que foi enviado no corpo da
 * requisição e caindo para as variáveis de ambiente.
 */
function resolveCredentials(body = {}) {
  return {
    instanceId: (body.instanceId || process.env.ZAPI_INSTANCE_ID || "").trim(),
    instanceToken: (body.instanceToken || process.env.ZAPI_INSTANCE_TOKEN || "").trim(),
    clientToken: (body.clientToken || process.env.ZAPI_CLIENT_TOKEN || "").trim(),
  };
}

function zapiBaseUrl({ instanceId, instanceToken }) {
  return `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}`;
}

function zapiHeaders({ clientToken }) {
  const headers = { "Content-Type": "application/json" };
  if (clientToken) headers["Client-Token"] = clientToken;
  return headers;
}

/**
 * Extrai os contatos de uma planilha. Procura colunas de telefone e nome
 * de forma flexível (aceita variações de cabeçalho em PT/EN).
 */
function parseContactsFromBuffer(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  const phoneKeys = ["telefone", "celular", "phone", "numero", "número", "whatsapp", "fone", "contato"];
  const nameKeys = ["nome", "name", "cliente", "contato_nome"];

  const findKey = (obj, candidates) => {
    const keys = Object.keys(obj);
    for (const cand of candidates) {
      const found = keys.find((k) => k.trim().toLowerCase() === cand);
      if (found) return found;
    }
    // Busca parcial (ex.: "Telefone Principal")
    for (const cand of candidates) {
      const found = keys.find((k) => k.trim().toLowerCase().includes(cand));
      if (found) return found;
    }
    return null;
  };

  const contacts = [];
  for (const row of rows) {
    const phoneKey = findKey(row, phoneKeys);
    const nameKey = findKey(row, nameKeys);
    const rawPhone = phoneKey ? row[phoneKey] : Object.values(row)[0];
    const phone = normalizePhone(rawPhone);
    const name = nameKey ? String(row[nameKey]).trim() : "";
    if (phone) {
      contacts.push({ phone, name, rawPhone: String(rawPhone).trim() });
    } else if (rawPhone && String(rawPhone).trim()) {
      contacts.push({ phone: null, name, rawPhone: String(rawPhone).trim(), invalid: true });
    }
  }
  return contacts;
}

/** Substitui {{nome}} pelo nome do contato na mensagem. */
function applyTemplate(message, contact) {
  const name = contact.name || "";
  return String(message || "")
    .replace(/\{\{\s*nome\s*\}\}/gi, name)
    .replace(/\{\{\s*name\s*\}\}/gi, name);
}

/** Normaliza a lista de imagens (até 3), aceitando o formato antigo (url/base64 únicos). */
function normalizeImages(images, imageUrl, imageBase64) {
  let imgs = [];
  if (Array.isArray(images)) imgs = images;
  else if (imageUrl) imgs = [imageUrl];
  else if (imageBase64) imgs = [imageBase64];
  return imgs.filter((s) => typeof s === "string" && s.trim()).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Agendamento de disparos
// ---------------------------------------------------------------------------
let jobs = [];

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      jobs = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Não foi possível carregar os agendamentos:", err.message);
    jobs = [];
  }
}

function saveJobs() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar os agendamentos:", err.message);
  }
}

/** Conta quantos contatos da campanha responderam (após o disparo). */
function countReplies(job) {
  if (!job.logs?.length) return 0;
  const since = job.startedAt || job.createdAt || 0;
  const replied = new Set(metrics.responses.filter((r) => r.ts >= since).map((r) => r.phone));
  let n = 0;
  for (const l of job.logs) {
    if (l.ok && replied.has(String(l.phone || "").replace(/\D/g, ""))) n++;
  }
  return n;
}

/** Versão segura para o cliente: sem credenciais nem conteúdo pesado. */
function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    immediate: Boolean(job.immediate),
    createdAt: job.createdAt,
    scheduledAt: job.scheduledAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    message: job.message,
    hasImage: Boolean(job.images?.length || job.imageUrl || job.imageBase64 || job.hadImage),
    imageCount: job.imageCount ?? (job.images?.length || 0),
    delayMs: job.delayMs,
    contactsCount: job.contacts?.length || 0,
    result: job.result || null,
    repliedCount: countReplies(job),
    error: job.error || null,
  };
}

/** Após concluir um job, remove dados pesados/sensíveis (imagens e credenciais). */
function trimFinishedJob(job) {
  if (job.images?.length || job.imageBase64) {
    job.hadImage = true;
    job.imageCount = job.imageCount ?? (job.images?.length || 1);
    job.images = null;
    job.imageBase64 = null;
  }
  job.credentials = null;
}

/** Executa um agendamento (envia para todos os contatos do job). */
async function runJob(job) {
  job.status = "enviando";
  job.startedAt = Date.now();
  job.logs = [];
  let success = 0;
  let failed = 0;
  saveJobs();

  for (let i = 0; i < job.contacts.length; i++) {
    const contact = job.contacts[i];
    if (!contact.phone) {
      failed++;
      job.logs.push({ phone: contact.rawPhone, name: contact.name, ok: false, error: "Número inválido" });
    } else {
      try {
        await sendOne(job.credentials, contact, job);
        success++;
        job.logs.push({ phone: contact.phone, name: contact.name, ok: true });
      } catch (err) {
        failed++;
        const error = err.response?.data?.error || err.response?.data?.message || err.message;
        job.logs.push({ phone: contact.phone, name: contact.name, ok: false, error });
      }
    }
    job.result = { success, failed, total: job.contacts.length };
    saveJobs();
    if (i < job.contacts.length - 1 && job.delayMs > 0) {
      await sleep(job.delayMs);
    }
  }

  job.status = "concluido";
  job.finishedAt = Date.now();
  recordClientsSent(job.contacts);
  trimFinishedJob(job);
  saveJobs();
  recordCampaign(success, failed);
  console.log(`Agendamento ${job.id} concluído: ${success} ok / ${failed} falhas.`);
}

// Verifica periodicamente se há agendamentos vencidos para disparar.
let schedulerRunning = false;
async function schedulerTick() {
  if (schedulerRunning) return;
  const now = Date.now();
  const due = jobs.filter((j) => j.status === "pendente" && j.scheduledAt <= now);
  if (due.length === 0) return;

  schedulerRunning = true;
  for (const job of due) {
    try {
      await runJob(job);
    } catch (err) {
      job.status = "erro";
      job.error = err.message;
      saveJobs();
    }
  }
  schedulerRunning = false;
}

loadJobs();
// Marca como "erro" jobs que ficaram "enviando" por causa de um reinício do servidor.
jobs.forEach((j) => {
  if (j.status === "enviando") {
    j.status = "erro";
    j.error = "Interrompido por reinício do servidor.";
  }
});
saveJobs();
setInterval(schedulerTick, 15000);

// ---------------------------------------------------------------------------
// Métricas (data/metrics.json)
// ---------------------------------------------------------------------------
let metrics = { sends: [], responses: [], campaigns: 0 };

function loadMetrics() {
  try {
    if (fs.existsSync(METRICS_FILE)) metrics = JSON.parse(fs.readFileSync(METRICS_FILE, "utf8"));
  } catch {
    metrics = { sends: [], responses: [], campaigns: 0 };
  }
}
function saveMetrics() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics));
  } catch (err) {
    console.error("Não foi possível salvar as métricas:", err.message);
  }
}
function recordCampaign(sent, failed, ts = Date.now()) {
  metrics.sends.push({ ts, sent, failed });
  metrics.campaigns = (metrics.campaigns || 0) + 1;
  saveMetrics();
}
function recordResponse(phone, ts = Date.now(), content = "") {
  metrics.responses.push({
    phone: String(phone || "").replace(/\D/g, ""),
    ts,
    content: String(content || "").slice(0, 200),
  });
  saveMetrics();
}
function summarizeMetrics(from) {
  const sends = metrics.sends.filter((s) => s.ts >= from);
  const responses = metrics.responses.filter((r) => r.ts >= from);
  const totalSent = sends.reduce((a, s) => a + (s.sent || 0), 0);
  const repliedNumbers = new Set(responses.map((r) => r.phone));
  const replied = repliedNumbers.size;
  const semRetorno = Math.max(totalSent - replied, 0);
  const taxa = totalSent ? Math.round((replied / totalSent) * 1000) / 10 : 0;

  const hours = {};
  responses.forEach((r) => { const h = new Date(r.ts).getHours(); hours[h] = (hours[h] || 0) + 1; });
  let melhorHora = null, max = 0;
  for (const h in hours) { if (hours[h] > max) { max = hours[h]; melhorHora = Number(h); } }

  const week = [0, 0, 0, 0, 0, 0, 0]; // dom..sáb (mensagens enviadas)
  sends.forEach((s) => { week[new Date(s.ts).getDay()] += (s.sent || 0); });

  return { totalSent, replied, semRetorno, taxa, campanhas: sends.length, melhorHora, week };
}

loadMetrics();

// ---------------------------------------------------------------------------
// Modelos de mensagem (data/templates.json)
// ---------------------------------------------------------------------------
let templates = [];
const MAX_TEMPLATES = 10;

function loadTemplates() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, "utf8"));
  } catch {
    templates = [];
  }
}
function saveTemplates() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar os modelos:", err.message);
  }
}
loadTemplates();

// ---------------------------------------------------------------------------
// CRM-lite: base de clientes (data/clients.json)
// ---------------------------------------------------------------------------
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const CRM_STAGES = ["Novo", "Contatado", "Respondeu", "Negociando", "Cliente", "Perdido"];
let clients = [];

function loadClients() {
  try {
    if (fs.existsSync(CLIENTS_FILE)) clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf8"));
  } catch {
    clients = [];
  }
}
function saveClients() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar os clientes:", err.message);
  }
}
function onlyDigits(p) { return String(p || "").replace(/\D/g, ""); }
/** Telefone canônico do CRM: aplica a mesma normalização (DDI 55) dos contatos. */
function canonPhone(p) { return normalizePhone(p) || onlyDigits(p); }
function findClient(phone) {
  const p = canonPhone(phone);
  return p ? clients.find((c) => c.phone === p) : null;
}
function upsertClient(phone, name) {
  const p = canonPhone(phone);
  if (!p) return null;
  let c = findClient(p);
  const now = Date.now();
  if (!c) {
    c = { id: crypto.randomUUID(), phone: p, name: name || "", tags: [], stage: "Novo", notes: "", createdAt: now, updatedAt: now };
    clients.push(c);
  } else if (name && !c.name) {
    c.name = name;
  }
  return c;
}
/** Registra que os contatos receberam um disparo (preenche a base automaticamente). */
function recordClientsSent(list) {
  if (!Array.isArray(list)) return;
  const now = Date.now();
  list.forEach((ct) => {
    const c = upsertClient(ct.phone, ct.name);
    if (c) {
      c.lastSentAt = now;
      c.updatedAt = now;
      if (!c.stage || c.stage === "Novo") c.stage = "Contatado";
    }
  });
  saveClients();
}
/** Registra que um cliente respondeu (avança a etapa). */
function recordClientReply(phone) {
  const c = upsertClient(phone);
  if (!c) return;
  c.lastReplyAt = Date.now();
  c.updatedAt = Date.now();
  if (c.stage === "Novo" || c.stage === "Contatado") c.stage = "Respondeu";
  saveClients();
}
loadClients();

// ---------------------------------------------------------------------------
// Chatbot por regras (data/chatbot.json)
// ---------------------------------------------------------------------------
const CHATBOT_FILE = path.join(DATA_DIR, "chatbot.json");
let chatbot = { enabled: false, rules: [], fallback: { enabled: false, reply: "" } };
const autoReplyCooldown = new Map(); // anti-spam por número

function loadChatbot() {
  try {
    if (fs.existsSync(CHATBOT_FILE)) chatbot = JSON.parse(fs.readFileSync(CHATBOT_FILE, "utf8"));
  } catch {
    chatbot = { enabled: false, rules: [], fallback: { enabled: false, reply: "" } };
  }
}
function saveChatbot() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CHATBOT_FILE, JSON.stringify(chatbot, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar o chatbot:", err.message);
  }
}
loadChatbot();

/** Encontra a resposta automática para um texto recebido (ou null). */
function findChatbotReply(text) {
  if (!chatbot.enabled) return null;
  const msg = String(text || "").trim().toLowerCase();
  if (!msg) return null;
  for (const r of chatbot.rules || []) {
    if (r.active === false) continue;
    const kws = (r.keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean);
    const hit = kws.some((k) => {
      if (r.matchType === "exact") return msg === k;
      if (r.matchType === "starts") return msg.startsWith(k);
      return msg.includes(k);
    });
    if (hit) return r.reply;
  }
  if (chatbot.fallback?.enabled && chatbot.fallback.reply) return chatbot.fallback.reply;
  return null;
}

/** Envia a resposta automática (usa credenciais do .env, com anti-spam). */
async function sendAutoReply(phone, text) {
  const creds = resolveCredentials({});
  if (!creds.instanceId || !creds.instanceToken || !text) return;
  const p = onlyDigits(phone);
  const now = Date.now();
  if (autoReplyCooldown.get(p) && now - autoReplyCooldown.get(p) < 8000) return;
  autoReplyCooldown.set(p, now);
  try {
    await axios.post(
      `${zapiBaseUrl(creds)}/send-text`,
      { phone: p, message: text },
      { headers: zapiHeaders(creds), timeout: 20000 }
    );
  } catch (err) {
    console.error("Falha na resposta automática:", err.response?.data?.error || err.message);
  }
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

// Lê a planilha e devolve a lista de contatos para pré-visualização
app.post("/api/contacts", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo Excel enviado." });
    }
    const contacts = parseContactsFromBuffer(req.file.buffer);
    const valid = contacts.filter((c) => c.phone);
    const invalid = contacts.filter((c) => !c.phone);
    res.json({ total: contacts.length, valid, invalid });
  } catch (err) {
    res.status(500).json({ error: "Falha ao ler a planilha: " + err.message });
  }
});

// Testa a conexão com a Z-API
app.post("/api/test-connection", async (req, res) => {
  const creds = resolveCredentials(req.body);
  if (!creds.instanceId || !creds.instanceToken) {
    return res.status(400).json({ ok: false, error: "Informe o ID e o Token da instância." });
  }
  try {
    const url = `${zapiBaseUrl(creds)}/status`;
    const { data } = await axios.get(url, { headers: zapiHeaders(creds), timeout: 15000 });
    res.json({ ok: true, status: data });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.response?.data?.error || err.response?.data?.message || err.message,
      details: err.response?.data,
    });
  }
});

/** Envia uma única mensagem (texto ou imagem) para um número. */
async function sendOne(creds, contact, { message, imageUrl, imageBase64, images }) {
  const text = applyTemplate(message, contact);

  // Reúne as imagens (array novo) com compatibilidade ao formato antigo
  let imgs = [];
  if (Array.isArray(images)) imgs = images.filter(Boolean);
  else if (imageUrl) imgs = [imageUrl];
  else if (imageBase64) imgs = [imageBase64];
  imgs = imgs.slice(0, 3);

  // Apenas texto
  if (imgs.length === 0) {
    const { data } = await axios.post(
      `${zapiBaseUrl(creds)}/send-text`,
      { phone: contact.phone, message: text },
      { headers: zapiHeaders(creds), timeout: 30000 }
    );
    return data;
  }

  // Uma ou mais imagens: a legenda (texto) vai na primeira
  const results = [];
  for (let i = 0; i < imgs.length; i++) {
    const { data } = await axios.post(
      `${zapiBaseUrl(creds)}/send-image`,
      { phone: contact.phone, image: imgs[i], caption: i === 0 ? (text || "") : "" },
      { headers: zapiHeaders(creds), timeout: 60000 }
    );
    results.push(data);
    if (i < imgs.length - 1) await sleep(800); // pequena pausa entre imagens
  }
  return results;
}

// Dispara as mensagens com streaming de progresso (Server-Sent Events estilo NDJSON)
app.post("/api/send", async (req, res) => {
  const creds = resolveCredentials(req.body);
  const { contacts, message, imageUrl, imageBase64 } = req.body;
  const images = normalizeImages(req.body.images, imageUrl, imageBase64);
  const delay = Number(req.body.delayMs ?? DEFAULT_DELAY_MS);

  if (!creds.instanceId || !creds.instanceToken) {
    return res.status(400).json({ error: "Credenciais da Z-API incompletas." });
  }
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "Lista de contatos vazia." });
  }
  if (!message && images.length === 0) {
    return res.status(400).json({ error: "Informe uma mensagem de texto e/ou ao menos uma imagem." });
  }

  // Streaming: enviamos um JSON por linha conforme o progresso avança.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");

  // Registra o envio no histórico (sem guardar base64 das imagens)
  const job = {
    id: crypto.randomUUID(),
    status: "enviando",
    immediate: true,
    createdAt: Date.now(),
    scheduledAt: Date.now(),
    startedAt: Date.now(),
    message: message || "",
    images, // usado no envio; limpo ao concluir (trimFinishedJob)
    hadImage: images.length > 0,
    imageCount: images.length,
    delayMs: delay,
    contacts,
    logs: [],
  };
  jobs.push(job);
  saveJobs();

  let success = 0;
  let failed = 0;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (!contact.phone) {
      failed++;
      job.logs.push({ phone: contact.rawPhone, name: contact.name, ok: false, error: "Número inválido" });
      res.write(JSON.stringify({ index: i, contact, ok: false, error: "Número inválido" }) + "\n");
      continue;
    }
    try {
      const result = await sendOne(creds, contact, { message, images });
      success++;
      job.logs.push({ phone: contact.phone, name: contact.name, ok: true });
      res.write(JSON.stringify({ index: i, contact, ok: true, result }) + "\n");
    } catch (err) {
      failed++;
      const error = err.response?.data?.error || err.response?.data?.message || err.message;
      job.logs.push({ phone: contact.phone, name: contact.name, ok: false, error });
      res.write(JSON.stringify({ index: i, contact, ok: false, error }) + "\n");
    }

    job.result = { success, failed, total: contacts.length };
    // Aguarda o intervalo entre os envios (menos no último)
    if (i < contacts.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }

  job.status = "concluido";
  job.finishedAt = Date.now();
  job.result = { success, failed, total: contacts.length };
  saveJobs();
  recordCampaign(success, failed);
  recordClientsSent(contacts);

  res.write(JSON.stringify({ done: true, success, failed, total: contacts.length }) + "\n");
  res.end();
});

// Cria um agendamento de disparo
app.post("/api/schedule", (req, res) => {
  const creds = resolveCredentials(req.body);
  const { contacts, message, imageUrl, imageBase64, scheduledAt } = req.body;
  const images = normalizeImages(req.body.images, imageUrl, imageBase64);
  const delayMs = Number(req.body.delayMs ?? DEFAULT_DELAY_MS);

  if (!creds.instanceId || !creds.instanceToken) {
    return res.status(400).json({ error: "Credenciais da Z-API incompletas." });
  }
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "Lista de contatos vazia." });
  }
  if (!message && images.length === 0) {
    return res.status(400).json({ error: "Informe uma mensagem de texto e/ou ao menos uma imagem." });
  }
  const when = Number(scheduledAt);
  if (!when || Number.isNaN(when)) {
    return res.status(400).json({ error: "Data/horário do agendamento inválido." });
  }
  if (when < Date.now() - 60000) {
    return res.status(400).json({ error: "O horário do agendamento já passou." });
  }

  const job = {
    id: crypto.randomUUID(),
    status: "pendente",
    createdAt: Date.now(),
    scheduledAt: when,
    credentials: creds,
    contacts,
    message: message || "",
    images,
    imageCount: images.length,
    delayMs,
  };
  jobs.push(job);
  saveJobs();
  res.json({ ok: true, job: publicJob(job) });
});

// Lista os agendamentos (mais recentes primeiro)
app.get("/api/schedules", (req, res) => {
  const list = [...jobs].sort((a, b) => b.createdAt - a.createdAt).map(publicJob);
  res.json({ jobs: list });
});

// Detalhe de um agendamento (inclui o log de envios + quem respondeu)
app.get("/api/schedules/:id", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Agendamento não encontrado." });
  const since = job.startedAt || job.createdAt || 0;
  const repliedSet = new Set(
    metrics.responses.filter((r) => r.ts >= since).map((r) => r.phone)
  );
  const logs = (job.logs || []).map((l) => ({
    ...l,
    replied: repliedSet.has(String(l.phone || "").replace(/\D/g, "")),
  }));
  res.json({ job: { ...publicJob(job), logs } });
});

// Limpa o histórico (remove os já finalizados; mantém pendentes/em andamento)
app.delete("/api/schedules", (req, res) => {
  const before = jobs.length;
  jobs = jobs.filter((j) => j.status === "pendente" || j.status === "enviando");
  saveJobs();
  res.json({ ok: true, removed: before - jobs.length });
});

// Cancela um agendamento pendente
app.delete("/api/schedules/:id", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Agendamento não encontrado." });
  if (job.status !== "pendente") {
    return res.status(400).json({ error: "Só é possível cancelar agendamentos pendentes." });
  }
  job.status = "cancelado";
  saveJobs();
  res.json({ ok: true });
});

// --- Métricas ---
app.get("/api/metrics", (req, res) => {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  res.json({
    hoje: summarizeMetrics(startToday),
    mes: summarizeMetrics(startMonth),
  });
});

// Lista as respostas recebidas (caixa de entrada do dashboard)
app.get("/api/responses", (req, res) => {
  const list = [...metrics.responses].sort((a, b) => b.ts - a.ts).slice(0, 300);
  res.json({ responses: list, total: metrics.responses.length });
});

// --- Modelos de mensagem ---
app.get("/api/templates", (req, res) => res.json({ templates }));

app.post("/api/templates", (req, res) => {
  const { name, message, imageUrl } = req.body || {};
  // Até 3 URLs de imagem (compatível com o campo antigo imageUrl)
  let imageUrls = Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : (imageUrl ? [imageUrl] : []);
  imageUrls = imageUrls.filter((u) => typeof u === "string" && u.trim()).slice(0, 3).map((u) => u.slice(0, 1000));
  if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome ao modelo." });
  if (!message && imageUrls.length === 0) return res.status(400).json({ error: "O modelo precisa de texto ou imagem." });
  if (templates.length >= MAX_TEMPLATES) {
    return res.status(400).json({ error: `Limite de ${MAX_TEMPLATES} modelos atingido. Exclua algum para salvar outro.` });
  }
  const template = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40),
    message: (message || "").slice(0, 5000),
    imageUrls,
  };
  templates.push(template);
  saveTemplates();
  res.json({ ok: true, template });
});

app.delete("/api/templates/:id", (req, res) => {
  const before = templates.length;
  templates = templates.filter((t) => t.id !== req.params.id);
  saveTemplates();
  res.json({ ok: before !== templates.length });
});

// --- CRM-lite: clientes ---
app.get("/api/clients", (req, res) => {
  const search = String(req.query.search || "").trim().toLowerCase();
  const tag = String(req.query.tag || "");
  const stage = String(req.query.stage || "");
  let list = clients.filter((c) => {
    if (stage && c.stage !== stage) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    if (search && !`${c.name} ${c.phone}`.toLowerCase().includes(search)) return false;
    return true;
  });
  list = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 1000);
  res.json({ clients: list, total: clients.length, shown: list.length });
});

app.get("/api/clients/meta", (req, res) => {
  const tagSet = new Set();
  const stageCount = {};
  clients.forEach((c) => {
    (c.tags || []).forEach((t) => tagSet.add(t));
    stageCount[c.stage] = (stageCount[c.stage] || 0) + 1;
  });
  res.json({ stages: CRM_STAGES, tags: [...tagSet].sort(), stageCount, total: clients.length });
});

app.patch("/api/clients/:id", (req, res) => {
  const c = clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  const { name, stage, tags, notes } = req.body || {};
  if (typeof name === "string") c.name = name.slice(0, 80);
  if (typeof stage === "string" && stage) c.stage = stage.slice(0, 40);
  if (Array.isArray(tags)) c.tags = tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 20);
  if (typeof notes === "string") c.notes = notes.slice(0, 1000);
  c.updatedAt = Date.now();
  saveClients();
  res.json({ ok: true, client: c });
});

app.delete("/api/clients/:id", (req, res) => {
  const before = clients.length;
  clients = clients.filter((c) => c.id !== req.params.id);
  saveClients();
  res.json({ ok: before !== clients.length });
});

// --- Chatbot por regras ---
app.get("/api/chatbot", (req, res) => res.json(chatbot));

app.put("/api/chatbot", (req, res) => {
  const b = req.body || {};
  chatbot = {
    enabled: !!b.enabled,
    rules: Array.isArray(b.rules) ? b.rules.slice(0, 30).map((r) => ({
      id: r.id || crypto.randomUUID(),
      keywords: Array.isArray(r.keywords)
        ? r.keywords.map((k) => String(k).trim().slice(0, 40)).filter(Boolean).slice(0, 15)
        : [],
      reply: String(r.reply || "").slice(0, 2000),
      matchType: ["contains", "exact", "starts"].includes(r.matchType) ? r.matchType : "contains",
      active: r.active !== false,
    })) : [],
    fallback: {
      enabled: !!(b.fallback && b.fallback.enabled),
      reply: String(b.fallback?.reply || "").slice(0, 2000),
    },
  };
  saveChatbot();
  res.json({ ok: true, chatbot });
});

// --- Webhook da Z-API (respostas recebidas) ---
app.post("/api/webhook", (req, res) => {
  try {
    const b = req.body || {};
    const phone = b.phone || b.participantPhone || b.connectedPhone;
    const fromMe = b.fromMe === true;
    // Conta apenas mensagens RECEBIDAS (resposta do contato, não enviadas por nós)
    if (phone && !fromMe) {
      const content = b.text?.message || b.message || b.body || b.caption || "";
      recordResponse(phone, Date.now(), content);
      recordClientReply(phone); // atualiza a etapa do cliente no CRM
      // Resposta automática (chatbot por regras), personalizada com {{nome}}
      const reply = findChatbotReply(content);
      if (reply) {
        const cli = findClient(phone);
        sendAutoReply(phone, applyTemplate(reply, { name: cli?.name || "" }));
      }
    }
  } catch (err) {
    console.error("Erro no webhook:", err.message);
  }
  res.json({ ok: true });
});

// Configurações públicas para o frontend
app.get("/api/config", (req, res) => {
  res.json({
    appName: "ZapFlow",
    hasEnvCredentials: Boolean(process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_INSTANCE_TOKEN),
    defaultDelaySeconds: Math.max(1, Math.round(DEFAULT_DELAY_MS / 1000)) || 3,
    authEnabled: AUTH_ENABLED,
  });
});

app.listen(PORT, () => {
  console.log(`\n  ZapFlow rodando em: http://localhost:${PORT}` +
    (AUTH_ENABLED ? "  (login ativado)" : "  (login desativado)") + "\n");
});
