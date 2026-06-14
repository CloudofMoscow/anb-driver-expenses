const CACHE_NAME = "driver-expenses-v15";
const ASSETS = [
  "./index.html",
  "./styles.css?v=11",
  "./app.js?v=11",
  "./manifest.webmanifest?v=11",
  "./icon.svg?v=11",
  "./icon-192.png?v=11",
  "./icon-512.png?v=11",
  "./apple-touch-icon.png",
  "./anb-logo.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      navigationResponse(event.request)
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

async function navigationResponse(request) {
  const cached = await caches.match("./index.html");
  return cached || fetch(request);
}
