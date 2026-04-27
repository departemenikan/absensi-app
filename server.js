const express = require("express");
const fs      = require("fs");
const path    = require("path");
const app     = express();

const PORT     = process.env.PORT || 3000;
const IS_CLOUD = process.env.RAILWAY_ENVIRONMENT !== undefined;
const DATA_DIR = IS_CLOUD ? "/tmp" : ".";

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const F = {
  data:      path.join(DATA_DIR, "data.json"),
  users:     path.join(DATA_DIR, "users.json"),
  areas:     path.join(DATA_DIR, "areas.json"),
  libur:     path.join(DATA_DIR, "libur.json"),
  aktivitas: path.join(DATA_DIR, "aktivitas.json"),
  groups:    path.join(DATA_DIR, "groups.json"),
};

function load(file, def) {
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file)); } catch { return def; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

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

// Inisialisasi default groups jika belum ada
function initGroups() {
  if (!fs.existsSync(F.groups)) {
    const defaults = [
      {
        id: "owner", name: "Owner", level: 1, color: "#8e44ad",
        menus: ["home","rekap","admin","setting","anggota","group","area","libur","aktivitas","timesheet"]
      },
      {
        id: "admin", name: "Admin", level: 2, color: "#2980b9",
        menus: ["home","rekap","admin","setting","anggota","area","libur","aktivitas","timesheet"]
      },
      {
        id: "manager", name: "Manager", level: 3, color: "#27ae60",
        menus: ["home","rekap","admin","aktivitas","timesheet"]
      },
      {
        id: "koordinator", name: "Koordinator", level: 4, color: "#e67e22",
        menus: ["home","rekap","aktivitas"]
      },
      {
        id: "anggota", name: "Anggota", level: 5, color: "#7f8c8d",
        menus: ["home","rekap"]
      }
    ];
    save(F.groups, defaults);
  }
}
initGroups();

// ========================
// AUTH
// ========================
app.post("/signup", (req, res) => {
  const { username, password, faceDescriptor, namaLengkap, agama } = req.body;
  if (!username || !password) return res.send({ status: "ERROR" });
  const users = load(F.users, {});
  if (users[username]) return res.send({ status: "EXIST" });
  const isFirst = Object.keys(users).length === 0;
  users[username] = {
    password,
    faceDescriptor: faceDescriptor || [],
    group:       isFirst ? "owner"   : "anggota",
    peran:       isFirst ? "Owner"   : "Anggota",
    namaLengkap: namaLengkap || "",
    agama:       agama || "",
    jabatan:     "",
    divisi:      "",
    statusKerja: "Kantor",
    nominalGaji: "",
    photo:       "",
    createdAt:   new Date().toISOString()
  };
  save(F.users, users);
  res.send({ status: "OK" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const users  = load(F.users, {});
  const user   = users[username];
  if (!user || user.password !== password) return res.send({ status: "FAIL" });
  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === (user.group || "anggota")) || groups[groups.length-1];
  res.send({ status: "OK", group: group.id, menus: group.menus, level: group.level });
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
app.post("/absen", (req, res) => {
  const data = load(F.data, []);
  const areas = load(F.areas, []);
  const { user, type, time, lat, lng, photo, areaId } = req.body;
  const today = new Date().toISOString().split("T")[0];

  // Validasi area — cek semua area aktif jika ada koordinat
  if (lat !== 0 && lng !== 0 && areas.length > 0) {
    const targetArea = areaId ? areas.find(a => a.id === areaId) : null;
    const checkAreas = targetArea ? [targetArea] : areas.filter(a => a.active);
    if (checkAreas.length > 0) {
      const inAny = checkAreas.some(a => dist(lat, lng, a.lat, a.lng) <= a.radius);
      if (!inAny) {
        const nearest = checkAreas.reduce((best, a) => {
          const d = dist(lat, lng, a.lat, a.lng);
          return d < best.d ? { d, name: a.name } : best;
        }, { d: Infinity, name: "" });
        return res.status(400).send({ status: "OUT_OF_AREA", distance: Math.round(nearest.d), area: nearest.name });
      }
    }
  }

  let record = data.find(d => d.user === user && d.date === today && !d.jamKeluar);

  if (type === "IN") {
    if (record) return res.send({ status: "ALREADY_IN" });
    data.push({ user, date: today, jamMasuk: time, jamKeluar: null, lokasi: { lat, lng }, foto: photo, breaks: [] });
  } else if (type === "OUT" && record) {
    record.jamKeluar = time;
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  } else if (type === "BREAK_START" && record) {
    record.breaks.push({ start: time, end: null });
  } else if (type === "BREAK_END" && record) {
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  }

  save(F.data, data);
  logAktivitas(user, type, time);
  res.send({ status: "OK" });
});

app.get("/status/:user", (req, res) => {
  const data  = load(F.data, []);
  const today = new Date().toISOString().split("T")[0];
  const aktif = data.find(d => d.user === req.params.user && d.date === today && !d.jamKeluar);
  if (!aktif) return res.send({ status: "OUT" });
  const lb = aktif.breaks.at(-1);
  if (lb && !lb.end) return res.send({ status: "BREAK" });
  return res.send({ status: "IN" });
});

// ========================
// REPORT & HISTORY
// ========================
app.get("/report/:user", (req, res) => {
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

app.get("/history/:user", (req, res) => {
  const data = load(F.data, []);
  res.send(data.filter(d => d.user === req.params.user).slice(-30).reverse());
});

// ========================
// ADMIN
// ========================
app.get("/admin/today", (req, res) => {
  const data  = load(F.data, []);
  const users = load(F.users, {});
  const date  = req.query.date || new Date().toISOString().split("T")[0];
  const records = Object.keys(users).map(username => {
    const rec = data.find(d => d.user === username && d.date === date);
    let status = "OUT";
    if (rec && !rec.jamKeluar) { const lb = rec.breaks.at(-1); status = (lb && !lb.end) ? "BREAK" : "IN"; }
    else if (rec && rec.jamKeluar) status = "DONE";
    return { user: username, jamMasuk: rec?.jamMasuk||null, jamKeluar: rec?.jamKeluar||null, status };
  });
  res.send({ totalUsers: Object.keys(users).length, records });
});

// ========================
// PROFIL
// ========================
app.get("/profile/:username", (req, res) => {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const user   = users[req.params.username];
  if (!user) return res.send({ status: "NOT_FOUND" });
  const group  = groups.find(g => g.id === (user.group || "anggota")) || groups[groups.length-1];
  res.send({
    username:    req.params.username,
    namaLengkap: user.namaLengkap  || "",
    agama:       user.agama        || "",
    jabatan:     user.jabatan      || "",
    peran:       user.peran || group?.name || "Anggota",
    group:       user.group        || "anggota",
    groupName:   group?.name       || "Anggota",
    groupColor:  group?.color      || "#7f8c8d",
    divisi:      user.divisi      || "",
    statusKerja: user.statusKerja  || "Kantor",
    nominalGaji: user.nominalGaji  || "",
    photo:       user.photo        || "",
    faceDescriptor: user.faceDescriptor || [],
  });
});

app.put("/profile/:username", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const allowed = ["namaLengkap","agama","jabatan","divisi","statusKerja","nominalGaji"];
  allowed.forEach(k => { if (req.body[k] !== undefined) users[req.params.username][k] = req.body[k]; });
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/photo", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].photo = req.body.photo || "";
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/face", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].faceDescriptor = req.body.faceDescriptor || [];
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/password", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const { oldPassword, newPassword } = req.body;
  if (users[req.params.username].password !== oldPassword) return res.send({ status: "WRONG_PASSWORD" });
  users[req.params.username].password = newPassword;
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// ANGGOTA
// ========================
app.get("/anggota", (req, res) => {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const list   = Object.keys(users).map(u => {
    const g = groups.find(g => g.id === (users[u].group || "anggota"));
    return { username: u, group: users[u].group || "anggota", groupName: g?.name || "Anggota", groupColor: g?.color || "#7f8c8d", createdAt: users[u].createdAt || "" };
  });
  res.send(list);
});

app.put("/anggota/:username/group", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].group = req.body.group;
  save(F.users, users);
  res.send({ status: "OK" });
});

app.delete("/anggota/:username", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  delete users[req.params.username];
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// GROUP / ROLE
// ========================
app.get("/groups", (req, res) => res.send(load(F.groups, [])));

app.put("/groups/:id/menus", (req, res) => {
  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === req.params.id);
  if (!group) return res.send({ status: "NOT_FOUND" });
  if (group.id === "owner") return res.send({ status: "PROTECTED" }); // owner tidak bisa diubah
  group.menus = req.body.menus;
  save(F.groups, groups);
  res.send({ status: "OK" });
});

// ========================
// AREA (multi-area)
// ========================
app.get("/areas", (req, res) => res.send(load(F.areas, [])));

app.post("/areas", (req, res) => {
  const { name, lat, lng, radius } = req.body;
  if (!name || !lat || !lng) return res.send({ status: "ERROR" });
  const areas = load(F.areas, []);
  areas.push({ id: Date.now().toString(), name, lat: parseFloat(lat), lng: parseFloat(lng), radius: parseInt(radius)||100, active: true });
  save(F.areas, areas);
  res.send({ status: "OK" });
});

app.put("/areas/:id", (req, res) => {
  const areas = load(F.areas, []);
  const area  = areas.find(a => a.id === req.params.id);
  if (!area) return res.send({ status: "NOT_FOUND" });
  Object.assign(area, { name: req.body.name||area.name, lat: parseFloat(req.body.lat)||area.lat, lng: parseFloat(req.body.lng)||area.lng, radius: parseInt(req.body.radius)||area.radius, active: req.body.active !== undefined ? req.body.active : area.active });
  save(F.areas, areas);
  res.send({ status: "OK" });
});

app.delete("/areas/:id", (req, res) => {
  const areas = load(F.areas, []);
  const idx   = areas.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  areas.splice(idx, 1);
  save(F.areas, areas);
  res.send({ status: "OK" });
});

// ========================
// HARI LIBUR & CUTI
// ========================
app.get("/libur", (req, res) => res.send(load(F.libur, [])));
app.post("/libur", (req, res) => {
  const { date, name, type } = req.body;
  if (!date || !name) return res.send({ status: "ERROR" });
  const data = load(F.libur, []);
  data.push({ id: Date.now().toString(), date, name, type: type||"nasional" });
  save(F.libur, data); res.send({ status: "OK" });
});
app.delete("/libur/:id", (req, res) => {
  const data = load(F.libur, []);
  const idx  = data.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  data.splice(idx, 1); save(F.libur, data); res.send({ status: "OK" });
});

// ========================
// AKTIVITAS
// ========================
app.get("/aktivitas", (req, res) => {
  const data = load(F.aktivitas, []);
  res.send(data.slice(-100).reverse());
});

// ========================
// TIMESHEET
// ========================
app.get("/timesheet", (req, res) => {
  const month = req.query.month;
  if (!month) return res.send([]);
  const data  = load(F.data, []);
  const users = load(F.users, {});
  const result = Object.keys(users).map(username => {
    const recs = data.filter(d => d.user === username && d.date.startsWith(month) && d.jamKeluar);
    let totalJam = 0, overtime = 0;
    recs.forEach(d => {
      const work = (new Date(d.jamKeluar)-new Date(d.jamMasuk))/3600000;
      let bt = 0; d.breaks.forEach(b => { if (b.end) bt += (new Date(b.end)-new Date(b.start))/3600000; });
      const net = work-bt; totalJam += net; overtime += Math.max(0, net-8);
    });
    return { user: username, totalDays: recs.length, totalJam: totalJam.toFixed(1), overtime: overtime.toFixed(1) };
  });
  res.send(result);
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));