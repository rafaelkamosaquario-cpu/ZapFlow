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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const fmtMoneyFull = (v) => "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  status.textContent = "📍 Vamos usar sua localização pra marcar onde essa visita aconteceu (aparece no mapa pro dono depois). Obtendo localização...";
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
let vfClienteSelecionado = null; // { id, name, phone } quando o vendedor escolhe um cliente já existente

function mostrarClienteSelecionado(cliente) {
  vfClienteSelecionado = cliente;
  $("#vfCliente").value = cliente.name || cliente.phone;
  $("#vfBuscaWrap").classList.add("hidden");
  $("#vfBuscaResultados").classList.add("hidden");
  $("#vfBusca").value = "";
  $("#vfClienteSelecionadoNome").textContent = cliente.name || "(sem nome)";
  $("#vfClienteSelecionadoTelefone").textContent = cliente.phone || "";
  $("#vfClienteSelecionadoWrap").classList.remove("hidden");
}
function limparClienteSelecionado() {
  vfClienteSelecionado = null;
  $("#vfCliente").value = "";
  $("#vfClienteSelecionadoWrap").classList.add("hidden");
  $("#vfBuscaWrap").classList.remove("hidden");
}
$("#btnTrocarCliente").addEventListener("click", limparClienteSelecionado);

let vfBuscaTimer = null;
$("#vfBusca").addEventListener("input", () => {
  clearTimeout(vfBuscaTimer);
  const q = $("#vfBusca").value.trim();
  const resultados = $("#vfBuscaResultados");
  if (q.length < 2) { resultados.classList.add("hidden"); resultados.innerHTML = ""; return; }
  vfBuscaTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/visitas/clientes-busca?q=${encodeURIComponent(q)}`);
      const d = await res.json();
      const lista = d.clientes || [];
      if (!lista.length) {
        resultados.innerHTML = `<p class="hint" style="padding:8px 0;">Nenhum cliente encontrado — pode seguir digitando um contato novo abaixo.</p>`;
      } else {
        resultados.innerHTML = lista.map((c) => `
          <div class="dash-card vf-resultado" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone)}" style="cursor:pointer;">
            <b>${escapeHtml(c.name || "(sem nome)")}</b>
            <p class="hint" style="margin:2px 0 0;">${escapeHtml(c.phone || "")}</p>
          </div>`).join("");
      }
      resultados.classList.remove("hidden");
    } catch { /* busca é auxiliar -- falha em silêncio, o vendedor ainda pode digitar manualmente */ }
  }, 300);
});
$("#vfBuscaResultados").addEventListener("click", (e) => {
  const card = e.target.closest(".vf-resultado");
  if (!card) return;
  mostrarClienteSelecionado({ id: card.dataset.id, name: card.dataset.name, phone: card.dataset.phone });
});

function abrirIniciarModal() {
  $("#iniciarModal").classList.remove("hidden");
  limparClienteSelecionado();
  $("#vfBusca").value = "";
  $("#vfBuscaResultados").classList.add("hidden");
  $("#vfObjetivo").value = "";
  $("#iniciarStatus").textContent = "";
  iniciarGeolocalizacao();
}
$("#btnIniciarVisita").addEventListener("click", abrirIniciarModal);
$("#btnFecharIniciar").addEventListener("click", () => $("#iniciarModal").classList.add("hidden"));

$("#btnConfirmarIniciar").addEventListener("click", async (e) => {
  const status = $("#iniciarStatus");
  const clienteNome = $("#vfCliente").value.trim();
  if (!clienteNome) { status.textContent = "Informe o nome do cliente para iniciar a visita."; status.className = "status err"; return; }
  try {
    const data = await withLoading(e.currentTarget, "Iniciando...", async () => {
      const res = await fetch("/api/visitas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteNome,
          clienteId: vfClienteSelecionado?.id || undefined,
          objetivo: $("#vfObjetivo").value.trim(), latitude: geo.lat, longitude: geo.lng,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível iniciar a visita. Tente novamente.");
      return d;
    });
    $("#iniciarModal").classList.add("hidden");
    abrirDuranteModal(data.visita);
  } catch (err) {
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
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
  $("#durProximaAcao").value = visita.proximaAcao || "";
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

$("#btnSalvarDetalhes").addEventListener("click", async (e) => {
  const status = $("#detalhesStatus");
  try {
    const data = await withLoading(e.currentTarget, "Salvando...", async () => {
      const res = await fetch(`/api/visitas/${visitaAtual.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contatoNome: $("#durContato").value.trim(),
          contatoTelefone: $("#durTelefone").value.trim(),
          observacao: $("#durObservacao").value.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível salvar os detalhes da visita. Tente novamente.");
      return d;
    });
    visitaAtual = data.visita;
    status.textContent = "Detalhes salvos!";
    status.className = "status ok";
  } catch (err) {
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
    status.className = "status err";
  }
});

