// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
let importedContacts = [];  // válidos vindos do Excel
let importedInvalid = [];   // inválidos do Excel (apenas para exibir)
let manualContacts = [];    // adicionados manualmente
let contacts = [];          // combinação dos válidos (é o que será enviado)
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

// Recolher / expandir o Passo 1
function setConnCollapsed(collapsed) {
  $("#connBody").classList.toggle("hidden", collapsed);
  $("#connChevron").textContent = collapsed ? "▸" : "▾";
}
$("#connHeader").addEventListener("click", () => {
  setConnCollapsed(!$("#connBody").classList.contains("hidden"));
});

function setConnBadge(text, cls) {
  $("#connBadge").textContent = text;
  $("#connBadge").className = "head-badge " + (cls || "");
}
function setConnTitle(text) {
  $("#connTitle").textContent = text;
}

async function runConnectionTest({ collapseOnSuccess = true } = {}) {
  const status = $("#connStatus");
  status.textContent = "Testando...";
  status.className = "status";
  setConnTitle("Conectando...");
  setConnBadge("⏳ Verificando...", "");
  try {
    const res = await fetch("/api/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getCredentials()),
    });
    const data = await res.json();
    if (data.ok) {
      const connected = data.status?.connected ?? data.status?.value;
      if (connected === false) {
        status.textContent = "⚠️ Instância encontrada, mas o WhatsApp não está conectado (leia o QR Code).";
        status.className = "status err";
        setConnTitle("Desconectado");
        setConnBadge("⚠️ Sem WhatsApp", "err");
      } else {
        status.textContent = "✅ Conexão OK!";
        status.className = "status ok";
        setConnTitle("Conectado");
        setConnBadge("✅ Pronto", "ok");
        if (collapseOnSuccess) setTimeout(() => setConnCollapsed(true), 800);
      }
    } else {
      status.textContent = "❌ " + (data.error || "Falha na conexão.");
      status.className = "status err";
      setConnTitle("Desconectado");
      setConnBadge("❌ Erro", "err");
    }
  } catch (err) {
    status.textContent = "❌ " + err.message;
    status.className = "status err";
    setConnTitle("Desconectado");
    setConnBadge("❌ Erro", "err");
  }
}

$("#btnTest").addEventListener("click", (e) => {
  e.stopPropagation();
  runConnectionTest();
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

    importedContacts = data.valid;
    importedInvalid = data.invalid;
    $("#fileName").textContent = file.name;
    rebuildContacts();
  } catch (err) {
    $("#fileName").textContent = "";
    alert("Erro: " + err.message);
  }
}

/** Normaliza um telefone no navegador (espelha a lógica do servidor). */
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

// Adição manual de contatos
$("#btnAddContact").addEventListener("click", addManualContact);
$("#manualPhone").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addManualContact();
});

function addManualContact() {
  const nameEl = $("#manualName");
  const phoneEl = $("#manualPhone");
  const err = $("#manualError");
  const phone = normalizePhone(phoneEl.value);
  if (!phone) {
    err.textContent = "⚠️ Telefone inválido. Inclua o DDD (ex.: 11 99999-8888).";
    return;
  }
  if (contacts.some((c) => c.phone === phone)) {
    err.textContent = "⚠️ Esse número já está na lista.";
    return;
  }
  err.textContent = "";
  manualContacts.push({ phone, name: nameEl.value.trim(), rawPhone: phoneEl.value.trim(), manual: true });
  nameEl.value = "";
  phoneEl.value = "";
  nameEl.focus();
  rebuildContacts();
}

/** Recombina importados + manuais e atualiza a tabela. */
function rebuildContacts() {
  contacts = [...importedContacts, ...manualContacts];
  renderContacts();
  updateSendButtons();
}

