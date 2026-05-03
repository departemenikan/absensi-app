// Service Worker — Absensi Smart
// ⚠️  Naikkan versi ini setiap ada perubahan besar
const CACHE_NAME = "absensi-smart-v5";

const CACHE_URLS = [
  "/", "/index.html", "/manifest.json",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

const API_PATHS = [
  "/absen", "/login", "/logout", "/signup",
  "/status", "/history", "/profile", "/profil",
  "/anggota", "/timesheet", "/check-user", "/face-descriptor",
  "/kuota-cuti", "/pengajuan-cuti", "/kebijakan-cuti",
  "/tracking", "/libur", "/areas", "/groups",
  "/roles", "/rules", "/rekap", "/admin", "/divisi",
  "/aktivitas", "/aktivitas-kustom",
  "/verify", "/push", "/report", "/export",
  "/cuti", "/overtime", "/.well-known",
];

const EXTERNAL_DOMAINS = [
  "photon.komoot.io", "nominatim.openstreetmap.org",
  "server.arcgisonline.com", "tile.openstreetmap.org",
  "basemaps.cartocdn.com", "unpkg.com",
  "cdnjs.cloudflare.com", "cdn.jsdelivr.net",
];

// INSTALL
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// FETCH
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Domain external — bypass
  if (EXTERNAL_DOMAINS.some((d) => url.hostname.includes(d))) return;

  // API internal — selalu network
  if (API_PATHS.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Aset statis — network first, fallback cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("/index.html"))
      )
  );
});

// PUSH NOTIFICATION
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = JSON.parse(event.data.text()); }
  catch { payload = { title: "Absensi Smart", body: event.data.text() }; }

  const title = payload.title || "Absensi Smart";

  // Tag unik per notif agar tidak saling timpa antar user/event
  // Gunakan timestamp sehingga setiap notif muncul sebagai entri baru
  const uniqueTag = (payload.tag || "absensi") + "-" + Date.now();

  const options = {
    body:               payload.body || "",
    icon:               "/icons/icon-192.png",
    badge:              "/icons/icon-96.png",
    vibrate:            [300, 100, 300, 100, 300], // pola getar lebih terasa
    tag:                uniqueTag,
    renotify:           true,   // selalu tampil meskipun tag sama
    silent:             false,  // HARUS false agar bersuara
    requireInteraction: true,   // notif tidak hilang otomatis — user harus swipe
    data:               { url: payload.url || "/" },
    // Android channel ID — harus sama dengan yang dibuat di capacitor-bridge.js
    // (Chrome Android & TWA membaca field ini)
    ...(payload.channelId ? { tag: payload.channelId + "-" + Date.now() } : {}),
  };

  // Tambahkan actions jika ada (tombol di notif)
  if (payload.actions) options.actions = payload.actions;

  event.waitUntil(self.registration.showNotification(title, options));
});

// KLIK NOTIFIKASI
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
