// Service Worker — Absensi Smart
// Cache otomatis di-bust saat deploy baru (timestamp di-inject server atau ganti manual)
const CACHE_NAME = "absensi-smart-v4";

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

  // ── Bypass: request ke domain external (geocoder, tile map, CDN) ──
  const externalDomains = [
    "photon.komoot.io",
    "nominatim.openstreetmap.org",
    "server.arcgisonline.com",
    "tile.openstreetmap.org",
    "basemaps.cartocdn.com",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "cdn.jsdelivr.net",
  ];
  if (externalDomains.some(d => url.hostname.includes(d))) {
    return;
  }

  // Selalu ke network untuk SEMUA API calls internal — jangan pernah dari cache
  const apiPaths = [
    "/absen", "/login", "/logout", "/signup",
    "/status", "/history", "/profile", "/profil",
    "/anggota", "/timesheet", "/check-user", "/face-descriptor",
    "/kuota-cuti", "/pengajuan-cuti", "/kebijakan-cuti",
    "/tracking", "/libur", "/areas", "/groups",
    "/roles", "/rules",                          // ← rules ditambahkan
    "/rekap", "/admin", "/divisi",
    "/aktivitas", "/aktivitas-kustom",
    "/verify", "/push",
    "/report", "/export",
    "/cuti", "/overtime",
    "/.well-known",
  ];
  if (apiPaths.some(p => url.pathname.startsWith(p))) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    return;
  }

  // Network first untuk semua request lain (HTML, JS, CSS, icons)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match("/index.html");
        });
      })
  );
});

// ── Push Notification Handler ──────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = JSON.parse(event.data.text()); } catch { payload = { title: "Absensi Smart", body: event.data.text() }; }

  const title   = payload.title || "Absensi Smart";
  const options = {
    body:    payload.body  || "",
    icon:    "/icons/icon-192.png",
    badge:   "/icons/icon-96.png",
    vibrate: [200, 100, 200],
    tag:     payload.tag   || "absensi-notif",
    renotify: true,
    data:    { url: payload.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Klik notifikasi → buka app ─────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});

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

  // ── Bypass: request ke domain external (geocoder, tile map, CDN) ──
  // Langsung ke network, jangan di-intercept service worker
  const externalDomains = [
    "photon.komoot.io",
    "nominatim.openstreetmap.org",
    "server.arcgisonline.com",
    "tile.openstreetmap.org",
    "basemaps.cartocdn.com",
    "unpkg.com",
    "cdnjs.cloudflare.com"
  ];
  if (externalDomains.some(d => url.hostname.includes(d))) {
    // Biarkan browser handle langsung — tidak di-cache, tidak di-intercept
    return;
  }

  // Selalu ke network untuk API calls internal — jangan pernah dari cache
  if (
    url.pathname.startsWith("/absen") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/logout") ||
    url.pathname.startsWith("/signup") ||
    url.pathname.startsWith("/status") ||
    url.pathname.startsWith("/history") ||
    url.pathname.startsWith("/profil") ||
    url.pathname.startsWith("/anggota") ||
    url.pathname.startsWith("/timesheet") ||
    url.pathname.startsWith("/kuota-cuti") ||
    url.pathname.startsWith("/pengajuan-cuti") ||
    url.pathname.startsWith("/kebijakan-cuti") ||
    url.pathname.startsWith("/tracking") ||
    url.pathname.startsWith("/libur") ||
    url.pathname.startsWith("/areas") ||
    url.pathname.startsWith("/groups") ||
    url.pathname.startsWith("/roles") ||
    url.pathname.startsWith("/rekap") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/divisi") ||
    url.pathname.startsWith("/aktivitas") ||
    url.pathname.startsWith("/verify")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network first untuk semua request lain
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Simpan ke cache hanya untuk response dari domain sendiri (type === "basic")
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

// ── Push Notification Handler ──────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = JSON.parse(event.data.text()); } catch { payload = { title: "Absensi Smart", body: event.data.text() }; }

  const title   = payload.title || "Absensi Smart";
  const options = {
    body:    payload.body  || "",
    icon:    "/icons/icon-192.png",
    badge:   "/icons/icon-96.png",
    vibrate: [200, 100, 200],
    tag:     payload.tag   || "absensi-notif",
    renotify: true,
    data:    { url: payload.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Klik notifikasi → buka app ─────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // Kalau app sudah terbuka, fokuskan
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      // Kalau belum terbuka, buka baru
      return clients.openWindow(targetUrl);
    })
  );
});
