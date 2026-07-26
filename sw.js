const CACHE_NAME = "anb-fleet-v55";
const ASSETS = [
  "./login.html",
  "./driver.html",
  "./office.html",
  "./styles.css?v=55",
  "./api-client.js",
  "./api-client.js?v=55",
  "./financial-mutation.js",
  "./financial-mutation.js?v=55",
  "./login.js?v=55",
  "./driver.js?v=55",
  "./driver-outbox.js",
  "./push-notifications.js",
  "./office.js?v=55",
  "./manifest.webmanifest?v=55",
  "./icon.svg?v=55",
  "./icon-192.png?v=55",
  "./icon-512.png?v=55",
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
    event.respondWith(navigationResponse(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = {
      title: "ANB Group",
      message: event.data?.text() || "В приложении появилось новое событие."
    };
  }
  const title = String(payload.title || "ANB Group").slice(0, 120);
  const options = {
    body: String(payload.message || "Откройте приложение, чтобы посмотреть детали.").slice(0, 700),
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: {
      url: payload.url || "/login.html",
      readUrl: payload.readUrl || ""
    }
  };
  if (payload.notificationId) {
    options.tag = payload.notificationId;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/login.html", self.location.origin).href;
  const readUrl = event.notification.data?.readUrl || "";
  event.waitUntil(Promise.all([
    readUrl
      ? fetch(readUrl, { method: "POST", credentials: "include" }).catch(() => null)
      : Promise.resolve(),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const sameOriginClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOriginClient) {
        await sameOriginClient.navigate(targetUrl);
        return sameOriginClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  ]));
});

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("./login.html"));
  }
}
