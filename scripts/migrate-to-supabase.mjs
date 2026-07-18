// ============================================================================
// Migração segura dos dados antigos (arquivos JSON) para o Supabase.
//
// Uso (na máquina/servidor com as variáveis do Supabase configuradas):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-to-supabase.mjs
//   (opcional) DATA_DIR=/data para apontar a pasta dos arquivos antigos.
//
// Características:
//   * NÃO apaga os arquivos antigos (eles continuam como backup).
//   * Evita duplicações: clientes/contatos/modelos/campanhas via upsert;
//     mensagens/respostas usam um id sintético (dedup em nova execução).
//   * Métricas de envio só são migradas se a tabela ainda estiver vazia
//     (para a migração poder ser executada mais de uma vez com segurança).
//   * Ao final, imprime um resumo com a quantidade importada.
// ============================================================================
import fs from "fs";
import path from "path";
import { supabaseEnabled, getClient } from "../db/supabase.js";
import {
  contatosRepo, clientesRepo, campanhasRepo, modelosRepo, automacoesRepo,
  mensagensRepo, respostasRepo, metricasRepo, destinatariosRepo,
} from "../db/repositories.js";

if (!supabaseEnabled) {
  console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de migrar.");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

// Mesma lógica de chave canônica do backend (para dedup por telefone).
function phoneKey(raw) {
  let d = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return "";
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    let rest = d.slice(4);
    if (rest.length === 9 && rest[0] === "9") rest = rest.slice(1);
    return "55" + ddd + rest;
  }
  return d;
}

function readJson(file, fallback) {
  const p = path.join(DATA_DIR, file);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn(`Não foi possível ler ${file}: ${e.message}`);
  }
  return fallback;
}

async function run() {
  console.log(`\nMigrando dados de: ${DATA_DIR}\n`);
  const resumo = {};

  // --- Contatos (agenda) ---
  const agenda = readJson("agenda.json", []);
  let n = 0;
  for (const a of agenda) {
    a.key = a.key || phoneKey(a.phone);
    if (!a.key) continue;
    await contatosRepo.upsertOne(a); n++;
  }
  resumo["contatos"] = n;

  // --- Clientes ---
  const clients = readJson("clients.json", []);
  n = 0;
  for (const c of clients) {
    c.key = c.key || phoneKey(c.phone);
    if (!c.key) continue;
    await clientesRepo.upsertOne(c); n++;
  }
  resumo["clientes"] = n;

  // --- Modelos de mensagem ---
  const templates = readJson("templates.json", []);
  n = 0;
  for (const t of templates) { await modelosRepo.upsertOne(t); n++; }
  resumo["modelos_mensagem"] = n;

  // --- Automações (chatbot) ---
  const chatbot = readJson("chatbot.json", null);
  if (chatbot) { await automacoesRepo.save(chatbot); resumo["automacoes"] = 1; }

  // --- Campanhas (jobs: imediatas + agendadas) ---
  const jobs = readJson("jobs.json", []);
  n = 0;
  for (const j of jobs) {
    if (!j.id) continue;
    await campanhasRepo.upsertOne(j); n++;
    if (Array.isArray(j.logs) && j.logs.length) {
      await destinatariosRepo.replaceForCampaign(j.id, j.logs);
    }
  }
  resumo["campanhas"] = n;

  // --- Mensagens (conversas) — id sintético para dedup em re-execução ---
  const conversas = readJson("conversas.json", []);
  n = 0;
  for (const m of conversas) {
    const key = m.key || phoneKey(m.phone);
    if (!key) continue;
    const extId = `migrate:${key}:${m.ts}:${m.dir}`;
    const okIns = await mensagensRepo.insertOne({ key, phone: m.phone, text: m.text, ts: m.ts, dir: m.dir }, extId, null);
    if (okIns !== false) n++;
  }
  resumo["mensagens"] = n;

  // --- Métricas ---
  const metrics = readJson("metrics.json", { sends: [], responses: [] });

  // Respostas — id sintético para dedup
  n = 0;
  for (const r of metrics.responses || []) {
    const key = r.key || phoneKey(r.phone);
    if (!key) continue;
    const extId = `migrate:${key}:${r.ts}`;
    const okIns = await respostasRepo.insertOne({ key, phone: r.phone, content: r.content, ts: r.ts }, extId);
    if (okIns !== false) n++;
  }
  resumo["respostas"] = n;

  // Métricas de envio — só migra se a tabela estiver vazia (evita duplicar)
  const { count } = await getClient().from("metricas_envios").select("*", { count: "exact", head: true });
  if (!count) {
    n = 0;
    for (const s of metrics.sends || []) { await metricasRepo.insertOne(s); n++; }
    resumo["metricas_envios"] = n;
  } else {
    resumo["metricas_envios"] = `pulado (já havia ${count} registros)`;
  }

  console.log("Resumo da importação:");
  for (const [tabela, qtd] of Object.entries(resumo)) {
    console.log(`  ${tabela.padEnd(22)} ${qtd}`);
  }
  console.log("\nOs arquivos antigos NÃO foram apagados. Valide os dados no Supabase antes de descartá-los.\n");
}

run().catch((e) => { console.error("Falha na migração:", e); process.exit(1); });
