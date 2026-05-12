// ============================================================
// MODIFIKASI script.js — Integrasi Electron
// File: ABSENSI-APP/public/script.js
// ============================================================
// Cukup 3 perubahan kecil di fungsi sendAbsen()
// ============================================================


// ============================================================
// PERUBAHAN 1 — Ganti blok screen share saat Clock In
// ============================================================
// CARI baris ini (sekitar baris 956-964):

/*
    // ── Screen share: wajib jika fitur aktif & browser support & desktop ───
    if (type === "IN" && _ssFeatureEnabled && ssIsSupported()) {
      const ssOk = await ssRequestScreen();
      if (!ssOk) {
        showToast("❌ Clock In dibatalkan. Izin berbagi layar diperlukan.", "error", 6000);
        [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
        setTimeout(async () => { await ssRequestScreen(); }, 1200);
        return;
      }
    }
*/

// GANTI DENGAN:

/*
    // ── Screen share / Screenshot ─────────────────────────────
    if (type === "IN") {
      if (window.__ELECTRON_APP__) {
        // Desktop App: screenshot otomatis via Electron (tanpa popup)
        window.electronAPI.clockIn({ username: user, cookie: document.cookie });
      } else if (_ssFeatureEnabled && ssIsSupported()) {
        // Browser biasa: pakai getDisplayMedia (muncul popup izin)
        const ssOk = await ssRequestScreen();
        if (!ssOk) {
          showToast("❌ Clock In dibatalkan. Izin berbagi layar diperlukan.", "error", 6000);
          [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
          setTimeout(async () => { await ssRequestScreen(); }, 1200);
          return;
        }
      }
    }
*/


// ============================================================
// PERUBAHAN 2 — Ganti ssStop() saat Clock Out
// ============================================================
// CARI baris ini (sekitar baris 967-968):

/*
    // Hentikan screenshot saat Clock Out
    if (type === "OUT") ssStop();
*/

// GANTI DENGAN:

/*
    // Hentikan screenshot saat Clock Out
    if (type === "OUT") {
      if (window.__ELECTRON_APP__) {
        window.electronAPI.clockOut();
      } else {
        ssStop();
      }
    }
*/


// ============================================================
// PERUBAHAN 3 — Ganti ssStart() setelah Clock In berhasil
// ============================================================
// CARI baris ini (sekitar baris 999):

/*
      if (type === "IN" && _ssFeatureEnabled) ssStart();
*/

// GANTI DENGAN:

/*
      if (type === "IN" && _ssFeatureEnabled && !window.__ELECTRON_APP__) ssStart();
*/


// ============================================================
// SELESAI — Tidak ada perubahan lain yang dibutuhkan
// ============================================================