$("#btnResumirIa").addEventListener("click", async (e) => {
  const status = $("#detalhesStatus");
  const out = $("#iaResumoResultado");
  const observacao = $("#durObservacao").value.trim();
  if (!observacao) { status.textContent = "Escreva alguma observação antes de pedir o resumo."; status.className = "status err"; return; }
  out.classList.add("hidden");
  try {
    const data = await withLoading(e.currentTarget, "Pensando...", async () => {
      const res = await fetch(`/api/visitas/${visitaAtual.id}/ia-resumo`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observacao }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível gerar o resumo agora.");
      return d;
    });
    out.classList.remove("hidden");
    out.innerHTML = `<b>Resumo:</b> ${escapeHtml(data.resumo)}` +
      (data.resultado ? `<br><button type="button" class="btn ghost sm" id="btnAplicarResultado" style="margin-top:6px;">Aplicar resultado sugerido: ${escapeHtml(data.resultado)}</button>` : "") +
      (data.proximaAcao ? `<br><button type="button" class="btn ghost sm" id="btnAplicarProximaAcao" style="margin-top:6px;">Aplicar próxima ação: ${escapeHtml(data.proximaAcao)}</button>` : "");
    $("#btnAplicarResultado")?.addEventListener("click", () => { $("#finResultado").value = data.resultado; });
    $("#btnAplicarProximaAcao")?.addEventListener("click", () => { $("#durProximaAcao").value = data.proximaAcao; });
  } catch (err) {
    status.textContent = err.message || "Não foi possível gerar o resumo agora.";
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
    if (!res.ok) { status.textContent = data.error || "Não foi possível enviar a foto. Tente novamente."; status.className = "status err"; return; }
    visitaAtual = data.visita;
    renderFotos(visitaAtual.fotos);
    status.textContent = "Foto salva!";
    status.className = "status ok";
    input.value = "";
  } catch {
    status.textContent = "Não foi possível enviar a foto. Verifique sua conexão e tente novamente.";
    status.className = "status err";
  }
});

