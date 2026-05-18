// Timezone default — di-override dari DB setelah loadAll
process.env.TZ = process.env.TZ || "Asia/Makassar";

// Helper: tanggal hari ini dalam timezone server (lokal), format YYYY-MM-DD
// Wajib pakai ini (bukan toISOString) agar tidak geser 1 hari di WITA
function todayLocal() {
  return new Date().toLocaleDateString("sv-SE");
}

// Helper: normalisasi timestamp masuk dari client menjadi ISO UTC string
// Menerima format: ISO UTC ("...Z"), ISO dengan offset ("+08:00"), atau tanpa TZ ("2026-05-04T08:46:00")
// Yang tanpa TZ dianggap sebagai waktu lokal server (WITA/UTC+8)
function normalizeTime(str) {
  if (!str) return str;
  const d = new Date(str);
  if (isNaN(d.getTime())) return str; // kembalikan apa adanya jika tidak bisa parse
  return d.toISOString(); // simpan selalu sebagai UTC ISO
}

const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const bcrypt   = require("bcryptjs");
const webpush  = require("web-push");
const app      = express();
const { dbLoad, dbSave, migrateFromTmp, USE_SUPABASE, bucketUpload, bucketDelete, bucketDeleteMany, bucketSignedUrl, base64ToBuffer } = require("./db");
const { sendWA, waStatus, getWAQR, logoutWA } = require("./wa");

// ── Fonnte WA API — hanya untuk notif penting (cuti) ─────────────────────────
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || ""; // wajib set FONNTE_TOKEN di env var Render
async function sendFonnte(nomor, pesan) {
  if (!nomor) return;
  try {
    const https = require("https");
    let n = String(nomor).replace(/\D/g, "");
    if (n.startsWith("0")) n = "62" + n.slice(1);
    if (!n.startsWith("62")) n = "62" + n;
    const body = JSON.stringify({ target: n, message: pesan, countryCode: "62" });
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.fonnte.com",
        path: "/send",
        method: "POST",
        headers: {
          "Authorization": FONNTE_TOKEN,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      }, res => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => {
          console.log("[Fonnte] Terkirim ke", nomor, "|", raw);
          resolve();
        });
      });
      req.on("error", e => { console.error("[Fonnte] Error:", e.message); resolve(); });
      req.write(body);
      req.end();
    });
  } catch(e) {
    console.error("[Fonnte] Gagal kirim:", e.message);
  }
}

const BCRYPT_ROUNDS = 10;

const PORT     = process.env.PORT || 3000;
// App berjalan di Render — Supabase sebagai storage utama, /tmp hanya untuk migrasi data lama
const DATA_DIR = "/tmp";

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// ── Health check — untuk UptimeRobot (tidak butuh auth) ──────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "OK", time: new Date().toISOString() });
});

// ── Halaman Admin Go-Live — URL rahasia, tidak muncul di menu aplikasi ────────
// Akses: https://your-app.onrender.com/admin-golive
// Proteksi: login username+password Owner dilakukan di sisi halaman HTML itu sendiri
app.get("/admin-golive", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-golive.html"));
});

// ========================
// ADMIN GO-LIVE TOOLS — hanya Owner (level 1)
// ========================

// ── RESET DATA UJI COBA ───────────────────────────────────────────────────────
// POST /admin/reset-data-uji-coba
// Menghapus seluruh data absensi, tracking, cuti, screenshot, dll.
// Master data (users, areas, groups, kebijakan, dll) TIDAK ikut terhapus.
// Body: { "konfirmasi": "HAPUS SEMUA DATA" }
app.post("/admin/reset-data-uji-coba", requireLevel(1), (req, res) => {
  const { konfirmasi } = req.body;
  if (konfirmasi !== "HAPUS SEMUA DATA") {
    return res.status(400).json({
      status: "GAGAL",
      pesan: "Konfirmasi salah. Kirim: { \"konfirmasi\": \"HAPUS SEMUA DATA\" }"
    });
  }

  // Data yang dihapus: semua record operasional
  save(F.data,            []);   // absensi
  save(F.tracking,        {});   // GPS tracking
  save(F.aktivitas,       []);   // log aktivitas
  save(F.screenshots,     {});   // screenshot
  save(F.workPhotos,      {});   // foto kerja
  save(F.pengajuanCuti,   []);   // pengajuan cuti
  save(F.kuotaCuti,       {});   // saldo cuti & overtime
  save(F.sessions,        {});   // sesi login

  // Master data yang TIDAK dihapus:
  // users, areas, groups, divisi, rules, appSettings,
  // libur, kebijakanCuti, aktivitasKustom, pushSubs, webauthn

  console.log(`[RESET] ✅ Data uji coba dihapus oleh: ${req._requester} @ ${new Date().toISOString()}`);
  res.json({
    status: "OK",
    pesan: "Semua data operasional berhasil dihapus. Master data tetap aman.",
    dihapus: ["data (absensi)", "tracking (GPS)", "aktivitas", "screenshots", "work_photos", "pengajuan_cuti", "kuota_cuti", "sessions"],
    aman: ["users", "areas", "groups", "divisi", "rules", "app_settings", "libur", "kebijakan_cuti", "aktivitas_kustom", "push_subscriptions", "webauthn"]
  });
});

// ── IMPORT SALDO AWAL DARI JIBBLE ────────────────────────────────────────────
// POST /admin/import-saldo-awal
// Mengisi sisa cuti tahunan & saldo overtime dari sistem lama (misal: Jibble).
// Saldo masuk sebagai "carry over" — tidak menimpa kuota tahunan yang sudah ada.
// Body:
// {
//   "konfirmasi": "IMPORT SALDO AWAL",
//   "tahun": 2025,                        // opsional, default tahun sekarang
//   "data": [
//     { "username": "budi",  "sisaCuti": 9,  "sisaOvertime": 12.5 },
//     { "username": "sari",  "sisaCuti": 7,  "sisaOvertime": 0    },
//     { "username": "agus",  "sisaCuti": 11, "sisaOvertime": 4.25 }
//   ]
// }
app.post("/admin/import-saldo-awal", requireLevel(1), (req, res) => {
  const { konfirmasi, data: importData, tahun: tahunInput } = req.body;

  if (konfirmasi !== "IMPORT SALDO AWAL") {
    return res.status(400).json({
      status: "GAGAL",
      pesan: "Konfirmasi salah. Kirim: { \"konfirmasi\": \"IMPORT SALDO AWAL\" }"
    });
  }
  if (!Array.isArray(importData) || importData.length === 0) {
    return res.status(400).json({ status: "GAGAL", pesan: "Field 'data' harus berupa array dan tidak boleh kosong." });
  }

  const tahun     = String(tahunInput || new Date().getFullYear());
  const tanggal   = new Date().toLocaleDateString("sv-SE");
  const kuota     = load(F.kuotaCuti, {});
  const users     = load(F.users, {});
  const hasil     = [];
  const tidakDitemukan = [];

  importData.forEach(({ username, sisaCuti, sisaOvertime }) => {
    // Validasi username ada di sistem
    if (!users[username]) {
      tidakDitemukan.push(username);
      return;
    }

    if (!kuota[username])        kuota[username] = {};
    if (!kuota[username][tahun]) kuota[username][tahun] = {};

    const k = kuota[username][tahun];

    // Sisa cuti: simpan sebagai jatah carry-over
    // Jika sudah ada kuota tahunan, tambahkan sebagai bonus; jika belum, buat baru
    const cutiVal = parseFloat(sisaCuti) || 0;
    if (cutiVal > 0) {
      if (k.tahunan) {
        // Sudah ada kuota → tambahkan carry-over sebagai bonus di atas jatah
        k.tahunan.carryOver  = parseFloat(((k.tahunan.carryOver || 0) + cutiVal).toFixed(2));
        k.tahunan.keterangan = (k.tahunan.keterangan || "") + ` | Carry-over Jibble: +${cutiVal} hari (${tanggal})`;
      } else {
        // Belum ada → buat entry saldo awal
        k.tahunan = {
          jatah:       cutiVal,
          terpakai:    0,
          carryOver:   0,
          keterangan:  `Saldo awal migrasi Jibble (${tanggal})`
        };
      }
    }

    // Saldo overtime: masuk sebagai jamCarryOver
    const otVal = parseFloat(sisaOvertime) || 0;
    if (otVal > 0) {
      if (!k.overtime) {
        k.overtime = {
          jamTL_reguler: 0,
          jamCarryOver:  0,
          jamTerpakai:   0,
          riwayat:       []
        };
      }
      k.overtime.jamCarryOver = parseFloat(((k.overtime.jamCarryOver || 0) + otVal).toFixed(2));
      k.overtime.riwayat = k.overtime.riwayat || [];
      k.overtime.riwayat.push({
        tanggal:    tanggal,
        jam:        otVal,
        sumber:     "migrasi-jibble",
        keterangan: `Carry-over saldo overtime dari Jibble`
      });
    }

    hasil.push({ username, sisaCuti: cutiVal, sisaOvertime: otVal, status: "OK" });
  });

  save(F.kuotaCuti, kuota);

  console.log(`[IMPORT-SALDO] ✅ Diimport oleh: ${req._requester} @ ${tanggal} — ${hasil.length} user berhasil, ${tidakDitemukan.length} tidak ditemukan`);
  if (tidakDitemukan.length) console.warn("[IMPORT-SALDO] Username tidak ditemukan:", tidakDitemukan.join(", "));

  res.json({
    status:           "OK",
    tahun,
    berhasil:         hasil.length,
    tidak_ditemukan:  tidakDitemukan,
    detail:           hasil,
    catatan:          tidakDitemukan.length > 0
      ? `Username berikut tidak ada di sistem, dilewati: ${tidakDitemukan.join(", ")}`
      : "Semua username berhasil diimport."
  });
});

// ── CEK SALDO AWAL (dry-run preview sebelum import) ──────────────────────────
// GET /admin/cek-saldo/:username  — lihat saldo kuota_cuti user tertentu
app.get("/admin/cek-saldo/:username", requireLevel(1), (req, res) => {
  const username = req.params.username;
  const kuota    = load(F.kuotaCuti, {});
  const users    = load(F.users, {});
  if (!users[username]) return res.status(404).json({ status: "GAGAL", pesan: "User tidak ditemukan." });
  res.json({
    username,
    saldo: kuota[username] || {},
    pesan: "Data saldo kuota_cuti user ini."
  });
});

// ── Debug page — hanya Owner (level 2) ───────────────────────────────────────
app.get("/debug-wp", requireLevel(2), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "debug-wp.html"));
});

