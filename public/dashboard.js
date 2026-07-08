const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

// PWA: busca atualização do app e recarrega sozinho quando o SW novo assume
if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return; refreshing = true; location.reload();
  });
  navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const fmtDate = (ts) => new Date(ts).toLocaleString("pt-BR");

const STATUS = {
  pendente: { txt: "⏳ Pendente", cls: "pend" },
  enviando: { txt: "📤 Enviando", cls: "sending" },
  concluido: { txt: "✅ Concluído", cls: "ok" },
  erro: { txt: "❌ Erro", cls: "err" },
  cancelado: { txt: "🚫 Cancelado", cls: "cancel" },
};
const statusOf = (job) =>
  (job.immediate && job.status === "concluido") ? { txt: "✅ Enviada", cls: "ok" } : (STATUS[job.status] || { txt: job.status, cls: "" });

// ---------------------------------------------------------------------------
// Navegação entre as abas
// ---------------------------------------------------------------------------
function activateView(view) {
  $$(".dash-tab, .side-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".dash-view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== view));
  loadView(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".dash-tab, .side-tab").forEach((tab) => {
  tab.addEventListener("click", () => activateView(tab.dataset.view));
});

function loadView(view) {
  if (view === "overview") loadOverview();
  else if (view === "clients") loadClients();
  else if (view === "agenda") loadAgenda();
  else if (view === "conversas") loadConversas();
  else if (view === "campaigns") loadCampaigns();
  else if (view === "responses") loadResponses();
  else if (view === "followup") loadFollowup();
  else if (view === "chatbot") loadChatbot();
}

// ---------------------------------------------------------------------------
// Visão Geral (Dashboard BI)
// ---------------------------------------------------------------------------
let ovPeriod = "hoje";
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const rateColor = (t) => t >= 30 ? css("--success") : t >= 15 ? css("--warn") : css("--error");

$$(".period-pill").forEach((p) => p.addEventListener("click", () => {
  $$(".period-pill").forEach((x) => x.classList.remove("active"));
  p.classList.add("active");
  ovPeriod = p.dataset.period;
  loadOverview();
}));

/** Animação de contagem crescente (0.5s). */
function countUp(el, target, suffix = "") {
  const dur = 500, t0 = performance.now();
  const dec = String(target).includes(".");
  function step(t) {
    const p = Math.min((t - t0) / dur, 1);
    const val = target * (0.5 - Math.cos(Math.PI * p) / 2); // easeInOut
    el.textContent = (dec ? val.toFixed(1) : Math.round(val)) + suffix;
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target + suffix;
  }
  requestAnimationFrame(step);
}

async function loadOverview() {
  try {
    const data = await (await fetch("/api/dashboard?period=" + ovPeriod)).json();
    const k = data.kpis;
    const semDados = !k.enviadas && !k.conversas.total && !k.clientes;
    $("#ovEmpty").classList.toggle("hidden", !semDados);
    $("#ovBody").classList.toggle("hidden", semDados);
    if (semDados) return;

    // LINHA 1 — KPIs (com contagem crescente)
    countUp($("#kpiEnviadas"), k.enviadas);
    countUp($("#kpiConversas"), k.conversas.total);
    $("#kpiConversasSub").textContent = `${k.conversas.campanha} de campanha · ${k.conversas.diaadia} dia a dia`;
    const tx = $("#kpiTaxa"); tx.style.color = rateColor(k.taxa); countUp(tx, k.taxa, "%");
    countUp($("#kpiClientes"), k.clientes);
    $("#kpiClientesSub").textContent = k.clientesNovos > 0 ? `+${k.clientesNovos} novos no período` : "";

    // LINHA 2 — Donut + barras
    drawDonut($("#donutChart"), data.donut.responderam, data.donut.responderam + data.donut.semResposta, k.taxa);
    $("#donutPct").textContent = k.taxa + "%"; $("#donutPct").style.color = rateColor(k.taxa);
    $("#legResp").textContent = data.donut.responderam;
    $("#legNo").textContent = data.donut.semResposta;
    renderWeekBars(data.weekday);

    // LINHA 3 — Linha + funil
    drawLine($("#lineChart"), data.serie30);
    renderFunil(data.funil);

    // LINHA 4 — Ranking + melhor horário
    renderRanking(data.ranking);
    $("#melhorHora").textContent = data.melhorHora === null ? "—" : String(data.melhorHora).padStart(2, "0") + "h";
  } catch {
    $("#ovEmpty").classList.remove("hidden");
    $("#ovEmpty").textContent = "Erro ao carregar o painel.";
  }
}