function renderContacts() {
  const summary = $("#contactsSummary");
  const validCount = contacts.length;
  const invalidCount = importedInvalid.length;
  const total = validCount + invalidCount;

  if (total === 0) {
    summary.classList.add("hidden");
    $("#tableWrap").classList.add("hidden");
    return;
  }

  summary.classList.remove("hidden");
  summary.innerHTML =
    `Total: <b>${total}</b> &nbsp;·&nbsp; ` +
    `Válidos: <b class="ok">${validCount}</b> &nbsp;·&nbsp; ` +
    `Inválidos: <b class="err">${invalidCount}</b>`;

  const tbody = $("#contactsTable tbody");
  tbody.innerHTML = "";
  let i = 0;

  contacts.forEach((c) => {
    i++;
    const tr = document.createElement("tr");
    const remove = c.manual
      ? `<button class="row-remove" data-phone="${c.phone}" title="Remover">✕</button>` : "";
    const tag = c.manual ? ' <span class="badge manual">manual</span>' : "";
    tr.innerHTML = `
      <td>${i}</td>
      <td>${escapeHtml(c.name || "-")}</td>
      <td>${escapeHtml(c.phone)}${tag}</td>
      <td><span class="badge ok">válido</span></td>
      <td>${remove}</td>`;
    tbody.appendChild(tr);
  });

  importedInvalid.forEach((c) => {
    i++;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i}</td>
      <td>${escapeHtml(c.name || "-")}</td>
      <td class="invalid">${escapeHtml(c.rawPhone || "-")}</td>
      <td><span class="badge err">inválido</span></td>
      <td></td>`;
    tbody.appendChild(tr);
  });

  $("#tableWrap").classList.remove("hidden");

  tbody.querySelectorAll(".row-remove").forEach((b) => {
    b.addEventListener("click", () => {
      manualContacts = manualContacts.filter((c) => c.phone !== b.dataset.phone);
      rebuildContacts();
    });
  });
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
  block._imageTab = "upload";

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

  // Botão "+ nome" — insere {{nome}} na posição do cursor
  $(".m-insert-name", block).addEventListener("click", () => {
    const ta = $(".m-message", block);
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + "{{nome}}" + ta.value.slice(end);
    ta.focus();
    const pos = start + "{{nome}}".length;
    ta.setSelectionRange(pos, pos);
  });

  // Modelos
  $(".m-save-template", block).addEventListener("click", () => openSaveTemplate(block));
  $(".m-load-template", block).addEventListener("click", () => openTemplates(block));

  // Botão disparar
  $(".m-send", block).addEventListener("click", () => handleSend(block));
  // Botão limpar
  $(".m-clear", block).addEventListener("click", () => clearBlock(block));

  container.appendChild(block);
  renumberMessages();
  updateSendButtons();
}

$("#btnAddMessage").addEventListener("click", addMessageBlock);

// ---------------------------------------------------------------------------
// Intervalo entre envios (segundos) + aviso + localStorage
// ---------------------------------------------------------------------------
function getDelayMs() {
  const s = Math.min(60, Math.max(1, Number($("#delaySeconds").value) || 3));
  return s * 1000;
}
function checkDelayWarning() {
  const s = Number($("#delaySeconds").value);
  $("#delayWarning").classList.toggle("hidden", !(s < 2));
  localStorage.setItem("zapflow_delay", $("#delaySeconds").value);
}
$("#delaySeconds").addEventListener("input", checkDelayWarning);

function updateSendButtons() {
  $$(".m-send", container).forEach((b) => { b.disabled = contacts.length === 0; });
}

/** Limpa só o que foi escrito (texto + imagem), mantendo o log visível. */
function clearComposer(block) {
  $(".m-message", block).value = "";
  $(".m-imageUrl", block).value = "";
  $(".m-imageFile", block).value = "";
  block._imageBase64 = null;
  const preview = $(".m-preview", block);
  preview.src = "";
  preview.classList.add("hidden");
}

/** Limpa o bloco inteiro (texto, imagem, status, log e progresso). */
function clearBlock(block) {
  clearComposer(block);
  $(".m-status", block).textContent = "";
  $(".m-log", block).innerHTML = "";
  $(".m-log", block).classList.add("hidden");
  $(".m-progressWrap", block).classList.add("hidden");
  $(".m-progressBar", block).style.width = "0%";
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
        delayMs: getDelayMs(),
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
        delayMs: getDelayMs(),
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
    // Limpa os campos automaticamente para já montar uma nova mensagem
    clearComposer(block);
    loadSchedules(); // atualiza o histórico
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

function statusLabel(job) {
  if (job.immediate && job.status === "concluido") return { txt: "✅ Enviada", cls: "ok" };
  return STATUS_LABELS[job.status] || { txt: job.status, cls: "" };
}

function renderSchedules(list) {
  const wrap = $("#schedulesList");
  const empty = $("#schedulesEmpty");
  empty.classList.toggle("hidden", list.length > 0);
  wrap.innerHTML = "";

  for (const job of list) {
    const st = statusLabel(job);
    const quando = new Date(job.scheduledAt).toLocaleString("pt-BR");
    const icon = job.status === "pendente" ? "📅" : "🕒";
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
        <span class="sched-when">${icon} ${quando}</span>
        ${cancelBtn}
      </div>
      <div class="sched-body">
        <span>${job.contactsCount} contato(s)${job.hasImage ? " · 🖼️ imagem" : ""}</span>
        ${preview ? `<span class="sched-msg">"${escapeHtml(preview)}${preview.length >= 60 ? "..." : ""}"</span>` : ""}
        ${result}
        <a class="sched-detail-link" data-id="${job.id}">▸ ver números</a>
      </div>
      <div class="sched-detail hidden" data-detail="${job.id}"></div>`;
    wrap.appendChild(div);
  }

  wrap.querySelectorAll(".btn-cancel").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Cancelar este agendamento?")) return;
      await fetch("/api/schedules/" + b.dataset.id, { method: "DELETE" });
      loadSchedules();
    });
  });

  wrap.querySelectorAll(".sched-detail-link").forEach((a) => {
    a.addEventListener("click", () => toggleDetail(a));
  });
}

