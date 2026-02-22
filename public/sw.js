const CACHE_NAME = "snowskye-cache-v2";

const urlsToCache = [
  "/",
  "/index.html",
  "/login.html",
  "/dashboard.html",
  "/manifest.json"
];

// INSTALL
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// ACTIVATE (clean old caches)
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// FETCH
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // 🚫 NEVER cache widget or API requests
  if (
    url.pathname.includes("widget.js") ||
    url.pathname.startsWith("/api") ||
    url.hostname.includes("snowskyeai.onrender.com")
  ) {
    return; // let browser fetch normally
  }

  // ✅ Cache-first ONLY for same-origin static files
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        return cached || fetch(req);
      })
    );
  }
});