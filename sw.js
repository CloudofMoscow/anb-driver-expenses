const CACHE_PREFIX = `driver-expenses:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v18`;
const APP_URL = new URL("./", self.registration.scope).href;
const INDEX_URL = new URL("index.html", APP_URL).href;
const ASSETS = [
  "./index.html",
  "./styles.css?v=18",
  "./app.js?v=18",
  "./manifest.webmanifest?v=13",
  "./icon.svg",
  "./icon.svg?v=13",
  "./icon-192.png?v=13",
  "./icon-512.png?v=13",
  "./apple-touch-icon.png",
  "./anb-logo.svg"
].map((path) => new URL(path, APP_URL).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })))
  ));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateVersion());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (event.request.mode === "navigate" && [APP_URL, INDEX_URL].includes(url.origin + url.pathname)) {
    event.respondWith(currentAsset(INDEX_URL, event.request));
  } else if (ASSETS.includes(url.href)) {
    event.respondWith(currentAsset(event.request, event.request));
  }
});

async function activateVersion() {
  const keys = await caches.keys();
  await Promise.all(keys.map(async (key) => {
    if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) return caches.delete(key);
    if (!/^driver-expenses-v\d+$/.test(key)) return;
    const legacyCache = await caches.open(key);
    const requests = await legacyCache.keys();
    if (requests.some((request) => request.url === INDEX_URL)
      && requests.every((request) => request.url.startsWith(APP_URL))) {
      await caches.delete(key);
    }
  }));
  await self.clients.claim();
}

async function currentAsset(key, request) {
  const cache = await caches.open(CACHE_NAME);
  return await cache.match(key) || fetch(request);
}