function renderWeekBars(week) {
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const max = Math.max(1, ...week);
  const maxIdx = week.indexOf(Math.max(...week));
  $("#weekChart").innerHTML = week.map((v, i) =>
    `<div class="week-col"><div class="week-bar${i === maxIdx && v > 0 ? " top" : ""}" style="height:${Math.round((v / max) * 100)}%" title="${v}"></div><span class="week-label">${dias[i]}</span></div>`
  ).join("");
}

function renderFunil(funil) {
  const clsMap = { Novo: "st-novo", Contatado: "st-contatado", Respondeu: "st-respondeu", Negociando: "st-negociando", Cliente: "st-cliente" };
  const max = Math.max(1, ...funil.map((f) => f.count));
  $("#funilChart").innerHTML = funil.map((f) =>
    `<div class="funil-row" data-stage="${f.stage}">
       <span class="funil-label">${f.stage}</span>
       <div class="funil-track"><div class="funil-bar ${clsMap[f.stage]}" style="width:${Math.max(4, Math.round((f.count / max) * 100))}%"></div></div>
       <span class="funil-count">${f.count}</span>
     </div>`).join("");
  $$("#funilChart .funil-row").forEach((row) => row.addEventListener("click", () => {
    activateView("clients");
    setTimeout(() => { const sel = $("#crmStage"); if (sel) { sel.value = row.dataset.stage; loadClients(); } }, 150);
  }));
}

function renderRanking(list) {
  if (!list.length) { $("#rankingList").innerHTML = "<p class='hint'>Nenhuma campanha ainda.</p>"; return; }
  $("#rankingList").innerHTML = list.map((r) => `
    <div class="rank-item">
      <div class="rank-info">
        <span class="rank-name">${escapeHtml(r.name)}</span>
        <span class="rank-stats">📤 ${r.enviadas} · ↩ ${r.respostas} · <b style="color:${rateColor(r.taxa)}">${r.taxa}%</b></span>
      </div>
      <button class="btn ghost rank-fu" data-id="${r.id}">🔁</button>
    </div>`).join("");
  $$("#rankingList .rank-fu").forEach((b) => b.addEventListener("click", () => { activateView("campaigns"); setTimeout(() => openCampaign(b.dataset.id), 150); }));
}

// --- Gráficos em canvas (sem lib) ---
function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || c.width, h = c.clientHeight || c.height;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  return { ctx, w, h };
}
function drawDonut(canvas, value, total, pct) {
  const { ctx, w, h } = fitCanvas(canvas);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8, lw = r * 0.32;
  const frac = total ? value / total : 0;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = lw; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = "#2A3B4D"; ctx.stroke();
  if (frac > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = rateColor(pct); ctx.stroke();
  }
}
function drawLine(canvas, serie) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 6, r: 6, t: 10, b: 6 };
  const env = serie.enviadas, resp = serie.respostas, n = env.length;
  const max = Math.max(1, ...env, ...resp);
  const px = (i) => pad.l + (i * (w - pad.l - pad.r)) / (n - 1);
  const py = (v) => h - pad.b - (v / max) * (h - pad.t - pad.b);
  const line = (arr, color, fill) => {
    ctx.beginPath();
    arr.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
    if (fill) {
      ctx.lineTo(px(n - 1), h - pad.b); ctx.lineTo(px(0), h - pad.b); ctx.closePath();
      const g = ctx.createLinearGradient(0, pad.t, 0, h);
      g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
      ctx.fillStyle = g; ctx.fill();
    } else {
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.lineJoin = "round"; ctx.stroke();
    }
  };
  line(env, css("--primary-light"), true);
  line(env, css("--primary-light"), false);
  line(resp, css("--accent"), false);
}

// ---------------------------------------------------------------------------
// Clientes (CRM-lite)
// ---------------------------------------------------------------------------
const STAGE_CLS = { Novo: "st-novo", Contatado: "st-contatado", Respondeu: "st-respondeu", Negociando: "st-negociando", Cliente: "st-cliente", Perdido: "st-perdido" };
let crmMeta = { stages: [], tags: [] };
let crmList = [];
let crmCurrent = null;

