/**
 * capacitor-bridge.js — v2
 * Pakai Web Push (VAPID) yang sudah ada di server, bukan FCM
 * Taruh di public/ dan load sebelum script.js di index.html
 */

(function () {
  const isCapacitor = !!(window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform());

  console.log("[Bridge] isCapacitor:", isCapacitor);

  // ── 1. GEOLOCATION OVERRIDE ──────────────────────────────────────────────────
  function overrideGeolocation() {
    const { Geolocation } = Capacitor.Plugins;
    if (!Geolocation) { console.warn("[Bridge] Geolocation plugin tidak ada"); return; }

    async function nativeGetPosition(success, error, options) {
      try {
        const perm = await Geolocation.requestPermissions();
        console.log("[Bridge] Location perm:", perm.location);
        if (perm.location === "denied") {
          if (error) error({ code: 1, message: "Permission denied" });
          return;
        }
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeout ?? 15000,
        });
        success({
          coords: {
            latitude:         pos.coords.latitude,
            longitude:        pos.coords.longitude,
            accuracy:         pos.coords.accuracy,
            altitude:         pos.coords.altitude   ?? null,
            altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
            heading:          pos.coords.heading    ?? null,
            speed:            pos.coords.speed      ?? null,
          },
          timestamp: pos.timestamp,
        });
      } catch (e) {
        console.warn("[Bridge] getCurrentPosition error:", e);
        if (error) error({ code: 2, message: e.message });
      }
    }

    const _watchIds = new Map();

    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: nativeGetPosition,
        watchPosition: function (success, error, options) {
          const fakeId = Math.floor(Math.random() * 99999);
          (async () => {
            try {
              const perm = await Geolocation.requestPermissions();
              if (perm.location === "denied") {
                if (error) error({ code: 1, message: "Permission denied" });
                return;
              }
              const { id } = await Geolocation.watchPosition(
                { enableHighAccuracy: true },
                (pos, err) => {
                  if (err) { if (error) error(err); return; }
                  success({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }, timestamp: pos.timestamp });
                }
              );
              _watchIds.set(fakeId, id);
            } catch (e) {
              if (error) error({ code: 2, message: e.message });
            }
          })();
          return fakeId;
        },
        clearWatch: function (fakeId) {
          const realId = _watchIds.get(fakeId);
          if (realId !== undefined) {
            try { Geolocation.clearWatch({ id: realId }); } catch {}
            _watchIds.delete(fakeId);
          }
        },
      },
      writable: false, configurable: true,
    });
    console.log("[Bridge] ✅ Geolocation overridden");
  }

  // ── 2. CAMERA PERMISSION OVERRIDE ────────────────────────────────────────────
  function overrideCamera() {
    const { Camera } = Capacitor.Plugins;
    if (!Camera || !navigator.mediaDevices?.getUserMedia) return;

    const _orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      if (constraints?.video) {
        try {
          const perm = await Camera.requestPermissions({ permissions: ["camera"] });
          console.log("[Bridge] Camera perm:", perm.camera);
          if (perm.camera === "denied") throw new DOMException("Permission denied", "NotAllowedError");
        } catch (e) {
          if (e.name === "NotAllowedError") throw e;
        }
      }
      return _orig(constraints);
    };
    console.log("[Bridge] ✅ Camera overridden");
  }

  // ── 3. FIX PERMISSIONS API ────────────────────────────────────────────────────
  // Agar refreshPermStates() di script.js tidak stuck di "prompt"
  function fixPermissionsAPI() {
    if (!navigator.permissions) return;
    const _orig = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async function (descriptor) {
      try { return await _orig(descriptor); }
      catch { return { state: "granted", onchange: null }; }
    };
    console.log("[Bridge] ✅ Permissions API fixed");
  }

  // ── 4. PUSH NOTIFICATION — pakai Web Push VAPID yang sudah ada di server ─────
  function initWebPush() {
    // Capacitor WebView support Service Worker & PushManager
    // Kita pakai Web Push biasa — tidak perlu FCM
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.warn("[Bridge] Web Push tidak didukung di WebView ini");
      return;
    }

    async function subscribePush() {
      try {
        // Ambil VAPID key dari server
        const r = await fetch("/push/vapid-public-key");
        if (!r.ok) { console.warn("[Bridge] VAPID key tidak tersedia"); return; }
        const { key } = await r.json();
        if (!key) return;

        const reg = await navigator.serviceWorker.ready;

        // Cek apakah sudah subscribe
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          });
        }

        // Kirim subscription ke server (endpoint yang sudah ada)
        const user = localStorage.getItem("user") || "";
        await fetch("/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-User": user },
          body: JSON.stringify({ subscription: sub }),
        });

        console.log("[Bridge] ✅ Web Push subscription berhasil");
      } catch (e) {
        console.warn("[Bridge] Push subscription error:", e);
      }
    }

    function urlBase64ToUint8Array(base64String) {
      const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
      const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw     = window.atob(base64);
      return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
    }

    // Request notification permission native (Android 13+)
    async function requestNotifPermission() {
      if ("Notification" in window && Notification.permission === "default") {
        const result = await Notification.requestPermission();
        console.log("[Bridge] Notification permission:", result);
      }
    }

    // Jalankan setelah app siap
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(async () => {
        await requestNotifPermission();
        await subscribePush();
      }, 3000);
    });

    console.log("[Bridge] ✅ Web Push init terjadwal");
  }

  // ── INIT ─────────────────────────────────────────────────────────────────────
  if (isCapacitor) {
    overrideGeolocation();
    overrideCamera();
    fixPermissionsAPI();
    initWebPush();
    console.log("[Bridge] 🚀 Capacitor Bridge v2 aktif");
  } else {
    // Di browser biasa, tetap init Web Push
    initWebPush();
    console.log("[Bridge] 🌐 Browser mode — hanya Web Push aktif");
  }

})();