// ── Force reload _store dari Supabase ─────────────────────────────────────────
app.post("/debug/reload-store", requireLevel(2), async (req, res) => {
  try {
    console.log("[RELOAD-STORE] Diminta oleh:", req._requester);
    const keys = Object.values(F);
    const defaults = {
      data: [], users: {}, areas: [], libur: [],
      aktivitas: [], groups: [], divisi: [],
      tracking: {}, kebijakan_cuti: [], kuota_cuti: {},
      pengajuan_cuti: [], aktivitas_kustom: [],
      rules: { messList: [] }, push_subscriptions: {},
      app_settings: { timezone: "Asia/Makassar" },
      screenshots: {}, work_photos: {},
    };
    let loaded = 0;
    await Promise.all(keys.map(async key => {
      try {
        const val = await dbLoad(key, defaults[key] ?? null);
        if (val !== null) { _store[key] = val; loaded++; }
      } catch(e) { console.error("[RELOAD] gagal load:", key, e.message); }
    }));
    // Log work_photos setelah reload
    const wp = _store["work_photos"] || {};
    const wpSummary = [];
    Object.keys(wp).forEach(date => {
      Object.keys(wp[date] || {}).forEach(u => {
        const raw = wp[date][u];
        wpSummary.push(`${date}/${u}: ${Array.isArray(raw) ? "array["+raw.length+"]" : typeof raw}`);
      });
    });
    console.log("[RELOAD-STORE] ✅ Selesai reload", loaded, "keys. WP:", wpSummary.join(", ") || "kosong");
    res.json({ status: "OK", loaded, work_photos_summary: wpSummary });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug + Fix endpoint — diagnosa & repair data Supabase ──────────────────
// GET  /debug/wp/:user  → lihat struktur data
// POST /debug/fix-wp    → repair format data work_photos ke format baru
// GET /debug/wp/:user — pakai requireLevel(2) = hanya Owner/Admin
app.get("/debug/wp/:user", requireLevel(2), async (req, res) => {
  try {
    const user  = req.params.user;
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Makassar" });

    // Baca langsung dari Supabase (bypass _store)
    const wpRaw   = await dbLoad("work_photos", {});
    const dataRaw = await dbLoad("data", []);

    const dayData = (wpRaw[today] || {})[user];
    const absenHari = dataRaw.filter(d => d.user === user && d.date === today);

    // Baca juga dari _store (RAM)
    const wpStore  = load("work_photos", null);
    const dayStore = wpStore ? ((wpStore[today] || {})[user]) : null;

    // Parse dengan wpGetSessions untuk lihat hasilnya
    const sessions = wpGetSessions(wpRaw, today, user);
    const merged   = wpMergeAllSessions(sessions);

    res.json({
      today, user,
      supabase_raw: {
        type:        Array.isArray(dayData) ? "array[" + dayData.length + "]" : typeof dayData,
        keys:        dayData && !Array.isArray(dayData) ? Object.keys(dayData).slice(0, 10) : null,
        item0:       Array.isArray(dayData) && dayData[0] ? {
          sesi: dayData[0].sesi, uraian: (dayData[0].uraian||"").slice(0,100),
          photos: (dayData[0].photos||[]).length, updatedAt: dayData[0].updatedAt
        } : dayData && !Array.isArray(dayData) ? {
          uraian: (dayData.uraian||"").slice(0,100), photos: (dayData.photos||[]).length,
          updatedAt: dayData.updatedAt
        } : "kosong/null",
      },
      parsed: {
        sessions: sessions.length,
        total_photos: merged.photos.length,
        uraian: merged.uraian,
        updatedAt: merged.updatedAt,
      },
      ram_store: dayStore ? {
        type: Array.isArray(dayStore) ? "array[" + dayStore.length + "]" : typeof dayStore,
        photos: Array.isArray(dayStore) ? dayStore.reduce((n,s)=>n+(s.photos||[]).length,0) : (dayStore.photos||[]).length,
      } : "kosong",
      absen_hari_ini: absenHari.map(d => ({
        sesi: d.sesi, jamMasuk: d.jamMasuk, jamKeluar: d.jamKeluar || null, aktivitas: d.aktivitas
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack?.slice(0,300) });
  }
});

// POST /debug/fix-wp — repair format data (requireLevel 2 = Owner saja)
app.post("/debug/fix-wp", requireLevel(2), async (req, res) => {
  try {
    const wpRaw = await dbLoad("work_photos", {});
    let fixed = 0, total = 0;
    const log = [];

    for (const date of Object.keys(wpRaw)) {
      for (const user of Object.keys(wpRaw[date] || {})) {
        total++;
        const raw = wpRaw[date][user];
        if (Array.isArray(raw) && raw.length > 0 && raw[0] && typeof raw[0].sesi !== "undefined") {
          log.push(`${date}/${user}: OK (array[${raw.length}])`);
          continue;
        }
        let newVal;
        if (Array.isArray(raw) && raw.length > 0 && (raw[0].image !== undefined || raw[0].ts !== undefined)) {
          newVal = [{ sesi:1, uraian:"", photos:raw, updatedAt:null, jamMasuk:null, lockedAt:null }];
        } else if (!Array.isArray(raw) && raw && typeof raw === "object") {
          newVal = [{ sesi:1, uraian:raw.uraian||"", photos:Array.isArray(raw.photos)?raw.photos:[], updatedAt:raw.updatedAt||null, jamMasuk:null, lockedAt:null }];
        } else {
          log.push(`${date}/${user}: SKIP (unknown format: ${typeof raw})`);
          continue;
        }
        wpRaw[date][user] = newVal;
        fixed++;
        log.push(`${date}/${user}: FIXED → sesi:1, photos:${newVal[0].photos.length}, uraian:"${(newVal[0].uraian||"").slice(0,40)}"`);
      }
    }

    if (fixed > 0) {
      save("work_photos", wpRaw);
      console.log("[FIX-WP] " + log.filter(l=>l.includes("FIXED")).join(" | "));
    }
    res.json({ status:"OK", total, fixed, log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Key Supabase (string pendek) ↔ path file /tmp (untuk fallback & migrasi) ──
const F = {
  data:            "data",
  users:           "users",
  areas:           "areas",
  libur:           "libur",
  aktivitas:       "aktivitas",
  groups:          "groups",
  divisi:          "divisi",
  tracking:        "tracking",
  kebijakanCuti:   "kebijakan_cuti",
  kuotaCuti:       "kuota_cuti",
  pengajuanCuti:   "pengajuan_cuti",
  aktivitasKustom: "aktivitas_kustom",
  rules:           "rules",
  pushSubs:        "push_subscriptions",
  appSettings:     "app_settings",
  screenshots:     "screenshots",
  sessions:         "sessions",        // track device login per user
  webauthn:         "webauthn",        // WebAuthn credentials (fingerprint/Face ID)
  workPhotos:      "work_photos",
};

// Path file /tmp untuk keperluan migrasi data lama
const F_TMP = Object.fromEntries(
  Object.entries(F).map(([k, v]) => [v, path.join(DATA_DIR, `${v}.json`)])
);

// ── load() dan save() sekarang SYNC-compatible menggunakan in-memory cache ───
// Cara kerja:
//   - Semua data di-load ke RAM saat server start (loadAll)
//   - load() dan save() baca/tulis ke RAM — tetap sync, tidak perlu ubah 180 baris
//   - save() juga trigger async write ke Supabase di background
//   - RAM state reset saat server restart → di-load ulang dari Supabase

const _store = {}; // In-memory store

function load(key, def) {
  if (key in _store) return _store[key];
  // null sebagai sentinel = caller mau async-fallback ke Supabase sendiri
  if (def === null) return null;
  console.warn(`[STORE] cold-start: "${key}" belum di RAM, pakai default. Routes async sudah handle ini.`);
  return def;
}

function save(key, data) {
  _store[key] = data;
  // Write ke Supabase di background — tidak block response
  dbSave(key, data).catch(e => console.error(`[SAVE] Gagal persist "${key}":`, e.message));
}

// ── Preload semua data dari Supabase ke RAM saat server start ─────────────────
async function loadAll() {
  console.log("[DB] Memuat semua data dari Supabase...");
  const keys = Object.values(F);
  const defaults = {
    data: [], users: {}, areas: [], libur: [],
    aktivitas: [], groups: [], divisi: [],
    tracking: {}, kebijakan_cuti: [], kuota_cuti: {},
    pengajuan_cuti: [], aktivitas_kustom: [],
    rules: { messList: [] }, push_subscriptions: {},
    app_settings: { timezone: "Asia/Makassar" },
    screenshots: {},
    work_photos: {},
  };

  await Promise.all(
    keys.map(async key => {
      const val = await dbLoad(key, defaults[key] ?? null);
      if (val !== null) _store[key] = val;
      else if (defaults[key] !== undefined) _store[key] = defaults[key];
    })
  );

  console.log("[DB] ✅ Semua data berhasil dimuat ke RAM");
  // Debug: log struktur work_photos
  const wp = _store["work_photos"] || {};
  const wpDates = Object.keys(wp);
  if (wpDates.length > 0) {
    wpDates.forEach(date => {
      const users = Object.keys(wp[date] || {});
      users.forEach(u => {
        const raw = wp[date][u];
        console.log(`[DB-WP] ${date}/${u}: type=${Array.isArray(raw)?"array["+raw.length+"]":typeof raw} keys=${Array.isArray(raw)?"-":Object.keys(raw||{}).slice(0,5).join(",")}`);
      });
    });
  } else {
    console.log("[DB-WP] work_photos kosong atau belum ada data");
  }
}

// ── Jalankan: migrasi data lama + load ke RAM sebelum server siap ─────────────
async function initDB() {
  await migrateFromTmp(F_TMP); // pindahkan data /tmp ke Supabase jika ada
  await loadAll();              // muat semua data ke RAM
  // Terapkan timezone yang tersimpan admin (override default)
  const savedTz = (_store["app_settings"] || {}).timezone;
  if (savedTz) { process.env.TZ = savedTz; console.log("[TZ] Timezone aktif:", savedTz); }
}

// Server mulai setelah DB siap
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Server jalan di port ${PORT}`));
}).catch(e => {
  console.error("[DB] Gagal inisialisasi database:", e);
  // Tetap jalankan server meski DB gagal (pakai data default)
  app.listen(PORT, () => console.log(`⚠️  Server jalan tanpa DB di port ${PORT}`));
});

// ========================
// WEB PUSH (VAPID)
// ========================
// VAPID keys — generate sekali dengan: node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(JSON.stringify(k))"
// Lalu set sebagai environment variable di Railway:
//   VAPID_PUBLIC_KEY  = key yang dihasilkan
//   VAPID_PRIVATE_KEY = key yang dihasilkan
//   VAPID_EMAIL       = mailto:emailkamu@domain.com
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL   = process.env.VAPID_EMAIL        || "mailto:admin@absensi.app";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log("✅ Web Push VAPID aktif");
} else {
  console.warn("⚠️  VAPID keys belum diset — push notification tidak aktif");
}

// Kirim push ke satu user (berdasarkan username)
async function sendPushToUser(username, title, body, data = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.log("[PUSH] VAPID tidak aktif"); return; }
  const subs = load(F.pushSubs, {});
  const userSubs = subs[username];
  console.log(`[PUSH] Kirim ke ${username}, subs:`, userSubs ? userSubs.length : 0);
  if (!userSubs || userSubs.length === 0) { console.log(`[PUSH] Tidak ada subscription untuk ${username}`); return; }

  // channelId harus sama dengan yang dibuat di capacitor-bridge.js
  // TTL 0 = hanya deliver jika device online sekarang (tidak ditunda)
  const payload = JSON.stringify({
    title,
    body,
    channelId: "absensi-main",
    ...data
  });
  const pushOptions = { TTL: 60 }; // tunggu max 60 detik jika device offline
  const deadSubs = [];

  for (const sub of userSubs) {
    try {
      await webpush.sendNotification(sub, payload, pushOptions);
      console.log(`[PUSH] Berhasil kirim ke ${username}`);
    } catch (err) {
      console.log(`[PUSH] Gagal kirim ke ${username}:`, err.statusCode, err.message);
      if (err.statusCode === 410 || err.statusCode === 404) deadSubs.push(sub.endpoint);
    }
  }

  if (deadSubs.length > 0) {
    subs[username] = userSubs.filter(s => !deadSubs.includes(s.endpoint));
    save(F.pushSubs, subs);
  }
}

// Kirim push ke semua user yang punya role tertentu (array of groupNames)
async function sendPushToGroups(groupNames, title, body, data = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const users = load(F.users, {});
  const targets = Object.keys(users).filter(u => {
    const g = getUserGroup(u);
    return groupNames.includes(g);
  });
  for (const u of targets) await sendPushToUser(u, title, body, data);
}



/** Ambil level user dari users.json + groups.json */
function getRequesterLevel(username) {
  if (!username) return 99;
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const u = users[username];
  if (!u) return 99;
  const g = groups.find(g => g.id === (u.group || "anggota"));
  return g ? g.level : 99;
}

/** Middleware: hanya izinkan requester dengan level <= maxLevel.
 *  Requester dibaca dari header X-User atau body._requester */
function requireLevel(maxLevel) {
  return (req, res, next) => {
    const requester = req.headers["x-user"] || (req.body && req.body._requester) || req.query._requester || "";
    const level = getRequesterLevel(requester);
    if (level > maxLevel) {
      return res.status(403).send({ status: "FORBIDDEN", msg: "Akses ditolak" });
    }
    req._requester = requester;
    req._requesterLevel = level;
    next();
  };
}

/** Middleware: boleh akses jika requester == target user ATAU level <= maxLevel */
function requireSelfOrLevel(paramField, maxLevel) {
  return (req, res, next) => {
    const requester = req.headers["x-user"] || (req.body && req.body._requester) || req.query._requester || "";
    const level  = getRequesterLevel(requester);
    const target = req.params[paramField] || "";
    if (level > maxLevel && requester !== target) {
      return res.status(403).send({ status: "FORBIDDEN", msg: "Akses ditolak" });
    }
    req._requester = requester;
    req._requesterLevel = level;
    next();
  };
}


function dist(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(lat2-lat1), dLon = r(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function logAktivitas(user, type, time) {
  const log = load(F.aktivitas, []);
  log.push({ user, type, time });
  if (log.length > 500) log.splice(0, log.length - 500);
  save(F.aktivitas, log);
}

// ========================
// RULES HELPERS
// ========================
const RULES_DEFAULT = {
  messList:            [],
  toggleMess:          true,  // Rule 1: Karyawan Mess clock out jam 17:00
  toggleLuarRadius:    true,  // Rule 2: Non-mess luar radius setelah 17:00
  toggleTidakAdaGPS:   true,  // Rule 3: Non-mess tidak ada GPS setelah 17:00
  toggleMidnightSplit: true,  // Rule 4: Midnight split 23:59
  toggleTugasLuar:     true,  // Rule 5: Kecualikan karyawan "tugas luar" dari semua rule
};

function getRules() {
  const saved = load(F.rules, RULES_DEFAULT);
  // Merge dengan default agar field baru selalu ada meski data lama belum punya
  return { ...RULES_DEFAULT, ...saved };
}

function isUserMess(username) {
  const rules = getRules();
  return (rules.messList || []).includes(username);
}

// ========================
// AUTO CLOCK-OUT SCHEDULER + PENGINGAT CLOCK IN
// ========================
// Berjalan setiap menit, aktif setelah jam 17:00 WIB
setInterval(() => {
  const now   = new Date();
  const hour  = now.getHours();
  const min   = now.getMinutes();
  const today = now.toLocaleDateString("sv-SE"); // lokal WITA bukan UTC
  const dow   = now.getDay(); // 0=Minggu, 6=Sabtu

  // ── PENGINGAT CLOCK IN — jam 08:00, Senin–Jumat ─────────────────────────
  if (hour === 8 && min === 0 && dow >= 1 && dow <= 5) {
    const data  = load(F.data, []);
    const users = load(F.users, {});

    Object.keys(users).forEach(username => {
      // Skip jika sudah clock in hari ini
      const sudahAbsen = data.some(d => d.user === username && d.date === today);
      if (sudahAbsen) return;

      // Skip jika Tugas Luar
      const user = users[username];
      if ((user.statusKerja || "").toLowerCase().includes("tugas luar")) return;

      sendPushToUser(username,
        "⏰ Pengingat Absen",
        "Kamu belum Clock In hari ini. Jangan lupa absen!"
      ).catch(() => {});
      // WA Pengingat Clock In dihapus — sudah pakai Web Push
    });
  }

  // ── AUTO OVERTIME SERVER-SIDE ─────────────────────────────────────────────
  // Jalan di 2 waktu:
  //   1) Senin 01:00 — utama, midnight-split sudah selesai & jam sudah final
  //   2) Senin 06:00 — backup, jika server restart antara 00:00–05:59
  //      Urutan aman: overtime 06:00 → autoTutupKekurangan 07:00 (jarak 1 jam)
  // PENTING: harus di atas "if (hour < 17) return" agar tidak terblokir
  const isOvertimeTime = (hour === 1 && min === 0 && dow === 1) ||
                         (hour === 6 && min === 0 && dow === 1);
  if (isOvertimeTime) {
    const usersOT = load(F.users, {});
    const triggerLabel = (hour === 1) ? "Senin 01:00 (utama)" : "Senin 06:00 (backup)";
    console.log(`[AUTO-OT-SERVER] Memproses overtime semua user (${triggerLabel})...`);
    Object.keys(usersOT).forEach(username => {
      try { hitungOvertimeBackground(username); } catch(e) {
        console.error(`[AUTO-OT-SERVER] Gagal proses ${username}:`, e.message);
      }
    });
    console.log(`[AUTO-OT-SERVER] Selesai (${triggerLabel}).`);
  }

  // ── AUTO RESET CUTI TAHUNAN — 1 Januari jam 00:01 ────────────────────────
  // PENTING: harus di atas "if (hour < 17) return" agar tidak terblokir
  if (hour === 0 && min === 1 && now.getDate() === 1 && now.getMonth() === 0) {
    const tahunBaru = now.getFullYear();
    const usersReset = load(F.users, {});
    const kuotaReset = load(F.kuotaCuti, {});
    console.log(`[AUTO-RESET] Reset cuti tahunan untuk tahun ${tahunBaru}...`);
    Object.keys(usersReset).forEach(username => {
      initKuotaUser(kuotaReset, username, tahunBaru);
    });
    save(F.kuotaCuti, kuotaReset);
    console.log("[AUTO-RESET] Selesai reset cuti tahunan.");
  }

  // ── AUTO CLOCK-OUT — hanya aktif mulai jam 17:00 ─────────────────────────
  if (hour < 17) return;

  const data     = load(F.data, []);
  const users    = load(F.users, {});
  const areas    = load(F.areas, []).filter(a => a.active !== false);
  const tracking = load(F.tracking, {});
  const rules    = getRules();
  const messList = rules.messList || [];

  // Baca semua toggle — default true jika belum tersimpan
  const toggleMess        = rules.toggleMess        !== false;
  const toggleLuarRadius  = rules.toggleLuarRadius  !== false;
  const toggleTidakAdaGPS = rules.toggleTidakAdaGPS !== false;
  const toggleTugasLuar   = rules.toggleTugasLuar   !== false;

  // Jika semua toggle rule 1-3 OFF, tidak perlu loop sama sekali
  if (!toggleMess && !toggleLuarRadius && !toggleTidakAdaGPS) {
    // lanjut ke midnight split di bawah
  } else {

  let changed = false;

  data.forEach(rec => {
    // Hanya proses yang masih clock in hari ini
    if (rec.date !== today || rec.jamKeluar) return;

    const username = rec.user;
    const user     = users[username];
    if (!user) return;

    // Skip jika Tugas Luar — hanya jika toggle 5 ON
    if (toggleTugasLuar && (user.statusKerja || "").toLowerCase().includes("tugas luar")) return;

    const isMess = messList.includes(username);
    const clockOutTime = new Date().toISOString();
    const jamFmt = new Date(clockOutTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

    if (isMess) {
      // Rule 1: Karyawan mess — clock out tepat jam 17:00
      if (!toggleMess) return; // toggle 1 OFF → skip
      if (hour === 17 && min === 0) {
        rec.jamKeluar = clockOutTime;
        rec.autoClockOut = true;
        rec.autoClockOutReason = "mess-17:00";
        logAktivitas(username, "AUTO_OUT_MESS", clockOutTime);
        changed = true;

        // Notif ke user — auto clock-out berhasil
        sendPushToUser(username,
          "Clock Out Otomatis 🔴",
          `Kamu otomatis di-Clock Out pukul ${jamFmt} (karyawan mess)`
        ).catch(() => {});
        // WA Fonnte — khusus karyawan mess
        if (user.noHp) sendFonnte(user.noHp,
          `🔴 *Clock Out Otomatis*\nHai *${user.namaLengkap || user.nama || username}*, kamu otomatis di-Clock Out pukul *${jamFmt}* (karyawan mess).`
        );
      }
    } else {
      // Karyawan non-mess
      const todayPoints = (tracking[today] || {})[username] || [];

      if (!todayPoints.length) {
        // Rule 3: Tidak ada data GPS → clock out otomatis
        if (!toggleTidakAdaGPS) return; // toggle 3 OFF → skip
        rec.jamKeluar = clockOutTime;
        rec.autoClockOut = true;
        rec.autoClockOutReason = "no-gps-after-17:00";
        logAktivitas(username, "AUTO_OUT_NO_GPS", clockOutTime);
        changed = true;

        sendPushToUser(username,
          "Clock Out Otomatis 🔴",
          `Kamu otomatis di-Clock Out pukul ${jamFmt} karena data lokasi tidak tersedia setelah jam 17:00`
        ).catch(() => {});
        return;
      }

      const lastPoint = todayPoints[todayPoints.length - 1];
      const { lat, lng } = lastPoint;

      // Cek apakah masih dalam salah satu area aktif
      const inRadius = areas.some(a =>
        dist(lat, lng, a.lat, a.lng) <= (a.radius || 100)
      );

      if (!inRadius) {
        // Rule 2: Di luar radius setelah 17:00
        if (!toggleLuarRadius) return; // toggle 2 OFF → skip
        rec.jamKeluar = clockOutTime;
        rec.autoClockOut = true;
        rec.autoClockOutReason = "luar-radius-after-17:00";
        logAktivitas(username, "AUTO_OUT_LUAR", clockOutTime);
        changed = true;

        // Notif ke user — auto clock-out karena di luar radius
        sendPushToUser(username,
          "Clock Out Otomatis 🔴",
          `Kamu otomatis di-Clock Out pukul ${jamFmt} karena berada di luar radius area kantor`
        ).catch(() => {});
      }
    }
  });

  if (changed) {
    save(F.data, data);
    // Overtime tidak dihitung realtime — hanya diakumulasi setiap Minggu 23:59
  }

  } // end if any toggle active

  // ── MIDNIGHT SPLIT — jam 23:59, split semua sesi yang masih aktif ──────────
  if (hour === 23 && min === 59) {
    // Rule 4: Midnight Split — cek toggle
    const rulesMid = getRules();
    if (rulesMid.toggleMidnightSplit === false) {
      console.log("[MIDNIGHT] Toggle Midnight Split OFF — dilewati");
    } else {
    const dataMid  = load(F.data, []);
    const usersMid = load(F.users, {});
    const todayMid = now.toLocaleDateString("sv-SE");

    // Hitung tanggal besok
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString("sv-SE");

    // Waktu 23:59:59 hari ini sebagai jamKeluar sesi lama
    const cutTime = new Date(now);
    cutTime.setHours(23, 59, 59, 0);
    const cutISO = cutTime.toISOString();

    // Waktu 00:00:00 besok sebagai jamMasuk sesi baru
    const startNew = new Date(tomorrow);
    startNew.setHours(0, 0, 0, 0);
    const startISO = startNew.toISOString();

    let midChanged = false;
    const newRecords = [];

    dataMid.forEach(rec => {
      // Hanya record aktif hari ini (belum clock out)
      if (rec.date !== todayMid || rec.jamKeluar) return;

      // Tutup sesi hari ini jam 23:59:59
      const lb = rec.breaks.at(-1);
      if (lb && !lb.end) lb.end = cutISO; // tutup break kalau masih istirahat
      rec.jamKeluar       = cutISO;
      rec.autoClockOut    = true;
      rec.autoClockOutReason = "midnight-split";
      midChanged = true;

      // Buat record baru untuk hari besok jam 00:00:00
      const sesiBerikut = dataMid.filter(d => d.user === rec.user && d.date === tomorrowStr).length + newRecords.filter(d => d.user === rec.user && d.date === tomorrowStr).length + 1;
      newRecords.push({
        user:       rec.user,
        date:       tomorrowStr,
        jamMasuk:   startISO,
        jamKeluar:  null,
        lokasi:     rec.lokasi || {},
        foto:       rec.foto   || "",
        breaks:     [],
        aktivitas:  rec.aktivitas || "", // salin aktivitas dari sesi sebelumnya
        sesi:       sesiBerikut,
        autoClockIn: true,
        autoClockInReason: "midnight-split"
      });

      // Notif Web Push ke karyawan
      const user = usersMid[rec.user] || {};
      sendPushToUser(rec.user,
        "🌙 Pergantian Hari Otomatis",
        `Sesi kerja dilanjutkan otomatis ke hari baru pukul 00:00`
      ).catch(() => {});

      console.log(`[MIDNIGHT] Split sesi ${rec.user}: ${todayMid} 23:59 → ${tomorrowStr} 00:00`);
    });

    if (midChanged) {
      newRecords.forEach(r => dataMid.push(r));
      save(F.data, dataMid);
    }
    } // end toggleMidnightSplit check
  }

}, 60000); // cek setiap 1 menit

// ========================
// AUTO TUTUP KEKURANGAN JAM DARI SALDO OVERTIME
// Berjalan setiap menit, eksekusi hanya tanggal 1 jam 07:00
// ========================

// Fungsi utama: evaluasi kekurangan jam bulan lalu per user, tutup dari saldo overtime
function autoTutupKekuranganOvertime() {
  const settings = load(F.appSettings, {});
  if (!settings.autoTutupOvertimeEnabled) return; // toggle off → skip

  const now        = new Date();
  // Hitung bulan lalu
  const thnLalu    = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const blnLalu    = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-based
  const blnStr     = `${thnLalu}-${String(blnLalu).padStart(2, "0")}`;

  const data       = load(F.data, []);
  const kuota      = load(F.kuotaCuti, {});
  const usersData  = load(F.users, {});
  const groups     = load(F.groups, []);

  console.log(`[AUTO-TUTUP-OT] Memproses kekurangan jam bulan ${blnStr}...`);

  let kuotaChanged = false;

  Object.keys(usersData).forEach(username => {
    const tahun = String(thnLalu);
    const k = kuota[username] ? kuota[username][tahun] : null;
    if (!k || !k.overtime) return;

    // Kumpulkan semua sesi bulan lalu milik user ini yang sudah clock out
    const recsB = data.filter(d =>
      d.user === username &&
      d.date &&
      d.date.startsWith(blnStr) &&
      d.jamKeluar
    );
    if (!recsB.length) return;

    // Grup per minggu, hitung total jam per minggu
    const weekMap = {};
    recsB.forEach(d => {
      const wk = weekKey(d.date);
      if (!weekMap[wk]) weekMap[wk] = 0;
      weekMap[wk] += hitungJamKerja(d);
    });

    // Cari minggu-minggu yang kurang dari 40 jam
    const mingguKurang = [];
    Object.entries(weekMap).forEach(([wk, jam]) => {
      if (jam < JAM_WAJIB_MINGGU) {
        mingguKurang.push({ wk, jam, kurang: parseFloat((JAM_WAJIB_MINGGU - jam).toFixed(2)) });
      }
    });
    if (!mingguKurang.length) return;

    const totalKurang = parseFloat(mingguKurang.reduce((s, m) => s + m.kurang, 0).toFixed(2));

    // Hitung saldo overtime yang tersedia
    const saldoTersedia = parseFloat(((k.overtime.jamTL_reguler || 0) + (k.overtime.jamCarryOver || 0) - (k.overtime.jamTerpakai || 0)).toFixed(2));
    if (saldoTersedia <= 0) return; // tidak ada saldo → skip (tetap jadi potongan gaji)

    // Ambil sebesar kurang atau sebesar saldo jika tidak cukup
    const jamDiambil   = parseFloat(Math.min(totalKurang, saldoTersedia).toFixed(2));
    const sisaPotongan = parseFloat((totalKurang - jamDiambil).toFixed(2));

    // Catat ke riwayat overtime sebagai pengurangan
    k.overtime.jamTerpakai = parseFloat(((k.overtime.jamTerpakai || 0) + jamDiambil).toFixed(2));
    k.overtime.riwayat = k.overtime.riwayat || [];
    k.overtime.riwayat.push({
      tanggal:     new Date().toLocaleDateString("sv-SE"),
      jam:         -jamDiambil,
      sumber:      "auto-tutup",
      keterangan:  `Penutup kekurangan jam bulan ${blnStr} (${mingguKurang.map(m => m.wk).join(", ")}) — diambil ${jamDiambil} jam dari saldo overtime`,
      detail: {
        bulan:         blnStr,
        totalKurang,
        jamDiambil,
        sisaPotonganGaji: sisaPotongan,
        mingguKurang:  mingguKurang.map(m => ({ minggu: m.wk, jamKerja: m.jam, kurang: m.kurang }))
      }
    });

    kuotaChanged = true;

    // Notifikasi ke user
    const user    = usersData[username] || {};
    const namaUser = user.namaLengkap || user.nama || username;
    const msgUser = `📋 Info Rekap Bulan ${blnStr}\nKekurangan jam kerja: ${totalKurang} jam\nDitutupi dari saldo Overtime: ${jamDiambil} jam${sisaPotongan > 0 ? `\nSisa kekurangan (potongan gaji): ${sisaPotongan} jam` : "\nSeluruh kekurangan telah tertutup ✅"}`;
    sendPushToUser(username, "Rekap Kekurangan Jam", msgUser).catch(() => {});
    if (user.noHp) sendFonnte(user.noHp,
      `🔔 *Rekap Kekurangan Jam — ${blnStr}*\nHai *${namaUser}*,\n${msgUser}`
    );

    // Notifikasi ke admin saja (owner tidak perlu, hemat notif)
    const msgAdmin = `👤 ${namaUser} — kekurangan jam bulan ${blnStr}: ${totalKurang} jam, ditutupi OT: ${jamDiambil} jam${sisaPotongan > 0 ? `, sisa potongan gaji: ${sisaPotongan} jam` : " (lunas ✅)"}`;
    Object.keys(usersData).forEach(adm => {
      const grpId  = usersData[adm].group || "anggota";
      const grp    = groups.find(g => g.id === grpId);
      const level  = grp ? (grp.level || 99) : 99;
      if (level === 2) { // admin saja (level 2), owner (level 1) tidak perlu
        sendPushToUser(adm, "Auto Tutup Kekurangan Jam", msgAdmin).catch(() => {});
      }
    });

    console.log(`[AUTO-TUTUP-OT] ${username}: kurang ${totalKurang}j, diambil ${jamDiambil}j dari OT, sisa potongan gaji: ${sisaPotongan}j`);
  });

  if (kuotaChanged) save(F.kuotaCuti, kuota);
  console.log(`[AUTO-TUTUP-OT] Selesai proses bulan ${blnStr}.`);
}

// Scheduler: tanggal 1 jam 07:00
// Sengaja 07:00 agar tidak bertabrakan dengan auto overtime backup (Senin 06:00)
setInterval(() => {
  const now = new Date();
  if (now.getDate() !== 1 || now.getHours() !== 7 || now.getMinutes() !== 0) return;
  autoTutupKekuranganOvertime();
}, 60000);

// ── CLEANUP MALAM — hapus screenshot & foto kegiatan > 7 hari ────────────────
// Berjalan setiap menit, eksekusi cleanup hanya jam 00:05
setInterval(async () => {
  const now  = new Date();
  if (now.getHours() !== 0 || now.getMinutes() !== 5) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toLocaleDateString("sv-SE");

  // Cleanup screenshots
  const screenshots = load(F.screenshots, {});
  let ssDeleted = 0;
  const ssBucketPaths = [];
  Object.keys(screenshots).forEach(k => {
    if (k < cutoffStr) {
      // Kumpulkan path bucket untuk dihapus
      Object.values(screenshots[k]).forEach(shots => {
        shots.forEach(s => { if (s.path) ssBucketPaths.push(s.path); });
      });
      delete screenshots[k];
      ssDeleted++;
    }
  });
  if (ssDeleted > 0) {
    save(F.screenshots, screenshots);
    if (ssBucketPaths.length) await bucketDeleteMany(ssBucketPaths);
    console.log(`[CLEANUP] ✅ Hapus ${ssDeleted} hari screenshot (retensi 7 hari) — ${ssBucketPaths.length} file bucket`);
  }

  // Cleanup work photos
  const workPhotos = load(F.workPhotos, {});
  let wpDeleted = 0;
  const wpBucketPaths = [];
  Object.keys(workPhotos).forEach(k => {
    if (k < cutoffStr) {
      // Kumpulkan path bucket untuk dihapus
      Object.values(workPhotos[k]).forEach(sessions => {
        const sesArr = Array.isArray(sessions) ? sessions : [sessions];
        sesArr.forEach(s => {
          (s.photos || []).forEach(p => { if (p.path) wpBucketPaths.push(p.path); });
        });
      });
      delete workPhotos[k];
      wpDeleted++;
    }
  });
  if (wpDeleted > 0) {
    save(F.workPhotos, workPhotos);
    if (wpBucketPaths.length) await bucketDeleteMany(wpBucketPaths);
    console.log(`[CLEANUP] ✅ Hapus ${wpDeleted} hari foto kerja (retensi 7 hari) — ${wpBucketPaths.length} file bucket`);
  }

  if (ssDeleted > 0 || wpDeleted > 0)
    console.log(`[CLEANUP] Selesai @ ${now.toLocaleTimeString("id-ID")} — SS: ${ssDeleted}, WP: ${wpDeleted} hari dihapus`);
}, 60000);

// Inisialisasi default groups jika belum ada
function initGroups() {
  if (!fs.existsSync(F.groups)) {
    const defaults = [
      {
        id: "owner", name: "Owner", level: 1, color: "#8e44ad",
        menus: [
          "home","rekap","admin","setting",
          "anggota","anggota.daftar","anggota.divisi",
          "aksesibilitas",
          "area","area.daftar","area.tambah",
          "libur","libur.hari-libur","libur.kebijakan-cuti","libur.kuota-cuti",
          "aktivitas","timesheet","tracking",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "admin", name: "Admin", level: 2, color: "#2980b9",
        menus: [
          "home","rekap","admin","setting",
          "anggota","anggota.daftar","anggota.divisi",
          "aksesibilitas",
          "area","area.daftar","area.tambah",
          "libur","libur.hari-libur","libur.kebijakan-cuti","libur.kuota-cuti",
          "aktivitas","timesheet","tracking",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "manager", name: "Manager", level: 3, color: "#27ae60",
        menus: [
          "home","rekap","admin","aktivitas","timesheet","tracking",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "koordinator", name: "Koordinator", level: 4, color: "#e67e22",
        menus: [
          "home","rekap","aktivitas",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "anggota", name: "Anggota", level: 5, color: "#7f8c8d",
        menus: [
          "home","rekap",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      }
    ];
    save(F.groups, defaults);
  }
}
initGroups();

// Inisialisasi kebijakan cuti default jika belum ada
function initKebijakanCutiDefault() {
  const data = load(F.kebijakanCuti, []);
  const defaults = [
      {
        id:         "default-tahunan",
        nama:       "Cuti Tahunan",
        jenis:      "kuota",
        kuotaKey:   "tahunan",           // key yang diacu di kuota_cuti.json
        periode:    "tahunan",
        berlaku:    "semua",
        keterangan: "Cuti tahunan 12 hari. Otomatis terhubung ke Kuota Cuti Tahunan.",
        _default:   true,
        _locked:    true,                // tidak bisa dihapus
        createdAt:  new Date().toISOString()
      },
      {
        id:         "default-overtime",
        nama:       "Cuti Overtime",
        jenis:      "kuota",
        kuotaKey:   "overtime",
        periode:    "akumulasi",
        berlaku:    "semua",
        keterangan: "Cuti dari akumulasi jam overtime (kelebihan 40 jam/minggu). Otomatis terhubung ke Kuota Cuti Overtime.",
        _default:   true,
        _locked:    true,
        createdAt:  new Date().toISOString()
      },
      {
        id:         "default-tukar-libur",
        nama:       "Tukar Libur Nasional & Agama",
        jenis:      "kuota",
        kuotaKey:   "tukarLibur",
        periode:    "akumulasi",
        berlaku:    "semua",
        keterangan: "Tukar kerja di hari libur nasional/keagamaan.",
        _default:   true,
        _locked:    true,
        createdAt:  new Date().toISOString()
      }
    ];
    // Gabungkan: default di depan, kebijakan custom di belakang
    save(F.kebijakanCuti, [...defaults, ...data.filter(d => !d._default)]);
}
initKebijakanCutiDefault();

// ========================
// AUTH
// ========================
app.post("/signup", async (req, res) => {
  const { username, password, faceDescriptor, namaLengkap, agama, noHp } = req.body;
  if (!username || !password) return res.send({ status: "ERROR" });
  const users = load(F.users, {});
  if (users[username]) return res.send({ status: "EXIST" });
  const isFirst = Object.keys(users).length === 0;
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  users[username] = {
    password: hashedPassword,
    faceDescriptor: faceDescriptor || [],
    group:       isFirst ? "owner"   : "anggota",
    peran:       isFirst ? "Owner"   : "Anggota",
    namaLengkap: namaLengkap || "",
    agama:       agama || "",
    noHp:        noHp  || "",
    jabatan:     isFirst ? "Owner" : "Anggota",
    divisi:      "",
    statusKerja: "",
    nominalGaji: "",
    photo:       "",
    createdAt:   new Date().toISOString()
  };
  save(F.users, users);

  // Push ke owner & admin — ada anggota baru (kecuali user pertama yg jadi owner)
  if (!isFirst) {
    sendPushToGroups(["owner", "admin"],
      "Anggota Baru Mendaftar 🎉",
      `${namaLengkap || username} baru saja mendaftar sebagai anggota`
    ).catch(() => {});

    // WA Signup dihapus — sudah pakai Web Push ke admin/owner
    const usersAll = load(F.users, {});
  }

  res.send({ status: "OK" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const users  = load(F.users, {});
  const user   = users[username];
  if (!user) return res.send({ status: "FAIL" });
  // Support password lama (plaintext) yang belum di-migrate — hash otomatis saat login
  let valid = false;
  if (user.password.startsWith("$2")) {
    valid = await bcrypt.compare(password, user.password);
  } else {
    // Password lama plaintext: bandingkan langsung, lalu upgrade ke hash
    valid = user.password === password;
    if (valid) {
      user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
      users[username] = user;
      save(F.users, users);
    }
  }
  if (!valid) return res.send({ status: "FAIL" });
  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === (user.group || "anggota")) || groups[groups.length-1];

  // ── Simpan info device saat login ──────────────────────────
  const ua         = req.headers["user-agent"] || "";
  const isMobile      = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  const isElectron    = /Electron/i.test(ua);
  const isCapacitor   = req.body.isCapacitor === true; // APK native via Capacitor
  const isPWA         = !isCapacitor && req.body.isPWA === true;
  let deviceType      = "desktop";
  if (isElectron)             deviceType = "desktop-app";
  else if (isCapacitor)       deviceType = "mobile"; // APK Capacitor → mobile, bukan pwa
  else if (isPWA && isMobile) deviceType = "pwa";
  else if (isPWA)             deviceType = "pwa-desktop";
  else if (isMobile)          deviceType = "mobile";

  // Generate sessionId unik — dipakai untuk deteksi login di device lain
  const sessionId  = require("crypto").randomBytes(24).toString("hex");
  const sessions   = load(F.sessions, {});
  sessions[username] = {
    deviceType,
    sessionId,
    userAgent:  ua,
    loginAt:    new Date().toISOString(),
    ip:         req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
  };
  save(F.sessions, sessions);

  res.send({ status: "OK", group: group.id, menus: group.menus, level: group.level, deviceType, sessionId });
});

app.get("/check-user/:username", (req, res) => {
  const users  = load(F.users, {});
  const user   = users[req.params.username];
  if (!user) return res.send({ valid: false });
  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === (user.group || "anggota")) || groups[groups.length-1];
  res.send({ valid: true, group: group.id, menus: group.menus, level: group.level });
});

app.get("/face-descriptor/:username", (req, res) => {
  const users = load(F.users, {});
  const user  = users[req.params.username];
  res.send({ descriptor: user ? (user.faceDescriptor || []) : [] });
});

// ========================
// ABSENSI
// ========================
app.post("/absen", requireLevel(99), (req, res) => {
  const data = load(F.data, []);
  const areas = load(F.areas, []);
  // Identitas user diambil dari header X-User (sudah diverifikasi middleware), bukan dari body
  const user = req._requester;
  const { type, time, lat, lng, accuracy, photo, workPhoto } = req.body;
  if (!user) return res.status(401).send({ status: "UNAUTHORIZED" });
  const today = todayLocal(); // lokal WITA, bukan UTC

  // Cek statusKerja user — Tugas Luar boleh clock in dari mana saja
  const users    = load(F.users, {});
  const userData = users[user] || {};
  const isTugasLuar = userData.statusKerja === "Tugas Luar";

  // Wajib kirim koordinat valid (bukan 0,0) — jika kosong berarti izin lokasi ditolak
  if ((lat === 0 && lng === 0) || lat == null || lng == null) {
    if (!isTugasLuar) {
      return res.status(400).send({ status: "LOCATION_REQUIRED", msg: "Izin lokasi diperlukan untuk absensi" });
    }
  }

  // Validasi area — untuk SEMUA tipe absen (IN, OUT, BREAK_START, BREAK_END), kecuali Tugas Luar
  const needsAreaCheck = areas.length > 0 && !isTugasLuar;
  if (needsAreaCheck) {
    if (lat === 0 && lng === 0) {
      const _typeLabel = { IN: "Clock In", OUT: "Clock Out", BREAK_START: "Mulai Istirahat", BREAK_END: "Selesai Istirahat" }[type] || type;
      return res.status(400).send({ status: "LOCATION_REQUIRED", msg: `Aktifkan lokasi untuk ${_typeLabel}` });
    }
    const activeAreas = areas.filter(a => a.active !== false);
    if (activeAreas.length > 0) {
      // Perlebar radius validasi sebesar nilai accuracy GPS user (agar tidak false-reject
      // saat sinyal lemah). Maksimal toleransi: 350m — Android TWA dalam gedung bisa
      // menghasilkan accuracy 300-500m, naik dari 200m agar tidak banyak false OUT_OF_AREA.
      const accTolerance = Math.min(accuracy != null ? accuracy : 0, 350);
      const inAny = activeAreas.some(a => dist(lat, lng, a.lat, a.lng) <= (a.radius + accTolerance));
      if (!inAny) {
        const nearest = activeAreas.reduce((best, a) => {
          const d = dist(lat, lng, a.lat, a.lng);
          return d < best.d ? { d, name: a.name } : best;
        }, { d: Infinity, name: "" });
        return res.status(400).send({
          status:   "OUT_OF_AREA",
          distance: Math.round(nearest.d),
          area:     nearest.name,
          accuracy: accuracy != null ? Math.round(accuracy) : null
        });
      }
    }
  }

  // Cari record aktif hari ini
  let record = data.find(d => d.user === user && d.date === today && !d.jamKeluar);

  // Midnight split aktif — tidak perlu cek record kemarin

  // Normalisasi timestamp ke UTC ISO agar konsisten di semua perhitungan
  const timeNorm = normalizeTime(time) || time;

  if (type === "IN") {
    if (record) return res.send({ status: "ALREADY_IN" });
    const aktivitas = req.body.aktivitas || "";
    // Deteksi platform: pakai nilai dari client, fallback ke UA jika tidak ada / "desktop"
    let platform = req.body.platform || "desktop";
    if (platform === "desktop" || !platform) {
      const ua = req.headers["user-agent"] || "";
      const uaMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
      if (uaMobile) platform = "mobile"; // fallback: UA mobile → catat sebagai mobile
    }
    console.log(`[CLOCK-IN] ${user} | platform: "${platform}" | UA: ${(req.headers["user-agent"]||"").slice(0,80)} | w:${req.body.screenWidth||"?"}`);
    data.push({ user, date: today, jamMasuk: timeNorm, jamKeluar: null, lokasi: { lat, lng, accuracy }, foto: photo, breaks: [], aktivitas, platform, sesi: (data.filter(d => d.user === user && d.date === today).length + 1) });
  } else if (type === "OUT" && record) {
    record.jamKeluar = timeNorm;
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = timeNorm;
    // Foto kegiatan kini dikelola via POST /work-photos/report (terpisah dari clock out)
  } else if (type === "BREAK_START" && record) {
    record.breaks.push({ start: timeNorm, end: null });
  } else if (type === "BREAK_END" && record) {
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = timeNorm;
  }

  save(F.data, data);
  logAktivitas(user, type, time);

  // Overtime tidak dihitung realtime setiap clock-out — hanya diakumulasi setiap Minggu 23:59

  // Push notification — konfirmasi absen ke user
  const labelPush = { IN: "Clock In berhasil ✅", OUT: "Clock Out berhasil ✅", BREAK_START: "Istirahat dimulai ☕", BREAK_END: "Selesai istirahat, kerja lagi! 💪" };
  const jamFmt = new Date(time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  sendPushToUser(user, "Absensi Smart", `${labelPush[type] || type} — ${jamFmt}`).catch(() => {});
  // WA — konfirmasi absen ke user
  const labelWA = { IN: "Clock In berhasil ✅", OUT: "Clock Out berhasil ✅", BREAK_START: "Mulai Istirahat ☕", BREAK_END: "Selesai Istirahat 💪" };
  // WA Clock In/Out/Istirahat dihapus — sudah pakai Web Push

  res.send({ status: "OK" });
});

app.get("/status/:user", requireSelfOrLevel("user", 2), async (req, res) => {
  try {
    const today = todayLocal();
    // Fallback ke Supabase saat cold start
    let data = load(F.data, null);
    if (!data) data = await dbLoad(F.data, []);

    const username     = req.params.user;
    let aktif          = data.find(d => d.user === username && d.date === today && !d.jamKeluar);
    const adaHariIni   = data.find(d => d.user === username && d.date === today);
    const recTerakhir  = data.slice().reverse().find(d => d.user === username && d.date === today);

    if (!aktif) return res.send({
      status: "OUT",
      hadAbsenceToday: !!adaHariIni,
      aktivitas: recTerakhir?.aktivitas || ""
    });
    const lb = aktif.breaks?.at(-1);
    const statusStr = (lb && !lb.end) ? "BREAK" : "IN";
    return res.send({ status: statusStr, hadAbsenceToday: true, aktivitas: aktif.aktivitas || "" });
  } catch (err) {
    console.error("[STATUS] Error:", err.message);
    res.send({ status: "OUT", hadAbsenceToday: false, aktivitas: "" });
  }
});

// ========================
// REPORT & HISTORY
// ========================
app.get("/report/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const data = load(F.data, []);
  let totalKerja = 0, totalBreak = 0;
  data.filter(d => d.user === req.params.user && d.jamKeluar).forEach(d => {
    const work = (new Date(d.jamKeluar) - new Date(d.jamMasuk)) / 3600000;
    let bt = 0;
    d.breaks.forEach(b => { if (b.end) bt += (new Date(b.end) - new Date(b.start)) / 3600000; });
    totalKerja += (work - bt); totalBreak += bt;
  });
  res.send({ totalKerja: totalKerja.toFixed(1)+"h", totalBreak: totalBreak.toFixed(1)+"h", overtime: Math.max(0, totalKerja-8).toFixed(1)+"h" });
});

app.get("/history/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const data = load(F.data, []);
  const records = data
    .filter(d => d.user === req.params.user)
    .slice(-30)
    .reverse()
    .map(({ foto, lokasi, ...rest }) => rest);
  res.send(records);
});

// ========================
// ADMIN
// ========================
app.get("/admin/today", requireLevel(3), (req, res) => {
  const data  = load(F.data, []);
  const users = load(F.users, {});
  const date  = req.query.date || todayLocal(); // lokal WITA
  const records = Object.keys(users).map(username => {
    // Prioritaskan sesi aktif agar multi-sesi tidak salah jadi DONE
    const recAktifT  = data.find(d => d.user === username && d.date === date && !d.jamKeluar);
    const recLatestT = data.slice().reverse().find(d => d.user === username && d.date === date);
    const rec        = recAktifT || recLatestT;
    let status = "OUT";
    if (recAktifT) { const lb = recAktifT.breaks?.at(-1); status = (lb && !lb.end) ? "BREAK" : "IN"; }
    else if (recLatestT?.jamKeluar) status = "DONE";
    const sessions  = load(F.sessions, {});
    const sess      = sessions[username] || {};
    return { user: username, jamMasuk: rec?.jamMasuk||null, jamKeluar: rec?.jamKeluar||null, status,
             deviceType: sess.deviceType || "unknown", namaLengkap: users[username]?.namaLengkap || username };
  });
  records.sort((a, b) => {
    const na = (users[a.user]?.namaLengkap || a.user || '');
    const nb = (users[b.user]?.namaLengkap || b.user || '');
    return na.localeCompare(nb, 'id');
  });
  res.send({ totalUsers: Object.keys(users).length, records });
});

// ========================
// PROFIL
// ========================
app.get("/profile/:username", requireSelfOrLevel("username", 2), (req, res) => {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const user   = users[req.params.username];
  if (!user) return res.send({ status: "NOT_FOUND" });
  const group  = groups.find(g => g.id === (user.group || "anggota")) || groups[groups.length-1];
  const isAdminOrOwner = req._requesterLevel <= 2;
  const response = {
    username:    req.params.username,
    namaLengkap: user.namaLengkap  || "",
    agama:       user.agama        || "",
    noHp:        user.noHp         || "",
    jabatan:     user.jabatan      || "Anggota",
    peran:       user.peran || (user.group === "owner" ? "Owner" : user.group === "admin" ? "Admin" : ""),
    group:       user.group        || "anggota",
    groupName:   group?.name       || "Anggota",
    groupColor:  group?.color      || "#7f8c8d",
    divisi:      Array.isArray(user.divisi) ? user.divisi : (user.divisi ? [user.divisi] : []),
    statusKerja: user.statusKerja  || "",
    photo:       user.photo        || "",
    // nominalGaji hanya dikirim ke Owner/Admin
    ...(isAdminOrOwner ? { nominalGaji: user.nominalGaji || "" } : {}),
    // faceDescriptor TIDAK dikirim di sini — gunakan /face-descriptor/:username
  };
  res.send(response);
});

app.put("/profile/:username", requireSelfOrLevel("username", 2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  // Field yang boleh diedit oleh siapa saja (termasuk user sendiri)
  const allowedSelf  = ["namaLengkap", "agama", "noHp"];
  // Field yang hanya boleh diedit oleh Owner/Admin (level <= 2)
  const allowedAdmin = ["jabatan", "divisi", "statusKerja", "nominalGaji"];
  allowedSelf.forEach(k => { if (req.body[k] !== undefined) users[req.params.username][k] = req.body[k]; });
  if (req._requesterLevel <= 2) {
    allowedAdmin.forEach(k => { if (req.body[k] !== undefined) users[req.params.username][k] = req.body[k]; });
  }
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/photo", requireSelfOrLevel("username", 2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].photo = req.body.photo || "";
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/face", requireSelfOrLevel("username", 2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].faceDescriptor = req.body.faceDescriptor || [];
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/password", requireSelfOrLevel("username", 2), async (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.send({ status: "INVALID" });
  users[req.params.username].password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// ANGGOTA
// ========================
app.get("/anggota", requireLevel(99), (req, res) => {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const absen  = load(F.data, []);
  const list   = Object.keys(users).map(u => {
    const usr = users[u];
    const g   = groups.find(g => g.id === (usr.group || "anggota"));
    // Cari waktu terakhir aktif dari data absensi
    const recs = absen
      .filter(d => d.user === u)
      .sort((a, b) => {
        const ta = new Date(a.jamKeluar || a.jamMasuk || (a.date + "T00:00:00")).getTime();
        const tb = new Date(b.jamKeluar || b.jamMasuk || (b.date + "T00:00:00")).getTime();
        return tb - ta;
      });
    const lastSeen = recs.length
      ? (recs[0].jamKeluar || recs[0].jamMasuk || (recs[0].date + "T00:00:00"))
      : (usr.createdAt || null);
    return {
      username:    u,
      namaLengkap: usr.namaLengkap  || "",
      jabatan:     (usr.jabatan && usr.jabatan !== "Anggota")
        ? usr.jabatan
        : (usr.group === "owner" ? "Owner" : usr.group === "admin" ? "Admin" : "Anggota"),
      photo:       usr.photo        || "",
      group:       usr.group        || "anggota",
      groupName:   g?.name          || "Anggota",
      groupColor:  g?.color         || "#7f8c8d",
      peran:       usr.peran        || (usr.group === "owner" ? "Owner" : usr.group === "admin" ? "Admin" : "Anggota"),
      divisi:      Array.isArray(usr.divisi) ? usr.divisi : (usr.divisi ? [usr.divisi] : []),
      statusKerja: usr.statusKerja  || "",
      createdAt:   usr.createdAt    || "",
      lastSeen,
    };
  });
  list.sort((a, b) => (a.namaLengkap || a.username || '').localeCompare(b.namaLengkap || b.username || '', 'id'));
  res.send(list);
});

app.put("/anggota/:username/group", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const newGroup = req.body.group;
  users[req.params.username].group = newGroup;
  // Peran hanya untuk Owner dan Admin — jika group bukan owner/admin, peran tetap "Anggota"
  if (newGroup === "owner" || newGroup === "admin") {
    users[req.params.username].peran = newGroup === "owner" ? "Owner" : "Admin";
  } else {
    users[req.params.username].peran = "Anggota";
  }
  // Update jabatan berdasarkan group baru — hanya jika user tidak punya divisi
  // (jika ada divisi, jabatan diatur dari posisi di divisi)
  const divisiListGrp = load(F.divisi, []);
  const userDivisi = Array.isArray(users[req.params.username].divisi)
    ? users[req.params.username].divisi
    : (users[req.params.username].divisi ? [users[req.params.username].divisi] : []);
  const punyaDivisi = userDivisi.some(dNama => divisiListGrp.find(d => d.nama === dNama));
  if (!punyaDivisi) {
    users[req.params.username].jabatan =
      newGroup === "owner" ? "Owner" :
      newGroup === "admin" ? "Admin" : "Anggota";
  }
  save(F.users, users);
  res.send({ status: "OK" });
});

// Update statusKerja (Tugas Luar / kosong)
app.put("/anggota/:username/status", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].statusKerja = req.body.statusKerja || "";
  save(F.users, users);
  res.send({ status: "OK" });
});

app.delete("/anggota/:username", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  delete users[req.params.username];
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// GROUP / ROLE
// ========================
app.get("/groups", requireLevel(99), (req, res) => res.send(load(F.groups, [])));

app.put("/groups/:id/menus", requireLevel(2), (req, res) => {
  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === req.params.id);
  if (!group) return res.send({ status: "NOT_FOUND" });
  if (group.id === "owner") return res.send({ status: "PROTECTED" }); // owner tidak bisa diubah
  group.menus = req.body.menus;
  save(F.groups, groups);
  res.send({ status: "OK" });
});

// ========================
// DIVISI
// ========================
app.get("/divisi", requireLevel(99), (req, res) => res.send(load(F.divisi, [])));

app.post("/divisi", requireLevel(2), (req, res) => {
  const { nama, deskripsi, owner, manager, koordinator } = req.body;
  if (!nama || !nama.trim()) return res.send({ status: "ERROR", msg: "Nama divisi wajib diisi" });
  const list = load(F.divisi, []);
  if (list.find(d => d.nama.toLowerCase() === nama.trim().toLowerCase()))
    return res.send({ status: "EXIST", msg: "Divisi sudah ada" });
  list.push({
    id: Date.now().toString(),
    nama: nama.trim(),
    deskripsi: (deskripsi||"").trim(),
    owner: (owner||"").trim(),
    manager: (manager||"").trim(),
    koordinator: (koordinator||"").trim(),
    createdAt: new Date().toISOString()
  });
  save(F.divisi, list);
  res.send({ status: "OK" });
});

app.put("/divisi/:id", requireLevel(2), (req, res) => {
  const list = load(F.divisi, []);
  const item = list.find(d => d.id === req.params.id);
  if (!item) return res.send({ status: "NOT_FOUND" });
  const oldNama = item.nama;
  if (req.body.nama)        item.nama        = req.body.nama.trim();
  if (req.body.deskripsi !== undefined) item.deskripsi = req.body.deskripsi.trim();
  if (req.body.owner       !== undefined) item.owner       = req.body.owner.trim();
  if (req.body.manager     !== undefined) item.manager     = req.body.manager.trim();
  if (req.body.koordinator !== undefined) item.koordinator = req.body.koordinator.trim();
  save(F.divisi, list);

  // Update jabatan semua anggota di divisi ini
  const users = load(F.users, {});
  Object.keys(users).forEach(u => {
    const usr = users[u];
    // Normalisasi ke array
    if (!Array.isArray(usr.divisi)) usr.divisi = usr.divisi ? [usr.divisi] : [];
    // Jika nama divisi berubah, update field divisi user
    const idx2 = usr.divisi.indexOf(oldNama);
    if (idx2 !== -1) usr.divisi[idx2] = item.nama;
    // Update jabatan berdasarkan posisi di divisi (prioritas tertinggi)
    if (usr.divisi.includes(item.nama)) {
      const priority = { "Owner": 1, "Manager": 2, "Koordinator": 3, "Anggota": 4 };
      let bestJabatan = "Anggota";
      usr.divisi.forEach(dNama => {
        const dItem = list.find(d => d.nama === dNama);
        if (!dItem) return;
        let jab = "Anggota";
        if (dItem.owner === u)            jab = "Owner";
        else if (dItem.manager === u)     jab = "Manager";
        else if (dItem.koordinator === u) jab = "Koordinator";
        if ((priority[jab] || 4) < (priority[bestJabatan] || 4)) bestJabatan = jab;
      });
      usr.jabatan = bestJabatan;
    }
  });
  save(F.users, users);
  res.send({ status: "OK" });
});

app.delete("/divisi/:id", requireLevel(2), (req, res) => {
  const list = load(F.divisi, []);
  const idx  = list.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  // Hapus divisi ini dari array divisi semua user
  const divisiNama = list[idx].nama;
  const users = load(F.users, {});
  Object.values(users).forEach(u => {
    if (!Array.isArray(u.divisi)) u.divisi = u.divisi ? [u.divisi] : [];
    u.divisi = u.divisi.filter(d => d !== divisiNama);
  });
  save(F.users, users);
  list.splice(idx, 1);
  save(F.divisi, list);
  res.send({ status: "OK" });
});

// Assign anggota ke divisi — jabatan otomatis dari posisi divisi, support multi-divisi
app.put("/anggota/:username/divisi", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const u = req.params.username;

  // Normalisasi field divisi ke array
  if (!Array.isArray(users[u].divisi)) {
    users[u].divisi = users[u].divisi ? [users[u].divisi] : [];
  }

  const divisiNamaBaru = req.body.divisi || "";   // nama divisi yg ditambahkan
  const action         = req.body.action || "add"; // "add" | "remove" | "set"

  if (action === "remove") {
    // Keluarkan dari divisi tertentu
    users[u].divisi = users[u].divisi.filter(d => d !== divisiNamaBaru);
  } else if (action === "set") {
    // Ganti seluruh array (dipakai dari detail-anggota)
    users[u].divisi = Array.isArray(req.body.divisiList) ? req.body.divisiList : (divisiNamaBaru ? [divisiNamaBaru] : []);
  } else {
    // "add" — tambahkan jika belum ada
    if (divisiNamaBaru && !users[u].divisi.includes(divisiNamaBaru)) {
      users[u].divisi.push(divisiNamaBaru);
    }
  }

  // Update jabatan: prioritas dari divisi pertama; jika tanpa divisi → default group
  const divisiList = load(F.divisi, []);
  if (!users[u].divisi.length) {
    const grp = users[u].group;
    users[u].jabatan = grp === "owner" ? "Owner" : grp === "admin" ? "Admin" : "Anggota";
  } else {
    // Cek posisi di masing-masing divisi, ambil jabatan tertinggi
    const priority = { "Owner": 1, "Manager": 2, "Koordinator": 3, "Anggota": 4 };
    let bestJabatan = "Anggota";
    users[u].divisi.forEach(dNama => {
      const divisi = divisiList.find(d => d.nama === dNama);
      if (!divisi) return;
      let jab = "Anggota";
      if (divisi.owner === u)            jab = "Owner";
      else if (divisi.manager === u)     jab = "Manager";
      else if (divisi.koordinator === u) jab = "Koordinator";
      if ((priority[jab] || 4) < (priority[bestJabatan] || 4)) bestJabatan = jab;
    });
    users[u].jabatan = bestJabatan;
  }

  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// AREA (multi-area)
// ========================
// GET /areas — data lengkap (nama, lat, lng, radius, id) hanya untuk Owner/Admin
app.get("/areas", requireLevel(2), (req, res) => res.send(load(F.areas, [])));

// GET /areas/info — hanya jumlah area aktif, tanpa koordinat. Aman untuk semua user login.
app.get("/areas/info", requireLevel(99), (req, res) => {
  const areas = load(F.areas, []);
  const active = areas.filter(a => a.active !== false);
  res.send({ total: areas.length, activeCount: active.length });
});

// POST /areas/check — semua user login bisa pakai. Kirim lat/lng user, server kembalikan
// ========================
// RULES
// ========================
// GET rules — hanya owner/admin
app.get("/rules", requireLevel(2), (req, res) => {
  res.send(getRules());
});

// PUT rules — update daftar mess
app.put("/rules/mess", requireLevel(2), (req, res) => {
  const { messList } = req.body;
  if (!Array.isArray(messList)) return res.send({ status: "ERROR" });
  const rules = getRules();
  rules.messList = messList;
  save(F.rules, rules);
  res.send({ status: "OK" });
});

// GET /rules/toggles — ambil state semua toggle auto clock-out
app.get("/rules/toggles", requireLevel(2), (req, res) => {
  const rules = getRules();
  res.json({
    toggleMess:          rules.toggleMess          !== false,
    toggleLuarRadius:    rules.toggleLuarRadius     !== false,
    toggleTidakAdaGPS:   rules.toggleTidakAdaGPS    !== false,
    toggleMidnightSplit: rules.toggleMidnightSplit  !== false,
    toggleTugasLuar:     rules.toggleTugasLuar      !== false,
  });
});

// POST /rules/toggles — update satu atau beberapa toggle
app.post("/rules/toggles", requireLevel(2), (req, res) => {
  const allowed = ["toggleMess", "toggleLuarRadius", "toggleTidakAdaGPS", "toggleMidnightSplit", "toggleTugasLuar"];
  const rules = getRules();
  let changed = false;
  allowed.forEach(k => {
    if (typeof req.body[k] === "boolean") {
      rules[k] = req.body[k];
      changed = true;
      console.log(`[RULES] Toggle ${k} → ${req.body[k] ? "ON" : "OFF"} oleh ${req._requester}`);
    }
  });
  if (!changed) return res.status(400).json({ status: "NO_CHANGE" });
  save(F.rules, rules);
  res.json({
    status: "OK",
    toggleMess:          rules.toggleMess          !== false,
    toggleLuarRadius:    rules.toggleLuarRadius     !== false,
    toggleTidakAdaGPS:   rules.toggleTidakAdaGPS    !== false,
    toggleMidnightSplit: rules.toggleMidnightSplit  !== false,
    toggleTugasLuar:     rules.toggleTugasLuar      !== false,
  });
});

// ========================
// AREA
// ========================
// status (IN_AREA / NEAR / OUT) + nama area + jarak. Koordinat area TIDAK dikirim ke client.
app.post("/areas/check", requireLevel(99), (req, res) => {
  const { lat, lng, accuracy } = req.body;
  if (lat == null || lng == null) return res.send({ status: "NO_LOCATION" });

  const areas = load(F.areas, []);
  const activeAreas = areas.filter(a => a.active !== false);
  if (!activeAreas.length) return res.send({ status: "NO_AREA" });

  let nearest = null;
  let nearestDist = Infinity;

  activeAreas.forEach(a => {
    const d = dist(lat, lng, a.lat, a.lng);
    if (d < nearestDist) { nearestDist = d; nearest = a; }
  });

  const accTolerance = Math.min(accuracy != null ? accuracy : 0, 350);
  const radius = (nearest.radius || 100) + accTolerance;

  if (nearestDist <= radius) {
    res.send({ status: "IN_AREA", name: nearest.name, distance: Math.round(nearestDist) });
  } else if (nearestDist <= 2000) {
    res.send({ status: "NEAR", name: nearest.name, distance: Math.round(nearestDist) });
  } else {
    res.send({ status: "OUT", name: nearest.name, distance: Math.round(nearestDist) });
  }
});

app.post("/areas", requireLevel(2), (req, res) => {
  const { name, lat, lng, radius } = req.body;
  if (!name || !lat || !lng) return res.send({ status: "ERROR" });
  const areas = load(F.areas, []);
  areas.push({ id: Date.now().toString(), name, lat: parseFloat(lat), lng: parseFloat(lng), radius: parseInt(radius)||100, active: true });
  save(F.areas, areas);
  res.send({ status: "OK" });
});

app.put("/areas/:id", requireLevel(2), (req, res) => {
  const areas = load(F.areas, []);
  const area  = areas.find(a => a.id === req.params.id);
  if (!area) return res.send({ status: "NOT_FOUND" });
  Object.assign(area, { name: req.body.name||area.name, lat: parseFloat(req.body.lat)||area.lat, lng: parseFloat(req.body.lng)||area.lng, radius: parseInt(req.body.radius)||area.radius, active: req.body.active !== undefined ? req.body.active : area.active });
  save(F.areas, areas);
  res.send({ status: "OK" });
});

app.delete("/areas/:id", requireLevel(2), (req, res) => {
  const areas = load(F.areas, []);
  const idx   = areas.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  areas.splice(idx, 1);
  save(F.areas, areas);
  res.send({ status: "OK" });
});

// ========================
// HARI LIBUR & KEBIJAKAN CUTI
// ========================

// Daftar agama unik dari seluruh anggota — hanya user yang sudah login
app.get("/libur/agama-list", requireLevel(99), (req, res) => {
  const users = load(F.users, {});
  const agamaSet = new Set();
  Object.values(users).forEach(u => { if (u.agama) agamaSet.add(u.agama); });
  res.send([...agamaSet]);
});

app.get("/libur", requireLevel(99), (req, res) => {
  const data = load(F.libur, []);
  // Admin & owner boleh lihat field anggota[]; user biasa tidak perlu tahu username rekan lain
  if (req._requesterLevel <= 2) return res.send(data);
  const safeData = data.map(({ anggota, ...rest }) => rest);
  res.send(safeData);
});

app.post("/libur", requireLevel(2), (req, res) => {
  const { name, dateStart, dateEnd, type, agama, date } = req.body;
  if (!name || (!dateStart && !date)) return res.send({ status: "ERROR" });

  const users = load(F.users, {});
  const start = dateStart || date;
  const end   = dateEnd   || start;

  // Auto-assign anggota berdasarkan agama
  let anggota = [];
  if (type === "agama" && agama && agama.length > 0) {
    anggota = Object.keys(users).filter(u => agama.includes(users[u].agama || ""));
  } else if (type === "nasional") {
    anggota = Object.keys(users);
  }

  const data = load(F.libur, []);
  data.push({
    id:        Date.now().toString(),
    name,
    date:      start,        // backward compat
    dateStart: start,
    dateEnd:   end,
    type:      type || "nasional",
    agama:     agama || [],
    anggota,
    createdAt: new Date().toISOString()
  });
  save(F.libur, data);
  res.send({ status: "OK" });
});

// ── Import bulk libur dari CSV/XLSX (data sudah diparse di frontend) ──
app.post("/libur/import", requireLevel(2), (req, res) => {
  const { rows, type, agama } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return res.send({ status: "ERROR", msg: "Tidak ada data" });

  const users   = load(F.users, {});
  const data    = load(F.libur, []);
  let imported  = 0;
  const errors  = [];

  rows.forEach((row, i) => {
    const name      = (row.name || row.nama || row.Nama || row.Name || "").toString().trim();
    const dateStart = (row.dateStart || row.date_start || row.tanggal_mulai || row.tanggal || row.Tanggal || row.Date || "").toString().trim();
    const dateEnd   = (row.dateEnd   || row.date_end   || row.tanggal_akhir || "").toString().trim();

    if (!name || !dateStart) { errors.push(`Baris ${i+2}: nama/tanggal kosong`); return; }

    // Validasi format tanggal YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) { errors.push(`Baris ${i+2}: format tanggal salah (${dateStart}), gunakan YYYY-MM-DD`); return; }

    const end = (dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) ? dateEnd : dateStart;

    const agamaArr = agama ? [agama] : [];
    let anggota = [];
    if (type === "agama" && agamaArr.length > 0) {
      anggota = Object.keys(users).filter(u => agamaArr.includes(users[u].agama || ""));
    } else if (type === "nasional") {
      anggota = Object.keys(users);
    }

    data.push({
      id:        Date.now().toString() + "_" + i,
      name,
      date:      dateStart,
      dateStart,
      dateEnd:   end,
      type:      type || "nasional",
      agama:     agamaArr,
      anggota,
      createdAt: new Date().toISOString()
    });
    imported++;
  });

  save(F.libur, data);
  res.send({ status: "OK", imported, errors });
});

app.delete("/libur/:id", requireLevel(2), (req, res) => {
  const data = load(F.libur, []);
  const idx  = data.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  data.splice(idx, 1); save(F.libur, data); res.send({ status: "OK" });
});

// Kebijakan Cuti
app.get("/kebijakan-cuti", requireLevel(99), (req, res) => res.send(load(F.kebijakanCuti, [])));

app.post("/kebijakan-cuti", requireLevel(2), (req, res) => {
  const { nama, jenis, hari, periode, berlaku, keterangan, satuanDurasi } = req.body;
  if (!nama || !jenis) return res.send({ status: "ERROR" });
  const data = load(F.kebijakanCuti, []);
  const newKebijakan = {
    id:          Date.now().toString(),
    nama,
    jenis:       jenis,
    satuanDurasi: satuanDurasi || "hari", // "hari" | "jam"
    hari:        hari ? parseInt(hari) : null,
    periode:     periode || "tahunan",
    berlaku:     berlaku || "semua",
    keterangan:  keterangan || "",
    createdAt:   new Date().toISOString()
  };
  data.push(newKebijakan);
  save(F.kebijakanCuti, data);
  res.send({ status: "OK", id: newKebijakan.id });
});

app.delete("/kebijakan-cuti/:id", requireLevel(2), (req, res) => {
  const data = load(F.kebijakanCuti, []);
  const idx  = data.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  if (data[idx]._locked) return res.status(403).send({ status: "LOCKED", msg: "Kebijakan default tidak dapat dihapus." });
  data.splice(idx, 1); save(F.kebijakanCuti, data); res.send({ status: "OK" });
});

// ========================
// AKTIVITAS
// ========================
app.get("/aktivitas", requireLevel(3), (req, res) => {
  const data = load(F.aktivitas, []);
  res.send(data.slice(-100).reverse());
});

// AKTIVITAS KUSTOM (daftar jenis aktivitas)
// ========================
app.get("/aktivitas-kustom", requireLevel(99), (req, res) => {
  res.send(load(F.aktivitasKustom, []));
});
app.post("/aktivitas-kustom", requireLevel(3), (req, res) => {
  const { nama } = req.body;
  if (!nama || !nama.trim()) return res.status(400).send({ error: "Nama wajib diisi" });
  const list = load(F.aktivitasKustom, []);
  if (list.includes(nama.trim())) return res.status(409).send({ error: "Sudah ada" });
  list.push(nama.trim());
  save(F.aktivitasKustom, list);
  res.send({ ok: true });
});
app.delete("/aktivitas-kustom/:nama", requireLevel(3), (req, res) => {
  const nama = decodeURIComponent(req.params.nama);
  const list = load(F.aktivitasKustom, []).filter(a => a !== nama);
  save(F.aktivitasKustom, list);
  res.send({ ok: true });
});

// ========================
// TIMESHEET
// ========================

// Konversi hari cuti → jam sesuai hari dalam seminggu
// Senin–Jumat = 8 jam efektif (07.00-15.00 default), Sabtu = 6 jam
// Sesuai rule: Senin-Jumat = 7 jam, Sabtu = 5 jam (net setelah istirahat 1 jam)
function cutiHariKeJam(dateStr) {
  const d = new Date(dateStr + "T12:00:00"); // T12 agar tidak geser timezone
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 0) return 0; // Minggu tidak masuk jam kerja
  if (dow === 6) return 5; // Sabtu
  return 7;               // Senin–Jumat
}

// Cek apakah tanggal adalah hari libur nasional/agama untuk user tertentu
// Return: { isLibur, namaLibur, jamLibur } atau null
function cekHariLibur(dateStr, username) {
  const users     = load(F.users, {});
  const liburList = load(F.libur, []);
  const agamaUser = (users[username] || {}).agama || "";

  const libur = liburList.find(l => {
    const tgl      = l.date || l.dateStart;
    const tglAkhir = l.dateEnd || tgl;
    if (!tgl) return false;
    if (dateStr < tgl || dateStr > tglAkhir) return false;
    if (l.type === "nasional") return true;
    if (l.type === "agama") {
      const agamaLibur = Array.isArray(l.agama) ? l.agama : [l.agama];
      return agamaLibur.includes(agamaUser);
    }
    return false;
  });

  if (!libur) return null;
  return {
    isLibur:   true,
    namaLibur: libur.name || libur.nama || "Hari Libur",
    jamLibur:  cutiHariKeJam(dateStr),
  };
}

// Hitung kontribusi jam dari satu pengajuan cuti (status disetujui) untuk tanggal tertentu
function jamCutiUntukTanggal(p, dateStr) {
  if (p.status !== "disetujui") return 0;
  const tMulai = p.tanggalMulai, tAkhir = p.tanggalAkhir || p.tanggalMulai;
  if (!tMulai) return 0;
  // Cek apakah dateStr masuk rentang
  if (dateStr < tMulai || dateStr > tAkhir) return 0;

  if (p.satuanDurasi === "jam") {
    // Cuti satuan jam: hanya pada tanggalMulai
    return dateStr === tMulai ? parseFloat(p.durasi) : 0;
  } else {
    // Cuti satuan hari: konversi ke jam sesuai hari
    return cutiHariKeJam(dateStr);
  }
}

// GET timesheet mingguan — satu baris per user per tanggal dalam rentang minggu
// Query: ?weekStart=YYYY-MM-DD  (Senin)
// Response: [{ username, nama, jabatan, divisi, days: [{date, dow, jamKerja, jamCuti, keteranganCuti}], totalJam, totalCuti }]
app.get("/timesheet/weekly", requireLevel(99), (req, res) => {
  const { weekStart } = req.query;
  // Identitas requester diambil dari middleware (X-User header), bukan dari query string
  const requester = req._requester;
  if (!weekStart) return res.send({ error: "weekStart required" });

  const monDate = new Date(weekStart + "T12:00:00"); // T12 aman dari shift timezone
  const dates = Array.from({length: 7}, (_, i) => {
    const d = new Date(monDate); d.setDate(monDate.getDate() + i);
    return d.toLocaleDateString("sv-SE"); // pakai lokal bukan UTC
  }); // [Sen, Sel, Rab, Kam, Jum, Sab, Min]

  const data      = load(F.data, []);
  const users     = load(F.users, {});
  const pengajuan = load(F.pengajuanCuti, []);
  const divisiList = load(F.divisi, []);

  const requesterGroup = requester ? getUserGroup(requester) : "anggota";
  const requesterLevel = requester ? getUserLevel(requester) : 99;

  // Tentukan siapa yang bisa dilihat oleh requester
  function canViewUser(targetUsername) {
    if (!requester) return false;
    if (requester === targetUsername) return true; // lihat diri sendiri
    if (requesterGroup === "owner" || requesterGroup === "admin") return true;
    if (requesterGroup === "manager") {
      // Hanya anggota/koordinator di divisi yang sama
      const myDivisi = Array.isArray(users[requester]?.divisi)
        ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUsername]?.divisi)
        ? users[targetUsername].divisi : (users[targetUsername]?.divisi ? [users[targetUsername].divisi] : []);
      const tgtGroup = getUserGroup(targetUsername);
      if (tgtGroup === "owner" || tgtGroup === "admin") return false;
      return myDivisi.some(d => tgtDivisi.includes(d));
    }
    if (requesterGroup === "koordinator") {
      // Koordinator: lihat anggota yang ia koordinir di divisinya
      const myDivisi = Array.isArray(users[requester]?.divisi)
        ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const divObjs = divisiList.filter(d => myDivisi.includes(d.nama) && d.koordinator === requester);
      if (!divObjs.length) return false;
      const tgtDivisi = Array.isArray(users[targetUsername]?.divisi)
        ? users[targetUsername].divisi : (users[targetUsername]?.divisi ? [users[targetUsername].divisi] : []);
      return divObjs.some(d => tgtDivisi.includes(d.nama));
    }
    return false; // anggota: hanya diri sendiri (sudah di-handle baris pertama)
  }

  function canEditUser(targetUsername) {
    // Admin & owner bisa edit siapa saja termasuk diri sendiri
    if (requesterGroup === "owner" || requesterGroup === "admin") return true;
    if (requester === targetUsername) return false; // selain admin/owner tidak bisa edit diri sendiri
    if (requesterGroup === "manager") {
      const myDivisi = Array.isArray(users[requester]?.divisi)
        ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUsername]?.divisi)
        ? users[targetUsername].divisi : (users[targetUsername]?.divisi ? [users[targetUsername].divisi] : []);
      const tgtGroup = getUserGroup(targetUsername);
      if (tgtGroup === "owner" || tgtGroup === "admin" || tgtGroup === "manager") return false;
      return myDivisi.some(d => tgtDivisi.includes(d));
    }
    return false;
  }

  const visibleUsers = Object.keys(users).filter(u => canViewUser(u));

  const result = visibleUsers.map(username => {
    const u = users[username];
    const userPengajuan = pengajuan.filter(p => p.username === username && p.status === "disetujui");

    const days = dates.map(dateStr => {
      // Multi-sesi: ambil SEMUA record tanggal ini
      const recs = data.filter(d => d.user === username && d.date === dateStr);
      const rec  = recs.find(d => !d.jamKeluar) || recs[recs.length - 1] || null;
      let jamKerja = 0;
      let isActive = false;
      const nowMs  = Date.now();

      recs.forEach(r => {
        if (r.jamMasuk && r.jamKeluar) {
          const masukMs  = new Date(r.jamMasuk).getTime();
          const keluarMs = new Date(r.jamKeluar).getTime();
          if (isNaN(masukMs) || isNaN(keluarMs)) return;
          const work = (keluarMs - masukMs) / 3600000;
          let bt = 0;
          (r.breaks || []).forEach(b => {
            if (b.end) {
              const bs = new Date(b.start).getTime(), be = new Date(b.end).getTime();
              if (!isNaN(bs) && !isNaN(be)) bt += (be - bs) / 3600000;
            }
          });
          jamKerja += Math.max(0, work - bt);
        } else if (r.jamMasuk && !r.jamKeluar) {
          const masukMs2 = new Date(r.jamMasuk).getTime();
          if (isNaN(masukMs2)) return;
          const work = (nowMs - masukMs2) / 3600000;
          let bt = 0;
          (r.breaks || []).forEach(b => {
            const bStart = new Date(b.start).getTime();
            if (isNaN(bStart)) return;
            const bEnd   = b.end ? new Date(b.end).getTime() : nowMs;
            if (!isNaN(bEnd)) bt += (bEnd - bStart) / 3600000;
          });
          jamKerja += Math.max(0, work - bt);
          isActive = true;
        }
      });

      // Cek apakah tanggal ini hari libur nasional/agama untuk user ini
      const infoLiburTs = cekHariLibur(dateStr, username);

      // Cari semua cuti yang berlaku di tanggal ini
      const cutiAktif = userPengajuan.filter(p => jamCutiUntukTanggal(p, dateStr) > 0);
      const jamCuti   = cutiAktif.reduce((s, p) => s + jamCutiUntukTanggal(p, dateStr), 0);
      const keteranganCuti = [
        ...cutiAktif.map(p => p.kebijakanNama || "Cuti"),
        ...(infoLiburTs && !rec ? [infoLiburTs.namaLibur] : [])
      ].join(", ");

      // Cek apakah ada record yang benar-benar masuk kerja di hari ini
      // Record midnight-split (autoClockIn jam 00:00) TIDAK dihitung sebagai masuk kerja di hari libur
      // karena itu hanya lanjutan shift dari hari sebelumnya
      const recMasukBeneran = recs.find(r => {
        if (!r.jamMasuk) return false;
        if (r.autoClockIn && r.autoClockInReason === "midnight-split") return false;
        return true;
      });

      // Hari libur tidak masuk (atau hanya ada midnight-split) → isi jam otomatis agar tidak defisit
      if (infoLiburTs && !recMasukBeneran && jamKerja === 0 && jamCuti === 0) {
        jamKerja = infoLiburTs.jamLibur;
      }

      // Hari libur, masuk kerja beneran (bukan midnight-split):
      // - Jam kerja aktual → masuk tabungan Tukar Libur (jamTL)
      // - Jam libur tetap diisi di kolom jamKerja (untuk keperluan rekap 40jam)
      // Hari Minggu masuk kerja → tetap reguler, tidak jadi TL
      const isHariMinggu = new Date(dateStr + "T12:00:00").getDay() === 0;
      let jamTLHariIni = 0;
      if (infoLiburTs && recMasukBeneran && !isActive && !isHariMinggu) {
        // Hari libur nasional/agama masuk → jam kerja aktual masuk TL
        jamTLHariIni = jamKerja;
        jamKerja     = infoLiburTs.jamLibur;
      } else if (infoLiburTs && recMasukBeneran && !isActive && isHariMinggu) {
        // Minggu masuk → reguler, jamKerja tetap, tidak ada TL
        jamTLHariIni = 0;
        // jamKerja tetap dari hasil hitung aktual (tidak di-override)
      } else if (infoLiburTs && !recMasukBeneran) {
        // Libur tidak masuk → jamKerja sudah diisi di atas, tidak ada TL
        jamTLHariIni = 0;
      }

      return {
        date: dateStr,
        dow:  new Date(dateStr + "T12:00:00").getDay(), // 0=Min
        jamKerja:  parseFloat(jamKerja.toFixed(2)),
        isActive,
        jamMasuk:  rec?.jamMasuk || null,
        sesiCount: recs.length,
        breakDetik: isActive ? (rec?.breaks||[]).reduce((s,b) => {
                      const bStart = new Date(b.start).getTime();
                      const bEnd   = b.end ? new Date(b.end).getTime() : Date.now();
                      return s + (bEnd - bStart) / 1000;
                    }, 0) : 0,
        jamSesiSelesai: parseFloat(recs.filter(r => r.jamMasuk && r.jamKeluar).reduce((s,r) => {
          const work = (new Date(r.jamKeluar) - new Date(r.jamMasuk)) / 3600000;
          let bt = 0; (r.breaks||[]).forEach(b => { if (b.end) bt += (new Date(b.end)-new Date(b.start))/3600000; });
          return s + Math.max(0, work - bt);
        }, 0).toFixed(2)),
        jamCuti:     parseFloat(jamCuti.toFixed(2)),
        keteranganCuti,
        isHariLibur: !!infoLiburTs,
        namaLibur:   infoLiburTs ? infoLiburTs.namaLibur : null,
        jamTL:       parseFloat((jamTLHariIni || 0).toFixed(2)),
        absenId:     rec ? rec.date : null,
        jamKeluar:   rec?.jamKeluar || null,
      };
    });

    const totalJamKerja = days.reduce((s, d) => s + d.jamKerja, 0);
    const totalJamCuti  = days.reduce((s, d) => s + d.jamCuti, 0);
    const totalEfektif  = totalJamKerja + totalJamCuti; // untuk cek 40 jam

    return {
      username,
      nama:    u.namaLengkap || username,
      jabatan: u.jabatan || "-",
      divisi:  Array.isArray(u.divisi) ? u.divisi.join(", ") : (u.divisi || "-"),
      photo:   u.photo || "",
      group:   u.group || "anggota",
      days,
      totalJamKerja: parseFloat(totalJamKerja.toFixed(2)),
      totalJamCuti:  parseFloat(totalJamCuti.toFixed(2)),
      totalEfektif:  parseFloat(totalEfektif.toFixed(2)),
      canEdit:       canEditUser(username),
    };
  });

  result.sort((a, b) => (a.nama || a.username || '').localeCompare(b.nama || b.username || '', 'id'));
  res.send({ weekDates: dates, users: result });
});

// ========================
// REKAP BULANAN (Admin/Owner only)
// GET /rekap/monthly?month=YYYY-MM&requester=username
// ========================
app.get("/rekap/monthly", requireLevel(99), (req, res) => {
  const { month } = req.query;
  if (!month) return res.send({ error: "month required" });

  // Identitas requester diambil dari middleware (X-User header), bukan dari query string
  const requester = req._requester;
  const rGroup    = getUserGroup(requester);
  if (rGroup !== "owner" && rGroup !== "admin") {
    return res.status(403).send({ error: "Forbidden" });
  }

  const [year, mon] = month.split("-").map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay  = new Date(year, mon, 0);

  // Semua tanggal dalam bulan ini
  const allDates = [];
  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split("T")[0]);
  }

  // Hitung weekStart (Senin) untuk setiap tanggal
  function getWeekStart(dateStr) {
    const d   = new Date(dateStr + "T00:00:00");
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const m  = new Date(d);
    m.setDate(d.getDate() + diff);
    return m.toISOString().split("T")[0];
  }

  // Kelompokkan tanggal ke minggu (urut)
  const weekMap = new Map();
  allDates.forEach(dt => {
    const ws = getWeekStart(dt);
    if (!weekMap.has(ws)) weekMap.set(ws, []);
    weekMap.get(ws).push(dt);
  });

  const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  const weeks = [];
  let weekIdx = 1;
  weekMap.forEach((dates, ws) => {
    const fmtD = d => { const o = new Date(d+"T00:00:00"); return `${o.getDate()} ${BULAN[o.getMonth()]}`; };
    weeks.push({
      weekIdx,
      weekStart: ws,
      weekLabel: `Minggu ${weekIdx}`,
      weekRange: `${fmtD(dates[0])} - ${fmtD(dates[dates.length-1])}`,
      dates
    });
    weekIdx++;
  });

  const data      = load(F.data, []);
  const users     = load(F.users, {});
  const pengajuan = load(F.pengajuanCuti, []);

  const result = Object.keys(users).map(username => {
    const u = users[username];
    const userPengajuan = pengajuan.filter(p => p.username === username && p.status === "disetujui");

    // Semua hari dalam bulan (flat) — multi-sesi + sesi aktif
    const days = allDates.map(dateStr => {
      const recs  = data.filter(d => d.user === username && d.date === dateStr);
      const nowMs = Date.now();
      let jamKerja = 0;
      recs.forEach(rec => {
        if (!rec.jamMasuk) return;
        if (rec.jamKeluar) {
          // Sudah clock out — pakai jamKerja tersimpan jika ada, fallback hitung raw
          if (rec.jamKerja) {
            jamKerja += rec.jamKerja;
          } else {
            const masukMs  = new Date(rec.jamMasuk).getTime();
            if (isNaN(masukMs)) return;
            const keluarMs = new Date(rec.jamKeluar).getTime();
            const work = (keluarMs - masukMs) / 3600000;
            let bt = 0;
            (rec.breaks || []).forEach(b => {
              const bs = new Date(b.start).getTime();
              if (isNaN(bs)) return;
              bt += Math.max(0, (b.end ? new Date(b.end).getTime() : keluarMs) - bs) / 3600000;
            });
            jamKerja += Math.max(0, work - bt);
          }
        } else {
          // Masih aktif — hitung sampai sekarang (realtime untuk bulan berjalan)
          const masukMs  = new Date(rec.jamMasuk).getTime();
          if (isNaN(masukMs)) return;
          const work = (nowMs - masukMs) / 3600000;
          let bt = 0;
          (rec.breaks || []).forEach(b => {
            const bs = new Date(b.start).getTime();
            if (isNaN(bs)) return;
            bt += Math.max(0, (b.end ? new Date(b.end).getTime() : nowMs) - bs) / 3600000;
          });
          jamKerja += Math.max(0, work - bt);
        }
      });
      const cutiAktif = userPengajuan.filter(p => jamCutiUntukTanggal(p, dateStr) > 0);
      const jamCuti   = cutiAktif.reduce((s, p) => s + jamCutiUntukTanggal(p, dateStr), 0);
      const keteranganCuti = cutiAktif.map(p => p.kebijakanNama || "Cuti").join(", ");
      const ws = getWeekStart(dateStr);
      const weekIdxForDay = weeks.find(w => w.weekStart === ws)?.weekIdx || 0;
      return {
        date: dateStr,
        dow:  new Date(dateStr + "T12:00:00").getDay(),
        weekIdx: weekIdxForDay,
        jamKerja:  parseFloat(jamKerja.toFixed(2)),
        jamCuti:   parseFloat(jamCuti.toFixed(2)),
        keteranganCuti,
      };
    });

    // Total per minggu
    const weekTotals = weeks.map(w => {
      const wDays = days.filter(d => d.weekIdx === w.weekIdx);
      return {
        weekIdx: w.weekIdx,
        totalEfektif: parseFloat(wDays.reduce((s, d) => s + d.jamKerja + d.jamCuti, 0).toFixed(2))
      };
    });

    const totalBulan = parseFloat(days.reduce((s, d) => s + d.jamKerja + d.jamCuti, 0).toFixed(2));

    return {
      username,
      nama:       u.namaLengkap || username,
      jabatan:    u.jabatan || "-",
      group:      u.group || "anggota",
      divisi:     Array.isArray(u.divisi) ? u.divisi.join(", ") : (u.divisi || "-"),
      days,
      weekTotals,
      totalBulan,
    };
  });

  result.sort((a, b) => (a.nama || a.username || '').localeCompare(b.nama || b.username || '', 'id'));
  res.send({ month, weeks, allDates, users: result });
});

// GET: summary timesheet bulanan (tetap ada untuk kompatibilitas)
app.get("/timesheet", requireLevel(2), (req, res) => {
  const month = req.query.month;
  if (!month) return res.send([]);
  const data  = load(F.data, []);
  const users = load(F.users, {});
  const pengajuan = load(F.pengajuanCuti, []);
  const result = Object.keys(users).map(username => {
    const recs = data.filter(d => d.user === username && d.date.startsWith(month) && d.jamMasuk);
    let totalJam = 0, overtime = 0;
    const nowMsTs = Date.now();

    // Kumpulkan jam absensi fisik per hari — multi-sesi + sesi aktif
    const jamPerHari = {};
    recs.forEach(d => {
      const masukMs  = new Date(d.jamMasuk).getTime();
      if (isNaN(masukMs)) return;
      const keluarMs = d.jamKeluar ? new Date(d.jamKeluar).getTime() : nowMsTs;
      const work = (keluarMs - masukMs) / 3600000;
      let bt = 0;
      (d.breaks||[]).forEach(b => {
        const bs = new Date(b.start).getTime();
        if (isNaN(bs)) return;
        const be = b.end ? new Date(b.end).getTime() : (d.jamKeluar ? keluarMs : nowMsTs);
        bt += Math.max(0, (be - bs) / 3600000);
      });
      const net = Math.max(0, work - bt);
      jamPerHari[d.date] = (jamPerHari[d.date] || 0) + net;
      totalJam += net;
    });

    // Tambahkan jam cuti yang disetujui (hari yang tidak ada absen fisik)
    const userPengajuan = pengajuan.filter(p => p.username === username && p.status === "disetujui");
    // Ambil semua hari dalam bulan ini
    const [yr, mn] = month.split("-").map(Number);
    const daysInMonth = new Date(yr, mn, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${month}-${String(i).padStart(2,"0")}`;
      const jamCutiHari = userPengajuan.reduce((s, p) => s + jamCutiUntukTanggal(p, dateStr), 0);
      if (jamCutiHari > 0) totalJam += jamCutiHari;
    }

    // Hitung overtime berdasarkan total efektif per minggu (multi-sesi + aktif)
    const weekMap = {};
    recs.forEach(d => {
      const wk = weekKey(d.date);
      if (!weekMap[wk]) weekMap[wk] = 0;
      const masukMs3  = new Date(d.jamMasuk).getTime();
      if (isNaN(masukMs3)) return;
      const keluarMs3 = d.jamKeluar ? new Date(d.jamKeluar).getTime() : nowMsTs;
      const work3 = (keluarMs3 - masukMs3) / 3600000;
      let bt3 = 0;
      (d.breaks||[]).forEach(b => {
        const bs = new Date(b.start).getTime();
        if (isNaN(bs)) return;
        const be = b.end ? new Date(b.end).getTime() : (d.jamKeluar ? keluarMs3 : nowMsTs);
        bt3 += Math.max(0, (be - bs) / 3600000);
      });
      weekMap[wk] += Math.max(0, work3 - bt3);
    });
    // Tambahkan jam cuti per minggu
    userPengajuan.forEach(p => {
      const tMulai = p.tanggalMulai;
      const tAkhir = p.tanggalAkhir || tMulai;
      if (!tMulai || !tMulai.startsWith(month.slice(0,4))) return;
      let cur = new Date(tMulai + "T00:00:00");
      const end = new Date(tAkhir + "T00:00:00");
      while (cur <= end) {
        const dateStr = cur.toISOString().split("T")[0];
        const jamHari = jamCutiUntukTanggal(p, dateStr);
        if (jamHari > 0) {
          const wk = weekKey(dateStr);
          if (!weekMap[wk]) weekMap[wk] = 0;
          weekMap[wk] += jamHari;
        }
        cur.setDate(cur.getDate() + 1);
      }
    });
    Object.values(weekMap).forEach(jam => { if (jam > JAM_WAJIB_MINGGU) overtime += (jam - JAM_WAJIB_MINGGU); });

    return { user: username, totalDays: recs.length, totalJam: totalJam.toFixed(1), overtime: overtime.toFixed(1) };
  });
  res.send(result);
});

// ── Helper: hitung ulang overtime & tukar libur user di background (non-blocking) ──
// Dipanggil otomatis setelah edit/hapus/tambah absen agar data selalu sinkron.
// Tidak mengubah jamTerpakai, hariDiambil, carry-over, atau data cuti — hanya
// update jamTL_reguler (overtime) dan jamAkumulasi (tukar libur).
function hitungOvertimeBackground(username) {
  try {
    const tahun      = new Date().getFullYear();
    const data       = load(F.data, []);
    const kuota      = load(F.kuotaCuti, {});
    const pengajuan  = load(F.pengajuanCuti, []);
    const liburList  = load(F.libur, []);
    const usersData  = load(F.users, {});
    const agamaUser  = (usersData[username] || {}).agama || "";

    const weekMap     = {};
    let   jamTLLibur  = 0;
    const tglAbsenSet = new Set(
      data.filter(d => d.user === username && d.date).map(d => d.date)
    );

    // Grup per tanggal (multi-sesi), akumulasi jam
    // Sertakan juga sesi aktif (jamKeluar null) di minggu yang sudah lewat
    const wkToday1 = weekKey(new Date().toLocaleDateString("sv-SE"));
    const dateMap = {};
    data.filter(d => {
      if (d.user !== username || !d.date || !d.date.startsWith(String(tahun))) return false;
      if (d.jamKeluar) return true;
      return weekKey(d.date) < wkToday1;
    }).forEach(d => {
        if (!dateMap[d.date]) dateMap[d.date] = [];
        dateMap[d.date].push(d);
      });

    Object.entries(dateMap).forEach(([dateStr, sesiList]) => {
      const jamKerja = sesiList.reduce((s, d) => s + hitungJamKerja(d, d.jamKeluar ? null : Date.now()), 0);
      const infoLibur    = cekHariLibur(dateStr, username);
      const isHariMinggu = new Date(dateStr + "T12:00:00").getDay() === 0;
      const wk           = weekKey(dateStr);
      if (!weekMap[wk]) weekMap[wk] = 0;
      if (infoLibur && !isHariMinggu) {
        // Libur nasional/agama bukan Minggu → jam aktual masuk TL, weekMap pakai jam libur
        jamTLLibur += jamKerja;
        weekMap[wk] += infoLibur.jamLibur;
      } else {
        // Reguler atau libur jatuh Minggu → semua masuk weekMap biasa
        weekMap[wk] += jamKerja;
      }
    });

    // Hari libur tanpa absen → isi weekMap agar tidak defisit
    liburList.forEach(l => {
      const tgl      = l.date || l.dateStart;
      const tglAkhir = l.dateEnd || tgl;
      if (!tgl || !tgl.startsWith(String(tahun))) return;
      let berlaku = false;
      if (l.type === "nasional") berlaku = true;
      else if (l.type === "agama") {
        const ag = Array.isArray(l.agama) ? l.agama : [l.agama];
        berlaku = ag.includes(agamaUser);
      }
      if (!berlaku) return;
      let cur = new Date(tgl + "T12:00:00");
      const end = new Date(tglAkhir + "T12:00:00");
      while (cur <= end) {
        const dateStr = cur.toLocaleDateString("sv-SE");
        if (dateStr.startsWith(String(tahun))) {
          const jamLibur = cutiHariKeJam(dateStr);
          if (jamLibur > 0 && !tglAbsenSet.has(dateStr)) {
            const wk = weekKey(dateStr);
            if (!weekMap[wk]) weekMap[wk] = 0;
            weekMap[wk] += jamLibur;
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    });

    // Jam cuti tahunan disetujui → tambah ke weekMap
    const cutiUser = pengajuan.filter(p =>
      p.username === username && p.status === "disetujui" &&
      p.kuotaKey === "tahunan" && p.tanggalMulai && p.tanggalMulai.startsWith(String(tahun))
    );
    cutiUser.forEach(p => {
      let cur = new Date(p.tanggalMulai + "T12:00:00");
      const end = new Date((p.tanggalAkhir || p.tanggalMulai) + "T12:00:00");
      while (cur <= end) {
        const dateStr = cur.toLocaleDateString("sv-SE");
        const jamHari = cutiHariKeJam(dateStr);
        if (jamHari > 0) {
          const wk = weekKey(dateStr);
          if (!weekMap[wk]) weekMap[wk] = 0;
          weekMap[wk] += jamHari;
        }
        cur.setDate(cur.getDate() + 1);
      }
    });

    // Hitung total overtime (kelebihan 40 jam/minggu)
    let totalOvertimeJam = 0;
    Object.values(weekMap).forEach(jam => {
      if (jam > JAM_WAJIB_MINGGU) totalOvertimeJam += (jam - JAM_WAJIB_MINGGU);
    });

    const k        = initKuotaUser(kuota, username, tahun);
    const tglHitung = new Date().toLocaleDateString("sv-SE");

    // Update overtime — hanya timpa jamTL_reguler & riwayat otomatis
    k.overtime.jamTL_reguler = parseFloat(totalOvertimeJam.toFixed(2));
    k.overtime.riwayat = (k.overtime.riwayat || []).filter(r => ["carry-over","migrasi","manual"].includes(r.sumber));
    if (totalOvertimeJam > 0) {
      k.overtime.riwayat.push({ tanggal: tglHitung, jam: parseFloat(totalOvertimeJam.toFixed(2)), sumber: "overtime", keterangan: "Kelebihan jam kerja mingguan (auto)" });
    }

    // Update tukar libur — hanya timpa jamAkumulasi & riwayat otomatis
    k.tukarLibur = k.tukarLibur || { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
    k.tukarLibur.jamAkumulasi = parseFloat(jamTLLibur.toFixed(2));
    k.tukarLibur.riwayat = (k.tukarLibur.riwayat || []).filter(r => ["carry-over","migrasi","manual"].includes(r.sumber));
    if (jamTLLibur > 0) {
      k.tukarLibur.riwayat.push({ tanggal: tglHitung, jam: parseFloat(jamTLLibur.toFixed(2)), sumber: "libur", keterangan: "Kerja di hari libur nasional/agama (auto)" });
    }

    save(F.kuotaCuti, kuota);
    console.log(`[AUTO-OT] Overtime & tukar libur ${username} diperbarui otomatis`);
  } catch (e) {
    console.error(`[AUTO-OT] Gagal hitung otomatis untuk ${username}:`, e.message);
  }
}

// POST: admin/manager create absen manual
app.post("/timesheet/absen-manual", requireLevel(2), (req, res) => {
  // Identitas requester diambil dari middleware (X-User header), bukan dari body
  const requester = req._requester;
  const { targetUser, date, jamMasuk, jamKeluar } = req.body;
  if (!requester || !targetUser || !date || !jamMasuk || !jamKeluar)
    return res.send({ status: "ERROR", msg: "Data tidak lengkap" });

  const requesterGroup = getUserGroup(requester);
  const targetGroup    = getUserGroup(targetUser);

  // Admin & owner bisa buat absen manual untuk siapa saja termasuk diri sendiri
  let canCreate = false;
  if (requesterGroup === "owner" || requesterGroup === "admin") canCreate = true;
  else if (requesterGroup === "manager") {
    if (targetGroup !== "owner" && targetGroup !== "admin" && targetGroup !== "manager") {
      const users = load(F.users, {});
      const myDivisi  = Array.isArray(users[requester]?.divisi) ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUser]?.divisi) ? users[targetUser].divisi : (users[targetUser]?.divisi ? [users[targetUser].divisi] : []);
      canCreate = myDivisi.some(d => tgtDivisi.includes(d));
    }
  }
  if (!canCreate) return res.send({ status: "FORBIDDEN" });

  const data = load(F.data, []);
  // Cek duplikat per sesi — jika sesi dikirim cari record spesifik, else ambil yang pertama
  const sesiManual = req.body.sesi != null ? Number(req.body.sesi) : null;
  const allExisting = data.filter(d => d.user === targetUser && d.date === date);
  let existing;
  if (sesiManual != null) {
    existing = allExisting.find(r => r.sesi === sesiManual);
  }
  if (!existing) existing = allExisting[0] || null;
  // Normalisasi timestamp ke UTC ISO agar konsisten
  const jamMasukNorm  = normalizeTime(jamMasuk)  || jamMasuk;
  const jamKeluarNorm = normalizeTime(jamKeluar) || jamKeluar;
  const { breaks: breaksData, catatan, aktivitas, lokasiNama } = req.body;
  const breaksNorm = (breaksData || []).map(b => ({
    start: normalizeTime(b.start) || b.start,
    end:   b.end ? (normalizeTime(b.end) || b.end) : null
  }));
  if (existing) {
    // Update jam jika sudah ada
    existing.jamMasuk  = jamMasukNorm;
    existing.jamKeluar = jamKeluarNorm;
    if (breaksNorm.length > 0) existing.breaks = breaksNorm;
    if (catatan   !== undefined) existing.catatan    = catatan;
    if (aktivitas !== undefined) existing.aktivitas  = aktivitas;
    if (lokasiNama !== undefined) existing.lokasiNama = lokasiNama;
  } else {
    data.push({
      user: targetUser, date, jamMasuk: jamMasukNorm, jamKeluar: jamKeluarNorm,
      lokasi: { lat: 0, lng: 0 }, lokasiNama: lokasiNama || "",
      foto: "", breaks: breaksNorm,
      aktivitas: aktivitas || "", catatan: catatan || "",
      createdManually: true, createdBy: requester,
      createdAt: new Date().toISOString()
    });
  }
  save(F.data, data);
  // Overtime tidak dihitung realtime — hanya diakumulasi setiap Minggu 23:59
  res.send({ status: "OK" });
});

// PUT: edit jam absen (oleh manager/admin/owner)
app.put("/timesheet/absen/:user/:date", requireLevel(2), (req, res) => {
  // Identitas requester diambil dari middleware (X-User header), bukan dari body
  const requester = req._requester;
  const { jamMasuk, jamKeluar } = req.body;
  const { user: targetUser, date } = req.params;

  const requesterGroup = getUserGroup(requester);
  const targetGroup    = getUserGroup(targetUser);

  // Admin & owner boleh edit absen siapa saja termasuk diri sendiri
  // Manager & di bawahnya tidak bisa edit diri sendiri
  if (requester === targetUser && requesterGroup !== "owner" && requesterGroup !== "admin") {
    return res.send({ status: "FORBIDDEN", msg: "Tidak bisa edit absen sendiri" });
  }

  let canEdit = false;
  if (requesterGroup === "owner" || requesterGroup === "admin") canEdit = true;
  else if (requesterGroup === "manager") {
    if (targetGroup !== "owner" && targetGroup !== "admin" && targetGroup !== "manager") {
      const users = load(F.users, {});
      const myDivisi  = Array.isArray(users[requester]?.divisi) ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUser]?.divisi) ? users[targetUser].divisi : (users[targetUser]?.divisi ? [users[targetUser].divisi] : []);
      canEdit = myDivisi.some(d => tgtDivisi.includes(d));
    }
  }
  if (!canEdit) return res.send({ status: "FORBIDDEN" });

  const data = load(F.data, []);

  // Cari record spesifik — pakai sesi jika dikirim, fallback ke record pertama
  // sesi dikirim dari client untuk multi-sesi / midnight-split
  const sesi = req.body.sesi != null ? Number(req.body.sesi) : null;
  const allRecs = data.filter(d => d.user === targetUser && d.date === date);
  let rec;
  if (sesi != null) {
    rec = allRecs.find(r => r.sesi === sesi);
  }
  // Fallback: jika sesi tidak ditemukan atau tidak dikirim, ambil record pertama
  if (!rec) rec = allRecs[0];
  if (!rec) return res.send({ status: "NOT_FOUND" });

  if (jamMasuk)        rec.jamMasuk  = normalizeTime(jamMasuk)  || jamMasuk;
  if (jamKeluar)       rec.jamKeluar = normalizeTime(jamKeluar) || jamKeluar;
  if (req.body.breaks !== undefined) {
    rec.breaks = (req.body.breaks || []).map(b => ({
      start: normalizeTime(b.start) || b.start,
      end:   b.end ? (normalizeTime(b.end) || b.end) : null
    }));
  }
  if (req.body.catatan   !== undefined) rec.catatan    = req.body.catatan;
  if (req.body.aktivitas !== undefined) rec.aktivitas  = req.body.aktivitas;
  if (req.body.lokasiNama !== undefined) rec.lokasiNama = req.body.lokasiNama;
  save(F.data, data);
  // Overtime tidak dihitung realtime — hanya diakumulasi setiap Minggu 23:59
  res.send({ status: "OK", sesi: rec.sesi });
});
// GET: ambil semua sesi (parts) untuk user + tanggal tertentu
app.get("/timesheet/absen/:user/:date", requireLevel(2), (req, res) => {
  const { user, date } = req.params;
  const data = load(F.data, []);
  const recs = data
    .filter(d => d.user === user && d.date === date)
    .map(r => ({
      sesi:       r.sesi || 1,
      jamMasuk:   r.jamMasuk  || null,
      jamKeluar:  r.jamKeluar || null,
      breaks:     r.breaks    || [],
      catatan:    r.catatan   || "",
      aktivitas:  r.aktivitas || "",
      lokasiNama: r.lokasiNama || "",
      createdManually: !!r.createdManually,
      autoClockIn: !!r.autoClockIn,
    }))
    .sort((a, b) => a.sesi - b.sesi);
  res.json({ status: "OK", sesi: recs });
});

app.delete("/timesheet/absen/:user/:date", requireLevel(2), (req, res) => {
  const { user, date } = req.params;
  // Jika query ?sesi=N dikirim → hapus sesi spesifik saja
  // Jika tidak dikirim → hapus semua sesi di tanggal itu
  const sesiDel = req.query.sesi != null ? Number(req.query.sesi) : null;
  const data = load(F.data, []);
  const before = data.length;
  let filtered;
  if (sesiDel != null) {
    filtered = data.filter(d => !(d.user === user && d.date === date && d.sesi === sesiDel));
  } else {
    filtered = data.filter(d => !(d.user === user && d.date === date));
  }
  if (filtered.length === before) return res.status(404).json({ status: "NOT_FOUND", message: "Record tidak ditemukan" });
  save(F.data, filtered);
  // Overtime tidak dihitung realtime — hanya diakumulasi setiap Minggu 23:59
  res.json({ status: "OK", deleted: before - filtered.length });
});



// ========================
// KUOTA CUTI
// ========================

// Jam kerja wajib per minggu (Senin-Minggu)
const JAM_WAJIB_MINGGU = 40;

// Helper: hitung jam kerja bersih dari satu record absensi
// Pakai rec.jamKerja tersimpan jika ada (disimpan saat clock out), fallback ke hitung raw
function hitungJamKerja(rec, fallbackEndMs = null) {
  if (!rec.jamMasuk) return 0;
  if (!rec.jamKeluar && !fallbackEndMs) return 0;
  if (rec.jamKerja && rec.jamKeluar) return rec.jamKerja; // sudah tersimpan saat clock out
  const masukMs  = new Date(rec.jamMasuk).getTime();
  if (isNaN(masukMs)) return 0;
  const keluarMs = rec.jamKeluar
    ? new Date(rec.jamKeluar).getTime()
    : (fallbackEndMs || Date.now());
  if (isNaN(keluarMs)) return 0;
  const work = (keluarMs - masukMs) / 3600000;
  let bt = 0;
  (rec.breaks || []).forEach(b => {
    if (!b.end) return;
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    if (!isNaN(bs) && !isNaN(be) && be > bs) bt += (be - bs) / 3600000;
  });
  return Math.max(0, work - bt);
}

// Helper: week key "YYYY-Www" (ISO week, Senin = awal minggu)
function weekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day; // Senin
  const mon = new Date(d); mon.setDate(d.getDate() + diff);
  const year = mon.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));
  const weekNum = Math.floor((mon - startOfWeek1) / (7 * 86400000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

// Helper: inisialisasi kuota default per user (tahunan & overtime)
function initKuotaUser(kuota, username, tahun) {
  if (!kuota[username]) kuota[username] = {};
  const key = String(tahun);
  if (!kuota[username][key]) {
    // Carry-over: ambil sisa jamTL dari tahun sebelumnya (tidak hangus)
    const prevKey  = String(tahun - 1);
    const prevData = kuota[username][prevKey];
    const carryOver = prevData
      ? Math.max(0, (prevData.overtime?.jamTL_libur  || 0)
                  + (prevData.overtime?.jamTL_reguler || 0)
                  - (prevData.overtime?.jamTerpakai   || 0))
      : 0;

    // Carry-over tukarLibur dari tahun lalu (tidak hangus)
    const prevTL      = prevData ? (prevData.tukarLibur || {}) : {};
    const carryOverTL = Math.max(0,
      (prevTL.jamAkumulasi || 0) + (prevTL.jamCarryOver || 0) - (prevTL.jamTerpakai || 0)
    );
    // Carry-over overtime dari tahun lalu
    const prevOT      = prevData ? (prevData.overtime || {}) : {};
    const carryOverOT = Math.max(0,
      ((prevOT.jamTL_reguler || 0) + (prevOT.jamCarryOver || 0)) - (prevOT.jamTerpakai || 0)
    );

    kuota[username][key] = {
      tahunan: { total: 12, terpakai: 0, resetAt: `${tahun}-12-31` },

      // Overtime: hanya dari kelebihan 40 jam/minggu
      overtime: {
        jamTL_reguler: 0,
        jamCarryOver:  parseFloat(carryOverOT.toFixed(2)),
        jamTerpakai:   0,
        hariDiambil:   0,
        riwayat: carryOverOT > 0 ? [{
          tanggal:    `${tahun}-01-01`,
          jam:        parseFloat(carryOverOT.toFixed(2)),
          sumber:     "carry-over",
          keterangan: `Saldo Overtime dibawa dari tahun ${tahun - 1}`,
        }] : [],
      },

      // Tukar Libur: hanya dari kerja di hari libur nasional/agama
      tukarLibur: {
        jamAkumulasi: 0,
        jamCarryOver: parseFloat(carryOverTL.toFixed(2)),
        jamTerpakai:  0,
        hariDiambil:  0,
        riwayat: carryOverTL > 0 ? [{
          tanggal:    `${tahun}-01-01`,
          jam:        parseFloat(carryOverTL.toFixed(2)),
          sumber:     "carry-over",
          keterangan: `Saldo Tukar Libur dibawa dari tahun ${tahun - 1}`,
        }] : [],
      },
    };
  }
  // Migrasi: data lama overtime → struktur baru
  const d = kuota[username][key];
  if (d.overtime && d.overtime.jamAkumulasi !== undefined && d.overtime.jamTL_reguler === undefined) {
    const lama = d.overtime.jamAkumulasi || 0;
    d.overtime = {
      jamTL_reguler: parseFloat(lama.toFixed(2)),
      jamCarryOver:  0,
      jamTerpakai:   0,
      hariDiambil:   d.overtime.hariDiambil || 0,
      riwayat:       lama > 0 ? [{ tanggal: `${tahun}-01-01`, jam: lama, sumber: "migrasi", keterangan: "Saldo overtime lama (migrasi)" }] : [],
    };
  }
  // Migrasi: jamTL_libur yang lama → pindah ke tukarLibur
  if (d.overtime && d.overtime.jamTL_libur !== undefined && !d.tukarLibur) {
    const lamaLibur = d.overtime.jamTL_libur || 0;
    d.tukarLibur = {
      jamAkumulasi: parseFloat(lamaLibur.toFixed(2)),
      jamCarryOver: 0,
      jamTerpakai:  0,
      hariDiambil:  0,
      riwayat:      lamaLibur > 0 ? [{ tanggal: `${tahun}-01-01`, jam: lamaLibur, sumber: "migrasi", keterangan: "Saldo TL libur lama (migrasi)" }] : [],
    };
    delete d.overtime.jamTL_libur;
  }
  // Pastikan tukarLibur selalu ada
  if (!d.tukarLibur) {
    d.tukarLibur = { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
  }
  return kuota[username][key];
}

// Helper: saldo overtime (kelebihan jam mingguan)
function saldoOvertimeJam(ot) {
  const masuk = (ot.jamTL_reguler || 0) + (ot.jamCarryOver || 0);
  return Math.max(0, masuk - (ot.jamTerpakai || 0));
}
function saldoOvertimeHari(ot, jamPerHari = 5) {
  const j = saldoOvertimeJam(ot);
  return { hari: Math.floor(j / jamPerHari), sisaJam: parseFloat((j % jamPerHari).toFixed(2)), totalJam: parseFloat(j.toFixed(2)) };
}

// Helper: saldo tukar libur (kerja di hari libur nasional/agama)
function saldoTukarLiburJam(tl) {
  const masuk = (tl.jamAkumulasi || 0) + (tl.jamCarryOver || 0);
  return Math.max(0, masuk - (tl.jamTerpakai || 0));
}
function saldoTukarLiburHari(tl, jamPerHari = 5) {
  const j = saldoTukarLiburJam(tl);
  return { hari: Math.floor(j / jamPerHari), sisaJam: parseFloat((j % jamPerHari).toFixed(2)), totalJam: parseFloat(j.toFixed(2)) };
}

// Backward compat
function saldoTLJam(d)  { return saldoOvertimeJam(d); }
function saldoTLHari(d) { return saldoOvertimeHari(d); }

// GET kuota semua user (admin view)
app.get("/kuota-cuti", requireLevel(2), (req, res) => {
  const users  = load(F.users, {});
  const kuota  = load(F.kuotaCuti, {});
  const kebijakan = load(F.kebijakanCuti, []);
  const tahun  = parseInt(req.query.tahun) || new Date().getFullYear();
  // Kebijakan custom jenis kuota
  const customKebijakan = kebijakan.filter(k => !k._default && k.jenis === "kuota");

  const result = Object.keys(users).sort((a, b) => {
    return (users[a]?.namaLengkap || a).localeCompare(users[b]?.namaLengkap || b, 'id');
  }).map(username => {
    const k = initKuotaUser(kuota, username, tahun);
    const u = users[username];
    // Hitung saldo untuk ditampilkan di UI
    k.overtime._saldo   = saldoOvertimeHari(k.overtime);
    if (k.tukarLibur) k.tukarLibur._saldo = saldoTukarLiburHari(k.tukarLibur);
    // Attach custom kuota
    if (!k.customKuota) k.customKuota = {};
    customKebijakan.forEach(ck => {
      if (!k.customKuota[ck.id]) {
        k.customKuota[ck.id] = { nama: ck.nama, total: 0, terpakai: 0, satuanDurasi: ck.satuanDurasi || "hari" };
      } else {
        k.customKuota[ck.id].nama = ck.nama;
        k.customKuota[ck.id].satuanDurasi = ck.satuanDurasi || "hari";
      }
    });
    return {
      username,
      nama: u.namaLengkap || username,
      divisi: u.divisi || "-",
      tahunan:  k.tahunan,
      overtime: k.overtime,
      customKuota: k.customKuota
    };
  });
  // Simpan jika ada inisialisasi baru
  save(F.kuotaCuti, kuota);
  res.send(result);
});

// GET kuota milik user sendiri
app.get("/kuota-cuti/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const kuota = load(F.kuotaCuti, {});
  const kebijakan = load(F.kebijakanCuti, []);
  const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
  const k = initKuotaUser(kuota, req.params.user, tahun);
  // Attach custom kuota
  const customKebijakan = kebijakan.filter(ck => !ck._default && ck.jenis === "kuota");
  if (!k.customKuota) k.customKuota = {};
  customKebijakan.forEach(ck => {
    if (!k.customKuota[ck.id]) {
      k.customKuota[ck.id] = { nama: ck.nama, total: 0, terpakai: 0, satuanDurasi: ck.satuanDurasi || "hari" };
    } else {
      k.customKuota[ck.id].nama = ck.nama;
      k.customKuota[ck.id].satuanDurasi = ck.satuanDurasi || "hari";
    }
  });
  // Tambah saldo untuk UI
  k.overtime._saldo = saldoOvertimeHari(k.overtime);
  k.tukarLibur = k.tukarLibur || { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
  k.tukarLibur._saldo = saldoTukarLiburHari(k.tukarLibur);
  save(F.kuotaCuti, kuota);
  res.send(k);
});

// POST: set custom kuota untuk kebijakan kustom (oleh admin/owner)
app.post("/kuota-cuti/set-custom", requireLevel(2), (req, res) => {
  const { kebijakanId, kebijakanNama, kuota: kuotaJumlah, tahun } = req.body;
  if (!kebijakanId || kuotaJumlah == null) return res.send({ status: "ERROR", msg: "Data tidak lengkap" });

  const kuotaData = load(F.kuotaCuti, {});
  const users = load(F.users, {});
  const kebijakan = load(F.kebijakanCuti, []);
  const ck = kebijakan.find(k => k.id === kebijakanId);
  if (!ck) return res.send({ status: "NOT_FOUND", msg: "Kebijakan tidak ditemukan" });

  const thn = parseInt(tahun) || new Date().getFullYear();

  // Set kuota untuk SEMUA user
  Object.keys(users).forEach(username => {
    const k = initKuotaUser(kuotaData, username, thn);
    if (!k.customKuota) k.customKuota = {};
    if (!k.customKuota[kebijakanId]) {
      k.customKuota[kebijakanId] = { nama: ck.nama, total: parseFloat(kuotaJumlah), terpakai: 0, satuanDurasi: ck.satuanDurasi || "hari" };
    } else {
      k.customKuota[kebijakanId].total = parseFloat(kuotaJumlah);
      k.customKuota[kebijakanId].nama  = ck.nama;
      k.customKuota[kebijakanId].satuanDurasi = ck.satuanDurasi || "hari";
    }
  });
  save(F.kuotaCuti, kuotaData);
  res.send({ status: "OK" });
});

// POST: hitung ulang overtime satu user berdasarkan data absensi (per-minggu)
app.post("/kuota-cuti/hitung-overtime/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const username = req.params.user;
  const tahun    = parseInt(req.query.tahun) || new Date().getFullYear();
  const data     = load(F.data, []);
  const kuota    = load(F.kuotaCuti, {});
  const pengajuan = load(F.pengajuanCuti, []);

  // Kumpulkan jam absensi fisik per minggu + deteksi hari libur
  const liburList  = load(F.libur, []);
  const usersData  = load(F.users, {});
  const agamaUser  = (usersData[username] || {}).agama || "";
  const weekMap    = {};
  let   jamTLLibur = 0; // TL dari kerja di hari libur nasional/agama
  const tglAbsenSet = new Set(
    data.filter(d => d.user === username && d.date).map(d => d.date)
  );

  // Grup per tanggal (multi-sesi), lalu akumulasi jam
  // Sertakan juga sesi aktif (jamKeluar null) di minggu yang sudah lewat
  const wkToday2 = weekKey(new Date().toLocaleDateString("sv-SE"));
  const dateMapOT = {};
  data.filter(d => {
    if (d.user !== username || !d.date || !d.date.startsWith(String(tahun))) return false;
    if (d.jamKeluar) return true;
    return weekKey(d.date) < wkToday2;
  }).forEach(d => {
      if (!dateMapOT[d.date]) dateMapOT[d.date] = [];
      dateMapOT[d.date].push(d);
    });
  Object.entries(dateMapOT).forEach(([dateStr, sesiList]) => {
    const jamKerja = sesiList.reduce((s, d) => s + hitungJamKerja(d, d.jamKeluar ? null : Date.now()), 0);
    const infoLibur    = cekHariLibur(dateStr, username);
    const isHariMinggu = new Date(dateStr + "T12:00:00").getDay() === 0;
    const wk           = weekKey(dateStr);
    if (!weekMap[wk]) weekMap[wk] = 0;
    if (infoLibur && !isHariMinggu) {
      jamTLLibur += jamKerja;
      weekMap[wk] += infoLibur.jamLibur;
    } else {
      weekMap[wk] += jamKerja;
    }
  });

  // Hari libur yang tidak ada absennya → otomatis isi weekMap agar tidak defisit
  liburList.forEach(l => {
    const tgl      = l.date || l.dateStart;
    const tglAkhir = l.dateEnd || tgl;
    if (!tgl || !tgl.startsWith(String(tahun))) return;
    let berlaku = false;
    if (l.type === "nasional") berlaku = true;
    else if (l.type === "agama") {
      const ag = Array.isArray(l.agama) ? l.agama : [l.agama];
      berlaku = ag.includes(agamaUser);
    }
    if (!berlaku) return;
    let cur = new Date(tgl + "T12:00:00");
    const end = new Date(tglAkhir + "T12:00:00");
    while (cur <= end) {
      const dateStr = cur.toLocaleDateString("sv-SE");
      if (dateStr.startsWith(String(tahun))) {
        const jamLibur = cutiHariKeJam(dateStr);
        if (jamLibur > 0 && !tglAbsenSet.has(dateStr)) {
          const wk = weekKey(dateStr);
          if (!weekMap[wk]) weekMap[wk] = 0;
          weekMap[wk] += jamLibur;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  });

  // Jam cuti tahunan disetujui → tambah ke weekMap (pakai T12)
  const cutiUser = pengajuan.filter(p =>
    p.username === username && p.status === "disetujui" &&
    p.kuotaKey === "tahunan" && p.tanggalMulai && p.tanggalMulai.startsWith(String(tahun))
  );
  cutiUser.forEach(p => {
    let cur = new Date(p.tanggalMulai + "T12:00:00");
    const end = new Date((p.tanggalAkhir || p.tanggalMulai) + "T12:00:00");
    while (cur <= end) {
      const dateStr = cur.toLocaleDateString("sv-SE");
      const jamHari = cutiHariKeJam(dateStr);
      if (jamHari > 0) {
        const wk = weekKey(dateStr);
        if (!weekMap[wk]) weekMap[wk] = 0;
        weekMap[wk] += jamHari;
      }
      cur.setDate(cur.getDate() + 1);
    }
  });

  // Total overtime = kelebihan 40 jam/minggu + TL dari kerja di hari libur
  let totalOvertimeJam = 0;
  Object.values(weekMap).forEach(jam => {
    if (jam > JAM_WAJIB_MINGGU) totalOvertimeJam += (jam - JAM_WAJIB_MINGGU);
  });
  const k = initKuotaUser(kuota, username, tahun);
  const tglHitung = new Date().toLocaleDateString("sv-SE");

  // Overtime: hanya kelebihan jam mingguan
  k.overtime.jamTL_reguler = parseFloat(totalOvertimeJam.toFixed(2));
  k.overtime.riwayat = (k.overtime.riwayat || []).filter(r => ["carry-over","migrasi","manual"].includes(r.sumber));
  if (totalOvertimeJam > 0) {
    k.overtime.riwayat.push({ tanggal: tglHitung, jam: parseFloat(totalOvertimeJam.toFixed(2)), sumber: "overtime", keterangan: "Kelebihan jam kerja mingguan" });
  }

  // Tukar Libur: hanya dari kerja di hari libur nasional/agama
  k.tukarLibur = k.tukarLibur || { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
  k.tukarLibur.jamAkumulasi = parseFloat(jamTLLibur.toFixed(2));
  k.tukarLibur.riwayat = (k.tukarLibur.riwayat || []).filter(r => ["carry-over","migrasi","manual"].includes(r.sumber));
  if (jamTLLibur > 0) {
    k.tukarLibur.riwayat.push({ tanggal: tglHitung, jam: parseFloat(jamTLLibur.toFixed(2)), sumber: "libur", keterangan: "Kerja di hari libur nasional/agama" });
  }

  save(F.kuotaCuti, kuota);
  res.send({
    status: "OK",
    overtime:   { jam: k.overtime.jamTL_reguler,   saldo: saldoOvertimeHari(k.overtime) },
    tukarLibur: { jam: k.tukarLibur.jamAkumulasi,   saldo: saldoTukarLiburHari(k.tukarLibur) },
  });
});

// POST: hitung overtime semua user sekaligus (bisa dipanggil cron/manual)
app.post("/kuota-cuti/hitung-overtime-semua", requireLevel(2), (req, res) => {
  const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
  const users = load(F.users, {});
  const data  = load(F.data, []);
  const kuota = load(F.kuotaCuti, {});
  const pengajuan = load(F.pengajuanCuti, []);

  const liburList = load(F.libur, []);

  Object.keys(users).forEach(username => {
    const agamaUsr   = (users[username] || {}).agama || "";
    const weekMap    = {};
    let   jamTLLibur = 0;
    const tglAbsenSet = new Set(
      data.filter(d => d.user === username && d.date).map(d => d.date)
    );

    // Grup per tanggal (multi-sesi)
    // Sertakan juga sesi aktif (jamKeluar null) di minggu yang sudah lewat
    const wkToday3 = weekKey(new Date().toLocaleDateString("sv-SE"));
    const dateMapSS = {};
    data.filter(d => {
      if (d.user !== username || !d.date || !d.date.startsWith(String(tahun))) return false;
      if (d.jamKeluar) return true;
      return weekKey(d.date) < wkToday3;
    }).forEach(d => { if (!dateMapSS[d.date]) dateMapSS[d.date] = []; dateMapSS[d.date].push(d); });
    Object.entries(dateMapSS).forEach(([dateStrX, sesiX]) => {
      const jamKerja = sesiX.reduce((s, d) => s + hitungJamKerja(d, d.jamKeluar ? null : Date.now()), 0);
      const infoLibur    = cekHariLibur(dateStrX, username);
      const isHariMinggu = new Date(dateStrX + "T12:00:00").getDay() === 0;
      const wk           = weekKey(dateStrX);
      if (!weekMap[wk]) weekMap[wk] = 0;
      if (infoLibur && !isHariMinggu) {
        jamTLLibur += jamKerja;
        weekMap[wk] += infoLibur.jamLibur;
      } else {
        weekMap[wk] += jamKerja;
      }
    });

    // Hari libur tidak masuk → otomatis isi weekMap
    liburList.forEach(l => {
      const tgl      = l.date || l.dateStart;
      const tglAkhir = l.dateEnd || tgl;
      if (!tgl || !tgl.startsWith(String(tahun))) return;
      let berlaku = false;
      if (l.type === "nasional") berlaku = true;
      else if (l.type === "agama") {
        const ag = Array.isArray(l.agama) ? l.agama : [l.agama];
        berlaku = ag.includes(agamaUsr);
      }
      if (!berlaku) return;
      let cur = new Date(tgl + "T12:00:00");
      const end = new Date(tglAkhir + "T12:00:00");
      while (cur <= end) {
        const dateStr = cur.toLocaleDateString("sv-SE");
        if (dateStr.startsWith(String(tahun))) {
          const jamLibur = cutiHariKeJam(dateStr);
          if (jamLibur > 0 && !tglAbsenSet.has(dateStr)) {
            const wk = weekKey(dateStr);
            if (!weekMap[wk]) weekMap[wk] = 0;
            weekMap[wk] += jamLibur;
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    });

    // Jam cuti tahunan → tambah ke weekMap (T12)
    const cutiUser = pengajuan.filter(p =>
      p.username === username && p.status === "disetujui" &&
      p.kuotaKey === "tahunan" && p.tanggalMulai && p.tanggalMulai.startsWith(String(tahun))
    );
    cutiUser.forEach(p => {
      let cur = new Date(p.tanggalMulai + "T12:00:00");
      const end = new Date((p.tanggalAkhir || p.tanggalMulai) + "T12:00:00");
      while (cur <= end) {
        const dateStr = cur.toLocaleDateString("sv-SE");
        const jamHari = cutiHariKeJam(dateStr);
        if (jamHari > 0) {
          const wk = weekKey(dateStr);
          if (!weekMap[wk]) weekMap[wk] = 0;
          weekMap[wk] += jamHari;
        }
        cur.setDate(cur.getDate() + 1);
      }
    });

    let totalOvertimeJam = 0;
    Object.values(weekMap).forEach(jam => { if (jam > JAM_WAJIB_MINGGU) totalOvertimeJam += (jam - JAM_WAJIB_MINGGU); });
    const kS   = initKuotaUser(kuota, username, tahun);
    const tglS = new Date().toLocaleDateString("sv-SE");
    kS.overtime.jamTL_reguler = parseFloat(totalOvertimeJam.toFixed(2));
    kS.overtime.riwayat = (kS.overtime.riwayat || []).filter(r => ["carry-over","migrasi","manual"].includes(r.sumber));
    if (totalOvertimeJam > 0) kS.overtime.riwayat.push({ tanggal: tglS, jam: parseFloat(totalOvertimeJam.toFixed(2)), sumber: "overtime", keterangan: "Kelebihan jam kerja mingguan" });
    kS.tukarLibur = kS.tukarLibur || { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
    kS.tukarLibur.jamAkumulasi = parseFloat(jamTLLibur.toFixed(2));
    kS.tukarLibur.riwayat = (kS.tukarLibur.riwayat || []).filter(r => ["carry-over","migrasi","manual"].includes(r.sumber));
    if (jamTLLibur > 0) kS.tukarLibur.riwayat.push({ tanggal: tglS, jam: parseFloat(jamTLLibur.toFixed(2)), sumber: "libur", keterangan: "Kerja di hari libur nasional/agama" });
  });
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK" });
});

// POST: catat pengambilan cuti tahunan (kurangi saldo)
app.post("/kuota-cuti/ambil-tahunan/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const { hari } = req.body;
  if (!hari || hari < 1) return res.send({ status: "ERROR", msg: "Jumlah hari tidak valid" });
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, req.params.user, tahun);
  const sisa = k.tahunan.total - k.tahunan.terpakai;
  if (hari > sisa) return res.send({ status: "ERROR", msg: "Saldo cuti tahunan tidak cukup" });
  k.tahunan.terpakai += parseInt(hari);
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK", sisa: k.tahunan.total - k.tahunan.terpakai });
});

// POST: catat pengambilan cuti overtime (kurangi jam akumulasi)
app.post("/kuota-cuti/ambil-overtime/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const { hari } = req.body;  // 1 hari TL = 5 jam
  if (!hari || hari < 1) return res.send({ status: "ERROR", msg: "Jumlah hari tidak valid" });
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, req.params.user, tahun);
  const jamDibutuhkan = parseInt(hari) * 5; // 1 hari TL = 5 jam
  const saldoAvail = saldoOvertimeJam(k.overtime);
  if (jamDibutuhkan > saldoAvail) return res.send({ status: "ERROR", msg: `Saldo Overtime tidak cukup (sisa: ${saldoOvertimeHari(k.overtime).hari} hari ${saldoOvertimeHari(k.overtime).sisaJam} jam)` });
  k.overtime.jamTerpakai = parseFloat(((k.overtime.jamTerpakai || 0) + jamDibutuhkan).toFixed(2));
  k.overtime.hariDiambil = (k.overtime.hariDiambil || 0) + parseInt(hari);
  k.overtime.riwayat = k.overtime.riwayat || [];
  k.overtime.riwayat.push({ tanggal: new Date().toLocaleDateString("sv-SE"), jam: -jamDibutuhkan, sumber: "ambil", keterangan: `Ambil ${hari} hari Overtime` });
  save(F.kuotaCuti, kuota);
  const saldoSetelah = saldoTLHari(k.overtime);
  res.send({ status: "OK", saldo: saldoSetelah });
});

// POST: reset cuti tahunan semua user (dipanggil tiap 31 Des → 1 Jan)
app.post("/kuota-cuti/reset-tahunan", requireLevel(2), (req, res) => {
  const tahunBaru = new Date().getFullYear();
  const users = load(F.users, {});
  const kuota = load(F.kuotaCuti, {});
  Object.keys(users).forEach(username => {
    initKuotaUser(kuota, username, tahunBaru); // buat entry tahun baru (12 hari fresh)
  });
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK", tahun: tahunBaru });
});

// ========================
// PENGAJUAN CUTI
// ========================

// Helper: level hirarki user
function getUserLevel(username) {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const u = users[username];
  if (!u) return 99;
  const g = groups.find(g => g.id === (u.group || "anggota"));
  return g ? g.level : 99;
}

function getUserGroup(username) {
  const users = load(F.users, {});
  const u = users[username];
  return u ? (u.group || "anggota") : "anggota";
}

// GET semua pengajuan cuti (admin/owner/manager bisa lihat semua, lainnya hanya miliknya)
app.get("/pengajuan-cuti", requireLevel(99), (req, res) => {
  // Identitas requester diambil dari middleware (X-User header), bukan dari query string
  const requester = req._requester;
  const { filter } = req.query;
  const pengajuan = load(F.pengajuanCuti, []);
  const requesterLevel = getUserLevel(requester);
  const requesterGroup = getUserGroup(requester);

  let list = pengajuan;
  // Non-admin/owner hanya lihat miliknya + approval scope
  if (requesterGroup !== "owner" && requesterGroup !== "admin") {
    const users = load(F.users, {});
    // Manager bisa lihat cuti semua anggota di divisinya + koordinator
    if (requesterGroup === "manager") {
      const myDivisi = (users[requester]?.divisi) || [];
      const myDivisiArr = Array.isArray(myDivisi) ? myDivisi : [myDivisi];
      list = pengajuan.filter(p => {
        if (p.username === requester) return true;
        const targetUser = users[p.username];
        if (!targetUser) return false;
        const targetGroup = targetUser.group || "anggota";
        if (targetGroup === "owner" || targetGroup === "admin") return false;
        // manager dan koordinator di divisi yg sama
        const targetDivisi = Array.isArray(targetUser.divisi) ? targetUser.divisi : (targetUser.divisi ? [targetUser.divisi] : []);
        return myDivisiArr.some(d => targetDivisi.includes(d));
      });
    } else {
      // koordinator & anggota: hanya lihat punya sendiri
      list = pengajuan.filter(p => p.username === requester);
    }
  }

  // Filter waktu — pakai tanggal lokal (bukan UTC) agar tidak geser di WITA
  const now = new Date();
  const nowLocal = now.toLocaleDateString("sv-SE"); // YYYY-MM-DD lokal
  if (filter === "hari") {
    list = list.filter(p => p.tanggalMulai === nowLocal);
  } else if (filter === "minggu") {
    // Mulai dari Senin (konsisten dengan timesheet)
    const day  = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const start = new Date(nowLocal + "T12:00:00"); start.setDate(start.getDate() + diff);
    const end   = new Date(start); end.setDate(start.getDate() + 6);
    const s = start.toLocaleDateString("sv-SE");
    const e = end.toLocaleDateString("sv-SE");
    list = list.filter(p => p.tanggalMulai >= s && p.tanggalMulai <= e);
  } else if (filter === "bulan") {
    const ym = nowLocal.slice(0, 7); // YYYY-MM
    list = list.filter(p => (p.tanggalMulai || "").startsWith(ym));
  } else if (filter === "tahun") {
    const yr = nowLocal.slice(0, 4); // YYYY
    list = list.filter(p => (p.tanggalMulai || "").startsWith(yr));
  }

  // Sertakan info nama
  const usersData = load(F.users, {});
  list = list.map(p => ({
    ...p,
    namaLengkap: usersData[p.username]?.namaLengkap || p.username,
    jabatan: usersData[p.username]?.jabatan || "-",
    groupTarget: usersData[p.username]?.group || "anggota",
  }));

  res.send(list.sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
});

// POST: ajukan cuti baru
app.post("/pengajuan-cuti", requireLevel(99), (req, res) => {
  // Identitas pengaju diambil dari middleware (X-User header), bukan dari body
  const username = req._requester;
  const { kebijakanId, kebijakanNama, kuotaKey, durasi, satuanDurasi,
          tanggalMulai, tanggalAkhir, jamMulai, jamAkhir } = req.body;
  if (!username || !kebijakanId || !durasi) return res.send({ status: "ERROR", msg: "Data tidak lengkap" });

  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, username, tahun);

  // Cek apakah ini kebijakan custom jenis kuota
  const kebijakan = load(F.kebijakanCuti, []);
  const kb = kebijakan.find(x => x.id === kebijakanId);
  const isCustomKuota = kb && !kb._default && kb.jenis === "kuota";

  // Validasi & kurangi saldo
  if (kuotaKey === "tahunan") {
    // durasi dikirim dalam HARI KERJA dari frontend (satuanDurasi="hari")
    const durasiHari = parseFloat(durasi);
    const sisa = k.tahunan.total - k.tahunan.terpakai;
    if (durasiHari > sisa) return res.send({ status: "ERROR", msg: `Saldo cuti tahunan tidak cukup (sisa: ${sisa} hari)` });
    k.tahunan.terpakai += durasiHari;
  } else if (kuotaKey === "overtime" || kuotaKey === "tukarLibur") {
    const satuanJam = satuanDurasi === "jam" ? parseFloat(durasi) : parseFloat(durasi) * 5; // 1 hari TL = 5 jam
    // Cek apakah pengajuan dari overtime atau tukarLibur
    const isTukarLibur = kuotaKey === "tukarLibur";
    if (isTukarLibur) {
      k.tukarLibur = k.tukarLibur || { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
      const saldoTL2 = saldoTukarLiburJam(k.tukarLibur);
      if (satuanJam > saldoTL2) return res.send({ status: "ERROR", msg: `Saldo Tukar Libur tidak cukup (sisa: ${saldoTukarLiburHari(k.tukarLibur).hari} hari ${saldoTukarLiburHari(k.tukarLibur).sisaJam} jam)` });
      k.tukarLibur.jamTerpakai = parseFloat(((k.tukarLibur.jamTerpakai || 0) + satuanJam).toFixed(2));
      k.tukarLibur.hariDiambil = (k.tukarLibur.hariDiambil || 0) + Math.ceil(satuanJam / 5);
      k.tukarLibur.riwayat = k.tukarLibur.riwayat || [];
      k.tukarLibur.riwayat.push({ tanggal: new Date().toLocaleDateString("sv-SE"), jam: -satuanJam, sumber: "ambil", keterangan: `Pengajuan Tukar Libur ${durasi} ${satuanDurasi}` });
    } else {
      const saldoAvail2 = saldoOvertimeJam(k.overtime);
      if (satuanJam > saldoAvail2) return res.send({ status: "ERROR", msg: `Saldo Overtime tidak cukup (sisa: ${saldoOvertimeHari(k.overtime).hari} hari ${saldoOvertimeHari(k.overtime).sisaJam} jam)` });
      k.overtime.jamTerpakai = parseFloat(((k.overtime.jamTerpakai || 0) + satuanJam).toFixed(2));
      k.overtime.riwayat = k.overtime.riwayat || [];
      k.overtime.riwayat.push({ tanggal: new Date().toLocaleDateString("sv-SE"), jam: -satuanJam, sumber: "ambil", keterangan: `Pengajuan Cuti Overtime ${durasi} ${satuanDurasi}` });
      if (satuanDurasi === "hari") k.overtime.hariDiambil = (k.overtime.hariDiambil || 0) + parseFloat(durasi);
    }
  } else if (isCustomKuota) {
    // Custom kuota: catat saldo
    if (!k.customKuota) k.customKuota = {};
    if (!k.customKuota[kebijakanId]) {
      k.customKuota[kebijakanId] = { nama: kb.nama, total: 0, terpakai: 0, satuanDurasi: kb.satuanDurasi || "hari" };
    }
    const ck = k.customKuota[kebijakanId];
    const sisa = ck.total - ck.terpakai;
    if (parseFloat(durasi) > sisa) {
      return res.send({ status: "ERROR", msg: `Saldo cuti "${kb.nama}" tidak cukup (sisa: ${sisa} ${ck.satuanDurasi || "hari"})` });
    }
    ck.terpakai += parseFloat(durasi);
  }
  // Jika Non-Kuota, tidak perlu catat saldo sama sekali
  save(F.kuotaCuti, kuota);

  const pengajuan = load(F.pengajuanCuti, []);
  const id = "cuti-" + Date.now() + "-" + Math.random().toString(36).slice(2,6);
  const entry = {
    id, username, kebijakanId, kebijakanNama, kuotaKey: kuotaKey || null,
    durasi: parseFloat(durasi), satuanDurasi: satuanDurasi || "hari",
    tanggalMulai: tanggalMulai || null, tanggalAkhir: tanggalAkhir || null,
    jamMulai: jamMulai || null, jamAkhir: jamAkhir || null,
    status: "menunggu",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectedReason: null,
    canceledBy: null, canceledAt: null,
    createdAt: new Date().toISOString()
  };
  pengajuan.push(entry);
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(username, "CUTI_AJUKAN", new Date().toISOString());

  // Push ke admin/owner/manager — ada pengajuan cuti baru
  const users = load(F.users, {});
  const namaUser = users[username]?.nama || username;
  const tglLabel = tanggalMulai ? (tanggalAkhir && tanggalAkhir !== tanggalMulai ? `${tanggalMulai} s/d ${tanggalAkhir}` : tanggalMulai) : "";
  sendPushToGroups(["owner", "admin", "manager"],
    "Pengajuan Cuti Baru 📋",
    `${namaUser} mengajukan ${kebijakanNama}${tglLabel ? " — " + tglLabel : ""}`
  ).catch(() => {});
  // WA — bertingkat sesuai jabatan pengaju (hemat kuota)
  //   Anggota / koordinator → notif ke Manager saja
  //   Manager / admin / owner → notif ke Owner saja
  const allUsers    = load(F.users, {});
  const pengajuGrp  = getUserGroup(username);
  const isAnggota   = ["anggota", "koordinator"].includes(pengajuGrp);
  const targetGrps  = isAnggota ? ["manager"] : ["owner"];
  Object.entries(allUsers).forEach(([uname, udata]) => {
    const grp = udata.group || "anggota";
    if (targetGrps.includes(grp) && udata.noHp) {
      sendFonnte(udata.noHp, `📋 *Pengajuan Cuti Baru*\n*${namaUser}* mengajukan *${kebijakanNama}*${tglLabel ? " — " + tglLabel : ""}\n\nSilakan buka aplikasi untuk menyetujui/menolak.`);
    }
  });

  res.send({ status: "OK", id });
});

// POST: approve cuti
app.post("/pengajuan-cuti/:id/approve", requireLevel(99), (req, res) => {
  // Identitas approver diambil dari middleware (X-User header), bukan dari body
  const approver = req._requester;
  const pengajuan = load(F.pengajuanCuti, []);
  const idx = pengajuan.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  const p = pengajuan[idx];

  // User tidak boleh approve cuti miliknya sendiri
  if (approver === p.username) return res.send({ status: "FORBIDDEN", msg: "Tidak bisa menyetujui cuti sendiri" });

  // Cek hak approve
  const approverGroup = getUserGroup(approver);
  const targetGroup   = getUserGroup(p.username);

  let canApprove = false;
  if (approverGroup === "owner" || approverGroup === "admin") {
    // Owner & admin bisa approve semua orang (admin sebagai backup jika owner tidak sempat)
    canApprove = true;
  } else if (approverGroup === "manager") {
    // Manager hanya bisa approve anggota & koordinator
    if (targetGroup === "anggota" || targetGroup === "koordinator") canApprove = true;
  }
  if (!canApprove) return res.send({ status: "FORBIDDEN", msg: "Tidak memiliki hak approve" });

  p.status     = "disetujui";
  p.approvedBy = approver;
  p.approvedAt = new Date().toISOString();
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(approver, "CUTI_APPROVE", new Date().toISOString());

  // Push ke pengaju — cutinya disetujui
  const tglLabel = p.tanggalMulai ? (p.tanggalAkhir && p.tanggalAkhir !== p.tanggalMulai ? `${p.tanggalMulai} s/d ${p.tanggalAkhir}` : p.tanggalMulai) : "";
  const usersAll = load(F.users, {});
  const namaApprover = usersAll[approver]?.namaLengkap || usersAll[approver]?.nama || approver;
  const namaPengaju  = usersAll[p.username]?.namaLengkap || usersAll[p.username]?.nama || p.username;
  sendPushToUser(p.username,
    "Cuti Disetujui ✅",
    `${p.kebijakanNama} kamu${tglLabel ? " (" + tglLabel + ")" : ""} telah disetujui oleh ${namaApprover}`
  ).catch(() => {});
  // Push ke owner & admin — audit trail siapa yang approve
  sendPushToGroups(["owner", "admin"],
    "Cuti Disetujui ✅",
    `Pengajuan cuti ${namaPengaju} (${p.kebijakanNama}${tglLabel ? " — " + tglLabel : ""}) telah di-approve oleh ${namaApprover}`
  ).catch(() => {});
  // WA ke pengaju — disetujui
  if (usersAll[p.username]?.noHp) sendFonnte(usersAll[p.username].noHp, `✅ *Cuti Disetujui*\nHai *${usersAll[p.username]?.nama || p.username}*, pengajuan *${p.kebijakanNama}*${tglLabel ? " (" + tglLabel + ")" : ""} telah *disetujui* oleh ${namaApprover}.`);

  res.send({ status: "OK" });
});

// POST: reject cuti (kembalikan saldo)
app.post("/pengajuan-cuti/:id/reject", requireLevel(99), (req, res) => {
  const { reason } = req.body;
  // Identitas approver diambil dari middleware (X-User header), bukan dari body
  const approver = req._requester;
  const pengajuan = load(F.pengajuanCuti, []);
  const idx = pengajuan.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  const p = pengajuan[idx];
  if (p.status !== "menunggu") return res.send({ status: "ERROR", msg: "Hanya cuti berstatus menunggu yang bisa di-reject" });

  // User tidak boleh reject cuti miliknya sendiri
  if (approver === p.username) return res.send({ status: "FORBIDDEN", msg: "Tidak bisa menolak cuti sendiri" });

  const approverGroup = getUserGroup(approver);
  const targetGroup   = getUserGroup(p.username);

  let canReject = false;
  if (approverGroup === "owner" || approverGroup === "admin") {
    // Owner & admin bisa reject semua orang (admin sebagai backup jika owner tidak sempat)
    canReject = true;
  } else if (approverGroup === "manager") {
    // Manager hanya bisa reject anggota & koordinator
    if (targetGroup === "anggota" || targetGroup === "koordinator") canReject = true;
  }
  if (!canReject) return res.send({ status: "FORBIDDEN" });

  // Kembalikan saldo
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, p.username, tahun);
  if (p.kuotaKey === "tahunan") {
    // durasi tersimpan dalam HARI, kembalikan langsung
    k.tahunan.terpakai = Math.max(0, k.tahunan.terpakai - parseFloat(p.durasi));
  } else if (p.kuotaKey === "overtime" || p.kuotaKey === "tukarLibur") {
    const jamKembali = p.satuanDurasi === "jam" ? parseFloat(p.durasi) : parseFloat(p.durasi) * 5;
    if (p.kuotaKey === "tukarLibur") {
      k.tukarLibur = k.tukarLibur || { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
      k.tukarLibur.jamTerpakai = parseFloat(Math.max(0, (k.tukarLibur.jamTerpakai || 0) - jamKembali).toFixed(2));
      k.tukarLibur.riwayat = k.tukarLibur.riwayat || [];
      k.tukarLibur.riwayat.push({ tanggal: new Date().toLocaleDateString("sv-SE"), jam: jamKembali, sumber: "kembali", keterangan: "Tukar Libur dibatalkan/ditolak" });
    } else {
      k.overtime.jamTerpakai = parseFloat(Math.max(0, (k.overtime.jamTerpakai || 0) - jamKembali).toFixed(2));
      k.overtime.riwayat = k.overtime.riwayat || [];
      k.overtime.riwayat.push({ tanggal: new Date().toLocaleDateString("sv-SE"), jam: jamKembali, sumber: "kembali", keterangan: "Cuti Overtime dibatalkan/ditolak" });
      if (p.satuanDurasi === "hari") k.overtime.hariDiambil = Math.max(0, (k.overtime.hariDiambil || 0) - parseFloat(p.durasi));
    }
  } else if (p.kebijakanId && k.customKuota && k.customKuota[p.kebijakanId]) {
    // Kembalikan saldo custom kuota
    const ck = k.customKuota[p.kebijakanId];
    ck.terpakai = Math.max(0, ck.terpakai - p.durasi);
  }
  save(F.kuotaCuti, kuota);

  p.status       = "ditolak";
  p.rejectedBy   = approver;
  p.rejectedAt   = new Date().toISOString();
  p.rejectedReason = reason || "";
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(approver, "CUTI_REJECT", new Date().toISOString());

  // Push ke pengaju — cutinya ditolak
  const tglLabelR = p.tanggalMulai ? (p.tanggalAkhir && p.tanggalAkhir !== p.tanggalMulai ? `${p.tanggalMulai} s/d ${p.tanggalAkhir}` : p.tanggalMulai) : "";
  sendPushToUser(p.username,
    "Cuti Ditolak ❌",
    `${p.kebijakanNama}${tglLabelR ? " (" + tglLabelR + ")" : ""} ditolak${reason ? ": " + reason : ""}`
  ).catch(() => {});
  // WA ke pengaju — ditolak
  const usersAllR = load(F.users, {});
  if (usersAllR[p.username]?.noHp) sendFonnte(usersAllR[p.username].noHp, `❌ *Cuti Ditolak*\nHai *${usersAllR[p.username]?.nama || p.username}*, pengajuan *${p.kebijakanNama}*${tglLabelR ? " (" + tglLabelR + ")" : ""} *ditolak*${reason ? "\nAlasan: " + reason : ""}.`);

  res.send({ status: "OK" });
});

// POST: batalkan cuti (hanya pengaju sendiri, jika masih menunggu)
app.post("/pengajuan-cuti/:id/cancel", requireLevel(99), (req, res) => {
  // Identitas pembatal diambil dari middleware (X-User header), bukan dari body
  const username = req._requester;
  const pengajuan = load(F.pengajuanCuti, []);
  const idx = pengajuan.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  const p = pengajuan[idx];
  if (p.username !== username) return res.send({ status: "FORBIDDEN" });
  if (p.status !== "menunggu" && p.status !== "disetujui") return res.send({ status: "ERROR", msg: "Tidak bisa dibatalkan" });

  // Kembalikan saldo jika belum expired / masih relevan
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, p.username, tahun);
  if (p.kuotaKey === "tahunan") {
    // durasi tersimpan dalam HARI, kembalikan langsung
    k.tahunan.terpakai = Math.max(0, k.tahunan.terpakai - parseFloat(p.durasi));
  } else if (p.kuotaKey === "overtime" || p.kuotaKey === "tukarLibur") {
    const jamKembali = p.satuanDurasi === "jam" ? parseFloat(p.durasi) : parseFloat(p.durasi) * 5;
    if (p.kuotaKey === "tukarLibur") {
      k.tukarLibur = k.tukarLibur || { jamAkumulasi: 0, jamCarryOver: 0, jamTerpakai: 0, hariDiambil: 0, riwayat: [] };
      k.tukarLibur.jamTerpakai = parseFloat(Math.max(0, (k.tukarLibur.jamTerpakai || 0) - jamKembali).toFixed(2));
      k.tukarLibur.riwayat = k.tukarLibur.riwayat || [];
      k.tukarLibur.riwayat.push({ tanggal: new Date().toLocaleDateString("sv-SE"), jam: jamKembali, sumber: "kembali", keterangan: "Tukar Libur dibatalkan" });
    } else {
      k.overtime.jamTerpakai = parseFloat(Math.max(0, (k.overtime.jamTerpakai || 0) - jamKembali).toFixed(2));
      k.overtime.riwayat = k.overtime.riwayat || [];
      k.overtime.riwayat.push({ tanggal: new Date().toLocaleDateString("sv-SE"), jam: jamKembali, sumber: "kembali", keterangan: "Cuti Overtime dibatalkan" });
      if (p.satuanDurasi === "hari") k.overtime.hariDiambil = Math.max(0, (k.overtime.hariDiambil || 0) - parseFloat(p.durasi));
    }
  } else if (p.kebijakanId && k.customKuota && k.customKuota[p.kebijakanId]) {
    // Kembalikan saldo custom kuota
    const ck = k.customKuota[p.kebijakanId];
    ck.terpakai = Math.max(0, ck.terpakai - p.durasi);
  }
  save(F.kuotaCuti, kuota);

  p.status     = "dibatalkan";
  p.canceledBy = username;
  p.canceledAt = new Date().toISOString();
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(username, "CUTI_CANCEL", new Date().toISOString());

  // Push ke pengaju — konfirmasi pembatalan
  const tglLabelC = p.tanggalMulai
    ? (p.tanggalAkhir && p.tanggalAkhir !== p.tanggalMulai ? `${p.tanggalMulai} s/d ${p.tanggalAkhir}` : p.tanggalMulai)
    : "";
  sendPushToUser(username,
    "Cuti Dibatalkan 🚫",
    `${p.kebijakanNama}${tglLabelC ? " (" + tglLabelC + ")" : ""} berhasil dibatalkan`
  ).catch(() => {});

  // Push ke owner/admin — informasi ada cuti yang dibatalkan
  const usersC = load(F.users, {});
  const namaC  = usersC[username]?.namaLengkap || username;
  sendPushToGroups(["owner", "admin"],
    "Cuti Dibatalkan 🚫",
    `${namaC} membatalkan ${p.kebijakanNama}${tglLabelC ? " — " + tglLabelC : ""}`
  ).catch(() => {});

  res.send({ status: "OK" });
});


// TRACKING
// ========================

// POST lokasi dari anggota (dipanggil periodik saat sedang kerja)
app.post("/tracking/ping", requireLevel(99), (req, res) => {
  const { lat, lng, accuracy } = req.body;
  // Identitas user diambil dari middleware (X-User header), bukan dari body
  const user = req._requester;
  if (!user || lat == null || lng == null) return res.send({ status: "ERROR" });

  const tracking = load(F.tracking, {});
  const today    = todayLocal();
  const now      = new Date().toISOString();

  if (!tracking[today]) tracking[today] = {};
  if (!tracking[today][user]) tracking[today][user] = [];

  // Tambah titik baru
  tracking[today][user].push({ lat, lng, accuracy: accuracy || 0, time: now });

  // Batasi 500 titik per user per hari agar file tidak membengkak
  if (tracking[today][user].length > 500) tracking[today][user].splice(0, 1);

  // Hapus data lebih dari 7 hari lalu
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  Object.keys(tracking).forEach(d => { if (d < cutoff) delete tracking[d]; });

  save(F.tracking, tracking);
  res.send({ status: "OK" });
});

// GET rute anggota tertentu untuk tanggal tertentu
app.get("/tracking/:user", requireSelfOrLevel("user", 3), (req, res) => {
  const date     = req.query.date || todayLocal();
  const tracking = load(F.tracking, {});
  const points   = (tracking[date] || {})[req.params.user] || [];
  res.send({ user: req.params.user, date, points });
});

// GET posisi terakhir semua anggota (live map)
app.get("/tracking/live/all", requireLevel(3), (req, res) => {
  const tracking = load(F.tracking, {});
  const users    = load(F.users, {});
  const data     = load(F.data, []);
  const today    = todayLocal();
  const todayData = (tracking[today] || {});

  const requester      = req._requester;
  const requesterGroup = getUserGroup(requester);

  // Tentukan divisi requester jika manager
  const requesterDivisi = (() => {
    const u = users[requester];
    if (!u) return [];
    return Array.isArray(u.divisi) ? u.divisi : (u.divisi ? [u.divisi] : []);
  })();

  const result = Object.keys(users)
    .filter(username => {
      // Owner & admin bisa lihat semua kecuali diri sendiri tidak perlu disembunyikan
      if (requesterGroup === "owner" || requesterGroup === "admin") return true;
      // Manager: hanya bisa lihat anggota & koordinator di divisinya sendiri
      // Tidak bisa lihat owner, admin, atau sesama manager
      if (requesterGroup === "manager") {
        const targetGroup  = getUserGroup(username);
        if (targetGroup === "owner" || targetGroup === "admin" || targetGroup === "manager") return false;
        const targetUser   = users[username];
        const targetDivisi = Array.isArray(targetUser?.divisi)
          ? targetUser.divisi
          : (targetUser?.divisi ? [targetUser.divisi] : []);
        return requesterDivisi.some(d => targetDivisi.includes(d));
      }
      return false;
    })
    .sort((a, b) => (users[a]?.namaLengkap || a).localeCompare(users[b]?.namaLengkap || b, 'id'))
    .map(username => {
      const points  = todayData[username] || [];
      const last    = points.length ? points[points.length - 1] : null;
      // Prioritaskan sesi aktif agar status tidak salah jadi DONE saat multi-sesi
      const recAktif2  = data.find(d => d.user === username && d.date === today && !d.jamKeluar);
      const recLatest2 = data.slice().reverse().find(d => d.user === username && d.date === today);
      const rec        = recAktif2 || recLatest2;
      let status    = "OUT";
      if (recAktif2) {
        const lb = recAktif2.breaks?.at(-1);
        status   = (lb && !lb.end) ? "BREAK" : "IN";
      } else if (recLatest2?.jamKeluar) status = "DONE";

      return {
        username,
        namaLengkap: users[username].namaLengkap || username,
        photo:       users[username].photo || "",
        jabatan:     users[username].jabatan || "",
        divisi:      users[username].divisi || "",
        status,
        last,
        totalPoints: points.length,
      };
    });

  res.send(result);
});


// ========================
// SCREENSHOT BUKTI KERJA
// ========================

// POST /screenshot — terima screenshot dari client
// GET /absen-status — dipakai Electron desktop app untuk verifikasi clock in sudah tercatat
app.get("/absen-status", requireLevel(99), (req, res) => {
  const user  = req._requester;
  const today = todayLocal();
  const data  = load(F.data, []);
  const rec   = data.find(d => d.user === user && d.date === today && !d.jamKeluar);
  res.json({ clockedIn: !!rec, user, date: today });
});

app.post("/screenshot", requireLevel(99), async (req, res) => {
  const settings = load(F.appSettings, {});
  if (settings.screenshotEnabled === false) {
    return res.status(403).json({ status: "DISABLED", msg: "Fitur screenshot tidak aktif" });
  }

  const user  = req._requester;
  const today = todayLocal();

  const data = load(F.data, []);
  const rec  = data.find(d => d.user === user && d.date === today && !d.jamKeluar);
  if (!rec) {
    return res.status(403).json({ status: "NOT_WORKING", msg: "Hanya bisa kirim screenshot saat sedang bekerja" });
  }

  const { image } = req.body;
  if (!image || !image.startsWith("data:image/")) {
    return res.status(400).json({ status: "ERROR", msg: "Data gambar tidak valid" });
  }
  // Batas 300KB (client sudah kompres, base64 ≈ 4/3 ukuran asli)
  if (image.length > 410000) {
    console.warn(`[SCREENSHOT] ${user} kirim gambar terlalu besar: ${Math.round(image.length/1000)}KB — ditolak`);
    return res.status(400).json({ status: "TOO_LARGE", msg: "Screenshot terlalu besar (maks 300KB)" });
  }

  const screenshots = load(F.screenshots, {});
  if (!screenshots[today]) screenshots[today] = {};
  if (!screenshots[today][user]) screenshots[today][user] = [];

  const ts    = new Date().toISOString();
  const idx   = screenshots[today][user].length;
  let   entry = { ts };

  // Upload ke bucket jika Supabase aktif, simpan path — bukan base64
  if (USE_SUPABASE) {
    try {
      const buf      = base64ToBuffer(image);
      const filePath = `screenshots/${today}/${user}/${idx}_${Date.now()}.jpg`;
      const uploaded = await bucketUpload(filePath, buf);
      if (uploaded) {
        entry.path = filePath;   // simpan path, TIDAK simpan base64
      } else {
        entry.image = image;     // fallback: simpan base64 jika upload gagal
        console.warn(`[SCREENSHOT] Bucket upload gagal, fallback base64 untuk ${user}`);
      }
    } catch(e) {
      entry.image = image;
      console.error("[SCREENSHOT] Bucket error:", e.message);
    }
  } else {
    entry.image = image;         // tanpa Supabase: simpan base64 di /tmp
  }

  screenshots[today][user].push(entry);

  // Batasi max 50 per user per hari
  if (screenshots[today][user].length > 50) {
    screenshots[today][user] = screenshots[today][user].slice(-50);
  }

  // Retensi 7 hari — hapus metadata lebih dari 7 hari
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toLocaleDateString("sv-SE");
  Object.keys(screenshots).forEach(k => {
    if (k < cutoffStr) {
      delete screenshots[k];
      console.log(`[SCREENSHOT] Cleanup metadata: hapus tanggal ${k}`);
    }
  });

  save(F.screenshots, screenshots);
  console.log(`[SCREENSHOT] ${user} @ ${new Date().toLocaleTimeString("id-ID")} — total hari ini: ${screenshots[today][user].length} | bucket: ${!!entry.path}`);
  res.json({ status: "OK" });
});

// GET /screenshots/today — daftar user aktif + jumlah screenshot (hanya desktop/browser)
app.get("/screenshots/today", requireLevel(3), (req, res) => {
  const today       = todayLocal();
  const screenshots = load(F.screenshots, {});
  const users       = load(F.users, {});
  const data        = load(F.data, []);
  const todayData   = screenshots[today] || {};

  const requester       = req._requester;
  const requesterGroup  = getUserGroup(requester);
  const requesterUser   = users[requester];
  const requesterDivisi = Array.isArray(requesterUser?.divisi)
    ? requesterUser.divisi
    : (requesterUser?.divisi ? [requesterUser.divisi] : []);

  const allUsers = new Set([
    ...Object.keys(todayData),
    ...data.filter(d => d.date === today).map(d => d.user),
  ]);

  const MOBILE_PLATFORMS = ["mobile", "pwa"];

  const result = [...allUsers]
    .filter(username => {
      if (requesterGroup === "owner" || requesterGroup === "admin") return true;
      if (requesterGroup === "manager") {
        const tg = getUserGroup(username);
        if (["owner","admin","manager"].includes(tg)) return false;
        const tu = users[username];
        const td = Array.isArray(tu?.divisi) ? tu.divisi : (tu?.divisi ? [tu.divisi] : []);
        return requesterDivisi.some(d => td.includes(d));
      }
      return false;
    })
    .map(username => {
      // Prioritaskan sesi aktif agar status tidak salah jadi DONE saat multi-sesi
      const recAktif3  = data.find(d => d.user === username && d.date === today && !d.jamKeluar);
      const allRecs    = data.filter(d => d.user === username && d.date === today);
      const latestRec  = allRecs.at(-1);
      const rec        = recAktif3 || latestRec;
      let status  = "OUT";
      if (recAktif3) {
        const lb = recAktif3.breaks?.at(-1);
        status   = (lb && !lb.end) ? "BREAK" : "IN";
      } else if (latestRec?.jamKeluar) status = "DONE";
      const platform  = latestRec?.platform || rec?.platform || "desktop";
      const shots = todayData[username] || [];
      const sessions   = load(F.sessions, {});
      const sess       = sessions[username] || {};
      return {
        username,
        namaLengkap:      users[username]?.namaLengkap || username,
        jabatan:          users[username]?.jabatan || "",
        status,
        platform,
        totalScreenshots: shots.length,
        lastScreenshot:   shots.length ? shots[shots.length - 1].ts : null,
        deviceType:       sess.deviceType || "unknown",
        loginAt:          sess.loginAt    || null,
      };
    })
    // Keluarkan user mobile/pwa dari tab Screenshot sama sekali
    .filter(u => !MOBILE_PLATFORMS.includes(u.platform))
    .sort((a, b) => a.namaLengkap.localeCompare(b.namaLengkap, "id"));

  res.json(result);
});

// GET /screenshots/list-users?date=YYYY-MM-DD — daftar user yang punya screenshot pada tanggal tertentu
app.get("/screenshots/list-users", requireLevel(3), (req, res) => {
  const date        = req.query.date || todayLocal();
  const screenshots = load(F.screenshots, {});
  const users       = load(F.users, {});
  const dateData    = screenshots[date] || {};

  const result = Object.keys(dateData).map(username => ({
    username,
    namaLengkap:      users[username]?.namaLengkap || username,
    jabatan:          users[username]?.jabatan || "",
    totalScreenshots: dateData[username]?.length || 0,
    lastScreenshot:   dateData[username]?.at(-1)?.ts || null,
  })).sort((a, b) => a.namaLengkap.localeCompare(b.namaLengkap, "id"));

  res.json(result);
});

// GET /screenshots/dates/:user — daftar tanggal yang ada screenshot (7 hari terakhir)
app.get("/screenshots/dates/:user", requireLevel(3), (req, res) => {
  const { user } = req.params;
  const screenshots = load(F.screenshots, {});
  const dates = Object.keys(screenshots)
    .filter(date => (screenshots[date][user] || []).length > 0)
    .sort((a, b) => b.localeCompare(a)); // terbaru dulu
  res.json(dates.map(date => ({
    date,
    count: screenshots[date][user].length,
    last:  screenshots[date][user].at(-1)?.ts || null,
  })));
});

// GET /screenshots/:user — metadata list (tanpa image), support ?date=YYYY-MM-DD
app.get("/screenshots/:user", requireLevel(3), (req, res) => {
  const { user } = req.params;
  const date        = req.query.date || todayLocal();
  const screenshots = load(F.screenshots, {});
  const shots       = (screenshots[date] || {})[user] || [];
  res.json(shots.map((s, i) => ({ index: i, ts: s.ts, date })));
});

// GET /screenshots/:user/:index — satu screenshot dengan image, support ?date=YYYY-MM-DD
app.get("/screenshots/:user/:index", requireLevel(3), async (req, res) => {
  const { user, index } = req.params;
  const date        = req.query.date || todayLocal();
  const screenshots = load(F.screenshots, {});
  const shots       = (screenshots[date] || {})[user] || [];
  const shot        = shots[parseInt(index)];
  if (!shot) return res.status(404).json({ status: "NOT_FOUND" });

  // Jika tersimpan di bucket → kembalikan signed URL (valid 1 jam)
  if (shot.path && USE_SUPABASE) {
    const signedUrl = await bucketSignedUrl(shot.path, 3600);
    if (signedUrl) return res.json({ ts: shot.ts, url: signedUrl, date });
    return res.status(500).json({ status: "ERROR", msg: "Gagal generate URL" });
  }

  // Fallback: base64 lama
  res.json({ ts: shot.ts, image: shot.image, date });
});




// ========================
// FOTO KEGIATAN KERJA (Mobile Clock Out)
// ========================

// ── HELPER: normalisasi data laporan per-user per-date → array sesi ──────────────────────────
// Format lama: { uraian, photos, updatedAt } atau array foto langsung
// Format baru: [ { sesi, uraian, photos, updatedAt, jamMasuk, lockedAt } ]
function wpGetSessions(wpStore, date, user) {
  const raw = (wpStore[date] || {})[user];
  if (!raw) return [];

  // Format baru: array of sessions [ {sesi, uraian, photos, ...} ]
  if (Array.isArray(raw)) {
    // Cek apakah isi array adalah session objects (punya field sesi)
    const isSessionArr = raw.length === 0 || (raw[0] && typeof raw[0].sesi !== "undefined");
    if (isSessionArr && raw.length > 0) return raw;
    // Array kosong — kembalikan kosong
    if (raw.length === 0) return [];
    // Array of foto langsung (format sangat lama): [{ts, image}, ...]
    if (raw[0] && (raw[0].image !== undefined || raw[0].ts !== undefined)) {
      return [{ sesi: 1, uraian: "", photos: raw, updatedAt: null, jamMasuk: null, lockedAt: null }];
    }
    // Array of sessions tapi tanpa field sesi — normalize
    return raw.map((s, i) => ({
      sesi:      s.sesi      ?? (i + 1),
      uraian:    s.uraian    ?? "",
      photos:    s.photos    ?? [],
      updatedAt: s.updatedAt ?? null,
      jamMasuk:  s.jamMasuk  ?? null,
      lockedAt:  s.lockedAt  ?? null,
    }));
  }

  // Format lama: object {uraian, photos, updatedAt}
  if (typeof raw === "object" && raw !== null) {
    // Bisa jadi object dengan key sesi (misal: {"1": {uraian, photos}}) — handle juga
    const keys = Object.keys(raw);
    const isNumericKeys = keys.length > 0 && keys.every(k => !isNaN(parseInt(k)));
    if (isNumericKeys && typeof raw[keys[0]] === "object" && raw[keys[0]].photos !== undefined) {
      // Format {"1": {sesi:1, uraian, photos}, "2": {...}}
      return keys.map(k => ({
        sesi:      raw[k].sesi      ?? parseInt(k),
        uraian:    raw[k].uraian    ?? "",
        photos:    raw[k].photos    ?? [],
        updatedAt: raw[k].updatedAt ?? null,
        jamMasuk:  raw[k].jamMasuk  ?? null,
        lockedAt:  raw[k].lockedAt  ?? null,
      })).sort((a, b) => a.sesi - b.sesi);
    }
    // Standard format lama: {uraian, photos, updatedAt}
    return [{ sesi: 1, uraian: raw.uraian || "", photos: Array.isArray(raw.photos) ? raw.photos : [], updatedAt: raw.updatedAt || null, jamMasuk: null, lockedAt: null }];
  }

  console.warn("[wpGetSessions] Format tidak dikenal untuk", user, date, typeof raw);
  return [];
}

// Ambil sesi aktif (belum terkunci / clock out) untuk user tertentu hari ini
function wpGetActiveSesi(data, user, today) {
  // Cari record clock-in yang belum clock-out hari ini
  const rec = data.find(d => d.user === user && d.date === today && !d.jamKeluar);
  return rec ? (rec.sesi || 1) : null;
}

// Cari laporan untuk sesi tertentu
function wpFindSesiData(sessions, sesi) {
  return sessions.find(s => s.sesi === sesi) || null;
}

// Merge semua foto dari semua sesi (untuk tampilan monitor — semua sesi tampil)
function wpMergeAllSessions(sessions) {
  const allPhotos = [];
  const uraianParts = [];
  let updatedAt = null;
  sessions.forEach(s => {
    // Pastikan setiap foto punya field sesi untuk keperluan deletePhoto
    (s.photos || []).forEach(p => allPhotos.push({ ...p, sesi: s.sesi }));
    if (s.uraian && s.uraian.trim()) uraianParts.push(s.uraian.trim());
    if (s.updatedAt && (!updatedAt || s.updatedAt > updatedAt)) updatedAt = s.updatedAt;
  });
  // Gabungkan uraian semua sesi, pisah dengan newline jika berbeda
  const uraianMerged = [...new Set(uraianParts)].join("\n");
  return { photos: allPhotos, uraian: uraianMerged, updatedAt };
}
// ─────────────────────────────────────────────────────────────────────────────────────────────

// GET /work-photos/active-mobile — user mobile/pwa yang sedang aktif hari ini (belum clock out)
app.get("/work-photos/active-mobile", requireLevel(3), async (req, res) => {
  const today     = todayLocal();
  const wpStore   = USE_SUPABASE ? await dbLoad(F.workPhotos, {}) : (load(F.workPhotos, null) || {});
  const users     = load(F.users, {});
  const data      = load(F.data, []);
  const todayData = wpStore[today] || {};

  const requester       = req._requester;
  const requesterGroup  = getUserGroup(requester);
  const requesterUser   = users[requester];
  const requesterDivisi = Array.isArray(requesterUser?.divisi)
    ? requesterUser.divisi
    : (requesterUser?.divisi ? [requesterUser.divisi] : []);

  const MOBILE_PLATFORMS = ["mobile", "pwa", "pwa-desktop"]; // semua non-desktop

  // Kumpulkan semua user yang clock in hari ini
  const allUsers = new Set(data.filter(d => d.date === today).map(d => d.user));

  const result = [...allUsers]
    .filter(username => {
      // Filter akses per role
      if (requesterGroup === "owner" || requesterGroup === "admin") return true;
      if (requesterGroup === "manager") {
        const tg = getUserGroup(username);
        if (["owner","admin","manager"].includes(tg)) return false;
        const tu = users[username];
        const td = Array.isArray(tu?.divisi) ? tu.divisi : (tu?.divisi ? [tu.divisi] : []);
        return requesterDivisi.some(d => td.includes(d));
      }
      return false;
    })
    .map(username => {
      // Ambil sesi aktif dulu (belum clock-out); jika tidak ada, ambil sesi terakhir
      const recAktif  = data.find(d => d.user === username && d.date === today && !d.jamKeluar);
      const recLatest = data.slice().reverse().find(d => d.user === username && d.date === today);
      const rec = recAktif || recLatest;
      if (!rec) return null;
      // Deteksi platform dari sesi aktif atau sesi terakhir
      let platform = rec.platform || "desktop";
      if (platform === "desktop") {
        const sess = load(F.sessions, {})[username] || {};
        if (sess.deviceType && sess.deviceType !== "desktop") platform = sess.deviceType;
      }
      // Hanya tampilkan non-desktop (mobile/pwa/pwa-desktop)
      if (!MOBILE_PLATFORMS.includes(platform)) return null;
      // Status dari sesi aktif — jika ada sesi aktif, pasti IN/BREAK bukan DONE
      let status = "OUT";
      if (recAktif) {
        const lb = recAktif.breaks?.at(-1);
        status = (lb && !lb.end) ? "BREAK" : "IN";
      } else if (recLatest?.jamKeluar) {
        status = "DONE";
      }
      const sessions = wpGetSessions(wpStore, today, username);
      const merged   = wpMergeAllSessions(sessions);
      return {
        username,
        namaLengkap: users[username]?.namaLengkap || username,
        jabatan:     users[username]?.jabatan || "",
        status,
        platform,
        aktivitas:   recAktif?.aktivitas || recLatest?.aktivitas || "",
        totalPhotos: merged.photos.length,
        uraian:      merged.uraian,
        lastPhoto:   merged.photos.at(-1)?.ts || null,
      };
    })
    .filter(Boolean)
    .filter(u => u.status !== "OUT") // hanya yang masih aktif
    .sort((a, b) => a.namaLengkap.localeCompare(b.namaLengkap, "id"));

  res.json(result);
});

// GET /work-photos/list-users?date=YYYY-MM-DD — daftar user yang punya foto pada tanggal tertentu
app.get("/work-photos/list-users", requireLevel(3), async (req, res) => {
  const date      = req.query.date || todayLocal();
  const wpStore   = USE_SUPABASE ? await dbLoad(F.workPhotos, {}) : (load(F.workPhotos, null) || {});
  const users     = load(F.users, {});
  const data      = load(F.data, []);
  const dateData  = wpStore[date] || {};
  const requester = req._requester;
  const level     = req._requesterLevel;

  // Filter per divisi untuk manager (level 3) dan koordinator (level 4)
  const requesterDivisi = (() => {
    const u = users[requester];
    if (!u) return [];
    return Array.isArray(u.divisi) ? u.divisi : (u.divisi ? [u.divisi] : []);
  })();

  const result = Object.keys(dateData).filter(username => {
    if (level <= 2) return true; // owner & admin lihat semua
    const u = users[username];
    if (!u) return false;
    const uGroup = (u.group || "anggota");
    if (uGroup === "owner" || uGroup === "admin" || uGroup === "manager") return false;
    const uDivisi = Array.isArray(u.divisi) ? u.divisi : (u.divisi ? [u.divisi] : []);
    return requesterDivisi.some(d => uDivisi.includes(d));
  }).map(username => {
    const sessions = wpGetSessions(wpStore, date, username);
    const merged   = wpMergeAllSessions(sessions);
    const rec = data.slice().reverse().find(d => d.user === username && d.date === date);
    return {
      username,
      namaLengkap: users[username]?.namaLengkap || username,
      jabatan:     users[username]?.jabatan || "",
      totalPhotos: merged.photos.length,
      uraian:      merged.uraian,
      aktivitas:   rec?.aktivitas || "",
      lastPhoto:   merged.photos.at(-1)?.ts || null,
    };
  }).sort((a, b) => a.namaLengkap.localeCompare(b.namaLengkap, "id"));

  res.json(result);
});

// GET /work-photos/today — daftar user yang punya foto kegiatan hari ini
app.get("/work-photos/today", requireLevel(3), async (req, res) => {
  const today     = todayLocal();
  const wpStore   = USE_SUPABASE ? await dbLoad(F.workPhotos, {}) : (load(F.workPhotos, null) || {});
  const users     = load(F.users, {});
  const data      = load(F.data, []);
  const todayData = wpStore[today] || {};
  const requester = req._requester;
  const level     = req._requesterLevel;

  const requesterDivisi = (() => {
    const u = users[requester];
    if (!u) return [];
    return Array.isArray(u.divisi) ? u.divisi : (u.divisi ? [u.divisi] : []);
  })();

  const result = Object.keys(todayData).filter(username => {
    if (level <= 2) return true;
    const u = users[username];
    if (!u) return false;
    const uGroup = (u.group || "anggota");
    if (uGroup === "owner" || uGroup === "admin" || uGroup === "manager") return false;
    const uDivisi = Array.isArray(u.divisi) ? u.divisi : (u.divisi ? [u.divisi] : []);
    return requesterDivisi.some(d => uDivisi.includes(d));
  }).map(username => {
    const sessions = wpGetSessions(wpStore, today, username);
    const merged   = wpMergeAllSessions(sessions);
    const rec = data.slice().reverse().find(d => d.user === username && d.date === today);
    return {
      username,
      namaLengkap: users[username]?.namaLengkap || username,
      jabatan:     users[username]?.jabatan || "",
      totalPhotos: merged.photos.length,
      uraian:      merged.uraian,
      aktivitas:   rec?.aktivitas || "",
      lastPhoto:   merged.photos.at(-1)?.ts || null,
    };
  }).sort((a, b) => a.namaLengkap.localeCompare(b.namaLengkap, "id"));

  res.json(result);
});

// GET /work-photos/report/me — laporan hari ini milik user, return per-sesi
// WAJIB terdaftar SEBELUM /work-photos/:user agar Express tidak salah tangkap
app.get("/work-photos/report/me", requireLevel(99), async (req, res) => {
  try {
    const user  = req._requester;
    const today = todayLocal();

    // Load data absensi — fallback Supabase jika _store kosong
    let data = load(F.data, null);
    if (!data) data = await dbLoad(F.data, []);

    // Cek apakah pernah absen hari ini
    const adaHariIni = data.find(d => d.user === user && d.date === today);
    if (!adaHariIni) {
      return res.json({ uraian: "", totalPhotos: 0, updatedAt: null, aktivitas: "",
                        currentSesi: 1, sessions: [], isEditable: false });
    }

    // Load work_photos — selalu dari Supabase DB
    let wpStore = USE_SUPABASE ? await dbLoad(F.workPhotos, {}) : (load(F.workPhotos, null) || {});

    const rawWp   = (wpStore[today] || {})[user];
    const sessions = wpGetSessions(wpStore, today, user);
    const merged   = wpMergeAllSessions(sessions);

    console.log(`[REPORT/ME] ${user} ${today} — src:${rawWp?"store":"empty"} type:${Array.isArray(rawWp)?"arr["+sessions.length+"]":typeof rawWp} photos:${merged.photos.length} uraian:"${(merged.uraian||"").slice(0,50)}"`);

    // Absensi hari ini diurutkan per sesi
    const absenHariIni = data.filter(d => d.user === user && d.date === today)
      .sort((a, b) => (a.sesi || 1) - (b.sesi || 1));
    const recTerakhir = absenHariIni[absenHariIni.length - 1];
    const aktivitas   = recTerakhir?.aktivitas || "";
    const currentSesi = (absenHariIni.find(d => !d.jamKeluar) || recTerakhir)?.sesi || 1;

    // Data per-sesi untuk tampilan multi-sesi di client
    const sessionsOut = absenHariIni.map(absen => {
      const sNum   = absen.sesi || 1;
      const wpSesi = sessions.find(s => s.sesi === sNum) || { sesi: sNum, uraian: "", photos: [], updatedAt: null };
      return {
        sesi:        sNum,
        uraian:      wpSesi.uraian || "",
        totalPhotos: wpSesi.photos.length,
        updatedAt:   wpSesi.updatedAt || null,
        aktivitas:   absen.aktivitas || "",
        jamMasuk:    absen.jamMasuk  || null,
        jamKeluar:   absen.jamKeluar || null,
        isAktif:     !absen.jamKeluar,
      };
    });

    res.json({
      uraian:      merged.uraian || "",
      totalPhotos: merged.photos.length,
      updatedAt:   merged.updatedAt || null,
      aktivitas,
      currentSesi,
      sessions:    sessionsOut,
      isEditable:  true,
    });
  } catch (err) {
    console.error("[REPORT/ME] Error:", err.message);
    res.status(500).json({ uraian: "", totalPhotos: 0, updatedAt: null, aktivitas: "",
                           currentSesi: 1, sessions: [], isEditable: true });
  }
});

// GET /work-photos/:user — list metadata foto kegiatan user (tanpa image), support ?date=YYYY-MM-DD
// Menggabungkan semua sesi pada tanggal tersebut
app.get("/work-photos/:user", requireLevel(3), async (req, res) => {
  const { user } = req.params;
  const date    = req.query.date || todayLocal();
  const wpStore = USE_SUPABASE ? await dbLoad(F.workPhotos, {}) : (load(F.workPhotos, null) || {});
  const data    = load(F.data, []);
  const sessions  = wpGetSessions(wpStore, date, user);
  const merged    = wpMergeAllSessions(sessions);
  const rec       = data.slice().reverse().find(d => d.user === user && d.date === date);
  const aktivitas = rec?.aktivitas || "";
  res.json({
    uraian:    merged.uraian,
    photos:    merged.photos.map((p, i) => ({ index: i, ts: p.ts, date, sesi: p.sesi })),
    aktivitas,
  });
});

// GET /work-photos/:user/:index — foto kegiatan dengan image, support ?date=YYYY-MM-DD
app.get("/work-photos/:user/:index", requireLevel(99), async (req, res) => {
  const { user, index } = req.params;
  const date      = req.query.date || todayLocal();
  const requester = req._requester;
  const level     = req._requesterLevel;
  const users     = load(F.users, {});

  // Akses kontrol: user bisa lihat foto milik sendiri; manager lihat divisinya; owner lihat semua
  if (requester !== user && level > 2) {
    const me = users[requester];
    const target = users[user];
    if (!me || !target) return res.status(403).json({ status: "FORBIDDEN" });
    const myDivisi  = Array.isArray(me.divisi) ? me.divisi : (me.divisi ? [me.divisi] : []);
    const tgtDivisi = Array.isArray(target.divisi) ? target.divisi : (target.divisi ? [target.divisi] : []);
    const tgtGroup  = target.group || "anggota";
    // Tidak bisa lihat owner/admin/manager lain
    if (tgtGroup === "owner" || tgtGroup === "admin" || tgtGroup === "manager") {
      return res.status(403).json({ status: "FORBIDDEN" });
    }
    // Harus divisi yang sama
    if (!myDivisi.some(d => tgtDivisi.includes(d))) {
      return res.status(403).json({ status: "FORBIDDEN" });
    }
  }

  const wpStore = USE_SUPABASE ? await dbLoad(F.workPhotos, {}) : (load(F.workPhotos, null) || {});
  const sessions  = wpGetSessions(wpStore, date, user);
  const merged    = wpMergeAllSessions(sessions);
  const allPhotos = merged.photos;
  const photo     = allPhotos[parseInt(index)];
  if (!photo) return res.status(404).json({ status: "NOT_FOUND" });

  // Jika tersimpan di bucket → kembalikan signed URL
  if (photo.path && USE_SUPABASE) {
    const signedUrl = await bucketSignedUrl(photo.path, 3600);
    if (signedUrl) return res.json({ ts: photo.ts, url: signedUrl, date });
    return res.status(500).json({ status: "ERROR", msg: "Gagal generate URL" });
  }

  // Fallback: base64 lama
  res.json({ ts: photo.ts, image: photo.image, date });
});

// POST /work-photos/report — simpan/update laporan
// Rule: bisa edit sepanjang hari yg sama. Maks 5 foto PER HARI (semua sesi digabung).
app.post("/work-photos/report", requireLevel(99), async (req, res) => {
  try {
  const user    = req._requester;
  const today   = todayLocal();
  const { uraian, photos, action, photoIndex, targetSesi } = req.body;

  // Load data absensi dengan fallback Supabase
  let data = load(F.data, null);
  if (!data) data = await dbLoad(F.data, []);

  const adaHariIni = data.find(d => d.user === user && d.date === today);
  if (!adaHariIni) return res.status(403).json({ status: "NOT_WORKING", msg: "Belum ada absensi hari ini" });

  const recAktif = data.find(d => d.user === user && d.date === today && !d.jamKeluar);
  const recLast  = data.slice().reverse().find(d => d.user === user && d.date === today);
  // targetSesi: client bisa tentukan sesi mana yang diedit (untuk multi-sesi)
  // default: sesi aktif (belum clock-out), atau sesi terakhir jika semua sudah clock-out
  const defaultSesi  = (recAktif || recLast)?.sesi || 1;
  const currentSesi  = (typeof targetSesi === "number" && targetSesi > 0)
    ? targetSesi : defaultSesi;
  // recTarget: absensi yang sesuai sesi yang diedit
  const recTarget = data.find(d => d.user === user && d.date === today && d.sesi === currentSesi)
                 || recLast;

  // Load work_photos — selalu dari Supabase DB (bukan /tmp yang hilang saat restart)
  let wpStore = USE_SUPABASE ? await dbLoad(F.workPhotos, {}) : (load(F.workPhotos, null) || {});
  if (!wpStore[today]) wpStore[today] = {};

  // Normalisasi ke format array-of-sessions (backward-compat)
  const rawBefore = (wpStore[today] || {})[user];
  let sessions = wpGetSessions(wpStore, today, user);
  // Log jika ada migrasi format
  if (rawBefore && !Array.isArray(rawBefore)) {
    console.log(`[POST/REPORT] ${user} — migrasi format lama → ${sessions.length} sesi, ${sessions.reduce((n,s)=>n+(s.photos||[]).length,0)} foto`);
  }
  wpStore[today][user] = sessions;

  // Cari atau buat sesi target
  let laporan = sessions.find(s => s.sesi === currentSesi);
  if (!laporan) {
    laporan = { sesi: currentSesi, uraian: "", photos: [], updatedAt: null, jamMasuk: recTarget?.jamMasuk || null, lockedAt: null };
    sessions.push(laporan);
  }

  // Hitung total foto hari ini (semua sesi)
  const mergedNow    = wpMergeAllSessions(sessions);
  const totalHariIni = mergedNow.photos.length;

  // Aksi: hapus 1 foto (berdasarkan index global merged) — boleh dari sesi manapun
  if (action === "deletePhoto" && typeof photoIndex === "number") {
    const targetPhoto = mergedNow.photos[photoIndex];
    if (!targetPhoto) return res.status(404).json({ status: "NOT_FOUND", msg: "Foto tidak ditemukan" });
    // Hapus dari sesi yang memiliki foto tersebut
    const sesiPemilik = sessions.find(s => s.sesi === targetPhoto.sesi);
    if (sesiPemilik) {
      sesiPemilik.photos = sesiPemilik.photos.filter(p => p.ts !== targetPhoto.ts);
      sesiPemilik.updatedAt = new Date().toISOString();
    }
    save(F.workPhotos, wpStore);
    const mergedAfter = wpMergeAllSessions(sessions);
    return res.json({ status: "OK", totalPhotos: mergedAfter.photos.length });
  }

  // Aksi: hapus semua foto sesi ini
  if (action === "clearPhotos") {
    laporan.photos = [];
    laporan.updatedAt = new Date().toISOString();
    save(F.workPhotos, wpStore);
    const mergedAfter = wpMergeAllSessions(sessions);
    return res.json({ status: "OK", totalPhotos: mergedAfter.photos.length });
  }

  // Update uraian pada sesi target (tidak overwrite sesi lain)
  if (uraian !== undefined) {
    const newUraian = String(uraian).slice(0, 2000);
    laporan.uraian  = newUraian;
  }

  // Tambah foto — cek kuota HARIAN (bukan per sesi)
  if (Array.isArray(photos) && photos.length > 0) {
    let fotoHariIni = totalHariIni;
    for (const img of photos) {
      if (!img || typeof img !== "string" || !img.startsWith("data:image/")) continue;
      if (img.length > 2000000) {
        console.warn(`[LAPORAN] ${user} foto terlalu besar: ${Math.round(img.length/1000)}KB — dilewati`);
        continue;
      }
      if (fotoHariIni >= 5) {
        return res.status(400).json({ status: "MAX_PHOTOS", msg: "Maksimal 5 foto per hari" });
      }
      const ts       = new Date().toISOString();
      const photoIdx = fotoHariIni;
      let   entry    = { ts };

      // Upload ke bucket jika Supabase aktif
      if (USE_SUPABASE) {
        try {
          const buf      = base64ToBuffer(img);
          const filePath = `workphotos/${today}/${user}/${currentSesi}_${photoIdx}_${Date.now()}.jpg`;
          console.log(`[LAPORAN] Mencoba upload bucket: ${filePath} (${buf.length} bytes)`);
          const uploaded = await bucketUpload(filePath, buf);
          if (uploaded) {
            entry.path = filePath;
            console.log(`[LAPORAN] ✅ Bucket OK: ${filePath}`);
          } else {
            entry.image = img;
            console.warn(`[LAPORAN] ⚠️ Bucket upload gagal, fallback base64 untuk ${user}`);
          }
        } catch(e) {
          entry.image = img;
          console.error("[LAPORAN] ❌ Bucket error:", e.message);
        }
      } else {
        entry.image = img;          // tanpa Supabase: simpan base64
      }

      laporan.photos.push(entry);
      fotoHariIni++;
    }
  }

  laporan.updatedAt = new Date().toISOString();

  // Retensi 3 hari
  const wpCutoff = new Date();
  wpCutoff.setDate(wpCutoff.getDate() - 3);
  const wpCutoffStr = wpCutoff.toLocaleDateString("sv-SE");
  Object.keys(wpStore).forEach(k => { if (k < wpCutoffStr) delete wpStore[k]; });

  save(F.workPhotos, wpStore);
  const mergedFinal = wpMergeAllSessions(sessions);
  console.log(`[LAPORAN] ${user} sesi-${currentSesi} @ ${new Date().toLocaleTimeString("id-ID")} — total ${mergedFinal.photos.length} foto/hari, uraian: ${laporan.uraian ? "ada" : "kosong"}`);
  res.json({ status: "OK", totalPhotos: mergedFinal.photos.length, uraian: laporan.uraian, sesi: currentSesi });
  } catch (err) {
    console.error("[POST/REPORT] Error:", err.message);
    res.status(500).json({ status: "ERROR", msg: "Gagal simpan laporan: " + err.message });
  }
});

// Toggle fitur foto kegiatan — hanya Owner (level 1)
app.post("/app-settings/work-photo-toggle", requireLevel(2), (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") return res.status(400).json({ status: "INVALID" });
  const current = load(F.appSettings, { timezone: "Asia/Makassar" });
  const updated  = { ...current, workPhotoEnabled: enabled };
  save(F.appSettings, updated);
  console.log(`[SETTING] Fitur Foto Kegiatan ${enabled ? "DIAKTIFKAN" : "DINONAKTIFKAN"} oleh ${req._requester}`);
  res.json({ status: "OK", workPhotoEnabled: enabled });
});

// GET /admin/storage-info — monitoring ukuran storage screenshot & foto (owner/admin)
app.get("/admin/storage-info", requireLevel(2), (req, res) => {
  const screenshots = load(F.screenshots, {});
  const workPhotos  = load(F.workPhotos, {});

  function calcSizeKB(obj) {
    return Math.round(JSON.stringify(obj).length / 1024);
  }

  const ssInfo = Object.keys(screenshots).sort().map(date => {
    const day = screenshots[date];
    return {
      date,
      userCount:   Object.keys(day).length,
      totalShots:  Object.values(day).reduce((s, arr) => s + arr.length, 0),
      sizeKB:      calcSizeKB(day),
    };
  });

  const wpInfo = Object.keys(workPhotos).sort().map(date => {
    const day = workPhotos[date];
    return {
      date,
      userCount:   Object.keys(day).length,
      totalPhotos: Object.values(day).reduce((s, arr) => s + arr.length, 0),
      sizeKB:      calcSizeKB(day),
    };
  });

  const totalSS_KB = ssInfo.reduce((s, d) => s + d.sizeKB, 0);
  const totalWP_KB = wpInfo.reduce((s, d) => s + d.sizeKB, 0);
  const totalKB    = totalSS_KB + totalWP_KB;

  res.json({
    screenshots: { days: ssInfo, totalKB: totalSS_KB },
    workPhotos:  { days: wpInfo, totalKB: totalWP_KB },
    totalKB,
    totalMB:       Math.round(totalKB / 1024 * 10) / 10,
    supabaseLimitKB: 512000,
    pctUsed:       Math.round(totalKB / 512000 * 1000) / 10,
  });
});

// ========================
// CHATBOT (Groq AI)
// ========================
app.post("/chat", requireLevel(99), async (req, res) => {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.send({ reply: "❌ GROQ_API_KEY belum dikonfigurasi di server." });

  const { message, history } = req.body;
  if (!message) return res.send({ reply: "Pesan kosong." });

  const username = req._requester;
  const level    = req._requesterLevel;
  const users    = load(F.users, {});
  const user     = users[username] || {};
  const today    = todayLocal();

  // Absensi hari ini
  const dataAbsen    = load(F.data, []);
  const rekorHariIni = dataAbsen.find(d => d.user === username && d.date === today);

  // Rekap bulan ini
  const nowDate  = new Date();
  const bulanIni = `${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,"0")}`;
  const rekapBulan = dataAbsen
    .filter(d => d.user === username && d.date.startsWith(bulanIni))
    .map(d => ({ tanggal: d.date, masuk: d.jamMasuk, keluar: d.jamKeluar, totalJam: d.totalJam || 0 }));

  // Kuota cuti
  const kuotaData = load(F.kuotaCuti, {});
  const tahun     = nowDate.getFullYear();
  const kuota     = kuotaData[username]?.[tahun] || null;

  // Pengajuan cuti 5 terakhir
  const pengajuanData = load(F.pengajuanCuti, []);
  const cutiUser = pengajuanData
    .filter(p => p.username === username).slice(-5)
    .map(p => ({ kebijakan: p.kebijakanNama, durasi: p.durasi, satuan: p.satuanDurasi, status: p.status, tgl: p.tanggalMulai }));

  // Hari libur bulan ini
  const liburData  = load(F.libur, []);
  const liburBulan = liburData
    .filter(l => (l.dateStart || l.date || "").startsWith(bulanIni))
    .map(l => ({ nama: l.name, tanggal: l.dateStart || l.date }));

  // Konteks tambahan untuk admin/owner
  let konteksAdmin = "";
  if (level <= 2) {
    const hariIniSemua = dataAbsen.filter(d => d.date === today);
    const sudahAbsen   = hariIniSemua.map(d => d.user);
    const semuaUser    = Object.keys(users);
    const belumAbsen   = semuaUser.filter(u => !sudahAbsen.includes(u) && users[u].status !== "nonaktif");
    konteksAdmin = `\nData Admin/Owner:\n- Total user aktif: ${semuaUser.length}\n- Sudah absen hari ini: ${sudahAbsen.length} orang (${sudahAbsen.join(", ")})\n- Belum absen hari ini: ${belumAbsen.length} orang (${belumAbsen.join(", ")})`;
  }

  const systemPrompt = `Kamu adalah asisten AI untuk aplikasi absensi dan manajemen SDM.
Jawab dalam Bahasa Indonesia yang ramah, singkat, dan informatif.
Jangan mengarang data — gunakan hanya data yang tersedia. Jika tidak ada, katakan dengan jujur.

=== DATA USER ===
Username    : ${username}
Nama        : ${user.namaLengkap || username}
Jabatan     : ${user.jabatan || "-"}
Divisi      : ${Array.isArray(user.divisi) ? user.divisi.join(", ") : (user.divisi || "-")}
Level Akses : ${level<=1?"Owner":level===2?"Admin":level===3?"Manager":level===4?"Koordinator":"Anggota"}

=== ABSENSI HARI INI (${today}) ===
${rekorHariIni
  ? `Jam Masuk : ${rekorHariIni.jamMasuk||"-"}\nJam Keluar: ${rekorHariIni.jamKeluar||"Belum keluar"}\nTotal Jam : ${rekorHariIni.totalJam||0} jam`
  : "Belum absen hari ini"}

=== REKAP BULAN INI (${bulanIni}) ===
Total hari hadir: ${rekapBulan.length} hari
Total jam kerja : ${rekapBulan.reduce((s,d)=>s+(d.totalJam||0),0).toFixed(1)} jam
${rekapBulan.map(d=>`  ${d.tanggal}: masuk ${d.masuk||"-"}, keluar ${d.keluar||"-"}, ${d.totalJam||0} jam`).join("\n")||"Belum ada data"}

=== KUOTA CUTI ===
${kuota
  ? `Cuti Tahunan : ${kuota.tahunan?.total||12} hari (sisa: ${(kuota.tahunan?.total||12)-(kuota.tahunan?.terpakai||0)} hari)\nCuti Overtime: ${saldoOvertimeHari(kuota.overtime||{}).hari} hari ${saldoOvertimeHari(kuota.overtime||{}).sisaJam} jam\nTukar Libur  : ${saldoTukarLiburHari(kuota.tukarLibur||{}).hari} hari ${saldoTukarLiburHari(kuota.tukarLibur||{}).sisaJam} jam`
  : "Data kuota cuti belum tersedia"}

=== RIWAYAT CUTI (5 terakhir) ===
${cutiUser.length ? cutiUser.map(c=>`  ${c.tgl}: ${c.kebijakan} ${c.durasi} ${c.satuan} — ${c.status}`).join("\n") : "Belum ada pengajuan cuti"}

=== HARI LIBUR BULAN INI ===
${liburBulan.length ? liburBulan.map(l=>`  ${l.tanggal}: ${l.nama}`).join("\n") : "Tidak ada hari libur bulan ini"}
${konteksAdmin}`;

  const messages = [
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: "user", content: message }
  ];

  try {
    const groqRes  = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 1024,
        temperature: 0.5,
      })
    });
    const groqData = await groqRes.json();
    const reply    = groqData.choices?.[0]?.message?.content || "Maaf, tidak ada respons dari AI.";
    res.send({ reply });
  } catch (err) {
    console.error("Groq error:", err);
    res.send({ reply: "❌ Gagal menghubungi AI. Coba lagi." });
  }
});

// ========================
// TWA — WEB APP MANIFEST
// ========================
app.get('/manifest.json', (req, res) => {
  res.json({
    name: "Absensi Smart",
    short_name: "AbsenSmart",
    description: "Aplikasi absensi karyawan dengan face recognition dan geofencing",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1a237e",
    theme_color: "#4f8ef7",
    icons: [
      { src: "/icons/icon-72.png",  sizes: "72x72",   type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-96.png",  sizes: "96x96",   type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-128.png", sizes: "128x128", type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-144.png", sizes: "144x144", type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
    ]
  });
});

// ========================
// TWA — DIGITAL ASSET LINKS
// ========================
// PUSH NOTIFICATION ENDPOINTS
// ========================

// GET: ambil VAPID public key (dibutuhkan frontend untuk subscribe)
app.get("/push/vapid-public-key", (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// POST: simpan subscription baru
app.post("/push/subscribe", requireLevel(99), (req, res) => {
  const username = req._requester;
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ status: "ERROR" });

  const subs = load(F.pushSubs, {});
  if (!subs[username]) subs[username] = [];

  // Hindari duplikat endpoint
  const exists = subs[username].some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subs[username].push(subscription);
    save(F.pushSubs, subs);
  }
  res.json({ status: "OK" });
});

// DELETE: hapus subscription (saat user logout)
app.post("/push/unsubscribe", requireLevel(99), (req, res) => {
  const username = req._requester;
  const { endpoint } = req.body;
  const subs = load(F.pushSubs, {});
  if (subs[username]) {
    subs[username] = subs[username].filter(s => s.endpoint !== endpoint);
    save(F.pushSubs, subs);
  }
  res.json({ status: "OK" });
});

// ========================
// APP SETTINGS — Timezone (Owner/Admin only)
// ========================
app.get("/app-settings", (req, res) => {
  const settings = load(F.appSettings, { timezone: "Asia/Makassar" });
  res.json(settings);
});

app.post("/app-settings", (req, res) => {
  const user = req.headers["x-user"] || "";
  const users = load(F.users, {});
  const u = users[user];
  if (!u) return res.status(403).json({ status: "FORBIDDEN" });
  const groups = load(F.groups, []);
  const grp = groups.find(g => g.id === (u.group || "anggota"));
  const level = grp ? (grp.level || 99) : 99;
  if (level > 2) return res.status(403).json({ status: "FORBIDDEN" });

  const allowed = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];
  const { timezone } = req.body;
  if (!allowed.includes(timezone)) return res.status(400).json({ status: "INVALID_TZ" });

  const current = load(F.appSettings, { timezone: "Asia/Makassar" });
  const updated = { ...current, timezone };
  save(F.appSettings, updated);
  process.env.TZ = timezone;

  res.json({ status: "OK", settings: updated });
});

// Toggle fitur screenshot — hanya Owner (level 1)
app.post("/app-settings/screenshot-toggle", requireLevel(2), (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") return res.status(400).json({ status: "INVALID" });
  const current = load(F.appSettings, { timezone: "Asia/Makassar" });
  const updated  = { ...current, screenshotEnabled: enabled };
  save(F.appSettings, updated);
  console.log(`[SETTING] Fitur screenshot ${enabled ? "DIAKTIFKAN" : "DINONAKTIFKAN"} oleh ${req._requester}`);
  res.json({ status: "OK", screenshotEnabled: enabled });
});

// ============================================================
// WEBAUTHN — Fingerprint / Face ID Login
// ============================================================

// GET /webauthn/challenge — ambil challenge untuk register atau login
app.get("/webauthn/challenge", (req, res) => {
  const crypto    = require("crypto");
  const challenge = crypto.randomBytes(32).toString("base64url");
  // Simpan challenge sementara di memory (expire 2 menit)
  if (!global._wauthChallenges) global._wauthChallenges = {};
  const key = req.query.username || "anon";
  global._wauthChallenges[key] = { challenge, exp: Date.now() + 120000 };
  res.json({ challenge });
});

// POST /webauthn/register — simpan credential baru (fingerprint/Face ID)
app.post("/webauthn/register", async (req, res) => {
  const { username, credentialId, publicKey, deviceName } = req.body;
  if (!username || !credentialId || !publicKey) return res.status(400).json({ status: "INVALID" });

  const users = load(F.users, {});
  if (!users[username]) return res.status(404).json({ status: "USER_NOT_FOUND" });

  // Verifikasi challenge masih valid
  const ch = (global._wauthChallenges || {})[username];
  if (!ch || Date.now() > ch.exp) return res.status(400).json({ status: "CHALLENGE_EXPIRED" });
  delete global._wauthChallenges[username];

  const webauthn = load(F.webauthn, {});
  if (!webauthn[username]) webauthn[username] = [];

  // Cek duplikat credentialId
  const exists = webauthn[username].find(c => c.credentialId === credentialId);
  if (!exists) {
    webauthn[username].push({
      credentialId,
      publicKey,
      deviceName: deviceName || "Device",
      createdAt:  new Date().toISOString(),
      counter:    0,
    });
    save(F.webauthn, webauthn);
  }

  console.log(`[WebAuthn] Credential terdaftar: ${username} (${deviceName})`);
  res.json({ status: "OK" });
});

// POST /webauthn/login — verifikasi fingerprint & login
app.post("/webauthn/login", async (req, res) => {
  const { username, credentialId, clientDataJSON, authenticatorData, signature, nativeAuth } = req.body;
  if (!username || !credentialId) return res.status(400).json({ status: "INVALID" });

  const users = load(F.users, {});
  const user  = users[username];
  if (!user) return res.status(404).json({ status: "USER_NOT_FOUND" });

  const webauthn = load(F.webauthn, {});
  const creds    = webauthn[username] || [];
  let cred       = creds.find(c => c.credentialId === credentialId);

  // Native biometric: auto-register credential jika belum ada
  // (verifikasi sudah dilakukan OS Android, server cukup percaya)
  if (!cred && nativeAuth === true && credentialId.startsWith("native-")) {
    const newCred = {
      credentialId,
      publicKey:  "native",
      deviceName: "Android Native Biometric",
      createdAt:  new Date().toISOString(),
      counter:    0,
    };
    if (!webauthn[username]) webauthn[username] = [];
    webauthn[username].push(newCred);
    save(F.webauthn, webauthn);
    cred = newCred;
  }

  if (!cred) return res.status(401).json({ status: "CREDENTIAL_NOT_FOUND" });

  // Skip challenge untuk native biometric (OS Android sudah verifikasi)
  if (!nativeAuth) {
    const ch = (global._wauthChallenges || {})[username];
    if (!ch || Date.now() > ch.exp) return res.status(400).json({ status: "CHALLENGE_EXPIRED" });
    delete global._wauthChallenges[username];
  }

  // Untuk implementasi sederhana tanpa library: verifikasi keberadaan credential sudah cukup
  // (browser sudah handle verifikasi crypto di sisi client via authenticator)
  // Di production penuh, gunakan @simplewebauthn/server untuk verifikasi signature
  cred.counter   = (cred.counter || 0) + 1;
  cred.lastUsed  = new Date().toISOString();
  save(F.webauthn, webauthn);

  // Buat session seperti login biasa
  const crypto   = require("crypto");
  const sessionId = crypto.randomBytes(24).toString("hex");
  const ua        = req.headers["user-agent"] || "";
  const isMobile      = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  const isCapacitor2  = req.body.isCapacitor === true;
  const isPWA         = !isCapacitor2 && req.body.isPWA === true;
  let deviceType      = "desktop";
  if (/Electron/i.test(ua))         deviceType = "desktop-app";
  else if (isCapacitor2)            deviceType = "mobile"; // APK Capacitor → mobile
  else if (isPWA && isMobile)       deviceType = "pwa";
  else if (isMobile)                deviceType = "mobile";

  const sessions = load(F.sessions, {});
  sessions[username] = { deviceType, sessionId, userAgent: ua, loginAt: new Date().toISOString() };
  save(F.sessions, sessions);

  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === (user.group || "anggota")) || groups[groups.length-1];

  console.log(`[WebAuthn] Login berhasil: ${username} via fingerprint (${deviceType})`);
  res.json({ status: "OK", group: group.id, menus: group.menus, level: group.level, deviceType, sessionId });
});

// GET /webauthn/credentials/:username — daftar credential terdaftar
app.get("/webauthn/credentials/:username", (req, res) => {
  const webauthn = load(F.webauthn, {});
  const creds    = (webauthn[req.params.username] || []).map(c => ({
    credentialId: c.credentialId,
    deviceName:   c.deviceName,
    createdAt:    c.createdAt,
    lastUsed:     c.lastUsed,
  }));
  res.json({ credentials: creds });
});

// DELETE /webauthn/credentials/:username/:credentialId — hapus credential
app.delete("/webauthn/credentials/:username/:credentialId", (req, res) => {
  const webauthn = load(F.webauthn, {});
  if (!webauthn[req.params.username]) return res.json({ status: "OK" });
  webauthn[req.params.username] = webauthn[req.params.username]
    .filter(c => c.credentialId !== req.params.credentialId);
  save(F.webauthn, webauthn);
  res.json({ status: "OK" });
});

// Toggle fitur single-session (auto logout jika login di device lain) — hanya Owner
app.post("/app-settings/single-session-toggle", requireLevel(2), (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") return res.status(400).json({ status: "INVALID" });
  const current = load(F.appSettings, { timezone: "Asia/Makassar" });
  const updated  = { ...current, singleSessionEnabled: enabled };
  save(F.appSettings, updated);
  console.log(`[SETTING] Fitur Single Session ${enabled ? "DIAKTIFKAN" : "DINONAKTIFKAN"} oleh ${req._requester}`);
  res.json({ status: "OK", singleSessionEnabled: enabled });
});

// GET /session/check — cek apakah session user masih valid (dipanggil tiap 30 detik dari client)
app.get("/session/check", requireLevel(99), (req, res) => {
  const user     = req._requester;
  const settings = load(F.appSettings, {});

  // Jika fitur nonaktif, selalu valid
  if (!settings.singleSessionEnabled) return res.json({ valid: true });

  const sessions = load(F.sessions, {});
  const sess     = sessions[user];

  // Belum pernah login setelah fitur aktif → anggap valid, paksa login ulang tidak perlu
  if (!sess || !sess.sessionId) return res.json({ valid: true });

  // Baca sessionId dari header (case-insensitive di Express) atau query param
  const clientSessionId = req.headers["x-session-id"]
                       || req.headers["X-Session-Id"]
                       || req.query.sessionId
                       || "";

  console.log(`[SESSION] check user=${user} client=${clientSessionId?.slice(0,8)}... server=${sess.sessionId?.slice(0,8)}...`);

  if (!clientSessionId) {
    // Client belum punya sessionId (login lama sebelum fitur) → suruh login ulang
    return res.json({ valid: false, reason: "NO_SESSION_ID", deviceType: sess.deviceType });
  }

  if (clientSessionId !== sess.sessionId) {
    console.log(`[SESSION] MISMATCH — user ${user} terdeteksi login di device lain (${sess.deviceType})`);
    return res.json({ valid: false, reason: "LOGIN_OTHER_DEVICE", deviceType: sess.deviceType });
  }

  res.json({ valid: true });
});

// Toggle auto tutup kekurangan jam dari saldo overtime — hanya Owner (level 1)
// Lokasi tampil: Aksesibilitas → Kontrol Akses → Pengaturan Sistem
app.post("/app-settings/auto-tutup-overtime-toggle", requireLevel(2), (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") return res.status(400).json({ status: "INVALID" });
  const current = load(F.appSettings, { timezone: "Asia/Makassar" });
  const updated  = { ...current, autoTutupOvertimeEnabled: enabled };
  save(F.appSettings, updated);
  console.log(`[SETTING] Auto Tutup Kekurangan Jam dari Overtime ${enabled ? "DIAKTIFKAN" : "DINONAKTIFKAN"} oleh ${req._requester}`);
  res.json({ status: "OK", autoTutupOvertimeEnabled: enabled });
});

// ========================
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.sukodo.absensi",
        sha256_cert_fingerprints: [
          "F5:94:83:58:15:3F:78:4C:48:FF:7F:2C:BF:99:57:66:34:28:02:72:AA:E3:D8:BE:45:0E:F6:FE:8C:2F:81:A2"
        ]
      }
    }
  ]);
});

