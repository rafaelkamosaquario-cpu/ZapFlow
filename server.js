import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import axios from "axios";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { supabaseEnabled, projectRef } from "./db/supabase.js";
import * as repo from "./db/repositories.js";
import { checkDatabase } from "./db/health.js";
import * as googleClient from "./lib/googleClient.js";
import * as openaiClient from "./lib/openaiClient.js";
import { montarInput } from "./lib/ai/systemPrompt.js";
import { FERRAMENTAS_DEFINICOES, criarExecutores } from "./lib/ai/tools.js";

dotenv.config();

// Modo de persistência: Supabase (quando as variáveis estão configuradas) ou
// arquivos locais (comportamento anterior, modo legado de desenvolvimento
// single-tenant, sem conceito de empresa/usuário).
const USE_SUPABASE = supabaseEnabled;
// Estado da base: em modo arquivos já está pronto; em modo Supabase só fica
// pronto após confirmar conectividade. Usado pelo health check e pelo agendador.
let dbReady = !USE_SUPABASE;
let dbLastError = null;

// Blindagem: um erro isolado (webhook estranho, falha de rede, agendador)
// NÃO pode derrubar o servidor inteiro e travar o deploy. Apenas registra.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason && reason.stack ? reason.stack : reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_DELAY_MS = Number(process.env.DEFAULT_DELAY_MS || 3000);
// Piso de segurança: intervalos menores que isso aumentam muito o risco de
// bloqueio do número pelo WhatsApp. Vale tanto para o padrão quanto para
// qualquer valor de delayMs enviado pelo cliente (/api/send, /api/schedule).
const MIN_DELAY_MS = 8000;
function resolveDelayMs(raw) {
  const n = Number(raw ?? DEFAULT_DELAY_MS);
  return Number.isFinite(n) && n >= MIN_DELAY_MS ? n : MIN_DELAY_MS;
}

// Diretório de dados (modo arquivos/legado — para persistir agendamentos,
// métricas e modelos de UMA única empresa local). Em produção (Railway) com
// Supabase configurado, este modo nunca é usado.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const METRICS_FILE = path.join(DATA_DIR, "metrics.json");
const TEMPLATES_FILE = path.join(DATA_DIR, "templates.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const AGENDA_FILE = path.join(DATA_DIR, "agenda.json");
const CONVERSAS_FILE = path.join(DATA_DIR, "conversas.json");
const CHATBOT_FILE = path.join(DATA_DIR, "chatbot.json");
const CRM_STAGES = ["Novo", "Contatado", "Respondeu", "Negociando", "Fechado", "Perdido"];
// Abaixo disso, "melhor horário/dia" é ruído estatístico, não conclusão confiável.
const AMOSTRA_MINIMA_MELHOR_HORARIO = 5;
// Tamanho de página nas listas paginadas (Clientes, Agenda, Conversas, Respostas).
const PAGE_SIZE = 100;
const MAX_TEMPLATES = 10;
const CONV_MAX = 5000;
const CAMPAIGN_WINDOW = 30 * 24 * 3600 * 1000; // 30 dias

const SESSION_HOURS = 8;

// --- Autenticação legada (modo arquivos, dev local, opcional via .env) ---
const APP_USER = process.env.APP_USER || "";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const AUTH_ENABLED = Boolean(APP_USER && APP_PASSWORD);
const LEGACY_AUTH_SECRET = crypto.createHash("sha256").update("zapflow:" + APP_PASSWORD).digest();

function makeLegacyToken() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const sig = crypto.createHmac("sha256", LEGACY_AUTH_SECRET).update(String(exp)).digest("hex");
  return Buffer.from(`${exp}.${sig}`).toString("base64url");
}
function isLegacyAuthed(req) {
  if (!AUTH_ENABLED) return true;
  const token = parseCookies(req).zapflow_session || "";
  try {
    const [exp, sig] = Buffer.from(token, "base64url").toString().split(".");
    if (!exp || !sig) return false;
    const expect = crypto.createHmac("sha256", LEGACY_AUTH_SECRET).update(exp).digest("hex");
    return sig === expect && Number(exp) > Date.now();
  } catch {
    return false;
  }
}

// --- Autenticação real (modo Supabase — login por empresa, papéis owner/vendedor) ---
if (USE_SUPABASE && !process.env.SESSION_SECRET) {
  console.error(
    "[boot] SESSION_SECRET é obrigatório quando o Supabase está configurado.\n" +
    "       Gere um valor aleatório (32+ bytes) e defina essa variável de ambiente antes de subir o servidor."
  );
  process.exit(1);
}
const SESSION_SECRET_BUF = crypto.createHash("sha256")
  .update(process.env.SESSION_SECRET || "dev-only-insecure-secret")
  .digest();

