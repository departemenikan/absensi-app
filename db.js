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

// ── SUPABASE STORAGE BUCKET ───────────────────────────────────────────────────
// Bucket "media" harus dibuat manual di dashboard Supabase:
//   Storage → New bucket → name: "media" → Public: OFF
//
// Path konvensi:
//   screenshots/<date>/<user>/<index>.jpg
//   workphotos/<date>/<user>/<sesi>_<ts>.jpg

const BUCKET = "media";

// Upload file ke bucket — body berupa Buffer (binary JPEG)
async function bucketUpload(filePath, buffer, contentType = "image/jpeg") {
  if (!USE_SUPABASE) return null;
  return new Promise((resolve, reject) => {
    const url     = new URL(SUPABASE_URL);
    const bodyBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const opts = {
      hostname: url.hostname,
      path:     `/storage/v1/object/${BUCKET}/${filePath}`,
      method:   "POST",
      headers: {
        "apikey":          SUPABASE_KEY,
        "Authorization":   `Bearer ${SUPABASE_KEY}`,
        "Content-Type":    contentType,
        "Content-Length":  bodyBuf.length,
        "x-upsert":        "true",
      },
    };
    const req = https.request(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        if (res.statusCode >= 400) {
          console.error(`[BUCKET] Upload gagal ${filePath}: ${res.statusCode} ${raw}`);
          resolve(null);
        } else {
          resolve(filePath);
        }
      });
    });
    req.on("error", e => { console.error("[BUCKET] Upload error:", e.message); resolve(null); });
    req.write(bodyBuf);
    req.end();
  });
}

// Hapus satu file dari bucket
async function bucketDelete(filePath) {
  if (!USE_SUPABASE) return;
  try {
    const { status } = await supabaseRequest(
      "DELETE",
      ``,  // pakai endpoint storage
      { prefixes: [filePath] },
      { "Content-Type": "application/json" }
    );
    // Pakai fetch langsung untuk storage delete (endpoint berbeda)
    return await _storageDelete([filePath]);
  } catch(e) {
    console.error("[BUCKET] Delete error:", e.message);
  }
}

// Hapus banyak file sekaligus (lebih efisien)
async function bucketDeleteMany(filePaths) {
  if (!USE_SUPABASE || !filePaths.length) return;
  return await _storageDelete(filePaths);
}

function _storageDelete(filePaths) {
  return new Promise((resolve) => {
    const url     = new URL(SUPABASE_URL);
    const bodyStr = JSON.stringify({ prefixes: filePaths });
    const opts = {
      hostname: url.hostname,
      path:     `/storage/v1/object/${BUCKET}`,
      method:   "DELETE",
      headers: {
        "apikey":          SUPABASE_KEY,
        "Authorization":   `Bearer ${SUPABASE_KEY}`,
        "Content-Type":    "application/json",
        "Content-Length":  Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", e => { console.error("[BUCKET] Delete error:", e.message); resolve(null); });
    req.write(bodyStr);
    req.end();
  });
}

// Buat signed URL (berlaku 1 jam) untuk akses private bucket
function bucketSignedUrl(filePath, expiresInSec = 3600) {
  return new Promise((resolve) => {
    const url     = new URL(SUPABASE_URL);
    const bodyStr = JSON.stringify({ expiresIn: expiresInSec });
    const opts = {
      hostname: url.hostname,
      path:     `/storage/v1/object/sign/${BUCKET}/${filePath}`,
      method:   "POST",
      headers: {
        "apikey":          SUPABASE_KEY,
        "Authorization":   `Bearer ${SUPABASE_KEY}`,
        "Content-Type":    "application/json",
        "Content-Length":  Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try {
          const d = JSON.parse(raw);
          if (d.signedURL) {
            resolve(`${SUPABASE_URL}${d.signedURL}`);
          } else {
            console.error("[BUCKET] SignedURL gagal:", raw);
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on("error", e => { console.error("[BUCKET] SignedURL error:", e.message); resolve(null); });
    req.write(bodyStr);
    req.end();
  });
}

// Helper: konversi base64 data URL → Buffer binary
function base64ToBuffer(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(base64, "base64");
}

module.exports = { dbLoad, dbSave, migrateFromTmp, USE_SUPABASE, bucketUpload, bucketDelete, bucketDeleteMany, bucketSignedUrl, base64ToBuffer };
