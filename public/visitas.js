const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
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
    () => {
      status.textContent = "Não foi possível obter a localização — a visita será salva sem coordenadas.";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------------------------------------------------------------------------
// Modal de registro
// ---------------------------------------------------------------------------
function abrirModal() {
  $("#visitaModal").classList.remove("hidden");
  iniciarGeolocalizacao();
}
function fecharModal() {
  $("#visitaModal").classList.add("hidden");
  $("#visitaStatus").textContent = "";
}
function limparFormulario() {
  ["vfCliente", "vfContato", "vfTelefone", "vfObservacao", "vfProximaAcao", "vfProximaData", "vfValor"]
    .forEach((id) => { $("#" + id).value = ""; });
  $("#vfMotivo").selectedIndex = 0;
  $("#vfResultado").selectedIndex = 0;
}

$("#btnNovaVisita").addEventListener("click", abrirModal);
$("#btnFecharVisita").addEventListener("click", fecharModal);
$("#btnCancelarVisita").addEventListener("click", fecharModal);

$("#btnSalvarVisita").addEventListener("click", async () => {
  const status = $("#visitaStatus");
  const clienteNome = $("#vfCliente").value.trim();
  if (!clienteNome) {
    status.textContent = "Informe o nome do cliente.";
    status.className = "status err";
    return;
  }
  const body = {
    clienteNome,
    contatoNome: $("#vfContato").value.trim(),
    contatoTelefone: $("#vfTelefone").value.trim(),
    latitude: geo.lat,
    longitude: geo.lng,
    motivo: $("#vfMotivo").value,
    resultado: $("#vfResultado").value,
    observacao: $("#vfObservacao").value.trim(),
    proximaAcao: $("#vfProximaAcao").value.trim(),
    proximaVisitaData: $("#vfProximaData").value || null,
    valorPotencial: $("#vfValor").value ? Number($("#vfValor").value) : null,
  };
  try {
    const res = await fetch("/api/visitas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || "Erro ao salvar.";
      status.className = "status err";
      return;
    }
    status.textContent = "Visita salva!";
    status.className = "status ok";
    setTimeout(() => {
      fecharModal();
      limparFormulario();
      loadVisitas();
    }, 600);
  } catch {
    status.textContent = "Erro de conexão. Tente novamente.";
    status.className = "status err";
  }
});

// ---------------------------------------------------------------------------
// Abas Hoje / Histórico
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
// Lista de visitas
// ---------------------------------------------------------------------------
function renderVisitaCard(v) {
  const div = document.createElement("div");
  div.className = "dash-card";
  const dataFmt = new Date(v.dataHora).toLocaleString("pt-BR");
  const mapsLink = (v.latitude != null && v.longitude != null)
    ? `<a href="https://www.google.com/maps?q=${v.latitude},${v.longitude}" target="_blank" rel="noopener">📍 Abrir no Google Maps</a>`
    : "";
  const proxima = v.proximaVisitaData
    ? `<div>🔁 Retorno: ${new Date(v.proximaVisitaData + "T00:00:00").toLocaleDateString("pt-BR")}</div>`
    : "";
  div.innerHTML = `
    <div class="dash-card-head">
      <b>${escapeHtml(v.clienteNome)}</b>
      <span class="badge">${escapeHtml(v.resultado)}</span>
    </div>
    <div class="dash-card-body">
      <div>${escapeHtml(v.motivo)} • ${dataFmt}</div>
      ${v.contatoNome ? `<div>Contato: ${escapeHtml(v.contatoNome)}</div>` : ""}
      ${v.observacao ? `<div>${escapeHtml(v.observacao)}</div>` : ""}
      ${v.proximaAcao ? `<div>Próxima ação: ${escapeHtml(v.proximaAcao)}</div>` : ""}
      ${proxima}
      ${mapsLink ? `<div>${mapsLink}</div>` : ""}
    </div>`;
  return div;
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
      hint.textContent = activeTab === "hoje" ? "Nenhuma visita hoje ainda." : "Nenhuma visita registrada.";
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

loadVisitas();