async function loadClients() {
  await loadCrmMeta();
  const wrap = $("#clientsList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  const params = new URLSearchParams({
    search: $("#crmSearch").value.trim(),
    stage: $("#crmStage").value,
    tag: $("#crmTag").value,
  });
  try {
    const res = await fetch("/api/clients?" + params);
    const data = await res.json();
    crmList = data.clients || [];
    $("#crmShown").textContent = `${data.shown} de ${data.total} cliente(s)`;
    if (!crmList.length) {
      wrap.innerHTML = "<p class='hint'>Nenhum cliente nesse filtro. A base se preenche conforme você dispara.</p>";
      return;
    }
    wrap.innerHTML = "";
    crmList.forEach((c) => wrap.appendChild(clientCard(c)));
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar clientes.</p>";
  }
}

async function loadCrmMeta() {
  try {
    const res = await fetch("/api/clients/meta");
    crmMeta = await res.json();
    const stageSel = $("#crmStage");
    if (stageSel.options.length <= 1) {
      crmMeta.stages.forEach((s) => stageSel.insertAdjacentHTML("beforeend", `<option value="${s}">${s}</option>`));
    }
    const tagSel = $("#crmTag");
    tagSel.innerHTML = '<option value="">Todas as tags</option>' +
      crmMeta.tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    // barra de etapas
    $("#crmStageBar").innerHTML = crmMeta.stages
      .map((s) => `<span class="stage-pill ${STAGE_CLS[s] || ""}">${s}: <b>${crmMeta.stageCount[s] || 0}</b></span>`)
      .join("");
  } catch { /* ignore */ }
}

function clientCard(c) {
  const div = document.createElement("div");
  div.className = "dash-card " + (STAGE_CLS[c.stage] || "");
  const tags = (c.tags || []).map((t) => `<span class="badge manual">${escapeHtml(t)}</span>`).join(" ");
  const last = c.lastReplyAt ? `↩ respondeu ${fmtDate(c.lastReplyAt)}`
    : c.lastSentAt ? `📤 enviado ${fmtDate(c.lastSentAt)}` : "novo";
  const nome = c.displayName || c.name || "(sem nome)";
  const agenda = c.inAgenda ? ' <span title="Na sua agenda">📇</span>' : "";
  div.innerHTML = `
    <div class="dash-card-head">
      <span class="resp-phone">${escapeHtml(nome)}${agenda}</span>
      <span class="stage-pill ${STAGE_CLS[c.stage] || ""}">${escapeHtml(c.stage)}</span>
    </div>
    <div class="dash-card-body">
      <span>📱 ${escapeHtml(c.phone)} · ${last}</span>
      ${tags ? `<span>${tags}</span>` : ""}
    </div>`;
  div.addEventListener("click", () => openClient(c));
  return div;
}

function openClient(c) {
  crmCurrent = c;
  $("#clientTitle").textContent = c.displayName || c.name || "Cliente";
  $("#clientPhone").textContent = "📱 " + c.phone + (c.inAgenda ? "  📇 na agenda" : "");
  $("#clientName").value = c.name || "";
  $("#clientStage").innerHTML = crmMeta.stages.map((s) => `<option ${s === c.stage ? "selected" : ""}>${s}</option>`).join("");
  $("#clientTags").value = (c.tags || []).join(", ");
  $("#clientNotes").value = c.notes || "";
  $("#clientMeta").textContent =
    (c.lastSentAt ? `Último envio: ${fmtDate(c.lastSentAt)}. ` : "") +
    (c.lastReplyAt ? `Última resposta: ${fmtDate(c.lastReplyAt)}.` : "");
  $("#clientStatus").textContent = "";
  openModal("clientModal");
}

