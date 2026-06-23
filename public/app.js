// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let contacts = [];          // contatos válidos carregados da planilha
let imageTab = "url";       // url | upload | none
let imageBase64 = null;     // imagem em base64 quando enviada por arquivo
let whenMode = "now";       // now | schedule

const $ = (sel) => document.querySelector(sel);

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

// Persiste credenciais localmente para não digitar toda vez
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
CRED_KEYS.forEach((k) => {
  document.addEventListener("DOMContentLoaded", () => {
    $("#" + k)?.addEventListener("change", saveCreds);
  });
});

// ---------------------------------------------------------------------------
// Testar conexão
// ---------------------------------------------------------------------------
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
    updateSendButton();
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
// Abas de imagem
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    imageTab = tab.dataset.tab;
    document.querySelectorAll(".tab-content").forEach((c) => {
      c.classList.toggle("hidden", c.dataset.tab !== imageTab);
    });
  });
});

// Abas "Enviar agora" / "Agendar"
document.querySelectorAll(".tab[data-when]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab[data-when]").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    whenMode = tab.dataset.when;
    document.querySelectorAll(".when-content").forEach((c) => {
      c.classList.toggle("hidden", c.dataset.when !== whenMode);
    });
    const btn = $("#btnSend");
    btn.textContent = whenMode === "schedule" ? "📅 Agendar disparo" : "🚀 Disparar mensagens";
  });
});

$("#imageFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    imageBase64 = reader.result; // data:image/...;base64,....
    const preview = $("#imagePreview");
    preview.src = imageBase64;
    preview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

function getImagePayload() {
  if (imageTab === "url") {
    const url = $("#imageUrl").value.trim();
    return url ? { imageUrl: url } : {};
  }
  if (imageTab === "upload" && imageBase64) {
    return { imageBase64 };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Disparo
// ---------------------------------------------------------------------------
function updateSendButton() {
  $("#btnSend").disabled = contacts.length === 0;
}

$("#btnSend").addEventListener("click", async () => {
  const message = $("#message").value.trim();
  const image = getImagePayload();

  if (!message && !image.imageUrl && !image.imageBase64) {
    alert("Escreva uma mensagem de texto e/ou selecione uma imagem.");
    return;
  }

  // Modo agendamento: cria o job e sai (o servidor dispara na hora marcada)
  if (whenMode === "schedule") {
    return scheduleSend(message, image);
  }

  if (!confirm(`Confirmar o disparo para ${contacts.length} contato(s)?`)) return;

  const btn = $("#btnSend");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const log = $("#log");
  log.classList.remove("hidden");
  log.innerHTML = "";
  $("#progressWrap").classList.remove("hidden");

  const payload = {
    ...getCredentials(),
    contacts,
    message,
    delayMs: Number($("#delayMs").value) || 0,
    ...image,
  };

  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Falha ao iniciar o disparo.");
    }

    // Lê o stream NDJSON linha a linha
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
        if (line.trim()) handleProgress(JSON.parse(line));
      }
    }
  } catch (err) {
    addLog("Erro: " + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Disparar mensagens";
  }
});

function handleProgress(evt) {
  if (evt.done) {
    setProgress(100);
    $("#progressText").textContent =
      `Concluído! ${evt.success} enviada(s), ${evt.failed} falha(s) de ${evt.total}.`;
    return;
  }
  const pct = Math.round(((evt.index + 1) / contacts.length) * 100);
  setProgress(pct);
  $("#progressText").textContent = `Enviando ${evt.index + 1} de ${contacts.length}...`;

  const name = evt.contact?.name || evt.contact?.phone || "?";
  if (evt.ok) {
    addLog(`✅ ${name} (${evt.contact.phone}) — enviado`, true);
  } else {
    addLog(`❌ ${name} (${evt.contact?.phone || evt.contact?.rawPhone}) — ${evt.error}`, false);
  }
}

function setProgress(pct) {
  $("#progressBar").style.width = pct + "%";
}

function addLog(text, ok) {
  const div = document.createElement("div");
  div.className = "line " + (ok ? "ok" : "err");
  div.textContent = text;
  const log = $("#log");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------------------
// Agendamento
// ---------------------------------------------------------------------------
async function scheduleSend(message, image) {
  const value = $("#scheduledAt").value;
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
  if (!confirm(`Agendar disparo para ${contacts.length} contato(s) em ${quando}?`)) return;

  const btn = $("#btnSend");
  btn.disabled = true;
  btn.textContent = "Agendando...";

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
    alert(`✅ Disparo agendado para ${quando}!`);
    loadSchedules();
  } catch (err) {
    alert("Erro: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📅 Agendar disparo";
  }
}

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

// Atualiza a lista de agendamentos periodicamente
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
  loadSchedules();

  // Sugere um horário padrão (daqui a 1 hora) no campo de agendamento
  const dt = new Date(Date.now() + 60 * 60 * 1000);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  $("#scheduledAt").value = dt.toISOString().slice(0, 16);

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