function makeSessionToken({ uid, empresaId, role, name }) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = JSON.stringify({ uid, empresaId, role, name, exp });
  const sig = crypto.createHmac("sha256", SESSION_SECRET_BUF).update(payload).digest("hex");
  return Buffer.from(payload + "|" + sig).toString("base64url");
}
function validSessionToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const sep = decoded.lastIndexOf("|");
    if (sep < 0) return null;
    const payloadStr = decoded.slice(0, sep);
    const sig = decoded.slice(sep + 1);
    const expect = crypto.createHmac("sha256", SESSION_SECRET_BUF).update(payloadStr).digest("hex");
    if (sig !== expect) return null;
    const payload = JSON.parse(payloadStr);
    if (!payload.exp || Number(payload.exp) <= Date.now()) return null;
    return { uid: payload.uid, empresaId: payload.empresaId, role: payload.role, name: payload.name || "" };
  } catch {
    return null;
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
function resolveSession(req) {
  return validSessionToken(parseCookies(req).zapflow_session || "");
}

// ---------------------------------------------------------------------------
// TenantState: cada empresa tem sua própria cópia em memória de tudo (mesmo
// padrão de antes, só que por empresa em vez de global). Em modo arquivos
// (legado, sem Supabase) existe UM único tenant fixo, carregado no boot.
// ---------------------------------------------------------------------------
function createEmptyTenantState() {
  return {
    clients: [], jobs: [], agenda: [], conversas: [], templates: [],
    chatbot: { enabled: false, rules: [], fallback: { enabled: false, reply: "" } },
    metrics: { sends: [], responses: [], campaigns: 0 },
    autoReplyCooldown: new Map(),
    empresa: null, // { id, name, active, maxVendedores, webhookSecret, zapiInstanceId, zapiInstanceToken, zapiClientToken } (só em modo Supabase)
  };
}
let fileTenantState = null; // modo arquivos (legado)
const tenants = new Map(); // modo Supabase: empresaId -> TenantState

/** Carrega (ou reaproveita do cache) o estado completo de uma empresa. */
async function getTenant(empresaId) {
  if (tenants.has(empresaId)) return tenants.get(empresaId);
  const empresa = await repo.empresasRepo.getById(empresaId);
  if (!empresa || !empresa.active) {
    const err = new Error("Empresa inválida ou inativa.");
    err.code = "EMPRESA_INVALIDA";
    throw err;
  }
  const all = await repo.loadEverything(empresaId);
  const t = createEmptyTenantState();
  t.jobs = all.jobs;
  t.agenda = all.agenda;
  t.clients = all.clients;
  t.conversas = all.conversas;
  t.templates = all.templates;
  t.chatbot = all.chatbot;
  t.metrics = { sends: all.sends, responses: all.responses, campaigns: all.sends.length };
  t.empresa = empresa;
  await migrateClients(t);
  for (const j of marcarJobsInterrompidos(t)) await saveJobs(t, j);
  tenants.set(empresaId, t);
  return t;
}

app.use(express.json({ limit: "50mb" }));

// Middleware de autenticação. Libera: login, assets da tela de login, o
// placeholder do vendedor, healthcheck e o webhook (a Z-API não autentica
// por cookie — cada empresa tem sua própria URL com segredo próprio).
const PUBLIC_PATHS = new Set([
  "/login", "/login.html", "/login.js",
  "/style.css", "/zappy.svg", "/icon.svg", "/logo.svg",
  "/theme.js", "/icons.js",
  "/manifest.json", "/sw.js", "/favicon.ico",
]);
const VENDEDOR_ALLOWED_PATHS = new Set(["/vendedor.html", "/visitas.js"]);
const VENDEDOR_ALLOWED_PREFIXES = ["/api/visitas", "/api/logout", "/api/config"];

app.use(async (req, res, next) => {
  const p = req.path;
  if (p.startsWith("/api/webhook/")) return next();
  if (PUBLIC_PATHS.has(p) || p === "/api/login" || p === "/api/logout" || p === "/api/health/database") {
    return next();
  }

  if (!USE_SUPABASE) {
    // Modo legado (dev local, sem banco): 1 empresa fixa, auth opcional.
    if (AUTH_ENABLED && !isLegacyAuthed(req)) {
      if (p.startsWith("/api/")) return res.status(401).json({ error: "Não autenticado." });
      return res.redirect("/login");
    }
    req.tenant = fileTenantState;
    req.session = { role: "owner" };
    return next();
  }

  // Modo Supabase: login sempre obrigatório (existem senhas de clientes reais).
  const session = resolveSession(req);
  if (!session) {
    if (p.startsWith("/api/")) return res.status(401).json({ error: "Não autenticado." });
    return res.redirect("/login");
  }
  if (session.role === "vendedor") {
    const allowed = VENDEDOR_ALLOWED_PATHS.has(p) || VENDEDOR_ALLOWED_PREFIXES.some((pre) => p.startsWith(pre));
    if (!allowed) {
      if (p.startsWith("/api/")) return res.status(403).json({ error: "Acesso restrito." });
      return res.redirect("/vendedor.html");
    }
  }
  try {
    req.tenant = await getTenant(session.empresaId);
    req.session = session;
  } catch (err) {
    console.error("[tenant]", err.message);
    return res.status(503).json({ error: "Não foi possível carregar os dados da empresa." });
  }
  return next();
});

app.get("/login", (req, res) => {
  if (!USE_SUPABASE) {
    if (AUTH_ENABLED && isLegacyAuthed(req)) return res.redirect("/");
  } else {
    const s = resolveSession(req);
    if (s) return res.redirect(s.role === "vendedor" ? "/vendedor.html" : "/");
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", async (req, res) => {
  const { user, password } = req.body || {};
  if (!USE_SUPABASE) {
    if (!AUTH_ENABLED) return res.json({ ok: true, role: "owner" });
    if (user === APP_USER && password === APP_PASSWORD) {
      res.cookie("zapflow_session", makeLegacyToken(), {
        httpOnly: true, sameSite: "lax", maxAge: SESSION_HOURS * 3600 * 1000,
      });
      return res.json({ ok: true, role: "owner" });
    }
    return res.status(401).json({ ok: false, error: "Usuário ou senha incorretos." });
  }
  try {
    const found = await repo.usuariosRepo.findByUsername(user || "");
    if (!found || !found.active) return res.status(401).json({ ok: false, error: "Usuário ou senha incorretos." });
    const match = await bcrypt.compare(String(password || ""), found.passwordHash);
    if (!match) return res.status(401).json({ ok: false, error: "Usuário ou senha incorretos." });
    const empresa = await repo.empresasRepo.getById(found.empresaId);
    if (!empresa || !empresa.active) return res.status(401).json({ ok: false, error: "Empresa inativa. Fale com o suporte." });
    res.cookie("zapflow_session", makeSessionToken({ uid: found.id, empresaId: empresa.id, role: found.role, name: found.name }), {
      httpOnly: true, sameSite: "lax", maxAge: SESSION_HOURS * 3600 * 1000,
    });
    return res.json({ ok: true, role: found.role });
  } catch (err) {
    console.error("[login]", err.message);
    return res.status(500).json({ ok: false, error: "Erro ao entrar. Tente novamente." });
  }
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
 * Chave canônica de telefone para COMPARAÇÃO/dedup.
 * Iguala números BR com e sem o nono dígito (ex.: 5542998582489 == 554298582489):
 * remove não-dígitos, garante DDI 55 e remove o "9" extra após o DDD.
 * Usada em CRM, respostas, campanhas, follow-up e webhook — nunca para envio.
 */
function phoneKey(raw) {
  let d = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return "";
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    let rest = d.slice(4);
    // Celular com 9 dígitos começando por 9 → remove o 9 para a forma canônica
    if (rest.length === 9 && rest[0] === "9") rest = rest.slice(1);
    return "55" + ddd + rest;
  }
  return d;
}

/**
 * Resolve as credenciais da Z-API.
 *
 * Modo multiempresa (tenant.empresa existe): a credencial é SEMPRE a da
 * própria empresa autenticada, nunca a enviada no corpo da requisição e
 * nunca uma variável de ambiente global — evita que um navegador com dado
 * salvo de outra sessão/empresa sobreponha a credencial correta, e evita
 * que empresas sem credencial própria caiam num fallback compartilhado.
 *
 * Modo arquivo/legado (sem empresa, dev single-tenant): mantém o
 * comportamento anterior, corpo da requisição > variável de ambiente.
 */
function resolveCredentials(tenant, body = {}) {
  const empresa = tenant?.empresa;
  if (empresa) {
    return {
      instanceId: (empresa.zapiInstanceId || "").trim(),
      instanceToken: (empresa.zapiInstanceToken || "").trim(),
      clientToken: (empresa.zapiClientToken || "").trim(),
    };
  }
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
    const phoneKeyCol = findKey(row, phoneKeys);
    const nameKeyCol = findKey(row, nameKeys);
    const rawPhone = phoneKeyCol ? row[phoneKeyCol] : Object.values(row)[0];
    const phone = normalizePhone(rawPhone);
    const name = nameKeyCol ? String(row[nameKeyCol]).trim() : "";
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
async function loadJobs(tenant) {
  if (USE_SUPABASE) { tenant.jobs = await repo.campanhasRepo.loadAll(tenant.empresa.id); return; }
  try {
    if (fs.existsSync(JOBS_FILE)) tenant.jobs = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
  } catch (err) {
    console.error("Não foi possível carregar os agendamentos:", err.message);
    tenant.jobs = [];
  }
}

// `one` (opcional): grava só aquele job (mais leve durante o disparo).
async function saveJobs(tenant, one) {
  if (USE_SUPABASE) {
    if (one) await repo.campanhasRepo.upsertOne(tenant.empresa.id, one);
    else await repo.campanhasRepo.upsertMany(tenant.empresa.id, tenant.jobs);
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(JOBS_FILE, JSON.stringify(tenant.jobs, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar os agendamentos:", err.message);
  }
}

/** Conta quantos contatos da campanha responderam (após o disparo). */
function countReplies(tenant, job) {
  if (!job.logs?.length) return 0;
  const since = job.startedAt || job.createdAt || 0;
  const replied = new Set(tenant.metrics.responses.filter((r) => r.ts >= since).map((r) => phoneKey(r.phone)));
  let n = 0;
  for (const l of job.logs) {
    if (l.ok && replied.has(phoneKey(l.phone))) n++;
  }
  return n;
}

/** Versão segura para o cliente: sem credenciais nem conteúdo pesado. */
function publicJob(tenant, job) {
  return {
    id: job.id,
    name: job.name || job.label || null,
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
    repliedCount: countReplies(tenant, job),
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

/** Envia uma única mensagem (texto ou imagem) para um número. */
async function sendOne(creds, contact, { message, imageUrl, imageBase64, images }) {
  const text = applyTemplate(message, contact);
  const imgs = normalizeImages(images, imageUrl, imageBase64); // até 3
  const results = [];

  // 1) Texto como mensagem NORMAL (largura cheia, não como legenda de imagem)
  if (text) {
    const { data } = await axios.post(
      `${zapiBaseUrl(creds)}/send-text`,
      { phone: contact.phone, message: text },
      { headers: zapiHeaders(creds), timeout: 30000 }
    );
    results.push(data);
    if (imgs.length) await sleep(800);
  }

  // 2) Imagens enviadas em seguida, SEM legenda (cada uma é uma mensagem)
  for (let i = 0; i < imgs.length; i++) {
    const { data } = await axios.post(
      `${zapiBaseUrl(creds)}/send-image`,
      { phone: contact.phone, image: imgs[i], caption: "" },
      { headers: zapiHeaders(creds), timeout: 60000 }
    );
    results.push(data);
    if (i < imgs.length - 1) await sleep(800); // pequena pausa entre imagens
  }

  return results;
}

/** Executa um agendamento (envia para todos os contatos do job). */
async function runJob(tenant, job) {
  job.status = "enviando";
  job.startedAt = Date.now();
  job.logs = [];
  let success = 0;
  let failed = 0;
  // Credenciais: as do job (envio imediato) ou, se ausentes (ex.: agendamento
  // retomado após novo deploy), as da empresa/ambiente. Tokens não ficam no banco.
  const creds = job.credentials || resolveCredentials(tenant, {});
  await saveJobs(tenant, job);

  for (let i = 0; i < job.contacts.length; i++) {
    const contact = job.contacts[i];
    if (!contact.phone) {
      failed++;
      job.logs.push({ phone: contact.rawPhone, name: contact.name, ok: false, error: "Número inválido" });
    } else {
      try {
        await sendOne(creds, contact, job);
        success++;
        job.logs.push({ phone: contact.phone, name: contact.name, ok: true });
      } catch (err) {
        failed++;
        const error = err.response?.data?.error || err.response?.data?.message || err.message;
        job.logs.push({ phone: contact.phone, name: contact.name, ok: false, error });
      }
    }
    job.result = { success, failed, total: job.contacts.length };
    await saveJobs(tenant, job);
    if (i < job.contacts.length - 1 && job.delayMs > 0) {
      await sleep(job.delayMs);
    }
  }

  job.status = "concluido";
  job.finishedAt = Date.now();
  const label = job.name || campaignLabel(job.message, job.hadImage || job.images?.length);
  job.label = label;
  await recordClientsSent(tenant, job.contacts, label);
  trimFinishedJob(job);
  await saveJobs(tenant, job);
  if (USE_SUPABASE) await repo.destinatariosRepo.replaceForCampaign(tenant.empresa.id, job.id, job.logs);
  await recordCampaign(tenant, success, failed, label);
  console.log(`Agendamento ${job.id} concluído (empresa ${tenant.empresa?.id || "local"}): ${success} ok / ${failed} falhas.`);
}

// Verifica periodicamente se há agendamentos vencidos para disparar, em
// TODAS as empresas (modo Supabase) sem precisar carregar todas na memória.
let schedulerRunning = false;
async function schedulerTick() {
  if (schedulerRunning || !dbReady) return;
  schedulerRunning = true;
  try {
    if (!USE_SUPABASE) {
      const tenant = fileTenantState;
      if (!tenant) return;
      const now = Date.now();
      const due = tenant.jobs.filter((j) => j.status === "pendente" && j.scheduledAt <= now);
      for (const job of due) {
        try { await runJob(tenant, job); }
        catch (err) { job.status = "erro"; job.error = err.message; await saveJobs(tenant, job); }
      }
      return;
    }
    const due = await repo.campanhasRepo.loadDueAcrossEmpresas();
    if (!due.length) return;
    for (const row of due) {
      try {
        const tenant = await getTenant(row.empresa_id);
        const job = tenant.jobs.find((j) => j.id === row.id);
        if (job && job.status === "pendente") await runJob(tenant, job);
      } catch (err) {
        console.error("[scheduler]", row.id, err.message);
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------
async function loadMetrics(tenant) {
  if (USE_SUPABASE) {
    const [sends, responses] = await Promise.all([
      repo.metricasRepo.loadAll(tenant.empresa.id),
      repo.respostasRepo.loadAll(tenant.empresa.id),
    ]);
    tenant.metrics = { sends, responses, campaigns: sends.length };
    return;
  }
  try {
    if (fs.existsSync(METRICS_FILE)) tenant.metrics = JSON.parse(fs.readFileSync(METRICS_FILE, "utf8"));
  } catch {
    tenant.metrics = { sends: [], responses: [], campaigns: 0 };
  }
}
// Modo arquivo: grava o metrics.json. Modo Supabase: no-op (os inserts pontuais
// em recordCampaign/recordResponse já persistiram cada registro).
function saveMetricsFile(tenant) {
  if (USE_SUPABASE) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(METRICS_FILE, JSON.stringify(tenant.metrics));
  } catch (err) {
    console.error("Não foi possível salvar as métricas:", err.message);
  }
}
/** Rótulo automático de uma campanha (1ª linha da mensagem ou "com imagem"). */
function campaignLabel(message, hasImage) {
  const t = String(message || "").trim().split("\n")[0].trim();
  if (t) return t.slice(0, 40);
  return hasImage ? "Campanha com imagem" : "Campanha";
}
async function recordCampaign(tenant, sent, failed, name = "Campanha", ts = Date.now()) {
  const row = { ts, sent, failed, name };
  tenant.metrics.sends.push(row);
  tenant.metrics.campaigns = (tenant.metrics.campaigns || 0) + 1;
  if (USE_SUPABASE) await repo.metricasRepo.insertOne(tenant.empresa.id, row);
  else saveMetricsFile(tenant);
}
async function recordResponse(tenant, phone, ts = Date.now(), content = "", externalId = null) {
  const row = {
    phone: String(phone || "").replace(/\D/g, ""),
    key: phoneKey(phone),
    ts,
    content: String(content || "").slice(0, 200),
  };
  tenant.metrics.responses.push(row);
  if (USE_SUPABASE) await repo.respostasRepo.insertOne(tenant.empresa.id, row, externalId);
  else saveMetricsFile(tenant);
}
function summarizeMetrics(tenant, from) {
  const sends = tenant.metrics.sends.filter((s) => s.ts >= from);
  const responses = tenant.metrics.responses.filter((r) => r.ts >= from);
  const totalSent = sends.reduce((a, s) => a + (s.sent || 0), 0);
  const repliedNumbers = new Set(responses.map((r) => phoneKey(r.phone)));
  const replied = repliedNumbers.size;
  const semRetorno = Math.max(totalSent - replied, 0);
  const taxa = totalSent ? Math.round((replied / totalSent) * 1000) / 10 : 0;

  const hours = {};
  responses.forEach((r) => { const h = new Date(r.ts).getHours(); hours[h] = (hours[h] || 0) + 1; });
  let melhorHora = null, max = 0;
  for (const h in hours) { if (hours[h] > max) { max = hours[h]; melhorHora = Number(h); } }

  const week = [0, 0, 0, 0, 0, 0, 0]; // dom..sáb (mensagens enviadas)
  sends.forEach((s) => { week[new Date(s.ts).getDay()] += (s.sent || 0); });

  // Nomes das campanhas do período (mais recentes primeiro, sem repetir)
  const campanhaNomes = [];
  [...sends].sort((a, b) => b.ts - a.ts).forEach((s) => {
    const n = s.name || "Campanha";
    if (!campanhaNomes.includes(n)) campanhaNomes.push(n);
  });

  return { totalSent, replied, semRetorno, taxa, campanhas: sends.length, melhorHora, week, campanhaNomes };
}

// ---------------------------------------------------------------------------
// Modelos de mensagem
// ---------------------------------------------------------------------------
async function loadTemplates(tenant) {
  if (USE_SUPABASE) { tenant.templates = await repo.modelosRepo.loadAll(tenant.empresa.id); return; }
  try {
    if (fs.existsSync(TEMPLATES_FILE)) tenant.templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, "utf8"));
  } catch {
    tenant.templates = [];
  }
}
async function saveTemplates(tenant, one, removedId) {
  if (USE_SUPABASE) {
    if (removedId) await repo.modelosRepo.deleteById(tenant.empresa.id, removedId);
    else if (one) await repo.modelosRepo.upsertOne(tenant.empresa.id, one);
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(tenant.templates, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar os modelos:", err.message);
  }
}

// ---------------------------------------------------------------------------
// CRM-lite: base de clientes
// ---------------------------------------------------------------------------
async function loadClients(tenant) {
  if (USE_SUPABASE) { tenant.clients = await repo.clientesRepo.loadAll(tenant.empresa.id); return; }
  try {
    if (fs.existsSync(CLIENTS_FILE)) tenant.clients = JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf8"));
  } catch {
    tenant.clients = [];
  }
}
function saveClientsFile(tenant) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(tenant.clients, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar os clientes:", err.message);
  }
}
// `one`: grava só um cliente. `removedId`: remove um cliente. Sem args: grava todos.
async function saveClients(tenant, one, removedId) {
  if (USE_SUPABASE) {
    if (removedId) await repo.clientesRepo.deleteById(tenant.empresa.id, removedId);
    else if (one) await repo.clientesRepo.upsertOne(tenant.empresa.id, one);
    else await repo.clientesRepo.upsertMany(tenant.empresa.id, tenant.clients);
    return;
  }
  saveClientsFile(tenant);
}
function onlyDigits(p) { return String(p || "").replace(/\D/g, ""); }
/** Telefone "discável" para exibir/enviar (com DDI 55, preserva o nono dígito). */
function canonPhone(p) { return normalizePhone(p) || onlyDigits(p); }
/** Chave canônica de um cliente (compatível com registros antigos sem `key`). */
function clientKey(c) { return c.key || phoneKey(c.phone); }
function findClient(tenant, phone) {
  const k = phoneKey(phone);
  return k ? tenant.clients.find((c) => clientKey(c) === k) : null;
}
function upsertClient(tenant, phone, name, origem) {
  const k = phoneKey(phone);
  if (!k) return null;
  const display = canonPhone(phone);
  const now = Date.now();
  let c = findClient(tenant, phone);
  if (!c) {
    c = { id: crypto.randomUUID(), phone: display, key: k, name: name || "", tags: [], stage: "Novo", notes: "", origem: origem || "manual", createdAt: now, updatedAt: now };
    tenant.clients.push(c);
  } else {
    if (name && !c.name) c.name = name;
    if (!c.key) c.key = k;
    // Prefere guardar a forma com o nono dígito (mais confiável para envio)
    if (String(display).length > String(c.phone).length) c.phone = display;
  }
  return c;
}

/** Mescla clientes duplicados pela chave canônica (migração do nono dígito). */
async function migrateClients(tenant) {
  const byKey = new Map();
  const merged = [];
  const stageRank = (s) => Math.max(0, CRM_STAGES.indexOf(s));
  let changed = false;
  for (const c of tenant.clients) {
    const k = clientKey(c);
    if (!c.key) { c.key = k; changed = true; }
    if (!byKey.has(k)) {
      byKey.set(k, c);
      merged.push(c);
    } else {
      changed = true;
      const keep = byKey.get(k);
      if (!keep.name && c.name) keep.name = c.name;
      keep.tags = Array.from(new Set([...(keep.tags || []), ...(c.tags || [])]));
      if (c.notes) keep.notes = [keep.notes, c.notes].filter(Boolean).join(" | ").slice(0, 1000);
      keep.createdAt = Math.min(keep.createdAt || Date.now(), c.createdAt || Date.now());
      if (c.lastSentAt) keep.lastSentAt = Math.max(keep.lastSentAt || 0, c.lastSentAt);
      if (c.lastReplyAt) keep.lastReplyAt = Math.max(keep.lastReplyAt || 0, c.lastReplyAt);
      if (stageRank(c.stage) > stageRank(keep.stage)) keep.stage = c.stage;
      if (String(c.phone).length > String(keep.phone).length) keep.phone = c.phone;
      keep.updatedAt = Date.now();
    }
  }
  if (changed || merged.length !== tenant.clients.length) {
    tenant.clients = merged;
    await saveClients(tenant);
    console.log(`CRM: base normalizada (${tenant.clients.length} clientes únicos).`);
  }
}
/** Registra que os contatos receberam um disparo (preenche a base automaticamente). */
async function recordClientsSent(tenant, list, campaignName) {
  if (!Array.isArray(list)) return;
  const now = Date.now();
  const touched = [];
  list.forEach((ct) => {
    const c = upsertClient(tenant, ct.phone, ct.name, "campanha");
    if (c) {
      c.lastSentAt = now;
      c.updatedAt = now;
      if (campaignName) c.lastCampaignName = campaignName;
      if (!c.stage || c.stage === "Novo") c.stage = "Contatado";
      touched.push(c);
    }
  });
  if (USE_SUPABASE) await repo.clientesRepo.upsertMany(tenant.empresa.id, touched);
  else saveClientsFile(tenant);
}
/** Registra que um cliente respondeu (avança a etapa). */
async function recordClientReply(tenant, phone) {
  const c = upsertClient(tenant, phone, undefined, "conversa");
  if (!c) return;
  c.lastReplyAt = Date.now();
  c.updatedAt = Date.now();
  const etapaAnterior = c.stage;
  if (c.stage === "Novo" || c.stage === "Contatado") c.stage = "Respondeu";
  await saveClients(tenant, c);
  if (c.stage !== etapaAnterior) dispararAutomacoes(tenant, "mudanca_etapa", c.stage, c).catch(() => {});
}

// ---------------------------------------------------------------------------
// Agenda de contatos salvos
// ---------------------------------------------------------------------------
async function loadAgenda(tenant) {
  if (USE_SUPABASE) { tenant.agenda = await repo.contatosRepo.loadAll(tenant.empresa.id); return; }
  try {
    if (fs.existsSync(AGENDA_FILE)) tenant.agenda = JSON.parse(fs.readFileSync(AGENDA_FILE, "utf8"));
  } catch {
    tenant.agenda = [];
  }
}
// `one`: grava só um contato. `removedId`: remove. Sem args: grava todos.
async function saveAgenda(tenant, one, removedId) {
  if (USE_SUPABASE) {
    if (removedId) await repo.contatosRepo.deleteById(tenant.empresa.id, removedId);
    else if (one) await repo.contatosRepo.upsertOne(tenant.empresa.id, one);
    else for (const c of tenant.agenda) await repo.contatosRepo.upsertOne(tenant.empresa.id, c);
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AGENDA_FILE, JSON.stringify(tenant.agenda, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar a agenda:", err.message);
  }
}
function findAgenda(tenant, phone) {
  const k = phoneKey(phone);
  return k ? tenant.agenda.find((a) => (a.key || phoneKey(a.phone)) === k) : null;
}
function upsertAgenda(tenant, phone, name, origem) {
  const k = phoneKey(phone);
  if (!k) return null;
  let a = findAgenda(tenant, phone);
  if (!a) {
    a = { id: crypto.randomUUID(), name: (name || "").trim(), phone: canonPhone(phone), key: k, origem: origem || "manual", createdAt: Date.now() };
    tenant.agenda.push(a);
  } else {
    // Manual sobrescreve; planilha/chip só preenchem se estiver vazio
    if (name && (origem === "manual" || !a.name)) a.name = name.trim();
    if (String(canonPhone(phone)).length > String(a.phone).length) a.phone = canonPhone(phone);
  }
  return a;
}
/** Resolve o nome de um número: 1º agenda → 2º nome informado → "" (sem nome). */
function resolveName(tenant, phone, fallback) {
  const a = findAgenda(tenant, phone);
  return (a && a.name) || (fallback || "").trim() || "";
}
function inAgenda(tenant, phone) { return Boolean(findAgenda(tenant, phone)); }
/** Extrai o nome do contato vindo do WhatsApp/Z-API a partir do payload do webhook. */
function waNameFrom(b) {
  return String(
    b.senderName || b.chatName || b.notify || b.pushName || b.contactName || b.senderNotify || ""
  ).trim().slice(0, 80);
}
/** Guarda o nome recebido do WhatsApp no cliente (sem tocar em etapa ou nome de campanha). */
async function setWaName(tenant, phone, waName) {
  if (!waName) return;
  const c = findClient(tenant, phone);
  if (c && c.waName !== waName) {
    c.waName = waName;
    c.updatedAt = Date.now();
    await saveClients(tenant, c);
  }
}
/**
 * Resolve a identidade de um número seguindo a ordem de prioridade:
 * 1º nome salvo na agenda → 2º nome recebido do WhatsApp → 3º nome usado na campanha → "".
 * Devolve { name, source } onde source indica a origem real do nome.
 */
function bestName(tenant, phone, campaignFallback) {
  const a = findAgenda(tenant, phone);
  if (a && a.name) return { name: a.name, source: a.origem || "agenda" };
  const c = findClient(tenant, phone);
  if (c && c.waName) return { name: c.waName, source: "whatsapp" };
  const camp = String(campaignFallback || (c && c.name) || "").trim();
  if (camp) return { name: camp, source: "campanha" };
  return { name: "", source: "" };
}

// ---------------------------------------------------------------------------
// Conversas (caixa de entrada do dia a dia)
// ---------------------------------------------------------------------------
async function loadConversas(tenant) {
  if (USE_SUPABASE) { tenant.conversas = await repo.mensagensRepo.loadAll(tenant.empresa.id); return; }
  try {
    if (fs.existsSync(CONVERSAS_FILE)) tenant.conversas = JSON.parse(fs.readFileSync(CONVERSAS_FILE, "utf8"));
  } catch {
    tenant.conversas = [];
  }
}
function saveConversasFile(tenant) {
  if (USE_SUPABASE) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONVERSAS_FILE, JSON.stringify(tenant.conversas, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar as conversas:", err.message);
  }
}
/** Registra uma mensagem na conversa (dir: "in" recebida | "out" enviada). */
async function recordMessage(tenant, phone, text, dir, externalId = null) {
  const key = phoneKey(phone);
  if (!key) return;
  const t = String(text || "").slice(0, 1000);
  const now = Date.now();
  if (dir === "out") {
    // Evita duplicar (nosso envio + eco do webhook "enviadas por mim")
    const dup = tenant.conversas.some((m) => m.dir === "out" && m.key === key && m.text === t && now - m.ts < 60000);
    if (dup) return;
  }
  const msg = { key, phone: canonPhone(phone), text: t, ts: now, dir };
  tenant.conversas.push(msg);
  if (tenant.conversas.length > CONV_MAX) tenant.conversas = tenant.conversas.slice(-CONV_MAX);
  if (USE_SUPABASE) {
    let conversaId = null;
    try {
      conversaId = await repo.conversasRepo.upsertThread(tenant.empresa.id, {
        key, phone: msg.phone, text: t, dir, ts: now,
        origem: isCampaignOrigin(tenant, key) ? "campaign" : "daily",
      });
    } catch (e) { console.error("[Supabase] thread:", e.message); }
    const inserted = await repo.mensagensRepo.insertOne(tenant.empresa.id, msg, externalId, conversaId);
    if (inserted === false) {
      // Mensagem já existente (external_id duplicado): desfaz na memória
      const idx = tenant.conversas.lastIndexOf(msg);
      if (idx >= 0) tenant.conversas.splice(idx, 1);
    }
  } else {
    saveConversasFile(tenant);
  }
}
/** A conversa é de campanha? (o contato recebeu disparo nos últimos 30 dias) */
function isCampaignOrigin(tenant, key) {
  const c = tenant.clients.find((x) => (x.key || phoneKey(x.phone)) === key);
  return Boolean(c && c.lastSentAt && Date.now() - c.lastSentAt <= CAMPAIGN_WINDOW);
}
function campaignNameOf(tenant, key) {
  const c = tenant.clients.find((x) => (x.key || phoneKey(x.phone)) === key);
  return (c && c.lastCampaignName) || "";
}
/** Contador de conversas de hoje (total, de campanha e do dia a dia). */
function conversasSummary(tenant, from) {
  const seen = new Set();
  let campanha = 0, diaadia = 0;
  tenant.conversas.filter((m) => m.ts >= from).forEach((m) => {
    if (seen.has(m.key)) return;
    seen.add(m.key);
    if (isCampaignOrigin(tenant, m.key)) campanha++; else diaadia++;
  });
  return { total: seen.size, campanha, diaadia };
}
function conversasSummaryToday(tenant) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return conversasSummary(tenant, start.getTime());
}

// ---------------------------------------------------------------------------
// Chatbot por regras
// ---------------------------------------------------------------------------
async function loadChatbot(tenant) {
  if (USE_SUPABASE) { tenant.chatbot = await repo.automacoesRepo.load(tenant.empresa.id); return; }
  try {
    if (fs.existsSync(CHATBOT_FILE)) tenant.chatbot = JSON.parse(fs.readFileSync(CHATBOT_FILE, "utf8"));
  } catch {
    tenant.chatbot = { enabled: false, rules: [], fallback: { enabled: false, reply: "" } };
  }
}
async function saveChatbot(tenant) {
  if (USE_SUPABASE) { await repo.automacoesRepo.save(tenant.empresa.id, tenant.chatbot); return; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CHATBOT_FILE, JSON.stringify(tenant.chatbot, null, 2));
  } catch (err) {
    console.error("Não foi possível salvar o chatbot:", err.message);
  }
}

/** Encontra a resposta automática para um texto recebido (ou null). */
function findChatbotReply(tenant, text) {
  if (!tenant.chatbot.enabled) return null;
  const msg = String(text || "").trim().toLowerCase();
  if (!msg) return null;
  for (const r of tenant.chatbot.rules || []) {
    if (r.active === false) continue;
    const kws = (r.keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean);
    const hit = kws.some((k) => {
      if (r.matchType === "exact") return msg === k;
      if (r.matchType === "starts") return msg.startsWith(k);
      return msg.includes(k);
    });
    if (hit) return r.reply;
  }
  if (tenant.chatbot.fallback?.enabled && tenant.chatbot.fallback.reply) return tenant.chatbot.fallback.reply;
  return null;
}

/**
 * Automações (gatilho->ação sobre eventos do CRM/Visitas, além do chatbot por
 * palavra-chave). Chamado nos pontos onde o evento de fato acontece (mudança
 * de etapa, visita finalizada) -- nunca falha a ação principal por causa
 * disso, só loga o erro.
 */
async function dispararAutomacoes(tenant, gatilhoTipo, gatilhoValor, cliente) {
  if (!USE_SUPABASE || !cliente?.phone) return;
  try {
    const regras = await repo.automacaoRegrasRepo.listarAtivasPorGatilho(tenant.empresa.id, gatilhoTipo, gatilhoValor);
    for (const r of regras) {
      if (r.acaoTipo === "enviar_mensagem") {
        await sendAutoReply(tenant, cliente.phone, applyTemplate(r.acaoTexto, { name: cliente.name || "" }));
      } else if (r.acaoTipo === "criar_followup") {
        const data = new Date(Date.now() + (r.acaoDias ?? 1) * 86400000).toISOString().slice(0, 10);
        cliente.proximaAcaoTexto = r.acaoTexto;
        cliente.proximaAcaoData = data;
        await repo.clientesRepo.definirProximaAcao(tenant.empresa.id, cliente.id, { texto: r.acaoTexto, data });
      }
    }
  } catch (err) {
    console.error("[automacoes] disparar:", err.message);
  }
}

/** Envia a resposta automática (usa credenciais da empresa/.env, com anti-spam). */
async function sendAutoReply(tenant, phone, text) {
  const creds = resolveCredentials(tenant, {});
  if (!creds.instanceId || !creds.instanceToken || !text) return;
  const p = onlyDigits(phone);
  const now = Date.now();
  if (tenant.autoReplyCooldown.get(p) && now - tenant.autoReplyCooldown.get(p) < 8000) return;
  tenant.autoReplyCooldown.set(p, now);
  try {
    await axios.post(
      `${zapiBaseUrl(creds)}/send-text`,
      { phone: p, message: text },
      { headers: zapiHeaders(creds), timeout: 20000 }
    );
    await recordMessage(tenant, p, text, "out"); // registra na caixa de conversas
  } catch (err) {
    console.error("Falha na resposta automática:", err.response?.data?.error || err.message);
  }
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------
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
  const creds = resolveCredentials(req.tenant, req.body);
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

// Dispara as mensagens com streaming de progresso (Server-Sent Events estilo NDJSON)
app.post("/api/send", async (req, res) => {
  const tenant = req.tenant;
  const creds = resolveCredentials(tenant, req.body);
  const { contacts, message, imageUrl, imageBase64, name } = req.body;
  const images = normalizeImages(req.body.images, imageUrl, imageBase64);
  const delay = resolveDelayMs(req.body.delayMs);

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
    name: String(name || "").trim().slice(0, 120),
    message: message || "",
    images, // usado no envio; limpo ao concluir (trimFinishedJob)
    hadImage: images.length > 0,
    imageCount: images.length,
    delayMs: delay,
    contacts,
    logs: [],
  };
  tenant.jobs.push(job);
  await saveJobs(tenant, job);

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
  const label = job.name || campaignLabel(message, images.length);
  job.label = label;
  trimFinishedJob(job);
  try {
    await saveJobs(tenant, job);
    if (USE_SUPABASE) await repo.destinatariosRepo.replaceForCampaign(tenant.empresa.id, job.id, job.logs);
    await recordCampaign(tenant, success, failed, label);
    await recordClientsSent(tenant, contacts, label);
  } catch (err) {
    console.error("[persistência] Falha ao salvar o envio:", err.message);
  }

  res.write(JSON.stringify({ done: true, success, failed, total: contacts.length }) + "\n");
  res.end();
});

// Cria um agendamento de disparo
app.post("/api/schedule", async (req, res) => {
  const tenant = req.tenant;
  const creds = resolveCredentials(tenant, req.body);
  const { contacts, message, imageUrl, imageBase64, scheduledAt, name } = req.body;
  const images = normalizeImages(req.body.images, imageUrl, imageBase64);
  const delayMs = resolveDelayMs(req.body.delayMs);

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
    name: String(name || "").trim().slice(0, 120),
    contacts,
    message: message || "",
    images,
    imageCount: images.length,
    delayMs,
  };
  tenant.jobs.push(job);
  await saveJobs(tenant, job);
  res.json({ ok: true, job: publicJob(tenant, job) });
});

// Lista os agendamentos (mais recentes primeiro)
app.get("/api/schedules", (req, res) => {
  const tenant = req.tenant;
  const list = [...tenant.jobs].sort((a, b) => b.createdAt - a.createdAt).map((j) => publicJob(tenant, j));
  res.json({ jobs: list });
});

// Detalhe de um agendamento (inclui o log de envios + quem respondeu)
app.get("/api/schedules/:id", async (req, res) => {
  const tenant = req.tenant;
  const job = tenant.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Agendamento não encontrado." });
  const since = job.startedAt || job.createdAt || 0;
  const repliedSet = new Set(
    tenant.metrics.responses.filter((r) => r.ts >= since).map((r) => phoneKey(r.phone))
  );
  // Etapa atual do CRM, só pra quem respondeu -- é "estado atual do contato", não
  // "resultado causado pela campanha" (o cliente pode ter avançado por outro motivo
  // depois). A UI precisa deixar essa distinção clara, nunca afirmar causalidade.
  const clientesPorKey = new Map(tenant.clients.map((c) => [c.key || phoneKey(c.phone), c]));
  const vendedores = USE_SUPABASE ? await repo.usuariosRepo.listVendedores(tenant.empresa.id) : [];
  const nomeVendedor = (id) => vendedores.find((v) => v.id === id)?.name || null;
  const crmAposCampanha = { Negociando: 0, Fechado: 0, Perdido: 0 };
  const logs = (job.logs || []).map((l) => {
    const replied = repliedSet.has(phoneKey(l.phone));
    const cliente = replied ? clientesPorKey.get(phoneKey(l.phone)) : null;
    if (cliente && crmAposCampanha[cliente.stage] !== undefined) crmAposCampanha[cliente.stage]++;
    return {
      ...l,
      name: resolveName(tenant, l.phone, l.name),
      replied,
      stage: cliente?.stage || null,
      vendedorResponsavelNome: cliente?.vendedorResponsavelId ? nomeVendedor(cliente.vendedorResponsavelId) : null,
    };
  });
  const responderam = logs.filter((l) => l.replied).length;
  res.json({
    job: { ...publicJob(tenant, job), logs },
    crmAposCampanha: { populacao: "responderam", total: responderam, porEtapa: crmAposCampanha },
  });
});

// Limpa o histórico (remove os já finalizados; mantém pendentes/em andamento)
app.delete("/api/schedules", async (req, res) => {
  const tenant = req.tenant;
  const before = tenant.jobs.length;
  const removidos = tenant.jobs.filter((j) => j.status !== "pendente" && j.status !== "enviando");
  tenant.jobs = tenant.jobs.filter((j) => j.status === "pendente" || j.status === "enviando");
  if (USE_SUPABASE) { for (const j of removidos) await repo.campanhasRepo.deleteById(tenant.empresa.id, j.id); }
  else await saveJobs(tenant);
  res.json({ ok: true, removed: before - tenant.jobs.length });
});

// Cancela um agendamento pendente
app.delete("/api/schedules/:id", async (req, res) => {
  const tenant = req.tenant;
  const job = tenant.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Agendamento não encontrado." });
  if (job.status !== "pendente") {
    return res.status(400).json({ error: "Só é possível cancelar agendamentos pendentes." });
  }
  job.status = "cancelado";
  await saveJobs(tenant, job);
  res.json({ ok: true });
});

// --- Métricas ---
app.get("/api/metrics", (req, res) => {
  const tenant = req.tenant;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  res.json({
    hoje: summarizeMetrics(tenant, startToday),
    mes: summarizeMetrics(tenant, startMonth),
    conversasHoje: conversasSummaryToday(tenant),
  });
});

// Lista as respostas recebidas (caixa de entrada do dashboard)
app.get("/api/responses", (req, res) => {
  const tenant = req.tenant;
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const all = [...tenant.metrics.responses].sort((a, b) => b.ts - a.ts);
  const list = all
    .slice(offset, offset + PAGE_SIZE)
    .map((r) => {
      const id = bestName(tenant, r.phone, "");
      const c = findClient(tenant, r.phone);
      return {
        ...r,
        name: id.name,
        nameSource: id.source,
        inAgenda: inAgenda(tenant, r.phone),
        tags: c?.tags || [],
        stage: c?.stage || "",
      };
    });
  res.json({ responses: list, total: all.length, shown: offset + list.length, hasMore: offset + list.length < all.length });
});

// Dados agregados do dashboard de Visão Geral (por período)
app.get("/api/dashboard", (req, res) => {
  const tenant = req.tenant;
  const period = String(req.query.period || "hoje");
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let from;
  if (period === "7d") { const t = new Date(dayStart); t.setDate(t.getDate() - 6); from = t.getTime(); }
  else if (period === "30d") { const t = new Date(dayStart); t.setDate(t.getDate() - 29); from = t.getTime(); }
  else if (period === "mes") from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  else from = dayStart;

  const sends = tenant.metrics.sends.filter((s) => s.ts >= from);
  const responses = tenant.metrics.responses.filter((r) => r.ts >= from);
  const enviadas = sends.reduce((a, s) => a + (s.sent || 0), 0);
  const replied = new Set(responses.map((r) => phoneKey(r.phone))).size;
  const taxa = enviadas ? Math.round((replied / enviadas) * 1000) / 10 : 0;

  const week = [0, 0, 0, 0, 0, 0, 0];
  sends.forEach((s) => { week[new Date(s.ts).getDay()] += (s.sent || 0); });

  const hours = {};
  responses.forEach((r) => { const h = new Date(r.ts).getHours(); hours[h] = (hours[h] || 0) + 1; });
  let melhorHora = null, mx = 0;
  for (const h in hours) { if (hours[h] > mx) { mx = hours[h]; melhorHora = Number(h); } }
  // Amostra mínima: com poucas respostas, "melhor horário" é ruído, não sinal.
  if (responses.length < AMOSTRA_MINIMA_MELHOR_HORARIO) melhorHora = null;

  // Funil do CRM (contagem por etapa)
  const funilStages = ["Novo", "Contatado", "Respondeu", "Negociando", "Fechado"];
  const stageCount = {};
  tenant.clients.forEach((c) => { stageCount[c.stage] = (stageCount[c.stage] || 0) + 1; });
  const funil = funilStages.map((s) => ({ stage: s, count: stageCount[s] || 0 }));

  // Série dos últimos 30 dias (enviadas x respostas por dia)
  const labels = [], serieEnv = [], serieResp = [];
  for (let i = 29; i >= 0; i--) {
    const d0 = dayStart - i * 864e5, d1 = d0 + 864e5;
    labels.push(new Date(d0).getDate());
    serieEnv.push(tenant.metrics.sends.filter((s) => s.ts >= d0 && s.ts < d1).reduce((a, s) => a + (s.sent || 0), 0));
    serieResp.push(tenant.metrics.responses.filter((r) => r.ts >= d0 && r.ts < d1).length);
  }

  // Ranking das últimas 5 campanhas concluídas
  const ranking = tenant.jobs.filter((j) => j.status === "concluido")
    .sort((a, b) => (b.finishedAt || b.scheduledAt || 0) - (a.finishedAt || a.scheduledAt || 0))
    .slice(0, 5)
    .map((j) => {
      const env = j.result?.success || 0;
      const resp = countReplies(tenant, j);
      return { id: j.id, name: j.name || campaignLabel(j.message, j.hadImage || j.imageCount), enviadas: env, respostas: resp, taxa: env ? Math.round((resp / env) * 1000) / 10 : 0, ts: j.finishedAt || j.scheduledAt };
    });

  res.json({
    period,
    kpis: {
      enviadas,
      conversas: conversasSummary(tenant, from),
      taxa,
      clientes: tenant.clients.length,
      clientesNovos: tenant.clients.filter((c) => (c.createdAt || 0) >= from).length,
    },
    donut: { responderam: replied, semResposta: Math.max(enviadas - replied, 0) },
    weekday: week,
    serie30: { labels, enviadas: serieEnv, respostas: serieResp },
    funil,
    ranking,
    melhorHora,
  });
});

// ---------------------------------------------------------------------------
// Radar Comercial ("Precisa da sua atenção") -- regras determinísticas sobre
// dado que já existe, sem IA e sem inventar informação. Ver server.js dos
// endpoints reaproveitados (montarProximaAcao, agregarClienteDetalhe) para
// as fontes de dado originais.
// ---------------------------------------------------------------------------
const RADAR_NEGOCIACAO_PARADA_DIAS = 5; // ajustável -- sem uso real ainda pra calibrar um valor melhor

/**
 * Monta os mapas clienteId->visitas e telefone->visitas de uma única
 * passada -- reaproveitado pelo Radar e pela Reativação de Clientes Parados,
 * pra nunca duplicar a lógica de "que visitas pertencem a este cliente".
 */
function montarMapasVisitas(todasVisitas) {
  const visitasPorCliente = new Map();
  const visitasPorTelefone = new Map();
  for (const v of todasVisitas) {
    if (v.clienteId) {
      if (!visitasPorCliente.has(v.clienteId)) visitasPorCliente.set(v.clienteId, []);
      visitasPorCliente.get(v.clienteId).push(v);
    } else if (v.contatoTelefone) {
      const k = phoneKey(v.contatoTelefone);
      if (!visitasPorTelefone.has(k)) visitasPorTelefone.set(k, []);
      visitasPorTelefone.get(k).push(v);
    }
  }
  return { visitasPorCliente, visitasPorTelefone };
}
function visitasDoClienteEm(mapas, c, key) {
  return (mapas.visitasPorCliente.get(c.id) || []).concat(mapas.visitasPorTelefone.get(key) || []);
}
/**
 * Última interação real do cliente -- mesma definição já usada pelo Radar
 * pra "negociação parada": a mais recente entre última resposta recebida,
 * último envio e última visita. Nunca usa updated_at (que muda por qualquer
 * edição, não só por interação comercial real).
 */
function ultimaInteracaoDe(c, visitasDoCliente) {
  const ultimaVisitaTs = visitasDoCliente.reduce((max, v) => Math.max(max, v.dataHora || 0), 0);
  return Math.max(c.lastReplyAt || 0, c.lastSentAt || 0, ultimaVisitaTs) || null;
}

function montarRadar(tenant, vendedores, todasVisitas, filtroVendedorId) {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const agora = Date.now();
  const cincoDiasMs = RADAR_NEGOCIACAO_PARADA_DIAS * 86400000;
  const mapasVisitas = montarMapasVisitas(todasVisitas);
  // Última mensagem recebida por contato (mesma lógica do KPI "Conversas" de /api/visitas/resumo)
  const ultimaMsgPorKey = new Map();
  for (const m of tenant.conversas) {
    const atual = ultimaMsgPorKey.get(m.key);
    if (!atual || m.ts > atual.ts) ultimaMsgPorKey.set(m.key, m);
  }

  let clientes = tenant.clients;
  if (filtroVendedorId === "none") clientes = clientes.filter((c) => !c.vendedorResponsavelId);
  else if (filtroVendedorId) clientes = clientes.filter((c) => c.vendedorResponsavelId === filtroVendedorId);

  const itens = [];
  for (const c of clientes) {
    const key = c.key || phoneKey(c.phone);
    const nome = resolveName(tenant, c.phone, c.name);
    const clientRef = { id: c.id, name: nome, phone: c.phone, stage: c.stage, vendedorResponsavelId: c.vendedorResponsavelId, origem: c.origem, tags: c.tags, inAgenda: inAgenda(tenant, c.phone) };
    const visitasDoCliente = visitasDoClienteEm(mapasVisitas, c, key);

    // A) respondeu, sem retorno nosso
    const ultimaMsg = ultimaMsgPorKey.get(key);
    if (ultimaMsg && ultimaMsg.dir === "in") {
      itens.push({
        prioridade: "urgente", tipo: "sem_resposta", client: clientRef,
        texto: `Respondeu ${fmtDistancia(agora - ultimaMsg.ts)} e ainda não recebeu retorno.`,
        acao: "Abrir conversa", go: "conversa", conversaKey: key,
      });
    }

    // B/C/F) próxima ação (atrasada = urgente, hoje = amarelo) -- reaproveita montarProximaAcao
    const proximaAcao = montarProximaAcao(c, visitasDoCliente, vendedores);
    if (proximaAcao) {
      const origemTxt = proximaAcao.origem === "visita" ? "Retorno marcado pelo vendedor" : proximaAcao.texto;
      if (proximaAcao.atrasado) {
        const dias = Math.max(1, Math.round((agora - new Date(proximaAcao.data).getTime()) / 86400000));
        itens.push({
          prioridade: "urgente", tipo: "acao_atrasada", client: clientRef,
          texto: `${origemTxt} — atrasada há ${dias} dia(s).`,
          acao: "Abrir cliente", go: "cliente",
        });
      } else if (proximaAcao.data === hojeStr) {
        itens.push({
          prioridade: "hoje", tipo: "acao_hoje", client: clientRef,
          texto: `${origemTxt} — hoje${proximaAcao.hora ? " às " + proximaAcao.hora : ""}.`,
          acao: "Abrir cliente", go: "cliente",
        });
      }
    }

    // D) negociação sem movimento
    if (c.stage === "Negociando") {
      const ultimaInteracao = ultimaInteracaoDe(c, visitasDoCliente);
      if (ultimaInteracao && agora - ultimaInteracao >= cincoDiasMs) {
        itens.push({
          prioridade: "atencao", tipo: "negociacao_parada", client: clientRef,
          texto: `Em negociação, sem interação há ${Math.floor((agora - ultimaInteracao) / 86400000)} dia(s).`,
          acao: "Abrir cliente", go: "cliente",
        });
      }
    }

    // E) proposta solicitada sem próximo passo
    const ultimaProposta = visitasDoCliente.filter((v) => v.resultado === "Proposta solicitada").sort((a, b) => b.dataHora - a.dataHora)[0];
    if (ultimaProposta && !proximaAcao) {
      itens.push({
        prioridade: "atencao", tipo: "proposta_sem_retorno", client: clientRef,
        texto: "Proposta solicitada na visita. Nenhum retorno programado.",
        acao: "Criar próxima ação", go: "cliente",
      });
    }

    // G) sem responsável, só quando há sinal comercial relevante
    if (!c.vendedorResponsavelId && ["Respondeu", "Negociando"].includes(c.stage)) {
      itens.push({
        prioridade: "atencao", tipo: "sem_responsavel", client: clientRef,
        texto: "Cliente ativo sem vendedor responsável.",
        acao: "Atribuir responsável", go: "cliente",
      });
    }
  }

  const ordem = { urgente: 0, atencao: 1, hoje: 2 };
  itens.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade]);
  const resumo = { urgente: 0, atencao: 0, hoje: 0 };
  itens.forEach((i) => resumo[i.prioridade]++);
  return { itens, resumo, total: itens.length };
}

/** "há 6 horas" / "há 2 dias" -- só pra texto do Radar, sem virar helper genérico de data. */
function fmtDistancia(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `há ${Math.max(1, min)} minuto(s)`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} hora(s)`;
  return `há ${Math.round(h / 24)} dia(s)`;
}

app.get("/api/radar", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  const tenant = req.tenant;
  try {
    const [vendedores, todasVisitas] = USE_SUPABASE
      ? await Promise.all([repo.usuariosRepo.listVendedores(tenant.empresa.id), repo.visitasRepo.listForEmpresa(tenant.empresa.id)])
      : [[], []];
    const vendedorId = String(req.query.vendedorId || "");
    res.json(montarRadar(tenant, vendedores, todasVisitas, vendedorId));
  } catch (err) {
    console.error("[radar]:", err.message);
    res.status(500).json({ error: "Não foi possível calcular o que precisa da sua atenção agora." });
  }
});

// --- Modelos de mensagem ---
app.get("/api/templates", (req, res) => res.json({ templates: req.tenant.templates }));

app.post("/api/templates", async (req, res) => {
  const tenant = req.tenant;
  const { name, message, imageUrl } = req.body || {};
  // Até 3 URLs de imagem (compatível com o campo antigo imageUrl)
  let imageUrls = Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : (imageUrl ? [imageUrl] : []);
  imageUrls = imageUrls.filter((u) => typeof u === "string" && u.trim()).slice(0, 3).map((u) => u.slice(0, 1000));
  if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome ao modelo." });
  if (!message && imageUrls.length === 0) return res.status(400).json({ error: "O modelo precisa de texto ou imagem." });
  if (tenant.templates.length >= MAX_TEMPLATES) {
    return res.status(400).json({ error: `Limite de ${MAX_TEMPLATES} modelos atingido. Exclua algum para salvar outro.` });
  }
  const template = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40),
    message: (message || "").slice(0, 5000),
    imageUrls,
  };
  tenant.templates.push(template);
  await saveTemplates(tenant, template);
  res.json({ ok: true, template });
});

// Editar modelo -- faltava no CRUD (só havia criar/listar/excluir). Reaproveita
// a mesma validação do POST e o mesmo upsert de saveTemplates (já suportava
// atualização, só não existia rota HTTP que chamasse com um id existente).
app.put("/api/templates/:id", async (req, res) => {
  const tenant = req.tenant;
  const existente = tenant.templates.find((t) => t.id === req.params.id);
  if (!existente) return res.status(404).json({ error: "Modelo não encontrado." });
  const { name, message, imageUrl } = req.body || {};
  let imageUrls = Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : (imageUrl ? [imageUrl] : []);
  imageUrls = imageUrls.filter((u) => typeof u === "string" && u.trim()).slice(0, 3).map((u) => u.slice(0, 1000));
  if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome ao modelo." });
  if (!message && imageUrls.length === 0) return res.status(400).json({ error: "O modelo precisa de texto ou imagem." });
  existente.name = name.trim().slice(0, 40);
  existente.message = (message || "").slice(0, 5000);
  existente.imageUrls = imageUrls;
  await saveTemplates(tenant, existente);
  res.json({ ok: true, template: existente });
});

app.delete("/api/templates/:id", async (req, res) => {
  const tenant = req.tenant;
  const before = tenant.templates.length;
  tenant.templates = tenant.templates.filter((t) => t.id !== req.params.id);
  await saveTemplates(tenant, null, req.params.id);
  res.json({ ok: before !== tenant.templates.length });
});

// Buckets de "sem interação" oferecidos na Reativação de Clientes Parados.
const REATIVACAO_BUCKETS_DIAS = [7, 15, 30, 60, 90];
const FULL_LIST_TETO = 3000; // teto de segurança pra ?full=1 (usado ao "criar campanha para estes clientes")

/**
 * Cliente com próxima ação já agendada pra hoje/futuro não deve ser tratado
 * como "parado" mesmo com muitos dias sem interação -- já está sendo
 * acompanhado ativamente. Ação atrasada NÃO conta como agendamento válido
 * (nesse caso o cliente pode aparecer tanto aqui quanto no Radar).
 */
function temProximaAcaoFutura(c, visitasDoCliente, vendedores, hojeStr) {
  const pa = montarProximaAcao(c, visitasDoCliente, vendedores);
  return !!(pa && pa.data >= hojeStr);
}

// --- CRM-lite: clientes ---
app.get("/api/clients", async (req, res) => {
  const tenant = req.tenant;
  const search = String(req.query.search || "").trim().toLowerCase();
  const tag = String(req.query.tag || "");
  const stage = String(req.query.stage || "");
  // vendedorId: filtra pela carteira daquele vendedor; "none" filtra só quem não tem responsável.
  const vendedorId = String(req.query.vendedorId || "");
  const semInteracaoDias = Number(req.query.semInteracaoDias) || 0;
  const full = req.query.full === "1";

  // Só monta mapas de visita/vendedores (custo extra) quando o filtro de
  // inatividade é realmente usado -- não pesa a listagem normal do CRM.
  let mapasVisitas = null, vendedoresCache = null, hojeStr = null;
  if (semInteracaoDias > 0) {
    hojeStr = new Date().toISOString().slice(0, 10);
    const todasVisitas = USE_SUPABASE ? await repo.visitasRepo.listForEmpresa(tenant.empresa.id) : [];
    mapasVisitas = montarMapasVisitas(todasVisitas);
    vendedoresCache = USE_SUPABASE ? await repo.usuariosRepo.listVendedores(tenant.empresa.id) : [];
  }

  let list = tenant.clients.filter((c) => {
    const nome = resolveName(tenant, c.phone, c.name);
    if (stage && c.stage !== stage) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    if (search && !`${nome} ${c.phone}`.toLowerCase().includes(search)) return false;
    if (vendedorId === "none" && c.vendedorResponsavelId) return false;
    if (vendedorId && vendedorId !== "none" && c.vendedorResponsavelId !== vendedorId) return false;
    if (semInteracaoDias > 0) {
      const key = c.key || phoneKey(c.phone);
      const visitasDoCliente = visitasDoClienteEm(mapasVisitas, c, key);
      const ultimaInteracao = ultimaInteracaoDe(c, visitasDoCliente);
      const diasParado = ultimaInteracao ? Math.floor((Date.now() - ultimaInteracao) / 86400000) : Infinity;
      if (diasParado < semInteracaoDias) return false;
      if (temProximaAcaoFutura(c, visitasDoCliente, vendedoresCache, hojeStr)) return false;
    }
    return true;
  });
  list = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const totalFiltrado = list.length;
  const offset = full ? 0 : Math.max(0, Number(req.query.offset) || 0);
  const limite = full ? FULL_LIST_TETO : PAGE_SIZE;
  list = list.slice(offset, offset + limite);
  // Enriquece com nome resolvido (agenda → WhatsApp → campanha), origem, flag de agenda
  // e (só quando o filtro de inatividade está ativo) dias sem interação real.
  const enriched = list.map((c) => {
    const id = bestName(tenant, c.phone, c.name);
    const extra = {};
    if (semInteracaoDias > 0) {
      const key = c.key || phoneKey(c.phone);
      const ultimaInteracao = ultimaInteracaoDe(c, visitasDoClienteEm(mapasVisitas, c, key));
      extra.ultimaInteracaoEm = ultimaInteracao;
      extra.diasSemInteracao = ultimaInteracao ? Math.floor((Date.now() - ultimaInteracao) / 86400000) : null;
    }
    return { ...c, ...extra, displayName: id.name, nameSource: id.source, inAgenda: inAgenda(tenant, c.phone) };
  });
  res.json({ clients: enriched, total: tenant.clients.length, shown: offset + enriched.length, hasMore: offset + enriched.length < totalFiltrado });
});

app.get("/api/clients/meta", async (req, res) => {
  const tenant = req.tenant;
  const tagSet = new Set();
  const stageCount = {};
  tenant.clients.forEach((c) => {
    (c.tags || []).forEach((t) => tagSet.add(t));
    stageCount[c.stage] = (stageCount[c.stage] || 0) + 1;
  });

  // Contagem por bucket de "sem interação" pros botões da Reativação de
  // Clientes Parados -- mesma regra de exclusão por próxima ação futura.
  const semInteracaoBuckets = {};
  if (USE_SUPABASE) {
    const hojeStr = new Date().toISOString().slice(0, 10);
    const [todasVisitas, vendedores] = await Promise.all([
      repo.visitasRepo.listForEmpresa(tenant.empresa.id),
      repo.usuariosRepo.listVendedores(tenant.empresa.id),
    ]);
    const mapasVisitas = montarMapasVisitas(todasVisitas);
    const diasPorCliente = tenant.clients.map((c) => {
      const key = c.key || phoneKey(c.phone);
      const visitasDoCliente = visitasDoClienteEm(mapasVisitas, c, key);
      const ultimaInteracao = ultimaInteracaoDe(c, visitasDoCliente);
      if (temProximaAcaoFutura(c, visitasDoCliente, vendedores, hojeStr)) return null;
      return ultimaInteracao ? Math.floor((Date.now() - ultimaInteracao) / 86400000) : Infinity;
    });
    for (const dias of REATIVACAO_BUCKETS_DIAS) {
      semInteracaoBuckets[dias] = diasPorCliente.filter((d) => d !== null && d >= dias).length;
    }
  } else {
    for (const dias of REATIVACAO_BUCKETS_DIAS) semInteracaoBuckets[dias] = 0;
  }

  res.json({ stages: CRM_STAGES, tags: [...tagSet].sort(), stageCount, total: tenant.clients.length, semInteracaoBuckets });
});

// Cliente 360° (Item 6): agrega conversas, campanhas, visitas e notas num só lugar.
// Visitas ligam por telefone (best-effort -- não há client_id na tabela de visitas
// ainda, então uma visita sem contato_telefone preenchido nunca aparece aqui).
// Compartilhado entre GET /detalhe e POST /ia (o botão de IA usa os mesmos dados agregados).
/**
 * Normaliza a "próxima ação" vigente de um cliente a partir das 2 fontes que
 * existem hoje (visita com resultado "Retornar depois" e a ação manual
 * gravada direto no cliente). Antes disso, a visita sempre ganhava da manual
 * sem olhar a data -- o que escondia uma ação recente atrás de uma visita
 * antiga nunca resolvida. Regra nova: vence quem tem a data mais próxima/
 * futura; visitas já marcadas como resolvidas (proximaAcaoResolvida) são
 * ignoradas, como se não existissem.
 */
function montarProximaAcao(c, visitas, vendedores) {
  const visitaCandidata = visitas.find((v) => v.proximaVisitaData && v.resultado === "Retornar depois" && !v.proximaAcaoResolvida);
  const daVisita = visitaCandidata ? {
    texto: visitaCandidata.proximaAcao || "Retornar", data: visitaCandidata.proximaVisitaData, hora: visitaCandidata.proximaVisitaHora || null,
    responsavelId: visitaCandidata.vendedorId || null, origem: "visita", visitaId: visitaCandidata.id,
  } : null;
  const daManual = c.proximaAcaoTexto && c.proximaAcaoData ? {
    texto: c.proximaAcaoTexto, data: c.proximaAcaoData, hora: c.proximaAcaoHora || null,
    responsavelId: c.proximaAcaoResponsavelId || c.vendedorResponsavelId || null, origem: "manual", visitaId: null,
  } : null;

  let vigente = null;
  if (daVisita && daManual) vigente = daVisita.data >= daManual.data ? daVisita : daManual;
  else vigente = daVisita || daManual;
  if (!vigente) return null;

  const hojeStr = new Date().toISOString().slice(0, 10);
  const responsavelNome = vigente.responsavelId ? (vendedores.find((v) => v.id === vigente.responsavelId)?.name || null) : null;
  return { ...vigente, responsavelNome, atrasado: vigente.data < hojeStr };
}

async function agregarClienteDetalhe(tenant, c) {
  const key = c.key || phoneKey(c.phone);

  const mensagens = tenant.conversas.filter((m) => m.key === key).sort((a, b) => b.ts - a.ts);

  const campanhas = tenant.jobs
    .map((j) => ({ job: j, log: (j.logs || []).find((l) => phoneKey(l.phone) === key) }))
    .filter((x) => x.log)
    .map(({ job, log }) => ({
      id: job.id, nome: job.name || campaignLabel(job.message, job.hadImage || job.imageCount),
      enviadaEm: job.finishedAt || job.scheduledAt || job.createdAt,
      entregue: !!log.ok,
      respondida: mensagens.some((m) => m.dir === "in" && m.ts >= (job.startedAt || job.createdAt || 0)),
    }))
    .sort((a, b) => (b.enviadaEm || 0) - (a.enviadaEm || 0));

  const todasVisitas = USE_SUPABASE ? await repo.visitasRepo.listForEmpresa(tenant.empresa.id) : [];
  // Prioriza a relação explícita (visita.clienteId) sobre o telefone -- o
  // telefone só decide para visitas antigas, criadas antes dessa relação
  // existir (clienteId nulo). Uma visita com clienteId nunca é encontrada
  // por telefone além disso (evita duplicar o mesmo registro na lista).
  const visitas = todasVisitas
    .filter((v) => (v.clienteId ? v.clienteId === c.id : v.contatoTelefone && phoneKey(v.contatoTelefone) === key))
    .sort((a, b) => b.dataHora - a.dataHora);

  const notas = USE_SUPABASE ? await repo.clienteNotasRepo.listar(tenant.empresa.id, c.id) : [];
  const mudancasEtapa = USE_SUPABASE ? await repo.auditoriaRepo.listarPorCliente(tenant.empresa.id, c.id) : [];

  const vendedores = USE_SUPABASE ? await repo.usuariosRepo.listVendedores(tenant.empresa.id) : [];
  const vendedorResponsavelNome = c.vendedorResponsavelId
    ? (vendedores.find((v) => v.id === c.vendedorResponsavelId)?.name || null) : null;

  const timeline = [
    ...mensagens.map((m) => ({ tipo: "conversa", ts: m.ts, texto: m.text, dir: m.dir })),
    ...campanhas.map((cm) => ({ tipo: "campanha", ts: cm.enviadaEm, texto: cm.nome, entregue: cm.entregue, respondida: cm.respondida })),
    ...visitas.map((v) => ({ tipo: "visita", ts: v.dataHora, texto: `Visita — ${v.resultado || "em andamento"}`, visitaId: v.id })),
    ...notas.map((n) => ({ tipo: "nota", ts: new Date(n.criadoEm).getTime(), texto: n.texto, autor: n.autorNome })),
    ...mudancasEtapa.map((e) => ({ tipo: "etapa", ts: new Date(e.criadoEm).getTime(), texto: e.acao, autor: e.atorNome })),
  ].filter((e) => e.ts).sort((a, b) => b.ts - a.ts);

  const ultimaVisita = visitas[0] || null;
  const oportunidade = visitas.find((v) => v.valorPotencial != null && ["Interessado", "Proposta solicitada", "Em negociação"].includes(v.resultado));
  const identidade = bestName(tenant, c.phone, c.lastCampaignName || "");

  return {
    client: { ...c, displayName: identidade.name || c.name, nameSource: identidade.source, inAgenda: inAgenda(tenant, c.phone) },
    vendedorResponsavelNome,
    resumo: {
      oportunidadeValor: oportunidade?.valorPotencial ?? null,
      ultimaConversaEm: mensagens[0]?.ts || null,
      ultimaVisitaEm: ultimaVisita?.dataHora || null,
      campanhasCount: campanhas.length,
      proximaAcao: montarProximaAcao(c, visitas, vendedores),
    },
    notas,
    timeline: timeline.slice(0, 200),
  };
}

app.get("/api/clients/:id/detalhe", async (req, res) => {
  const tenant = req.tenant;
  const c = tenant.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  try {
    res.json(await agregarClienteDetalhe(tenant, c));
  } catch (err) {
    console.error("[clients] detalhe:", err.message);
    res.status(500).json({ error: "Não foi possível carregar o histórico do cliente." });
  }
});

// Notas do cliente (Item 6.4) -- lista fica com autor e data, nunca sobrescreve silenciosamente.
app.post("/api/clients/:id/notas", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Notas por cliente estão disponíveis apenas no modo multi-empresa (Supabase)." });
  const tenant = req.tenant;
  const c = tenant.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  const texto = String(req.body?.texto || "").trim().slice(0, 1000);
  if (!texto) return res.status(400).json({ error: "Escreva uma nota antes de salvar." });
  try {
    const nota = await repo.clienteNotasRepo.adicionar(tenant.empresa.id, c.id, {
      autorNome: req.session.name || (req.session.role === "owner" ? "Dono" : "Vendedor"),
      autorPapel: req.session.role, texto,
    });
    res.json({ ok: true, nota });
  } catch (err) {
    console.error("[clients] adicionar nota:", err.message);
    res.status(500).json({ error: "Não foi possível salvar a nota. Tente novamente." });
  }
});

// IA do Cliente 360° (Item 6.7): resume o histórico ou sugere a próxima ação,
// usando os mesmos dados agregados do /detalhe. Não é o chat com ferramentas
// (Zappy já recebe tudo pronto no prompt) — só uma chamada direta à Responses API.
app.post("/api/clients/:id/ia", async (req, res) => {
  if (!openaiClient.openaiConfigured) {
    return res.status(400).json({ error: "Integração com IA ainda não foi configurada (OPENAI_API_KEY)." });
  }
  const tenant = req.tenant;
  const c = tenant.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  const tipo = req.body?.tipo === "sugestao" ? "sugestao" : "resumo";
  try {
    const detalhe = await agregarClienteDetalhe(tenant, c);
    const linhasTimeline = detalhe.timeline.slice(0, 30).map((e) => `- [${e.tipo}] ${new Date(e.ts).toLocaleString("pt-BR")}: ${e.texto}`).join("\n") || "(sem histórico registrado)";
    const pa = detalhe.resumo.proximaAcao;
    const proximaAcaoTxt = pa
      ? `${pa.texto} — ${pa.data}${pa.hora ? " às " + pa.hora : ""}${pa.responsavelNome ? " (" + pa.responsavelNome + ")" : ""}${pa.atrasado ? " [ATRASADA]" : ""}`
      : "nenhuma";
    const contexto = `Cliente: ${detalhe.client.displayName || detalhe.client.name}\nEtapa do funil: ${c.stage}\nVendedor responsável: ${detalhe.vendedorResponsavelNome || "não definido"}\nPróxima ação: ${proximaAcaoTxt}\n\nHistórico recente (mais novo primeiro):\n${linhasTimeline}`;
    const instrucao = tipo === "sugestao"
      ? `${contexto}\n\nCom base nesse histórico, sugira em até 3 frases qual deve ser a próxima ação comercial com esse cliente. Seja específico e prático.`
      : `${contexto}\n\nResuma em até 4 frases o histórico desse cliente para o vendedor entender rapidamente onde essa relação está.`;
    const perfil = await repo.configuracoesIaRepo.get(tenant.empresa.id);
    const baseConhecimento = USE_SUPABASE ? await repo.companyKnowledgeRepo.listar(tenant.empresa.id) : [];
    const input = montarInput({ perfilEmpresa: perfil, empresaNome: tenant.empresa.name, historico: [], mensagemUsuario: instrucao, baseConhecimento });
    const { textoFinal, usage } = await openaiClient.executarComFerramentas({ model: openaiClient.MODELOS.padrao, input, tools: [], executores: {} });
    await repo.iaConsumoRepo.registrar(tenant.empresa.id, req.session.uid, {
      modelo: openaiClient.MODELOS.padrao, acao: `cliente_${tipo}`,
      tokensEntrada: usage.tokensEntrada, tokensSaida: usage.tokensSaida,
      estimatedCost: openaiClient.calcularCustoEstimado(openaiClient.MODELOS.padrao, usage.tokensEntrada, usage.tokensSaida),
    });
    res.json({ resposta: textoFinal });
  } catch (err) {
    console.error("[clients] ia:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível consultar a IA agora." });
  }
});

app.patch("/api/clients/:id", async (req, res) => {
  const tenant = req.tenant;
  const c = tenant.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  const { name, stage, tags, notes, vendedorResponsavelId } = req.body || {};
  const etapaAnterior = c.stage;
  if (typeof name === "string") c.name = name.slice(0, 80);
  if (typeof stage === "string" && stage) { c.stage = stage.slice(0, 40); c.stageManual = true; }
  if (Array.isArray(tags)) c.tags = tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 20);
  if (typeof notes === "string") c.notes = notes.slice(0, 1000);
  c.updatedAt = Date.now();
  await saveClients(tenant, c);
  if (c.stage !== etapaAnterior) dispararAutomacoes(tenant, "mudanca_etapa", c.stage, c).catch(() => {});
  if (vendedorResponsavelId !== undefined && USE_SUPABASE) {
    // "Sem responsável" (string vazia/null) sempre é permitido. Um ID não-vazio
    // só é aceito se for de um vendedor ativo desta MESMA empresa -- nunca
    // confia no ID cru vindo do navegador (evita apontar cliente da empresa A
    // pra um "vendedor" da empresa B).
    let novoResponsavel = null;
    if (vendedorResponsavelId) {
      const vendedoresDaEmpresa = await repo.usuariosRepo.listVendedores(tenant.empresa.id);
      const valido = vendedoresDaEmpresa.some((v) => v.id === vendedorResponsavelId);
      if (!valido) return res.status(400).json({ error: "Vendedor não encontrado para esta empresa." });
      novoResponsavel = vendedorResponsavelId;
    }
    c.vendedorResponsavelId = novoResponsavel;
    await repo.clientesRepo.definirResponsavel(tenant.empresa.id, c.id, novoResponsavel);
  }
  res.json({ ok: true, client: c });
});

// Próxima ação definida direto no cliente (Cliente 360°), pra quando não há
// visita em aberto gerando uma automaticamente -- dono cria o follow-up na mão.
app.post("/api/clients/:id/proxima-acao", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  const tenant = req.tenant;
  const c = tenant.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  const texto = String(req.body?.texto || "").trim().slice(0, 200);
  const data = String(req.body?.data || "").trim();
  const hora = /^\d{2}:\d{2}$/.test(req.body?.hora) ? req.body.hora : null;
  const adicionarGoogleAgenda = !!req.body?.adicionarGoogleAgenda;
  if (!texto || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Preencha o que fazer e a data." });
  try {
    // Responsável: se não veio um específico, usa o responsável geral do
    // cliente como padrão -- em qualquer caso, só aceita vendedor da MESMA
    // empresa (nunca confia no ID cru vindo do navegador).
    let responsavelId = req.body?.responsavelId !== undefined ? String(req.body.responsavelId || "") : c.vendedorResponsavelId;
    if (responsavelId) {
      const vendedoresDaEmpresa = await repo.usuariosRepo.listVendedores(tenant.empresa.id);
      if (!vendedoresDaEmpresa.some((v) => v.id === responsavelId)) {
        return res.status(400).json({ error: "Vendedor não encontrado para esta empresa." });
      }
    } else {
      responsavelId = null;
    }

    let googleEventoId;
    if (adicionarGoogleAgenda) {
      const accessToken = await obterConexaoGoogle(tenant.empresa.id);
      if (accessToken) {
        const inicio = new Date(`${data}T${hora || "09:00"}:00`);
        const fim = new Date(inicio.getTime() + 30 * 60 * 1000);
        try {
          const evento = await googleClient.criarEvento(accessToken, {
            titulo: `${texto} — ${c.name || c.phone}`,
            descricao: texto, inicio: inicio.toISOString(), fim: fim.toISOString(),
          });
          googleEventoId = evento.id;
        } catch (err) {
          console.error("[clients] proxima-acao (calendar):", err.response?.data?.error || err.message);
          // Segue sem o evento -- o ZapFlow não pode depender do Google pra funcionar.
        }
      }
    }

    c.proximaAcaoTexto = texto;
    c.proximaAcaoData = data;
    await repo.clientesRepo.definirProximaAcao(tenant.empresa.id, c.id, { texto, data, hora, responsavelId });
    res.json({ ok: true, calendarioCriado: Boolean(googleEventoId) });
  } catch (err) {
    console.error("[clients] proxima-acao:", err.message);
    res.status(500).json({ error: "Não foi possível salvar o follow-up. Tente novamente." });
  }
});

// "Concluir" a próxima ação vigente -- independe de ela ter vindo da visita
// ou de ter sido criada direto no cliente (a origem é resolvida no backend,
// o frontend só chama esse endpoint sem precisar saber qual das duas era).
app.post("/api/clients/:id/proxima-acao/concluir", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  const tenant = req.tenant;
  const c = tenant.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  try {
    const visitas = await repo.visitasRepo.listForEmpresa(tenant.empresa.id);
    const visitasDoCliente = visitas.filter((v) => (v.clienteId ? v.clienteId === c.id : v.contatoTelefone && phoneKey(v.contatoTelefone) === phoneKey(c.phone)));
    const vendedores = await repo.usuariosRepo.listVendedores(tenant.empresa.id);
    const vigente = montarProximaAcao(c, visitasDoCliente, vendedores);
    if (!vigente) return res.json({ ok: true }); // nada pra concluir, sem erro
    if (vigente.origem === "visita") {
      await repo.visitasRepo.update(tenant.empresa.id, vigente.visitaId, { proximaAcaoResolvida: true });
    } else {
      c.proximaAcaoTexto = ""; c.proximaAcaoData = null;
      await repo.clientesRepo.definirProximaAcao(tenant.empresa.id, c.id, { texto: "", data: null, hora: null, responsavelId: null });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[clients] proxima-acao concluir:", err.message);
    res.status(500).json({ error: "Não foi possível concluir a próxima ação." });
  }
});

app.delete("/api/clients/:id", async (req, res) => {
  const tenant = req.tenant;
  const before = tenant.clients.length;
  const removed = tenant.clients.find((c) => c.id === req.params.id);
  tenant.clients = tenant.clients.filter((c) => c.id !== req.params.id);
  if (removed) await saveClients(tenant, null, removed.id);
  res.json({ ok: before !== tenant.clients.length });
});

// Move a etapa do funil pelo telefone (usado nas Conversas/Respostas, onde o
// cliente pode ainda não ter card). Cria o cliente se necessário. Mudança manual.
app.post("/api/clients/stage", async (req, res) => {
  const tenant = req.tenant;
  const { phone, stage } = req.body || {};
  if (!phoneKey(phone)) return res.status(400).json({ error: "Telefone inválido." });
  if (!CRM_STAGES.includes(stage)) return res.status(400).json({ error: "Etapa inválida." });
  let origem = String(req.body?.origem || "manual");
  if (origem === "agenda") {
    const ag = tenant.agenda.find((a) => phoneKey(a.phone) === phoneKey(phone));
    if (ag?.origem === "planilha") origem = "planilha";
  }
  const c = upsertClient(tenant, phone, undefined, origem);
  if (!c) return res.status(400).json({ error: "Não foi possível registrar o cliente." });
  const etapaAnterior = c.stage;
  c.stage = stage;
  c.stageManual = true;
  c.updatedAt = Date.now();
  await saveClients(tenant, c);
  if (etapaAnterior !== stage && USE_SUPABASE) {
    repo.auditoriaRepo.registrar(tenant.empresa.id, {
      atorNome: req.session.name, atorPapel: req.session.role,
      acao: `Moveu ${bestName(tenant, c.phone, c.name).name} de ${etapaAnterior} para ${stage}`,
      clienteId: c.id,
    }).catch(() => {});
    dispararAutomacoes(tenant, "mudanca_etapa", stage, c).catch(() => {});
  }
  res.json({ ok: true, client: { ...c, displayName: bestName(tenant, c.phone, c.name).name, inAgenda: inAgenda(tenant, c.phone) } });
});

// Exporta o CRM pra uma planilha Google nova (V3 — precisa da conta Google conectada).
app.post("/api/clients/exportar-planilha", async (req, res) => {
  const tenant = req.tenant;
  try {
    const accessToken = await obterConexaoGoogle(tenant.empresa.id);
    if (!accessToken) return res.status(400).json({ error: "Conecte sua conta Google na aba Calendário primeiro." });
    const linhas = [["Nome", "Telefone", "Etapa", "Tags", "Notas", "Criado em"]];
    tenant.clients.forEach((c) => {
      linhas.push([
        resolveName(tenant, c.phone, c.name) || c.name || "", c.phone, c.stage || "",
        (c.tags || []).join(", "), c.notes || "", new Date(c.createdAt).toLocaleString("pt-BR"),
      ]);
    });
    const { url } = await googleClient.criarPlanilha(accessToken, `ZapFlow - Clientes - ${new Date().toLocaleDateString("pt-BR")}`, linhas);
    res.json({ ok: true, url });
  } catch (err) {
    console.error("[google] exportar clientes:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível exportar a planilha." });
  }
});

// --- Agenda de contatos salvos ---
app.get("/api/agenda", (req, res) => {
  const tenant = req.tenant;
  const s = String(req.query.search || "").trim().toLowerCase();
  let list = tenant.agenda.filter((a) => !s || `${a.name} ${a.phone}`.toLowerCase().includes(s));
  list = list.sort((a, b) => (a.name || "~").localeCompare(b.name || "~", "pt"));
  const totalFiltrado = list.length;
  const offset = Math.max(0, Number(req.query.offset) || 0);
  list = list.slice(offset, offset + PAGE_SIZE);
  const clientKeys = new Set(tenant.clients.map((c) => c.key || phoneKey(c.phone)));
  list = list.map((a) => ({ ...a, isClient: clientKeys.has(phoneKey(a.phone)) }));
  res.json({ contacts: list, total: tenant.agenda.length, shown: offset + list.length, hasMore: offset + list.length < totalFiltrado });
});

app.post("/api/agenda", async (req, res) => {
  const tenant = req.tenant;
  const { name, phone } = req.body || {};
  if (!phoneKey(phone)) return res.status(400).json({ error: "Telefone inválido. Inclua o DDD." });
  const contact = upsertAgenda(tenant, phone, name || "", "manual");
  await saveAgenda(tenant, contact);
  res.json({ ok: true, contact });
});

// Importa contatos de uma planilha (reaproveita o parser do Passo 2)
app.post("/api/agenda/upload", upload.single("file"), async (req, res) => {
  const tenant = req.tenant;
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  try {
    const contacts = parseContactsFromBuffer(req.file.buffer);
    const touched = [];
    contacts.forEach((c) => { if (c.phone) { touched.push(upsertAgenda(tenant, c.phone, c.name, "planilha")); } });
    if (USE_SUPABASE) { for (const c of touched) if (c) await repo.contatosRepo.upsertOne(tenant.empresa.id, c); }
    else await saveAgenda(tenant);
    res.json({ ok: true, imported: touched.filter(Boolean).length });
  } catch (err) {
    res.status(500).json({ error: "Falha ao ler a planilha: " + err.message });
  }
});

// Sincroniza os contatos salvos no chip (GET /contacts da Z-API, com paginação)
app.post("/api/agenda/sync-chip", async (req, res) => {
  const tenant = req.tenant;
  const creds = resolveCredentials(tenant, req.body);
  if (!creds.instanceId || !creds.instanceToken) {
    return res.status(400).json({ error: "Conexão não configurada." });
  }
  let imported = 0;
  try {
    for (let page = 1; page <= 30; page++) {
      const url = `${zapiBaseUrl(creds)}/contacts?page=${page}&pageSize=100`;
      const { data } = await axios.get(url, { headers: zapiHeaders(creds), timeout: 30000 });
      const list = Array.isArray(data) ? data : (data?.contacts || []);
      if (!list.length) break;
      for (const c of list) {
        const phone = c.phone || c.id || "";
        const name = c.name || c.vname || c.notify || c.short || "";
        if (phoneKey(phone)) {
          const a = upsertAgenda(tenant, phone, name, "chip");
          if (USE_SUPABASE && a) await repo.contatosRepo.upsertOne(tenant.empresa.id, a);
          imported++;
        }
      }
      if (list.length < 100) break;
    }
    if (!USE_SUPABASE) await saveAgenda(tenant);
    res.json({ ok: true, imported });
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.error || err.response?.data?.message || err.message });
  }
});

app.delete("/api/agenda/:id", async (req, res) => {
  const tenant = req.tenant;
  const before = tenant.agenda.length;
  tenant.agenda = tenant.agenda.filter((a) => a.id !== req.params.id);
  if (before !== tenant.agenda.length) await saveAgenda(tenant, null, req.params.id);
  res.json({ ok: before !== tenant.agenda.length });
});

// --- Conversas (caixa de entrada) ---
app.get("/api/conversas", async (req, res) => {
  const tenant = req.tenant;
  const filter = String(req.query.filter || "all");
  const s = String(req.query.search || "").trim().toLowerCase();
  const resolvidas = USE_SUPABASE ? await repo.conversaStatusRepo.mapaResolvidas(tenant.empresa.id) : new Set();
  // Agrupa por contato (última mensagem de cada)
  const byKey = new Map();
  for (const m of tenant.conversas) {
    const cur = byKey.get(m.key);
    if (!cur || m.ts > cur.lastTs) byKey.set(m.key, { key: m.key, phone: m.phone, lastText: m.text, lastTs: m.ts, dir: m.dir });
  }
  let threads = [...byKey.values()].map((t) => {
    const camp = isCampaignOrigin(tenant, t.key);
    const id = bestName(tenant, t.phone, camp ? campaignNameOf(tenant, t.key) : "");
    const c = tenant.clients.find((x) => (x.key || phoneKey(x.phone)) === t.key);
    return {
      ...t,
      name: id.name,
      nameSource: id.source,
      inAgenda: inAgenda(tenant, t.phone),
      tags: c?.tags || [],
      stage: c?.stage || "",
      origem: camp ? "campaign" : "daily",
      campaignName: camp ? campaignNameOf(tenant, t.key) : "",
      resolvida: resolvidas.has(t.key),
    };
  });
  if (filter === "campaign") threads = threads.filter((t) => t.origem === "campaign");
  if (filter === "daily") threads = threads.filter((t) => t.origem === "daily");
  if (req.query.pendentes === "1") threads = threads.filter((t) => !t.resolvida);
  if (s) threads = threads.filter((t) => `${t.name} ${t.phone}`.toLowerCase().includes(s));
  threads.sort((a, b) => b.lastTs - a.lastTs);
  const totalFiltrado = threads.length;
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const page = threads.slice(offset, offset + PAGE_SIZE);
  res.json({ threads: page, total: totalFiltrado, shown: offset + page.length, hasMore: offset + page.length < totalFiltrado });
});

app.get("/api/conversas/:key", async (req, res) => {
  const tenant = req.tenant;
  const key = req.params.key;
  const messages = tenant.conversas.filter((m) => m.key === key).sort((a, b) => a.ts - b.ts);
  const phone = messages[0]?.phone || key;
  const camp = isCampaignOrigin(tenant, key);
  const id = bestName(tenant, phone, camp ? campaignNameOf(tenant, key) : "");
  const c = tenant.clients.find((x) => (x.key || phoneKey(x.phone)) === key);
  const resolvidas = USE_SUPABASE ? await repo.conversaStatusRepo.mapaResolvidas(tenant.empresa.id) : new Set();
  res.json({
    key, phone,
    name: id.name,
    nameSource: id.source,
    inAgenda: inAgenda(tenant, phone),
    tags: c?.tags || [],
    stage: c?.stage || "",
    origem: camp ? "campaign" : "daily",
    campaignName: campaignNameOf(tenant, key),
    resolvida: resolvidas.has(key),
    messages,
  });
});

app.post("/api/conversas/:key/resolver", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  const tenant = req.tenant;
  const resolvida = req.body?.resolvida !== false;
  try {
    await repo.conversaStatusRepo.definir(tenant.empresa.id, req.params.key, resolvida);
    res.json({ ok: true, resolvida });
  } catch (err) {
    console.error("[conversas] resolver:", err.message);
    res.status(500).json({ error: "Não foi possível atualizar o status da conversa." });
  }
});

// Sugestão de resposta (V1 IA item 4): usa o histórico da conversa + perfil da
// empresa pra propor o próximo texto -- a IA nunca envia, só sugere; o
// vendedor/dono revisa e decide no botão "Enviar" já existente do chat.
app.post("/api/conversas/:key/sugerir-resposta", async (req, res) => {
  if (!openaiClient.openaiConfigured) {
    return res.status(400).json({ error: "Integração com IA ainda não foi configurada (OPENAI_API_KEY)." });
  }
  const tenant = req.tenant;
  const key = req.params.key;
  const messages = tenant.conversas.filter((m) => m.key === key).sort((a, b) => a.ts - b.ts).slice(-20);
  if (!messages.length) return res.status(400).json({ error: "Não há histórico de conversa pra sugerir uma resposta." });
  const c = tenant.clients.find((x) => (x.key || phoneKey(x.phone)) === key);
  try {
    const linhas = messages.map((m) => `[${m.dir === "out" ? "nós" : "cliente"}] ${m.text}`).join("\n");
    // Contexto enxuto de propósito (Fase 6): nome + etapa + próxima ação manual do
    // cliente, nunca a timeline inteira do Cliente 360° -- a conversa em si já
    // está toda no bloco acima, e isso evita 1 query extra de visitas só pra isso.
    const nomeCliente = c ? resolveName(tenant, c.phone, c.name) : null;
    const contexto = `Conversa de WhatsApp com o cliente (mais antiga primeiro):\n${linhas}` +
      (nomeCliente ? `\n\nNome do cliente: ${nomeCliente}` : "") +
      (c?.stage ? `\nEtapa do funil: ${c.stage}` : "") +
      (c?.proximaAcaoTexto && c?.proximaAcaoData ? `\nPróxima ação já agendada: ${c.proximaAcaoTexto} (${c.proximaAcaoData})` : "");
    const instrucao = `${contexto}\n\nSugira a próxima mensagem que devemos enviar pra esse cliente pelo WhatsApp, dando continuidade à conversa. Responda APENAS com o texto da mensagem sugerida, sem aspas, sem explicações antes ou depois.`;
    const perfil = await repo.configuracoesIaRepo.get(tenant.empresa.id);
    const baseConhecimento = USE_SUPABASE ? await repo.companyKnowledgeRepo.listar(tenant.empresa.id) : [];
    const input = montarInput({ perfilEmpresa: perfil, empresaNome: tenant.empresa.name, historico: [], mensagemUsuario: instrucao, baseConhecimento });
    const { textoFinal, usage } = await openaiClient.executarComFerramentas({ model: openaiClient.MODELOS.padrao, input, tools: [], executores: {} });
    await repo.iaConsumoRepo.registrar(tenant.empresa.id, req.session.uid, {
      modelo: openaiClient.MODELOS.padrao, acao: "sugerir_resposta",
      tokensEntrada: usage.tokensEntrada, tokensSaida: usage.tokensSaida,
      estimatedCost: openaiClient.calcularCustoEstimado(openaiClient.MODELOS.padrao, usage.tokensEntrada, usage.tokensSaida),
    });
    res.json({ sugestao: textoFinal.trim() });
  } catch (err) {
    console.error("[conversas] sugerir-resposta:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível gerar uma sugestão agora." });
  }
});

app.post("/api/conversas/:key/reply", async (req, res) => {
  const tenant = req.tenant;
  const creds = resolveCredentials(tenant, req.body);
  if (!creds.instanceId || !creds.instanceToken) return res.status(400).json({ error: "Conexão não configurada." });
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });
  const existing = tenant.conversas.find((m) => m.key === req.params.key);
  const phone = existing ? onlyDigits(existing.phone) : req.params.key;
  try {
    await axios.post(`${zapiBaseUrl(creds)}/send-text`, { phone, message }, { headers: zapiHeaders(creds), timeout: 20000 });
    await recordMessage(tenant, phone, message, "out");
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.error || err.response?.data?.message || err.message });
  }
});

// --- Chatbot por regras ---
app.get("/api/chatbot", (req, res) => res.json(req.tenant.chatbot));

app.put("/api/chatbot", async (req, res) => {
  const tenant = req.tenant;
  const b = req.body || {};
  tenant.chatbot = {
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
  await saveChatbot(tenant);
  res.json({ ok: true, chatbot: tenant.chatbot });
});

// ---------------------------------------------------------------------------
// Visitas em Campo (V2) — só existe em modo Supabase (papéis owner/vendedor).
// Sem Geocoding/Places/Maps JS nesta versão: só lat/long brutas (Geolocation
// do navegador, grátis) + link "abrir no Google Maps" no frontend.
// ---------------------------------------------------------------------------
const VISITA_MOTIVOS = ["Prospecção", "Apresentação", "Negociação", "Pós-venda", "Cobrança", "Suporte", "Outro"];
const VISITA_RESULTADOS = ["Sem contato", "Interessado", "Proposta solicitada", "Em negociação", "Venda fechada", "Retornar depois", "Sem interesse"];

// --- Automações (gatilho->ação sobre eventos do CRM/Visitas) ---
const AUTOMACAO_GATILHOS = {
  mudanca_etapa: { label: "Cliente muda de etapa", valores: CRM_STAGES },
  resultado_visita: { label: "Visita finalizada com resultado", valores: VISITA_RESULTADOS },
};

app.get("/api/automacoes", async (req, res) => {
  if (!USE_SUPABASE) return res.json({ regras: [], gatilhos: AUTOMACAO_GATILHOS });
  try {
    const regras = await repo.automacaoRegrasRepo.listar(req.tenant.empresa.id);
    res.json({ regras, gatilhos: AUTOMACAO_GATILHOS });
  } catch (err) {
    console.error("[automacoes] get:", err.message);
    res.status(500).json({ error: "Não foi possível carregar as automações." });
  }
});

function validarAutomacaoBody(b) {
  const nome = String(b.nome || "").trim().slice(0, 100);
  const gatilhoTipo = Object.keys(AUTOMACAO_GATILHOS).includes(b.gatilhoTipo) ? b.gatilhoTipo : null;
  const gatilhoValor = String(b.gatilhoValor || "");
  const acaoTipo = ["enviar_mensagem", "criar_followup"].includes(b.acaoTipo) ? b.acaoTipo : null;
  const acaoTexto = String(b.acaoTexto || "").trim().slice(0, 2000);
  const acaoDias = acaoTipo === "criar_followup" ? Math.max(0, Math.min(90, Number(b.acaoDias) || 1)) : null;
  if (!nome || !gatilhoTipo || !gatilhoTipo || !acaoTipo || !acaoTexto) return null;
  if (!AUTOMACAO_GATILHOS[gatilhoTipo].valores.includes(gatilhoValor)) return null;
  return { nome, gatilhoTipo, gatilhoValor, acaoTipo, acaoTexto, acaoDias, ativa: b.ativa !== false };
}

app.post("/api/automacoes", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  const regra = validarAutomacaoBody(req.body || {});
  if (!regra) return res.status(400).json({ error: "Preencha nome, gatilho e ação corretamente." });
  try {
    const criada = await repo.automacaoRegrasRepo.criar(req.tenant.empresa.id, regra);
    res.json({ ok: true, regra: criada });
  } catch (err) {
    console.error("[automacoes] post:", err.message);
    res.status(500).json({ error: "Não foi possível salvar. Tente novamente." });
  }
});

app.put("/api/automacoes/:id", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  const regra = validarAutomacaoBody(req.body || {});
  if (!regra) return res.status(400).json({ error: "Preencha nome, gatilho e ação corretamente." });
  try {
    await repo.automacaoRegrasRepo.atualizar(req.tenant.empresa.id, req.params.id, regra);
    res.json({ ok: true });
  } catch (err) {
    console.error("[automacoes] put:", err.message);
    res.status(500).json({ error: "Não foi possível salvar. Tente novamente." });
  }
});

app.delete("/api/automacoes/:id", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  try {
    await repo.automacaoRegrasRepo.excluir(req.tenant.empresa.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[automacoes] delete:", err.message);
    res.status(500).json({ error: "Não foi possível excluir. Tente novamente." });
  }
});
// Categoria visual do resultado (badge) -- poucas cores, não uma por valor.
const RESULTADO_CATEGORIA = {
  "Sem contato": "neutro", "Interessado": "atencao", "Proposta solicitada": "andamento",
  "Em negociação": "andamento", "Venda fechada": "sucesso", "Retornar depois": "atencao", "Sem interesse": "perdido",
};

app.use("/api/visitas", (req, res, next) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Visitas em Campo está disponível apenas no modo multi-empresa (Supabase)." });
  next();
});

function usernameFromPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}
function generateTempPassword() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// Ciclo de vida (V2.1): Iniciar → Durante (PATCH/foto/agendar-retorno) → Finalizar.
app.post("/api/visitas", async (req, res) => {
  const tenant = req.tenant;
  const b = req.body || {};
  const clienteNome = String(b.clienteNome || "").trim();
  if (!clienteNome) return res.status(400).json({ error: "Informe o nome do cliente." });
  try {
    // Se veio um cliente selecionado, confirma no backend que ele existe E
    // pertence à MESMA empresa do vendedor logado -- nunca confia só no ID
    // enviado pelo navegador (empresa A não pode criar visita apontando pra
    // cliente da empresa B, mesmo enviando o ID manualmente).
    let clienteId = null;
    let contatoTelefone = "";
    if (b.clienteId) {
      const cliente = await repo.clientesRepo.getById(tenant.empresa.id, String(b.clienteId));
      if (!cliente) return res.status(400).json({ error: "Cliente não encontrado para esta empresa." });
      clienteId = cliente.id;
      contatoTelefone = cliente.phone || "";
    }
    const existente = await repo.visitasRepo.getEmAndamento(tenant.empresa.id, req.session.uid);
    if (existente) return res.status(400).json({ error: "Você já tem uma visita em andamento. Finalize-a antes de iniciar outra." });
    const visita = await repo.visitasRepo.create(tenant.empresa.id, req.session.uid, {
      clienteId,
      clienteNome,
      contatoTelefone,
      objetivo: String(b.objetivo || "").trim().slice(0, 200),
      latitude: typeof b.latitude === "number" ? b.latitude : null,
      longitude: typeof b.longitude === "number" ? b.longitude : null,
    });
    res.json({ ok: true, visita });
  } catch (err) {
    console.error("[visitas] create:", err.message);
    res.status(500).json({ error: "Não foi possível iniciar a visita." });
  }
});

// Busca simples de cliente existente (nome ou telefone) pra selecionar ao
// iniciar uma visita. Sob /api/visitas/* de propósito: é o único prefixo que
// o papel "vendedor" já tem acesso -- não amplia a permissão dele pra
// /api/clients (que continua bloqueado pro vendedor).
app.get("/api/visitas/clientes-busca", (req, res) => {
  const tenant = req.tenant;
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.json({ clientes: [] });
  const clientes = tenant.clients
    .filter((c) => {
      const nome = resolveName(tenant, c.phone, c.name);
      return `${nome} ${c.phone}`.toLowerCase().includes(q);
    })
    .slice(0, 20)
    .map((c) => ({ id: c.id, name: resolveName(tenant, c.phone, c.name), phone: c.phone }));
  res.json({ clientes });
});

app.get("/api/visitas/em-andamento", async (req, res) => {
  try {
    const visita = await repo.visitasRepo.getEmAndamento(req.tenant.empresa.id, req.session.uid);
    res.json({ visita });
  } catch (err) {
    console.error("[visitas] em-andamento:", err.message);
    res.status(500).json({ error: "Não foi possível verificar a visita em andamento." });
  }
});

/** Carrega a visita e confere posse (vendedor só mexe na própria; dono mexe em qualquer uma). Devolve null e já responde o erro se não puder. */
async function carregarVisitaComPermissao(req, res) {
  const visita = await repo.visitasRepo.getById(req.tenant.empresa.id, req.params.id);
  if (!visita) { res.status(404).json({ error: "Visita não encontrada." }); return null; }
  if (req.session.role === "vendedor" && visita.vendedorId !== req.session.uid) {
    res.status(403).json({ error: "Acesso restrito." });
    return null;
  }
  return visita;
}

app.patch("/api/visitas/:id", async (req, res) => {
  const b = req.body || {};
  try {
    const visita = await carregarVisitaComPermissao(req, res);
    if (!visita) return;
    const patch = {};
    if (b.contatoNome !== undefined) patch.contatoNome = String(b.contatoNome).trim().slice(0, 80);
    if (b.contatoTelefone !== undefined) patch.contatoTelefone = String(b.contatoTelefone).trim().slice(0, 30);
    if (b.observacao !== undefined) patch.observacao = String(b.observacao).slice(0, 2000);
    if (b.proximaAcao !== undefined) patch.proximaAcao = String(b.proximaAcao).slice(0, 500);
    if (b.valorPotencial !== undefined) patch.valorPotencial = typeof b.valorPotencial === "number" ? b.valorPotencial : null;
    const atualizada = await repo.visitasRepo.update(req.tenant.empresa.id, req.params.id, patch);
    res.json({ ok: true, visita: atualizada });
  } catch (err) {
    console.error("[visitas] update:", err.message);
    res.status(500).json({ error: "Não foi possível salvar." });
  }
});

// Agenda o retorno e, se o Google estiver conectado, já cria o evento na Agenda.
app.post("/api/visitas/:id/agendar-retorno", async (req, res) => {
  const data = String(req.body?.data || "");
  const hora = /^\d{2}:\d{2}$/.test(req.body?.hora) ? req.body.hora : "09:00";
  const proximaAcao = String(req.body?.proximaAcao || "").trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Data inválida." });
  try {
    const visita = await carregarVisitaComPermissao(req, res);
    if (!visita) return;
    let googleEventoId;
    const accessToken = await obterConexaoGoogle(req.tenant.empresa.id);
    if (accessToken) {
      const inicio = new Date(`${data}T${hora}:00`);
      const fim = new Date(inicio.getTime() + 30 * 60 * 1000);
      try {
        const evento = await googleClient.criarEvento(accessToken, {
          titulo: `Retorno — ${visita.clienteNome}`,
          descricao: proximaAcao || visita.objetivo || undefined,
          inicio: inicio.toISOString(), fim: fim.toISOString(),
        });
        googleEventoId = evento.id;
      } catch (err) {
        console.error("[visitas] agendar-retorno (calendar):", err.response?.data?.error || err.message);
        // Segue sem o evento — a data local já vale, não bloqueia o vendedor por causa disso.
      }
    }
    const atualizada = await repo.visitasRepo.update(req.tenant.empresa.id, req.params.id, {
      proximaVisitaData: data, proximaVisitaHora: hora, proximaAcao, ...(googleEventoId ? { googleEventoId } : {}),
    });
    res.json({ ok: true, visita: atualizada, calendarioCriado: Boolean(googleEventoId) });
  } catch (err) {
    console.error("[visitas] agendar-retorno:", err.message);
    res.status(500).json({ error: "Não foi possível agendar o retorno." });
  }
});

app.post("/api/visitas/:id/foto", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhuma imagem enviada." });
  try {
    const visita = await carregarVisitaComPermissao(req, res);
    if (!visita) return;
    const accessToken = await obterConexaoGoogle(req.tenant.empresa.id);
    if (!accessToken) return res.status(400).json({ error: "Conecte sua conta Google primeiro (aba Calendário) pra guardar fotos." });
    const nome = `ZapFlow - ${visita.clienteNome} - ${Date.now()}.jpg`;
    const { url } = await googleClient.uploadArquivo(accessToken, {
      nome, mimeType: req.file.mimetype || "image/jpeg", buffer: req.file.buffer,
    });
    const fotos = [...visita.fotos, { url, nome }];
    const atualizada = await repo.visitasRepo.update(req.tenant.empresa.id, req.params.id, { fotos });
    res.json({ ok: true, visita: atualizada });
  } catch (err) {
    console.error("[visitas] foto:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível enviar a foto." });
  }
});

// Resumo com IA (V1 IA item 5): transforma a observação livre do vendedor em
// resultado/próxima ação sugeridos -- a IA só sugere, o vendedor decide e
// aplica manualmente nos campos de "Finalizar visita" (controle humano).
app.post("/api/visitas/:id/ia-resumo", async (req, res) => {
  if (!openaiClient.openaiConfigured) {
    return res.status(400).json({ error: "Integração com IA ainda não foi configurada (OPENAI_API_KEY)." });
  }
  const tenant = req.tenant;
  try {
    const visita = await carregarVisitaComPermissao(req, res);
    if (!visita) return;
    const observacao = String(req.body?.observacao ?? visita.observacao ?? "").trim();
    if (!observacao) return res.status(400).json({ error: "Escreva alguma observação da visita antes de pedir o resumo." });
    const contexto = `Observações registradas pelo vendedor durante uma visita comercial ao cliente "${visita.clienteNome}":\n"${observacao}"` +
      (visita.valorPotencial != null ? `\nValor potencial já informado: R$ ${visita.valorPotencial}` : "");
    const instrucao = `${contexto}\n\nResponda APENAS com um JSON válido (sem markdown, sem texto antes ou depois), no formato exato:\n{"resumo": "resumo comercial curto em 1-2 frases", "resultado": "um destes valores exatos -- Sem contato, Interessado, Proposta solicitada, Em negociação, Venda fechada, Retornar depois, Sem interesse", "proximaAcao": "sugestão curta do que fazer a seguir, ou string vazia se não houver nada a sugerir"}`;
    const perfil = await repo.configuracoesIaRepo.get(tenant.empresa.id);
    const baseConhecimento = USE_SUPABASE ? await repo.companyKnowledgeRepo.listar(tenant.empresa.id) : [];
    const input = montarInput({ perfilEmpresa: perfil, empresaNome: tenant.empresa.name, historico: [], mensagemUsuario: instrucao, baseConhecimento });
    // Extração estruturada (texto -> JSON) é tarefa "simples" no roteador -- usa Luna.
    const { textoFinal, usage } = await openaiClient.executarComFerramentas({ model: openaiClient.MODELOS.simples, input, tools: [], executores: {} });
    await repo.iaConsumoRepo.registrar(tenant.empresa.id, req.session.uid, {
      modelo: openaiClient.MODELOS.simples, acao: "resumir_visita",
      tokensEntrada: usage.tokensEntrada, tokensSaida: usage.tokensSaida,
      estimatedCost: openaiClient.calcularCustoEstimado(openaiClient.MODELOS.simples, usage.tokensEntrada, usage.tokensSaida),
    });
    let sugestao;
    try {
      sugestao = JSON.parse(textoFinal.trim().replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return res.json({ resumo: textoFinal.trim(), resultado: null, proximaAcao: null });
    }
    const resultado = VISITA_RESULTADOS.includes(sugestao.resultado) ? sugestao.resultado : null;
    res.json({
      resumo: String(sugestao.resumo || "").slice(0, 500),
      resultado,
      proximaAcao: String(sugestao.proximaAcao || "").slice(0, 200) || null,
    });
  } catch (err) {
    console.error("[visitas] ia-resumo:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível gerar o resumo agora." });
  }
});

app.post("/api/visitas/:id/finalizar", async (req, res) => {
  const motivo = String(req.body?.motivo || "");
  const resultado = String(req.body?.resultado || "");
  if (!VISITA_MOTIVOS.includes(motivo)) return res.status(400).json({ error: "Motivo inválido." });
  if (!VISITA_RESULTADOS.includes(resultado)) return res.status(400).json({ error: "Resultado inválido." });
  try {
    const visita = await carregarVisitaComPermissao(req, res);
    if (!visita) return;
    if (visita.finishedAt) return res.status(400).json({ error: "Essa visita já foi finalizada." });
    const finalizada = await repo.visitasRepo.finalizar(req.tenant.empresa.id, req.params.id, { motivo, resultado });
    // Prioriza a relação explícita (clienteId); telefone é só fallback pra
    // visitas antigas sem clienteId. Best-effort: só dispara se achar cliente.
    const clienteDaVisita = visita.clienteId
      ? req.tenant.clients.find((c) => c.id === visita.clienteId)
      : (visita.contatoTelefone ? findClient(req.tenant, visita.contatoTelefone) : null);
    if (clienteDaVisita) dispararAutomacoes(req.tenant, "resultado_visita", resultado, clienteDaVisita).catch(() => {});
    res.json({ ok: true, visita: finalizada });
  } catch (err) {
    console.error("[visitas] finalizar:", err.message);
    res.status(500).json({ error: "Não foi possível finalizar a visita." });
  }
});

// Números da tela "Hoje". Vendedor: só os dele. Dono: a empresa inteira + conversas/compromissos.
app.get("/api/visitas/resumo", async (req, res) => {
  const tenant = req.tenant;
  try {
    if (req.session.role === "owner") {
      const [resumo, vendedoresAtivos] = await Promise.all([
        repo.visitasRepo.resumoDia(tenant.empresa.id, null),
        repo.usuariosRepo.countVendedores(tenant.empresa.id),
      ]);
      const conversasAguardando = tenant.conversas.reduce((set, m) => {
        // última mensagem por contato é "in" (recebida) => aguardando resposta
        const atual = set.get(m.key);
        if (!atual || m.ts > atual.ts) set.set(m.key, m);
        return set;
      }, new Map());
      const aguardando = [...conversasAguardando.values()].filter((m) => m.dir === "in").length;
      let compromissosHoje = 0;
      const accessToken = await obterConexaoGoogle(tenant.empresa.id).catch(() => null);
      if (accessToken) {
        try {
          const eventos = await googleClient.listarEventos(accessToken);
          const hojeStr = new Date().toISOString().slice(0, 10);
          compromissosHoje = eventos.filter((e) => String(e.inicio || "").startsWith(hojeStr)).length;
        } catch { /* Calendar fora do ar não deve quebrar o resumo */ }
      }
      return res.json({ ...resumo, conversasAguardando: aguardando, compromissosHoje, vendedoresAtivos });
    }
    const resumo = await repo.visitasRepo.resumoDia(tenant.empresa.id, req.session.uid);
    res.json(resumo);
  } catch (err) {
    console.error("[visitas] resumo:", err.message);
    res.status(500).json({ error: "Não foi possível carregar o resumo." });
  }
});

// Desempenho da equipe por período, agrupado por vendedor (Item 5.10 — só o dono).
/** Agregação de desempenho por vendedor -- compartilhada entre a tela de Visitas (owner) e a tool da IA. */
async function agregarDesempenhoEquipe(tenant, period) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let desde = dayStart;
  if (period === "7d") { desde = new Date(dayStart); desde.setDate(desde.getDate() - 6); }
  else if (period === "30d") { desde = new Date(dayStart); desde.setDate(desde.getDate() - 29); }
  else if (period === "mes") desde = new Date(now.getFullYear(), now.getMonth(), 1);

  const [rows, vendedores] = await Promise.all([
    repo.visitasRepo.listarParaResumoEquipe(tenant.empresa.id, { desde: desde.toISOString() }),
    repo.usuariosRepo.listVendedores(tenant.empresa.id),
  ]);
  const porVendedor = new Map();
  for (const v of vendedores) {
    porVendedor.set(v.id, {
      vendedorId: v.id, vendedorNome: v.name || v.username, visitas: 0, concluidas: 0, pendentes: 0, potencial: 0, followups: 0,
      clientesResponsaveis: 0, followupsAtrasados: 0, clientesAtencao: [],
    });
  }
  const total = { visitas: 0, concluidas: 0, pendentes: 0, potencial: 0, followups: 0 };
  const abertos = ["Interessado", "Proposta solicitada", "Em negociação"];
  for (const r of rows) {
    let alvo = porVendedor.get(r.vendedor_id);
    if (!alvo) {
      alvo = {
        vendedorId: r.vendedor_id, vendedorNome: "Ex-vendedor", visitas: 0, concluidas: 0, pendentes: 0, potencial: 0, followups: 0,
        clientesResponsaveis: 0, followupsAtrasados: 0, clientesAtencao: [],
      };
      porVendedor.set(r.vendedor_id, alvo);
    }
    alvo.visitas++; total.visitas++;
    if (r.finished_at) { alvo.concluidas++; total.concluidas++; } else { alvo.pendentes++; total.pendentes++; }
    if (r.valor_potencial != null && abertos.includes(r.resultado)) { alvo.potencial += Number(r.valor_potencial) || 0; total.potencial += Number(r.valor_potencial) || 0; }
    if (r.resultado === "Retornar depois") { alvo.followups++; total.followups++; }
  }

  // Carteira de clientes (CRM) por vendedor responsável -- independente do
  // período de visitas acima, é "estado atual", não histórico.
  const hojeStr = new Date().toISOString().slice(0, 10);
  for (const c of tenant.clients) {
    if (!c.vendedorResponsavelId) continue;
    const alvo = porVendedor.get(c.vendedorResponsavelId);
    if (!alvo) continue; // vendedor desativado/removido -- não conta na carteira ativa
    alvo.clientesResponsaveis++;
    if (c.proximaAcaoData && c.proximaAcaoData < hojeStr) {
      alvo.followupsAtrasados++;
      if (alvo.clientesAtencao.length < 5) {
        alvo.clientesAtencao.push({ id: c.id, name: resolveName(tenant, c.phone, c.name), proximaAcaoTexto: c.proximaAcaoTexto, proximaAcaoData: c.proximaAcaoData });
      }
    }
  }

  return { period, total, vendedores: [...porVendedor.values()].sort((a, b) => b.visitas - a.visitas) };
}

app.get("/api/visitas/equipe", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  try {
    res.json(await agregarDesempenhoEquipe(req.tenant, String(req.query.period || "hoje")));
  } catch (err) {
    console.error("[visitas] equipe:", err.message);
    res.status(500).json({ error: "Não foi possível carregar o desempenho da equipe." });
  }
});

// Escopo (mine|todas) decidido pelo servidor a partir do papel — nunca por
// parâmetro do cliente, senão um vendedor poderia pedir os dados da equipe.
// Outras visitas ao mesmo cliente (histórico relacionado, achado da auditoria
// -- Item 5.E). Escopo mine/todas segue a mesma regra do resto de /api/visitas.
app.get("/api/visitas/relacionadas", async (req, res) => {
  const tenant = req.tenant;
  const telefone = String(req.query.telefone || "");
  const excluir = String(req.query.excluir || "");
  const key = phoneKey(telefone);
  if (!key) return res.json({ visitas: [] });
  try {
    const todas = req.session.role === "owner"
      ? await repo.visitasRepo.listForEmpresa(tenant.empresa.id, "historico")
      : await repo.visitasRepo.listForVendedor(tenant.empresa.id, req.session.uid, "historico");
    const relacionadas = todas
      .filter((v) => v.id !== excluir && v.contatoTelefone && phoneKey(v.contatoTelefone) === key)
      .sort((a, b) => b.dataHora - a.dataHora)
      .slice(0, 5)
      .map((v) => ({ id: v.id, dataHora: v.dataHora, resultado: v.resultado, motivo: v.motivo }));
    res.json({ visitas: relacionadas });
  } catch (err) {
    console.error("[visitas] relacionadas:", err.message);
    res.status(500).json({ error: "Não foi possível carregar o histórico." });
  }
});

app.get("/api/visitas", async (req, res) => {
  const tenant = req.tenant;
  const tab = ["hoje", "followup"].includes(req.query.tab) ? req.query.tab : "historico";
  try {
    if (req.session.role === "owner") {
      const [visitas, vendedores] = await Promise.all([
        repo.visitasRepo.listForEmpresa(tenant.empresa.id, tab),
        repo.usuariosRepo.listVendedores(tenant.empresa.id),
      ]);
      const nomesPorId = new Map(vendedores.map((v) => [v.id, v.name || v.username]));
      const enriched = visitas.map((v) => ({ ...v, vendedorNome: nomesPorId.get(v.vendedorId) || "Você" }));
      return res.json({ visitas: enriched });
    }
    const visitas = await repo.visitasRepo.listForVendedor(tenant.empresa.id, req.session.uid, tab);
    res.json({ visitas });
  } catch (err) {
    console.error("[visitas] list:", err.message);
    res.status(500).json({ error: "Não foi possível carregar as visitas." });
  }
});

// Envia uma mensagem de WhatsApp avulsa pro contato de UMA visita específica
// (não é campanha em massa — por isso fica liberado pro papel vendedor).
// Preparar mensagem de follow-up com IA (V1 IA item 6) -- só sugere o texto,
// quem envia é sempre o botão "Enviar" já existente (fluxo humano intacto).
app.post("/api/visitas/:id/preparar-followup", async (req, res) => {
  if (!openaiClient.openaiConfigured) {
    return res.status(400).json({ error: "Integração com IA ainda não foi configurada (OPENAI_API_KEY)." });
  }
  const tenant = req.tenant;
  try {
    const visita = await carregarVisitaComPermissao(req, res);
    if (!visita) return;
    const contexto = `Visita comercial ao cliente "${visita.clienteNome}".` +
      (visita.motivo ? `\nMotivo da visita: ${visita.motivo}.` : "") +
      (visita.resultado ? `\nResultado: ${visita.resultado}.` : "") +
      (visita.observacao ? `\nObservações do vendedor: ${visita.observacao}` : "") +
      (visita.proximaAcao ? `\nPróxima ação combinada: ${visita.proximaAcao}` : "");
    const instrucao = `${contexto}\n\nEscreva uma mensagem curta de WhatsApp pra retomar contato com esse cliente, dando continuidade à visita. Responda APENAS com o texto da mensagem, sem aspas, sem explicações antes ou depois.`;
    const perfil = await repo.configuracoesIaRepo.get(tenant.empresa.id);
    const baseConhecimento = USE_SUPABASE ? await repo.companyKnowledgeRepo.listar(tenant.empresa.id) : [];
    const input = montarInput({ perfilEmpresa: perfil, empresaNome: tenant.empresa.name, historico: [], mensagemUsuario: instrucao, baseConhecimento });
    const { textoFinal, usage } = await openaiClient.executarComFerramentas({ model: openaiClient.MODELOS.padrao, input, tools: [], executores: {} });
    await repo.iaConsumoRepo.registrar(tenant.empresa.id, req.session.uid, {
      modelo: openaiClient.MODELOS.padrao, acao: "preparar_followup",
      tokensEntrada: usage.tokensEntrada, tokensSaida: usage.tokensSaida,
      estimatedCost: openaiClient.calcularCustoEstimado(openaiClient.MODELOS.padrao, usage.tokensEntrada, usage.tokensSaida),
    });
    res.json({ mensagem: textoFinal.trim() });
  } catch (err) {
    console.error("[visitas] preparar-followup:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível preparar a mensagem agora." });
  }
});

app.post("/api/visitas/:id/followup", async (req, res) => {
  const tenant = req.tenant;
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Escreva uma mensagem." });
  try {
    const visita = await repo.visitasRepo.getById(tenant.empresa.id, req.params.id);
    if (!visita) return res.status(404).json({ error: "Visita não encontrada." });
    if (req.session.role === "vendedor" && visita.vendedorId !== req.session.uid) {
      return res.status(403).json({ error: "Acesso restrito." });
    }
    const phone = onlyDigits(visita.contatoTelefone);
    if (!phoneKey(phone)) return res.status(400).json({ error: "Essa visita não tem um telefone de contato válido." });
    const creds = resolveCredentials(tenant, {});
    if (!creds.instanceId || !creds.instanceToken) {
      return res.status(400).json({ error: "WhatsApp não configurado para esta empresa." });
    }
    await axios.post(`${zapiBaseUrl(creds)}/send-text`, { phone, message }, { headers: zapiHeaders(creds), timeout: 20000 });
    await recordMessage(tenant, phone, message, "out");
    res.json({ ok: true });
  } catch (err) {
    console.error("[visitas] followup:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível enviar a mensagem." });
  }
});

// Atividade recente (Item 8.12 — auditoria básica, só leitura, só o dono)
app.get("/api/auditoria", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  if (!USE_SUPABASE) return res.json({ eventos: [] });
  try {
    const eventos = await repo.auditoriaRepo.listar(req.tenant.empresa.id, 20);
    res.json({ eventos });
  } catch (err) {
    console.error("[auditoria] listar:", err.message);
    res.status(500).json({ error: "Não foi possível carregar a atividade recente." });
  }
});

// --- Gestão de vendedores (só o dono) ---
app.get("/api/visitas/vendedores", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  try {
    const vendedores = (await repo.usuariosRepo.listVendedores(req.tenant.empresa.id))
      .map(({ passwordHash, ...v }) => v); // nunca manda o hash da senha pro navegador, mesmo do dono
    res.json({ vendedores, maxVendedores: req.tenant.empresa.maxVendedores });
  } catch (err) {
    console.error("[visitas] listVendedores:", err.message);
    res.status(500).json({ error: "Não foi possível carregar os vendedores." });
  }
});

app.post("/api/visitas/vendedores", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  const tenant = req.tenant;
  const name = String(req.body?.name || "").trim();
  const phone = String(req.body?.phone || "").trim();
  if (!name) return res.status(400).json({ error: "Informe o nome do vendedor." });
  if (!phoneKey(phone)) return res.status(400).json({ error: "Telefone inválido. Inclua o DDD." });
  try {
    const atual = await repo.usuariosRepo.countVendedores(tenant.empresa.id);
    if (atual >= tenant.empresa.maxVendedores) {
      return res.status(400).json({ error: `Limite de ${tenant.empresa.maxVendedores} vendedores atingido no seu plano.` });
    }
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    let username = usernameFromPhone(phone);
    let vendedor = null;
    for (let tentativa = 0; tentativa < 5 && !vendedor; tentativa++) {
      try {
        vendedor = await repo.usuariosRepo.create({
          empresaId: tenant.empresa.id, username, passwordHash, role: "vendedor", name, phone,
        });
      } catch (err) {
        // username já existe (é único globalmente, não só por empresa) — tenta um sufixo novo
        if (err.supabase?.code !== "23505") throw err;
        username = usernameFromPhone(phone) + crypto.randomBytes(2).toString("hex");
      }
    }
    if (!vendedor) return res.status(500).json({ error: "Não foi possível gerar um usuário disponível. Tente novamente." });
    repo.auditoriaRepo.registrar(tenant.empresa.id, {
      atorNome: req.session.name, atorPapel: req.session.role, acao: `Cadastrou o vendedor ${name}`,
    }).catch(() => {});
    res.json({ ok: true, vendedor, tempPassword });
  } catch (err) {
    console.error("[visitas] createVendedor:", err.message);
    res.status(500).json({ error: "Não foi possível cadastrar o vendedor." });
  }
});

app.delete("/api/visitas/vendedores/:id", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  try {
    const tenant = req.tenant;
    const vendedores = await repo.usuariosRepo.listVendedores(tenant.empresa.id);
    const alvo = vendedores.find((v) => v.id === req.params.id);
    await repo.usuariosRepo.deactivate(tenant.empresa.id, req.params.id);
    repo.auditoriaRepo.registrar(tenant.empresa.id, {
      atorNome: req.session.name, atorPapel: req.session.role,
      acao: `Desativou o vendedor ${alvo ? (alvo.name || alvo.username) : req.params.id}`,
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error("[visitas] deactivateVendedor:", err.message);
    res.status(500).json({ error: "Não foi possível desativar o vendedor." });
  }
});

// ---------------------------------------------------------------------------
// Google conectado (V3) — OAuth por empresa, o próprio dono conecta a conta.
// Calendar de uso geral + exportação de Clientes/Visitas pra planilha nova
// (a planilha já fica no Drive automaticamente, escopo drive.file).
// ---------------------------------------------------------------------------
/** Devolve um access token válido pra empresa (renova e persiste sozinho quando preciso), ou null se não conectada. */
async function obterConexaoGoogle(empresaId) {
  const conexao = await repo.googleRepo.get(empresaId);
  if (!conexao) return null;
  const { accessToken, renovado, tokenExpiry } = await googleClient.obterAccessTokenValido(conexao);
  if (renovado) await repo.googleRepo.updateAccessToken(empresaId, { accessToken, tokenExpiry });
  return accessToken;
}

app.get("/auth/google/connect", (req, res) => {
  if (req.session.role !== "owner") return res.status(403).send("Acesso restrito.");
  if (!googleClient.googleOAuthConfigured) {
    return res.status(500).send("Integração com o Google ainda não foi configurada (GOOGLE_CLIENT_ID/SECRET/PUBLIC_URL).");
  }
  res.redirect(googleClient.buildAuthUrl(req.tenant.empresa.id));
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  if (oauthError) return res.redirect("/dashboard.html?view=calendario&google=erro");
  const empresaIdDoState = googleClient.validarState(state);
  if (!empresaIdDoState || empresaIdDoState !== req.tenant?.empresa?.id) {
    return res.redirect("/dashboard.html?view=calendario&google=erro");
  }
  try {
    const tokens = await googleClient.trocarCodigoPorTokens(code);
    const email = await googleClient.buscarEmailConectado(tokens.access_token).catch(() => null);
    await repo.googleRepo.save(req.tenant.empresa.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
      scope: tokens.scope || "",
      connectedEmail: email,
    });
    res.redirect("/dashboard.html?view=calendario&google=ok");
  } catch (err) {
    console.error("[google] callback:", err.response?.data || err.message);
    res.redirect("/dashboard.html?view=calendario&google=erro");
  }
});

app.post("/api/google/disconnect", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  try {
    await repo.googleRepo.clear(req.tenant.empresa.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[google] disconnect:", err.message);
    res.status(500).json({ error: "Não foi possível desconectar." });
  }
});

app.get("/api/google/status", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  try {
    const conexao = await repo.googleRepo.get(req.tenant.empresa.id);
    res.json({ connected: Boolean(conexao), email: conexao?.connectedEmail || null, configured: googleClient.googleOAuthConfigured });
  } catch (err) {
    console.error("[google] status:", err.message);
    res.status(500).json({ error: "Não foi possível verificar a conexão." });
  }
});

app.get("/api/calendario/eventos", async (req, res) => {
  try {
    const accessToken = await obterConexaoGoogle(req.tenant.empresa.id);
    if (!accessToken) return res.status(400).json({ error: "Conecte sua conta Google primeiro." });
    const eventos = await googleClient.listarEventos(accessToken);
    res.json({ eventos });
  } catch (err) {
    console.error("[google] listar eventos:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível carregar os eventos." });
  }
});

app.post("/api/calendario/eventos", async (req, res) => {
  const { titulo, inicio, fim, descricao, origem } = req.body || {};
  if (!titulo || !inicio || !fim) return res.status(400).json({ error: "Preencha título, início e fim." });
  try {
    const accessToken = await obterConexaoGoogle(req.tenant.empresa.id);
    if (!accessToken) return res.status(400).json({ error: "Conecte sua conta Google primeiro." });
    const evento = await googleClient.criarEvento(accessToken, { titulo, inicio, fim, descricao });
    if (origem === "ia" && USE_SUPABASE) {
      repo.auditoriaRepo.registrar(req.tenant.empresa.id, {
        atorNome: req.session.name, atorPapel: req.session.role,
        acao: `Zappy IA criou o compromisso "${titulo}" na Google Agenda (confirmado por ${req.session.name || "usuário"})`,
      }).catch(() => {});
    }
    res.json({ ok: true, evento });
  } catch (err) {
    console.error("[google] criar evento:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível criar o evento." });
  }
});

// Exporta as visitas da equipe pra uma planilha Google nova.
app.post("/api/visitas/exportar-planilha", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  const tenant = req.tenant;
  const period = String(req.body?.period || "");
  const vendedorId = req.body?.vendedorId || null;
  try {
    const accessToken = await obterConexaoGoogle(tenant.empresa.id);
    if (!accessToken) return res.status(400).json({ error: "Conecte sua conta Google na aba Calendário primeiro." });
    const [todas, vendedores] = await Promise.all([
      repo.visitasRepo.listForEmpresa(tenant.empresa.id),
      repo.usuariosRepo.listVendedores(tenant.empresa.id),
    ]);
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let desde = null;
    if (period === "7d") { desde = new Date(dayStart); desde.setDate(desde.getDate() - 6); }
    else if (period === "30d") { desde = new Date(dayStart); desde.setDate(desde.getDate() - 29); }
    else if (period === "mes") desde = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (period === "hoje") desde = dayStart;
    const visitas = todas.filter((v) => (!desde || v.dataHora >= desde.getTime()) && (!vendedorId || v.vendedorId === vendedorId));
    const nomesPorId = new Map(vendedores.map((v) => [v.id, v.name || v.username]));

    // Resumo por vendedor primeiro (visão de relatório), depois o detalhe linha a linha.
    const porVendedor = new Map();
    for (const v of visitas) {
      const nome = nomesPorId.get(v.vendedorId) || "Você";
      const alvo = porVendedor.get(nome) || { visitas: 0, concluidas: 0, potencial: 0, followups: 0 };
      alvo.visitas++;
      if (v.finishedAt) alvo.concluidas++;
      if (v.valorPotencial != null && ["Interessado", "Proposta solicitada", "Em negociação"].includes(v.resultado)) alvo.potencial += Number(v.valorPotencial) || 0;
      if (v.resultado === "Retornar depois") alvo.followups++;
      porVendedor.set(nome, alvo);
    }
    const resumoLinhas = [["Vendedor", "Visitas", "Concluídas", "Potencial (R$)", "Follow-ups"]];
    for (const [nome, r] of porVendedor) resumoLinhas.push([nome, r.visitas, r.concluidas, r.potencial.toFixed(2), r.followups]);

    const linhas = [["Cliente", "Vendedor", "Contato", "Telefone", "Motivo", "Resultado", "Observação", "Próxima ação", "Próxima visita", "Data da visita"]];
    visitas.forEach((v) => {
      linhas.push([
        v.clienteNome, nomesPorId.get(v.vendedorId) || "Você", v.contatoNome || "", v.contatoTelefone || "",
        v.motivo, v.resultado, v.observacao || "", v.proximaAcao || "", v.proximaVisitaData || "",
        new Date(v.dataHora).toLocaleString("pt-BR"),
      ]);
    });
    const tituloPeriodo = { hoje: "Hoje", "7d": "7 dias", "30d": "30 dias", mes: "Este mês" }[period] || "Tudo";
    const todasLinhas = [...resumoLinhas, [], ...linhas];
    const { url } = await googleClient.criarPlanilha(accessToken, `ZapFlow - Visitas (${tituloPeriodo}) - ${new Date().toLocaleDateString("pt-BR")}`, todasLinhas);
    res.json({ ok: true, url });
  } catch (err) {
    console.error("[google] exportar visitas:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível exportar a planilha." });
  }
});

// ---------------------------------------------------------------------------
// Zappy IA (V4) — fundação + assistente. Só owner, só quando OPENAI_API_KEY
// estiver configurada. A IA nunca envia campanha/mensagem sozinha: no máximo
// cria um evento no Calendar (aditivo) ou devolve um RASCUNHO de campanha que
// cai no fluxo de Nova Campanha já existente, exigindo confirmação manual.
// ---------------------------------------------------------------------------
app.use("/api/ia", (req, res, next) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  next();
});

app.get("/api/ia/configuracao", async (req, res) => {
  try {
    const perfil = await repo.configuracoesIaRepo.get(req.tenant.empresa.id);
    res.json({ perfil, iaConfigurada: openaiClient.openaiConfigured });
  } catch (err) {
    console.error("[ia] configuracao get:", err.message);
    res.status(500).json({ error: "Não foi possível carregar a configuração." });
  }
});

app.put("/api/ia/configuracao", async (req, res) => {
  const b = req.body || {};
  try {
    await repo.configuracoesIaRepo.save(req.tenant.empresa.id, {
      segmento: String(b.segmento || "").slice(0, 200),
      descricao: String(b.descricao || "").slice(0, 2000),
      produtosServicos: String(b.produtosServicos || "").slice(0, 2000),
      publicoAlvo: String(b.publicoAlvo || "").slice(0, 500),
      regiao: String(b.regiao || "").slice(0, 200),
      diferenciais: String(b.diferenciais || "").slice(0, 1000),
      tomComunicacao: String(b.tomComunicacao || "").slice(0, 500),
      condicoesComerciais: String(b.condicoesComerciais || "").slice(0, 2000),
      clienteIdeal: String(b.clienteIdeal || "").slice(0, 500),
      prazo: String(b.prazo || "").slice(0, 300),
      garantias: String(b.garantias || "").slice(0, 1000),
      politicas: String(b.politicas || "").slice(0, 2000),
      palavrasEvitar: String(b.palavrasEvitar || "").slice(0, 500),
      site: String(b.site || "").slice(0, 200),
      instagram: String(b.instagram || "").slice(0, 100),
      observacoesIa: String(b.observacoesIa || "").slice(0, 1000),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[ia] configuracao put:", err.message);
    res.status(500).json({ error: "Não foi possível salvar a configuração." });
  }
});

// Base de conhecimento por empresa (achado da auditoria -- ver comentário em
// montarInput/formatarBaseConhecimento sobre como isso é injetado no prompt).
const CONHECIMENTO_CATEGORIAS = ["Sobre a empresa", "Produtos", "Serviços", "Diferenciais", "Perguntas frequentes", "Políticas", "Garantias", "Condições comerciais", "Catálogos", "Materiais comerciais", "Documentos"];

app.get("/api/ia/conhecimento", async (req, res) => {
  if (!USE_SUPABASE) return res.json({ itens: [], categorias: CONHECIMENTO_CATEGORIAS });
  try {
    const itens = await repo.companyKnowledgeRepo.listar(req.tenant.empresa.id);
    res.json({ itens, categorias: CONHECIMENTO_CATEGORIAS });
  } catch (err) {
    console.error("[ia] conhecimento get:", err.message);
    res.status(500).json({ error: "Não foi possível carregar a base de conhecimento." });
  }
});

app.post("/api/ia/conhecimento", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  const b = req.body || {};
  const titulo = String(b.titulo || "").trim().slice(0, 150);
  const categoria = CONHECIMENTO_CATEGORIAS.includes(b.categoria) ? b.categoria : CONHECIMENTO_CATEGORIAS[0];
  if (!titulo) return res.status(400).json({ error: "Dê um título pra esse item." });
  try {
    const item = await repo.companyKnowledgeRepo.criar(req.tenant.empresa.id, {
      categoria, titulo, conteudo: String(b.conteudo || "").slice(0, 8000),
    });
    res.json({ ok: true, item });
  } catch (err) {
    console.error("[ia] conhecimento post:", err.message);
    res.status(500).json({ error: "Não foi possível salvar. Tente novamente." });
  }
});

app.put("/api/ia/conhecimento/:id", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  const b = req.body || {};
  const titulo = String(b.titulo || "").trim().slice(0, 150);
  const categoria = CONHECIMENTO_CATEGORIAS.includes(b.categoria) ? b.categoria : CONHECIMENTO_CATEGORIAS[0];
  if (!titulo) return res.status(400).json({ error: "Dê um título pra esse item." });
  try {
    await repo.companyKnowledgeRepo.atualizar(req.tenant.empresa.id, req.params.id, {
      categoria, titulo, conteudo: String(b.conteudo || "").slice(0, 8000),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[ia] conhecimento put:", err.message);
    res.status(500).json({ error: "Não foi possível salvar. Tente novamente." });
  }
});

app.delete("/api/ia/conhecimento/:id", async (req, res) => {
  if (!USE_SUPABASE) return res.status(501).json({ error: "Disponível apenas no modo multi-empresa (Supabase)." });
  try {
    await repo.companyKnowledgeRepo.excluir(req.tenant.empresa.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ia] conhecimento delete:", err.message);
    res.status(500).json({ error: "Não foi possível excluir. Tente novamente." });
  }
});

/** Extrai o bloco [RASCUNHO_CAMPANHA]{...} do texto final, se existir. Devolve { texto, rascunho }. */
function extrairRascunhoCampanha(textoFinal) {
  const marca = "[RASCUNHO_CAMPANHA]";
  const idx = textoFinal.indexOf(marca);
  if (idx === -1) return { texto: textoFinal, rascunho: null };
  const texto = textoFinal.slice(0, idx).trim();
  try {
    const rascunho = JSON.parse(textoFinal.slice(idx + marca.length).trim());
    if (!rascunho.mensagem || !Array.isArray(rascunho.telefones)) return { texto, rascunho: null };
    return { texto, rascunho };
  } catch {
    return { texto, rascunho: null };
  }
}

/** Extrai o bloco [RASCUNHO_EVENTO]{...} do texto final, se existir. Devolve { texto, rascunho }. */
function extrairRascunhoEvento(textoFinal) {
  const marca = "[RASCUNHO_EVENTO]";
  const idx = textoFinal.indexOf(marca);
  if (idx === -1) return { texto: textoFinal, rascunho: null };
  const texto = textoFinal.slice(0, idx).trim();
  try {
    const rascunho = JSON.parse(textoFinal.slice(idx + marca.length).trim());
    if (!rascunho.titulo || !rascunho.inicio || !rascunho.fim) return { texto, rascunho: null };
    return { texto, rascunho };
  } catch {
    return { texto, rascunho: null };
  }
}

app.post("/api/ia/perguntar", async (req, res) => {
  if (!openaiClient.openaiConfigured) {
    return res.status(400).json({ error: "Integração com IA ainda não foi configurada (OPENAI_API_KEY)." });
  }
  const tenant = req.tenant;
  const mensagem = String(req.body?.mensagem || "").trim();
  const historico = Array.isArray(req.body?.historico) ? req.body.historico.slice(-20) : [];
  if (!mensagem) return res.status(400).json({ error: "Escreva uma mensagem." });
  try {
    const perfil = await repo.configuracoesIaRepo.get(tenant.empresa.id);
    const baseConhecimento = USE_SUPABASE ? await repo.companyKnowledgeRepo.listar(tenant.empresa.id) : [];
    const input = montarInput({ perfilEmpresa: perfil, empresaNome: tenant.empresa.name, historico, mensagemUsuario: mensagem, baseConhecimento });
    const executores = criarExecutores(tenant, { agregarDesempenhoEquipe, agregarClienteDetalhe, phoneKey, montarRadar });
    const { textoFinal, usage } = await openaiClient.executarComFerramentas({
      model: openaiClient.MODELOS.padrao, input, tools: FERRAMENTAS_DEFINICOES, executores,
    });
    await repo.iaConsumoRepo.registrar(tenant.empresa.id, req.session.uid, {
      modelo: openaiClient.MODELOS.padrao, acao: "chat",
      tokensEntrada: usage.tokensEntrada, tokensSaida: usage.tokensSaida,
      estimatedCost: openaiClient.calcularCustoEstimado(openaiClient.MODELOS.padrao, usage.tokensEntrada, usage.tokensSaida),
    });
    const { texto: textoSemCampanha, rascunho: rascunhoCampanha } = extrairRascunhoCampanha(textoFinal);
    const { texto, rascunho: rascunhoEvento } = extrairRascunhoEvento(textoSemCampanha);
    res.json({ resposta: texto, rascunhoCampanha, rascunhoEvento });
  } catch (err) {
    console.error("[ia] perguntar:", err.response?.data?.error || err.message);
    res.status(500).json({ error: "Não foi possível falar com a IA agora." });
  }
});

// --- Webhook da Z-API (respostas recebidas), por empresa ---
// Cada instância Z-API (criada manualmente por empresa) é configurada
// apontando pra essa URL específica. O segredo vai na própria URL porque a
// Z-API não permite configurar headers customizados facilmente no painel.
// Responde rápido para a Z-API e processa em segundo plano (persistência + dedup).
app.post("/api/webhook/:empresaId/:secret", (req, res) => {
  res.json({ ok: true });
  handleWebhook(req.params.empresaId, req.params.secret, req.body || {})
    .catch((err) => console.error("Erro no webhook:", err.message));
});

/** Identificador externo do evento (messageId da Z-API) para impedir duplicidade. */
function webhookExternalId(b) {
  return String(b.messageId || b.id || b.message?.id || b.messageid || "").trim() || null;
}

/** Log de diagnóstico do webhook — nunca inclui secret/token, só o motivo técnico da rejeição. */
function logWebhookRejeitado(empresaId, motivo, detalhe) {
  console.warn(
    `[webhook] ${new Date().toISOString()} rejeitado — empresaId=${empresaId || "?"} motivo=${motivo}` +
      (detalhe ? ` detalhe=${detalhe}` : "")
  );
}

async function handleWebhook(empresaId, secret, body) {
  if (!USE_SUPABASE) {
    logWebhookRejeitado(empresaId, "modo_arquivo_sem_empresa");
    return;
  }
  let tenant;
  try {
    tenant = await getTenant(empresaId);
  } catch (err) {
    logWebhookRejeitado(empresaId, "empresa_nao_encontrada", err.message);
    return;
  }
  if (secret !== tenant.empresa.webhookSecret) {
    logWebhookRejeitado(empresaId, "secret_invalido");
    return;
  }
  await processWebhook(tenant, body);
}

async function processWebhook(tenant, b) {
  const phone = b.phone || b.participantPhone || b.connectedPhone;
  if (!phone) {
    logWebhookRejeitado(tenant?.empresa?.id, "payload_sem_telefone");
    return;
  }
  const fromMe = b.fromMe === true;
  const content = b.text?.message || b.message || b.body || b.caption || "";
  const externalId = webhookExternalId(b);

  // Dedup por evento: se já registramos este id externo (nesta empresa), não processa de novo.
  if (externalId) {
    const { isNew } = await repo.eventosRepo.record(tenant.empresa.id, externalId, phoneKey(phone), fromMe, b);
    if (!isNew) return;
  }

  if (!fromMe) {
    // Mensagem RECEBIDA (resposta do contato)
    await recordResponse(tenant, phone, Date.now(), content, externalId);
    await recordClientReply(tenant, phone); // atualiza a etapa do cliente no CRM
    await setWaName(tenant, phone, waNameFrom(b)); // guarda o nome recebido do WhatsApp
    if (content) await recordMessage(tenant, phone, content, "in", externalId); // caixa de conversas
    // Resposta automática (chatbot por regras), personalizada com {{nome}}
    const reply = findChatbotReply(tenant, content);
    if (reply) {
      const cli = findClient(tenant, phone);
      await sendAutoReply(tenant, phone, applyTemplate(reply, { name: cli?.name || "" }));
    }
  } else if (content) {
    // Mensagem ENVIADA por mim (ex.: respondida direto pelo celular)
    await recordMessage(tenant, phone, content, "out", externalId);
  }
  if (externalId) await repo.eventosRepo.markProcessed(tenant.empresa.id, externalId);
}

// Onboarding guiado (Item 7): progresso calculado a partir de dados reais, sem
// flag "concluído" gravada por passo -- assim nunca dessincroniza do estado
// de fato da empresa. Só o dono vê isso (vendedor nem alcança essa rota).
app.get("/api/onboarding", async (req, res) => {
  if (req.session.role !== "owner") return res.status(403).json({ error: "Acesso restrito." });
  const tenant = req.tenant;
  try {
    const [perfilIa, googleConexao, vendedores] = await Promise.all([
      USE_SUPABASE ? repo.configuracoesIaRepo.get(tenant.empresa.id) : null,
      USE_SUPABASE ? repo.googleRepo.get(tenant.empresa.id) : null,
      USE_SUPABASE ? repo.usuariosRepo.listVendedores(tenant.empresa.id) : [],
    ]);
    const steps = [
      {
        id: "perfil", titulo: "Perfil da empresa",
        descricao: "Conte pro Zappy o que sua empresa vende e pra quem, em ZapFlow IA.",
        done: Boolean(perfilIa?.segmento?.trim() && perfilIa?.descricao?.trim()),
        view: "ia",
      },
      {
        id: "whatsapp", titulo: "WhatsApp conectado",
        descricao: "Conexão configurada pela equipe ZapFlow no cadastro da sua empresa.",
        done: Boolean(tenant.empresa?.zapiInstanceId && tenant.empresa?.zapiInstanceToken),
        view: null,
      },
      {
        id: "contatos", titulo: "Contatos na agenda",
        descricao: "Adicione contatos manualmente, importe uma planilha ou sincronize do chip.",
        done: tenant.agenda.length > 0,
        view: "agenda",
      },
      {
        id: "google", titulo: "Google conectado",
        descricao: "Conecte sua conta Google pra agenda e planilhas em Calendário.",
        done: Boolean(googleConexao),
        view: "calendario",
      },
      {
        id: "campanha", titulo: "Primeira campanha",
        descricao: "Envie sua primeira campanha de mensagens.",
        done: tenant.jobs.length > 0,
        href: "/",
      },
      {
        id: "equipe", titulo: "Equipe",
        descricao: "Cadastre pelo menos um vendedor em Vendedores.",
        done: vendedores.length > 0,
        view: "vendedores",
      },
    ];
    const completedCount = steps.filter((s) => s.done).length;
    res.json({ steps, completedCount, total: steps.length, percent: Math.round((completedCount / steps.length) * 100), allDone: completedCount === steps.length });
  } catch (err) {
    console.error("[onboarding] status:", err.message);
    res.status(500).json({ error: "Não foi possível calcular o progresso da configuração." });
  }
});

// Configurações públicas para o frontend
app.get("/api/config", (req, res) => {
  const tenant = req.tenant;
  res.json({
    appName: "ZapFlow",
    hasEnvCredentials: Boolean(
      tenant?.empresa
        ? (tenant.empresa.zapiInstanceId && tenant.empresa.zapiInstanceToken)
        : (process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_INSTANCE_TOKEN)
    ),
    defaultDelaySeconds: Math.round(Math.max(DEFAULT_DELAY_MS, MIN_DELAY_MS) / 1000),
    authEnabled: USE_SUPABASE ? true : AUTH_ENABLED,
    persistence: USE_SUPABASE ? "supabase" : "arquivos",
    dbReady,
    role: req.session?.role || "owner",
    empresaName: tenant?.empresa?.name || null,
  });
});

// Health check da base de dados (sem expor credenciais).
app.get("/api/health/database", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!USE_SUPABASE) {
    return res.json({ connected: false, mode: "arquivos", projectRef: null, schema: null, tables: [] });
  }
  try {
    const result = await checkDatabase();
    res.status(result.connected ? 200 : 503).json({ mode: "supabase", dbReady, loadError: dbLastError, ...result });
  } catch (err) {
    res.status(503).json({ mode: "supabase", connected: false, dbReady, loadError: dbLastError, projectRef, error: String(err.message || err) });
  }
});

// ---------------------------------------------------------------------------
// Inicialização crash-safe:
//   1) o servidor HTTP sobe IMEDIATAMENTE (health sempre disponível, sem loop
//      de reinício);
//   2) modo arquivos: os dados são carregados em segundo plano, com novas
//      tentativas até conseguir. Modo Supabase: só confirma conectividade —
//      cada empresa é carregada sob demanda no primeiro acesso (getTenant).
// ---------------------------------------------------------------------------
function marcarJobsInterrompidos(tenant) {
  const alterados = [];
  for (const j of tenant.jobs) {
    if (j.status === "enviando") {
      j.status = "erro";
      j.error = "Interrompido por reinício do servidor.";
      alterados.push(j);
    }
  }
  return alterados;
}

async function loadFromFiles(tenant) {
  await loadJobs(tenant);
  await loadMetrics(tenant);
  await loadClients(tenant);
  await loadTemplates(tenant);
  await loadAgenda(tenant);
  await loadConversas(tenant);
  await loadChatbot(tenant);
}

async function initFileTenant() {
  fileTenantState = createEmptyTenantState();
  await loadFromFiles(fileTenantState);
  await migrateClients(fileTenantState);
  if (marcarJobsInterrompidos(fileTenantState).length) await saveJobs(fileTenantState);
  dbReady = true;
}

async function initPersistence() {
  if (!USE_SUPABASE) {
    console.log("  Persistência: arquivos locais (Supabase não configurado, modo legado single-tenant).");
    await initFileTenant();
    return;
  }

  // Modo Supabase: tenta confirmar conectividade continuamente até conseguir
  // (sem crashar). Não pré-carrega nenhuma empresa.
  for (let i = 1; ; i++) {
    try {
      const result = await checkDatabase();
      if (!result.connected) throw new Error(result.error || "Supabase não respondeu.");
      dbReady = true;
      dbLastError = null;
      console.log("  Persistência: Supabase (banco central, multi-empresa). Conectividade confirmada.");
      return;
    } catch (err) {
      dbReady = false;
      dbLastError = err.message;
      console.error(`[Supabase] Tentativa ${i} de conectar falhou: ${err.message}`);
      if (err.supabase?.code) console.error(`[Supabase] Código: ${err.supabase.code}`);
      if (i === 3) {
        console.error("[Supabase] As tabelas podem não estar visíveis na Data API (schema cache) ou faltam permissões ao service_role.");
        console.error("[Supabase] Rode a migration supabase/migrations/002_grants_and_reload.sql (grants + NOTIFY pgrst).");
      }
      await new Promise((r) => setTimeout(r, Math.min(3000 * i, 30000)));
    }
  }
}

// Sobe o servidor primeiro; carrega os dados em seguida (em segundo plano).
app.listen(PORT, () => {
  console.log(`\n  ZapFlow rodando em: http://localhost:${PORT}` +
    (USE_SUPABASE ? "  (login obrigatório, multi-empresa)" : (AUTH_ENABLED ? "  (login ativado)" : "  (login desativado)")));
  console.log(`  Persistência: ${USE_SUPABASE ? "Supabase (banco central)" : "arquivos locais"}\n`);
  setInterval(schedulerTick, 15000);
  initPersistence().catch((err) => {
    dbReady = false;
    dbLastError = err.message;
    console.error("[Falha ao carregar dados]", err.message);
  });
});