$("#btnSaveClient").addEventListener("click", async () => {
  if (!crmCurrent) return;
  const body = {
    name: $("#clientName").value.trim(),
    stage: $("#clientStage").value,
    tags: $("#clientTags").value.split(",").map((t) => t.trim()).filter(Boolean),
    notes: $("#clientNotes").value.trim(),
  };
  try {
    const res = await fetch("/api/clients/" + crmCurrent.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    closeModal("clientModal");
    loadClients();
  } catch {
    $("#clientStatus").textContent = "❌ Erro ao salvar";
    $("#clientStatus").className = "status err";
  }
});

$("#btnDeleteClient").addEventListener("click", async () => {
  if (!crmCurrent || !confirm("Excluir este cliente da base?")) return;
  await fetch("/api/clients/" + crmCurrent.id, { method: "DELETE" });
  closeModal("clientModal");
  loadClients();
});

// Disparar para a lista filtrada
$("#btnCrmDispatch").addEventListener("click", () => {
  if (!crmList.length) { alert("Não há clientes nesse filtro."); return; }
  const contacts = crmList.map((c) => ({ phone: c.phone, name: c.name || "" }));
  sessionStorage.setItem("zapflow_loadlist", JSON.stringify({ label: "lista do CRM", contacts }));
  alert(`${contacts.length} cliente(s) preparados para disparo.\nVocê será levado ao disparo para montar a mensagem.`);
  window.location.href = "/";
});

// Filtros (com pequeno debounce na busca)
let crmTimer = null;
$("#crmSearch").addEventListener("input", () => { clearTimeout(crmTimer); crmTimer = setTimeout(loadClients, 350); });
$("#crmStage").addEventListener("change", loadClients);
$("#crmTag").addEventListener("change", loadClients);

// ---------------------------------------------------------------------------
// Conversas (caixa de entrada)
// ---------------------------------------------------------------------------
let convFilter = "all";
let chatKey = null;

async function loadConversas() {
  const wrap = $("#conversasList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const params = new URLSearchParams({ filter: convFilter, search: $("#convSearch").value.trim() });
    const data = await (await fetch("/api/conversas?" + params)).json();
    const threads = data.threads || [];
    if (!threads.length) {
      wrap.innerHTML = "<p class='hint'>Nenhuma conversa ainda. Elas aparecem quando alguém te responde ou escreve.</p>";
      return;
    }
    wrap.innerHTML = "";
    threads.forEach((t) => {
      const div = document.createElement("div");
      div.className = "dash-card conv-item";
      const nome = t.name || t.phone;
      const badge = t.origem === "campaign"
        ? `<span class="conv-badge camp">📣 ${escapeHtml(t.campaignName || "Campanha")}</span>`
        : `<span class="conv-badge daily">💬 Dia a dia</span>`;
      const pre = (t.dir === "out" ? "Você: " : "") + (t.lastText || "");
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">${escapeHtml(nome)}</span>
          <span class="dash-when">${fmtDate(t.lastTs)}</span>
        </div>
        <div class="dash-card-body">
          <span class="conv-last">${escapeHtml(pre.slice(0, 60))}${pre.length > 60 ? "…" : ""}</span>
          ${badge}
        </div>`;
      div.addEventListener("click", () => openChat(t.key, nome));
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar conversas.</p>";
  }
}

$$(".conv-fbtn").forEach((b) => b.addEventListener("click", () => {
  $$(".conv-fbtn").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  convFilter = b.dataset.filter;
  loadConversas();
}));
let convTimer = null;
$("#convSearch").addEventListener("input", () => { clearTimeout(convTimer); convTimer = setTimeout(loadConversas, 350); });

async function openChat(key, nome) {
  chatKey = key;
  $("#chatTitle").textContent = nome || "Conversa";
  $("#chatStatus").textContent = "";
  $("#chatMessages").innerHTML = "<p class='hint'>Carregando...</p>";
  openModal("chatModal");
  try {
    const data = await (await fetch("/api/conversas/" + key)).json();
    const box = $("#chatMessages");
    box.innerHTML = (data.messages || []).map((m) =>
      `<div class="bubble ${m.dir === "out" ? "out" : "in"}">
         <div class="bubble-text">${escapeHtml(m.text)}</div>
         <div class="bubble-time">${fmtDate(m.ts)}</div>
       </div>`).join("") || "<p class='hint'>Sem mensagens.</p>";
    box.scrollTop = box.scrollHeight;
  } catch {
    $("#chatMessages").innerHTML = "<p class='hint'>Erro ao carregar a conversa.</p>";
  }
}

async function sendReply() {
  if (!chatKey) return;
  const input = $("#chatInput");
  const message = input.value.trim();
  if (!message) return;
  const status = $("#chatStatus");
  $("#chatSend").disabled = true;
  status.textContent = "Enviando...";
  status.className = "status";
  try {
    const res = await fetch("/api/conversas/" + chatKey + "/reply", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao enviar.");
    input.value = "";
    status.textContent = "";
    openChat(chatKey, $("#chatTitle").textContent); // recarrega o histórico
  } catch (err) {
    status.textContent = "❌ " + err.message;
    status.className = "status err";
  } finally {
    $("#chatSend").disabled = false;
  }
}
$("#chatSend").addEventListener("click", sendReply);
$("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendReply(); });

// ---------------------------------------------------------------------------
// Agenda de contatos
// ---------------------------------------------------------------------------
const ORIGEM_LABEL = { planilha: "📄 Planilha", manual: "✍️ Manual", chip: "📱 Chip" };

async function loadAgenda() {
  const wrap = $("#agendaList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const params = new URLSearchParams({ search: $("#agSearch").value.trim() });
    const data = await (await fetch("/api/agenda?" + params)).json();
    $("#agCount").textContent = `${data.shown} de ${data.total} contato(s) na agenda`;
    if (!data.contacts.length) {
      wrap.innerHTML = "<p class='hint'>Nenhum contato salvo ainda. Adicione manualmente, importe uma planilha ou sincronize do chip.</p>";
      return;
    }
    wrap.innerHTML = "";
    data.contacts.forEach((c) => {
      const inCart = agendaCart.some((x) => x.phone === c.phone);
      const div = document.createElement("div");
      div.className = "dash-card";
      div.style.cursor = "default";
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">📇 ${escapeHtml(c.name || "(sem nome)")}</span>
          <div class="row" style="gap:6px;margin:0">
            <button class="btn ghost ag-add ${inCart ? "in-cart" : ""}" data-id="${c.id}">${inCart ? "✓ Inserido" : "➕ Inserir"}</button>
            <button class="btn-cancel ag-del" data-id="${c.id}">Excluir</button>
          </div>
        </div>
        <div class="dash-card-body">
          <span>📱 ${escapeHtml(c.phone)} · ${ORIGEM_LABEL[c.origem] || c.origem}</span>
        </div>`;
      div.querySelector(".ag-add").addEventListener("click", (e) => {
        toggleCart(c, e.currentTarget);
      });
      div.querySelector(".ag-del").addEventListener("click", async () => {
        if (!confirm("Remover este contato da agenda?")) return;
        await fetch("/api/agenda/" + c.id, { method: "DELETE" });
        agendaCart = agendaCart.filter((x) => x.phone !== c.phone);
        updateAgCart();
        loadAgenda();
      });
      wrap.appendChild(div);
    });
    updateAgCart();
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar a agenda.</p>";
  }
}

// "Carrinho" de contatos selecionados na agenda para enviar ao disparo
let agendaCart = [];
function toggleCart(c, btn) {
  const idx = agendaCart.findIndex((x) => x.phone === c.phone);
  if (idx >= 0) {
    agendaCart.splice(idx, 1);
    btn.classList.remove("in-cart");
    btn.textContent = "➕ Inserir";
  } else {
    agendaCart.push({ phone: c.phone, name: c.name || "" });
    btn.classList.add("in-cart");
    btn.textContent = "✓ Inserido";
  }
  updateAgCart();
}
function updateAgCart() {
  const bar = document.getElementById("agCartBar");
  if (!bar) return;
  const n = agendaCart.length;
  bar.classList.toggle("hidden", n === 0);
  const label = document.getElementById("agCartLabel");
  if (label) label.textContent = `${n} contato(s) selecionado(s)`;
}
document.getElementById("btnAgCartClear")?.addEventListener("click", () => {
  agendaCart = [];
  updateAgCart();
  loadAgenda();
});
document.getElementById("btnAgCartGo")?.addEventListener("click", () => {
  if (!agendaCart.length) return;
  sessionStorage.setItem("zapflow_loadlist", JSON.stringify({ label: "contatos da agenda", contacts: agendaCart }));
  window.location.href = "/";
});

// Adicionar manualmente
$("#btnAgAdd").addEventListener("click", async () => {
  const name = $("#agName").value.trim();
  const phone = $("#agPhone").value.trim();
  const status = $("#agStatus");
  if (!phone) { status.textContent = "Informe o telefone."; status.className = "status err"; return; }
  const res = await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }) });
  const data = await res.json();
  if (!res.ok) { status.textContent = "❌ " + (data.error || "Erro"); status.className = "status err"; return; }
  status.textContent = "✅ Salvo!"; status.className = "status ok";
  $("#agName").value = ""; $("#agPhone").value = "";
  loadAgenda();
});