$("#btnSalvarValor").addEventListener("click", async (e) => {
  const status = $("#valorStatus");
  const valor = $("#durValor").value;
  try {
    const data = await withLoading(e.currentTarget, "Salvando...", async () => {
      const res = await fetch(`/api/visitas/${visitaAtual.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valorPotencial: valor ? Number(valor) : null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível salvar o valor potencial. Tente novamente.");
      return d;
    });
    visitaAtual = data.visita;
    status.textContent = "Valor potencial salvo!";
    status.className = "status ok";
  } catch (err) {
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
    status.className = "status err";
  }
});

$("#btnAgendar").addEventListener("click", async (e) => {
  const status = $("#agendarStatus");
  const data = $("#durData").value;
  const hora = $("#durHora").value;
  const proximaAcao = $("#durProximaAcao").value.trim();
  if (!data) { status.textContent = "Escolha uma data para agendar o follow-up."; status.className = "status err"; return; }
  try {
    const dataRes = await withLoading(e.currentTarget, "Agendando...", async () => {
      const res = await fetch(`/api/visitas/${visitaAtual.id}/agendar-retorno`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, hora, proximaAcao }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível agendar o follow-up. Tente novamente.");
      return d;
    });
    visitaAtual = dataRes.visita;
    status.textContent = dataRes.calendarioCriado ? "Follow-up agendado! Já entrou na sua Google Agenda." : "Follow-up agendado (conecte o Google pra também criar na Agenda).";
    status.className = "status ok";
  } catch (err) {
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
    status.className = "status err";
  }
});

$("#btnFinalizar").addEventListener("click", async (e) => {
  const status = $("#finalizarStatus");
  try {
    await withLoading(e.currentTarget, "Finalizando...", async () => {
      const res = await fetch(`/api/visitas/${visitaAtual.id}/finalizar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: $("#finMotivo").value, resultado: $("#finResultado").value }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Não foi possível finalizar a visita. Tente novamente.");
    });
    status.textContent = "Visita finalizada!";
    status.className = "status ok";
    setTimeout(() => {
      fecharDuranteModal();
      loadResumo();
      loadVisitas();
    }, 700);
  } catch (err) {
    status.textContent = err.message || "Não foi possível se conectar ao servidor. Verifique sua internet e tente novamente.";
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
    wrap.innerHTML = pill("follow-ups pendentes", r.retornos) + pill("visitas hoje", r.visitasHoje) + pill("oportunidades quentes", r.oportunidades);
  } catch {
    wrap.innerHTML = "";
  }
}

// ---------------------------------------------------------------------------
// Lista de visitas
// ---------------------------------------------------------------------------
const RESULTADO_CATEGORIA = {
  "Sem contato": "neutro", "Interessado": "atencao", "Proposta solicitada": "andamento",
  "Em negociação": "andamento", "Venda fechada": "sucesso", "Retornar depois": "atencao", "Sem interesse": "perdido",
};
function badgeResultado(v) {
  if (!v.finishedAt) return `<span class="badge manual">Em andamento</span>`;
  const cat = RESULTADO_CATEGORIA[v.resultado] || "neutro";
  return `<span class="badge cat-${cat}">${escapeHtml(v.resultado || "")}</span>`;
}
function fmtDataCurta(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - hoje.getTime()) / 86400000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  return d.toLocaleDateString("pt-BR");
}
function isAtrasado(v) {
  if (!v.proximaVisitaData || v.resultado !== "Retornar depois") return false;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return new Date(v.proximaVisitaData + "T00:00:00").getTime() < hoje.getTime();
}
function somenteDigitos(s) { return String(s || "").replace(/\D/g, ""); }

function renderVisitaCard(v) {
  const div = document.createElement("div");
  div.className = "dash-card";
  const emAndamento = !v.finishedAt;
  const atrasado = isAtrasado(v);

  const proximaHtml = (v.proximaVisitaData && !emAndamento) ? `
    <div class="visita-next${atrasado ? " atrasado" : ""}">
      <div>
        <b>${escapeHtml(v.proximaAcao || "Retornar")}</b><br>
        <span>${atrasado ? "⚠ Atrasado — era " : "📅 "}${fmtDataCurta(v.proximaVisitaData)}</span>
      </div>
    </div>` : "";

  const secundario = [
    v.motivo,
    v.contatoNome ? `Contato: ${v.contatoNome}` : "",
    v.finishedAt ? `⏱ ${formatDuracao(v.finishedAt - v.dataHora)}` : new Date(v.dataHora).toLocaleString("pt-BR"),
  ].filter(Boolean).map(escapeHtml).join(" · ");

  const waHref = v.contatoTelefone ? `https://wa.me/${somenteDigitos(v.contatoTelefone)}` : null;
  const mapsHref = (v.latitude != null && v.longitude != null) ? `https://www.google.com/maps?q=${v.latitude},${v.longitude}` : null;
  const podeFollowup = !emAndamento && v.contatoTelefone && v.resultado === "Retornar depois";

  const actions = [];
  if (podeFollowup) actions.push(`<button class="btn secondary sm btn-followup" type="button">Fazer follow-up</button>`);
  else if (waHref) actions.push(`<a class="btn secondary sm" href="${waHref}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (mapsHref) actions.push(`<a class="btn secondary sm" href="${mapsHref}" target="_blank" rel="noopener">Maps</a>`);
  if (!emAndamento) actions.push(`<button class="btn secondary sm btn-detalhes" type="button">Detalhes</button>`);

  div.innerHTML = `
    <div class="dash-card-head">
      <b>${escapeHtml(v.clienteNome)}</b>
      ${badgeResultado(v)}
    </div>
    <div class="dash-card-body">
      <span class="visita-secondary">${secundario}</span>
      ${v.valorPotencial != null ? `<span class="visita-potencial">💰 ${fmtMoneyFull(v.valorPotencial)}</span>` : ""}
    </div>
    ${proximaHtml}
    <div class="visita-actions">${actions.join("")}</div>
    ${followupBlock(v)}`;

  if (emAndamento) {
    div.style.cursor = "pointer";
    div.addEventListener("click", (e) => { if (!e.target.closest("a, button, input")) abrirDuranteModal(v); });
  } else {
    div.querySelector(".btn-detalhes")?.addEventListener("click", (e) => { e.stopPropagation(); abrirDetalheVisita(v); });
  }
  attachFollowupHandlers(div, v);
  return div;
}

/** Compõe e envia um follow-up pontual (Z-API) — acionado pelo botão "Fazer follow-up" do card. */
function followupBlock(v) {
  if (!v.contatoTelefone || !v.finishedAt || v.resultado !== "Retornar depois") return "";
  return `
    <div class="followup-block" style="margin-top:10px;">
      <div class="manual-row followup-row hidden">
        <input type="text" class="followup-input" placeholder="Mensagem de follow-up..." />
        <button class="btn ghost sm btn-followup-ia" type="button">✨</button>
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
  const iaBtn = div.querySelector(".btn-followup-ia");
  const sendBtn = div.querySelector(".btn-followup-send");
  const status = div.querySelector(".followup-status");
  toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); row.classList.toggle("hidden"); });
  iaBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const data = await withLoading(iaBtn, "...", async () => {
        const res = await fetch(`/api/visitas/${v.id}/preparar-followup`, { method: "POST" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Não foi possível preparar a mensagem agora.");
        return d;
      });
      input.value = data.mensagem;
    } catch (err) {
      status.textContent = err.message || "Não foi possível preparar a mensagem agora.";
      status.className = "status err followup-status";
    }
  });
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

