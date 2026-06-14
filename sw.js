// Minimal service worker — makes the app installable and loads the shell fast.
// Network-first for everything (so new songs/data always show), falling back to cache.
const CACHE = "cac-v1";
const SHELL = ["./", "./index.html", "./logo.png", "./icon.png", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Never cache API calls or R2 media — always go to network.
  if (req.method !== "GET" || /\/\.netlify\/functions\//.test(req.url) || /r2\.dev/.test(req.url)) {
    return;
  }
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