// ========================
// START SERVER — dipindah ke initDB().then() di bagian atas file
// ========================


// ========================
// WHATSAPP ENDPOINTS
// ========================

// GET: status koneksi WA
app.get("/wa/status", requireLevel(2), (req, res) => {
  res.send(waStatus());
});

// GET: tampilkan QR dalam bentuk HTML (scan dari browser)
app.get("/wa/qr", requireLevel(2), async (req, res) => {
  const qr = getWAQR();
  if (!qr) {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>✅ WhatsApp sudah terhubung</h2>
      <p>Tidak ada QR yang perlu di-scan saat ini.</p>
      <a href="/wa/status">Cek Status</a>
    </body></html>`);
  }
  // Generate QR sebagai gambar menggunakan qrcode library
  try {
    const QRCode = require("qrcode");
    const dataUrl = await QRCode.toDataURL(qr, { width: 300 });
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5">
      <h2>📱 Scan QR WhatsApp</h2>
      <p>Buka WA → Menu → Perangkat Tertaut → Tautkan Perangkat</p>
      <img src="${dataUrl}" style="border:4px solid #25D366;border-radius:12px;padding:8px;background:white" />
      <br/><br/>
      <p style="color:#888;font-size:13px">QR otomatis refresh. Reload halaman ini jika QR expired.</p>
      <a href="/wa/qr" style="background:#25D366;color:white;padding:10px 24px;border-radius:8px;text-decoration:none">🔄 Refresh QR</a>
    </body></html>`);
  } catch {
    // Fallback: tampilkan string QR jika qrcode tidak terinstall
    res.send(`<html><body style="font-family:sans-serif;padding:40px">
      <h2>QR tersedia tapi qrcode library belum terinstall</h2>
      <p>Jalankan: <code>npm install qrcode</code></p>
      <pre style="font-size:10px;word-break:break-all">${qr}</pre>
    </body></html>`);
  }
});

// POST: logout WA dan scan ulang
app.get("/wa/logout", requireLevel(2), async (req, res) => {
  await logoutWA();
  res.send({ status: "OK", msg: "Logout berhasil. Buka /wa/qr untuk scan ulang." });
});

