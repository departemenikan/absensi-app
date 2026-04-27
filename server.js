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
  divisi:    path.join(DATA_DIR, "divisi.json"),
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
// ROLES
// ========================
const ROLES = {
  owner: {
    name: "Owner", level: 1, color: "#8e44ad",
    menus: ["home","timesheet","setting","profil","rekap","admin","anggota","divisi","area","libur","aktivitas"]
  },
  admin: {
    name: "Admin", level: 2, color: "#2980b9",
    menus: ["home","timesheet","setting","profil","rekap","admin","anggota","divisi","area","libur","aktivitas"]
  },
  anggota: {
    name: "Anggota", level: 3, color: "#7f8c8d",
    menus: ["home","timesheet","setting","profil","rekap"]
  },
};
function getRoleInfo(r) { return ROLES[r] || ROLES.anggota; }

// ========================
// MIGRASI & HELPERS
// ========================
function migrateUser(u) {
  let changed = false;
  if (!u.role) {
    const old = u.group || "anggota";
    if      (old === "owner") u.role = "owner";
    else if (old === "admin") u.role = "admin";
    else                      u.role = "anggota";
    changed = true;
  }
  if (u.fullName     === undefined) { u.fullName     = ""; changed = true; }
  if (u.religion     === undefined) { u.religion     = ""; changed = true; }
  if (u.facePhoto    === undefined) { u.facePhoto    = ""; changed = true; }
  if (u.profilePhoto === undefined) { u.profilePhoto = ""; changed = true; }
  if (u.jabatan      === undefined) { u.jabatan      = ""; changed = true; }
  if (u.lingkupKerja === undefined) { u.lingkupKerja = ""; changed = true; }
  if (u.tugasLuar    === undefined) { u.tugasLuar    = false; changed = true; }
  if (u.nominalGaji  === undefined) { u.nominalGaji  = 0; changed = true; }
  if (u.divisiIds    === undefined) { u.divisiIds    = []; changed = true; }
  return changed;
}
function migrateAllUsers() {
  const users = load(F.users, {});
  let any = false;
  Object.keys(users).forEach(k => { if (migrateUser(users[k])) any = true; });
  if (any) save(F.users, users);
}
migrateAllUsers();

if (!fs.existsSync(F.divisi)) save(F.divisi, []);

function syncUserDivisiIds() {
  const divisi = load(F.divisi, []);
  const users  = load(F.users, {});
  const map = {};
  divisi.forEach(d => {
    const all = new Set(d.memberUsernames || []);
    if (d.managerUsername) all.add(d.managerUsername);
    all.forEach(u => {
      if (!map[u]) map[u] = [];
      if (!map[u].includes(d.id)) map[u].push(d.id);
    });
  });
  let changed = false;
  Object.keys(users).forEach(uname => {
    const newList = (map[uname] || []).sort();
    const oldList = [...(users[uname].divisiIds || [])].sort();
    if (JSON.stringify(newList) !== JSON.stringify(oldList)) {
      users[uname].divisiIds = newList; changed = true;
    }
  });
  if (changed) save(F.users, users);
}

function normalizeDivisi(d) {
  d.memberUsernames = Array.isArray(d.memberUsernames) ? [...new Set(d.memberUsernames)] : [];
  if (d.managerUsername && !d.memberUsernames.includes(d.managerUsername)) {
    d.memberUsernames.push(d.managerUsername);
  }
  return d;
}
// ========================
// AUTH (lanjutan)
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
    divisiIds:      [],
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

  const divisi = load(F.divisi, []);
  const divs   = (user.divisiIds || [])
    .map(id => divisi.find(x => x.id === id))
    .filter(Boolean)
    .map(d => ({ id: d.id, name: d.name, isManager: d.managerUsername === req.params.username }));

  res.send({
    username:     req.params.username,
    fullName:     user.fullName     || "",
    religion:     user.religion     || "",
    role:         user.role         || "anggota",
    roleName:     getRoleInfo(user.role).name,
    divisiList:   divs,
    divisiNames:  divs.map(d => d.name).join(", "),
    jabatan:      user.jabatan      || "",
    lingkupKerja: user.lingkupKerja || "",
    tugasLuar:    !!user.tugasLuar,
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
  }
  if (isOwner) {
    if (b.role         !== undefined && ROLES[b.role]) user.role = b.role;
    if (b.nominalGaji  !== undefined) user.nominalGaji  = parseInt(b.nominalGaji) || 0;
  }
  save(F.users, users);
  res.send({ status: "OK" });
});
// ========================
// ABSENSI (dengan Tugas Luar)
// ========================
app.post("/absen", (req, res) => {
  const data  = load(F.data, []);
  const areas = load(F.areas, []);
  const users = load(F.users, {});
  const { user, type, time, lat, lng, photo, areaId } = req.body;
  const today = new Date().toISOString().split("T")[0];

  const usr = users[user];
  const skipArea = usr && usr.tugasLuar === true;

  if (!skipArea && lat !== 0 && lng !== 0 && areas.length > 0) {
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
    data.push({
      user, date: today, jamMasuk: time, jamKeluar: null,
      lokasi: { lat, lng }, foto: photo, breaks: [],
      tugasLuar: skipArea || false
    });
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
  res.send({ status: "OK", tugasLuar: skipArea });
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
  res.send({
    totalKerja: totalKerja.toFixed(1)+"h",
    totalBreak: totalBreak.toFixed(1)+"h",
    overtime:   Math.max(0, totalKerja-8).toFixed(1)+"h"
  });
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
    return {
      user: username,
      fullName: users[username].fullName || username,
      jamMasuk: rec?.jamMasuk || null,
      jamKeluar: rec?.jamKeluar || null,
      status
    };
  });
  res.send({ totalUsers: Object.keys(users).length, records });
});

