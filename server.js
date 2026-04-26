const express = require("express");
const fs      = require("fs");
const path    = require("path");
const app     = express();

const PORT    = process.env.PORT || 3000;
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const IS_CLOUD = process.env.RAILWAY_ENVIRONMENT !== undefined;
const DATA_DIR = IS_CLOUD ? "/tmp" : ".";

const DATA_FILE   = path.join(DATA_DIR, "data.json");
const USERS_FILE  = path.join(DATA_DIR, "users.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

console.log(`Mode: ${IS_CLOUD ? "CLOUD" : "LOCAL"} | Port: ${PORT}`);

// =======================
// HELPER
// =======================
function loadJSON(file, def) {
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file)); } catch { return def; }
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// =======================
// AUTH
// =======================
app.post("/signup", (req, res) => {
  const { username, password, faceDescriptor } = req.body;
  if (!username || !password) return res.send({ status: "ERROR" });
  const users = loadJSON(USERS_FILE, {});
  if (users[username]) return res.send({ status: "EXIST" });
  // User pertama otomatis jadi admin
  const isFirstUser = Object.keys(users).length === 0;
  users[username] = { password, faceDescriptor: faceDescriptor || [], isAdmin: isFirstUser };
  saveJSON(USERS_FILE, users);
  res.send({ status: "OK" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const users = loadJSON(USERS_FILE, {});
  if (!users[username] || users[username].password !== password) return res.send({ status: "FAIL" });
  res.send({ status: "OK", isAdmin: users[username].isAdmin || false });
});

app.get("/check-user/:username", (req, res) => {
  const users = loadJSON(USERS_FILE, {});
  const user  = users[req.params.username];
  if (!user) return res.send({ valid: false });
  res.send({ valid: true, isAdmin: user.isAdmin || false });
});

app.get("/face-descriptor/:username", (req, res) => {
  const users = loadJSON(USERS_FILE, {});
  const user  = users[req.params.username];
  res.send({ descriptor: user ? (user.faceDescriptor || []) : [] });
});

// =======================
// ABSENSI
// =======================
app.post("/absen", (req, res) => {
  const data = loadJSON(DATA_FILE, []);
  const cfg  = loadJSON(CONFIG_FILE, { office: { lat:0, lng:0, radius:100 } });
  const { user, type, time, lat, lng, photo } = req.body;
  const today = new Date().toISOString().split("T")[0];

  if (!(lat===0 && lng===0) && cfg.office.lat !== 0) {
    const dist = getDistance(lat, lng, cfg.office.lat, cfg.office.lng);
    if (dist > cfg.office.radius) return res.status(400).send({ status:"OUT_OF_AREA", distance: Math.round(dist) });
  }

  let record = data.find(d => d.user===user && d.date===today && !d.jamKeluar);

  if (type === "IN") {
    if (record) return res.send({ status: "ALREADY_IN" });
    data.push({ user, date:today, jamMasuk:time, jamKeluar:null, lokasiMasuk:{lat,lng}, fotoMasuk:photo, breaks:[] });
  } else if (type === "OUT" && record) {
    record.jamKeluar = time;
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  } else if (type === "BREAK_START" && record) {
    record.breaks.push({ start:time, end:null });
  } else if (type === "BREAK_END" && record) {
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  }

  saveJSON(DATA_FILE, data);

  // Simpan log aktivitas
  const AKTIVITAS_FILE2 = path.join(DATA_DIR, "aktivitas.json");
  const log = loadJSON(AKTIVITAS_FILE2, []);
  log.push({ user, type, time });
  if (log.length > 200) log.splice(0, log.length - 200);
  saveJSON(AKTIVITAS_FILE2, log);

  res.send({ status: "OK" });
});

// =======================
// STATUS
// =======================
app.get("/status/:user", (req, res) => {
  const data  = loadJSON(DATA_FILE, []);
  const today = new Date().toISOString().split("T")[0];
  const aktif = data.find(d => d.user===req.params.user && d.date===today && !d.jamKeluar);
  if (!aktif) return res.send({ status:"OUT" });
  const lb = aktif.breaks.at(-1);
  if (lb && !lb.end) return res.send({ status:"BREAK" });
  return res.send({ status:"IN" });
});

// =======================
// REPORT & HISTORY
// =======================
app.get("/report/:user", (req, res) => {
  const data = loadJSON(DATA_FILE, []);
  let totalKerja = 0, totalBreak = 0;
  data.filter(d => d.user===req.params.user && d.jamKeluar).forEach(d => {
    const work  = (new Date(d.jamKeluar) - new Date(d.jamMasuk)) / 3600000;
    let bTime   = 0;
    d.breaks.forEach(b => { if (b.end) bTime += (new Date(b.end)-new Date(b.start))/3600000; });
    totalKerja += (work - bTime); totalBreak += bTime;
  });
  res.send({ totalKerja: totalKerja.toFixed(1)+"h", totalBreak: totalBreak.toFixed(1)+"h", overtime: Math.max(0,totalKerja-8).toFixed(1)+"h" });
});

app.get("/history/:user", (req, res) => {
  const data = loadJSON(DATA_FILE, []);
  res.send(data.filter(d => d.user===req.params.user).slice(-30).reverse());
});

// =======================
// ADMIN PANEL
// =======================
app.get("/admin/today", (req, res) => {
  const data  = loadJSON(DATA_FILE, []);
  const users = loadJSON(USERS_FILE, {});
  const date  = req.query.date || new Date().toISOString().split("T")[0];

  const records = Object.keys(users).map(username => {
    const rec = data.find(d => d.user===username && d.date===date);
    let status = "OUT";
    if (rec && !rec.jamKeluar) {
      const lb = rec.breaks.at(-1);
      status = (lb && !lb.end) ? "BREAK" : "IN";
    } else if (rec && rec.jamKeluar) {
      status = "DONE";
    }
    return {
      user: username,
      jamMasuk:  rec ? rec.jamMasuk  : null,
      jamKeluar: rec ? rec.jamKeluar : null,
      status
    };
  });

  res.send({ totalUsers: Object.keys(users).length, records });
});

// =======================
// CONFIG
// =======================
app.get("/config",  (req, res) => res.send(loadJSON(CONFIG_FILE, { office:{lat:0,lng:0,radius:100} })));
app.post("/config", (req, res) => {
  saveJSON(CONFIG_FILE, { office:{ lat:parseFloat(req.body.lat), lng:parseFloat(req.body.lng), radius:parseInt(req.body.radius) } });
  res.send({ status:"OK" });
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// =======================
// 👥 ANGGOTA
// =======================
app.get("/admin/members", (req, res) => {
  const users = loadJSON(USERS_FILE, {});
  const list  = Object.keys(users).map(u => ({ username: u, isAdmin: users[u].isAdmin || false }));
  res.send(list);
});

// =======================
// 📅 HARI LIBUR & CUTI
// =======================
const LIBUR_FILE = path.join(DATA_DIR, "libur.json");

app.get("/libur", (req, res) => res.send(loadJSON(LIBUR_FILE, [])));

app.post("/libur", (req, res) => {
  const { date, name, type } = req.body;
  if (!date || !name) return res.send({ status: "ERROR" });
  const data = loadJSON(LIBUR_FILE, []);
  data.push({ date, name, type: type || "nasional" });
  saveJSON(LIBUR_FILE, data);
  res.send({ status: "OK" });
});

app.delete("/libur/:index", (req, res) => {
  const data = loadJSON(LIBUR_FILE, []);
  const idx  = parseInt(req.params.index);
  if (idx < 0 || idx >= data.length) return res.send({ status: "ERROR" });
  data.splice(idx, 1);
  saveJSON(LIBUR_FILE, data);
  res.send({ status: "OK" });
});

// =======================
// 📌 AKTIVITAS
// =======================
const AKTIVITAS_FILE = path.join(DATA_DIR, "aktivitas.json");

app.get("/aktivitas", (req, res) => {
  const data = loadJSON(AKTIVITAS_FILE, []);
  res.send(data.slice(-50).reverse()); // 50 aktivitas terbaru
});

// Patch endpoint /absen agar menyimpan log aktivitas
const origAbsen = app._router.stack.find(r => r.route && r.route.path === "/absen");
// Simpan aktivitas saat absen — ditangani via middleware
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/absen-log") {
    const { user, type, time } = req.body;
    const log = loadJSON(AKTIVITAS_FILE, []);
    log.push({ user, type, time });
    if (log.length > 200) log.splice(0, log.length - 200); // max 200
    saveJSON(AKTIVITAS_FILE, log);
  }
  next();
});

// =======================
// 🕐 TIMESHEET
// =======================
app.get("/timesheet", (req, res) => {
  const month = req.query.month; // format: "2026-04"
  if (!month) return res.send([]);

  const data  = loadJSON(DATA_FILE, []);
  const users = loadJSON(USERS_FILE, {});

  const result = Object.keys(users).map(username => {
    const records = data.filter(d => d.user === username && d.date.startsWith(month) && d.jamKeluar);
    let totalJam  = 0, overtime = 0;
    records.forEach(d => {
      const work  = (new Date(d.jamKeluar) - new Date(d.jamMasuk)) / 3600000;
      let bTime   = 0;
      d.breaks.forEach(b => { if (b.end) bTime += (new Date(b.end)-new Date(b.start))/3600000; });
      const net   = work - bTime;
      totalJam   += net;
      overtime   += Math.max(0, net - 8);
    });
    return {
      user:      username,
      totalDays: records.length,
      totalJam:  totalJam.toFixed(1),
      overtime:  overtime.toFixed(1)
    };
  });

  res.send(result);
});
