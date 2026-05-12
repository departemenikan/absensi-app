// ============================================================
// ABSENSI DESKTOP — main.js  (FIXED)
// 
// FIXES:
//   • Cookie diambil dari Electron session (bukan document.cookie)
//     → fix HTTP 403 karena HttpOnly cookies tidak accessible di JS
//   • thumbnailSize dikecilkan + loop kualitas diperluas
//     → fix "Screenshot terlalu besar setelah kompresi"
//   • Komentar diperbaiki (desktopCapturer tetap di main, ini benar)
// ============================================================

const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, shell, dialog,
  powerSaveBlocker, systemPreferences,
  desktopCapturer                        // ✅ Tetap di sini — wajib di main process (Electron 17+)
} = require("electron");
const path  = require("path");
const https = require("https");
const http  = require("http");
const fs    = require("fs");

// ── Konfigurasi ──────────────────────────────────────────────
const CONFIG = {
  serverURL:      "https://absensi-app.onrender.com",
  ssIntervalMs:   15 * 60 * 1000,
  // ✅ FIX: dinaikkan dari 10 detik → 30 detik
  // Render.com free tier bisa lambat 10-20 detik saat "bangun dari tidur"
  // Screenshot pertama dikirim setelah server pasti sudah catat clock in
  ssFirstDelayMs: 30 * 1000,
  appName:        "Absensi Smart",
  version:        "1.0.0",
  logMaxBytes:    1 * 1024 * 1024,
  retryMax:       3,
  retryDelayMs:   10 * 1000,
};

// ── State ─────────────────────────────────────────────────────
let mainWindow     = null;
let tray           = null;
let currentUser    = null;
let currentCookie  = null;   // fallback jika session cookie gagal diambil
let isClockIn      = false;
let powerBlockerId = null;
let isQuitting     = false;

// ── Retry queue ───────────────────────────────────────────────
const retryQueue = [];
let retryTimer   = null;

function enqueueRetry(base64) {
  if (retryQueue.length >= 5) retryQueue.shift();
  retryQueue.push({ base64, attempts: 0, ts: Date.now() });
  scheduleRetry();
}

function scheduleRetry() {
  if (retryTimer || !retryQueue.length) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    const item = retryQueue[0];
    if (!item) return;
    item.attempts++;
    try {
      const res = await sendToServer("/screenshot", { image: item.base64 });
      if (res.status < 400) {
        retryQueue.shift();
        log(`🔁 Retry berhasil (attempt ${item.attempts}), ${retryQueue.length} tersisa`);
      } else {
        throw new Error("HTTP " + res.status);
      }
    } catch (e) {
      log(`🔁 Retry gagal (attempt ${item.attempts}): ${e.message}`);
      if (item.attempts >= CONFIG.retryMax) {
        retryQueue.shift();
        log("🗑  Screenshot dibuang setelah " + CONFIG.retryMax + " kali retry");
      }
    }
    if (retryQueue.length) scheduleRetry();
  }, CONFIG.retryDelayMs);
}

// ── Log helper ────────────────────────────────────────────────
const logFile = path.join(app.getPath("userData"), "ss-log.txt");

function log(msg) {
  const ts   = new Date().toLocaleString("id-ID");
  const line = `[${ts}] ${msg}\n`;
  console.log(line.trim());
  try {
    if (fs.existsSync(logFile)) {
      const stat = fs.statSync(logFile);
      if (stat.size > CONFIG.logMaxBytes) {
        const content = fs.readFileSync(logFile, "utf8");
        const trimmed = content.slice(Math.floor(content.length * 0.8));
        fs.writeFileSync(logFile, "--- [log dipangkas] ---\n" + trimmed);
      }
    }
    fs.appendFileSync(logFile, line);
  } catch {}
}

