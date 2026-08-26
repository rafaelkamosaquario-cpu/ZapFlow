// ============================================================================
// Guia ZapFlow — tutorial de uso interno, opcional e contextual. Camada 1
// (tour visual fixo, sem depender de IA) + Camada 2 (ajuda contextual da
// Zappy, só pro owner). Reaproveita telas/elementos já existentes -- não
// cria nenhuma tela nova, só destaca o que já está no DOM.
//
// Estado (visto/progresso/dispensado/concluído) fica em usuarios.guide_state
// (migration 023), 1 JSON por usuário -- ver GET/POST /api/guide/estado em
// server.js. Nunca altera dado comercial real: "concluir uma etapa" é só
// visualizar/tocar "Próximo", nunca enviar campanha, criar visita etc.
// ============================================================================
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  const STEPS = {
    owner: [
      {
        id: "painel", titulo: "Seu painel", view: "overview", selector: "#radarBlock",
        texto: "Aqui você começa o dia. O Radar mostra clientes que precisam de atenção — resposta sem retorno, ação atrasada, negociação parada. Os indicadores logo acima resumem ações pendentes, conversas, retornos e oportunidades.",
      },
      {
        id: "contatos", titulo: "Contatos e clientes", view: "agenda", selector: ".agenda-add",
        texto: "Adicione contatos manualmente, importe uma planilha ou sincronize os contatos do WhatsApp. Quem entra em relacionamento comercial fica organizado em Clientes (CRM) — inclusive quem ficou parado, pra você reativar.",
      },
      {
        id: "campanhas", titulo: "Criar uma campanha", view: "campaigns", selector: "#deskHeader .btn.primary, .topbar .navbtn",
        texto: "Em Nova campanha você escolhe os contatos, escreve a mensagem (ou usa um modelo pronto) e envia agora ou agenda. Também dá pra criar uma campanha direto de um grupo filtrado no CRM.",
      },
      {
        id: "conversas", titulo: "Conversas e CRM", view: "conversas", selector: "#conversasList",
        texto: "Quando um cliente responde, a conversa fica registrada aqui — com respostas rápidas e sugestão de resposta da IA. Cada cliente também avança num funil: Novo, Contatado, Respondeu, Negociando, Fechado ou Perdido.",
      },
      {
        id: "proxima_acao", titulo: "Próxima Ação", view: "clients", selector: "#clientsList",
        texto: "Quando ainda falta fazer algo com um cliente — por exemplo, enviar uma proposta amanhã às 10h — registre a Próxima Ação. O ZapFlow avisa quando ela está atrasada ou é pra hoje. Toque em qualquer cliente pra ver e criar a dele em Cliente 360°.",
      },
      {
        id: "zappy", titulo: "Zappy IA", view: "ia", selector: "#iaAtalhos",
        texto: "A Zappy consulta os dados reais do ZapFlow pra te ajudar: quem precisa de atenção hoje, como está um vendedor, o que aconteceu com um cliente. Ela ajuda e sugere — nunca toma decisão comercial por você.",
      },
      {
        id: "vendedores_visitas", titulo: "Vendedores e Visitas", view: "vendedores", selector: "#vendedoresList",
        texto: "Cada vendedor registra visitas pelo próprio celular — cliente, observação, valor potencial e resultado. Você acompanha a carteira e o desempenho de cada um por aqui.",
      },
    ],
    vendedor: [
      {
        id: "tela", titulo: "Sua tela", selector: "#visitaTabs",
        texto: "Aqui você vê suas visitas de hoje, os follow-ups pendentes e o histórico, nas abas acima.",
      },
      {
        id: "iniciar", titulo: "Iniciar visita", selector: "#btnIniciarVisita",
        texto: "Toque aqui pra buscar um cliente já cadastrado (ou registrar um novo contato) e iniciar a visita. Ele pede sua localização — isso fica registrado no histórico do cliente.",
      },
      {
        id: "durante", titulo: "Durante a visita", selector: "#visitaTabs .tab[data-tab='hoje']",
        texto: "Enquanto a visita está em andamento, você registra observação, valor potencial e pode anexar foto (se o Google estiver conectado). Tudo salva sozinho, mesmo se fechar o navegador no meio.",
      },
      {
        id: "finalizar", titulo: "Finalizar e Próxima Ação", selector: "#visitaTabs .tab[data-tab='followup']",
        texto: "Ao final, escolha o resultado da visita. Se ainda falta algo, marque quando retomar — essa é a Próxima Ação do cliente, e ela aparece aqui em Follow-up até você resolver.",
      },
    ],
  };

  // Rótulo curto que vai pro contexto da Zappy -- mesma chave que o backend
  // valida em CONTEXTO_TELA_LABELS (server.js). Nunca texto livre.
  const VIEWS_COM_CONTEXTO = new Set([
    "overview", "ia", "conversas", "clients", "agenda", "campaigns", "followup",
    "responses", "vendedores", "visitas", "chatbot", "automacoes", "calendario", "configuracoes",
  ]);

  let ROLE = null;
  let STATE = { completedSteps: [], stepsDisponiveis: [], startedAt: null, dismissedAt: null, completedAt: null };
  let ACTIVE_STEPS = [];
  let overlayEl, spotlightEl, tooltipEl;

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  /**
   * Alguns passos têm mais de um seletor candidato (ex.: botão "Nova
   * campanha" existe tanto no cabeçalho desktop quanto no topbar mobile,
   * e só um dos dois está de fato visível por vez). querySelector com
   * "A, B" devolve o primeiro em ORDEM NO DOM, não o primeiro visível --
   * o que escolheria errado dependendo da largura da tela. Isto resolve
   * pegando o primeiro candidato com tamanho renderizado real.
   */
  function primeiroVisivel(seletor) {
    for (const s of String(seletor).split(",").map((x) => x.trim())) {
      const elCand = document.querySelector(s);
      if (elCand) {
        const r = elCand.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return elCand;
      }
    }
    // nenhum candidato visível -- devolve o primeiro que existir no DOM mesmo assim
    return document.querySelector(seletor);
  }

  async function apiGet(url) {
    try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
  }
  function apiPost(url, body) {
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  }

  function marcarEtapa(id) {
    apiPost("/api/guide/estado", { acao: "ver_etapa", stepId: id });
    if (!STATE.completedSteps.includes(id)) STATE.completedSteps.push(id);
  }
  function marcarIniciado() { apiPost("/api/guide/estado", { acao: "iniciar" }); STATE.startedAt = STATE.startedAt || new Date().toISOString(); }
  function marcarDispensado() { apiPost("/api/guide/estado", { acao: "dispensar" }); STATE.dismissedAt = new Date().toISOString(); }
  function marcarConcluido() { apiPost("/api/guide/estado", { acao: "concluir" }); STATE.completedAt = new Date().toISOString(); }
  function marcarReiniciado() {
    apiPost("/api/guide/estado", { acao: "reiniciar" });
    STATE.completedSteps = []; STATE.completedAt = null; STATE.dismissedAt = null;
  }

  // ---------------------------------------------------------------------
  // Overlay + spotlight + tooltip (Camada 1)
  // ---------------------------------------------------------------------
  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = el("div", "guide-overlay hidden");
    spotlightEl = el("div", "guide-spotlight");
    overlayEl.appendChild(spotlightEl);
    document.body.appendChild(overlayEl);
    tooltipEl = el("div", "guide-tooltip hidden");
    document.body.appendChild(tooltipEl);
  }

  function posicionar(targetEl) {
    if (!targetEl) { spotlightEl.style.display = "none"; return; }
    const r = targetEl.getBoundingClientRect();
    const pad = 6;
    spotlightEl.style.display = "block";
    spotlightEl.style.top = Math.max(0, r.top - pad) + "px";
    spotlightEl.style.left = Math.max(0, r.left - pad) + "px";
    spotlightEl.style.width = Math.max(0, r.width + pad * 2) + "px";
    spotlightEl.style.height = Math.max(0, r.height + pad * 2) + "px";

    const vw = window.innerWidth, vh = window.innerHeight;
    const ttW = tooltipEl.offsetWidth || 320, ttH = tooltipEl.offsetHeight || 160;
    let top = r.bottom + pad + 10;
    if (top + ttH > vh - 12) top = Math.max(12, r.top - pad - ttH - 10);
    const left = Math.min(Math.max(12, r.left), Math.max(12, vw - ttW - 12));
    tooltipEl.style.top = top + "px";
    tooltipEl.style.left = left + "px";
  }

  function fecharTour() {
    if (overlayEl) overlayEl.classList.add("hidden");
    if (tooltipEl) tooltipEl.classList.add("hidden");
    document.removeEventListener("keydown", onKeydownTour);
    window.removeEventListener("resize", onResizeTour);
  }
  function onKeydownTour(e) { if (e.key === "Escape") fecharTour(); }
  let resizeTargetSelector = null;
  function onResizeTour() {
    if (resizeTargetSelector) posicionar(primeiroVisivel(resizeTargetSelector));
  }

  async function mostrarPasso(idx) {
    ensureOverlay();
    const step = ACTIVE_STEPS[idx];
    if (!step) return fecharTour();

    if (ROLE === "owner" && step.view && typeof window.activateView === "function") window.activateView(step.view);
    else if (ROLE === "vendedor" && step.id === "durante") { const t = document.querySelector("[data-tab='hoje']"); t && t.click(); }
    else if (ROLE === "vendedor" && step.id === "finalizar") { const t = document.querySelector("[data-tab='followup']"); t && t.click(); }
    marcarEtapa(step.id);

    // dá tempo da view trocar (hidden/visível) antes de medir a posição real
    await new Promise((r) => setTimeout(r, 60));
    resizeTargetSelector = step.selector || null;
    let targetEl = step.selector ? primeiroVisivel(step.selector) : null;
    if (targetEl) { targetEl.scrollIntoView({ behavior: "smooth", block: "center" }); await new Promise((r) => setTimeout(r, 220)); }

    overlayEl.classList.remove("hidden");
    tooltipEl.classList.remove("hidden");
    tooltipEl.innerHTML = `
      <p class="guide-tooltip-step-n">Passo ${idx + 1} de ${ACTIVE_STEPS.length}</p>
      <h4 class="guide-tooltip-title">${escapeHtml(step.titulo)}</h4>
      <p class="guide-tooltip-body">${escapeHtml(step.texto)}</p>
      <div class="guide-tooltip-foot">
        <button class="guide-tooltip-exit" type="button" id="guideExitBtn">Sair do guia</button>
        <div class="guide-tooltip-nav">
          ${idx > 0 ? '<button class="btn ghost sm" type="button" id="guidePrevBtn">Anterior</button>' : ""}
          <button class="btn primary sm" type="button" id="guideNextBtn">${idx === ACTIVE_STEPS.length - 1 ? "Concluir" : "Próximo"}</button>
        </div>
      </div>`;
    posicionar(targetEl);
    $("#guideExitBtn", tooltipEl).addEventListener("click", fecharTour);
    if (idx > 0) $("#guidePrevBtn", tooltipEl).addEventListener("click", () => mostrarPasso(idx - 1));
    $("#guideNextBtn", tooltipEl).addEventListener("click", () => {
      if (idx === ACTIVE_STEPS.length - 1) { marcarConcluido(); fecharTour(); }
      else mostrarPasso(idx + 1);
    });
    $("#guideNextBtn", tooltipEl).focus();
    document.addEventListener("keydown", onKeydownTour);
    window.addEventListener("resize", onResizeTour);
  }

  function iniciarTour(fromIdx) {
    ACTIVE_STEPS = STEPS[ROLE].filter((s) => STATE.stepsDisponiveis.includes(s.id));
    if (!ACTIVE_STEPS.length) return;
    marcarIniciado();
    mostrarPasso(Math.min(Math.max(0, fromIdx || 0), ACTIVE_STEPS.length - 1));
  }

  // ---------------------------------------------------------------------
  // Convite inicial (Parte 1)
  // ---------------------------------------------------------------------
  function mostrarBoasVindas() {
    const modal = el("div", "modal", `
      <div class="modal-box" role="dialog" aria-modal="true" aria-label="Guia ZapFlow">
        <div class="modal-head"><h3>Guia ZapFlow</h3></div>
        <p class="hint">Aprenda o essencial para aproveitar melhor o ZapFlow. Leva poucos passos e você pode sair quando quiser.</p>
        <div class="row" style="margin-top:14px;">
          <button class="btn primary" type="button" id="guideBemVindoComecar">Começar</button>
          <button class="btn ghost" type="button" id="guideBemVindoAgoraNao">Agora não</button>
        </div>
      </div>`);
    document.body.appendChild(modal);
    const fechar = (dispensar) => { modal.remove(); document.removeEventListener("keydown", onEsc); if (dispensar) marcarDispensado(); };
    function onEsc(e) { if (e.key === "Escape") fechar(true); }
    document.addEventListener("keydown", onEsc);
    $("#guideBemVindoComecar", modal).addEventListener("click", () => { fechar(false); iniciarTour(0); });
    $("#guideBemVindoAgoraNao", modal).addEventListener("click", () => fechar(true));
    $("#guideBemVindoComecar", modal).focus();
  }

  // ---------------------------------------------------------------------
  // Acesso permanente — lista de etapas com progresso (Parte 2/Reabrir)
  // ---------------------------------------------------------------------
  function abrirListaEtapas() {
    const disponiveis = STEPS[ROLE].filter((s) => STATE.stepsDisponiveis.includes(s.id));
    const total = disponiveis.length || 1;
    const feitos = STATE.completedSteps.filter((id) => STATE.stepsDisponiveis.includes(id)).length;
    const pct = Math.round((feitos / total) * 100);
    const itensHtml = disponiveis.map((s, i) => `
      <button class="guide-step-item ${STATE.completedSteps.includes(s.id) ? "done" : ""}" type="button" data-idx="${i}">
        <span class="guide-step-check">${STATE.completedSteps.includes(s.id) ? "✓" : ""}</span>
        <span>${escapeHtml(s.titulo)}</span>
      </button>`).join("");
    const modal = el("div", "modal", `
      <div class="modal-box" role="dialog" aria-modal="true" aria-label="Guia ZapFlow">
        <div class="modal-head"><h3>Guia ZapFlow</h3><button class="modal-close" type="button" id="guideListaFechar" aria-label="Fechar">✕</button></div>
        <div class="guide-progress">
          <div class="guide-progress-bar"><div class="guide-progress-fill" style="width:${pct}%"></div></div>
          <span class="guide-progress-label">${feitos} de ${total} concluído(s)</span>
        </div>
        <div class="guide-steps-list">${itensHtml}</div>
        <div class="row" style="margin-top:16px;">
          <button class="btn primary" type="button" id="guideContinuar">${feitos ? "Continuar guia" : "Começar guia"}</button>
          <button class="btn ghost" type="button" id="guideRecomecar">Recomeçar</button>
        </div>
      </div>`);
    document.body.appendChild(modal);
    const fechar = () => { modal.remove(); document.removeEventListener("keydown", onEsc); };
    function onEsc(e) { if (e.key === "Escape") fechar(); }
    document.addEventListener("keydown", onEsc);
    modal.addEventListener("click", (e) => { if (e.target === modal) fechar(); });
    $("#guideListaFechar", modal).addEventListener("click", fechar);
    $$(".guide-step-item", modal).forEach((b) => b.addEventListener("click", () => { fechar(); iniciarTour(+b.dataset.idx); }));
    $("#guideContinuar", modal).addEventListener("click", () => {
      fechar();
      const proxIdx = disponiveis.findIndex((s) => !STATE.completedSteps.includes(s.id));
      iniciarTour(proxIdx >= 0 ? proxIdx : 0);
    });
    $("#guideRecomecar", modal).addEventListener("click", () => { fechar(); marcarReiniciado(); iniciarTour(0); });
  }

  // ---------------------------------------------------------------------
  // Ajuda contextual da Zappy (Camada 2) — só owner, mesma restrição de
  // acesso que a tela ZapFlow IA já tem hoje (vendedor não alcança /api/ia).
  // ---------------------------------------------------------------------
  function telaAtual() {
    const activeBtn = document.querySelector(".side-tab.active[data-view]") || document.querySelector(".mtab.active[data-view]");
    const view = activeBtn && activeBtn.dataset.view;
    return view && VIEWS_COM_CONTEXTO.has(view) ? view : "overview";
  }

  function montarAjudaFlutuante() {
    const fab = el("button", "guide-help-fab", `<span aria-hidden="true">✨</span><span>Ajuda nesta tela</span>`);
    fab.type = "button";
    fab.setAttribute("aria-label", "Pergunte à Zappy sobre esta tela");
    document.body.appendChild(fab);
    let pop = null;
    fab.addEventListener("click", () => {
      if (pop) { pop.remove(); pop = null; return; }
      pop = el("div", "guide-help-pop", `
        <div class="guide-help-pop-head"><h4>Pergunte à Zappy</h4><button class="modal-close" type="button" id="guideHelpFechar" aria-label="Fechar">✕</button></div>
        <p class="guide-help-tela">Sobre a tela atual</p>
        <div class="guide-help-answer hidden" id="guideHelpResposta"></div>
        <div class="chat-reply">
          <input type="text" id="guideHelpInput" placeholder="Como uso esta tela?" />
          <button class="btn primary sm" type="button" id="guideHelpEnviar">Enviar</button>
        </div>`);
      document.body.appendChild(pop);
      const fecharPop = () => { pop.remove(); pop = null; document.removeEventListener("keydown", onEsc); };
      function onEsc(e) { if (e.key === "Escape") fecharPop(); }
      document.addEventListener("keydown", onEsc);
      $("#guideHelpFechar", pop).addEventListener("click", fecharPop);
      $("#guideHelpInput", pop).focus();
      const enviar = async () => {
        const input = $("#guideHelpInput", pop);
        const mensagem = input.value.trim();
        if (!mensagem) return;
        const resp = $("#guideHelpResposta", pop);
        resp.classList.remove("hidden");
        resp.textContent = "Zappy está pensando...";
        input.disabled = true;
        try {
          const r = await fetch("/api/ia/perguntar", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mensagem, historico: [], contextoTela: telaAtual() }),
          });
          const data = await r.json();
          resp.textContent = r.ok ? data.resposta : (data.error || "Não consegui responder agora.");
        } catch { resp.textContent = "Não consegui responder agora. Tente novamente."; }
        input.disabled = false;
        input.value = "";
      };
      $("#guideHelpEnviar", pop).addEventListener("click", enviar);
      $("#guideHelpInput", pop).addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });
    });
  }

  // ---------------------------------------------------------------------
  async function init(role) {
    ROLE = role === "vendedor" ? "vendedor" : "owner";
    const estado = await apiGet("/api/guide/estado");
    if (!estado) return; // sem sessão/erro ao carregar -- Guia some, sem quebrar o resto do app
    STATE = estado;

    const btnDesktop = $("#btnAbrirGuia");
    const btnMobile = $("#btnAbrirGuiaMobile");
    [btnDesktop, btnMobile].forEach((b) => b && b.addEventListener("click", abrirListaEtapas));

    if (ROLE === "owner") {
      montarAjudaFlutuante();
      if (!STATE.startedAt && !STATE.dismissedAt) setTimeout(mostrarBoasVindas, 1200);
    }
  }

  window.ZapFlowGuide = { init };
})();
