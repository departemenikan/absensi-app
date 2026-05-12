// ============================================================
// capacitor-bridge.js
// Daftarkan plugin @aparajita/capacitor-biometric-auth ke
// window.Capacitor.Plugins agar bisa diakses script.js
//
// URUTAN LOAD di index.html:
//   1. @capacitor/core      → window.Capacitor tersedia
//   2. capacitor-bridge.js  → plugin didaftarkan
//   3. script.js            → plugin digunakan
// ============================================================

(function () {
  "use strict";

  // ── Tunggu window.Capacitor siap (maks 5 detik) ─────────────
  // Diperlukan karena capacitor/core@8 dari CDN kadang async saat
  // server.url eksternal digunakan
  function waitForCapacitor(cb, timeout) {
    timeout = timeout || 5000;
    var start = Date.now();
    function check() {
      if (window.Capacitor && typeof window.Capacitor.registerPlugin === "function") {
        return cb();
      }
      if (Date.now() - start > timeout) {
        console.warn("[Bridge] window.Capacitor tidak tersedia setelah " + timeout + "ms");
        return;
      }
      setTimeout(check, 50);
    }
    check();
  }

  waitForCapacitor(function () {
    var isNative = !!(
      window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform()
    );

    console.log("[Bridge] Capacitor siap | native:", isNative);

    // ── Jika BUKAN native (browser biasa / PWA) ──────────────
    // Tidak perlu daftarkan plugin native, WebAuthn yang akan dipakai
    if (!isNative) {
      console.log("[Bridge] Bukan native — skip registrasi BiometricAuth");
      return;
    }

    // ── Jika native: cek apakah plugin sudah terdaftar ───────
    // capacitor.plugins.json sudah mendaftarkan plugin di Java side,
    // Capacitor inject ke window.Capacitor.Plugins otomatis.
    if (window.Capacitor.Plugins && window.Capacitor.Plugins.BiometricAuth) {
      console.log("[Bridge] BiometricAuth sudah terdaftar oleh Capacitor native ✅");
      return;
    }

    // ── Fallback: daftarkan manual jika belum ada ─────────────
    // Daftarkan TANPA web fallback agar native layer yang dipakai
    try {
      var BiometricAuth = window.Capacitor.registerPlugin("BiometricAuth");
      if (!window.Capacitor.Plugins) window.Capacitor.Plugins = {};
      window.Capacitor.Plugins.BiometricAuth = BiometricAuth;
      console.log("[Bridge] BiometricAuth didaftarkan manual ✅");
    } catch (e) {
      console.error("[Bridge] Gagal daftarkan BiometricAuth:", e);
    }
  });

})();
