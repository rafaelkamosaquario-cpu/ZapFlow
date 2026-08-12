const form = document.getElementById("loginForm");
const errorEl = document.getElementById("loginError");
const btn = document.getElementById("loginBtn");

// Se veio de um redirect por sessão expirada, avisa antes de qualquer tentativa de login.
if (sessionStorage.getItem("zapflow_session_expired")) {
  sessionStorage.removeItem("zapflow_session_expired");
  errorEl.textContent = "Sua sessão expirou. Entre novamente para continuar.";
}

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
      const voltarPara = sessionStorage.getItem("zapflow_return_to");
      sessionStorage.removeItem("zapflow_return_to");
      window.location.href = voltarPara || (data.role === "vendedor" ? "/vendedor.html" : "/");
    } else {
      errorEl.textContent = data.error || "Não foi possível entrar.";
    }
  } catch (err) {
    errorEl.textContent = "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});