// Importar planilha
$("#agFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $("#agStatus");
  status.textContent = "Importando..."; status.className = "status";
  const fd = new FormData(); fd.append("file", file);
  try {
    const res = await fetch("/api/agenda/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha");
    status.textContent = `✅ ${data.imported} contato(s) importado(s)!`; status.className = "status ok";
    loadAgenda();
  } catch (err) {
    status.textContent = "❌ " + err.message; status.className = "status err";
  }
  e.target.value = "";
});

// Sincronizar do chip
$("#btnAgSync").addEventListener("click", async () => {
  const status = $("#agStatus");
  if (!confirm("Importar os contatos salvos no aparelho conectado?")) return;
  status.textContent = "Sincronizando (pode levar alguns segundos)..."; status.className = "status";
  try {
    const res = await fetch("/api/agenda/sync-chip", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha");
    status.textContent = `✅ ${data.imported} contato(s) sincronizado(s)!`; status.className = "status ok";
    loadAgenda();
  } catch (err) {
    status.textContent = "❌ " + err.message; status.className = "status err";
  }
});

let agTimer = null;
$("#agSearch").addEventListener("input", () => { clearTimeout(agTimer); agTimer = setTimeout(loadAgenda, 350); });

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------
let allJobs = [];

async function loadCampaigns() {
  loadDrafts();
  const wrap = $("#campaignsList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/schedules");
    allJobs = (await res.json()).jobs || [];
    if (!allJobs.length) { wrap.innerHTML = "<p class='hint'>Nenhuma campanha ainda.</p>"; return; }
    wrap.innerHTML = "";
    allJobs.forEach((job) => wrap.appendChild(campaignCard(job)));
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar campanhas.</p>";
  }
}

