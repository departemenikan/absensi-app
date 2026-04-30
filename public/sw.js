// Service Worker — Absensi Smart
// Versi: update ini setiap kali ada perubahan besar
const CACHE_NAME = "absensi-smart-v1";

// File yang di-cache untuk offline
const CACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Install — cache file statis
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — hapus cache lama
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback ke cache
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Selalu ke network untuk API calls
  if (
    url.pathname.startsWith("/absen") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/signup") ||
    url.pathname.startsWith("/status") ||
    url.pathname.startsWith("/history") ||
    url.pathname.startsWith("/profil") ||
    url.pathname.startsWith("/anggota") ||
    url.pathname.startsWith("/timesheet") ||
    url.pathname.startsWith("/kuota-cuti") ||
    url.pathname.startsWith("/libur") ||
    url.pathname.startsWith("/areas") ||
    url.pathname.startsWith("/groups") ||
    url.pathname.startsWith("/roles")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network first untuk semua request lain
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Simpan ke cache jika sukses
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback ke cache jika offline
        return caches.match(event.request).then((cached) => {
          return cached || caches.match("/index.html");
        });
      })
  );
});
