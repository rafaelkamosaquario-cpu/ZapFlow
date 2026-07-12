// ZapFlow — motor de tema (claro / escuro / automático).
// O padrão é CLARO. "auto" segue o dispositivo. A escolha fica no localStorage.
(function () {
  const KEY = "zapflow_theme"; // 'auto' | 'light' | 'dark'

  function stored() {
    try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; }
  }

  function apply(mode) {
    const root = document.documentElement;
    if (mode === "light" || mode === "dark") {
      root.setAttribute("data-theme", mode);
    } else {
      root.removeAttribute("data-theme"); // automático = segue o sistema
    }
    // Atualiza a cor da barra do navegador conforme o tema efetivo
    const dark = mode === "dark" ||
      (mode === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0F1720" : "#F6F8FB");
  }

  function set(mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ }
    apply(mode);
  }

  // Aplica assim que possível (o <head> já roda um init inline para evitar flash)
  apply(stored());

  // Reage à mudança do sistema quando estiver em "automático"
  if (window.matchMedia) {
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (stored() === "auto") apply("auto");
      });
    } catch (e) { /* Safari antigo */ }
  }

  window.ZapTheme = { get: stored, set, apply };
})();
