/**
 * db.js — Supabase Storage Layer
 * Menggantikan load(file, def) dan save(file, data) dari JSON /tmp
 * 
 * CARA SETUP:
 * 1. Buat akun gratis di https://supabase.com
 * 2. Buat project baru
 * 3. Buka SQL Editor, jalankan perintah SQL di bawah (lihat bagian SETUP SQL)
 * 4. Tambahkan environment variable di Railway:
 *      SUPABASE_URL  = https://xxxxx.supabase.co
 *      SUPABASE_KEY  = eyJhbGci... (anon/service_role key)
 * 
 * ─── SETUP SQL (jalankan sekali di Supabase SQL Editor) ──────────────────────
 * 
 *   CREATE TABLE IF NOT EXISTS kv_store (
 *     key   TEXT PRIMARY KEY,
 *     value JSONB NOT NULL,
 *     updated_at TIMESTAMPTZ DEFAULT now()
 *   );
 * 
 *   -- Nonaktifkan RLS (karena akses pakai service_role key dari server)
 *   ALTER TABLE kv_store DISABLE ROW LEVEL SECURITY;
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

const https = require("https");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const TABLE        = "kv_store";

// ── Apakah Supabase aktif? ───────────────────────────────────────────────────
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

if (USE_SUPABASE) {
  console.log("✅ Supabase aktif — data tersimpan permanen");
} else {
  console.warn("⚠️  Supabase belum diset (SUPABASE_URL / SUPABASE_KEY kosong)");
  console.warn("    Data disimpan di /tmp — AKAN HILANG saat Railway restart!");
}

// ── Helper: HTTP request ke Supabase REST API ────────────────────────────────
function supabaseRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url  = new URL(SUPABASE_URL);
    const opts = {
      hostname: url.hostname,
      path:     `/rest/v1/${path}`,
      method,
      headers: {
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
      },
    };

    const req = https.request(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null });
        } catch {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Cache in-memory: kurangi round-trip ke Supabase untuk read berulang ──────
// Cache di-invalidate setiap kali ada save()
const _cache = new Map();
const CACHE_TTL_MS = 5000; // 5 detik

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(key); return undefined; }
  return entry.val;
}
function cacheSet(key, val) { _cache.set(key, { val, ts: Date.now() }); }
function cacheDel(key)      { _cache.delete(key); }

// ── dbLoad: async, ambil data dari Supabase atau fallback ke /tmp ─────────────
async function dbLoad(key, def) {
  if (!USE_SUPABASE) {
    // Fallback: baca dari file /tmp seperti semula
    const fs   = require("fs");
    const path = require("path");
    const file = key; // key adalah path file (/tmp/xxx.json)
    if (!fs.existsSync(file)) return def;
    try { return JSON.parse(fs.readFileSync(file)); } catch { return def; }
  }

  // Cek cache dulu
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    // Encode key untuk URL query
    const encodedKey = encodeURIComponent(key);
    const { status, data } = await supabaseRequest(
      "GET",
      `${TABLE}?key=eq.${encodedKey}&select=value&limit=1`
    );

    if (status === 200 && data && data.length > 0) {
      const val = data[0].value;
      cacheSet(key, val);
      return val;
    }
    return def;
  } catch (e) {
    console.error(`[DB] Load gagal untuk key "${key}":`, e.message);
    return def;
  }
}

// ── dbSave: async, simpan data ke Supabase atau fallback ke /tmp ──────────────
async function dbSave(key, data) {
  if (!USE_SUPABASE) {
    // Fallback: tulis ke file /tmp seperti semula
    const fs = require("fs");
    fs.writeFileSync(key, JSON.stringify(data, null, 2));
    return;
  }

  cacheDel(key); // Invalidate cache

  try {
    // Upsert: insert atau update jika key sudah ada
    const { status } = await supabaseRequest(
      "POST",
      `${TABLE}?on_conflict=key`,
      { key, value: data, updated_at: new Date().toISOString() }
    );

    if (status >= 400) {
      console.error(`[DB] Save gagal untuk key "${key}", status:`, status);
    }
  } catch (e) {
    console.error(`[DB] Save error untuk key "${key}":`, e.message);
    // Jangan crash server — data mungkin tidak tersimpan tapi server tetap jalan
  }
}

// ── Migrasi: pindahkan data /tmp ke Supabase (jalankan sekali saat pertama deploy) ──
async function migrateFromTmp(fileMap) {
  if (!USE_SUPABASE) return;
  const fs   = require("fs");

  console.log("[MIGRATE] Mulai cek migrasi data dari /tmp ke Supabase...");
  let migrated = 0;

  for (const [key, filePath] of Object.entries(fileMap)) {
    // Cek apakah data sudah ada di Supabase
    const existing = await dbLoad(key, null);
    if (existing !== null) {
      console.log(`[MIGRATE] ✓ "${key}" sudah ada di Supabase, skip`);
      continue;
    }

    // Cek apakah ada di /tmp
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath));
        await dbSave(key, data);
        console.log(`[MIGRATE] ✅ "${key}" berhasil dipindah dari ${filePath}`);
        migrated++;
      } catch (e) {
        console.error(`[MIGRATE] ❌ Gagal migrasi "${key}":`, e.message);
      }
    }
  }

  console.log(`[MIGRATE] Selesai. ${migrated} file berhasil dimigrasi.`);
}

module.exports = { dbLoad, dbSave, migrateFromTmp, USE_SUPABASE };
