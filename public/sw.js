// Service Worker do ZapFlow — cache do "app shell" para funcionar offline.
const CACHE = "zapflow-v8";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/theme.js",
  "/icons.js",
  "/zappy.svg",
  "/icon.svg",
  "/manifest.json",
];

// Instala e pré-armazena os arquivos básicos
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// Remove caches antigos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: rede primeiro (com fallback para o cache quando offline).
// Nunca intercepta chamadas de API nem métodos diferentes de GET.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Sempre revalida com o servidor (no-cache) para nunca servir versão antiga;
  // o cache fica só como fallback offline.
  event.respondWith(
    fetch(new Request(request.url, { cache: "no-cache", credentials: "same-origin" }))
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match("/")))
  );
});
