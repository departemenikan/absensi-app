// ============================================================
// capacitor-bridge.js
// Daftarkan plugin @aparajita/capacitor-biometric-auth ke
// window.Capacitor.Plugins agar bisa diakses script.js
//
// URUTAN LOAD di index.html (sudah benar):
//   1. @capacitor/core      → window.Capacitor tersedia
//   2. capacitor-bridge.js  → plugin didaftarkan
//   3. script.js            → plugin digunakan
// ============================================================

(function () {
  "use strict";

  if (!window.Capacitor) {
    console.log("[Bridge] Bukan Capacitor native, plugin tidak didaftarkan.");
    return;
  }

  const { registerPlugin } = window.Capacitor;

  if (typeof registerPlugin !== "function") {
    console.warn("[Bridge] registerPlugin tidak tersedia.");
    return;
  }

  // ── Daftarkan @aparajita/capacitor-biometric-auth ────────────
  // Install:
  //   npm install @aparajita/capacitor-biometric-auth
  //   npx cap sync android
  //
  // AndroidManifest.xml:
  //   <uses-permission android:name="android.permission.USE_BIOMETRIC" />
  // ─────────────────────────────────────────────────────────────
  const BiometricAuth = registerPlugin("BiometricAuth", {
    // Fallback web agar script.js tidak crash di browser biasa
    web: () => ({
      checkBiometry: async () => ({
        isAvailable: false,
        strongBiometryIsAvailable: false,
        biometryType: 0,
        biometryTypes: [],
        deviceIsSecure: false,
        reason: "Not supported in browser",
        code: "biometryNotAvailable",
      }),
      authenticate: async () => {
        throw Object.assign(
          new Error("Biometric not supported in browser"),
          { code: -1 }
        );
      },
    }),
  });

  if (!window.Capacitor.Plugins) window.Capacitor.Plugins = {};
  window.Capacitor.Plugins.BiometricAuth = BiometricAuth;

  const isNative = window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  console.log("[Bridge] BiometricAuth terdaftar | native:", isNative);

})();
