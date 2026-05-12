// ============================================================
// PATCH script.js — Integrasi Electron Desktop App
// ============================================================
// Tempel kode ini di script.js Anda, di bagian ABSENSI
// tepatnya setelah baris: if (type === "IN" && _ssFeatureEnabled && ssIsSupported()) {
//
// ATAU: cari fungsi sendAbsen() dan ganti blok screenshot-nya
// ============================================================

// ── 1. Deteksi apakah berjalan di Electron ─────────────────
// Tambahkan di bagian atas script.js (setelah deklarasi let/const)

function isElectron() {
  return !!(window.electronAPI && window.electronAPI.isDesktopApp);
}

// ── 2. Fungsi kirim cookie ke Electron ─────────────────────
// Cookie dibutuhkan agar main process bisa kirim screenshot ke server
// dengan autentikasi yang benar

function getSessionCookie() {
  // Ambil semua cookie halaman ini
  return document.cookie || "";
}

// ── 3. Ganti blok Clock In di sendAbsen() ──────────────────
//
// CARI baris ini di sendAbsen() (sekitar baris 956-999):
//
//   if (type === "IN" && _ssFeatureEnabled && ssIsSupported()) {
//     const ssOk = await ssRequestScreen();
//     ...
//   }
//   ...
//   if (type === "IN" && _ssFeatureEnabled) ssStart();
//
// GANTI DENGAN:

/*
    // ── Screen share / Screenshot ────────────────────────────
    if (type === "IN") {
      if (isElectron()) {
        // ✅ Mode Desktop App — screenshot via Electron (silent, tanpa popup share layar)
        window.electronAPI.clockIn({
          username: user,
          cookie:   getSessionCookie(),
        });
        console.log("[Electron] clockIn dikirim ke main process");

      } else if (_ssFeatureEnabled && ssIsSupported()) {
        // 🌐 Mode Browser biasa — pakai getDisplayMedia (perlu popup izin)
        const ssOk = await ssRequestScreen();
        if (!ssOk) {
          showToast("❌ Clock In dibatalkan. Izin berbagi layar diperlukan.", "error", 6000);
          [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
          return;
        }
      }
    }

    // ── Clock Out ────────────────────────────────────────────
    if (type === "OUT") {
      if (isElectron()) {
        window.electronAPI.clockOut();
        console.log("[Electron] clockOut dikirim ke main process");
      } else {
        ssStop();
      }
    }
*/

// ── 4. Setelah d.status === "OK" ───────────────────────────
//
// CARI baris ini (sekitar baris 999):
//   if (type === "IN" && _ssFeatureEnabled) ssStart();
//
// GANTI DENGAN:
//   if (type === "IN" && _ssFeatureEnabled && !isElectron()) ssStart();
//   // (Electron sudah handle sendiri via IPC di atas)

// ── 5. Opsional: tampilkan badge "Desktop App" di UI ───────
// Tempel di fungsi enterApp() atau setelah login berhasil

function showElectronBadge() {
  if (!isElectron()) return;
  // Tambahkan badge kecil di header agar karyawan tahu mereka pakai desktop app
  const header = document.querySelector(".app-header, header, #header, .header");
  if (!header) return;
  const badge = document.createElement("span");
  badge.textContent  = "🖥 Desktop";
  badge.style.cssText = `
    background: #27ae60;
    color: white;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 20px;
    margin-left: 8px;
    vertical-align: middle;
    letter-spacing: 0.5px;
  `;
  header.appendChild(badge);
}

// Panggil setelah app masuk:
// showElectronBadge();

// ── 6. Update cookie saat berpindah halaman ────────────────
// Tempel di fungsi openView() atau navTo()

function syncCookieToElectron() {
  if (!isElectron()) return;
  window.electronAPI.setConfig({ cookie: getSessionCookie() });
}

// Tambahkan di awal openView():
// syncCookieToElectron();
