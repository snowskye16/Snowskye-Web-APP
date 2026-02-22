const CACHE_NAME = "snowskye-cache-v2";

const urlsToCache = [
  "/",
  "/index.html",
  "/login.html",
  "/dashboard.html",
  "/manifest.json"
];

// Install
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// Activate (delete old caches)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 🚫 Never cache your widget or API requests
  if (
    url.pathname.includes("widget.js") ||
    url.pathname.startsWith("/api") ||
    url.hostname.includes("snowskyeai.onrender.com")
  ) {
    return; // let network handle it
  }

  // ✅ Cache-first ONLY for same-origin static files
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});