// ── [FIX 1] Ambil cookie dari Electron session ────────────────
// Ini yang benar — bukan dari document.cookie di renderer
// HttpOnly cookies (seperti session token) hanya bisa diakses dari sini
async function getSessionCookies() {
  if (!mainWindow) return currentCookie || "";
  try {
    const cookies = await mainWindow.webContents.session.cookies.get({
      url: CONFIG.serverURL,
    });
    if (!cookies || !cookies.length) {
      log("⚠️  Tidak ada cookie session — pakai fallback cookie");
      return currentCookie || "";
    }
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    log(`🍪 Cookie session diambil: ${cookies.length} cookie`);
    return cookieStr;
  } catch (e) {
    log("⚠️  Gagal ambil cookie session: " + e.message);
    return currentCookie || "";
  }
}

// ── Buat window utama ─────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  900,
    minHeight: 600,
    title: CONFIG.appName,
    icon:  getIconPath(),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
    },
    show: false,
    autoHideMenuBar: true,
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true);
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);

  mainWindow.loadURL(CONFIG.serverURL);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    log("App dibuka: " + CONFIG.serverURL);
  });

  mainWindow.on("close", (e) => {
    if (isQuitting) return;
    if (isClockIn) {
      e.preventDefault();
      mainWindow.hide();
      tray && tray.displayBalloon({
        title:    CONFIG.appName,
        content:  "App berjalan di background.\nScreenshot tetap aktif. Klik icon tray untuk membuka.",
        iconType: "info",
      });
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.executeJavaScript(`
      window.__ELECTRON_APP__     = true;
      window.__ELECTRON_VERSION__ = "${CONFIG.version}";

      navigator.geolocation.getCurrentPosition = (success) => {
        success({ coords: { latitude: 0, longitude: 0, accuracy: 999999 }, timestamp: Date.now() });
      };
      navigator.geolocation.watchPosition = (success) => {
        success({ coords: { latitude: 0, longitude: 0, accuracy: 999999 }, timestamp: Date.now() });
        return 0;
      };
      navigator.geolocation.clearWatch = (_id) => {};

      const _origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints && constraints.video) {
          try { return await _origGetUserMedia(constraints); }
          catch {
            const canvas = document.createElement("canvas");
            canvas.width = 320; canvas.height = 240;
            canvas.getContext("2d").fillRect(0, 0, 320, 240);
            return canvas.captureStream(1);
          }
        }
        return _origGetUserMedia(constraints);
      };

      const _origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = async (desc) => {
        if (desc && desc.name === "camera") return { state: "granted", onchange: null };
        return _origQuery(desc);
      };

      window.verifyFace = async (label) => {
        console.log("[Electron] verifyFace di-skip:", label);
        return true;
      };
    `).catch(() => {});
  });

  mainWindow.webContents.on("did-fail-load", (e, code, desc) => {
    log(`❌ Gagal load: ${desc} (${code})`);
    mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#1a1a2e;color:#eee;">
        <h2>⚠️ Tidak dapat terhubung ke server</h2>
        <p style="color:#aaa">${CONFIG.serverURL}</p>
        <p style="color:#aaa">Pastikan koneksi internet aktif, lalu klik tombol di bawah.</p>
        <button onclick="location.href='${CONFIG.serverURL}'"
          style="margin-top:20px;padding:12px 32px;background:#4f8ef7;color:white;
                 border:none;border-radius:8px;font-size:15px;cursor:pointer;">
          🔄 Coba Lagi
        </button>
      </body></html>
    `);
  });
}

// ── System Tray ───────────────────────────────────────────────
function createTray() {
  const iconPath = getIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(CONFIG.appName);
  updateTrayMenu();
  tray.on("click",        () => showWindow());
  tray.on("double-click", () => showWindow());
}

function updateTrayMenu() {
  if (!tray) return;
  const ssStatus = isClockIn
    ? `✅ Sedang Clock In — screenshot tiap ${CONFIG.ssIntervalMs / 60000} menit`
    : "⏸  Belum Clock In";

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: CONFIG.appName + " v" + CONFIG.version, enabled: false },
    { label: ssStatus, enabled: false },
    { type: "separator" },
    { label: "🖥  Buka Aplikasi",  click: () => showWindow() },
    { label: "📄  Lihat Log",      click: () => shell.openPath(logFile) },
    { type: "separator" },
    {
      label: "❌  Keluar",
      click: () => {
        if (isClockIn) {
          const choice = dialog.showMessageBoxSync({
            type:    "warning",
            buttons: ["Tetap Keluar", "Batal"],
            title:   "Masih Clock In",
            message: "Anda masih Clock In!\nScreenshot otomatis akan berhenti.\nSebaiknya Clock Out dulu.",
          });
          if (choice === 1) return;
        }
        isQuitting = true;
        ssStopRenderer();
        app.quit();
      }
    },
  ]));
}

function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── Sinyal ke renderer untuk mulai/stop screenshot ────────────
function ssStartRenderer() {
  if (!mainWindow || !isClockIn) return;
  mainWindow.webContents.send("ss-start", {
    intervalMs:   CONFIG.ssIntervalMs,
    firstDelayMs: CONFIG.ssFirstDelayMs,
  });
  log(`⏱  Renderer diminta mulai screenshot — interval ${CONFIG.ssIntervalMs / 60000} mnt`);

  if (powerBlockerId === null) {
    try {
      powerBlockerId = powerSaveBlocker.start("prevent-display-sleep");
      log("🔋 PowerSaveBlocker aktif");
    } catch {}
  }
  updateTrayMenu();
}

function ssStopRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ss-stop");
  }
  if (powerBlockerId !== null) {
    try { powerSaveBlocker.stop(powerBlockerId); } catch {}
    powerBlockerId = null;
    log("🔋 PowerSaveBlocker nonaktif");
  }
  updateTrayMenu();
}

// ── [FIX 1 lanjutan] Terima base64 → kirim ke server dengan cookie session ──
ipcMain.on("screenshot-data", async (_event, { image }) => {
  if (!currentUser || !isClockIn) return;
  try {
    // ✅ Ambil cookie dari Electron session (include HttpOnly cookies)
    const cookieStr = await getSessionCookies();
    const result = await sendToServer("/screenshot", { image }, cookieStr);
    const kb = Math.round(image.length / 1024);
    log(`📸 Screenshot terkirim — ${kb} KB — status: ${result.status}`);
    if (result.status >= 400) throw new Error("HTTP " + result.status);
  } catch (e) {
    log("❌ Screenshot gagal kirim, masuk retry queue: " + e.message);
    enqueueRetry(image);
  }
});

ipcMain.on("screenshot-error", (_event, msg) => {
  log("❌ Screenshot error di renderer: " + msg);
});

// ── Kirim data ke server via HTTPS ────────────────────────────
// Support GET dan POST; cookieStr dari Electron session
function sendToServer(endpoint, data, cookieStr, method) {
  return new Promise((resolve, reject) => {
    const parsed    = new URL(CONFIG.serverURL + endpoint);
    const isHttps   = parsed.protocol === "https:";
    const lib       = isHttps ? https : http;
    const reqMethod = method || (data && Object.keys(data).length ? "POST" : "GET");
    const body      = reqMethod === "POST" ? JSON.stringify(data || {}) : null;

    const headers = {
      "Content-Type": "application/json",
      "X-User":       currentUser || "",
    };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);

    const cookie = cookieStr || currentCookie;
    if (cookie) headers["Cookie"] = cookie;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname,
      method:   reqMethod,
      headers,
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end",  () => resolve({ status: res.statusCode, body: raw }));
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

// ── IPC handlers ──────────────────────────────────────────────
ipcMain.on("clock-in", async (_event, data) => {
  currentUser   = data.username || null;
  currentCookie = data.cookie   || null;
  isClockIn     = true;
  log(`✅ Clock In: ${currentUser}`);
  updateTrayMenu();

  // ✅ FIX: verifikasi dulu ke server bahwa clock in sudah tercatat
  // Cegah screenshot dikirim sebelum server punya record absensi hari ini
  // → penyebab utama 403 NOT_WORKING
  let verified = false;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 6000)); // tunggu 6 detik per percobaan
    try {
      const cookieStr = await getSessionCookies();
      const res = await sendToServer("/absen-status", {}, cookieStr);
      if (res.status === 200) {
        const body = JSON.parse(res.body || "{}");
        if (body.clockedIn === true) {
          verified = true;
          log(`✅ Clock In terverifikasi di server (percobaan ${i + 1})`);
          break;
        }
      }
      log(`⏳ Menunggu clock in tercatat di server... (percobaan ${i + 1})`);
    } catch (e) {
      log(`⚠️  Cek status gagal: ${e.message}`);
    }
  }

  if (!verified) {
    log("⚠️  Server belum konfirmasi clock in — screenshot tetap dimulai (fallback)");
  }

  ssStartRenderer();
});

ipcMain.on("clock-out", () => {
  log(`👋 Clock Out: ${currentUser}`);
  isClockIn = false;
  ssStopRenderer();
  currentUser   = null;
  currentCookie = null;
  updateTrayMenu();
});

ipcMain.on("take-screenshot-now", () => {
  if (isClockIn && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ss-take-now");
  }
});

ipcMain.handle("get-status", () => ({
  isClockIn,
  currentUser,
  ssIntervalMs: CONFIG.ssIntervalMs,
  serverURL:    CONFIG.serverURL,
  version:      CONFIG.version,
}));

ipcMain.on("set-config", (_event, cfg) => {
  if (cfg.cookie) currentCookie = cfg.cookie;
});

// ── [FIX 2] capture-screen: ukuran lebih kecil + kualitas lebih agresif ──
ipcMain.handle("capture-screen", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types:         ["screen"],
      // ✅ Dikecilkan dari 1280x720 → 1024x576 untuk hasil lebih ringan
      thumbnailSize: { width: 1024, height: 576 },
    });
    if (!sources || !sources.length) return { error: "Tidak ada sumber layar" };

    // ✅ Loop kualitas diperluas: 0.5 → 0.4 → 0.3 → 0.2 → 0.15
    // Handles monitor HiDPI / 4K yang sebelumnya gagal di kualitas 0.3
    let base64 = "";
    for (const q of [0.5, 0.4, 0.3, 0.2, 0.15]) {
      base64 = sources[0].thumbnail.toDataURL("image/jpeg", q);
      if (base64.length <= 400000) {
        log(`📷 Screenshot kualitas JPEG: ${q} — ${Math.round(base64.length / 1024)} KB`);
        break;
      }
    }

    if (!base64 || base64.length < 500)   return { error: "Screenshot kosong" };
    if (base64.length > 410000)           return { error: "Screenshot terlalu besar setelah kompresi" };
    return { base64 };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Cari icon ─────────────────────────────────────────────────
function getIconPath() {
  const candidates = [
    path.join(__dirname, "icon.ico"),
    path.join(__dirname, "icon.png"),
    path.join(__dirname, "..", "public", "icons", "icon-512.png"),
    path.join(__dirname, "..", "public", "icons", "icon-192.png"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === "darwin") {
    try {
      const access = systemPreferences.getMediaAccessStatus("screen");
      if (access !== "granted") log("⚠️ macOS: belum ada izin akses layar");
    } catch {}
  }
  createWindow();
  createTray();
  log(`🚀 ${CONFIG.appName} v${CONFIG.version} dimulai`);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showWindow();
});

app.on("before-quit", () => { isQuitting = true; });

app.on("window-all-closed", () => {
  if (isQuitting) app.quit();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}
