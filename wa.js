/**
 * wa.js — Modul WhatsApp Notifikasi via Baileys
 * Gratis, tidak perlu API key, cukup scan QR sekali
 *
 * Cara pakai di server.js:
 *   const { sendWA, waStatus, getWAQR } = require("./wa");
 */

const { default: makeWASocket, useMultiFileAuthState,
        DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const path     = require("path");
const fs       = require("fs");
const pino     = require("pino");

// ── Simpan sesi di folder auth_wa (tidak hilang saat Railway restart) ──────
const AUTH_DIR = path.join(__dirname, "auth_wa");

let sock        = null;
let qrCode      = null;   // string QR terbaru (untuk ditampilkan di /wa/qr)
let isConnected = false;
let isConnecting = false;
const msgQueue  = [];     // antrian pesan saat sedang reconnect

// ── Format nomor ke format WA (62xxx@s.whatsapp.net) ────────────────────────
function formatNumber(nomor) {
  let n = String(nomor).replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (!n.startsWith("62")) n = "62" + n;
  return n + "@s.whatsapp.net";
}

// ── Kirim pesan WA ───────────────────────────────────────────────────────────
async function sendWA(nomor, pesan) {
  if (!nomor) return console.warn("[WA] Nomor tidak valid:", nomor);
  const jid = formatNumber(nomor);
  try {
    if (isConnected && sock) {
      await sock.sendMessage(jid, { text: pesan });
      console.log(`[WA] ✅ Terkirim ke ${nomor}`);
    } else {
      // Simpan ke antrian, kirim saat koneksi pulih
      msgQueue.push({ jid, pesan });
      console.warn(`[WA] ⏳ Offline, pesan ke ${nomor} masuk antrian (${msgQueue.length})`);
    }
  } catch (e) {
    console.error("[WA] Gagal kirim:", e.message);
  }
}

// ── Kirim antrian yang tersimpan ─────────────────────────────────────────────
async function flushQueue() {
  while (msgQueue.length > 0 && isConnected && sock) {
    const { jid, pesan } = msgQueue.shift();
    try {
      await sock.sendMessage(jid, { text: pesan });
      console.log(`[WA] ✅ Antrian terkirim ke ${jid}`);
    } catch (e) {
      console.error("[WA] Gagal kirim antrian:", e.message);
    }
    // Jeda 500ms antar pesan agar tidak dianggap spam
    await new Promise(r => setTimeout(r, 500));
  }
}

// ── Status koneksi (untuk endpoint /wa/status) ───────────────────────────────
function waStatus() {
  return {
    connected:  isConnected,
    connecting: isConnecting,
    hasQR:      !!qrCode,
    queue:      msgQueue.length,
  };
}

// ── Ambil QR terbaru (untuk endpoint /wa/qr) ─────────────────────────────────
function getWAQR() { return qrCode; }

// ── Inisialisasi koneksi Baileys ──────────────────────────────────────────────
async function connectWA() {
  if (isConnecting) return;
  isConnecting = true;

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth:   state,
    logger: pino({ level: "silent" }), // matikan log Baileys agar terminal bersih
    browser: ["Absensi Smart", "Chrome", "1.0"],
  });

  // ── Event: QR code baru ────────────────────────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode      = qr;
      isConnected = false;
      console.log("[WA] 📱 QR baru tersedia — scan di /wa/qr atau lihat terminal");
    }

    if (connection === "open") {
      isConnected  = true;
      isConnecting = false;
      qrCode       = null;
      console.log("[WA] ✅ WhatsApp terhubung!");
      await flushQueue();
    }

    if (connection === "close") {
      isConnected  = false;
      isConnecting = false;
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.warn("[WA] ❌ Koneksi terputus, alasan:", reason);

      if (reason === DisconnectReason.loggedOut) {
        // Logout manual atau dari HP — hapus sesi, perlu scan ulang
        console.warn("[WA] ⚠️  Logged out! Hapus auth_wa dan scan ulang QR");
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(connectWA, 3000);
      } else {
        // Error lain (network, timeout, dll) — reconnect otomatis
        setTimeout(connectWA, 5000);
      }
    }
  });

  // ── Simpan credentials saat update ────────────────────────────────────────
  sock.ev.on("creds.update", saveCreds);
}

// ── Logout manual (untuk endpoint /wa/logout) ────────────────────────────────
async function logoutWA() {
  try {
    if (sock) await sock.logout();
  } catch {}
  isConnected  = false;
  isConnecting = false;
  sock         = null;
  qrCode       = null;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  console.log("[WA] 🔓 Logout berhasil, sesi dihapus");
  // Reconnect untuk tampilkan QR baru
  setTimeout(connectWA, 1000);
}

// ── Mulai koneksi saat modul di-require ──────────────────────────────────────
connectWA().catch(e => console.error("[WA] Init error:", e.message));

module.exports = { sendWA, waStatus, getWAQR, logoutWA };
