const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();

// Railway otomatis set PORT — jangan hardcode 3000
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Di Railway, simpan data di /tmp karena itu satu-satunya folder yang bisa ditulis
// Di lokal tetap pakai folder project biasa
const IS_CLOUD = process.env.RAILWAY_ENVIRONMENT !== undefined;
const DATA_DIR = IS_CLOUD ? "/tmp" : ".";

const DATA_FILE   = path.join(DATA_DIR, "data.json");
const USERS_FILE  = path.join(DATA_DIR, "users.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

console.log(`Mode: ${IS_CLOUD ? "CLOUD (Railway)" : "LOCAL"}`);
console.log(`Data dir: ${DATA_DIR}`);

// =======================
// 🔐 HELPER
// =======================
function loadJSON(file, defaultVal) {
  if (!fs.existsSync(file)) return defaultVal;
  try { return JSON.parse(fs.readFileSync(file)); }
  catch { return defaultVal; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// =======================
// 🔐 AUTH
// =======================
app.post("/signup", (req, res) => {
  const { username, password, faceDescriptor } = req.body;
  if (!username || !password) return res.send({ status: "ERROR" });

  const users = loadJSON(USERS_FILE, {});
  if (users[username]) return res.send({ status: "EXIST" });

  users[username] = {
    password,
    faceDescriptor: faceDescriptor || []
  };
  saveJSON(USERS_FILE, users);
  res.send({ status: "OK" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send({ status: "ERROR" });

  const users = loadJSON(USERS_FILE, {});
  if (!users[username] || users[username].password !== password) {
    return res.send({ status: "FAIL" });
  }
  res.send({ status: "OK" });
});

app.get("/check-user/:username", (req, res) => {
  const users = loadJSON(USERS_FILE, {});
  res.send({ valid: !!users[req.params.username] });
});

// =======================
// 👤 FACE DESCRIPTOR
// =======================
app.get("/face-descriptor/:username", (req, res) => {
  const users = loadJSON(USERS_FILE, {});
  const user  = users[req.params.username];
  if (!user) return res.send({ descriptor: [] });
  res.send({ descriptor: user.faceDescriptor || [] });
});

// =======================
// 🕒 ABSENSI + GEOFENCING
// =======================
app.post("/absen", (req, res) => {
  const data = loadJSON(DATA_FILE, []);
  const cfg  = loadJSON(CONFIG_FILE, { office: { lat: 0, lng: 0, radius: 100 } });
  const { user, type, time, lat, lng, photo } = req.body;
  const today = new Date().toISOString().split("T")[0];

  if (!(lat === 0 && lng === 0) && cfg.office.lat !== 0) {
    const distance = getDistance(lat, lng, cfg.office.lat, cfg.office.lng);
    if (distance > cfg.office.radius) {
      return res.status(400).send({ status: "OUT_OF_AREA", distance: Math.round(distance) });
    }
  }

  let record = data.find(d => d.user === user && d.date === today && !d.jamKeluar);

  if (type === "IN") {
    if (record) return res.send({ status: "ALREADY_IN" });
    data.push({
      user, date: today, jamMasuk: time, jamKeluar: null,
      lokasiMasuk: { lat, lng }, fotoMasuk: photo, breaks: []
    });
  }
  else if (type === "OUT" && record) {
    record.jamKeluar = time;
    let lastBreak = record.breaks.at(-1);
    if (lastBreak && !lastBreak.end) lastBreak.end = time;
  }
  else if (type === "BREAK_START" && record) {
    record.breaks.push({ start: time, end: null });
  }
  else if (type === "BREAK_END" && record) {
    let last = record.breaks.at(-1);
    if (last && !last.end) last.end = time;
  }

  saveJSON(DATA_FILE, data);
  res.send({ status: "OK" });
});

// =======================
// 📊 STATUS
// =======================
app.get("/status/:user", (req, res) => {
  const data  = loadJSON(DATA_FILE, []);
  const today = new Date().toISOString().split("T")[0];
  const aktif = data.find(d => d.user === req.params.user && d.date === today && !d.jamKeluar);

  if (!aktif) return res.send({ status: "OUT" });
  let lastBreak = aktif.breaks.at(-1);
  if (lastBreak && !lastBreak.end) return res.send({ status: "BREAK" });
  return res.send({ status: "IN" });
});

// =======================
// 📊 REPORT & HISTORY
// =======================
app.get("/report/:user", (req, res) => {
  const data = loadJSON(DATA_FILE, []);
  let totalKerja = 0, totalBreak = 0;
  data.filter(d => d.user === req.params.user && d.jamKeluar).forEach(d => {
    let work  = (new Date(d.jamKeluar) - new Date(d.jamMasuk)) / 3600000;
    let bTime = 0;
    d.breaks.forEach(b => { if (b.end) bTime += (new Date(b.end) - new Date(b.start)) / 3600000; });
    totalKerja += (work - bTime);
    totalBreak += bTime;
  });
  res.send({
    totalKerja: totalKerja.toFixed(1) + "h",
    totalBreak: totalBreak.toFixed(1) + "h",
    overtime:   Math.max(0, totalKerja - 8).toFixed(1) + "h"
  });
});

app.get("/history/:user", (req, res) => {
  const data = loadJSON(DATA_FILE, []);
  res.send(data.filter(d => d.user === req.params.user).slice(-5).reverse());
});

// =======================
// ⚙️ CONFIG
// =======================
app.get("/config",  (req, res) => res.send(loadJSON(CONFIG_FILE, { office: { lat: 0, lng: 0, radius: 100 } })));
app.post("/config", (req, res) => {
  saveJSON(CONFIG_FILE, {
    office: {
      lat:    parseFloat(req.body.lat),
      lng:    parseFloat(req.body.lng),
      radius: parseInt(req.body.radius)
    }
  });
  res.send({ status: "OK" });
});

app.listen(PORT, () => console.log(`✅ Server berjalan di port ${PORT}`));