async function toggleDetail(link) {
  const id = link.dataset.id;
  const box = document.querySelector(`.sched-detail[data-detail="${id}"]`);
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    link.textContent = "▸ ver números";
    return;
  }
  link.textContent = "▾ ocultar números";
  box.classList.remove("hidden");
  box.innerHTML = "<small>Carregando...</small>";
  try {
    const res = await fetch("/api/schedules/" + id);
    const data = await res.json();
    const logs = data.job?.logs || [];
    if (!logs.length) {
      box.innerHTML = "<small>Ainda sem detalhes (envio não iniciado).</small>";
      return;
    }
    box.innerHTML = logs.map((l) => {
      const nome = l.name ? escapeHtml(l.name) + " — " : "";
      const status = l.ok ? '<span class="d-ok">✅</span>' : `<span class="d-err">❌ ${escapeHtml(l.error || "")}</span>`;
      const replied = l.replied ? ' <span class="d-replied">↩ respondeu</span>' : "";
      return `<div class="d-line">${status} ${nome}${escapeHtml(l.phone || "")}${replied}</div>`;
    }).join("");
  } catch {
    box.innerHTML = "<small>Não foi possível carregar os detalhes.</small>";
  }
}

// Limpar histórico (mantém pendentes/em andamento)
$("#btnClearHistory").addEventListener("click", async () => {
  if (!confirm("Limpar o histórico de envios concluídos?\n(Os agendamentos pendentes serão mantidos.)")) return;
  await fetch("/api/schedules", { method: "DELETE" });
  loadSchedules();
});

setInterval(loadSchedules, 10000);

// ---------------------------------------------------------------------------
// Modais (genérico)
// ---------------------------------------------------------------------------
function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }
document.querySelectorAll(".modal-close").forEach((b) => {
  b.addEventListener("click", () => closeModal(b.dataset.close));
});
document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); });
});

// ---------------------------------------------------------------------------
// Modelos de mensagem
// ---------------------------------------------------------------------------
let templateTargetBlock = null;

function openSaveTemplate(block) {
  const { message, image } = readBlock(block);
  if (!message && !image.imageUrl) {
    alert("Escreva um texto (e/ou informe a imagem por URL) para salvar como modelo.\n" +
          "Obs.: fotos da galeria não são salvas no modelo, apenas URLs.");
    return;
  }
  templateTargetBlock = block;
  $("#templateName").value = "";
  $("#saveTemplateError").textContent = "";
  openModal("saveTemplateModal");
  $("#templateName").focus();
}

$("#confirmSaveTemplate").addEventListener("click", async () => {
  if (!templateTargetBlock) return;
  const { message, image } = readBlock(templateTargetBlock);
  const name = $("#templateName").value.trim();
  if (!name) { $("#saveTemplateError").textContent = "Dê um nome ao modelo."; return; }
  try {
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message, imageUrl: image.imageUrl || "" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
    closeModal("saveTemplateModal");
  } catch (err) {
    $("#saveTemplateError").textContent = err.message;
  }
});

async function openTemplates(block) {
  templateTargetBlock = block;
  openModal("templatesModal");
  const list = $("#templatesList");
  list.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/templates");
    const data = await res.json();
    renderTemplates(data.templates || []);
  } catch {
    list.innerHTML = "<p class='hint'>Não foi possível carregar os modelos.</p>";
  }
}

