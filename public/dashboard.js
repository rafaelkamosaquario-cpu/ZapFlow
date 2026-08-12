const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

// Sessão expirada: qualquer chamada à API que volte 401 manda pro login com um aviso,
// em vez de deixar a tela travada mostrando "Erro de conexão." sem explicar o motivo.
(function interceptarSessaoExpirada() {
  const _fetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await _fetch(...args);
    const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
    if (res.status === 401 && !url.includes("/api/login")) {
      sessionStorage.setItem("zapflow_session_expired", "1");
      sessionStorage.setItem("zapflow_return_to", location.pathname + location.search);
      location.href = "/login";
    }
    return res;
  };
})();

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
/** "Hoje · 14:30" / "Ontem · 16:20" / "Amanhã · 09:00" / "12/08/2026 · 14:30" (data completa fora da janela de 1 dia). */
function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(d) - startOf(new Date())) / 86400000);
  if (diffDays === 0) return `Hoje · ${time}`;
  if (diffDays === -1) return `Ontem · ${time}`;
  if (diffDays === 1) return `Amanhã · ${time}`;
  return `${d.toLocaleDateString("pt-BR")} · ${time}`;
}
/** Telefone brasileiro pra exibição: (41) 99999-9999. Mantém o valor original se não reconhecer o formato. */
function fmtPhone(phone) {
  const d = String(phone || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone || "";
}
/** Desabilita o botão e troca o texto durante uma ação assíncrona; restaura no final (evita clique duplo). */
async function withLoading(btn, loadingText, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = loadingText;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
/** Forma compacta pra KPIs/cards: "R$ 18,5 mil". */
const fmtMoney = (v) => {
  v = Number(v) || 0;
  if (v >= 1000) return "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
  return "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};
/** Forma completa pra telas de detalhe: "R$ 18.500,00". */
const fmtMoneyFull = (v) => "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
const VIEW_NAMES = { overview: "Início", conversas: "Conversas", clients: "Clientes", agenda: "Agenda de contatos", campaigns: "Campanhas", followup: "Follow-up", responses: "Respostas", chatbot: "Respostas automáticas", vendedores: "Vendedores", visitas: "Visitas em Campo", calendario: "Calendário", ia: "ZapFlow IA", configuracoes: "Configurações" };
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

// Faixa global de "WhatsApp desconectado" -- roda em toda tela, não só no Início.
checkWaStatus();
setInterval(checkWaStatus, 60000);

function loadView(view) {
  if (view === "overview") { loadOverview(); loadOnboarding(); }
  else if (view === "configuracoes") loadConfiguracoesView();
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
// Configuração guiada (Item 7) -- barra no Início + checklist permanente em Configurações
// ---------------------------------------------------------------------------
function onbStepHtml(s) {
  const acao = !s.done && (s.view || s.href) ? `<button type="button" class="btn ghost sm onb-go" data-view="${s.view || ""}" data-href="${s.href || ""}">Resolver</button>` : "";
  return `<div class="onb-step ${s.done ? "done" : ""}">
    <span class="onb-check">${s.done ? "✓" : ""}</span>
    <div class="onb-step-txt"><b>${escapeHtml(s.titulo)}</b><span>${escapeHtml(s.descricao)}</span></div>
    ${acao}
  </div>`;
}
function wireOnbSteps(container) {
  container.querySelectorAll(".onb-go").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.href) window.location.href = b.dataset.href;
    else if (b.dataset.view) activateView(b.dataset.view);
  }));
}
async function loadOnboarding() {
  const bar = $("#onbBar");
  if (!bar) return;
  try {
    const data = await (await fetch("/api/onboarding")).json();
    if (data.allDone) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    $("#onbPercent").textContent = data.percent + "%";
    $("#onbProgressFill").style.width = data.percent + "%";
    $("#onbSteps").innerHTML = data.steps.map(onbStepHtml).join("");
    wireOnbSteps($("#onbSteps"));
  } catch {
    bar.classList.add("hidden");
  }
}
async function loadConfiguracoesView() {
  const wrap = $("#confOnbSteps");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const data = await (await fetch("/api/onboarding")).json();
    $("#confOnbSummary").textContent = data.allDone
      ? "Configuração concluída! Todos os passos foram feitos."
      : `${data.completedCount} de ${data.total} passos concluídos.`;
    $("#confOnbProgressFill").style.width = data.percent + "%";
    wrap.innerHTML = data.steps.map(onbStepHtml).join("");
    wireOnbSteps(wrap);
  } catch {
    wrap.innerHTML = "<p class='hint'>Não foi possível carregar a configuração.</p>";
  }
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
  const el = $("#waStatus");
  if (el) { el.querySelector(".wa-dot").className = "wa-dot " + state; el.querySelector(".wa-text").textContent = text; }
  const banner = $("#waBanner");
  if (banner) banner.classList.toggle("hidden", state !== "off");
}
async function checkWaStatus() {
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
$("#btnSaveAgConfirm").addEventListener("click", async (e) => {
  if (!saveAgCtx) return;
  const status = $("#saveAgStatus");
  status.textContent = ""; status.className = "status";
  try {
    await withLoading(e.currentTarget, "Salvando...", async () => {
      const res = await fetch("/api/agenda", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: saveAgCtx.phone, name: $("#saveAgName").value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Não foi possível salvar este contato na agenda.");
    });
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
      <span class="resp-sub">${escapeHtml(fmtPhone(c.phone))} · ${last}</span>
      <span>${sourceBadge(c.nameSource)}${tags}</span>
    </div>`;
  div.addEventListener("click", () => openClient(c));
  return div;
}

let c360Timeline = [];
let c360Filtro = "";

function openClient(c) {
  crmCurrent = c;
  $("#clientTitle").textContent = displayNameOf(c) === "Contato não identificado" ? "Contato não identificado" : (c.displayName || c.name);
  $("#clientPhone").textContent = fmtPhone(c.phone) + (c.inAgenda ? "  · na agenda" : "") + (SOURCE_LABEL[c.nameSource] ? `  · origem: ${SOURCE_LABEL[c.nameSource]}` : "");
  $("#clientName").value = c.name || "";
  $("#clientTags").value = (c.tags || []).join(", ");
  $("#clientMeta").textContent =
    (c.lastSentAt ? `Último envio: ${fmtDate(c.lastSentAt)}. ` : "") +
    (c.lastReplyAt ? `Última resposta: ${fmtDate(c.lastReplyAt)}.` : "");
  $("#clientStatus").textContent = "";
  $("#clientWhatsapp").href = `https://wa.me/${somenteDigitos(c.phone)}`;
  $("#iaClienteResultado").textContent = "";
  // Botão "Salvar na agenda" (só quando ainda não está na agenda)
  const agBtn = $("#btnClientToAgenda");
  agBtn.classList.toggle("hidden", !!c.inAgenda);
  agBtn.onclick = () => openSaveAgenda(c.phone, c.displayName || c.name, () => { closeModal("clientModal"); loadClients(); });
  // Ação rápida "Mover para" (atualiza etapa, funil e card imediatamente)
  renderStageMover($("#clientStageMover"), c.phone, c.stage, (stage) => {
    c.stage = stage;
    loadCrmMeta();
    loadClients();
  });
  openModal("clientModal");
  c360Filtro = "";
  $$("#timelineFiltros button").forEach((b) => b.classList.toggle("active", !b.dataset.tipo));
  loadClienteDetalhe(c);
}

const somenteDigitos = (s) => String(s || "").replace(/\D/g, "");

async function loadClienteDetalhe(c) {
  $("#c360Oportunidade").textContent = "—";
  $("#c360UltimaConversa").textContent = "—";
  $("#c360UltimaVisita").textContent = "—";
  $("#c360Campanhas").textContent = "—";
  $("#c360ProximaAcao").classList.add("hidden");
  $("#clientTimeline").innerHTML = "<p class='hint'>Carregando...</p>";
  $("#clientNotasList").innerHTML = "";
  try {
    const [detalheRes, vendedoresRes] = await Promise.all([
      fetch(`/api/clients/${c.id}/detalhe`),
      fetch("/api/visitas/vendedores").catch(() => null),
    ]);
    const data = await detalheRes.json();
    if (!detalheRes.ok) { $("#clientTimeline").innerHTML = `<p class="hint">${escapeHtml(data.error || "Não foi possível carregar o histórico.")}</p>`; return; }

    const r = data.resumo;
    $("#c360Oportunidade").textContent = r.oportunidadeValor != null ? fmtMoney(r.oportunidadeValor) : "—";
    $("#c360UltimaConversa").textContent = r.ultimaConversaEm ? fmtDate(r.ultimaConversaEm) : "—";
    $("#c360UltimaVisita").textContent = r.ultimaVisitaEm ? fmtDate(r.ultimaVisitaEm) : "—";
    $("#c360Campanhas").textContent = r.campanhasCount;
    if (r.proximaAcao) {
      $("#c360ProximaAcao").classList.remove("hidden");
      $("#c360ProximaAcaoTexto").textContent = r.proximaAcao.texto;
      $("#c360ProximaAcaoData").textContent = "📅 " + fmtDataCurta(r.proximaAcao.data);
    }

    // Vendedor responsável
    const sel = $("#clientVendedorResponsavel");
    let vendedores = [];
    if (vendedoresRes && vendedoresRes.ok) vendedores = (await vendedoresRes.json()).vendedores || [];
    sel.innerHTML = `<option value="">Sem responsável</option>` + vendedores.map((v) => `<option value="${v.id}">${escapeHtml(v.name || v.username)}</option>`).join("");
    sel.value = c.vendedorResponsavelId || "";
    sel.onchange = async () => {
      await fetch(`/api/clients/${c.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendedorResponsavelId: sel.value || null }),
      });
      c.vendedorResponsavelId = sel.value || null;
    };

    c360Timeline = data.timeline || [];
    renderTimeline();
    renderNotas(data.notas || []);
  } catch {
    $("#clientTimeline").innerHTML = "<p class='hint'>Não foi possível carregar o histórico. Verifique sua conexão e tente novamente.</p>";
  }
}

const TIMELINE_ICONE = { conversa: "💬", campanha: "📣", visita: "📍", nota: "📝" };
function renderTimeline() {
  const wrap = $("#clientTimeline");
  const lista = c360Filtro ? c360Timeline.filter((e) => e.tipo === c360Filtro) : c360Timeline;
  if (!lista.length) { wrap.innerHTML = "<p class='hint'>Nada por aqui ainda.</p>"; return; }
  wrap.innerHTML = lista.map((e) => `
    <div class="timeline-item tipo-${e.tipo}">
      <div class="timeline-body">
        <div class="timeline-when">${TIMELINE_ICONE[e.tipo] || ""} ${fmtDate(e.ts)}</div>
        <div class="timeline-text">${escapeHtml(e.texto || "")}${e.tipo === "campanha" ? (e.respondida ? " · respondida" : e.entregue ? " · entregue" : " · falhou") : ""}${e.tipo === "nota" && e.autor ? ` — <i>${escapeHtml(e.autor)}</i>` : ""}</div>
      </div>
    </div>`).join("");
}
$$("#timelineFiltros button").forEach((b) => b.addEventListener("click", () => {
  $$("#timelineFiltros button").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  c360Filtro = b.dataset.tipo;
  renderTimeline();
}));

function renderNotas(notas) {
  const wrap = $("#clientNotasList");
  if (!notas.length) { wrap.innerHTML = "<p class='hint'>Nenhuma nota ainda.</p>"; return; }
  wrap.innerHTML = notas.map((n) => `
    <div class="nota-item">
      <div class="nota-meta">${escapeHtml(n.autorNome)} · ${fmtDate(n.criadoEm)}</div>
      <div>${escapeHtml(n.texto)}</div>
    </div>`).join("");
}
$("#btnAddNota").addEventListener("click", async (e) => {
  if (!crmCurrent) return;
  const input = $("#novaNotaTexto");
  const texto = input.value.trim();
  if (!texto) return;
  try {
    const data = await withLoading(e.currentTarget, "Adicionando...", async () => {
      const res = await fetch(`/api/clients/${crmCurrent.id}/notas`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível salvar a nota.");
      return d;
    });
    input.value = "";
    c360Timeline.unshift({ tipo: "nota", ts: new Date(data.nota.criadoEm).getTime(), texto: data.nota.texto, autor: data.nota.autorNome });
    renderTimeline();
    loadClienteDetalhe(crmCurrent); // recarrega a lista de notas (mais simples que atualizar as duas em memória)
  } catch (err) {
    alert(err.message || "Não foi possível salvar a nota.");
  }
});

$("#btnIaResumirCliente").addEventListener("click", (e) => iaClienteAcao(e.currentTarget, "resumo"));
$("#btnIaSugerirAcao").addEventListener("click", (e) => iaClienteAcao(e.currentTarget, "sugestao"));
async function iaClienteAcao(btn, tipo) {
  if (!crmCurrent) return;
  const out = $("#iaClienteResultado");
  out.textContent = "";
  try {
    const data = await withLoading(btn, "Pensando...", async () => {
      const res = await fetch(`/api/clients/${crmCurrent.id}/ia`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível consultar a IA agora.");
      return d;
    });
    out.textContent = data.resposta;
  } catch (err) {
    out.textContent = err.message || "Não foi possível consultar a IA agora.";
  }
}

$("#btnSaveClient").addEventListener("click", async (e) => {
  if (!crmCurrent) return;
  const body = {
    name: $("#clientName").value.trim(),
    tags: $("#clientTags").value.split(",").map((t) => t.trim()).filter(Boolean),
  };
  try {
    await withLoading(e.currentTarget, "Salvando...", async () => {
      const res = await fetch("/api/clients/" + crmCurrent.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
    });
    $("#clientStatus").textContent = "Alterações salvas!";
    $("#clientStatus").className = "status ok";
    loadClients();
  } catch {
    $("#clientStatus").textContent = "Não foi possível salvar as alterações. Tente novamente.";
    $("#clientStatus").className = "status err";
  }
});

$("#btnDeleteClient").addEventListener("click", async (e) => {
  if (!crmCurrent || !confirm(`Excluir ${displayNameOf(crmCurrent)} da base de clientes? O histórico de conversas é mantido, mas o cadastro no CRM é apagado.`)) return;
  await withLoading(e.currentTarget, "Excluindo...", () => fetch("/api/clients/" + crmCurrent.id, { method: "DELETE" }));
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

$("#btnExportClients").addEventListener("click", async (e) => {
  const status = $("#exportClientsStatus");
  status.textContent = "";
  try {
    const data = await withLoading(e.currentTarget, "Exportando...", async () => {
      const res = await fetch("/api/clients/exportar-planilha", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível exportar a planilha. Tente novamente.");
      return d;
    });
    status.textContent = "Planilha criada! Abrindo no Google Sheets...";
    window.open(data.url, "_blank");
  } catch (err) {
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
  }
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
          <span class="resp-sub">${escapeHtml(fmtPhone(t.phone))}${t.stage ? ` · ${escapeHtml(t.stage)}` : ""}</span>
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
  $("#btnChatToClientes").classList.add("hidden");
  $("#chatStageMover").innerHTML = "";
  $("#chatMessages").innerHTML = "<p class='hint'>Carregando...</p>";
  openModal("chatModal");
  try {
    const data = await (await fetch("/api/conversas/" + key)).json();
    chatPhone = data.phone || chatPhone;
    // Identidade do contato (telefone menor, origem, etapa)
    const src = SOURCE_LABEL[data.nameSource];
    $("#chatSub").textContent = [fmtPhone(data.phone), src ? `origem: ${src}` : "", data.stage].filter(Boolean).join(" · ");
    // Botão "Salvar na agenda"
    const agBtn = $("#btnChatToAgenda");
    agBtn.classList.toggle("hidden", !!data.inAgenda);
    agBtn.onclick = () => openSaveAgenda(data.phone, data.name, () => { loadConversas(); openChat(key, data.name || nome, { phone: data.phone }); });
    // Botão "Adicionar aos Clientes" (só aparece se ainda não estiver no funil)
    const toClientBtn = $("#btnChatToClientes");
    toClientBtn.classList.toggle("hidden", !!data.stage);
    toClientBtn.onclick = async () => {
      try {
        await withLoading(toClientBtn, "Adicionando...", async () => {
          const res = await fetch("/api/clients/stage", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: data.phone, stage: "Novo" }),
          });
          if (!res.ok) throw new Error();
        });
        openChat(key, data.name || nome, { phone: data.phone });
      } catch {
        alert("Não foi possível adicionar aos Clientes. Tente novamente.");
      }
    };
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
            ${c.isClient ? `<span class="hint">Já é cliente</span>` : `<button class="btn ghost ag-to-client">Adicionar aos Clientes</button>`}
            <button class="btn-cancel ag-del" data-id="${c.id}">Excluir</button>
          </div>
        </div>
        <div class="dash-card-body">
          <span>${escapeHtml(fmtPhone(c.phone))} · ${ORIGEM_LABEL[c.origem] || c.origem}</span>
        </div>`;
      div.querySelector(".ag-add").addEventListener("click", (e) => {
        toggleCart(c, e.currentTarget);
      });
      div.querySelector(".ag-del").addEventListener("click", async (e) => {
        if (!confirm(`Remover ${c.name || c.phone} da agenda? Isso não afeta o cadastro dele em Clientes, se existir.`)) return;
        await withLoading(e.currentTarget, "Removendo...", () => fetch("/api/agenda/" + c.id, { method: "DELETE" }));
        agendaCart = agendaCart.filter((x) => x.phone !== c.phone);
        updateAgCart();
        loadAgenda();
      });
      div.querySelector(".ag-to-client")?.addEventListener("click", async (e) => {
        try {
          await withLoading(e.currentTarget, "Adicionando...", async () => {
            const res = await fetch("/api/clients/stage", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phone: c.phone, stage: "Novo" }),
            });
            if (!res.ok) throw new Error();
          });
          e.currentTarget.outerHTML = `<span class="hint">Já é cliente</span>`;
        } catch {
          alert("Não foi possível adicionar aos Clientes. Tente novamente.");
        }
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
$("#btnAgAdd").addEventListener("click", async (e) => {
  const name = $("#agName").value.trim();
  const phone = $("#agPhone").value.trim();
  const status = $("#agStatus");
  if (!phone) { status.textContent = "Informe o telefone para adicionar o contato."; status.className = "status err"; return; }
  const data = await withLoading(e.currentTarget, "Adicionando...", async () => {
    const res = await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Não foi possível adicionar este contato.");
    return d;
  }).catch((err) => { status.textContent = err.message; status.className = "status err"; return null; });
  if (!data) return;
  status.textContent = "Contato adicionado à agenda!"; status.className = "status ok";
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
$("#btnAgSync").addEventListener("click", async (e) => {
  const status = $("#agStatus");
  if (!confirm("Importar os contatos salvos no aparelho conectado?")) return;
  status.textContent = ""; status.className = "status";
  try {
    const data = await withLoading(e.currentTarget, "Sincronizando...", async () => {
      const res = await fetch("/api/agenda/sync-chip", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível sincronizar os contatos do aparelho. Tente novamente.");
      return d;
    });
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
    if (!allJobs.length) {
      wrap.innerHTML = `<div class="mini-empty list-empty">${ZapIcons.svg("megaphone", 28)}<h4>Nenhuma campanha criada ainda</h4><p>Crie sua primeira campanha para começar a conversar com sua base de clientes.</p><a class="btn primary" href="/">Criar campanha</a></div>`;
      return;
    }
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
      div.querySelector(".draft-del").addEventListener("click", async (e) => {
        if (!confirm(`Excluir o modelo "${t.name || "sem nome"}"? Essa ação não pode ser desfeita.`)) return;
        await withLoading(e.currentTarget, "Excluindo...", () => fetch("/api/templates/" + t.id, { method: "DELETE" }));
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
$("#btnSaveDraft")?.addEventListener("click", async (e) => {
  const name = $("#draftName").value.trim();
  const msg = $("#draftMsg").value.trim();
  const link = $("#draftLink").value.trim();
  const img = $("#draftImg").value.trim();
  const status = $("#draftStatus");
  const message = link ? (msg ? msg + "\n" + link : link) : msg;
  if (!name) { status.textContent = "Dê um nome ao modelo para continuar."; status.className = "status err"; return; }
  if (!message && !img) { status.textContent = "Escreva a mensagem ou informe uma imagem para continuar."; status.className = "status err"; return; }
  try {
    await withLoading(e.currentTarget, "Salvando...", async () => {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, message, imageUrls: img ? [img] : [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Não foi possível salvar o modelo. Tente novamente.");
    });
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
          <span class="resp-sub">${escapeHtml(fmtPhone(r.phone))}${r.stage ? ` · ${escapeHtml(r.stage)}` : ""}</span>
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
    if (!jobs.length) {
      wrap.innerHTML = `<div class="mini-empty list-empty">${ZapIcons.svg("refresh", 28)}<h4>Nenhum follow-up por aqui ainda</h4><p>Assim que uma campanha for enviada, os contatos sem resposta aparecem aqui para você reengajar.</p></div>`;
      return;
    }
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
    wrap.innerHTML = "<p class='hint'>Não foi possível carregar os follow-ups. Verifique sua conexão e tente novamente.</p>";
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
    $("#rulesList").innerHTML = "<p class='hint'>Não foi possível carregar as respostas automáticas. Verifique sua conexão e tente novamente.</p>";
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

$("#btnSaveBot").addEventListener("click", async (e) => {
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
    await withLoading(e.currentTarget, "Salvando...", async () => {
      const res = await fetch("/api/chatbot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
    });
    status.textContent = "Respostas automáticas salvas!";
    status.className = "status ok";
  } catch {
    status.textContent = "Não foi possível salvar as respostas automáticas. Tente novamente.";
    status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Visitas em Campo (V2) — gestão de vendedores + visitas da equipe (dono)
// ---------------------------------------------------------------------------
let visitasOwnerTab = "hoje";

async function loadVendedoresView() {
  await loadVendedores();
  loadAuditoria();
}

async function loadAuditoria() {
  const wrap = $("#auditoriaList");
  if (!wrap) return;
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/auditoria");
    const data = await res.json();
    if (!res.ok) { wrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Não foi possível carregar a atividade recente.")}</p>`; return; }
    const eventos = data.eventos || [];
    if (!eventos.length) { wrap.innerHTML = "<p class='hint'>Nenhuma atividade registrada ainda.</p>"; return; }
    wrap.innerHTML = eventos.map((e) => `
      <div class="dash-card" style="cursor:default;">
        <div class="dash-card-body">
          <span>${escapeHtml(e.acao)}</span>
          <span class="resp-sub">${escapeHtml(e.atorNome || "Alguém")} · ${fmtDate(e.criadoEm)}</span>
        </div>
      </div>`).join("");
  } catch {
    wrap.innerHTML = "<p class='hint'>Não foi possível carregar a atividade recente. Verifique sua conexão e tente novamente.</p>";
  }
}

let equipePeriod = "hoje";
async function loadVisitasView() {
  await Promise.all([loadVisitasOwner(), loadEquipeResumo()]);
}

/** Item 5.10/5.11 — resumo + desempenho por vendedor + gráfico simples de barras. */
async function loadEquipeResumo() {
  const listWrap = $("#equipeVendedoresList");
  const chartWrap = $("#equipeChart");
  try {
    const res = await fetch(`/api/visitas/equipe?period=${equipePeriod}`);
    const data = await res.json();
    if (!res.ok) { listWrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Não foi possível carregar o desempenho da equipe.")}</p>`; chartWrap.innerHTML = ""; return; }
    const t = data.total;
    $("#eqVisitas").textContent = t.visitas;
    $("#eqConcluidas").textContent = t.concluidas;
    $("#eqPendentes").textContent = t.pendentes;
    $("#eqPotencial").textContent = fmtMoney(t.potencial);
    $("#eqFollowups").textContent = t.followups;

    const vendedores = data.vendedores || [];
    if (!vendedores.length) {
      listWrap.innerHTML = "<p class='hint'>Nenhum vendedor cadastrado ainda.</p>";
      chartWrap.innerHTML = "";
    } else {
      listWrap.innerHTML = vendedores.map((v) => `
        <div class="dash-card" style="cursor:default;">
          <div class="dash-card-head"><b>${escapeHtml(v.vendedorNome)}</b></div>
          <div class="dash-card-body">
            <span class="resp-sub">${v.visitas} visita(s) · ${v.concluidas} concluída(s) · ${v.pendentes} pendente(s) · ${fmtMoney(v.potencial)} em potencial · ${v.followups} follow-up(s)</span>
          </div>
        </div>`).join("");
      const max = Math.max(1, ...vendedores.map((v) => v.visitas));
      chartWrap.innerHTML = vendedores.map((v) => `
        <div class="week-col">
          <div class="week-bar" style="height:${Math.round((v.visitas / max) * 100)}%" title="${v.visitas} visita(s)"></div>
          <span class="week-label">${escapeHtml((v.vendedorNome || "").split(" ")[0])}</span>
        </div>`).join("");
    }

    // Filtro de vendedor da lista de baixo (Hoje/Follow-up/Histórico)
    const sel = $("#visitasFiltroVendedor");
    const atual = sel.value;
    sel.innerHTML = `<option value="">Todos os vendedores</option>` +
      vendedores.map((v) => `<option value="${v.vendedorId}">${escapeHtml(v.vendedorNome)}</option>`).join("");
    sel.value = atual;
  } catch {
    listWrap.innerHTML = "<p class='hint'>Não foi possível carregar o desempenho da equipe. Verifique sua conexão e tente novamente.</p>";
    chartWrap.innerHTML = "";
  }
}
$$(".period-pill", $("#equipePeriodPills")).forEach((p) => p.addEventListener("click", () => {
  $$(".period-pill", $("#equipePeriodPills")).forEach((x) => x.classList.remove("active"));
  p.classList.add("active");
  equipePeriod = p.dataset.period;
  loadEquipeResumo();
}));
$("#visitasFiltroVendedor").addEventListener("change", loadVisitasOwner);

async function loadVendedores() {
  const wrap = $("#vendedoresList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/visitas/vendedores");
    const data = await res.json();
    if (!res.ok) { wrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Não foi possível carregar os vendedores.")}</p>`; return; }
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
          ${v.phone ? `<div>Telefone: ${escapeHtml(fmtPhone(v.phone))}</div>` : ""}
        </div>`;
      if (v.active) {
        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "btn danger sm";
        btnDel.style.marginTop = "8px";
        btnDel.textContent = "Desativar";
        btnDel.addEventListener("click", () => desativarVendedor(v.id, v.name || v.username, btnDel));
        div.appendChild(btnDel);
      }
      wrap.appendChild(div);
    });
  } catch {
    wrap.innerHTML = "<p class='hint'>Não foi possível carregar os vendedores. Verifique sua conexão e tente novamente.</p>";
  }
}

async function desativarVendedor(id, nome, btn) {
  if (!confirm(`Desativar ${nome}? Ele não vai mais conseguir acessar o ZapFlow, mas o histórico de visitas dele é mantido.`)) return;
  await withLoading(btn, "Desativando...", () => fetch(`/api/visitas/vendedores/${id}`, { method: "DELETE" }));
  loadVendedores();
}

$("#btnAddVendedor").addEventListener("click", async (e) => {
  const name = $("#vdNome").value.trim();
  const phone = $("#vdTelefone").value.trim();
  const status = $("#vendedorStatus");
  status.style.color = "";
  if (!name || !phone) { status.textContent = "Informe nome e telefone para adicionar o vendedor."; return; }
  try {
    const data = await withLoading(e.currentTarget, "Adicionando...", async () => {
      const res = await fetch("/api/visitas/vendedores", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível cadastrar o vendedor.");
      return d;
    });
    status.style.color = "var(--success)";
    status.innerHTML = `<b>Vendedor criado!</b> Usuário: <code>${escapeHtml(data.vendedor.username)}</code> — Senha temporária: <code>${escapeHtml(data.tempPassword)}</code><br>Anote agora — a senha não fica visível de novo depois.`;
    $("#vdNome").value = "";
    $("#vdTelefone").value = "";
    loadVendedores();
  } catch (err) {
    status.style.color = "";
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
  }
});

$("#btnExportVisitas").addEventListener("click", async (e) => {
  const status = $("#exportVisitasStatus");
  status.textContent = "";
  const vendedorId = $("#visitasFiltroVendedor").value;
  try {
    const data = await withLoading(e.currentTarget, "Exportando...", async () => {
      const res = await fetch("/api/visitas/exportar-planilha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: equipePeriod, vendedorId: vendedorId || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível exportar a planilha de visitas. Tente novamente.");
      return d;
    });
    status.textContent = "Planilha criada! Abrindo no Google Sheets...";
    window.open(data.url, "_blank");
  } catch (err) {
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
  }
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
    if (!res.ok) { wrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Não foi possível carregar as visitas.")}</p>`; return; }
    const vendedorFiltro = $("#visitasFiltroVendedor")?.value || "";
    const list = (data.visitas || []).filter((v) => !vendedorFiltro || v.vendedorId === vendedorFiltro);
    if (!list.length) {
      const vazio = {
        hoje: "Nenhuma visita hoje ainda.",
        followup: "Nenhum follow-up pendente. Tudo em dia com a equipe.",
        historico: "Nenhuma visita registrada ainda. Quando sua equipe iniciar visitas, elas aparecem aqui.",
      };
      wrap.innerHTML = `<p class="hint">${vazio[visitasOwnerTab] || "Nenhuma visita encontrada."}</p>`;
      return;
    }
    wrap.innerHTML = "";
    list.forEach((v) => wrap.appendChild(renderVisitaCardOwner(v)));
  } catch {
    wrap.innerHTML = "<p class='hint'>Não foi possível carregar as visitas. Verifique sua conexão e tente novamente.</p>";
  }
}

const RESULTADO_CATEGORIA = {
  "Sem contato": "neutro", "Interessado": "atencao", "Proposta solicitada": "andamento",
  "Em negociação": "andamento", "Venda fechada": "sucesso", "Retornar depois": "atencao", "Sem interesse": "perdido",
};
function isAtrasadaVisita(v) {
  if (!v.proximaVisitaData || v.resultado !== "Retornar depois") return false;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return new Date(v.proximaVisitaData + "T00:00:00").getTime() < hoje.getTime();
}
/** Formata uma data solta (YYYY-MM-DD, sem hora) -- sempre em horário local, evita o bug de "T00:00:00" virar UTC e cair um dia antes. */
function fmtDataCurta(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - hoje.getTime()) / 86400000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  return d.toLocaleDateString("pt-BR");
}
function renderVisitaCardOwner(v) {
  const div = document.createElement("div");
  div.className = "dash-card";
  const emAndamento = !v.finishedAt;
  const cat = emAndamento ? null : (RESULTADO_CATEGORIA[v.resultado] || "neutro");
  const badge = emAndamento ? `<span class="badge manual">Em andamento</span>` : `<span class="badge cat-${cat}">${escapeHtml(v.resultado || "")}</span>`;
  const atrasado = isAtrasadaVisita(v);
  const mapsLink = (v.latitude != null && v.longitude != null)
    ? `<a class="btn secondary sm" href="https://www.google.com/maps?q=${v.latitude},${v.longitude}" target="_blank" rel="noopener">Maps</a>`
    : "";
  const proximaHtml = v.proximaVisitaData ? `
    <div class="visita-next${atrasado ? " atrasado" : ""}">
      <div>
        <b>${escapeHtml(v.proximaAcao || "Retornar")}</b><br>
        <span>${atrasado ? "⚠ Atrasado — era " : "📅 "}${fmtDataCurta(v.proximaVisitaData)}</span>
      </div>
    </div>` : "";
  const secundario = [
    v.motivo, `Vendedor: ${v.vendedorNome || "—"}`,
    v.contatoNome ? `Contato: ${v.contatoNome}` : "",
    v.finishedAt ? `⏱ ${Math.round((v.finishedAt - v.dataHora) / 60000)} min` : fmtDate(v.dataHora),
  ].filter(Boolean).map(escapeHtml).join(" · ");
  div.innerHTML = `
    <div class="dash-card-head">
      <b>${escapeHtml(v.clienteNome)}</b>
      ${badge}
    </div>
    <div class="dash-card-body">
      <span class="resp-sub">${secundario}</span>
      ${v.observacao ? `<span>${escapeHtml(v.observacao)}</span>` : ""}
    </div>
    ${proximaHtml}
    ${mapsLink ? `<div class="visita-actions">${mapsLink}</div>` : ""}
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
        status.textContent = data.error || "Não foi possível enviar o follow-up. Tente novamente.";
        status.className = "status err followup-status";
        sendBtn.disabled = false;
        return;
      }
      status.textContent = "Follow-up enviado!";
      status.className = "status ok followup-status";
      input.value = "";
      setTimeout(() => { row.classList.add("hidden"); status.textContent = ""; }, 1500);
    } catch {
      status.textContent = "Não foi possível enviar o follow-up. Verifique sua conexão e tente novamente.";
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
    $("#googleConfigHint").textContent = "Não foi possível verificar a conexão com o Google. Recarregue a página e tente novamente.";
  }
}

async function loadEventos() {
  const wrap = $("#eventosList");
  wrap.innerHTML = "<p class='hint'>Carregando...</p>";
  try {
    const res = await fetch("/api/calendario/eventos");
    const data = await res.json();
    if (!res.ok) { wrap.innerHTML = `<p class="hint">${escapeHtml(data.error || "Não foi possível carregar os compromissos.")}</p>`; return; }
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
    wrap.innerHTML = "<p class='hint'>Não foi possível carregar os compromissos. Verifique sua conexão e tente novamente.</p>";
  }
}

$("#btnDisconnectGoogle").addEventListener("click", async (e) => {
  if (!confirm("Desconectar sua conta Google? Você para de ver e criar compromissos pelo ZapFlow até reconectar; nada é apagado da sua conta Google.")) return;
  await withLoading(e.currentTarget, "Desconectando...", () => fetch("/api/google/disconnect", { method: "POST" }));
  loadCalendarioView();
});

$("#btnCriarEvento").addEventListener("click", async (e) => {
  const status = $("#eventoStatus");
  const titulo = $("#evTitulo").value.trim();
  const inicio = $("#evInicio").value;
  const fim = $("#evFim").value;
  const descricao = $("#evDescricao").value.trim();
  if (!titulo || !inicio || !fim) { status.textContent = "Preencha título, início e fim para criar o compromisso."; return; }
  try {
    await withLoading(e.currentTarget, "Criando...", async () => {
      const res = await fetch("/api/calendario/eventos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, inicio: new Date(inicio).toISOString(), fim: new Date(fim).toISOString(), descricao }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Não foi possível criar o compromisso. Tente novamente.");
    });
    status.textContent = "Compromisso criado!";
    $("#evTitulo").value = ""; $("#evInicio").value = ""; $("#evFim").value = ""; $("#evDescricao").value = "";
    loadEventos();
  } catch (err) {
    status.textContent = err.message || "Não foi possível criar o compromisso. Verifique sua conexão e tente novamente.";
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
    $("#iaConfigHint").textContent = "Não foi possível carregar as configurações da IA. Recarregue a página e tente novamente.";
  }
}

$("#btnSalvarPerfilIa").addEventListener("click", async (e) => {
  const status = $("#perfilIaStatus");
  try {
    await withLoading(e.currentTarget, "Salvando...", async () => {
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
      if (!res.ok) throw new Error(data.error || "Não foi possível salvar o perfil. Tente novamente.");
    });
    status.textContent = "Perfil da empresa salvo!";
    status.className = "status ok";
  } catch (err) {
    status.textContent = err.message || "Não foi possível salvar o perfil. Verifique sua conexão e tente novamente.";
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
  const sendBtn = $("#iaSend");
  const mensagem = input.value.trim();
  if (!mensagem) return;
  iaAddBubble("user", mensagem);
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;
  $("#iaRascunho").classList.add("hidden");
  const pensando = document.createElement("div");
  pensando.className = "bubble in";
  pensando.id = "iaPensando";
  pensando.innerHTML = `<div class="bubble-text">Zappy está pensando...</div>`;
  $("#iaMessages").appendChild(pensando);
  $("#iaMessages").scrollTop = $("#iaMessages").scrollHeight;
  try {
    const res = await fetch("/api/ia/perguntar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagem, historico: iaHistorico }),
    });
    const data = await res.json();
    document.getElementById("iaPensando")?.remove();
    if (!res.ok) { iaAddBubble("assistant", data.error || "Não consegui responder agora. Tente novamente em alguns instantes."); return; }
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
    iaAddBubble("assistant", "Não consegui processar sua mensagem agora. Tente novamente em alguns instantes.");
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
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
