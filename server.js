const express = require("express");
const fs      = require("fs");
const path    = require("path");
const app     = express();

const PORT     = process.env.PORT || 3000;
const IS_CLOUD = process.env.RAILWAY_ENVIRONMENT !== undefined;
const DATA_DIR = IS_CLOUD ? "/tmp" : ".";

app.use(express.json({ limit: "15mb" }));
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

// ========================
// ROLE (3 level app-management: owner / admin / anggota)
// ========================
const ROLES = {
  owner:   { name: "Owner",   level: 1, color: "#8e44ad",
    menus: ["home","rekap","admin","setting","profil","anggota","group","area","libur","aktivitas","timesheet"] },
  admin:   { name: "Admin",   level: 2, color: "#2980b9",
    menus: ["home","rekap","admin","setting","profil","anggota","group","area","libur","aktivitas","timesheet"] },
  anggota: { name: "Anggota", level: 3, color: "#7f8c8d",
    menus: ["home","rekap","setting","profil"] },
};
function getRoleInfo(r) { return ROLES[r] || ROLES.anggota; }

// Migrasi field lama "group" (manager/koordinator/dll) -> "role" (owner/admin/anggota)
function migrateUser(u) {
  let changed = false;
  if (!u.role) {
    const old = u.group || "anggota";
    if      (old === "owner") u.role = "owner";
    else if (old === "admin") u.role = "admin";
    else                      u.role = "anggota";
    changed = true;
  }
  if (u.fullName     === undefined) { u.fullName = u.fullName || ""; changed = true; }
  if (u.religion     === undefined) { u.religion = ""; changed = true; }
  if (u.facePhoto    === undefined) { u.facePhoto = ""; changed = true; }
  if (u.profilePhoto === undefined) { u.profilePhoto = ""; changed = true; }
  if (u.jabatan      === undefined) { u.jabatan = ""; changed = true; }
  if (u.lingkupKerja === undefined) { u.lingkupKerja = ""; changed = true; }
  if (u.tugasLuar    === undefined) { u.tugasLuar = false; changed = true; }
  if (u.groupId      === undefined) { u.groupId = null; changed = true; }
  if (u.nominalGaji  === undefined) { u.nominalGaji = 0; changed = true; }
  return changed;
}
function migrateAllUsers() {
  const users = load(F.users, {});
  let anyChange = false;
  Object.keys(users).forEach(k => { if (migrateUser(users[k])) anyChange = true; });
  if (anyChange) save(F.users, users);
}
migrateAllUsers();

// Init file groups (untuk divisi — dipakai di Batch 2)
if (!fs.existsSync(F.groups)) save(F.groups, []);