function renderTemplates(list) {
  const wrap = $("#templatesList");
  $("#templatesEmpty").classList.toggle("hidden", list.length > 0);
  $("#templatesCount").textContent = `${list.length}/10 modelos salvos.`;
  wrap.innerHTML = "";
  list.forEach((t) => {
    const div = document.createElement("div");
    div.className = "template-item";
    const preview = (t.message || (t.imageUrl ? "[imagem]" : "")).slice(0, 80);
    div.innerHTML = `
      <div class="t-name">${escapeHtml(t.name)}</div>
      <div class="t-preview">${escapeHtml(preview)}${t.imageUrl ? " · 🖼️" : ""}</div>
      <div class="t-actions">
        <button class="btn primary t-load" data-id="${t.id}">Usar</button>
        <button class="btn ghost t-del" data-id="${t.id}">Excluir</button>
      </div>`;
    wrap.appendChild(div);
    div.querySelector(".t-load").addEventListener("click", () => loadTemplateInto(t));
    div.querySelector(".t-del").addEventListener("click", () => deleteTemplate(t.id));
  });
}

function loadTemplateInto(t) {
  const block = templateTargetBlock;
  if (!block) return;
  $(".m-message", block).value = t.message || "";
  if (t.imageUrl) {
    // ativa a aba URL e preenche
    $(".img-tabs .tab[data-tab='url']", block).click();
    $(".m-imageUrl", block).value = t.imageUrl;
  }
  closeModal("templatesModal");
}

async function deleteTemplate(id) {
  if (!confirm("Excluir este modelo?")) return;
  await fetch("/api/templates/" + id, { method: "DELETE" });
  const res = await fetch("/api/templates");
  const data = await res.json();
  renderTemplates(data.templates || []);
}

// ---------------------------------------------------------------------------
// Dashboard de métricas
// ---------------------------------------------------------------------------
$("#btnMetrics").addEventListener("click", openMetrics);

async function openMetrics() {
  openModal("metricsModal");
  $("#panelHoje .metric-content").innerHTML = "<p class='hint'>Carregando...</p>";
  $("#panelMes .metric-content").innerHTML = "";
  try {
    const res = await fetch("/api/metrics");
    const data = await res.json();
    renderMetricPanel("#panelHoje", data.hoje);
    renderMetricPanel("#panelMes", data.mes);
  } catch {
    $("#panelHoje .metric-content").innerHTML = "<p class='hint'>Erro ao carregar métricas.</p>";
  }
}

function renderMetricPanel(sel, m) {
  const rateColor = m.taxa >= 30 ? "var(--primary)" : m.taxa >= 10 ? "#eab308" : "var(--danger)";
  const hora = m.melhorHora === null ? "—" : String(m.melhorHora).padStart(2, "0") + "h";
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const maxWeek = Math.max(1, ...m.week);
  const chart = m.week.map((v, i) =>
    `<div class="week-col">
       <div class="week-bar" style="height:${Math.round((v / maxWeek) * 100)}%" title="${v} mensagem(ns)"></div>
       <span class="week-label">${dias[i]}</span>
     </div>`).join("");

  $(sel + " .metric-content").innerHTML = `
    <div class="metric-row"><span>Mensagens enviadas</span><b>${m.totalSent}</b></div>
    <div class="metric-row"><span>Com retorno</span><b style="color:var(--primary)">${m.replied}</b></div>
    <div class="metric-row"><span>Sem retorno</span><b>${m.semRetorno}</b></div>
    <div class="metric-row"><span>Campanhas</span><b>${m.campanhas}</b></div>
    <div class="metric-row"><span>Melhor horário de retorno</span><b>${hora}</b></div>
    <div style="margin-top:10px;font-size:13px">Taxa de resposta: <b style="color:${rateColor}">${m.taxa}%</b></div>
    <div class="metric-rate-bar"><div class="metric-rate-fill" style="width:${Math.min(m.taxa, 100)}%;background:${rateColor}"></div></div>
    <div class="week-chart">${chart}</div>
    <div style="text-align:center;font-size:11px;color:var(--muted);margin-top:4px">Mensagens por dia da semana</div>`;
}

// Logout
$("#btnLogout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

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

  // Intervalo: restaura preferência salva ou usa o padrão do servidor
  const savedDelay = localStorage.getItem("zapflow_delay");
  if (savedDelay) $("#delaySeconds").value = savedDelay;

  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (!savedDelay && cfg.defaultDelaySeconds) $("#delaySeconds").value = cfg.defaultDelaySeconds;
    if (cfg.authEnabled) $("#btnLogout").classList.remove("hidden");
    checkDelayWarning();
    if (cfg.hasEnvCredentials) {
      setConnCollapsed(true); // já vem minimizado quando há credenciais no servidor
      // Testa a conexão automaticamente e mostra "Conectado" no cabeçalho
      runConnectionTest({ collapseOnSuccess: false });
    }
  } catch { /* ignore */ }
});

// Registra o Service Worker (PWA — instalável e com cache offline)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* ignora falha */ });
  });
}
