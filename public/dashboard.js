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
const fmtMoney = (v) => {
  v = Number(v) || 0;
  if (v >= 1000) return "R$" + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
  return "R$" + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

const STATUS = {
  pendente: { txt: "Pendente", cls: "pend" },
  enviando: { txt: "Enviando", cls: "sending" },
  concluido: { txt: "Concluído", cls: "ok" },
  erro: { txt: "Erro", cls: "err" },
  cancelado: { txt: "Cancelado", cls: "cancel" },
};
const statusOf = (job) =>
  (job.immediate && job.status === "concluido") ? { txt: "Enviada", cls: "ok" } : (STATUS[job.status] || { txt: job.status, cls: "" });

// ---------------------------------------------------------------------------
// Navegação entre as abas
// ---------------------------------------------------------------------------
const VIEW_NAMES = { overview: "Início", conversas: "Conversas", clients: "Clientes", agenda: "Agenda de contatos", campaigns: "Campanhas", followup: "Follow-up", responses: "Respostas", chatbot: "Respostas automáticas", vendedores: "Vendedores", visitas: "Visitas em Campo", calendario: "Calendário", ia: "ZapFlow IA" };
// Rótulo da origem real do nome de um contato (usado em Conversas, Respostas e Clientes)
const SOURCE_LABEL = { agenda: "Agenda", manual: "Manual", planilha: "Planilha", chip: "Chip", whatsapp: "WhatsApp", campanha: "Campanha" };
const CRM_STAGES_UI = ["Novo", "Contatado", "Respondeu", "Negociando", "Cliente", "Perdido"];

function activateView(view) {
  $$(".side-tab, .mtab, .msheet-item").forEach((t) => { if (t.dataset.view) t.classList.toggle("active", t.dataset.view === view); });
  $$(".dash-view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== view));
  const pn = $("#topPageName"); if (pn) pn.textContent = VIEW_NAMES[view] || "";
  const dh = $("#deskHeader"); if (dh) dh.classList.toggle("hidden", view === "overview");
  closeSheet();
  loadView(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".side-tab, .mtab, .msheet-item").forEach((tab) => {
  if (tab.dataset.view) tab.addEventListener("click", () => activateView(tab.dataset.view));
});

// Folha "Mais" (mobile)
function openSheet() { $("#msheet").classList.remove("hidden"); $("#msheetBackdrop").classList.remove("hidden"); }
function closeSheet() { $("#msheet")?.classList.add("hidden"); $("#msheetBackdrop")?.classList.add("hidden"); }
$("#mtabMore")?.addEventListener("click", openSheet);
$("#msheetBackdrop")?.addEventListener("click", closeSheet);

// Recolher a sidebar (desktop) — preferência salva
(function initSidebarCollapse() {
  const saved = localStorage.getItem("zapflow_sidebar") === "collapsed";
  if (saved) { $("#dashSidebar")?.classList.add("collapsed"); document.body.classList.add("side-collapsed"); }
  $("#sideCollapse")?.addEventListener("click", () => {
    const c = $("#dashSidebar").classList.toggle("collapsed");
    document.body.classList.toggle("side-collapsed", c);
    localStorage.setItem("zapflow_sidebar", c ? "collapsed" : "open");
  });
})();

// Seletor de tema (claro/escuro/automático)
function syncThemeButtons() {
  const cur = window.ZapTheme ? ZapTheme.get() : "auto";
  $$("[data-theme-set]").forEach((b) => b.classList.toggle("active", b.dataset.themeSet === cur));
}
$$("[data-theme-set]").forEach((b) => b.addEventListener("click", () => {
  if (window.ZapTheme) ZapTheme.set(b.dataset.themeSet);
  syncThemeButtons();
  // redesenha os gráficos com as novas cores do tema
  if ($(".dash-view[data-view='overview']") && !$(".dash-view[data-view='overview']").classList.contains("hidden")) loadOverview();
}));
syncThemeButtons();

// Logout (mostra se o login estiver ativo)
fetch("/api/config").then((r) => r.json()).then((cfg) => {
  if (cfg.authEnabled) { $("#sideLogout")?.classList.remove("hidden"); $("#msheetLogout")?.classList.remove("hidden"); }
}).catch(() => {});
[$("#sideLogout"), $("#msheetLogout")].forEach((b) => b?.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
}));

// Abre uma view específica vinda de ?view= (navegação a partir da tela de campanha)
(function initViewFromQuery() {
  const v = new URLSearchParams(location.search).get("view");
  if (v && VIEW_NAMES[v]) setTimeout(() => activateView(v), 0);
})();

function loadView(view) {
  if (view === "overview") loadOverview();
  else if (view === "clients") loadClients();
  else if (view === "agenda") loadAgenda();
  else if (view === "conversas") loadConversas();
  else if (view === "campaigns") loadCampaigns();
  else if (view === "responses") loadResponses();
  else if (view === "followup") loadFollowup();
  else if (view === "chatbot") loadChatbot();
  else if (view === "vendedores") loadVendedoresView();
  else if (view === "visitas") loadVisitasView();
  else if (view === "calendario") loadCalendarioView();
  else if (view === "ia") loadZappyIA();
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

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Melhor dia da semana por respostas, calculado da série de 30 dias (sem inventar). */
function melhorDiaFromSerie(serie) {
  const dias = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const n = serie.respostas.length;
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() - (n - 1 - i) * 864e5);
    buckets[d.getDay()] += serie.respostas[i] || 0;
  }
  if (!buckets.reduce((a, b) => a + b, 0)) return null;
  let mi = 0; for (let i = 1; i < 7; i++) if (buckets[i] > buckets[mi]) mi = i;
  return dias[mi];
}