/** Tela de detalhe completo da visita (Item 5.9) — reaproveita o objeto já carregado, sem nova chamada. */
function abrirDetalheVisita(v) {
  $("#detTitulo").textContent = v.clienteNome;
  const inicio = new Date(v.dataHora).toLocaleString("pt-BR");
  const fim = v.finishedAt ? new Date(v.finishedAt).toLocaleString("pt-BR") : "—";
  const duracao = v.finishedAt ? formatDuracao(v.finishedAt - v.dataHora) : "—";
  const mapsHref = (v.latitude != null && v.longitude != null) ? `https://www.google.com/maps?q=${v.latitude},${v.longitude}` : null;
  const waHref = v.contatoTelefone ? `https://wa.me/${somenteDigitos(v.contatoTelefone)}` : null;
  const fotos = (v.fotos || []).map((f) => `<a href="${f.url}" target="_blank" rel="noopener">📎 ${escapeHtml(f.nome || "foto")}</a>`).join(" · ");
  $("#detalheConteudo").innerHTML = `
    <p>${badgeResultado(v)}</p>
    <p class="hint"><b>Objetivo:</b> ${escapeHtml(v.objetivo || "—")}</p>
    <p class="hint"><b>Motivo da visita:</b> ${escapeHtml(v.motivo || "—")}</p>
    <p class="hint"><b>Início:</b> ${inicio}</p>
    <p class="hint"><b>Fim:</b> ${fim} · <b>Duração:</b> ${duracao}</p>
    ${mapsHref ? `<p class="hint"><b>Localização:</b> <a href="${mapsHref}" target="_blank" rel="noopener">Abrir no Google Maps</a></p>` : ""}
    ${v.contatoNome || v.contatoTelefone ? `<p class="hint"><b>Contato:</b> ${escapeHtml(v.contatoNome || "—")}${waHref ? ` · <a href="${waHref}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ""}</p>` : ""}
    <p class="hint"><b>Valor potencial:</b> ${v.valorPotencial != null ? fmtMoneyFull(v.valorPotencial) : "—"}</p>
    <p class="hint"><b>Observações:</b> ${escapeHtml(v.observacao || "—")}</p>
    <p class="hint"><b>Próxima ação:</b> ${escapeHtml(v.proximaAcao || "—")}${v.proximaVisitaData ? ` (${fmtDataCurta(v.proximaVisitaData)})` : ""}</p>
    ${fotos ? `<p class="hint"><b>Fotos:</b> ${fotos}</p>` : ""}
    <div id="detOutrasVisitas"></div>
  `;
  $("#detalheModal").classList.remove("hidden");
  if (v.contatoTelefone) carregarOutrasVisitas(v);
}

async function carregarOutrasVisitas(v) {
  const box = $("#detOutrasVisitas");
  if (!box) return;
  try {
    const params = new URLSearchParams({ telefone: v.contatoTelefone, excluir: v.id });
    const data = await (await fetch(`/api/visitas/relacionadas?${params}`)).json();
    const outras = data.visitas || [];
    if (!outras.length) return;
    box.innerHTML = `<h5 class="dash-subtitle" style="margin-top:14px;font-size:13px;">Outras visitas a este cliente</h5>` +
      outras.map((o) => `<p class="hint">${new Date(o.dataHora).toLocaleDateString("pt-BR")} · ${escapeHtml(o.motivo || "—")} · ${escapeHtml(o.resultado || "em andamento")}</p>`).join("");
  } catch { /* histórico relacionado é complementar -- silencioso se falhar */ }
}
$("#btnFecharDetalhe").addEventListener("click", () => $("#detalheModal").classList.add("hidden"));

async function loadVisitas() {
  const wrap = $("#visitasList");
  const hint = $("#visitasHint");
  wrap.innerHTML = "";
  hint.textContent = "Carregando...";
  try {
    const res = await fetch(`/api/visitas?tab=${activeTab}`);
    const data = await res.json();
    if (!res.ok) {
      hint.textContent = data.error || "Não foi possível carregar as visitas. Verifique sua conexão e tente novamente.";
      return;
    }
    const list = data.visitas || [];
    if (!list.length) {
      const vazio = {
        hoje: "Nenhuma visita hoje ainda. Toque em \"Iniciar visita\" para registrar a primeira.",
        followup: "Nenhum follow-up pendente. Tudo em dia.",
        historico: "Nenhuma visita registrada ainda. Suas visitas aparecem aqui depois de finalizadas.",
      };
      hint.textContent = vazio[activeTab] || "Nenhuma visita registrada.";
      return;
    }
    hint.textContent = "";
    if (activeTab === "hoje") renderGrupoHoje(wrap, list);
    else if (activeTab === "followup") renderGrupoFollowup(wrap, list);
    else list.forEach((v) => wrap.appendChild(renderVisitaCard(v)));
  } catch {
    hint.textContent = "Não foi possível carregar as visitas. Verifique sua conexão e tente novamente.";
  }
}

function addGroupTitle(wrap, texto, count) {
  const h = document.createElement("div");
  h.className = "list-group-title";
  h.innerHTML = `<span>${escapeHtml(texto)}</span><span class="count">${count}</span>`;
  wrap.appendChild(h);
}

/** Item 5.7 — Hoje separa quem ainda não voltou (em andamento) de quem já finalizou. */
function renderGrupoHoje(wrap, list) {
  const pendentes = list.filter((v) => !v.finishedAt);
  const concluidas = list.filter((v) => v.finishedAt);
  if (pendentes.length) { addGroupTitle(wrap, "Em andamento", pendentes.length); pendentes.forEach((v) => wrap.appendChild(renderVisitaCard(v))); }
  if (concluidas.length) { addGroupTitle(wrap, "Concluídas hoje", concluidas.length); concluidas.forEach((v) => wrap.appendChild(renderVisitaCard(v))); }
}

/** Item 5.8 — Follow-up agrupado por urgência em vez de lista cronológica solta. */
function renderGrupoFollowup(wrap, list) {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const atrasados = list.filter((v) => v.proximaVisitaData && v.proximaVisitaData < hojeStr);
  const deHoje = list.filter((v) => v.proximaVisitaData === hojeStr);
  const proximos = list.filter((v) => v.proximaVisitaData && v.proximaVisitaData > hojeStr);
  if (atrasados.length) { addGroupTitle(wrap, "⚠ Atrasados", atrasados.length); atrasados.forEach((v) => wrap.appendChild(renderVisitaCard(v))); }
  if (deHoje.length) { addGroupTitle(wrap, "Hoje", deHoje.length); deHoje.forEach((v) => wrap.appendChild(renderVisitaCard(v))); }
  if (proximos.length) { addGroupTitle(wrap, "Próximos", proximos.length); proximos.forEach((v) => wrap.appendChild(renderVisitaCard(v))); }
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
