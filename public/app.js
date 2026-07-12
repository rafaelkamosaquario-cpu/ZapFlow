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
// Compatibilidade: função mantida para chamadas antigas (não recolhe mais nada)
function setConnCollapsed() { /* card de status não recolhe */ }

let waConnected = null; // null=desconhecido, true/false
function setConnState(state, title) {
  const dot = $("#connDot"); if (dot) dot.className = "wa-dot " + state;
  if (title) $("#connTitle").textContent = title;
  waConnected = state === "on" ? true : state === "off" ? false : null;
}

async function runConnectionTest() {
  const status = $("#connStatus");
  const statusM = $("#connStatusModal");
  const setBoth = (txt, cls) => {
    if (status) { status.textContent = txt; status.className = "status " + (cls || ""); }
    if (statusM) { statusM.textContent = txt; statusM.className = "status " + (cls || ""); }
  };
  setConnState("checking", "Verificando conexão…");
  setBoth("Testando…", "");
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
        setConnState("off", "WhatsApp desconectado");
        setBoth("Encontramos a conta, mas o WhatsApp não está conectado (leia o QR Code).", "err");
      } else {
        setConnState("on", "WhatsApp conectado");
        setBoth("Conexão OK!", "ok");
      }
    } else {
      setConnState("off", "WhatsApp desconectado");
      setBoth(data.error || "Falha na conexão.", "err");
    }
  } catch (err) {
    setConnState("off", "WhatsApp desconectado");
    setBoth(err.message, "err");
  }
}

$("#btnTest").addEventListener("click", runConnectionTest);
$("#btnTestModal")?.addEventListener("click", runConnectionTest);
$("#btnConfig")?.addEventListener("click", () => openModal("settingsModal"));

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

// Sincronizar contatos salvos no chip e carregá-los na lista de disparo
const btnSyncChip = $("#btnSyncChip");
if (btnSyncChip) {
  btnSyncChip.addEventListener("click", async () => {
    const status = $("#syncChipStatus");
    btnSyncChip.disabled = true;
    status.className = "status";
    status.textContent = "🔄 Sincronizando...";
    try {
      const res = await fetch("/api/agenda/sync-chip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getCredentials()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao sincronizar.");

      // Puxa a agenda (já com os contatos do chip) e adiciona à lista de disparo
      const ag = await (await fetch("/api/agenda")).json();
      let added = 0;
      (ag.contacts || []).forEach((c) => {
        const phone = normalizePhone(c.phone);
        if (!phone) return;
        if (contacts.some((x) => x.phone === phone)) return;
        if (manualContacts.some((x) => x.phone === phone)) return;
        manualContacts.push({ phone, name: c.name || "", rawPhone: String(c.phone || ""), manual: true });
        added++;
      });
      rebuildContacts();
      status.className = "status ok";
      status.textContent = `✅ ${data.imported} do chip · ${added} adicionado(s) à lista`;
    } catch (err) {
      status.className = "status err";
      status.textContent = "❌ " + err.message;
    } finally {
      btnSyncChip.disabled = false;
    }
  });
}

// Escolher contatos salvos (agenda) um a um, direto na tela de disparo
const btnPickSaved = $("#btnPickSaved");
if (btnPickSaved) {
  let savedLoaded = false;
  let savedTimer = null;
  btnPickSaved.addEventListener("click", () => {
    const picker = $("#savedPicker");
    picker.classList.toggle("hidden");
    if (!picker.classList.contains("hidden") && !savedLoaded) {
      savedLoaded = true;
      loadSavedContacts();
    }
  });
  $("#savedSearch").addEventListener("input", () => {
    clearTimeout(savedTimer);
    savedTimer = setTimeout(loadSavedContacts, 300);
  });
}

