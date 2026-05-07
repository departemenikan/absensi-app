/**
 * wa.js — Modul WhatsApp Notifikasi via Baileys
 * Session disimpan ke Supabase — tidak hilang saat Render restart!
 */

const { default: makeWASocket, useMultiFileAuthState,
        DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const path     = require("path");
const fs       = require("fs");
const https    = require("https");
const pino     = require("pino");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

const AUTH_DIR = path.join("/tmp", "auth_wa");

let sock         = null;
let qrCode       = null;
let isConnected  = false;
let isConnecting = false;
const msgQueue   = [];

// FIX BUG 1: debounce save session — jangan tulis Supabase terlalu sering
let _saveTimer = null;
function debouncedSaveSession(delayMs = 4000) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveSessionToSupabase().catch(e =>
      console.error("[WA] Debounced save error:", e.message)
    );
  }, delayMs);
}

function supaReq(method, spath, body = null) {
  return new Promise((resolve, reject) => {
    const url     = new URL(SUPABASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts    = {
      hostname: url.hostname,
      path:     `/rest/v1/${spath}`,
      method,
      headers: {
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
      },
    };
    if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function saveSessionToSupabase() {
  if (!USE_SUPABASE || !fs.existsSync(AUTH_DIR)) return;
  try {
    const files = fs.readdirSync(AUTH_DIR);
    const sessionData = {};
    for (const file of files) {
      const filePath = path.join(AUTH_DIR, file);
      const content  = fs.readFileSync(filePath, "utf8");
      try { sessionData[file] = JSON.parse(content); }
      catch { sessionData[file] = content; }
    }
    const key        = "wa_session";
    const encodedKey = encodeURIComponent(key);
    const check      = await supaReq("GET", `kv_store?key=eq.${encodedKey}&select=key&limit=1`);
    const exists     = check.status === 200 && check.data && check.data.length > 0;
    if (exists) {
      await supaReq("PATCH", `kv_store?key=eq.${encodedKey}`,
        { value: sessionData, updated_at: new Date().toISOString() });
    } else {
      await supaReq("POST", "kv_store",
        { key, value: sessionData, updated_at: new Date().toISOString() });
    }
    console.log("[WA] Session tersimpan ke Supabase");
  } catch (e) {
    console.error("[WA] Gagal simpan session:", e.message);
  }
}

async function loadSessionFromSupabase() {
  if (!USE_SUPABASE) return false;
  try {
    const encodedKey = encodeURIComponent("wa_session");
    const { status, data } = await supaReq("GET",
      `kv_store?key=eq.${encodedKey}&select=value&limit=1`);
    if (status !== 200 || !data || data.length === 0) {
      console.log("[WA] Tidak ada session di Supabase — perlu scan QR");
      return false;
    }
    const sessionData = data[0].value;
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    for (const [file, content] of Object.entries(sessionData)) {
      const filePath = path.join(AUTH_DIR, file);
      fs.writeFileSync(filePath,
        typeof content === "string" ? content : JSON.stringify(content));
    }
    console.log("[WA] Session dimuat dari Supabase");
    return true;
  } catch (e) {
    console.error("[WA] Gagal load session:", e.message);
    return false;
  }
}

async function deleteSessionFromSupabase() {
  if (!USE_SUPABASE) return;
  try {
    const encodedKey = encodeURIComponent("wa_session");
    await supaReq("DELETE", `kv_store?key=eq.${encodedKey}`);
    console.log("[WA] Session dihapus dari Supabase");
  } catch (e) {
    console.error("[WA] Gagal hapus session:", e.message);
  }
}

function formatNumber(nomor) {
  let n = String(nomor).replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (!n.startsWith("62")) n = "62" + n;
  return n + "@s.whatsapp.net";
}

async function sendWA(nomor, pesan) {
  if (!nomor) return console.warn("[WA] Nomor tidak valid:", nomor);
  const jid = formatNumber(nomor);
  try {
    if (isConnected && sock) {
      await sock.sendMessage(jid, { text: pesan });
      console.log(`[WA] Terkirim ke ${nomor}`);
    } else {
      msgQueue.push({ jid, pesan });
      console.warn(`[WA] Offline, pesan ke ${nomor} masuk antrian (${msgQueue.length})`);
    }
  } catch (e) {
    console.error("[WA] Gagal kirim:", e.message);
  }
}

async function flushQueue() {
  while (msgQueue.length > 0 && isConnected && sock) {
    const { jid, pesan } = msgQueue.shift();
    try {
      await sock.sendMessage(jid, { text: pesan });
      console.log(`[WA] Antrian terkirim ke ${jid}`);
    } catch (e) {
      console.error("[WA] Gagal kirim antrian:", e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

function waStatus() {
  return { connected: isConnected, connecting: isConnecting, hasQR: !!qrCode, queue: msgQueue.length };
}

function getWAQR() { return qrCode; }

// FIX BUG 2: cleanup socket lama sebelum buat koneksi baru
async function cleanupSocket() {
  if (!sock) return;
  try { sock.ev.removeAllListeners(); } catch {}
  try { sock.end(); } catch {}
  sock = null;
  await new Promise(r => setTimeout(r, 1000)); // beri jeda 1 detik sebelum reconnect
}

async function connectWA() {
  if (isConnecting) return;
  isConnecting = true;

  // FIX BUG 2: cleanup socket lama agar tidak ada 2 socket aktif sekaligus
  await cleanupSocket();

  try {
    await loadSessionFromSupabase();
  } catch (e) {
    console.warn("[WA] loadSession error (lanjut):", e.message);
  }

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // FIX BUG 3: update fallback version ke yang lebih baru
  let version;
  try {
    const raceResult = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))
    ]);
    version = raceResult.version;
    console.log("[WA] Versi Baileys:", version.join("."));
  } catch (e) {
    console.warn("[WA] Gagal fetch versi Baileys, pakai fallback:", e.message);
    version = [2, 3000, 1023141470]; // FIX: fallback versi lebih baru
  }

  sock = makeWASocket({
    version,
    auth:                  state,
    logger:                pino({ level: "silent" }),
    browser:               ["Absensi Smart", "Chrome", "1.0"],
    connectTimeoutMs:      30000,
    keepAliveIntervalMs:   15000, // ping setiap 15 detik agar koneksi tidak idle-timeout
    retryRequestDelayMs:   2000,
    maxMsgRetryCount:      3,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode      = qr;
      isConnected = false;
      console.log("[WA] QR baru tersedia — scan di /wa/qr");
    }

    if (connection === "open") {
      isConnected  = true;
      isConnecting = false;
      qrCode       = null;
      console.log("[WA] WhatsApp terhubung!");
      // Simpan session sekali saat connect — tidak perlu debounce di sini
      await saveSessionToSupabase();
      await flushQueue();
    }

    if (connection === "close") {
      isConnected  = false;
      isConnecting = false;
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.warn("[WA] Koneksi terputus, alasan:", reason);

      if (reason === DisconnectReason.loggedOut || reason === 401) {
        console.warn("[WA] Logged out! Hapus session dan scan ulang QR");
        await deleteSessionFromSupabase();
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(connectWA, 5000);
      } else if (reason === 440) {
        // 440 = session conflict — hapus session lokal saja, load ulang dari Supabase
        console.warn("[WA] Session conflict (440) — reload session dari Supabase");
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(connectWA, 8000); // tunggu lebih lama agar WA server settle
      } else {
        setTimeout(connectWA, 5000);
      }
    }
  });

  // FIX BUG 1: pakai debounce — tidak simpan ke Supabase setiap kali creds.update
  sock.ev.on("creds.update", () => {
    saveCreds();
    debouncedSaveSession(4000); // simpan ke Supabase paling cepat 4 detik sekali
  });
}

async function logoutWA() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try { if (sock) sock.ev.removeAllListeners(); } catch {}
  try { if (sock) await sock.logout(); } catch {}
  try { if (sock) sock.end(); } catch {}

  isConnected  = false;
  isConnecting = false;
  sock         = null;
  qrCode       = null;

  await deleteSessionFromSupabase();
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  console.log("[WA] Logout berhasil, sesi dihapus");
  setTimeout(connectWA, 3000);
}

// Jalankan dengan delay 3 detik — beri waktu server Express ready dulu
setTimeout(() => {
  connectWA().catch(e => console.error("[WA] Init error (non-fatal):", e.message));
}, 3000);

module.exports = { sendWA, waStatus, getWAQR, logoutWA };

let sock         = null;
let qrCode       = null;
let isConnected  = false;
let isConnecting = false;
const msgQueue   = [];

function supaReq(method, spath, body = null) {
  return new Promise((resolve, reject) => {
    const url     = new URL(SUPABASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts    = {
      hostname: url.hostname,
      path:     `/rest/v1/${spath}`,
      method,
      headers: {
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
      },
    };
    if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function saveSessionToSupabase() {
  if (!USE_SUPABASE || !fs.existsSync(AUTH_DIR)) return;
  try {
    const files = fs.readdirSync(AUTH_DIR);
    const sessionData = {};
    for (const file of files) {
      const filePath = path.join(AUTH_DIR, file);
      const content  = fs.readFileSync(filePath, "utf8");
      try { sessionData[file] = JSON.parse(content); }
      catch { sessionData[file] = content; }
    }
    const key        = "wa_session";
    const encodedKey = encodeURIComponent(key);
    const check      = await supaReq("GET", `kv_store?key=eq.${encodedKey}&select=key&limit=1`);
    const exists     = check.status === 200 && check.data && check.data.length > 0;
    if (exists) {
      await supaReq("PATCH", `kv_store?key=eq.${encodedKey}`,
        { value: sessionData, updated_at: new Date().toISOString() });
    } else {
      await supaReq("POST", "kv_store",
        { key, value: sessionData, updated_at: new Date().toISOString() });
    }
    console.log("[WA] Session tersimpan ke Supabase");
  } catch (e) {
    console.error("[WA] Gagal simpan session:", e.message);
  }
}

async function loadSessionFromSupabase() {
  if (!USE_SUPABASE) return false;
  try {
    const encodedKey = encodeURIComponent("wa_session");
    const { status, data } = await supaReq("GET",
      `kv_store?key=eq.${encodedKey}&select=value&limit=1`);
    if (status !== 200 || !data || data.length === 0) {
      console.log("[WA] Tidak ada session di Supabase — perlu scan QR");
      return false;
    }
    const sessionData = data[0].value;
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    for (const [file, content] of Object.entries(sessionData)) {
      const filePath = path.join(AUTH_DIR, file);
      fs.writeFileSync(filePath,
        typeof content === "string" ? content : JSON.stringify(content));
    }
    console.log("[WA] Session dimuat dari Supabase");
    return true;
  } catch (e) {
    console.error("[WA] Gagal load session:", e.message);
    return false;
  }
}

async function deleteSessionFromSupabase() {
  if (!USE_SUPABASE) return;
  try {
    const encodedKey = encodeURIComponent("wa_session");
    await supaReq("DELETE", `kv_store?key=eq.${encodedKey}`);
    console.log("[WA] Session dihapus dari Supabase");
  } catch (e) {
    console.error("[WA] Gagal hapus session:", e.message);
  }
}

function formatNumber(nomor) {
  let n = String(nomor).replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (!n.startsWith("62")) n = "62" + n;
  return n + "@s.whatsapp.net";
}

async function sendWA(nomor, pesan) {
  if (!nomor) return console.warn("[WA] Nomor tidak valid:", nomor);
  const jid = formatNumber(nomor);
  try {
    if (isConnected && sock) {
      await sock.sendMessage(jid, { text: pesan });
      console.log(`[WA] Terkirim ke ${nomor}`);
    } else {
      msgQueue.push({ jid, pesan });
      console.warn(`[WA] Offline, pesan ke ${nomor} masuk antrian (${msgQueue.length})`);
    }
  } catch (e) {
    console.error("[WA] Gagal kirim:", e.message);
  }
}

async function flushQueue() {
  while (msgQueue.length > 0 && isConnected && sock) {
    const { jid, pesan } = msgQueue.shift();
    try {
      await sock.sendMessage(jid, { text: pesan });
      console.log(`[WA] Antrian terkirim ke ${jid}`);
    } catch (e) {
      console.error("[WA] Gagal kirim antrian:", e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

function waStatus() {
  return { connected: isConnected, connecting: isConnecting, hasQR: !!qrCode, queue: msgQueue.length };
}

function getWAQR() { return qrCode; }

async function connectWA() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    await loadSessionFromSupabase();
  } catch (e) {
    console.warn("[WA] loadSession error (lanjut):", e.message);
  }

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // Timeout 10 detik — agar tidak hang saat cold start Render
  let version;
  try {
    const raceResult = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))
    ]);
    version = raceResult.version;
  } catch (e) {
    console.warn("[WA] Gagal fetch versi Baileys, pakai fallback:", e.message);
    version = [2, 3000, 1015901307]; // versi stabil fallback
  }

  sock = makeWASocket({
    version,
    auth:    state,
    logger:  pino({ level: "silent" }),
    browser: ["Absensi Smart", "Chrome", "1.0"],
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode      = qr;
      isConnected = false;
      console.log("[WA] QR baru tersedia — scan di /wa/qr");
    }

    if (connection === "open") {
      isConnected  = true;
      isConnecting = false;
      qrCode       = null;
      console.log("[WA] WhatsApp terhubung!");
      await saveSessionToSupabase();
      await flushQueue();
    }

    if (connection === "close") {
      isConnected  = false;
      isConnecting = false;
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.warn("[WA] Koneksi terputus, alasan:", reason);

      if (reason === DisconnectReason.loggedOut || reason === 401) {
        console.warn("[WA] Logged out! Hapus session dan scan ulang QR");
        await deleteSessionFromSupabase();
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(connectWA, 3000);
      } else {
        setTimeout(connectWA, 5000);
      }
    }
  });

  sock.ev.on("creds.update", async () => {
    saveCreds();
    await saveSessionToSupabase();
  });
}

async function logoutWA() {
  try { if (sock) sock.ev.removeAllListeners(); } catch {}
  try { if (sock) await sock.logout(); } catch {}
  try { if (sock) sock.end(); } catch {}

  isConnected  = false;
  isConnecting = false;
  sock         = null;
  qrCode       = null;

  await deleteSessionFromSupabase();
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  console.log("[WA] Logout berhasil, sesi dihapus");
  setTimeout(connectWA, 3000);
}

// Jalankan dengan delay 3 detik — beri waktu server Express ready dulu
// Error tidak akan crash server utama
setTimeout(() => {
  connectWA().catch(e => console.error("[WA] Init error (non-fatal):", e.message));
}, 3000);

module.exports = { sendWA, waStatus, getWAQR, logoutWA };
