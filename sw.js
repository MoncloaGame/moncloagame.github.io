/* Moncloa Game · service worker: permite instalar la app y jugar en local sin conexión */
const CACHE = "moncloa-game-v2";
const CORE = ["./", "index.html", "net.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  const sameOrigin = u.origin === location.origin;
  const cacheable = sameOrigin || /unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host);
  if (!cacheable) return;
  // primero la red (para recibir actualizaciones), y si no hay conexión, la copia guardada
  e.respondWith(fetch(r).then(res => { if (res && (res.ok || res.type === "opaque")) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === "navigate" ? caches.match("index.html") : undefined))));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => { for (const c of cs) { if ("focus" in c) return c.focus(); } return self.clients.openWindow("./"); }));
});