function setWa(state, text) {
  const el = $("#waStatus"); if (!el) return;
  el.querySelector(".wa-dot").className = "wa-dot " + state;
  el.querySelector(".wa-text").textContent = text;
}
async function checkWaStatus() {
  if (!$("#waStatus")) return null;
  setWa("checking", "Verificando conexão");
  const creds = {
    instanceId: localStorage.getItem("frota_instanceId") || "",
    instanceToken: localStorage.getItem("frota_instanceToken") || "",
    clientToken: localStorage.getItem("frota_clientToken") || "",
  };
  try {
    const res = await fetch("/api/test-connection", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds),
    });
    const data = await res.json();
    const st = data.status || {};
    const connected = res.ok && (st.connected === true || st.smartphoneConnected === true || st.value === true);
    setWa(connected ? "on" : "off", connected ? "WhatsApp conectado" : "WhatsApp desconectado");
    return connected;
  } catch {
    setWa("off", "WhatsApp desconectado");
    return false;
  }
}

function renderActions(data, jobs, waConnected) {
  const wrap = $("#ovActions"); if (!wrap) return;
  const acts = [];
  const atend = data.kpis.conversas.total;
  const follow = data.donut.semResposta;
  const novos = data.kpis.clientesNovos;
  const pend = jobs.filter((j) => j.status === "pendente");
  const falhas = jobs.filter((j) => j.status === "concluido").reduce((a, j) => a + ((j.result && j.result.failed) || 0), 0);

  if (waConnected === false)
    acts.push({ pri: 1, icon: "wifioff", tone: "warn", title: "WhatsApp desconectado", info: "Reconecte para enviar e receber mensagens.", btn: "Reconectar", href: "/" });
  if (atend > 0)
    acts.push({ pri: 2, icon: "messages", tone: "blue", title: `${atend} conversa(s) no período`, info: "Veja quem falou com você e responda.", btn: "Responder", go: "conversas" });
  if (falhas > 0)
    acts.push({ pri: 3, icon: "x", tone: "warn", title: `${falhas} mensagem(ns) com falha`, info: "Confira as campanhas para reenviar.", btn: "Ver campanhas", go: "campaigns" });
  if (follow > 0)
    acts.push({ pri: 4, icon: "refresh", tone: "blue", title: `${follow} contato(s) para follow-up`, info: "Reengaje quem recebeu e não respondeu.", btn: "Criar follow-up", go: "followup" });
  pend.forEach((j) => acts.push({ pri: 5, icon: "calendarclock", tone: "blue", title: "Campanha agendada", info: `Para ${fmtDate(j.scheduledAt)}.`, btn: "Ver campanha", go: "campaigns" }));
  if (novos > 0)
    acts.push({ pri: 6, icon: "users", tone: "green", title: `${novos} novo(s) contato(s) no período`, info: "Sua base de clientes cresceu.", btn: "Ver clientes", go: "clients" });

  if (!acts.length) {
    wrap.innerHTML = `<div class="all-clear"><span class="all-clear-ico">${ZapIcons.svg("check", 22)}</span><div><b>Tudo em dia por aqui.</b><span>Você não possui ações urgentes neste momento.</span></div></div>`;
    return;
  }
  acts.sort((a, b) => a.pri - b.pri);
  wrap.innerHTML = acts.map((a, i) => `
    <div class="action-item tone-${a.tone}">
      <span class="action-ico">${ZapIcons.svg(a.icon, 20)}</span>
      <div class="action-txt"><b>${escapeHtml(a.title)}</b><span>${escapeHtml(a.info)}</span></div>
      <button class="btn secondary action-btn" data-idx="${i}">${escapeHtml(a.btn)}</button>
    </div>`).join("");
  $$("#ovActions .action-btn").forEach((b) => b.addEventListener("click", () => {
    const a = acts[+b.dataset.idx];
    if (a.href) window.location.href = a.href;
    else if (a.go) activateView(a.go);
  }));
}

/** Indicadores operacionais do dia (Follow-ups, Conversas, Visitas, Oportunidades, Agenda) + Equipe hoje. */
async function loadResumoOwner() {
  try {
    const res = await fetch("/api/visitas/resumo");
    const r = await res.json();
    if (!res.ok) return;
    countUp($("#kpiFollowups"), r.retornos || 0);
    countUp($("#kpiVisitasHoje"), r.visitasHoje || 0);
    countUp($("#kpiAgenda"), r.compromissosHoje || 0);
    $("#kpiConversasHoje").textContent = r.conversasAguardando || 0;
    $("#kpiOportunidades").textContent = fmtMoney(r.oportunidadesValor);

    const equipeBlock = $("#ovEquipeBlock");
    if (equipeBlock && typeof r.vendedoresAtivos === "number") {
      equipeBlock.hidden = false;
      const vend = r.vendedoresAtivos === 1 ? "1 vendedor" : `${r.vendedoresAtivos} vendedores`;
      const vis = r.visitasRealizadasHoje === 1 ? "1 visita" : `${r.visitasRealizadasHoje || 0} visitas`;
      $("#ovEquipeResumo").textContent = `${vend} · ${vis} · ${fmtMoney(r.oportunidadesValor)} em potencial`;
    }
  } catch { /* indicadores do dia são um extra; falha aqui não deve travar o resto do painel */ }
}

