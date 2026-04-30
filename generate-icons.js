#!/usr/bin/env node
/**
 * generate-icons.js
 * Jalankan: node generate-icons.js
 * Butuh: npm install sharp
 * 
 * Script ini generate semua ukuran icon PNG dari icon-source.png (512x512)
 * Taruh file icon-source.png (512x512px) di folder yang sama lalu jalankan script ini
 */

const sharp  = require("sharp");
const fs     = require("fs");
const path   = require("path");

const sizes  = [72, 96, 128, 144, 152, 192, 384, 512];
const outDir = path.join(__dirname, "public", "icons");

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const src = path.join(__dirname, "icon-source.png");
if (!fs.existsSync(src)) {
  console.error("❌ File icon-source.png tidak ditemukan!");
  console.log("   Buat/taruh file PNG 512x512 px dengan nama icon-source.png");
  process.exit(1);
}

async function generate() {
  for (const size of sizes) {
    const out = path.join(outDir, `icon-${size}.png`);
    await sharp(src)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`✅ icon-${size}.png`);
  }
  console.log("\n🎉 Semua icon berhasil dibuat di folder public/icons/");
}

generate().catch(console.error);
