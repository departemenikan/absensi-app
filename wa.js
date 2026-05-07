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
      // Flush antrian beberapa kali agar pesan yang masuk saat connecting terkirim
      await flushQueue();
      setTimeout(flushQueue, 3000);
      setTimeout(flushQueue, 8000);
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

// Safety net: flush antrian setiap 30 detik jika WA sudah konek
setInterval(() => {
  if (isConnected && msgQueue.length > 0) {
    console.log(`[WA] Auto-flush antrian: ${msgQueue.length} pesan`);
    flushQueue().catch(() => {});
  }
}, 30000);

module.exports = { sendWA, waStatus, getWAQR, logoutWA };
