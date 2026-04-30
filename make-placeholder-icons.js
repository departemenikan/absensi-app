#!/usr/bin/env node
/**
 * make-placeholder-icons.js
 * Jalankan: node make-placeholder-icons.js
 * TIDAK butuh dependency apapun — pakai Canvas API native Node
 * 
 * Buat placeholder icon sementara (biru dengan huruf A)
 * Ganti nanti dengan icon asli pakai generate-icons.js + sharp
 */

const fs   = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "public", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// SVG template — icon biru dengan huruf "A"
function makeSVG(size) {
  const font = Math.round(size * 0.45);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a237e"/>
      <stop offset="100%" stop-color="#4f8ef7"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size*0.2)}" fill="url(#g)"/>
  <text x="50%" y="54%" font-family="Arial,sans-serif" font-size="${font}"
    font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">A</text>
</svg>`;
}

// Simpan sebagai SVG dulu (Bubblewrap bisa pakai PNG, tapi server bisa serve SVG)
sizes.forEach(size => {
  const svgPath = path.join(outDir, `icon-${size}.svg`);
  fs.writeFileSync(svgPath, makeSVG(size));
  console.log(`✅ icon-${size}.svg`);
});

// Buat juga versi yang serve dari server (rename svg ke png agar manifest valid)
// Catatan: untuk produksi tetap pakai PNG asli
sizes.forEach(size => {
  const src  = path.join(outDir, `icon-${size}.svg`);
  const dest = path.join(outDir, `icon-${size}.png`);
  // Copy SVG ke .png sementara (Chrome bisa render SVG meski ekstensi .png)
  fs.copyFileSync(src, dest);
  console.log(`   → icon-${size}.png (sementara, SVG)`);
});

console.log("\n⚠️  Icon ini placeholder SVG. Untuk icon asli:");
console.log("   1. Siapkan icon-source.png (512x512 px)");
console.log("   2. npm install sharp");
console.log("   3. node generate-icons.js");