// ========================
// ANGGOTA
// ========================
app.get("/anggota", (req, res) => {
  const users  = load(F.users, {});
  const divisi = load(F.divisi, []);
  const list   = Object.keys(users).map(u => {
    const usr = users[u];
    const r   = getRoleInfo(usr.role || "anggota");
    const divNames = (usr.divisiIds || [])
      .map(id => divisi.find(x => x.id === id))
      .filter(Boolean)
      .map(d => d.name);
    return {
      username:     u,
      fullName:     usr.fullName || u,
      role:         usr.role     || "anggota",
      roleName:     r.name,
      roleColor:    r.color,
      religion:     usr.religion || "",
      profilePhoto: usr.profilePhoto || "",
      jabatan:      usr.jabatan  || "",
      tugasLuar:    !!usr.tugasLuar,
      divisiIds:    usr.divisiIds || [],
      divisiNames:  divNames.join(", "),
      createdAt:    usr.createdAt || ""
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

  const divisi = load(F.divisi, []);
  let changed = false;
  divisi.forEach(d => {
    const before = d.memberUsernames.length;
    d.memberUsernames = d.memberUsernames.filter(m => m !== req.params.username);
    if (d.managerUsername === req.params.username) { d.managerUsername = ""; changed = true; }
    if (d.memberUsernames.length !== before) changed = true;
  });
  if (changed) save(F.divisi, divisi);
  syncUserDivisiIds();
  res.send({ status: "OK" });
});

app.put("/anggota/:username/role", (req, res) => {
  const users = load(F.users, {});
  const u = users[req.params.username];
  if (!u) return res.send({ status: "NOT_FOUND" });
  if (!ROLES[req.body.role]) return res.send({ status: "INVALID_ROLE" });
  u.role = req.body.role;
  save(F.users, users);
  res.send({ status: "OK" });
});

app.get("/roles", (req, res) => {
  res.send(Object.entries(ROLES).map(([id, r]) => ({
    id, name: r.name, level: r.level, color: r.color
  })));
});
// ========================
// DIVISI (CRUD)
// ========================
app.get("/divisi", (req, res) => {
  const divisi = load(F.divisi, []);
  const users  = load(F.users, {});
  const out = divisi.map(d => {
    const manager = d.managerUsername && users[d.managerUsername] ? {
      username: d.managerUsername,
      fullName: users[d.managerUsername].fullName || d.managerUsername
    } : null;
    const members = (d.memberUsernames || []).map(u => users[u] ? {
      username: u,
      fullName: users[u].fullName || u,
      role:     users[u].role     || "anggota",
      roleName: getRoleInfo(users[u].role).name,
      profilePhoto: users[u].profilePhoto || ""
    } : null).filter(Boolean);
    return {
      id: d.id, name: d.name,
      managerUsername: d.managerUsername || "",
      manager, members,
      memberUsernames: d.memberUsernames || [],
      memberCount: members.length,
      createdAt: d.createdAt || ""
    };
  });
  res.send(out);
});

app.get("/divisi/:id", (req, res) => {
  const divisi = load(F.divisi, []);
  const d = divisi.find(x => x.id === req.params.id);
  if (!d) return res.status(404).send({ status: "NOT_FOUND" });
  res.send(d);
});

app.post("/divisi", (req, res) => {
  const users     = load(F.users, {});
  const requester = req.body.by || "";
  const reqUser   = users[requester];
  if (!reqUser || (reqUser.role !== "owner" && reqUser.role !== "admin"))
    return res.status(403).send({ status: "FORBIDDEN" });

  const { name, managerUsername, memberUsernames } = req.body;
  if (!name || !name.trim()) return res.send({ status: "ERROR", msg: "Nama divisi wajib" });

  const divisi = load(F.divisi, []);
  if (divisi.some(d => d.name.toLowerCase() === name.trim().toLowerCase()))
    return res.send({ status: "EXIST", msg: "Nama divisi sudah ada" });

  const valid = u => !!users[u];
  const newDiv = normalizeDivisi({
    id: "div_" + Date.now(),
    name: name.trim(),
    managerUsername: (managerUsername && valid(managerUsername)) ? managerUsername : "",
    memberUsernames: Array.isArray(memberUsernames) ? memberUsernames.filter(valid) : [],
    createdAt: new Date().toISOString()
  });
  divisi.push(newDiv);
  save(F.divisi, divisi);
  syncUserDivisiIds();
  res.send({ status: "OK", id: newDiv.id });
});

app.put("/divisi/:id", (req, res) => {
  const users     = load(F.users, {});
  const requester = req.body.by || "";
  const reqUser   = users[requester];
  if (!reqUser || (reqUser.role !== "owner" && reqUser.role !== "admin"))
    return res.status(403).send({ status: "FORBIDDEN" });

  const divisi = load(F.divisi, []);
  const d = divisi.find(x => x.id === req.params.id);
  if (!d) return res.status(404).send({ status: "NOT_FOUND" });

  const { name, managerUsername, memberUsernames } = req.body;
  if (name !== undefined && name.trim()) {
    if (divisi.some(x => x.id !== d.id && x.name.toLowerCase() === name.trim().toLowerCase()))
      return res.send({ status: "EXIST", msg: "Nama divisi sudah dipakai" });
    d.name = name.trim();
  }
  const valid = u => !!users[u];
  if (managerUsername !== undefined) d.managerUsername = (managerUsername && valid(managerUsername)) ? managerUsername : "";
  if (Array.isArray(memberUsernames)) d.memberUsernames = memberUsernames.filter(valid);
  normalizeDivisi(d);
  save(F.divisi, divisi);
  syncUserDivisiIds();
  res.send({ status: "OK" });
});

app.delete("/divisi/:id", (req, res) => {
  const users     = load(F.users, {});
  const requester = req.query.by || "";
  const reqUser   = users[requester];
  if (!reqUser || (reqUser.role !== "owner" && reqUser.role !== "admin"))
    return res.status(403).send({ status: "FORBIDDEN" });

  const divisi = load(F.divisi, []);
  const idx = divisi.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  divisi.splice(idx, 1);
  save(F.divisi, divisi);
  syncUserDivisiIds();
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
  areas.push({
    id: Date.now().toString(),
    name,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    radius: parseInt(radius) || 100,
    active: true
  });
  save(F.areas, areas);
  res.send({ status: "OK" });
});

app.put("/areas/:id", (req, res) => {
  const areas = load(F.areas, []);
  const area  = areas.find(a => a.id === req.params.id);
  if (!area) return res.send({ status: "NOT_FOUND" });
  Object.assign(area, {
    name:   req.body.name || area.name,
    lat:    parseFloat(req.body.lat)    || area.lat,
    lng:    parseFloat(req.body.lng)    || area.lng,
    radius: parseInt(req.body.radius)   || area.radius,
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
// HARI LIBUR & CUTI
// ========================
app.get("/libur", (req, res) => res.send(load(F.libur, [])));

app.post("/libur", (req, res) => {
  const { date, name, type } = req.body;
  if (!date || !name) return res.send({ status: "ERROR" });
  const data = load(F.libur, []);
  data.push({ id: Date.now().toString(), date, name, type: type || "nasional" });
  save(F.libur, data);
  res.send({ status: "OK" });
});

app.delete("/libur/:id", (req, res) => {
  const data = load(F.libur, []);
  const idx  = data.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  data.splice(idx, 1);
  save(F.libur, data);
  res.send({ status: "OK" });
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
      const work = (new Date(d.jamKeluar) - new Date(d.jamMasuk)) / 3600000;
      let bt = 0;
      d.breaks.forEach(b => { if (b.end) bt += (new Date(b.end) - new Date(b.start)) / 3600000; });
      const net = work - bt;
      totalJam += net;
      overtime += Math.max(0, net - 8);
    });
    return {
      user: username,
      fullName: users[username].fullName || username,
      totalDays: recs.length,
      totalJam: totalJam.toFixed(1),
      overtime: overtime.toFixed(1)
    };
  });
  res.send(result);
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
