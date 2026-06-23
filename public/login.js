const form = document.getElementById("loginForm");
const errorEl = document.getElementById("loginError");
const btn = document.getElementById("loginBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Entrando...";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: document.getElementById("user").value,
        password: document.getElementById("password").value,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      window.location.href = "/";
    } else {
      errorEl.textContent = data.error || "Não foi possível entrar.";
    }
  } catch (err) {
    errorEl.textContent = "Erro de conexão. Tente novamente.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});