function campaignCard(job) {
  const st = statusOf(job);
  const div = document.createElement("div");
  div.className = "dash-card " + st.cls;
  const preview = (job.message || (job.hasImage ? "[imagem]" : "")).slice(0, 70);
  const reply = job.result ? ` · ↩ ${job.repliedCount} responderam` : "";
  div.innerHTML = `
    <div class="dash-card-head">
      <span class="sched-status ${st.cls}">${st.txt}</span>
      <span class="dash-when">🕒 ${fmtDate(job.scheduledAt)}</span>
    </div>
    <div class="dash-card-body">
      <span>${job.contactsCount} contato(s)${job.hasImage ? ` · 🖼️ ${job.imageCount}` : ""}${reply}</span>
      ${preview ? `<span class="sched-msg">"${escapeHtml(preview)}"</span>` : ""}
    </div>`;
  div.addEventListener("click", () => openCampaign(job.id));
  return div;
}

// --- Modelos / rascunhos de campanha (mesma base de "Salvar como modelo" do disparo) ---
function draftUrls(t) {
  if (Array.isArray(t.imageUrls)) return t.imageUrls.filter(Boolean);
  return t.imageUrl ? [t.imageUrl] : [];
}

async function loadDrafts() {
  const wrap = $("#draftsList");
  if (!wrap) return;
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const data = await (await fetch("/api/templates")).json();
    const list = data.templates || [];
    $("#draftsCount").textContent = `${list.length}/10`;
    if (!list.length) { wrap.innerHTML = "<p class='hint'>Nenhum modelo salvo ainda. Crie um acima ou use “Salvar como modelo” na tela de disparo.</p>"; return; }
    wrap.innerHTML = "";
    list.forEach((t) => {
      const urls = draftUrls(t);
      const preview = (t.message || "").slice(0, 80) || (urls.length ? "[imagem]" : "");
      const div = document.createElement("div");
      div.className = "dash-card";
      div.style.cursor = "default";
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">💾 ${escapeHtml(t.name || "(sem nome)")}</span>
          <div class="row" style="gap:6px;margin:0">
            <button class="btn ghost draft-use">🚀 Usar no disparo</button>
            <button class="btn-cancel draft-del">Excluir</button>
          </div>
        </div>
        <div class="dash-card-body">
          ${preview ? `<span class="sched-msg">"${escapeHtml(preview)}"</span>` : ""}
          ${urls.length ? `<span>🖼️ ${urls.length} imagem(ns)</span>` : ""}
        </div>`;
      div.querySelector(".draft-use").addEventListener("click", () => {
        sessionStorage.setItem("zapflow_loadtemplate", JSON.stringify(t));
        window.location.href = "/";
      });
      div.querySelector(".draft-del").addEventListener("click", async () => {
        if (!confirm("Excluir este modelo?")) return;
        await fetch("/api/templates/" + t.id, { method: "DELETE" });
        loadDrafts();
      });
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar os modelos.</p>";
  }
}

function clearDraftForm() {
  ["draftName", "draftMsg", "draftLink", "draftImg"].forEach((id) => { const el = $("#" + id); if (el) el.value = ""; });
  const st = $("#draftStatus"); if (st) { st.textContent = ""; st.className = "status"; }
}

$("#btnNewDraft")?.addEventListener("click", () => {
  const form = $("#draftForm");
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) $("#draftName").focus();
});
$("#btnCancelDraft")?.addEventListener("click", () => {
  $("#draftForm").classList.add("hidden");
  clearDraftForm();
});
$("#btnSaveDraft")?.addEventListener("click", async () => {
  const name = $("#draftName").value.trim();
  const msg = $("#draftMsg").value.trim();
  const link = $("#draftLink").value.trim();
  const img = $("#draftImg").value.trim();
  const status = $("#draftStatus");
  const message = link ? (msg ? msg + "\n" + link : link) : msg;
  if (!name) { status.textContent = "Dê um nome ao modelo."; status.className = "status err"; return; }
  if (!message && !img) { status.textContent = "Escreva a mensagem ou informe uma imagem."; status.className = "status err"; return; }
  try {
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message, imageUrls: img ? [img] : [] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
    status.textContent = "✅ Modelo salvo!"; status.className = "status ok";
    clearDraftForm();
    $("#draftForm").classList.add("hidden");
    loadDrafts();
  } catch (err) {
    status.textContent = "❌ " + err.message; status.className = "status err";
  }
});

let currentDetail = null;

async function openCampaign(id) {
  openModal("campaignModal");
  $("#campaignContacts").innerHTML = "<p class='hint'>Carregando...</p>";
  $("#campaignSummary").innerHTML = "";
  try {
    const res = await fetch("/api/schedules/" + id);
    const job = (await res.json()).job;
    currentDetail = job;
    const logs = job.logs || [];
    const enviados = logs.filter((l) => l.ok).length;
    const falhas = logs.filter((l) => !l.ok).length;
    const responderam = logs.filter((l) => l.replied).length;
    $("#campaignTitle").textContent = "Campanha · " + fmtDate(job.scheduledAt);
    $("#campaignSummary").innerHTML = `
      <div class="metric-row"><span>Enviadas</span><b style="color:var(--primary)">${enviados}</b></div>
      <div class="metric-row"><span>Falhas</span><b style="color:var(--danger)">${falhas}</b></div>
      <div class="metric-row"><span>Responderam</span><b style="color:var(--primary)">${responderam}</b></div>
      ${job.message ? `<div class="campaign-msg">"${escapeHtml(job.message)}"</div>` : ""}`;
    $("#campaignContacts").innerHTML = logs.map((l) => {
      const icon = l.ok ? '<span class="d-ok">✅</span>' : `<span class="d-err">❌</span>`;
      const rep = l.replied ? ' <span class="d-replied">↩ respondeu</span>' : "";
      const name = l.name ? escapeHtml(l.name) + " — " : "";
      const err = (!l.ok && l.error) ? ` <span class="d-err">(${escapeHtml(l.error)})</span>` : "";
      return `<div class="d-line">${icon} ${name}${escapeHtml(l.phone || "")}${rep}${err}</div>`;
    }).join("") || "<p class='hint'>Sem detalhes.</p>";
  } catch {
    $("#campaignContacts").innerHTML = "<p class='hint'>Erro ao carregar a campanha.</p>";
  }
}

// Prepara um follow-up: separa quem não respondeu e leva pro disparo
$("#btnPrepareFollowup").addEventListener("click", () => {
  if (!currentDetail) return;
  const naoResponderam = (currentDetail.logs || [])
    .filter((l) => l.ok && !l.replied && l.phone)
    .map((l) => ({ phone: l.phone, name: l.name || "" }));
  if (!naoResponderam.length) {
    alert("Todos que receberam já responderam (ou ninguém foi enviado). 🎉");
    return;
  }
  sessionStorage.setItem("zapflow_loadlist", JSON.stringify({ label: "follow-up", contacts: naoResponderam }));
  alert(`${naoResponderam.length} contato(s) que não responderam foram preparados.\nVocê será levado ao disparo para montar a mensagem de follow-up.`);
  window.location.href = "/";
});

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------
async function loadResponses() {
  const wrap = $("#responsesList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/responses");
    const list = (await res.json()).responses || [];
    if (!list.length) {
      wrap.innerHTML = "<p class='hint'>Nenhuma resposta recebida ainda. Verifique se o webhook da Z-API está configurado.</p>";
      return;
    }
    wrap.innerHTML = "";
    list.forEach((r) => {
      const div = document.createElement("div");
      div.className = "dash-card";
      const titulo = r.name ? `${escapeHtml(r.name)} · ${escapeHtml(r.phone)}` : `📱 ${escapeHtml(r.phone)}`;
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">${titulo}</span>
          <span class="dash-when">🕒 ${fmtDate(r.ts)}</span>
        </div>
        ${r.content ? `<div class="dash-card-body"><span class="sched-msg">"${escapeHtml(r.content)}"</span></div>` : ""}`;
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar respostas.</p>";
  }
}

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------
async function loadFollowup() {
  const wrap = $("#followupList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/schedules");
    const jobs = ((await res.json()).jobs || []).filter((j) => j.result && j.result.success > 0);
    if (!jobs.length) { wrap.innerHTML = "<p class='hint'>Nenhuma campanha concluída ainda.</p>"; return; }
    wrap.innerHTML = "";
    jobs.forEach((job) => {
      const naoResp = Math.max(0, (job.result.success || 0) - (job.repliedCount || 0));
      const div = document.createElement("div");
      div.className = "dash-card";
      const preview = (job.message || "[imagem]").slice(0, 60);
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="dash-when">🕒 ${fmtDate(job.scheduledAt)}</span>
          <span class="followup-badge">${naoResp} sem resposta</span>
        </div>
        <div class="dash-card-body">
          <span>${job.result.success} enviadas · ↩ ${job.repliedCount} responderam</span>
          <span class="sched-msg">"${escapeHtml(preview)}"</span>
        </div>
        <button class="btn primary fu-btn" ${naoResp ? "" : "disabled"}>🔁 Preparar follow-up (${naoResp})</button>`;
      div.querySelector(".fu-btn").addEventListener("click", () => openCampaign(job.id));
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro ao carregar.</p>";
  }
}

// ---------------------------------------------------------------------------
// Chatbot / Automação
// ---------------------------------------------------------------------------
async function loadChatbot() {
  try {
    const cfg = await (await fetch("/api/chatbot")).json();
    $("#botEnabled").checked = !!cfg.enabled;
    $("#botFallbackEnabled").checked = !!(cfg.fallback && cfg.fallback.enabled);
    $("#botFallbackReply").value = cfg.fallback?.reply || "";
    $("#rulesList").innerHTML = "";
    (cfg.rules || []).forEach(addRuleRow);
    if (!cfg.rules || !cfg.rules.length) addRuleRow();
  } catch {
    $("#rulesList").innerHTML = "<p class='hint'>Erro ao carregar.</p>";
  }
}

function addRuleRow(rule = {}) {
  const div = document.createElement("div");
  div.className = "rule-card";
  const mt = rule.matchType || "contains";
  div.innerHTML = `
    <div class="rule-head">
      <label class="switch-row" style="margin:0"><input type="checkbox" class="rule-active" ${rule.active === false ? "" : "checked"} /> Ativa</label>
      <button type="button" class="btn-remove rule-del">✕ Remover</button>
    </div>
    <label>Palavras-chave <small class="hint" style="font-weight:400">(separe por vírgula)</small>
      <input type="text" class="rule-keywords" placeholder="preço, valor, quanto custa" value="${escapeHtml((rule.keywords || []).join(", "))}" />
    </label>
    <label>Quando a mensagem
      <select class="rule-match">
        <option value="contains" ${mt === "contains" ? "selected" : ""}>contém a palavra</option>
        <option value="exact" ${mt === "exact" ? "selected" : ""}>é exatamente igual</option>
        <option value="starts" ${mt === "starts" ? "selected" : ""}>começa com</option>
      </select>
    </label>
    <label>Responder com
      <textarea class="rule-reply" rows="2" placeholder="Olá {{nome}}! Nossa tabela de pneus: ...">${escapeHtml(rule.reply || "")}</textarea>
    </label>`;
  div.querySelector(".rule-del").addEventListener("click", () => div.remove());
  $("#rulesList").appendChild(div);
}

$("#btnAddRule").addEventListener("click", () => addRuleRow());

$("#btnSaveBot").addEventListener("click", async () => {
  const rules = $$(".rule-card").map((card) => ({
    keywords: $(".rule-keywords", card).value.split(",").map((k) => k.trim()).filter(Boolean),
    matchType: $(".rule-match", card).value,
    reply: $(".rule-reply", card).value.trim(),
    active: $(".rule-active", card).checked,
  })).filter((r) => r.keywords.length && r.reply);

  const body = {
    enabled: $("#botEnabled").checked,
    rules,
    fallback: { enabled: $("#botFallbackEnabled").checked, reply: $("#botFallbackReply").value.trim() },
  };
  const status = $("#botStatus");
  try {
    const res = await fetch("/api/chatbot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error();
    status.textContent = "✅ Automação salva!";
    status.className = "status ok";
  } catch {
    status.textContent = "❌ Erro ao salvar";
    status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------
function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }
$$(".modal-close").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); }));

// Início
loadOverview();