// ========================
// AUTH
// ========================
app.post("/signup", (req, res) => {
  const { username, password, fullName, religion, faceDescriptor, facePhoto } = req.body;
  if (!username || !password) return res.send({ status: "ERROR", msg: "Username & password wajib" });
  if (!fullName)             return res.send({ status: "ERROR", msg: "Nama Lengkap wajib diisi" });
  if (!religion)             return res.send({ status: "ERROR", msg: "Agama wajib dipilih" });

  const users = load(F.users, {});
  if (users[username]) return res.send({ status: "EXIST" });

  const isFirst = Object.keys(users).length === 0;
  users[username] = {
    password,
    fullName,
    religion,
    faceDescriptor: faceDescriptor || [],
    facePhoto:      facePhoto      || "",
    profilePhoto:   "",
    role:           isFirst ? "owner" : "anggota",
    groupId:        null,
    jabatan:        "",
    lingkupKerja:   "",
    tugasLuar:      false,
    nominalGaji:    0,
    createdAt:      new Date().toISOString()
  };
  save(F.users, users);
  res.send({ status: "OK" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const users = load(F.users, {});
  const user  = users[username];
  if (!user || user.password !== password) return res.send({ status: "FAIL" });
  if (migrateUser(user)) save(F.users, users);
  const r = getRoleInfo(user.role);
  res.send({ status: "OK", role: user.role, menus: r.menus, level: r.level });
});

app.get("/check-user/:username", (req, res) => {
  const users = load(F.users, {});
  const user  = users[req.params.username];
  if (!user) return res.send({ valid: false });
  if (migrateUser(user)) save(F.users, users);
  const r = getRoleInfo(user.role);
  res.send({ valid: true, role: user.role, menus: r.menus, level: r.level });
});

app.get("/face-descriptor/:username", (req, res) => {
  const users = load(F.users, {});
  const user  = users[req.params.username];
  res.send({ descriptor: user ? (user.faceDescriptor || []) : [] });
});

// ========================
// PROFIL
// ========================
app.get("/profil/:username", (req, res) => {
  const users = load(F.users, {});
  const user  = users[req.params.username];
  if (!user) return res.status(404).send({ status: "NOT_FOUND" });

  const requester = req.query.by || "";
  const reqUser   = users[requester];
  const isSelf    = requester === req.params.username;
  const isOwner   = reqUser && reqUser.role === "owner";
  const isAdmin   = reqUser && reqUser.role === "admin";
  const canLogin  = isSelf || isOwner || isAdmin;

  res.send({
    username:     req.params.username,
    fullName:     user.fullName     || "",
    religion:     user.religion     || "",
    role:         user.role         || "anggota",
    roleName:     getRoleInfo(user.role).name,
    groupId:      user.groupId      || null,
    jabatan:      user.jabatan      || "",
    lingkupKerja: user.lingkupKerja || "",
    tugasLuar:    user.tugasLuar    || false,
    profilePhoto: user.profilePhoto || "",
    facePhoto:    user.facePhoto    || "",
    createdAt:    user.createdAt    || "",
    canSeeLogin:  canLogin,
    password:     canLogin ? user.password : "",
    nominalGaji:  isOwner  ? (user.nominalGaji || 0) : null,
    canSeeGaji:   !!isOwner,
  });
});

app.put("/profil/:username", (req, res) => {
  const users = load(F.users, {});
  const user  = users[req.params.username];
  if (!user) return res.status(404).send({ status: "NOT_FOUND" });

  const requester = req.body.by || "";
  const reqUser   = users[requester];
  if (!reqUser) return res.status(403).send({ status: "FORBIDDEN" });

  const isSelf  = requester === req.params.username;
  const isOwner = reqUser.role === "owner";
  const isAdmin = reqUser.role === "admin";
  const b = req.body;

  if (isSelf) {
    if (b.fullName       !== undefined) user.fullName     = b.fullName;
    if (b.profilePhoto   !== undefined) user.profilePhoto = b.profilePhoto;
    if (b.password       !== undefined && b.password) user.password = b.password;
    if (b.facePhoto      !== undefined) user.facePhoto      = b.facePhoto;
    if (b.faceDescriptor !== undefined) user.faceDescriptor = b.faceDescriptor;
  }
  if (isOwner || isAdmin) {
    if (b.jabatan      !== undefined) user.jabatan      = b.jabatan;
    if (b.lingkupKerja !== undefined) user.lingkupKerja = b.lingkupKerja;
    if (b.tugasLuar    !== undefined) user.tugasLuar    = !!b.tugasLuar;
    if (b.groupId      !== undefined) user.groupId      = b.groupId;
  }
  if (isOwner) {
    if (b.role         !== undefined && ROLES[b.role]) user.role = b.role;
    if (b.nominalGaji  !== undefined) user.nominalGaji = parseInt(b.nominalGaji) || 0;
  }
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// ABSENSI
// ========================
app.post("/absen", (req, res) => {
  const data  = load(F.data, []);
  const areas = load(F.areas, []);
  const { user, type, time, lat, lng, photo, areaId } = req.body;
  const today = new Date().toISOString().split("T")[0];

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
// ANGGOTA
// ========================
app.get("/anggota", (req, res) => {
  const users = load(F.users, {});
  const list  = Object.keys(users).map(u => {
    const usr = users[u];
    const r = getRoleInfo(usr.role || "anggota");
    return {
      username:     u,
      fullName:     usr.fullName || u,
      role:         usr.role     || "anggota",
      roleName:     r.name,
      roleColor:    r.color,
      religion:     usr.religion || "",
      profilePhoto: usr.profilePhoto || "",
      jabatan:      usr.jabatan  || "",
      groupId:      usr.groupId  || null,
      createdAt:    usr.createdAt|| ""
    };
  });
  res.send(list);
});

app.delete("/anggota/:username", (req, res) => {
  const users     = load(F.users, {});
  const requester = req.query.by || "";
  const reqUser   = users[requester];
  if (!reqUser || (reqUser.role !== "owner" && reqUser.role !== "admin"))
    return res.status(403).send({ status: "FORBIDDEN" });
  if (requester === req.params.username)
    return res.send({ status: "SELF_NOT_ALLOWED" });
  const target = users[req.params.username];
  if (!target) return res.send({ status: "NOT_FOUND" });
  if (target.role === "owner" && reqUser.role !== "owner")
    return res.status(403).send({ status: "FORBIDDEN" });

  delete users[req.params.username];
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// ROLES (dropdown pilihan role)
// ========================
app.get("/roles", (req, res) => {
  res.send(Object.entries(ROLES).map(([id, r]) => ({
    id, name: r.name, level: r.level, color: r.color
  })));
});

// ========================
// GROUP (divisi — detail di Batch 2)
// Kompatibilitas lama: endpoint ubah role via /anggota/:username/group
// ========================
app.get("/groups", (req, res) => res.send(load(F.groups, [])));

// Kompat: ubah role user (dipakai tab "Group" lama -> kita jadikan ubah ROLE)
app.put("/anggota/:username/role", (req, res) => {
  const users = load(F.users, {});
  const u = users[req.params.username];
  if (!u) return res.send({ status: "NOT_FOUND" });
  if (!ROLES[req.body.role]) return res.send({ status: "INVALID_ROLE" });
  u.role = req.body.role;
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// AREA
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
  Object.assign(area, {
    name: req.body.name||area.name,
    lat: parseFloat(req.body.lat)||area.lat,
    lng: parseFloat(req.body.lng)||area.lng,
    radius: parseInt(req.body.radius)||area.radius,
    active: req.body.active !== undefined ? req.body.active : area.active
  });
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
// HARI LIBUR
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
