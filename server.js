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
const DEFAULT_DELAY_MS = Number(process.env.DEFAULT_DELAY_MS || 1500);

// Diretório de dados (para persistir os agendamentos). Em produção (ex.: Railway)
// recomenda-se apontar para um volume para sobreviver a reinícios.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");

app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Uploads ficam em memória (não gravamos arquivos sensíveis em disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
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

/** Versão segura para o cliente: sem credenciais nem conteúdo pesado. */
function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    scheduledAt: job.scheduledAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    message: job.message,
    hasImage: Boolean(job.imageUrl || job.imageBase64),
    delayMs: job.delayMs,
    contactsCount: job.contacts?.length || 0,
    result: job.result || null,
    error: job.error || null,
  };
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
  saveJobs();
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
async function sendOne(creds, contact, { message, imageUrl, imageBase64 }) {
  const text = applyTemplate(message, contact);
  let url;
  let payload;

  if (imageUrl || imageBase64) {
    url = `${zapiBaseUrl(creds)}/send-image`;
    payload = {
      phone: contact.phone,
      image: imageUrl || imageBase64,
      caption: text || "",
    };
  } else {
    url = `${zapiBaseUrl(creds)}/send-text`;
    payload = { phone: contact.phone, message: text };
  }

  const { data } = await axios.post(url, payload, {
    headers: zapiHeaders(creds),
    timeout: 30000,
  });
  return data;
}

// Dispara as mensagens com streaming de progresso (Server-Sent Events estilo NDJSON)
app.post("/api/send", async (req, res) => {
  const creds = resolveCredentials(req.body);
  const { contacts, message, imageUrl, imageBase64 } = req.body;
  const delay = Number(req.body.delayMs ?? DEFAULT_DELAY_MS);

  if (!creds.instanceId || !creds.instanceToken) {
    return res.status(400).json({ error: "Credenciais da Z-API incompletas." });
  }
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "Lista de contatos vazia." });
  }
  if (!message && !imageUrl && !imageBase64) {
    return res.status(400).json({ error: "Informe uma mensagem de texto e/ou uma imagem." });
  }

  // Streaming: enviamos um JSON por linha conforme o progresso avança.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");

  let success = 0;
  let failed = 0;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (!contact.phone) {
      failed++;
      res.write(JSON.stringify({ index: i, contact, ok: false, error: "Número inválido" }) + "\n");
      continue;
    }
    try {
      const result = await sendOne(creds, contact, { message, imageUrl, imageBase64 });
      success++;
      res.write(JSON.stringify({ index: i, contact, ok: true, result }) + "\n");
    } catch (err) {
      failed++;
      const error = err.response?.data?.error || err.response?.data?.message || err.message;
      res.write(JSON.stringify({ index: i, contact, ok: false, error }) + "\n");
    }

    // Aguarda o intervalo entre os envios (menos no último)
    if (i < contacts.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }

  res.write(JSON.stringify({ done: true, success, failed, total: contacts.length }) + "\n");
  res.end();
});

// Cria um agendamento de disparo
app.post("/api/schedule", (req, res) => {
  const creds = resolveCredentials(req.body);
  const { contacts, message, imageUrl, imageBase64, scheduledAt } = req.body;
  const delayMs = Number(req.body.delayMs ?? DEFAULT_DELAY_MS);

  if (!creds.instanceId || !creds.instanceToken) {
    return res.status(400).json({ error: "Credenciais da Z-API incompletas." });
  }
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "Lista de contatos vazia." });
  }
  if (!message && !imageUrl && !imageBase64) {
    return res.status(400).json({ error: "Informe uma mensagem de texto e/ou uma imagem." });
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
    imageUrl: imageUrl || null,
    imageBase64: imageBase64 || null,
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

// Detalhe de um agendamento (inclui o log de envios)
app.get("/api/schedules/:id", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Agendamento não encontrado." });
  res.json({ job: { ...publicJob(job), logs: job.logs || [] } });
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

// Indica se há credenciais configuradas no servidor (.env)
app.get("/api/config", (req, res) => {
  res.json({
    hasEnvCredentials: Boolean(process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_INSTANCE_TOKEN),
    defaultDelayMs: DEFAULT_DELAY_MS,
  });
});

app.listen(PORT, () => {
  console.log(`\n  Frota-bot rodando em: http://localhost:${PORT}\n`);
});
