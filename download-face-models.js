/**
 * download-face-models.js
 * Jalankan SEKALI: node download-face-models.js
 * Akan download model face-api ke folder public/model/
 * Setelah selesai, commit folder public/model/ ke GitHub
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const BASE_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
const OUT_DIR  = path.join(__dirname, "public", "model");

// Semua file model yang dibutuhkan
const FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model-shard1",
  "ssd_mobilenetv1_model-shard2",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model-shard1",
  "face_recognition_model-shard2",
];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function download(filename) {
  return new Promise((resolve, reject) => {
    const url     = `${BASE_URL}/${filename}`;
    const outPath = path.join(OUT_DIR, filename);

    if (fs.existsSync(outPath)) {
      console.log(`⏭  Skip (sudah ada): ${filename}`);
      return resolve();
    }

    const file = fs.createWriteStream(outPath);
    console.log(`⬇  Downloading: ${filename}`);

    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        https.get(res.headers.location, (res2) => {
          res2.pipe(file);
          file.on("finish", () => { file.close(); console.log(`✅ ${filename}`); resolve(); });
        }).on("error", reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); console.log(`✅ ${filename}`); resolve(); });
    }).on("error", (e) => {
      fs.unlink(outPath, () => {});
      reject(e);
    });
  });
}

async function main() {
  console.log("🚀 Download model face-api ke public/model/\n");
  for (const f of FILES) {
    await download(f);
  }
  console.log("\n✅ Semua model berhasil didownload!");
  console.log("📁 Lokasi: public/model/");
  console.log("\n📌 Langkah selanjutnya:");
  console.log("   1. git add public/model/");
  console.log("   2. git commit -m 'add face-api models'");
  console.log("   3. git push  → Railway auto-deploy");
}

main().catch(console.error);
