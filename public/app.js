// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
let contacts = [];          // contatos válidos carregados da planilha
const MAX_MESSAGES = 5;

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// Credenciais
// ---------------------------------------------------------------------------
function getCredentials() {
  return {
    instanceId: $("#instanceId").value.trim(),
    instanceToken: $("#instanceToken").value.trim(),
    clientToken: $("#clientToken").value.trim(),
  };
}

const CRED_KEYS = ["instanceId", "instanceToken", "clientToken"];
function saveCreds() {
  CRED_KEYS.forEach((k) => localStorage.setItem("frota_" + k, $("#" + k).value));
}
function loadCreds() {
  CRED_KEYS.forEach((k) => {
    const v = localStorage.getItem("frota_" + k);
    if (v) $("#" + k).value = v;
  });
}

$("#btnTest").addEventListener("click", async () => {
  const status = $("#connStatus");
  status.textContent = "Testando...";
  status.className = "status";
  try {
    const res = await fetch("/api/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getCredentials()),
    });
    const data = await res.json();
    if (data.ok) {
      const connected = data.status?.connected ?? data.status?.value;
      status.textContent = connected === false
        ? "⚠️ Instância encontrada, mas o WhatsApp não está conectado (leia o QR Code)."
        : "✅ Conexão OK!";
      status.className = "status ok";
    } else {
      status.textContent = "❌ " + (data.error || "Falha na conexão.");
      status.className = "status err";
    }
  } catch (err) {
    status.textContent = "❌ " + err.message;
    status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Upload da planilha
// ---------------------------------------------------------------------------
const dropzone = $("#dropzone");
const fileInput = $("#fileInput");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  $("#fileName").textContent = "Carregando " + file.name + "...";
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch("/api/contacts", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao ler a planilha.");

    contacts = data.valid;
    $("#fileName").textContent = file.name;
    renderContacts(data);
    updateSendButtons();
  } catch (err) {
    $("#fileName").textContent = "";
    alert("Erro: " + err.message);
  }
}

function renderContacts(data) {
  const summary = $("#contactsSummary");
  summary.classList.remove("hidden");
  summary.innerHTML =
    `Total: <b>${data.total}</b> &nbsp;·&nbsp; ` +
    `Válidos: <b class="ok">${data.valid.length}</b> &nbsp;·&nbsp; ` +
    `Inválidos: <b class="err">${data.invalid.length}</b>`;

  const tbody = $("#contactsTable tbody");
  tbody.innerHTML = "";
  const all = [...data.valid, ...data.invalid];
  all.slice(0, 500).forEach((c, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(c.name || "-")}</td>
      <td class="${c.phone ? "" : "invalid"}">${escapeHtml(c.phone || c.rawPhone || "-")}</td>
      <td>${c.phone
        ? '<span class="badge ok">válido</span>'
        : '<span class="badge err">inválido</span>'}</td>`;
    tbody.appendChild(tr);
  });
  $("#tableWrap").classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Blocos de mensagem (até 5)
// ---------------------------------------------------------------------------
const container = $("#messagesContainer");
const template = $("#msgTemplate");

function messageCount() {
  return container.querySelectorAll(".msg-block").length;
}

function renumberMessages() {
  $$(".msg-block", container).forEach((block, i) => {
    $(".msg-num", block).textContent = i + 1;
    // Só permite remover quando há mais de um bloco
    $(".btn-remove", block).style.display = messageCount() > 1 ? "" : "none";
  });
  $("#btnAddMessage").disabled = messageCount() >= MAX_MESSAGES;
}

function addMessageBlock() {
  if (messageCount() >= MAX_MESSAGES) return;
  const block = template.content.firstElementChild.cloneNode(true);
  block._imageBase64 = null; // estado da imagem por bloco

  // Abas de imagem
  $$(".img-tabs .tab", block).forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".img-tabs .tab", block).forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      block._imageTab = tab.dataset.tab;
      $$(".tab-content[data-tab]", block).forEach((c) => {
        // Apenas os tab-content de imagem (têm data-tab url/upload/none)
        if (["url", "upload", "none"].includes(c.dataset.tab)) {
          c.classList.toggle("hidden", c.dataset.tab !== tab.dataset.tab);
        }
      });
    });
  });
  block._imageTab = "url";

  // Upload de imagem -> base64
  $(".m-imageFile", block).addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      block._imageBase64 = reader.result;
      const preview = $(".m-preview", block);
      preview.src = reader.result;
      preview.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });

  // Abas "Enviar agora" / "Agendar"
  block._whenMode = "now";
  $$(".when-tabs .tab", block).forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".when-tabs .tab", block).forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      block._whenMode = tab.dataset.when;
      $(".when-content[data-when='schedule']", block)
        .classList.toggle("hidden", tab.dataset.when !== "schedule");
      $(".m-send", block).textContent = tab.dataset.when === "schedule"
        ? "📅 Agendar disparo" : "🚀 Disparar";
    });
  });

  // Sugere horário padrão (daqui a 1h)
  const dt = new Date(Date.now() + 60 * 60 * 1000);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  $(".m-scheduledAt", block).value = dt.toISOString().slice(0, 16);

  // Botão remover
  $(".btn-remove", block).addEventListener("click", () => {
    block.remove();
    renumberMessages();
  });

  // Botão disparar
  $(".m-send", block).addEventListener("click", () => handleSend(block));

  container.appendChild(block);
  renumberMessages();
  updateSendButtons();
}

$("#btnAddMessage").addEventListener("click", addMessageBlock);

function updateSendButtons() {
  $$(".m-send", container).forEach((b) => { b.disabled = contacts.length === 0; });
}

/** Lê o conteúdo (texto + imagem) de um bloco. */
function readBlock(block) {
  const message = $(".m-message", block).value.trim();
  let image = {};
  if (block._imageTab === "url") {
    const url = $(".m-imageUrl", block).value.trim();
    if (url) image = { imageUrl: url };
  } else if (block._imageTab === "upload" && block._imageBase64) {
    image = { imageBase64: block._imageBase64 };
  }
  return { message, image };
}

// ---------------------------------------------------------------------------
// Disparo / Agendamento de um bloco
// ---------------------------------------------------------------------------
async function handleSend(block) {
  const { message, image } = readBlock(block);
  if (!message && !image.imageUrl && !image.imageBase64) {
    alert("Escreva uma mensagem de texto e/ou selecione uma imagem.");
    return;
  }
  if (block._whenMode === "schedule") {
    return scheduleBlock(block, message, image);
  }
  return sendNowBlock(block, message, image);
}

async function sendNowBlock(block, message, image) {
  const num = $(".msg-num", block).textContent;
  if (!confirm(`Disparar a Mensagem ${num} para ${contacts.length} contato(s) agora?`)) return;

  const btn = $(".m-send", block);
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const log = $(".m-log", block);
  log.classList.remove("hidden");
  log.innerHTML = "";
  $(".m-progressWrap", block).classList.remove("hidden");

  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...getCredentials(),
        contacts,
        message,
        delayMs: Number($("#delayMs").value) || 0,
        ...image,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Falha ao iniciar o disparo.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) handleProgress(block, JSON.parse(line));
      }
    }
  } catch (err) {
    addLog(block, "Erro: " + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Disparar";
  }
}

async function scheduleBlock(block, message, image) {
  const num = $(".msg-num", block).textContent;
  const value = $(".m-scheduledAt", block).value;
  if (!value) {
    alert("Escolha a data e o horário do agendamento.");
    return;
  }
  const scheduledAt = new Date(value).getTime();
  if (scheduledAt < Date.now()) {
    alert("O horário escolhido já passou. Selecione um horário futuro.");
    return;
  }

  const quando = new Date(scheduledAt).toLocaleString("pt-BR");
  if (!confirm(`Agendar a Mensagem ${num} para ${contacts.length} contato(s) em ${quando}?`)) return;

  const btn = $(".m-send", block);
  btn.disabled = true;
  btn.textContent = "Agendando...";
  const status = $(".m-status", block);

  try {
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...getCredentials(),
        contacts,
        message,
        delayMs: Number($("#delayMs").value) || 0,
        scheduledAt,
        ...image,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao agendar.");
    status.textContent = `✅ Agendada para ${quando}`;
    status.className = "m-status status ok";
    loadSchedules();
  } catch (err) {
    status.textContent = "❌ " + err.message;
    status.className = "m-status status err";
  } finally {
    btn.disabled = false;
    btn.textContent = "📅 Agendar disparo";
  }
}

function handleProgress(block, evt) {
  if (evt.done) {
    setProgress(block, 100);
    $(".m-progressText", block).textContent =
      `Concluído! ${evt.success} enviada(s), ${evt.failed} falha(s) de ${evt.total}.`;
    return;
  }
  const pct = Math.round(((evt.index + 1) / contacts.length) * 100);
  setProgress(block, pct);
  $(".m-progressText", block).textContent = `Enviando ${evt.index + 1} de ${contacts.length}...`;

  const name = evt.contact?.name || evt.contact?.phone || "?";
  if (evt.ok) {
    addLog(block, `✅ ${name} (${evt.contact.phone}) — enviado`, true);
  } else {
    addLog(block, `❌ ${name} (${evt.contact?.phone || evt.contact?.rawPhone}) — ${evt.error}`, false);
  }
}

function setProgress(block, pct) {
  $(".m-progressBar", block).style.width = pct + "%";
}

function addLog(block, text, ok) {
  const div = document.createElement("div");
  div.className = "line " + (ok ? "ok" : "err");
  div.textContent = text;
  const log = $(".m-log", block);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------------------
// Agendamentos (lista)
// ---------------------------------------------------------------------------
const STATUS_LABELS = {
  pendente: { txt: "⏳ Pendente", cls: "pend" },
  enviando: { txt: "📤 Enviando...", cls: "sending" },
  concluido: { txt: "✅ Concluído", cls: "ok" },
  erro: { txt: "❌ Erro", cls: "err" },
  cancelado: { txt: "🚫 Cancelado", cls: "cancel" },
};

async function loadSchedules() {
  try {
    const res = await fetch("/api/schedules");
    const data = await res.json();
    renderSchedules(data.jobs || []);
  } catch { /* ignore */ }
}

function renderSchedules(list) {
  const wrap = $("#schedulesList");
  const empty = $("#schedulesEmpty");
  empty.classList.toggle("hidden", list.length > 0);
  wrap.innerHTML = "";

  for (const job of list) {
    const st = STATUS_LABELS[job.status] || { txt: job.status, cls: "" };
    const quando = new Date(job.scheduledAt).toLocaleString("pt-BR");
    const preview = (job.message || (job.hasImage ? "[imagem]" : "")).slice(0, 60);
    const result = job.result
      ? `<small>${job.result.success} enviada(s), ${job.result.failed} falha(s)</small>`
      : "";
    const cancelBtn = job.status === "pendente"
      ? `<button class="btn-cancel" data-id="${job.id}">Cancelar</button>`
      : "";

    const div = document.createElement("div");
    div.className = "sched-item " + st.cls;
    div.innerHTML = `
      <div class="sched-head">
        <span class="sched-status ${st.cls}">${st.txt}</span>
        <span class="sched-when">📅 ${quando}</span>
        ${cancelBtn}
      </div>
      <div class="sched-body">
        <span>${job.contactsCount} contato(s)${job.hasImage ? " · 🖼️ imagem" : ""}</span>
        ${preview ? `<span class="sched-msg">"${escapeHtml(preview)}${preview.length >= 60 ? "..." : ""}"</span>` : ""}
        ${result}
      </div>`;
    wrap.appendChild(div);
  }

  wrap.querySelectorAll(".btn-cancel").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm("Cancelar este agendamento?")) return;
      await fetch("/api/schedules/" + b.dataset.id, { method: "DELETE" });
      loadSchedules();
    });
  });
}

setInterval(loadSchedules, 10000);

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  loadCreds();
  CRED_KEYS.forEach((k) => $("#" + k).addEventListener("change", saveCreds));

  addMessageBlock(); // começa com 1 mensagem
  loadSchedules();

  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (cfg.defaultDelayMs) $("#delayMs").value = cfg.defaultDelayMs;
    if (cfg.hasEnvCredentials) {
      $("#connStatus").textContent = "ℹ️ Credenciais detectadas no servidor (.env).";
      $("#connStatus").className = "status ok";
    }
  } catch { /* ignore */ }
});