async function loadOverview() {
  $("#ovGreeting").textContent = saudacao();
  loadResumoOwner();
  // Estado de carregamento (skeleton): esconde corpo/vazio/erro
  $("#ovError").classList.add("hidden");
  $("#ovEmpty").classList.add("hidden");
  $("#ovBody").classList.add("hidden");
  $("#ovSkeleton").classList.remove("hidden");
  try {
    const [data, sched] = await Promise.all([
      fetch("/api/dashboard?period=" + ovPeriod).then((r) => r.json()),
      fetch("/api/schedules").then((r) => r.json()).catch(() => ({ jobs: [] })),
    ]);
    $("#ovSkeleton").classList.add("hidden");
    const jobs = sched.jobs || [];
    const k = data.kpis;
    const semDados = !k.enviadas && !k.conversas.total && !k.clientes;
    $("#ovEmpty").classList.toggle("hidden", !semDados);
    $("#ovBody").classList.toggle("hidden", semDados);
    if (semDados) { checkWaStatus(); return; }

    // Desempenho (métricas históricas do período selecionado)
    const novosTxt = k.clientesNovos > 0 ? ` (+${k.clientesNovos} no período)` : "";
    $("#ovDesempSub").textContent =
      `${data.donut.responderam} respostas recebidas · ${k.clientes} clientes identificados${novosTxt}`;
    drawLine($("#lineChart"), data.serie30);
    // Taxa de resposta só faz sentido com envios de campanha no período.
    // Sem base válida, evita números contraditórios (ex.: 1 resposta e 0%).
    const temBaseTaxa = k.enviadas > 0;
    $("#donutArea").hidden = !temBaseTaxa;
    $("#donutNote").hidden = temBaseTaxa;
    if (temBaseTaxa) {
      drawDonut($("#donutChart"), data.donut.responderam, data.donut.responderam + data.donut.semResposta);
      $("#donutPct").textContent = k.taxa + "%";
      $("#donutPct").style.color = k.taxa >= 15 ? css("--success") : css("--muted");
      $("#legResp").textContent = data.donut.responderam;
      $("#legNo").textContent = data.donut.semResposta;
    }

    // Campanhas + mini cards + funil
    renderRanking(data.ranking);
    $("#melhorHora").textContent = data.melhorHora === null ? "sem dados" : String(data.melhorHora).padStart(2, "0") + "h";
    $("#melhorDia").textContent = melhorDiaFromSerie(data.serie30) || "sem dados";
    renderFunil(data.funil);

    // Próximas ações (WhatsApp entra assim que o status resolver)
    renderActions(data, jobs, null);
    checkWaStatus().then((ok) => renderActions(data, jobs, ok));
  } catch {
    $("#ovSkeleton").classList.add("hidden");
    $("#ovBody").classList.add("hidden");
    $("#ovEmpty").classList.add("hidden");
    $("#ovError").classList.remove("hidden");
  }
}

// Cliques dos indicadores / estado vazio / repetir (uma vez)
$$("#kpiGrid .kpi").forEach((b) => b.addEventListener("click", () => b.dataset.go && activateView(b.dataset.go)));
$$("#ovEmpty [data-go]").forEach((b) => b.addEventListener("click", () => activateView(b.dataset.go)));
$$("#ovEquipeBlock [data-go]").forEach((b) => b.addEventListener("click", () => activateView(b.dataset.go)));
$("#ovRetry")?.addEventListener("click", loadOverview);

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
  if (!list.length) {
    $("#rankingList").innerHTML = `<div class="mini-empty">${ZapIcons.svg("megaphone", 22)}<p>Nenhuma campanha ainda. Crie a primeira para ver o desempenho aqui.</p></div>`;
    return;
  }
  $("#rankingList").innerHTML = list.map((r) => `
    <div class="rank-item">
      <div class="rank-info">
        <span class="rank-name">${escapeHtml(r.name)}</span>
        <span class="rank-stats">
          <span title="Destinatários">${r.enviadas} enviadas</span> ·
          <span title="Respostas" style="color:var(--success)">${r.respostas} respostas</span> ·
          <b style="color:var(--primary)">${r.taxa}%</b>
        </span>
      </div>
      <button class="btn ghost rank-ver" data-id="${r.id}" aria-label="Ver campanha">Ver</button>
    </div>`).join("");
  $$("#rankingList .rank-ver").forEach((b) => b.addEventListener("click", () => { activateView("campaigns"); setTimeout(() => openCampaign(b.dataset.id), 150); }));
}

// --- Gráficos em canvas (sem lib) ---
function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || c.width, h = c.clientHeight || c.height;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  return { ctx, w, h };
}
function drawDonut(canvas, value, total) {
  const { ctx, w, h } = fitCanvas(canvas);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8, lw = r * 0.30;
  const frac = total ? value / total : 0;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = lw; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = css("--border"); ctx.stroke();
  if (frac > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = css("--success"); ctx.stroke();
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
  line(env, css("--primary"), true);
  line(env, css("--primary"), false);
  line(resp, css("--success"), false);
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
      wrap.innerHTML = "<p class='hint'>Nenhum cliente nesse filtro. A base se preenche conforme você envia campanhas.</p>";
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

// ---------------------------------------------------------------------------
// Identidade do contato: nome com fallback + origem real (reutilizado nas telas)
// ---------------------------------------------------------------------------
function displayNameOf(obj) {
  return (obj.name || obj.displayName || "").trim() || "Contato não identificado";
}
function sourceBadge(src) {
  const label = SOURCE_LABEL[src];
  return label ? `<span class="badge src-badge">${label}</span>` : "";
}

// ---------------------------------------------------------------------------
// Salvar contato na agenda (modal reutilizável em Conversas, Respostas, Clientes)
// ---------------------------------------------------------------------------
let saveAgCtx = null; // { phone, onDone }
function openSaveAgenda(phone, suggestedName, onDone) {
  saveAgCtx = { phone, onDone };
  $("#saveAgName").value = suggestedName && suggestedName !== "Contato não identificado" ? suggestedName : "";
  $("#saveAgPhone").textContent = phone;
  $("#saveAgStatus").textContent = "";
  openModal("saveAgendaModal");
  setTimeout(() => $("#saveAgName").focus(), 50);
}
$("#btnSaveAgConfirm").addEventListener("click", async () => {
  if (!saveAgCtx) return;
  const status = $("#saveAgStatus");
  status.textContent = "Salvando..."; status.className = "status";
  try {
    const res = await fetch("/api/agenda", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: saveAgCtx.phone, name: $("#saveAgName").value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
    closeModal("saveAgendaModal");
    const cb = saveAgCtx.onDone; saveAgCtx = null;
    if (cb) cb();
  } catch (err) {
    status.textContent = err.message; status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Mover para etapa do funil pelo telefone (Conversas e cadastro do cliente)
// ---------------------------------------------------------------------------
function renderStageMover(container, phone, currentStage, onDone) {
  if (!container) return;
  container.innerHTML = '<span class="stage-mover-label">Mover para:</span>' +
    CRM_STAGES_UI.map((s) =>
      `<button type="button" class="stage-move-btn ${STAGE_CLS[s] || ""} ${s === currentStage ? "active" : ""}" data-stage="${s}">${s}</button>`
    ).join("");
  container.querySelectorAll(".stage-move-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      const stage = b.dataset.stage;
      if (stage === currentStage) return;
      container.querySelectorAll(".stage-move-btn").forEach((x) => (x.disabled = true));
      try {
        const res = await fetch("/api/clients/stage", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, stage }),
        });
        if (!res.ok) throw new Error();
        currentStage = stage;
        renderStageMover(container, phone, stage, onDone);
        if (onDone) onDone(stage);
      } catch {
        container.querySelectorAll(".stage-move-btn").forEach((x) => (x.disabled = false));
      }
    });
  });
}

