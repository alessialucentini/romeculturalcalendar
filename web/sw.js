// Service worker: l'app funziona offline con l'ultimo elenco eventi scaricato.
const VERSION = "v4";
const SHELL = `roma-oggi-shell-${VERSION}`;
const DATA = "roma-oggi-data";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/linceo.webp", "icons/favicon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("roma-oggi-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.endsWith("/data/events.json")) {
    // dati: prima la rete (sono aggiornati ogni settimana), se offline l'ultima copia
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(DATA).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // guscio dell'app: dalla cache, aggiornata in background
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
