const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function formatDuracao(ms) {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const min = String(Math.floor(totalSeg / 60)).padStart(2, "0");
  const seg = String(totalSeg % 60).padStart(2, "0");
  return `${min}:${seg}`;
}

// ---------------------------------------------------------------------------
// Geolocalização (grátis, nativa do navegador — sem Geocoding/Maps API)
// ---------------------------------------------------------------------------
let geo = { lat: null, lng: null };
function iniciarGeolocalizacao() {
  const status = $("#geoStatus");
  geo = { lat: null, lng: null };
  status.textContent = "📍 Obtendo localização...";
  if (!navigator.geolocation) {
    status.textContent = "Localização não suportada neste navegador — a visita será salva sem coordenadas.";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      geo.lat = pos.coords.latitude;
      geo.lng = pos.coords.longitude;
      status.innerHTML = `📍 Localização capturada — <a href="https://www.google.com/maps?q=${geo.lat},${geo.lng}" target="_blank" rel="noopener">ver no mapa</a>`;
    },
    () => { status.textContent = "Não foi possível obter a localização — a visita será salva sem coordenadas."; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------------------------------------------------------------------------
// Modal: Iniciar visita
// ---------------------------------------------------------------------------
function abrirIniciarModal() {
  $("#iniciarModal").classList.remove("hidden");
  $("#vfCliente").value = "";
  $("#vfObjetivo").value = "";
  $("#iniciarStatus").textContent = "";
  iniciarGeolocalizacao();
}
$("#btnIniciarVisita").addEventListener("click", abrirIniciarModal);
$("#btnFecharIniciar").addEventListener("click", () => $("#iniciarModal").classList.add("hidden"));

$("#btnConfirmarIniciar").addEventListener("click", async () => {
  const status = $("#iniciarStatus");
  const clienteNome = $("#vfCliente").value.trim();
  if (!clienteNome) { status.textContent = "Informe o nome do cliente."; status.className = "status err"; return; }
  try {
    const res = await fetch("/api/visitas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clienteNome, objetivo: $("#vfObjetivo").value.trim(), latitude: geo.lat, longitude: geo.lng }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao iniciar."; status.className = "status err"; return; }
    $("#iniciarModal").classList.add("hidden");
    abrirDuranteModal(data.visita);
  } catch {
    status.textContent = "Erro de conexão.";
    status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Modal: Visita em andamento (Durante)
// ---------------------------------------------------------------------------
let visitaAtual = null;
let timerInterval = null;

function abrirDuranteModal(visita) {
  visitaAtual = visita;
  $("#duranteCliente").textContent = visita.clienteNome;
  $("#duranteObjetivo").textContent = visita.objetivo || "";
  $("#durContato").value = visita.contatoNome || "";
  $("#durTelefone").value = visita.contatoTelefone || "";
  $("#durObservacao").value = visita.observacao || "";
  $("#durValor").value = visita.valorPotencial ?? "";
  $("#durData").value = visita.proximaVisitaData || "";
  renderFotos(visita.fotos || []);
  ["detalhesStatus", "fotoStatus", "valorStatus", "agendarStatus", "finalizarStatus"].forEach((id) => { $("#" + id).textContent = ""; });
  $("#duranteModal").classList.remove("hidden");

  if (timerInterval) clearInterval(timerInterval);
  const atualizarTimer = () => { $("#duranteTimer").textContent = formatDuracao(Date.now() - visita.dataHora); };
  atualizarTimer();
  timerInterval = setInterval(atualizarTimer, 1000);
}
function fecharDuranteModal() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  visitaAtual = null;
  $("#duranteModal").classList.add("hidden");
}
function renderFotos(fotos) {
  const wrap = $("#fotosPreview");
  if (!fotos.length) { wrap.textContent = ""; return; }
  wrap.innerHTML = fotos.map((f) => `<a href="${f.url}" target="_blank" rel="noopener">📎 ${escapeHtml(f.nome || "foto")}</a>`).join(" · ");
}

$("#btnSalvarDetalhes").addEventListener("click", async () => {
  const status = $("#detalhesStatus");
  try {
    const res = await fetch(`/api/visitas/${visitaAtual.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contatoNome: $("#durContato").value.trim(),
        contatoTelefone: $("#durTelefone").value.trim(),
        observacao: $("#durObservacao").value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao salvar."; status.className = "status err"; return; }
    visitaAtual = data.visita;
    status.textContent = "Salvo!";
    status.className = "status ok";
  } catch {
    status.textContent = "Erro de conexão.";
    status.className = "status err";
  }
});

$("#durFoto").addEventListener("change", async () => {
  const input = $("#durFoto");
  const status = $("#fotoStatus");
  if (!input.files?.length) return;
  status.textContent = "Enviando...";
  status.className = "status";
  const form = new FormData();
  form.append("file", input.files[0]);
  try {
    const res = await fetch(`/api/visitas/${visitaAtual.id}/foto`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao enviar."; status.className = "status err"; return; }
    visitaAtual = data.visita;
    renderFotos(visitaAtual.fotos);
    status.textContent = "Foto salva!";
    status.className = "status ok";
    input.value = "";
  } catch {
    status.textContent = "Erro de conexão.";
    status.className = "status err";
  }
});

$("#btnSalvarValor").addEventListener("click", async () => {
  const status = $("#valorStatus");
  const valor = $("#durValor").value;
  try {
    const res = await fetch(`/api/visitas/${visitaAtual.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valorPotencial: valor ? Number(valor) : null }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao salvar."; status.className = "status err"; return; }
    visitaAtual = data.visita;
    status.textContent = "Salvo!";
    status.className = "status ok";
  } catch {
    status.textContent = "Erro de conexão.";
    status.className = "status err";
  }
});

$("#btnAgendar").addEventListener("click", async () => {
  const status = $("#agendarStatus");
  const data = $("#durData").value;
  const hora = $("#durHora").value;
  if (!data) { status.textContent = "Escolha uma data."; status.className = "status err"; return; }
  try {
    const res = await fetch(`/api/visitas/${visitaAtual.id}/agendar-retorno`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, hora }),
    });
    const dataRes = await res.json();
    if (!res.ok) { status.textContent = dataRes.error || "Erro ao agendar."; status.className = "status err"; return; }
    visitaAtual = dataRes.visita;
    status.textContent = dataRes.calendarioCriado ? "Agendado! Já entrou na sua Google Agenda." : "Agendado (conecte o Google pra também criar na Agenda).";
    status.className = "status ok";
  } catch {
    status.textContent = "Erro de conexão.";
    status.className = "status err";
  }
});

$("#btnFinalizar").addEventListener("click", async () => {
  const status = $("#finalizarStatus");
  try {
    const res = await fetch(`/api/visitas/${visitaAtual.id}/finalizar`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: $("#finMotivo").value, resultado: $("#finResultado").value }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "Erro ao finalizar."; status.className = "status err"; return; }
    status.textContent = "Visita finalizada!";
    status.className = "status ok";
    setTimeout(() => {
      fecharDuranteModal();
      loadResumo();
      loadVisitas();
    }, 700);
  } catch {
    status.textContent = "Erro de conexão.";
    status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Abas Hoje / Follow-up / Histórico
// ---------------------------------------------------------------------------
let activeTab = "hoje";
$$(".tab", $("#visitaTabs")).forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    $$(".tab", $("#visitaTabs")).forEach((b) => b.classList.toggle("active", b === btn));
    loadVisitas();
  });
});

// ---------------------------------------------------------------------------
// Resumo do dia (tira de números no topo)
// ---------------------------------------------------------------------------
async function loadResumo() {
  const wrap = $("#resumoStrip");
  try {
    const res = await fetch("/api/visitas/resumo");
    const r = await res.json();
    if (!res.ok) { wrap.innerHTML = ""; return; }
    const pill = (label, valor) => `<span class="badge" style="font-size:13px; padding:6px 12px;">${valor} ${label}</span>`;
    wrap.innerHTML = pill("retornos pendentes", r.retornos) + pill("visitas hoje", r.visitasHoje) + pill("oportunidades quentes", r.oportunidades);
  } catch {
    wrap.innerHTML = "";
  }
}

// ---------------------------------------------------------------------------
// Lista de visitas
// ---------------------------------------------------------------------------
function renderVisitaCard(v) {
  const div = document.createElement("div");
  div.className = "dash-card";
  const dataFmt = new Date(v.dataHora).toLocaleString("pt-BR");
  const emAndamento = !v.finishedAt;
  const badge = emAndamento ? `<span class="badge manual">Em andamento</span>` : `<span class="badge">${escapeHtml(v.resultado || "")}</span>`;
  const duracao = v.finishedAt ? `<div>⏱️ Duração: ${formatDuracao(v.finishedAt - v.dataHora)}</div>` : "";
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
      ${v.objetivo ? `<div>${escapeHtml(v.objetivo)}</div>` : ""}
      <div>${v.motivo ? escapeHtml(v.motivo) + " • " : ""}${dataFmt}</div>
      ${duracao}
      ${v.contatoNome ? `<div>Contato: ${escapeHtml(v.contatoNome)}</div>` : ""}
      ${v.observacao ? `<div>${escapeHtml(v.observacao)}</div>` : ""}
      ${fotos}
      ${proxima}
      ${mapsLink ? `<div>${mapsLink}</div>` : ""}
    </div>
    ${followupBlock(v)}`;
  if (emAndamento) {
    div.style.cursor = "pointer";
    div.addEventListener("click", (e) => { if (!e.target.closest("a, button, input")) abrirDuranteModal(v); });
  }
  attachFollowupHandlers(div, v);
  return div;
}

/** Bloco de "enviar follow-up" — só aparece se a visita tiver telefone de contato. */
function followupBlock(v) {
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
function attachFollowupHandlers(div, v) {
  const toggleBtn = div.querySelector(".btn-followup");
  if (!toggleBtn) return;
  const row = div.querySelector(".followup-row");
  const input = div.querySelector(".followup-input");
  const sendBtn = div.querySelector(".btn-followup-send");
  const status = div.querySelector(".followup-status");
  toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); row.classList.toggle("hidden"); });
  sendBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
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

async function loadVisitas() {
  const wrap = $("#visitasList");
  const hint = $("#visitasHint");
  wrap.innerHTML = "";
  hint.textContent = "Carregando...";
  try {
    const res = await fetch(`/api/visitas?tab=${activeTab}`);
    const data = await res.json();
    if (!res.ok) {
      hint.textContent = data.error || "Erro ao carregar visitas.";
      return;
    }
    const list = data.visitas || [];
    if (!list.length) {
      const vazio = { hoje: "Nenhuma visita hoje ainda.", followup: "Nenhum retorno pendente." };
      hint.textContent = vazio[activeTab] || "Nenhuma visita registrada.";
      return;
    }
    hint.textContent = "";
    list.forEach((v) => wrap.appendChild(renderVisitaCard(v)));
  } catch {
    hint.textContent = "Erro de conexão.";
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
$("#btnLogout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

// ---------------------------------------------------------------------------
// Início: retoma visita em andamento (se existir) e carrega tudo
// ---------------------------------------------------------------------------
(async function init() {
  loadResumo();
  loadVisitas();
  try {
    const res = await fetch("/api/visitas/em-andamento");
    const data = await res.json();
    if (data.visita) abrirDuranteModal(data.visita);
  } catch { /* silencioso — não bloqueia o carregamento normal */ }
})();