function clientCard(c) {
  const div = document.createElement("div");
  div.className = "dash-card " + (STAGE_CLS[c.stage] || "");
  const tags = (c.tags || []).map((t) => `<span class="badge manual">${escapeHtml(t)}</span>`).join(" ");
  const last = c.lastReplyAt ? `respondeu ${fmtDate(c.lastReplyAt)}`
    : c.lastSentAt ? `enviado ${fmtDate(c.lastSentAt)}` : "novo";
  const nome = displayNameOf(c);
  const agenda = c.inAgenda ? ' <span class="badge" title="Na sua agenda">agenda</span>' : "";
  div.innerHTML = `
    <div class="dash-card-head">
      <span class="resp-phone">${escapeHtml(nome)}${agenda}</span>
      <span class="stage-pill ${STAGE_CLS[c.stage] || ""}">${escapeHtml(c.stage)}</span>
    </div>
    <div class="dash-card-body">
      <span class="resp-sub">${escapeHtml(c.phone)} · ${last}</span>
      <span>${sourceBadge(c.nameSource)}${tags}</span>
    </div>`;
  div.addEventListener("click", () => openClient(c));
  return div;
}

function openClient(c) {
  crmCurrent = c;
  $("#clientTitle").textContent = displayNameOf(c) === "Contato não identificado" ? "Contato não identificado" : (c.displayName || c.name);
  $("#clientPhone").textContent = c.phone + (c.inAgenda ? "  · na agenda" : "") + (SOURCE_LABEL[c.nameSource] ? `  · origem: ${SOURCE_LABEL[c.nameSource]}` : "");
  $("#clientName").value = c.name || "";
  $("#clientStage").innerHTML = crmMeta.stages.map((s) => `<option ${s === c.stage ? "selected" : ""}>${s}</option>`).join("");
  $("#clientTags").value = (c.tags || []).join(", ");
  $("#clientNotes").value = c.notes || "";
  $("#clientMeta").textContent =
    (c.lastSentAt ? `Último envio: ${fmtDate(c.lastSentAt)}. ` : "") +
    (c.lastReplyAt ? `Última resposta: ${fmtDate(c.lastReplyAt)}.` : "");
  $("#clientStatus").textContent = "";
  // Botão "Salvar na agenda" (só quando ainda não está na agenda)
  const agBtn = $("#btnClientToAgenda");
  agBtn.classList.toggle("hidden", !!c.inAgenda);
  agBtn.onclick = () => openSaveAgenda(c.phone, c.displayName || c.name, () => { closeModal("clientModal"); loadClients(); });
  // Ação rápida "Mover para" (atualiza etapa, funil e card imediatamente)
  renderStageMover($("#clientStageMover"), c.phone, c.stage, (stage) => {
    c.stage = stage;
    $("#clientStage").innerHTML = crmMeta.stages.map((s) => `<option ${s === stage ? "selected" : ""}>${s}</option>`).join("");
    loadCrmMeta();
    loadClients();
  });
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
    $("#clientStatus").textContent = "Erro ao salvar";
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
  alert(`${contacts.length} cliente(s) preparados.\nVocê será levado à Nova campanha para montar a mensagem.`);
  window.location.href = "/";
});