async function loadSavedContacts() {
  const wrap = $("#savedList");
  const countEl = $("#savedCount");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const params = new URLSearchParams({ search: $("#savedSearch").value.trim() });
    const data = await (await fetch("/api/agenda?" + params)).json();
    countEl.textContent = `${data.shown} de ${data.total} contato(s) salvos`;
    if (!data.contacts.length) {
      wrap.innerHTML = "<p class='hint'>Nenhum contato salvo encontrado.</p>";
      return;
    }
    wrap.innerHTML = "";
    data.contacts.forEach((c) => {
      const phone = normalizePhone(c.phone);
      if (!phone) return;
      const inList = contacts.some((x) => x.phone === phone);
      const div = document.createElement("div");
      div.className = "dash-card";
      div.style.cursor = "default";
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">📇 ${escapeHtml(c.name || "(sem nome)")}</span>
          <button class="btn ghost saved-add ${inList ? "in-cart" : ""}" type="button">${inList ? "✓ Inserido" : "➕ Inserir"}</button>
        </div>
        <div class="dash-card-body"><span>📱 ${escapeHtml(c.phone)}</span></div>`;
      div.querySelector(".saved-add").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const idx = manualContacts.findIndex((x) => x.phone === phone);
        if (idx >= 0) {
          manualContacts.splice(idx, 1);
          btn.classList.remove("in-cart");
          btn.textContent = "➕ Inserir";
        } else {
          if (!contacts.some((x) => x.phone === phone)) {
            manualContacts.push({ phone, name: c.name || "", rawPhone: String(c.phone || ""), manual: true });
          }
          btn.classList.add("in-cart");
          btn.textContent = "✓ Inserido";
        }
        rebuildContacts();
      });
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar os contatos salvos.</p>";
  }
}

/** Carrega uma lista vinda do Painel (follow-up ou CRM) via sessionStorage. */
function loadFollowupContacts() {
  try {
    const raw = sessionStorage.getItem("zapflow_loadlist") || sessionStorage.getItem("zapflow_followup");
    if (!raw) return;
    sessionStorage.removeItem("zapflow_loadlist");
    sessionStorage.removeItem("zapflow_followup");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.contacts || []);
    const label = Array.isArray(parsed) ? "follow-up" : (parsed.label || "lista");
    if (!list.length) return;
    manualContacts = list
      .map((c) => ({ phone: normalizePhone(c.phone), name: c.name || "", rawPhone: String(c.phone || ""), manual: true }))
      .filter((c) => c.phone);
    rebuildContacts();
    $("#followupCount").textContent = manualContacts.length;
    $("#loadlistLabel").textContent = label;
    $("#followupBanner").classList.remove("hidden");
  } catch { /* ignore */ }
}

/** Recombina importados + manuais e atualiza a tabela. */
function rebuildContacts() {
  contacts = [...importedContacts, ...manualContacts];
  renderContacts();
  updateSendButtons();
  updateClearButtons();
}

/** Mantém os botões de limpar sempre visíveis; habilita só quando há o que limpar. */
function updateClearButtons() {
  const hasFile = importedContacts.length > 0 || importedInvalid.length > 0;
  const hasManual = manualContacts.length > 0;
  const bf = $("#btnClearFile"); if (bf) bf.disabled = !hasFile;
  const bm = $("#btnClearManual"); if (bm) bm.disabled = !hasManual;
}

// Limpar a planilha importada
$("#btnClearFile")?.addEventListener("click", () => {
  importedContacts = [];
  importedInvalid = [];
  fileInput.value = "";
  $("#fileName").textContent = "";
  rebuildContacts();
});

// Limpar os contatos adicionados manualmente / sincronizados
$("#btnClearManual")?.addEventListener("click", () => {
  if (!confirm("Limpar todos os contatos adicionados manualmente?")) return;
  manualContacts = [];
  rebuildContacts();
});

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
  block._images = []; // até 3 imagens por mensagem: { kind: 'base64'|'url', data }

  // Abas de imagem (Galeria / URL)
  $$(".img-tabs .tab", block).forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".img-tabs .tab", block).forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      block._imageTab = tab.dataset.tab;
      $$(".tab-content[data-tab]", block).forEach((c) => {
        if (["url", "upload"].includes(c.dataset.tab)) {
          c.classList.toggle("hidden", c.dataset.tab !== tab.dataset.tab);
        }
      });
    });
  });
  block._imageTab = "upload";

  // Upload de fotos (múltiplas) -> base64, respeitando o limite de 3
  $(".m-imageFile", block).addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    let added = 0;
    files.forEach((file) => {
      if (block._images.length >= 3) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (block._images.length < 3) {
          block._images.push({ kind: "base64", data: reader.result });
          renderImagesStrip(block);
        }
      };
      reader.readAsDataURL(file);
      added++;
    });
    if (block._images.length + added > 3) {
      alert("Você pode anexar no máximo 3 imagens por mensagem.");
    }
    e.target.value = ""; // permite reescolher os mesmos arquivos depois
  });

  // Adicionar imagem por URL
  $(".m-add-url", block).addEventListener("click", () => {
    const input = $(".m-imageUrl", block);
    const url = input.value.trim();
    if (!url) return;
    if (block._images.length >= 3) {
      alert("Você pode anexar no máximo 3 imagens por mensagem.");
      return;
    }
    block._images.push({ kind: "url", data: url });
    input.value = "";
    renderImagesStrip(block);
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
      updateBlockSend(block);
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

  // Prévia + revisão + confirmação de uso responsável (Fase 4)
  $(".m-message", block).addEventListener("input", () => { updatePreview(block); updateReview(block); });
  $(".m-confirm", block).addEventListener("change", () => updateBlockSend(block));
  $(".m-preview-toggle", block).addEventListener("click", () => $(".m-preview", block).classList.toggle("open"));
  $(".m-scheduledAt", block).addEventListener("input", () => updateBlockSend(block));

  container.appendChild(block);
  if (window.ZapIcons) ZapIcons.hydrate(block); // ícones dentro do bloco clonado
  renumberMessages();
  updatePreview(block);
  updateSendButtons();
}

$("#btnAddMessage").addEventListener("click", addMessageBlock);

// Indicador de etapas (rola até a seção correspondente)
$$("#stepbar .stepbar-item").forEach((it) => it.addEventListener("click", () => {
  $$("#stepbar .stepbar-item").forEach((x) => x.classList.remove("active"));
  it.classList.add("active");
  const t = it.dataset.target;
  let el = document.getElementById(t);
  if (!el) el = t === "secRevisar" ? document.querySelector(".m-review") : t === "secEnviar" ? document.querySelector(".m-send") : null;
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}));

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
  $$(".msg-block", container).forEach((block) => updateBlockSend(block));
}

const fmtWhen = (v) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/** Rótulo dinâmico do botão + trava de confirmação + linha de revisão. */
function updateBlockSend(block) {
  const btn = $(".m-send", block);
  if (!btn || block._sending) return;
  const confirmed = !!($(".m-confirm", block) && $(".m-confirm", block).checked);
  const n = contacts.length;
  btn.disabled = n === 0 || !confirmed;
  const ico = (name) => (window.ZapIcons ? ZapIcons.svg(name, 18) : "");
  if (block._whenMode === "schedule") {
    const q = fmtWhen($(".m-scheduledAt", block).value);
    btn.innerHTML = ico("calendarclock") + " " + (n ? `Agendar campanha${q ? " para " + q : ""}` : "Agendar campanha");
  } else {
    btn.innerHTML = ico("send") + " " + (n ? `Enviar campanha para ${n} contato${n > 1 ? "s" : ""}` : "Enviar campanha");
  }
  updateReview(block);
}

function updateReview(block) {
  const line = $(".m-review-line", block);
  if (!line) return;
  const n = contacts.length;
  if (n === 0) { line.textContent = "Adicione destinatários no Passo 3 para revisar."; return; }
  const imgs = (block._images || []).length;
  const when = block._whenMode === "schedule"
    ? ("Agendada" + (fmtWhen($(".m-scheduledAt", block).value) ? " · " + fmtWhen($(".m-scheduledAt", block).value) : ""))
    : "Enviar agora";
  line.innerHTML = `<b>${n}</b> destinatário(s) · ${imgs} imagem(ns) · ${when} · ${Math.round(getDelayMs() / 1000)}s entre envios`;
}

function updatePreview(block) {
  const prev = $(".m-prev-text", block);
  if (!prev) return;
  const sample = ($(".m-message", block).value || "").replace(/\{\{\s*nome\s*\}\}/gi, "Cliente");
  prev.textContent = sample || "Sua mensagem aparece aqui…";
  const wrap = $(".m-prev-imgs", block);
  wrap.innerHTML = (block._images || []).map((im) => `<img src="${im.data}" alt="prévia" />`).join("");
  wrap.classList.toggle("hidden", (block._images || []).length === 0);
}

/** Renderiza a tira de miniaturas das imagens do bloco (até 3) com botão de remover. */
function renderImagesStrip(block) {
  const strip = $(".m-images-strip", block);
  strip.innerHTML = "";
  block._images.forEach((img, i) => {
    const div = document.createElement("div");
    div.className = "img-thumb";
    div.innerHTML = `
      <img src="${img.kind === "url" ? escapeHtml(img.data) : img.data}" alt="img ${i + 1}"
           onerror="this.classList.add('broken')" />
      <button type="button" class="img-thumb-x" title="Remover">✕</button>`;
    div.querySelector(".img-thumb-x").addEventListener("click", () => {
      block._images.splice(i, 1);
      renderImagesStrip(block);
    });
    strip.appendChild(div);
  });
  if (block._images.length > 0) {
    const counter = document.createElement("span");
    counter.className = "img-counter";
    counter.textContent = `${block._images.length}/3`;
    strip.appendChild(counter);
  }
  updatePreview(block);
  updateReview(block);
}

/** Limpa só o que foi escrito (texto + imagens), mantendo o log visível. */
function clearComposer(block) {
  $(".m-message", block).value = "";
  $(".m-imageUrl", block).value = "";
  $(".m-imageFile", block).value = "";
  block._images = [];
  renderImagesStrip(block);
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

/** Lê o conteúdo (texto + imagens) de um bloco. */
function readBlock(block) {
  const message = $(".m-message", block).value.trim();
  const imgs = block._images || [];
  const images = imgs.map((i) => i.data);
  const imageUrls = imgs.filter((i) => i.kind === "url").map((i) => i.data);
  return { message, images, imageUrls };
}

// ---------------------------------------------------------------------------
// Disparo / Agendamento de um bloco
// ---------------------------------------------------------------------------
async function handleSend(block) {
  const { message, images } = readBlock(block);
  if (!message && images.length === 0) {
    alert("Escreva uma mensagem de texto e/ou selecione ao menos uma imagem.");
    return;
  }
  if (block._whenMode === "schedule") {
    return scheduleBlock(block, message, images);
  }
  return sendNowBlock(block, message, images);
}

async function sendNowBlock(block, message, images) {
  const num = $(".msg-num", block).textContent;
  if (!confirm(`Enviar a Mensagem ${num} para ${contacts.length} contato(s) agora?`)) return;

  const btn = $(".m-send", block);
  block._sending = true;
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
        images,
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
    block._sending = false;
    updateBlockSend(block);
  }
}

async function scheduleBlock(block, message, images) {
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
  block._sending = true;
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
        images,
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
    block._sending = false;
    updateBlockSend(block);
  }
}

function handleProgress(block, evt) {
  if (evt.done) {
    setProgress(block, 100);
    $(".m-progressText", block).textContent =
      `Concluído! ${evt.success} enviada(s), ${evt.failed} falha(s) de ${evt.total}.`;
    notifyDisparoDone(evt.success, evt.failed, evt.total);
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
        <span>${job.contactsCount} contato(s)${job.hasImage ? ` · 🖼️ ${job.imageCount > 1 ? job.imageCount + " imagens" : "imagem"}` : ""}</span>
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
  const { message, imageUrls } = readBlock(block);
  if (!message && imageUrls.length === 0) {
    alert("Escreva um texto (e/ou informe imagens por URL) para salvar como modelo.\n" +
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
  const { message, imageUrls } = readBlock(templateTargetBlock);
  const name = $("#templateName").value.trim();
  if (!name) { $("#saveTemplateError").textContent = "Dê um nome ao modelo."; return; }
  try {
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message, imageUrls }),
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
    const urls = templateUrls(t);
    const preview = (t.message || (urls.length ? "[imagem]" : "")).slice(0, 80);
    div.innerHTML = `
      <div class="t-name">${escapeHtml(t.name)}</div>
      <div class="t-preview">${escapeHtml(preview)}${urls.length ? ` · 🖼️ ${urls.length}` : ""}</div>
      <div class="t-actions">
        <button class="btn primary t-load" data-id="${t.id}">Usar</button>
        <button class="btn ghost t-del" data-id="${t.id}">Excluir</button>
      </div>`;
    wrap.appendChild(div);
    div.querySelector(".t-load").addEventListener("click", () => loadTemplateInto(t));
    div.querySelector(".t-del").addEventListener("click", () => deleteTemplate(t.id));
  });
}

/** Normaliza as URLs de um modelo (compatível com o formato antigo imageUrl). */
function templateUrls(t) {
  if (Array.isArray(t.imageUrls)) return t.imageUrls.filter(Boolean);
  return t.imageUrl ? [t.imageUrl] : [];
}

function loadTemplateInto(t) {
  const block = templateTargetBlock;
  if (!block) return;
  $(".m-message", block).value = t.message || "";
  // Restaura as imagens (URLs) do modelo, respeitando o limite de 3
  block._images = templateUrls(t).slice(0, 3).map((url) => ({ kind: "url", data: url }));
  renderImagesStrip(block);
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
// Dashboard de métricas (modal legado — o painel completo agora é dashboard.html)
// ---------------------------------------------------------------------------
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
  const rateColor = m.taxa >= 30 ? "var(--success)" : m.taxa >= 15 ? "var(--warn)" : "var(--error)";
  const hora = m.melhorHora === null ? "—" : String(m.melhorHora).padStart(2, "0") + "h";
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const maxWeek = Math.max(1, ...m.week);
  const chart = m.week.map((v, i) =>
    `<div class="week-col">
       <div class="week-bar" style="height:${Math.round((v / maxWeek) * 100)}%" title="${v} mensagem(ns)"></div>
       <span class="week-label">${dias[i]}</span>
     </div>`).join("");

  const nomes = m.campanhaNomes || [];
  const campLabel = !nomes.length ? "—" : nomes.length === 1 ? nomes[0] : `${nomes[0]} (+${nomes.length - 1} outras)`;
  $(sel + " .metric-content").innerHTML = `
    <div class="metric-row campaign-row"><span>Campanha</span><b>${escapeHtml(campLabel)}</b></div>
    <div class="metric-row"><span>Mensagens enviadas</span><b>${m.totalSent}</b></div>
    <div class="metric-row"><span>Com retorno</span><b style="color:var(--success)">${m.replied}</b></div>
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
// Aviso flutuante (toast) + notificação ao concluir o disparo
// ---------------------------------------------------------------------------
function ensureToastHost() {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  return host;
}

function showToast(title, body, kind = "ok", timeout = 6000) {
  const host = ensureToastHost();
  const el = document.createElement("div");
  el.className = "toast toast-" + kind;
  el.innerHTML = `
    <div class="toast-ico">${kind === "err" ? "⚠️" : "✅"}</div>
    <div class="toast-txt">
      <b>${escapeHtml(title)}</b>
      <span>${escapeHtml(body)}</span>
    </div>
    <button class="toast-close" type="button" aria-label="Fechar">✕</button>`;
  let done = false;
  const dismiss = () => {
    if (done) return; done = true;
    el.classList.add("out");
    setTimeout(() => el.remove(), 280);
  };
  el.querySelector(".toast-close").addEventListener("click", dismiss);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  if (timeout) setTimeout(dismiss, timeout);
}

function notifyDisparoDone(success, failed, total) {
  const ok = Number(success) || 0;
  const fail = Number(failed) || 0;
  const title = fail ? "Disparo concluído com avisos" : "Disparo concluído! 🚀";
  const body = `${ok} enviada(s)` + (fail ? ` · ${fail} falha(s)` : "") + ` de ${total} contato(s).`;
  showToast(title, body, fail ? "err" : "ok", 8000);

  // Notificação do sistema (aparece na tela mesmo com o app minimizado, estilo iFood)
  try {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("ZapFlow · " + title, { body, icon: "/icon.svg", badge: "/icon.svg" });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((p) => {
          if (p === "granted") new Notification("ZapFlow · " + title, { body, icon: "/icon.svg" });
        });
      }
    }
  } catch { /* ignore */ }
}

/** Carrega um modelo/rascunho vindo da aba Campanhas (via sessionStorage) no 1º bloco. */
function applyLoadedTemplate() {
  try {
    const raw = sessionStorage.getItem("zapflow_loadtemplate");
    if (!raw) return;
    sessionStorage.removeItem("zapflow_loadtemplate");
    const t = JSON.parse(raw);
    const block = container.querySelector(".msg-block");
    if (!block) return;
    $(".m-message", block).value = t.message || "";
    block._images = templateUrls(t).slice(0, 3).map((url) => ({ kind: "url", data: url }));
    renderImagesStrip(block);
    showToast("Modelo carregado 💾", `"${t.name || "modelo"}" pronto. Escolha os contatos e dispare.`, "ok", 6000);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  loadCreds();
  CRED_KEYS.forEach((k) => $("#" + k).addEventListener("change", saveCreds));

  addMessageBlock(); // começa com 1 mensagem
  loadSchedules();
  loadFollowupContacts(); // carrega contatos vindos do "Preparar follow-up"
  applyLoadedTemplate();  // carrega modelo vindo da aba Campanhas

  // Intervalo: restaura preferência salva ou usa o padrão do servidor
  const savedDelay = localStorage.getItem("zapflow_delay");
  if (savedDelay) $("#delaySeconds").value = savedDelay;

  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (!savedDelay && cfg.defaultDelaySeconds) $("#delaySeconds").value = cfg.defaultDelaySeconds;
    if (cfg.authEnabled) $("#btnLogout").classList.remove("hidden");
    checkDelayWarning();
    // Verifica a conexão automaticamente e mostra o status no card
    runConnectionTest();
  } catch { /* ignore */ }
});

// Registra o Service Worker (PWA — instalável e com cache offline)
if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return; refreshing = true; location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => reg.update()).catch(() => {});
  });
}
