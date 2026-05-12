// ============================================================
// ABSENSI DESKTOP — preload.js  (REFACTORED)
// Jembatan aman antara web app (renderer) dan Electron (main)
//
// PERUBAHAN UTAMA:
//   • takeScreenshot() sekarang dijalankan di renderer (sini),
//     bukan di main process — fix untuk Electron 17+
//   • Base64 hasil capture dikirim ke main via IpcRenderer
//     hanya untuk diteruskan ke server (main tetap handle HTTP)
// ============================================================

const { contextBridge, ipcRenderer } = require("electron");

// ── Screenshot: minta main process ambil, terima hasilnya via IPC ─
// desktopCapturer di Electron 30 harus dipanggil dari main process
async function captureScreen() {
  const result = await ipcRenderer.invoke("capture-screen");
  if (!result || result.error) throw new Error(result?.error || "Screenshot gagal");
  return result.base64;
}

// ── Loop screenshot di sisi renderer ─────────────────────────
// Main process cukup kirim sinyal "mulai" / "stop", tidak perlu
// memanggil desktopCapturer sendiri.
let ssTimer    = null;
let ssInterval = null;

async function doScreenshot() {
  try {
    const base64 = await captureScreen();
    // Kirim base64 ke main — main akan POST ke server
    ipcRenderer.send("screenshot-data", { image: base64 });
  } catch (e) {
    ipcRenderer.send("screenshot-error", e.message);
  }
}

function startScreenshots(intervalMs = 15 * 60 * 1000, firstDelayMs = 3000) {
  stopScreenshots();
  ssTimer = setTimeout(async () => {
    await doScreenshot();
    ssInterval = setInterval(doScreenshot, intervalMs);
  }, firstDelayMs);
}

function stopScreenshots() {
  if (ssTimer)    { clearTimeout(ssTimer);    ssTimer    = null; }
  if (ssInterval) { clearInterval(ssInterval); ssInterval = null; }
}

// ── Main mengirim sinyal start/stop ke renderer ───────────────
ipcRenderer.on("ss-start", (_e, cfg) => {
  startScreenshots(cfg.intervalMs, cfg.firstDelayMs);
});

ipcRenderer.on("ss-stop", () => {
  stopScreenshots();
});

ipcRenderer.on("ss-take-now", async () => {
  await doScreenshot();
});

// ── Expose API ke halaman web ─────────────────────────────────
contextBridge.exposeInMainWorld("electronAPI", {

  // Flag penanda: ini Electron, bukan browser biasa
  isDesktopApp: true,

  // Dipanggil saat Clock In berhasil di web app
  // data: { username: string, cookie: string }
  clockIn: (data) => {
    ipcRenderer.send("clock-in", data);
  },

  // Dipanggil saat Clock Out berhasil di web app
  clockOut: () => {
    ipcRenderer.send("clock-out");
  },

  // Screenshot manual (opsional)
  takeScreenshotNow: () => {
    ipcRenderer.send("take-screenshot-now");
  },

  // Ambil status dari main process
  getStatus: () => ipcRenderer.invoke("get-status"),

  // Update cookie (dipanggil saat cookie berubah)
  setConfig: (cfg) => {
    ipcRenderer.send("set-config", cfg);
  },
});
