const APP_VERSION = "6.0.0";
const APP_CACHE_NAME = `meridian-static-v${APP_VERSION}`;
const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/analysis.js",
  "/chat.js",
  "/manifest.json",
  "/icons/meridian-icon.svg",
  "/icons/meridian-icon-192.svg",
  "/icons/meridian-icon-512.svg"
];

function isAppShellRequest(url) {
  return APP_SHELL.includes(url.pathname) || APP_SHELL.includes(`/${url.pathname.replace(/^\//, "")}`);
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP_CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key !== APP_CACHE_NAME)
        .map(key => caches.delete(key))
    ))
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin && request.url.includes("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(APP_CACHE_NAME).then(cache => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (!url.origin.startsWith(self.location.origin)) return;
  if (!isAppShellRequest(url)) return;

  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(APP_CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request)))
  );
});
