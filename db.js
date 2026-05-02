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

const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

if (USE_SUPABASE) {
  console.log("✅ Supabase aktif — data tersimpan permanen");
} else {
  console.warn("⚠️  Supabase belum diset (SUPABASE_URL / SUPABASE_KEY kosong)");
  console.warn("    Data disimpan di /tmp — AKAN HILANG saat Railway restart!");
}

// ── Helper: HTTP request ke Supabase REST API ────────────────────────────────
function supabaseRequest(method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url  = new URL(SUPABASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path:     `/rest/v1/${path}`,
      method,
      headers: {
        "apikey":          SUPABASE_KEY,
        "Authorization":   `Bearer ${SUPABASE_KEY}`,
        "Content-Type":    "application/json",
        "Prefer":          "return=representation",
        ...extraHeaders,
      },
    };
    if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);

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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Cache in-memory ───────────────────────────────────────────────────────────
const _cache    = new Map();
const CACHE_TTL = 5000;

function cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return undefined; }
  return e.val;
}
function cacheSet(key, val) { _cache.set(key, { val, ts: Date.now() }); }
function cacheDel(key)      { _cache.delete(key); }

// ── dbLoad ────────────────────────────────────────────────────────────────────
async function dbLoad(key, def) {
  if (!USE_SUPABASE) {
    const fs = require("fs");
    if (!fs.existsSync(key)) return def;
    try { return JSON.parse(fs.readFileSync(key)); } catch { return def; }
  }

  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const encodedKey = encodeURIComponent(key);
    const { status, data } = await supabaseRequest(
      "GET",
      `${TABLE}?key=eq.${encodedKey}&select=value&limit=1`
    );
    if (status === 200 && data && data.length > 0) {
      cacheSet(key, data[0].value);
      return data[0].value;
    }
    return def;
  } catch (e) {
    console.error(`[DB] Load gagal untuk key "${key}":`, e.message);
    return def;
  }
}

// ── dbSave — FIX: pakai PATCH jika sudah ada, POST jika belum ────────────────
async function dbSave(key, data) {
  if (!USE_SUPABASE) {
    const fs = require("fs");
    fs.writeFileSync(key, JSON.stringify(data, null, 2));
    return;
  }

  cacheDel(key);

  try {
    const encodedKey = encodeURIComponent(key);

    // Cek apakah record sudah ada
    const check = await supabaseRequest("GET", `${TABLE}?key=eq.${encodedKey}&select=key&limit=1`);
    const exists = check.status === 200 && check.data && check.data.length > 0;

    let status;
    if (exists) {
      // UPDATE — pakai PATCH dengan filter key
      ({ status } = await supabaseRequest(
        "PATCH",
        `${TABLE}?key=eq.${encodedKey}`,
        { value: data, updated_at: new Date().toISOString() }
      ));
    } else {
      // INSERT baru
      ({ status } = await supabaseRequest(
        "POST",
        TABLE,
        { key, value: data, updated_at: new Date().toISOString() }
      ));
    }

    if (status >= 400) {
      console.error(`[DB] Save gagal untuk key "${key}", status:`, status);
    }
  } catch (e) {
    console.error(`[DB] Save error untuk key "${key}":`, e.message);
  }
}

// ── Migrasi dari /tmp ─────────────────────────────────────────────────────────
async function migrateFromTmp(fileMap) {
  if (!USE_SUPABASE) return;
  const fs = require("fs");

  console.log("[MIGRATE] Mulai cek migrasi data dari /tmp ke Supabase...");
  let migrated = 0;

  for (const [key, filePath] of Object.entries(fileMap)) {
    const existing = await dbLoad(key, null);
    if (existing !== null) {
      console.log(`[MIGRATE] ✓ "${key}" sudah ada di Supabase, skip`);
      continue;
    }
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