$("#btnExportClients").addEventListener("click", async () => {
  const status = $("#exportClientsStatus");
  const btn = $("#btnExportClients");
  status.textContent = "Exportando...";
  btn.disabled = true;
  try {
    const res = await fetch("/api/clients/exportar-planilha", { method: "POST" });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao exportar."; btn.disabled = false; return; }
    status.textContent = "Planilha criada!";
    window.open(data.url, "_blank");
  } catch {
    status.textContent = "Erro de conexão.";
  }
  btn.disabled = false;
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
      const nome = displayNameOf(t);
      const badge = t.origem === "campaign"
        ? `<span class="conv-badge camp">${escapeHtml(t.campaignName || "Campanha")}</span>`
        : `<span class="conv-badge daily">Dia a dia</span>`;
      const tags = (t.tags || []).slice(0, 2).map((x) => `<span class="badge manual">${escapeHtml(x)}</span>`).join(" ");
      const agenda = t.inAgenda ? '<span class="badge" title="Na sua agenda">agenda</span>' : "";
      const pre = (t.dir === "out" ? "Você: " : "") + (t.lastText || "");
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">${escapeHtml(nome)}</span>
          <span class="dash-when">${fmtDate(t.lastTs)}</span>
        </div>
        <div class="dash-card-body">
          <span class="resp-sub">${escapeHtml(t.phone)}${t.stage ? ` · ${escapeHtml(t.stage)}` : ""}</span>
          <span class="conv-last">${escapeHtml(pre.slice(0, 60))}${pre.length > 60 ? "…" : ""}</span>
          <span>${badge}${sourceBadge(t.nameSource)}${agenda}${tags}</span>
        </div>`;
      div.addEventListener("click", () => openChat(t.key, nome, t));
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

let chatPhone = null;
async function openChat(key, nome, thread) {
  chatKey = key;
  chatPhone = thread?.phone || null;
  $("#chatTitle").textContent = nome || "Conversa";
  $("#chatSub").textContent = "";
  $("#chatStatus").textContent = "";
  $("#btnChatToAgenda").classList.add("hidden");
  $("#chatStageMover").innerHTML = "";
  $("#chatMessages").innerHTML = "<p class='hint'>Carregando...</p>";
  openModal("chatModal");
  try {
    const data = await (await fetch("/api/conversas/" + key)).json();
    chatPhone = data.phone || chatPhone;
    // Identidade do contato (telefone menor, origem, etapa)
    const src = SOURCE_LABEL[data.nameSource];
    $("#chatSub").textContent = [data.phone, src ? `origem: ${src}` : "", data.stage].filter(Boolean).join(" · ");
    // Botão "Salvar na agenda"
    const agBtn = $("#btnChatToAgenda");
    agBtn.classList.toggle("hidden", !!data.inAgenda);
    agBtn.onclick = () => openSaveAgenda(data.phone, data.name, () => { loadConversas(); openChat(key, data.name || nome, { phone: data.phone }); });
    // Ação rápida "Mover para" (atualiza etapa e funil imediatamente)
    renderStageMover($("#chatStageMover"), data.phone, data.stage, () => { loadConversas(); });
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
    status.textContent = err.message;
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
const ORIGEM_LABEL = { planilha: "Planilha", manual: "Manual", chip: "Chip" };

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
          <span class="resp-phone">${escapeHtml(c.name || "(sem nome)")}</span>
          <div class="row" style="gap:6px;margin:0">
            <button class="btn ghost ag-add ${inCart ? "in-cart" : ""}" data-id="${c.id}">${inCart ? "Inserido" : "Inserir"}</button>
            <button class="btn-cancel ag-del" data-id="${c.id}">Excluir</button>
          </div>
        </div>
        <div class="dash-card-body">
          <span>${escapeHtml(c.phone)} · ${ORIGEM_LABEL[c.origem] || c.origem}</span>
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
    btn.textContent = "Inserir";
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
  if (!res.ok) { status.textContent = (data.error || "Erro"); status.className = "status err"; return; }
  status.textContent = "Salvo!"; status.className = "status ok";
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
    status.textContent = `${data.imported} contato(s) importado(s)!`; status.className = "status ok";
    loadAgenda();
  } catch (err) {
    status.textContent = err.message; status.className = "status err";
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
    status.textContent = `${data.imported} contato(s) sincronizado(s)!`; status.className = "status ok";
    loadAgenda();
  } catch (err) {
    status.textContent = err.message; status.className = "status err";
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
  const reply = job.result ? ` · ${job.repliedCount} responderam` : "";
  div.innerHTML = `
    <div class="dash-card-head">
      <span class="sched-status ${st.cls}">${st.txt}</span>
      <span class="dash-when">${fmtDate(job.scheduledAt)}</span>
    </div>
    <div class="dash-card-body">
      <span>${job.contactsCount} contato(s)${job.hasImage ? ` · ${job.imageCount} img` : ""}${reply}</span>
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
    if (!list.length) { wrap.innerHTML = "<p class='hint'>Nenhum modelo salvo ainda. Crie um acima ou use “Salvar como modelo” na Nova campanha.</p>"; return; }
    wrap.innerHTML = "";
    list.forEach((t) => {
      const urls = draftUrls(t);
      const preview = (t.message || "").slice(0, 80) || (urls.length ? "[imagem]" : "");
      const div = document.createElement("div");
      div.className = "dash-card";
      div.style.cursor = "default";
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">${escapeHtml(t.name || "(sem nome)")}</span>
          <div class="row" style="gap:6px;margin:0">
            <button class="btn ghost draft-use">Usar na campanha</button>
            <button class="btn-cancel draft-del">Excluir</button>
          </div>
        </div>
        <div class="dash-card-body">
          ${preview ? `<span class="sched-msg">"${escapeHtml(preview)}"</span>` : ""}
          ${urls.length ? `<span>${urls.length} imagem(ns)</span>` : ""}
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
    status.textContent = "Modelo salvo!"; status.className = "status ok";
    clearDraftForm();
    $("#draftForm").classList.add("hidden");
    loadDrafts();
  } catch (err) {
    status.textContent = err.message; status.className = "status err";
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
      const icon = l.ok ? '<span class="d-ok">OK</span>' : '<span class="d-err">falhou</span>';
      const rep = l.replied ? ' <span class="d-replied">respondeu</span>' : "";
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
  alert(`${naoResponderam.length} contato(s) que não responderam foram preparados.\nVocê será levado à Nova campanha para montar o follow-up.`);
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
      const nome = displayNameOf(r);
      const tags = (r.tags || []).slice(0, 2).map((x) => `<span class="badge manual">${escapeHtml(x)}</span>`).join(" ");
      const agenda = r.inAgenda ? '<span class="badge" title="Na sua agenda">agenda</span>' : "";
      const saveBtn = r.inAgenda ? "" : `<button class="btn ghost sm resp-save" type="button">Salvar na agenda</button>`;
      div.innerHTML = `
        <div class="dash-card-head">
          <span class="resp-phone">${escapeHtml(nome)}</span>
          <span class="dash-when">${fmtDate(r.ts)}</span>
        </div>
        <div class="dash-card-body">
          <span class="resp-sub">${escapeHtml(r.phone)}${r.stage ? ` · ${escapeHtml(r.stage)}` : ""}</span>
          ${r.content ? `<span class="sched-msg">"${escapeHtml(r.content)}"</span>` : ""}
          <span>${sourceBadge(r.nameSource)}${agenda}${tags}${saveBtn}</span>
        </div>`;
      const sb = div.querySelector(".resp-save");
      if (sb) sb.addEventListener("click", () => openSaveAgenda(r.phone, r.name, loadResponses));
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
          <span class="dash-when">${fmtDate(job.scheduledAt)}</span>
          <span class="followup-badge">${naoResp} sem resposta</span>
        </div>
        <div class="dash-card-body">
          <span>${job.result.success} enviadas · ${job.repliedCount} responderam</span>
          <span class="sched-msg">"${escapeHtml(preview)}"</span>
        </div>
        <button class="btn primary fu-btn" ${naoResp ? "" : "disabled"}>Criar follow-up (${naoResp})</button>`;
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
    status.textContent = "Respostas automáticas salvas!";
    status.className = "status ok";
  } catch {
    status.textContent = "Erro ao salvar";
    status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Visitas em Campo (V2) — gestão de vendedores + visitas da equipe (dono)
// ---------------------------------------------------------------------------
let visitasOwnerTab = "hoje";

async function loadVendedoresView() {
  await loadVendedores();
}

async function loadVisitasView() {
  await loadVisitasOwner();
}

async function loadVendedores() {
  const wrap = $("#vendedoresList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/visitas/vendedores");
    const data = await res.json();
    if (!res.ok) { wrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Erro ao carregar.")}</p>`; return; }
    const vendedores = data.vendedores || [];
    const ativos = vendedores.filter((v) => v.active).length;
    $("#btnAddVendedor").disabled = ativos >= data.maxVendedores;
    if (!vendedores.length) { wrap.innerHTML = "<p class='hint'>Nenhum vendedor cadastrado ainda.</p>"; return; }
    wrap.innerHTML = "";
    vendedores.forEach((v) => {
      const div = document.createElement("div");
      div.className = "dash-card" + (v.active ? "" : " cancel");
      div.innerHTML = `
        <div class="dash-card-head">
          <b>${escapeHtml(v.name || v.username)}</b>
          <span class="badge ${v.active ? "ok" : "err"}">${v.active ? "Ativo" : "Inativo"}</span>
        </div>
        <div class="dash-card-body">
          <div>Usuário: ${escapeHtml(v.username)}</div>
          ${v.phone ? `<div>Telefone: ${escapeHtml(v.phone)}</div>` : ""}
        </div>`;
      if (v.active) {
        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "btn ghost sm";
        btnDel.style.marginTop = "8px";
        btnDel.textContent = "Desativar";
        btnDel.addEventListener("click", () => desativarVendedor(v.id));
        div.appendChild(btnDel);
      }
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro de conexão.</p>";
  }
}

async function desativarVendedor(id) {
  if (!confirm("Desativar este vendedor? O histórico de visitas dele é mantido.")) return;
  await fetch(`/api/visitas/vendedores/${id}`, { method: "DELETE" });
  loadVendedores();
}

$("#btnAddVendedor").addEventListener("click", async () => {
  const name = $("#vdNome").value.trim();
  const phone = $("#vdTelefone").value.trim();
  const status = $("#vendedorStatus");
  status.style.color = "";
  if (!name || !phone) { status.textContent = "Informe nome e telefone."; return; }
  try {
    const res = await fetch("/api/visitas/vendedores", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao cadastrar."; return; }
    status.style.color = "var(--success)";
    status.innerHTML = `<b>Vendedor criado!</b> Usuário: <code>${escapeHtml(data.vendedor.username)}</code> — Senha temporária: <code>${escapeHtml(data.tempPassword)}</code><br>Anote agora — a senha não fica visível de novo depois.`;
    $("#vdNome").value = "";
    $("#vdTelefone").value = "";
    loadVendedores();
  } catch {
    status.textContent = "Erro de conexão.";
  }
});

$("#btnExportVisitas").addEventListener("click", async () => {
  const status = $("#exportVisitasStatus");
  const btn = $("#btnExportVisitas");
  status.textContent = "Exportando...";
  btn.disabled = true;
  try {
    const res = await fetch("/api/visitas/exportar-planilha", { method: "POST" });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao exportar."; btn.disabled = false; return; }
    status.textContent = "Planilha criada!";
    window.open(data.url, "_blank");
  } catch {
    status.textContent = "Erro de conexão.";
  }
  btn.disabled = false;
});

$$(".tab", $("#visitasTabsOwner")).forEach((btn) => {
  btn.addEventListener("click", () => {
    visitasOwnerTab = btn.dataset.tab;
    $$(".tab", $("#visitasTabsOwner")).forEach((b) => b.classList.toggle("active", b === btn));
    loadVisitasOwner();
  });
});

async function loadVisitasOwner() {
  const wrap = $("#visitasOwnerList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch(`/api/visitas?tab=${visitasOwnerTab}`);
    const data = await res.json();
    if (!res.ok) { wrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Erro ao carregar.")}</p>`; return; }
    const list = data.visitas || [];
    if (!list.length) {
      const vazio = { hoje: "Nenhuma visita hoje ainda.", followup: "Nenhum follow-up pendente." };
      wrap.innerHTML = `<p class="hint">${vazio[visitasOwnerTab] || "Nenhuma visita encontrada."}</p>`;
      return;
    }
    wrap.innerHTML = "";
    list.forEach((v) => wrap.appendChild(renderVisitaCardOwner(v)));
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro de conexão.</p>";
  }
}

function renderVisitaCardOwner(v) {
  const div = document.createElement("div");
  div.className = "dash-card";
  const dataFmt = new Date(v.dataHora).toLocaleString("pt-BR");
  const emAndamento = !v.finishedAt;
  const badge = emAndamento ? `<span class="badge manual">Em andamento</span>` : `<span class="badge">${escapeHtml(v.resultado || "")}</span>`;
  const duracao = v.finishedAt ? `<div>⏱️ Duração: ${Math.round((v.finishedAt - v.dataHora) / 60000)} min</div>` : "";
  const mapsLink = (v.latitude != null && v.longitude != null)
    ? `<a href="https://www.google.com/maps?q=${v.latitude},${v.longitude}" target="_blank" rel="noopener">📍 Abrir no Google Maps</a>`
    : "";
  const proxima = v.proximaVisitaData
    ? `<div>🔁 Retorno: ${new Date(v.proximaVisitaData + "T00:00:00").toLocaleDateString("pt-BR")}</div>`
    : "";
  const fotos = (v.fotos || []).length ? `<div>📷 ${v.fotos.length} foto(s)</div>` : "";
  div.innerHTML = `
    <div class="dash-card-head">
      <b>${escapeHtml(v.clienteNome)}</b>
      ${badge}
    </div>
    <div class="dash-card-body">
      <div>Vendedor: ${escapeHtml(v.vendedorNome || "—")}</div>
      ${v.objetivo ? `<div>${escapeHtml(v.objetivo)}</div>` : ""}
      <div>${v.motivo ? escapeHtml(v.motivo) + " • " : ""}${dataFmt}</div>
      ${duracao}
      ${v.contatoNome ? `<div>Contato: ${escapeHtml(v.contatoNome)}</div>` : ""}
      ${v.observacao ? `<div>${escapeHtml(v.observacao)}</div>` : ""}
      ${v.proximaAcao ? `<div>Próxima ação: ${escapeHtml(v.proximaAcao)}</div>` : ""}
      ${fotos}
      ${proxima}
      ${mapsLink ? `<div>${mapsLink}</div>` : ""}
    </div>
    ${followupBlockOwner(v)}`;
  attachFollowupHandlersOwner(div, v);
  return div;
}

/** Bloco de "enviar follow-up" — só aparece se a visita tiver telefone de contato. */
function followupBlockOwner(v) {
  if (!v.contatoTelefone) return "";
  return `
    <div class="followup-block" style="margin-top:10px;">
      <button class="btn secondary sm btn-followup" type="button">Enviar follow-up</button>
      <div class="manual-row followup-row hidden" style="margin-top:8px;">
        <input type="text" class="followup-input" placeholder="Mensagem de follow-up..." />
        <button class="btn primary sm btn-followup-send" type="button">Enviar</button>
      </div>
      <span class="status followup-status"></span>
    </div>`;
}
function attachFollowupHandlersOwner(div, v) {
  const toggleBtn = div.querySelector(".btn-followup");
  if (!toggleBtn) return;
  const row = div.querySelector(".followup-row");
  const input = div.querySelector(".followup-input");
  const sendBtn = div.querySelector(".btn-followup-send");
  const status = div.querySelector(".followup-status");
  toggleBtn.addEventListener("click", () => row.classList.toggle("hidden"));
  sendBtn.addEventListener("click", async () => {
    const message = input.value.trim();
    if (!message) {
      status.textContent = "Escreva uma mensagem.";
      status.className = "status err followup-status";
      return;
    }
    sendBtn.disabled = true;
    try {
      const res = await fetch(`/api/visitas/${v.id}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        status.textContent = data.error || "Erro ao enviar.";
        status.className = "status err followup-status";
        sendBtn.disabled = false;
        return;
      }
      status.textContent = "Follow-up enviado!";
      status.className = "status ok followup-status";
      input.value = "";
      setTimeout(() => { row.classList.add("hidden"); status.textContent = ""; }, 1500);
    } catch {
      status.textContent = "Erro de conexão.";
      status.className = "status err followup-status";
    }
    sendBtn.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// Calendário (Google conectado — V3)
// ---------------------------------------------------------------------------
async function loadCalendarioView() {
  try {
    const res = await fetch("/api/google/status");
    const data = await res.json();
    if (data.connected) {
      $("#googleDisconnected").classList.add("hidden");
      $("#googleConnected").classList.remove("hidden");
      $("#googleEmailLabel").textContent = data.email ? `Conectado como ${data.email}` : "Conectado";
      loadEventos();
    } else {
      $("#googleDisconnected").classList.remove("hidden");
      $("#googleConnected").classList.add("hidden");
      $("#googleConfigHint").textContent = data.configured ? "" : "Integração ainda não configurada pelo suporte.";
    }
  } catch {
    $("#googleConfigHint").textContent = "Erro ao verificar a conexão.";
  }
}

async function loadEventos() {
  const wrap = $("#eventosList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/calendario/eventos");
    const data = await res.json();
    if (!res.ok) { wrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Erro ao carregar.")}</p>`; return; }
    const eventos = data.eventos || [];
    if (!eventos.length) { wrap.innerHTML = "<p class='hint'>Nenhum compromisso agendado.</p>"; return; }
    wrap.innerHTML = "";
    eventos.forEach((e) => {
      const div = document.createElement("div");
      div.className = "dash-card";
      const inicio = new Date(e.inicio).toLocaleString("pt-BR");
      div.innerHTML = `
        <div class="dash-card-head"><b>${escapeHtml(e.titulo)}</b></div>
        <div class="dash-card-body">
          <div>${inicio}</div>
          <div><a href="${e.link}" target="_blank" rel="noopener">Abrir na Google Agenda</a></div>
        </div>`;
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Erro de conexão.</p>";
  }
}

$("#btnDisconnectGoogle").addEventListener("click", async () => {
  if (!confirm("Desconectar sua conta Google?")) return;
  await fetch("/api/google/disconnect", { method: "POST" });
  loadCalendarioView();
});

$("#btnCriarEvento").addEventListener("click", async () => {
  const status = $("#eventoStatus");
  const titulo = $("#evTitulo").value.trim();
  const inicio = $("#evInicio").value;
  const fim = $("#evFim").value;
  const descricao = $("#evDescricao").value.trim();
  if (!titulo || !inicio || !fim) { status.textContent = "Preencha título, início e fim."; return; }
  try {
    const res = await fetch("/api/calendario/eventos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo, inicio: new Date(inicio).toISOString(), fim: new Date(fim).toISOString(), descricao }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao criar."; return; }
    status.textContent = "Compromisso criado!";
    $("#evTitulo").value = ""; $("#evInicio").value = ""; $("#evFim").value = ""; $("#evDescricao").value = "";
    loadEventos();
  } catch {
    status.textContent = "Erro de conexão.";
  }
});

// Limpa o ?google=ok|erro da URL depois do redirect do OAuth (o estado real
// aparece quando a aba Calendário carrega, via /api/google/status).
(function limparRedirectGoogle() {
  const params = new URLSearchParams(location.search);
  if (params.has("google")) {
    const url = new URL(location.href);
    url.searchParams.delete("google");
    history.replaceState({}, "", url);
  }
})();

// ---------------------------------------------------------------------------
// ZapFlow IA (V4)
// ---------------------------------------------------------------------------
let iaHistorico = [];
let iaCarregado = false;

async function loadZappyIA() {
  if (iaCarregado) return; // perfil + saudação só precisam carregar 1x por sessão de navegação
  iaCarregado = true;
  try {
    const res = await fetch("/api/ia/configuracao");
    const data = await res.json();
    if (!res.ok) return;
    $("#iaConfigHint").textContent = data.iaConfigurada ? "" : "Integração com IA ainda não foi configurada pelo suporte.";
    const p = data.perfil || {};
    $("#iaSegmento").value = p.segmento || "";
    $("#iaDescricao").value = p.descricao || "";
    $("#iaProdutos").value = p.produtosServicos || "";
    $("#iaPublico").value = p.publicoAlvo || "";
    $("#iaRegiao").value = p.regiao || "";
    $("#iaDiferenciais").value = p.diferenciais || "";
    $("#iaTom").value = p.tomComunicacao || "";
    $("#iaCondicoes").value = p.condicoesComerciais || "";
    if (data.iaConfigurada) iaAddBubble("assistant", "Oi! Sou o Zappy. Posso consultar clientes, visitas e conversas, criar compromissos na sua agenda e montar rascunhos de campanha. O que você precisa?");
  } catch {
    $("#iaConfigHint").textContent = "Erro ao carregar.";
  }
}

$("#btnSalvarPerfilIa").addEventListener("click", async () => {
  const status = $("#perfilIaStatus");
  try {
    const res = await fetch("/api/ia/configuracao", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segmento: $("#iaSegmento").value.trim(), descricao: $("#iaDescricao").value.trim(),
        produtosServicos: $("#iaProdutos").value.trim(), publicoAlvo: $("#iaPublico").value.trim(),
        regiao: $("#iaRegiao").value.trim(), diferenciais: $("#iaDiferenciais").value.trim(),
        tomComunicacao: $("#iaTom").value.trim(), condicoesComerciais: $("#iaCondicoes").value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao salvar."; status.className = "status err"; return; }
    status.textContent = "Perfil salvo!";
    status.className = "status ok";
  } catch {
    status.textContent = "Erro de conexão.";
    status.className = "status err";
  }
});

function iaAddBubble(role, texto) {
  const box = $("#iaMessages");
  const div = document.createElement("div");
  div.className = `bubble ${role === "user" ? "out" : "in"}`;
  div.innerHTML = `<div class="bubble-text">${escapeHtml(texto)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function iaEnviarMensagem() {
  const input = $("#iaInput");
  const mensagem = input.value.trim();
  if (!mensagem) return;
  iaAddBubble("user", mensagem);
  input.value = "";
  $("#iaRascunho").classList.add("hidden");
  const pensando = document.createElement("div");
  pensando.className = "bubble in";
  pensando.id = "iaPensando";
  pensando.innerHTML = `<div class="bubble-text">Pensando...</div>`;
  $("#iaMessages").appendChild(pensando);
  $("#iaMessages").scrollTop = $("#iaMessages").scrollHeight;
  try {
    const res = await fetch("/api/ia/perguntar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagem, historico: iaHistorico }),
    });
    const data = await res.json();
    document.getElementById("iaPensando")?.remove();
    if (!res.ok) { iaAddBubble("assistant", data.error || "Não consegui responder agora."); return; }
    iaHistorico.push({ role: "user", content: mensagem }, { role: "assistant", content: data.resposta });
    iaAddBubble("assistant", data.resposta);
    if (data.rascunhoCampanha) {
      const r = data.rascunhoCampanha;
      const box = $("#iaRascunho");
      box.classList.remove("hidden");
      box.innerHTML = `
        <p><b>Rascunho de campanha</b> — ${r.telefones.length} contato(s)</p>
        <p class="campaign-msg">${escapeHtml(r.mensagem)}</p>
        <button class="btn primary sm" id="btnUsarRascunhoIa" type="button">Editar e enviar</button>`;
      $("#btnUsarRascunhoIa").addEventListener("click", () => {
        const contacts = r.telefones.map((phone) => ({ phone, name: "" }));
        sessionStorage.setItem("zapflow_loadlist", JSON.stringify({ label: "sugestão do ZapFlow IA", contacts }));
        sessionStorage.setItem("zapflow_loadtemplate", JSON.stringify({ message: r.mensagem }));
        window.location.href = "/";
      });
    }
  } catch {
    document.getElementById("iaPensando")?.remove();
    iaAddBubble("assistant", "Erro de conexão.");
  }
}
$("#iaSend").addEventListener("click", iaEnviarMensagem);
$("#iaInput").addEventListener("keydown", (e) => { if (e.key === "Enter") iaEnviarMensagem(); });

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------
function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }
$$(".modal-close").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); }));

// Início
loadOverview();
