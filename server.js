const express = require("express");
const fs      = require("fs");
const path    = require("path");
const bcrypt  = require("bcrypt");
const app     = express();

const BCRYPT_ROUNDS = 10;

const PORT     = process.env.PORT || 3000;
const IS_CLOUD = process.env.RAILWAY_ENVIRONMENT !== undefined;
const DATA_DIR = IS_CLOUD ? "/tmp" : ".";

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const F = {
  data:           path.join(DATA_DIR, "data.json"),
  users:          path.join(DATA_DIR, "users.json"),
  areas:          path.join(DATA_DIR, "areas.json"),
  libur:          path.join(DATA_DIR, "libur.json"),
  aktivitas:      path.join(DATA_DIR, "aktivitas.json"),
  groups:         path.join(DATA_DIR, "groups.json"),
  divisi:         path.join(DATA_DIR, "divisi.json"),
  tracking:       path.join(DATA_DIR, "tracking.json"),
  kebijakanCuti:  path.join(DATA_DIR, "kebijakan_cuti.json"),
  kuotaCuti:      path.join(DATA_DIR, "kuota_cuti.json"),
  pengajuanCuti:  path.join(DATA_DIR, "pengajuan_cuti.json"),
};

function load(file, def) {
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file)); } catch { return def; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// ========================
// AUTH HELPER
// ========================

/** Ambil level user dari users.json + groups.json */
function getRequesterLevel(username) {
  if (!username) return 99;
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const u = users[username];
  if (!u) return 99;
  const g = groups.find(g => g.id === (u.group || "anggota"));
  return g ? g.level : 99;
}

/** Middleware: hanya izinkan requester dengan level <= maxLevel.
 *  Requester dibaca dari header X-User atau body._requester */
function requireLevel(maxLevel) {
  return (req, res, next) => {
    const requester = req.headers["x-user"] || (req.body && req.body._requester) || req.query._requester || "";
    const level = getRequesterLevel(requester);
    if (level > maxLevel) {
      return res.status(403).send({ status: "FORBIDDEN", msg: "Akses ditolak" });
    }
    req._requester = requester;
    req._requesterLevel = level;
    next();
  };
}

/** Middleware: boleh akses jika requester == target user ATAU level <= maxLevel */
function requireSelfOrLevel(paramField, maxLevel) {
  return (req, res, next) => {
    const requester = req.headers["x-user"] || (req.body && req.body._requester) || req.query._requester || "";
    const level  = getRequesterLevel(requester);
    const target = req.params[paramField] || "";
    if (level > maxLevel && requester !== target) {
      return res.status(403).send({ status: "FORBIDDEN", msg: "Akses ditolak" });
    }
    req._requester = requester;
    req._requesterLevel = level;
    next();
  };
}


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
        menus: [
          "home","rekap","admin","setting",
          "anggota","anggota.daftar","anggota.divisi",
          "aksesibilitas",
          "area","area.daftar","area.tambah",
          "libur","libur.hari-libur","libur.kebijakan-cuti","libur.kuota-cuti",
          "aktivitas","timesheet","tracking",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "admin", name: "Admin", level: 2, color: "#2980b9",
        menus: [
          "home","rekap","admin","setting",
          "anggota","anggota.daftar","anggota.divisi",
          "aksesibilitas",
          "area","area.daftar","area.tambah",
          "libur","libur.hari-libur","libur.kebijakan-cuti","libur.kuota-cuti",
          "aktivitas","timesheet","tracking",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "manager", name: "Manager", level: 3, color: "#27ae60",
        menus: [
          "home","rekap","admin","aktivitas","timesheet","tracking",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "koordinator", name: "Koordinator", level: 4, color: "#e67e22",
        menus: [
          "home","rekap","aktivitas",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      },
      {
        id: "anggota", name: "Anggota", level: 5, color: "#7f8c8d",
        menus: [
          "home","rekap",
          "cuti","cuti.daftar","cuti.saldo"
        ]
      }
    ];
    save(F.groups, defaults);
  }
}
initGroups();

// Inisialisasi kebijakan cuti default jika belum ada
function initKebijakanCutiDefault() {
  const data = load(F.kebijakanCuti, []);
  const hasDefault = data.some(d => d._default === true);
  if (!hasDefault) {
    const defaults = [
      {
        id:         "default-tahunan",
        nama:       "Cuti Tahunan",
        jenis:      "kuota",
        kuotaKey:   "tahunan",           // key yang diacu di kuota_cuti.json
        periode:    "tahunan",
        berlaku:    "semua",
        keterangan: "Cuti tahunan 12 hari. Otomatis terhubung ke Kuota Cuti Tahunan.",
        _default:   true,
        _locked:    true,                // tidak bisa dihapus
        createdAt:  new Date().toISOString()
      },
      {
        id:         "default-overtime",
        nama:       "Cuti Overtime",
        jenis:      "kuota",
        kuotaKey:   "overtime",          // key yang diacu di kuota_cuti.json
        periode:    "akumulasi",
        berlaku:    "semua",
        keterangan: "Cuti dari akumulasi jam overtime. Otomatis terhubung ke Kuota Cuti Overtime.",
        _default:   true,
        _locked:    true,
        createdAt:  new Date().toISOString()
      }
    ];
    // Gabungkan: default di depan, kebijakan custom di belakang
    save(F.kebijakanCuti, [...defaults, ...data.filter(d => !d._default)]);
  }
}
initKebijakanCutiDefault();

// ========================
// AUTH
// ========================
app.post("/signup", async (req, res) => {
  const { username, password, faceDescriptor, namaLengkap, agama } = req.body;
  if (!username || !password) return res.send({ status: "ERROR" });
  const users = load(F.users, {});
  if (users[username]) return res.send({ status: "EXIST" });
  const isFirst = Object.keys(users).length === 0;
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  users[username] = {
    password: hashedPassword,
    faceDescriptor: faceDescriptor || [],
    group:       isFirst ? "owner"   : "anggota",
    peran:       isFirst ? "Owner"   : "Anggota",
    namaLengkap: namaLengkap || "",
    agama:       agama || "",
    jabatan:     isFirst ? "Owner" : "Anggota",
    divisi:      "",
    statusKerja: "",
    nominalGaji: "",
    photo:       "",
    createdAt:   new Date().toISOString()
  };
  save(F.users, users);
  res.send({ status: "OK" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const users  = load(F.users, {});
  const user   = users[username];
  if (!user) return res.send({ status: "FAIL" });
  // Support password lama (plaintext) yang belum di-migrate — hash otomatis saat login
  let valid = false;
  if (user.password.startsWith("$2")) {
    valid = await bcrypt.compare(password, user.password);
  } else {
    // Password lama plaintext: bandingkan langsung, lalu upgrade ke hash
    valid = user.password === password;
    if (valid) {
      user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
      users[username] = user;
      save(F.users, users);
    }
  }
  if (!valid) return res.send({ status: "FAIL" });
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
app.post("/absen", requireLevel(99), (req, res) => {
  const data = load(F.data, []);
  const areas = load(F.areas, []);
  // Identitas user diambil dari header X-User (sudah diverifikasi middleware), bukan dari body
  const user = req._requester;
  const { type, time, lat, lng, accuracy, photo } = req.body;
  if (!user) return res.status(401).send({ status: "UNAUTHORIZED" });
  const today = new Date().toISOString().split("T")[0];

  // Cek statusKerja user — Tugas Luar boleh clock in dari mana saja
  const users    = load(F.users, {});
  const userData = users[user] || {};
  const isTugasLuar = userData.statusKerja === "Tugas Luar";

  // Wajib kirim koordinat valid (bukan 0,0) — jika kosong berarti izin lokasi ditolak
  if ((lat === 0 && lng === 0) || lat == null || lng == null) {
    if (!isTugasLuar) {
      return res.status(400).send({ status: "LOCATION_REQUIRED", msg: "Izin lokasi diperlukan untuk absensi" });
    }
  }

  // Validasi area — hanya untuk clock IN, dan hanya jika ada area aktif
  // Clock OUT/BREAK tidak perlu validasi area (bisa di luar kantor saat pulang)
  if (type === "IN" && areas.length > 0 && !isTugasLuar) {
    if (lat === 0 && lng === 0) {
      return res.status(400).send({ status: "LOCATION_REQUIRED", msg: "Aktifkan lokasi untuk Clock In" });
    }
    const activeAreas = areas.filter(a => a.active !== false);
    if (activeAreas.length > 0) {
      // Perlebar radius validasi sebesar nilai accuracy GPS user (agar tidak false-reject
      // saat sinyal lemah). Maksimal toleransi accuracy yang ditambahkan: 100 m.
      const accTolerance = Math.min(accuracy != null ? accuracy : 0, 100);
      const inAny = activeAreas.some(a => dist(lat, lng, a.lat, a.lng) <= (a.radius + accTolerance));
      if (!inAny) {
        const nearest = activeAreas.reduce((best, a) => {
          const d = dist(lat, lng, a.lat, a.lng);
          return d < best.d ? { d, name: a.name } : best;
        }, { d: Infinity, name: "" });
        return res.status(400).send({
          status:   "OUT_OF_AREA",
          distance: Math.round(nearest.d),
          area:     nearest.name,
          accuracy: accuracy != null ? Math.round(accuracy) : null
        });
      }
    }
  }

  let record = data.find(d => d.user === user && d.date === today && !d.jamKeluar);

  if (type === "IN") {
    if (record) return res.send({ status: "ALREADY_IN" });
    data.push({ user, date: today, jamMasuk: time, jamKeluar: null, lokasi: { lat, lng, accuracy }, foto: photo, breaks: [] });
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

app.get("/status/:user", requireLevel(99), (req, res) => {
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
app.get("/report/:user", requireSelfOrLevel("user", 2), (req, res) => {
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

app.get("/history/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const data = load(F.data, []);
  res.send(data.filter(d => d.user === req.params.user).slice(-30).reverse());
});

// ========================
// ADMIN
// ========================
app.get("/admin/today", requireLevel(3), (req, res) => {
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
app.get("/profile/:username", requireSelfOrLevel("username", 2), (req, res) => {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const user   = users[req.params.username];
  if (!user) return res.send({ status: "NOT_FOUND" });
  const group  = groups.find(g => g.id === (user.group || "anggota")) || groups[groups.length-1];
  const isAdminOrOwner = req._requesterLevel <= 2;
  const response = {
    username:    req.params.username,
    namaLengkap: user.namaLengkap  || "",
    agama:       user.agama        || "",
    jabatan:     user.jabatan      || "Anggota",
    peran:       user.peran || (user.group === "owner" ? "Owner" : user.group === "admin" ? "Admin" : ""),
    group:       user.group        || "anggota",
    groupName:   group?.name       || "Anggota",
    groupColor:  group?.color      || "#7f8c8d",
    divisi:      Array.isArray(user.divisi) ? user.divisi : (user.divisi ? [user.divisi] : []),
    statusKerja: user.statusKerja  || "",
    photo:       user.photo        || "",
    // nominalGaji hanya dikirim ke Owner/Admin
    ...(isAdminOrOwner ? { nominalGaji: user.nominalGaji || "" } : {}),
    // faceDescriptor TIDAK dikirim di sini — gunakan /face-descriptor/:username
  };
  res.send(response);
});

app.put("/profile/:username", requireSelfOrLevel("username", 2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  // Field yang boleh diedit oleh siapa saja (termasuk user sendiri)
  const allowedSelf  = ["namaLengkap", "agama"];
  // Field yang hanya boleh diedit oleh Owner/Admin (level <= 2)
  const allowedAdmin = ["jabatan", "divisi", "statusKerja", "nominalGaji"];
  allowedSelf.forEach(k => { if (req.body[k] !== undefined) users[req.params.username][k] = req.body[k]; });
  if (req._requesterLevel <= 2) {
    allowedAdmin.forEach(k => { if (req.body[k] !== undefined) users[req.params.username][k] = req.body[k]; });
  }
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/photo", requireSelfOrLevel("username", 2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].photo = req.body.photo || "";
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/face", requireSelfOrLevel("username", 2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].faceDescriptor = req.body.faceDescriptor || [];
  save(F.users, users);
  res.send({ status: "OK" });
});

app.put("/profile/:username/password", requireSelfOrLevel("username", 2), async (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.send({ status: "INVALID" });
  users[req.params.username].password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// ANGGOTA
// ========================
app.get("/anggota", requireLevel(99), (req, res) => {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const absen  = load(F.data, []);
  const list   = Object.keys(users).map(u => {
    const usr = users[u];
    const g   = groups.find(g => g.id === (usr.group || "anggota"));
    // Cari waktu terakhir aktif dari data absensi
    const recs = absen
      .filter(d => d.user === u)
      .sort((a, b) => {
        const ta = new Date(a.jamKeluar || a.jamMasuk || (a.date + "T00:00:00")).getTime();
        const tb = new Date(b.jamKeluar || b.jamMasuk || (b.date + "T00:00:00")).getTime();
        return tb - ta;
      });
    const lastSeen = recs.length
      ? (recs[0].jamKeluar || recs[0].jamMasuk || (recs[0].date + "T00:00:00"))
      : (usr.createdAt || null);
    return {
      username:    u,
      namaLengkap: usr.namaLengkap  || "",
      jabatan:     usr.jabatan      || "Anggota",
      photo:       usr.photo        || "",
      group:       usr.group        || "anggota",
      groupName:   g?.name          || "Anggota",
      groupColor:  g?.color         || "#7f8c8d",
      peran:       usr.peran        || (usr.group === "owner" ? "Owner" : usr.group === "admin" ? "Admin" : "Anggota"),
      divisi:      Array.isArray(usr.divisi) ? usr.divisi : (usr.divisi ? [usr.divisi] : []),
      statusKerja: usr.statusKerja  || "",
      createdAt:   usr.createdAt    || "",
      lastSeen,
    };
  });
  res.send(list);
});

app.put("/anggota/:username/group", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const newGroup = req.body.group;
  users[req.params.username].group = newGroup;
  // Peran hanya untuk Owner dan Admin — jika group bukan owner/admin, peran tetap "Anggota"
  if (newGroup === "owner" || newGroup === "admin") {
    users[req.params.username].peran = newGroup === "owner" ? "Owner" : "Admin";
  } else {
    users[req.params.username].peran = "Anggota";
  }
  // Jabatan tidak diubah di sini — jabatan diatur via posisi divisi
  save(F.users, users);
  res.send({ status: "OK" });
});

// Update statusKerja (Tugas Luar / kosong)
app.put("/anggota/:username/status", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  users[req.params.username].statusKerja = req.body.statusKerja || "";
  save(F.users, users);
  res.send({ status: "OK" });
});

app.delete("/anggota/:username", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  delete users[req.params.username];
  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// GROUP / ROLE
// ========================
app.get("/groups", requireLevel(99), (req, res) => res.send(load(F.groups, [])));

app.put("/groups/:id/menus", requireLevel(2), (req, res) => {
  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === req.params.id);
  if (!group) return res.send({ status: "NOT_FOUND" });
  if (group.id === "owner") return res.send({ status: "PROTECTED" }); // owner tidak bisa diubah
  group.menus = req.body.menus;
  save(F.groups, groups);
  res.send({ status: "OK" });
});

// ========================
// DIVISI
// ========================
app.get("/divisi", requireLevel(99), (req, res) => res.send(load(F.divisi, [])));

app.post("/divisi", requireLevel(2), (req, res) => {
  const { nama, deskripsi, owner, manager, koordinator } = req.body;
  if (!nama || !nama.trim()) return res.send({ status: "ERROR", msg: "Nama divisi wajib diisi" });
  const list = load(F.divisi, []);
  if (list.find(d => d.nama.toLowerCase() === nama.trim().toLowerCase()))
    return res.send({ status: "EXIST", msg: "Divisi sudah ada" });
  list.push({
    id: Date.now().toString(),
    nama: nama.trim(),
    deskripsi: (deskripsi||"").trim(),
    owner: (owner||"").trim(),
    manager: (manager||"").trim(),
    koordinator: (koordinator||"").trim(),
    createdAt: new Date().toISOString()
  });
  save(F.divisi, list);
  res.send({ status: "OK" });
});

app.put("/divisi/:id", requireLevel(2), (req, res) => {
  const list = load(F.divisi, []);
  const item = list.find(d => d.id === req.params.id);
  if (!item) return res.send({ status: "NOT_FOUND" });
  const oldNama = item.nama;
  if (req.body.nama)        item.nama        = req.body.nama.trim();
  if (req.body.deskripsi !== undefined) item.deskripsi = req.body.deskripsi.trim();
  if (req.body.owner       !== undefined) item.owner       = req.body.owner.trim();
  if (req.body.manager     !== undefined) item.manager     = req.body.manager.trim();
  if (req.body.koordinator !== undefined) item.koordinator = req.body.koordinator.trim();
  save(F.divisi, list);

  // Update jabatan semua anggota di divisi ini
  const users = load(F.users, {});
  Object.keys(users).forEach(u => {
    const usr = users[u];
    // Normalisasi ke array
    if (!Array.isArray(usr.divisi)) usr.divisi = usr.divisi ? [usr.divisi] : [];
    // Jika nama divisi berubah, update field divisi user
    const idx2 = usr.divisi.indexOf(oldNama);
    if (idx2 !== -1) usr.divisi[idx2] = item.nama;
    // Update jabatan berdasarkan posisi di divisi (prioritas tertinggi)
    if (usr.divisi.includes(item.nama)) {
      const priority = { "Owner": 1, "Manager": 2, "Koordinator": 3, "Anggota": 4 };
      let bestJabatan = "Anggota";
      usr.divisi.forEach(dNama => {
        const dItem = list.find(d => d.nama === dNama);
        if (!dItem) return;
        let jab = "Anggota";
        if (dItem.owner === u)            jab = "Owner";
        else if (dItem.manager === u)     jab = "Manager";
        else if (dItem.koordinator === u) jab = "Koordinator";
        if ((priority[jab] || 4) < (priority[bestJabatan] || 4)) bestJabatan = jab;
      });
      usr.jabatan = bestJabatan;
    }
  });
  save(F.users, users);
  res.send({ status: "OK" });
});

app.delete("/divisi/:id", requireLevel(2), (req, res) => {
  const list = load(F.divisi, []);
  const idx  = list.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  // Hapus divisi ini dari array divisi semua user
  const divisiNama = list[idx].nama;
  const users = load(F.users, {});
  Object.values(users).forEach(u => {
    if (!Array.isArray(u.divisi)) u.divisi = u.divisi ? [u.divisi] : [];
    u.divisi = u.divisi.filter(d => d !== divisiNama);
  });
  save(F.users, users);
  list.splice(idx, 1);
  save(F.divisi, list);
  res.send({ status: "OK" });
});

// Assign anggota ke divisi — jabatan otomatis dari posisi divisi, support multi-divisi
app.put("/anggota/:username/divisi", requireLevel(2), (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status: "NOT_FOUND" });
  const u = req.params.username;

  // Normalisasi field divisi ke array
  if (!Array.isArray(users[u].divisi)) {
    users[u].divisi = users[u].divisi ? [users[u].divisi] : [];
  }

  const divisiNamaBaru = req.body.divisi || "";   // nama divisi yg ditambahkan
  const action         = req.body.action || "add"; // "add" | "remove" | "set"

  if (action === "remove") {
    // Keluarkan dari divisi tertentu
    users[u].divisi = users[u].divisi.filter(d => d !== divisiNamaBaru);
  } else if (action === "set") {
    // Ganti seluruh array (dipakai dari detail-anggota)
    users[u].divisi = Array.isArray(req.body.divisiList) ? req.body.divisiList : (divisiNamaBaru ? [divisiNamaBaru] : []);
  } else {
    // "add" — tambahkan jika belum ada
    if (divisiNamaBaru && !users[u].divisi.includes(divisiNamaBaru)) {
      users[u].divisi.push(divisiNamaBaru);
    }
  }

  // Update jabatan: prioritas dari divisi pertama; jika tanpa divisi → default group
  const divisiList = load(F.divisi, []);
  if (!users[u].divisi.length) {
    const grp = users[u].group;
    users[u].jabatan = grp === "owner" ? "Owner" : "Anggota";
  } else {
    // Cek posisi di masing-masing divisi, ambil jabatan tertinggi
    const priority = { "Owner": 1, "Manager": 2, "Koordinator": 3, "Anggota": 4 };
    let bestJabatan = "Anggota";
    users[u].divisi.forEach(dNama => {
      const divisi = divisiList.find(d => d.nama === dNama);
      if (!divisi) return;
      let jab = "Anggota";
      if (divisi.owner === u)            jab = "Owner";
      else if (divisi.manager === u)     jab = "Manager";
      else if (divisi.koordinator === u) jab = "Koordinator";
      if ((priority[jab] || 4) < (priority[bestJabatan] || 4)) bestJabatan = jab;
    });
    users[u].jabatan = bestJabatan;
  }

  save(F.users, users);
  res.send({ status: "OK" });
});

// ========================
// AREA (multi-area)
// ========================
// GET /areas — data lengkap (nama, lat, lng, radius, id) hanya untuk Owner/Admin
app.get("/areas", requireLevel(2), (req, res) => res.send(load(F.areas, [])));

// GET /areas/info — hanya jumlah area aktif, tanpa koordinat. Aman untuk semua user login.
app.get("/areas/info", requireLevel(99), (req, res) => {
  const areas = load(F.areas, []);
  const active = areas.filter(a => a.active !== false);
  res.send({ total: areas.length, activeCount: active.length });
});

app.post("/areas", requireLevel(2), (req, res) => {
  const { name, lat, lng, radius } = req.body;
  if (!name || !lat || !lng) return res.send({ status: "ERROR" });
  const areas = load(F.areas, []);
  areas.push({ id: Date.now().toString(), name, lat: parseFloat(lat), lng: parseFloat(lng), radius: parseInt(radius)||100, active: true });
  save(F.areas, areas);
  res.send({ status: "OK" });
});

app.put("/areas/:id", requireLevel(2), (req, res) => {
  const areas = load(F.areas, []);
  const area  = areas.find(a => a.id === req.params.id);
  if (!area) return res.send({ status: "NOT_FOUND" });
  Object.assign(area, { name: req.body.name||area.name, lat: parseFloat(req.body.lat)||area.lat, lng: parseFloat(req.body.lng)||area.lng, radius: parseInt(req.body.radius)||area.radius, active: req.body.active !== undefined ? req.body.active : area.active });
  save(F.areas, areas);
  res.send({ status: "OK" });
});

app.delete("/areas/:id", requireLevel(2), (req, res) => {
  const areas = load(F.areas, []);
  const idx   = areas.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  areas.splice(idx, 1);
  save(F.areas, areas);
  res.send({ status: "OK" });
});

// ========================
// HARI LIBUR & KEBIJAKAN CUTI
// ========================

// Daftar agama unik dari seluruh anggota — hanya user yang sudah login
app.get("/libur/agama-list", requireLevel(99), (req, res) => {
  const users = load(F.users, {});
  const agamaSet = new Set();
  Object.values(users).forEach(u => { if (u.agama) agamaSet.add(u.agama); });
  res.send([...agamaSet]);
});

app.get("/libur", requireLevel(99), (req, res) => {
  const data = load(F.libur, []);
  // Admin & owner boleh lihat field anggota[]; user biasa tidak perlu tahu username rekan lain
  if (req._requesterLevel <= 2) return res.send(data);
  const safeData = data.map(({ anggota, ...rest }) => rest);
  res.send(safeData);
});

app.post("/libur", requireLevel(2), (req, res) => {
  const { name, dateStart, dateEnd, type, agama, date } = req.body;
  if (!name || (!dateStart && !date)) return res.send({ status: "ERROR" });

  const users = load(F.users, {});
  const start = dateStart || date;
  const end   = dateEnd   || start;

  // Auto-assign anggota berdasarkan agama
  let anggota = [];
  if (type === "agama" && agama && agama.length > 0) {
    anggota = Object.keys(users).filter(u => agama.includes(users[u].agama || ""));
  } else if (type === "nasional") {
    anggota = Object.keys(users);
  }

  const data = load(F.libur, []);
  data.push({
    id:        Date.now().toString(),
    name,
    date:      start,        // backward compat
    dateStart: start,
    dateEnd:   end,
    type:      type || "nasional",
    agama:     agama || [],
    anggota,
    createdAt: new Date().toISOString()
  });
  save(F.libur, data);
  res.send({ status: "OK" });
});

// ── Import bulk libur dari CSV/XLSX (data sudah diparse di frontend) ──
app.post("/libur/import", requireLevel(2), (req, res) => {
  const { rows, type, agama } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return res.send({ status: "ERROR", msg: "Tidak ada data" });

  const users   = load(F.users, {});
  const data    = load(F.libur, []);
  let imported  = 0;
  const errors  = [];

  rows.forEach((row, i) => {
    const name      = (row.name || row.nama || row.Nama || row.Name || "").toString().trim();
    const dateStart = (row.dateStart || row.date_start || row.tanggal_mulai || row.tanggal || row.Tanggal || row.Date || "").toString().trim();
    const dateEnd   = (row.dateEnd   || row.date_end   || row.tanggal_akhir || "").toString().trim();

    if (!name || !dateStart) { errors.push(`Baris ${i+2}: nama/tanggal kosong`); return; }

    // Validasi format tanggal YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) { errors.push(`Baris ${i+2}: format tanggal salah (${dateStart}), gunakan YYYY-MM-DD`); return; }

    const end = (dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) ? dateEnd : dateStart;

    const agamaArr = agama ? [agama] : [];
    let anggota = [];
    if (type === "agama" && agamaArr.length > 0) {
      anggota = Object.keys(users).filter(u => agamaArr.includes(users[u].agama || ""));
    } else if (type === "nasional") {
      anggota = Object.keys(users);
    }

    data.push({
      id:        Date.now().toString() + "_" + i,
      name,
      date:      dateStart,
      dateStart,
      dateEnd:   end,
      type:      type || "nasional",
      agama:     agamaArr,
      anggota,
      createdAt: new Date().toISOString()
    });
    imported++;
  });

  save(F.libur, data);
  res.send({ status: "OK", imported, errors });
});

app.delete("/libur/:id", requireLevel(2), (req, res) => {
  const data = load(F.libur, []);
  const idx  = data.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  data.splice(idx, 1); save(F.libur, data); res.send({ status: "OK" });
});

// Kebijakan Cuti
app.get("/kebijakan-cuti", requireLevel(99), (req, res) => res.send(load(F.kebijakanCuti, [])));

app.post("/kebijakan-cuti", requireLevel(2), (req, res) => {
  const { nama, jenis, hari, periode, berlaku, keterangan, satuanDurasi } = req.body;
  if (!nama || !jenis) return res.send({ status: "ERROR" });
  const data = load(F.kebijakanCuti, []);
  const newKebijakan = {
    id:          Date.now().toString(),
    nama,
    jenis:       jenis,
    satuanDurasi: satuanDurasi || "hari", // "hari" | "jam"
    hari:        hari ? parseInt(hari) : null,
    periode:     periode || "tahunan",
    berlaku:     berlaku || "semua",
    keterangan:  keterangan || "",
    createdAt:   new Date().toISOString()
  };
  data.push(newKebijakan);
  save(F.kebijakanCuti, data);
  res.send({ status: "OK", id: newKebijakan.id });
});

app.delete("/kebijakan-cuti/:id", requireLevel(2), (req, res) => {
  const data = load(F.kebijakanCuti, []);
  const idx  = data.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  if (data[idx]._locked) return res.status(403).send({ status: "LOCKED", msg: "Kebijakan default tidak dapat dihapus." });
  data.splice(idx, 1); save(F.kebijakanCuti, data); res.send({ status: "OK" });
});

// ========================
// AKTIVITAS
// ========================
app.get("/aktivitas", requireLevel(3), (req, res) => {
  const data = load(F.aktivitas, []);
  res.send(data.slice(-100).reverse());
});

// ========================
// TIMESHEET
// ========================

// Konversi hari cuti → jam sesuai hari dalam seminggu
// Senin–Jumat = 8 jam efektif (07.00-15.00 default), Sabtu = 6 jam
// Sesuai rule: Senin-Jumat = 7 jam, Sabtu = 5 jam (net setelah istirahat 1 jam)
function cutiHariKeJam(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 0) return 0; // Minggu tidak masuk jam kerja
  if (dow === 6) return 5; // Sabtu
  return 7;               // Senin–Jumat
}

// Hitung kontribusi jam dari satu pengajuan cuti (status disetujui) untuk tanggal tertentu
function jamCutiUntukTanggal(p, dateStr) {
  if (p.status !== "disetujui") return 0;
  const tMulai = p.tanggalMulai, tAkhir = p.tanggalAkhir || p.tanggalMulai;
  if (!tMulai) return 0;
  // Cek apakah dateStr masuk rentang
  if (dateStr < tMulai || dateStr > tAkhir) return 0;

  if (p.satuanDurasi === "jam") {
    // Cuti satuan jam: hanya pada tanggalMulai
    return dateStr === tMulai ? parseFloat(p.durasi) : 0;
  } else {
    // Cuti satuan hari: konversi ke jam sesuai hari
    return cutiHariKeJam(dateStr);
  }
}

// GET timesheet mingguan — satu baris per user per tanggal dalam rentang minggu
// Query: ?weekStart=YYYY-MM-DD  (Senin)
// Response: [{ username, nama, jabatan, divisi, days: [{date, dow, jamKerja, jamCuti, keteranganCuti}], totalJam, totalCuti }]
app.get("/timesheet/weekly", requireLevel(99), (req, res) => {
  const { weekStart, requester } = req.query;
  if (!weekStart) return res.send({ error: "weekStart required" });

  const monDate = new Date(weekStart + "T00:00:00");
  const dates = Array.from({length: 7}, (_, i) => {
    const d = new Date(monDate); d.setDate(monDate.getDate() + i);
    return d.toISOString().split("T")[0];
  }); // [Sen, Sel, Rab, Kam, Jum, Sab, Min]

  const data      = load(F.data, []);
  const users     = load(F.users, {});
  const pengajuan = load(F.pengajuanCuti, []);
  const divisiList = load(F.divisi, []);

  const requesterGroup = requester ? getUserGroup(requester) : "anggota";
  const requesterLevel = requester ? getUserLevel(requester) : 99;

  // Tentukan siapa yang bisa dilihat oleh requester
  function canViewUser(targetUsername) {
    if (!requester) return false;
    if (requester === targetUsername) return true; // lihat diri sendiri
    if (requesterGroup === "owner" || requesterGroup === "admin") return true;
    if (requesterGroup === "manager") {
      // Hanya anggota/koordinator di divisi yang sama
      const myDivisi = Array.isArray(users[requester]?.divisi)
        ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUsername]?.divisi)
        ? users[targetUsername].divisi : (users[targetUsername]?.divisi ? [users[targetUsername].divisi] : []);
      const tgtGroup = getUserGroup(targetUsername);
      if (tgtGroup === "owner" || tgtGroup === "admin") return false;
      return myDivisi.some(d => tgtDivisi.includes(d));
    }
    if (requesterGroup === "koordinator") {
      // Koordinator: lihat anggota yang ia koordinir di divisinya
      const myDivisi = Array.isArray(users[requester]?.divisi)
        ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const divObjs = divisiList.filter(d => myDivisi.includes(d.nama) && d.koordinator === requester);
      if (!divObjs.length) return false;
      const tgtDivisi = Array.isArray(users[targetUsername]?.divisi)
        ? users[targetUsername].divisi : (users[targetUsername]?.divisi ? [users[targetUsername].divisi] : []);
      return divObjs.some(d => tgtDivisi.includes(d.nama));
    }
    return false; // anggota: hanya diri sendiri (sudah di-handle baris pertama)
  }

  function canEditUser(targetUsername) {
    // Admin & owner bisa edit siapa saja termasuk diri sendiri
    if (requesterGroup === "owner" || requesterGroup === "admin") return true;
    if (requester === targetUsername) return false; // selain admin/owner tidak bisa edit diri sendiri
    if (requesterGroup === "manager") {
      const myDivisi = Array.isArray(users[requester]?.divisi)
        ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUsername]?.divisi)
        ? users[targetUsername].divisi : (users[targetUsername]?.divisi ? [users[targetUsername].divisi] : []);
      const tgtGroup = getUserGroup(targetUsername);
      if (tgtGroup === "owner" || tgtGroup === "admin" || tgtGroup === "manager") return false;
      return myDivisi.some(d => tgtDivisi.includes(d));
    }
    return false;
  }

  const visibleUsers = Object.keys(users).filter(u => canViewUser(u));

  const result = visibleUsers.map(username => {
    const u = users[username];
    const userPengajuan = pengajuan.filter(p => p.username === username && p.status === "disetujui");

    const days = dates.map(dateStr => {
      const rec = data.find(d => d.user === username && d.date === dateStr);
      let jamKerja = 0;
      if (rec && rec.jamMasuk && rec.jamKeluar) {
        const work = (new Date(rec.jamKeluar) - new Date(rec.jamMasuk)) / 3600000;
        let bt = 0;
        (rec.breaks || []).forEach(b => { if (b.end) bt += (new Date(b.end) - new Date(b.start)) / 3600000; });
        jamKerja = Math.max(0, work - bt);
      }

      // Cari semua cuti yang berlaku di tanggal ini
      const cutiAktif = userPengajuan.filter(p => jamCutiUntukTanggal(p, dateStr) > 0);
      const jamCuti   = cutiAktif.reduce((s, p) => s + jamCutiUntukTanggal(p, dateStr), 0);
      const keteranganCuti = cutiAktif.map(p => p.kebijakanNama || "Cuti").join(", ");

      return {
        date: dateStr,
        dow:  new Date(dateStr + "T00:00:00").getDay(), // 0=Min
        jamKerja: parseFloat(jamKerja.toFixed(2)),
        jamCuti:  parseFloat(jamCuti.toFixed(2)),
        keteranganCuti,
        absenId: rec ? rec.date : null, // untuk edit modal
        jamMasuk:  rec?.jamMasuk  || null,
        jamKeluar: rec?.jamKeluar || null,
      };
    });

    const totalJamKerja = days.reduce((s, d) => s + d.jamKerja, 0);
    const totalJamCuti  = days.reduce((s, d) => s + d.jamCuti, 0);
    const totalEfektif  = totalJamKerja + totalJamCuti; // untuk cek 40 jam

    return {
      username,
      nama:    u.namaLengkap || username,
      jabatan: u.jabatan || "-",
      divisi:  Array.isArray(u.divisi) ? u.divisi.join(", ") : (u.divisi || "-"),
      photo:   u.photo || "",
      group:   u.group || "anggota",
      days,
      totalJamKerja: parseFloat(totalJamKerja.toFixed(2)),
      totalJamCuti:  parseFloat(totalJamCuti.toFixed(2)),
      totalEfektif:  parseFloat(totalEfektif.toFixed(2)),
      canEdit:       canEditUser(username),
    };
  });

  res.send({ weekDates: dates, users: result });
});

// ========================
// REKAP BULANAN (Admin/Owner only)
// GET /rekap/monthly?month=YYYY-MM&requester=username
// ========================
app.get("/rekap/monthly", requireLevel(99), (req, res) => {
  const { month } = req.query;
  if (!month) return res.send({ error: "month required" });

  // Identitas requester diambil dari middleware (X-User header), bukan dari query string
  const requester = req._requester;
  const rGroup    = getUserGroup(requester);
  if (rGroup !== "owner" && rGroup !== "admin") {
    return res.status(403).send({ error: "Forbidden" });
  }

  const [year, mon] = month.split("-").map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay  = new Date(year, mon, 0);

  // Semua tanggal dalam bulan ini
  const allDates = [];
  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split("T")[0]);
  }

  // Hitung weekStart (Senin) untuk setiap tanggal
  function getWeekStart(dateStr) {
    const d   = new Date(dateStr + "T00:00:00");
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const m  = new Date(d);
    m.setDate(d.getDate() + diff);
    return m.toISOString().split("T")[0];
  }

  // Kelompokkan tanggal ke minggu (urut)
  const weekMap = new Map();
  allDates.forEach(dt => {
    const ws = getWeekStart(dt);
    if (!weekMap.has(ws)) weekMap.set(ws, []);
    weekMap.get(ws).push(dt);
  });

  const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  const weeks = [];
  let weekIdx = 1;
  weekMap.forEach((dates, ws) => {
    const fmtD = d => { const o = new Date(d+"T00:00:00"); return `${o.getDate()} ${BULAN[o.getMonth()]}`; };
    weeks.push({
      weekIdx,
      weekStart: ws,
      weekLabel: `Minggu ${weekIdx}`,
      weekRange: `${fmtD(dates[0])} - ${fmtD(dates[dates.length-1])}`,
      dates
    });
    weekIdx++;
  });

  const data      = load(F.data, []);
  const users     = load(F.users, {});
  const pengajuan = load(F.pengajuanCuti, []);

  const result = Object.keys(users).map(username => {
    const u = users[username];
    const userPengajuan = pengajuan.filter(p => p.username === username && p.status === "disetujui");

    // Semua hari dalam bulan (flat)
    const days = allDates.map(dateStr => {
      const rec = data.find(d => d.user === username && d.date === dateStr);
      let jamKerja = 0;
      if (rec && rec.jamMasuk && rec.jamKeluar) {
        const work = (new Date(rec.jamKeluar) - new Date(rec.jamMasuk)) / 3600000;
        let bt = 0;
        (rec.breaks || []).forEach(b => { if (b.end) bt += (new Date(b.end) - new Date(b.start)) / 3600000; });
        jamKerja = Math.max(0, work - bt);
      }
      const cutiAktif = userPengajuan.filter(p => jamCutiUntukTanggal(p, dateStr) > 0);
      const jamCuti   = cutiAktif.reduce((s, p) => s + jamCutiUntukTanggal(p, dateStr), 0);
      const keteranganCuti = cutiAktif.map(p => p.kebijakanNama || "Cuti").join(", ");
      const ws = getWeekStart(dateStr);
      const weekIdxForDay = weeks.find(w => w.weekStart === ws)?.weekIdx || 0;
      return {
        date: dateStr,
        dow:  new Date(dateStr + "T00:00:00").getDay(),
        weekIdx: weekIdxForDay,
        jamKerja:  parseFloat(jamKerja.toFixed(2)),
        jamCuti:   parseFloat(jamCuti.toFixed(2)),
        keteranganCuti,
      };
    });

    // Total per minggu
    const weekTotals = weeks.map(w => {
      const wDays = days.filter(d => d.weekIdx === w.weekIdx);
      return {
        weekIdx: w.weekIdx,
        totalEfektif: parseFloat(wDays.reduce((s, d) => s + d.jamKerja + d.jamCuti, 0).toFixed(2))
      };
    });

    const totalBulan = parseFloat(days.reduce((s, d) => s + d.jamKerja + d.jamCuti, 0).toFixed(2));

    return {
      username,
      nama:       u.namaLengkap || username,
      jabatan:    u.jabatan || "-",
      divisi:     Array.isArray(u.divisi) ? u.divisi.join(", ") : (u.divisi || "-"),
      // photo & group tidak disertakan — tidak dibutuhkan untuk rekap jam kerja
      days,
      weekTotals,
      totalBulan,
    };
  });

  res.send({ month, weeks, allDates, users: result });
});

// GET: summary timesheet bulanan (tetap ada untuk kompatibilitas)
app.get("/timesheet", requireLevel(2), (req, res) => {
  const month = req.query.month;
  if (!month) return res.send([]);
  const data  = load(F.data, []);
  const users = load(F.users, {});
  const pengajuan = load(F.pengajuanCuti, []);
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

// POST: admin/manager create absen manual
app.post("/timesheet/absen-manual", requireLevel(2), (req, res) => {
  const { requester, targetUser, date, jamMasuk, jamKeluar } = req.body;
  if (!requester || !targetUser || !date || !jamMasuk || !jamKeluar)
    return res.send({ status: "ERROR", msg: "Data tidak lengkap" });

  const requesterGroup = getUserGroup(requester);
  const targetGroup    = getUserGroup(targetUser);

  // Admin & owner bisa buat absen manual untuk siapa saja termasuk diri sendiri
  let canCreate = false;
  if (requesterGroup === "owner" || requesterGroup === "admin") canCreate = true;
  else if (requesterGroup === "manager") {
    if (targetGroup !== "owner" && targetGroup !== "admin" && targetGroup !== "manager") {
      const users = load(F.users, {});
      const myDivisi  = Array.isArray(users[requester]?.divisi) ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUser]?.divisi) ? users[targetUser].divisi : (users[targetUser]?.divisi ? [users[targetUser].divisi] : []);
      canCreate = myDivisi.some(d => tgtDivisi.includes(d));
    }
  }
  if (!canCreate) return res.send({ status: "FORBIDDEN" });

  const data = load(F.data, []);
  // Cek duplikat (per user per date yang belum closed)
  const existing = data.find(d => d.user === targetUser && d.date === date);
  if (existing) {
    // Update jam jika sudah ada
    existing.jamMasuk  = jamMasuk;
    existing.jamKeluar = jamKeluar;
  } else {
    const { breaks: breaksData, catatan, aktivitas, lokasiNama } = req.body;
    data.push({
      user: targetUser, date, jamMasuk, jamKeluar,
      lokasi: { lat: 0, lng: 0 }, lokasiNama: lokasiNama || "",
      foto: "", breaks: breaksData || [],
      aktivitas: aktivitas || "", catatan: catatan || "",
      createdManually: true, createdBy: requester,
      createdAt: new Date().toISOString()
    });
  }
  save(F.data, data);
  res.send({ status: "OK" });
});

// PUT: edit jam absen (oleh manager/admin/owner)
app.put("/timesheet/absen/:user/:date", requireLevel(2), (req, res) => {
  const { requester, jamMasuk, jamKeluar } = req.body;
  const { user: targetUser, date } = req.params;

  const requesterGroup = getUserGroup(requester);
  const targetGroup    = getUserGroup(targetUser);

  // Admin & owner boleh edit absen siapa saja termasuk diri sendiri
  // Manager & di bawahnya tidak bisa edit diri sendiri
  if (requester === targetUser && requesterGroup !== "owner" && requesterGroup !== "admin") {
    return res.send({ status: "FORBIDDEN", msg: "Tidak bisa edit absen sendiri" });
  }

  let canEdit = false;
  if (requesterGroup === "owner" || requesterGroup === "admin") canEdit = true;
  else if (requesterGroup === "manager") {
    if (targetGroup !== "owner" && targetGroup !== "admin" && targetGroup !== "manager") {
      const users = load(F.users, {});
      const myDivisi  = Array.isArray(users[requester]?.divisi) ? users[requester].divisi : (users[requester]?.divisi ? [users[requester].divisi] : []);
      const tgtDivisi = Array.isArray(users[targetUser]?.divisi) ? users[targetUser].divisi : (users[targetUser]?.divisi ? [users[targetUser].divisi] : []);
      canEdit = myDivisi.some(d => tgtDivisi.includes(d));
    }
  }
  if (!canEdit) return res.send({ status: "FORBIDDEN" });

  const data = load(F.data, []);
  const rec  = data.find(d => d.user === targetUser && d.date === date);
  if (!rec) return res.send({ status: "NOT_FOUND" });
  if (jamMasuk)        rec.jamMasuk  = jamMasuk;
  if (jamKeluar)       rec.jamKeluar = jamKeluar;
  if (req.body.breaks !== undefined) rec.breaks = req.body.breaks;
  if (req.body.catatan !== undefined) rec.catatan = req.body.catatan;
  if (req.body.aktivitas !== undefined) rec.aktivitas = req.body.aktivitas;
  if (req.body.lokasiNama !== undefined) rec.lokasiNama = req.body.lokasiNama;
  save(F.data, data);
  res.send({ status: "OK" });
});

// ========================
// KUOTA CUTI
// ========================

// Jam kerja wajib per minggu (Senin-Minggu)
const JAM_WAJIB_MINGGU = 40;

// Helper: hitung jam kerja bersih dari satu record absensi
function hitungJamKerja(rec) {
  if (!rec.jamMasuk || !rec.jamKeluar) return 0;
  const work = (new Date(rec.jamKeluar) - new Date(rec.jamMasuk)) / 3600000;
  let bt = 0;
  (rec.breaks || []).forEach(b => { if (b.end) bt += (new Date(b.end) - new Date(b.start)) / 3600000; });
  return Math.max(0, work - bt);
}

// Helper: week key "YYYY-Www" (ISO week, Senin = awal minggu)
function weekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day; // Senin
  const mon = new Date(d); mon.setDate(d.getDate() + diff);
  const year = mon.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));
  const weekNum = Math.floor((mon - startOfWeek1) / (7 * 86400000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

// Helper: inisialisasi kuota default per user (tahunan & overtime)
function initKuotaUser(kuota, username, tahun) {
  if (!kuota[username]) kuota[username] = {};
  const key = String(tahun);
  if (!kuota[username][key]) {
    kuota[username][key] = {
      tahunan:  { total: 12, terpakai: 0, resetAt: `${tahun}-12-31` },
      overtime: { jamAkumulasi: 0, hariDiambil: 0 }  // 1 hari = 8 jam
    };
  }
  return kuota[username][key];
}

// GET kuota semua user (admin view)
app.get("/kuota-cuti", requireLevel(2), (req, res) => {
  const users  = load(F.users, {});
  const kuota  = load(F.kuotaCuti, {});
  const kebijakan = load(F.kebijakanCuti, []);
  const tahun  = parseInt(req.query.tahun) || new Date().getFullYear();
  // Kebijakan custom jenis kuota
  const customKebijakan = kebijakan.filter(k => !k._default && k.jenis === "kuota");

  const result = Object.keys(users).map(username => {
    const k = initKuotaUser(kuota, username, tahun);
    const u = users[username];
    // Attach custom kuota
    if (!k.customKuota) k.customKuota = {};
    customKebijakan.forEach(ck => {
      if (!k.customKuota[ck.id]) {
        k.customKuota[ck.id] = { nama: ck.nama, total: 0, terpakai: 0, satuanDurasi: ck.satuanDurasi || "hari" };
      } else {
        k.customKuota[ck.id].nama = ck.nama;
        k.customKuota[ck.id].satuanDurasi = ck.satuanDurasi || "hari";
      }
    });
    return {
      username,
      nama: u.namaLengkap || username,
      divisi: u.divisi || "-",
      tahunan:  k.tahunan,
      overtime: k.overtime,
      customKuota: k.customKuota
    };
  });
  // Simpan jika ada inisialisasi baru
  save(F.kuotaCuti, kuota);
  res.send(result);
});

// GET kuota milik user sendiri
app.get("/kuota-cuti/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const kuota = load(F.kuotaCuti, {});
  const kebijakan = load(F.kebijakanCuti, []);
  const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
  const k = initKuotaUser(kuota, req.params.user, tahun);
  // Attach custom kuota
  const customKebijakan = kebijakan.filter(ck => !ck._default && ck.jenis === "kuota");
  if (!k.customKuota) k.customKuota = {};
  customKebijakan.forEach(ck => {
    if (!k.customKuota[ck.id]) {
      k.customKuota[ck.id] = { nama: ck.nama, total: 0, terpakai: 0, satuanDurasi: ck.satuanDurasi || "hari" };
    } else {
      k.customKuota[ck.id].nama = ck.nama;
      k.customKuota[ck.id].satuanDurasi = ck.satuanDurasi || "hari";
    }
  });
  save(F.kuotaCuti, kuota);
  res.send(k);
});

// POST: set custom kuota untuk kebijakan kustom (oleh admin/owner)
app.post("/kuota-cuti/set-custom", requireLevel(2), (req, res) => {
  const { kebijakanId, kebijakanNama, kuota: kuotaJumlah, tahun } = req.body;
  if (!kebijakanId || kuotaJumlah == null) return res.send({ status: "ERROR", msg: "Data tidak lengkap" });

  const kuotaData = load(F.kuotaCuti, {});
  const users = load(F.users, {});
  const kebijakan = load(F.kebijakanCuti, []);
  const ck = kebijakan.find(k => k.id === kebijakanId);
  if (!ck) return res.send({ status: "NOT_FOUND", msg: "Kebijakan tidak ditemukan" });

  const thn = parseInt(tahun) || new Date().getFullYear();

  // Set kuota untuk SEMUA user
  Object.keys(users).forEach(username => {
    const k = initKuotaUser(kuotaData, username, thn);
    if (!k.customKuota) k.customKuota = {};
    if (!k.customKuota[kebijakanId]) {
      k.customKuota[kebijakanId] = { nama: ck.nama, total: parseFloat(kuotaJumlah), terpakai: 0, satuanDurasi: ck.satuanDurasi || "hari" };
    } else {
      k.customKuota[kebijakanId].total = parseFloat(kuotaJumlah);
      k.customKuota[kebijakanId].nama  = ck.nama;
      k.customKuota[kebijakanId].satuanDurasi = ck.satuanDurasi || "hari";
    }
  });
  save(F.kuotaCuti, kuotaData);
  res.send({ status: "OK" });
});

// POST: hitung ulang overtime satu user berdasarkan data absensi (per-minggu)
app.post("/kuota-cuti/hitung-overtime/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const username = req.params.user;
  const tahun    = parseInt(req.query.tahun) || new Date().getFullYear();
  const data     = load(F.data, []);
  const kuota    = load(F.kuotaCuti, {});

  // Kumpulkan jam per minggu untuk user di tahun ini
  const weekMap = {};
  data.filter(d => d.user === username && d.date && d.date.startsWith(String(tahun)) && d.jamKeluar)
    .forEach(d => {
      const wk = weekKey(d.date);
      if (!weekMap[wk]) weekMap[wk] = 0;
      weekMap[wk] += hitungJamKerja(d);
    });

  // Total jam overtime = kelebihan di atas 40 jam per minggu
  let totalOvertimeJam = 0;
  Object.values(weekMap).forEach(jam => {
    if (jam > JAM_WAJIB_MINGGU) totalOvertimeJam += (jam - JAM_WAJIB_MINGGU);
  });

  const k = initKuotaUser(kuota, username, tahun);
  k.overtime.jamAkumulasi = parseFloat(totalOvertimeJam.toFixed(2));
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK", jamOvertime: k.overtime.jamAkumulasi });
});

// POST: hitung overtime semua user sekaligus (bisa dipanggil cron/manual)
app.post("/kuota-cuti/hitung-overtime-semua", requireLevel(2), (req, res) => {
  const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
  const users = load(F.users, {});
  const data  = load(F.data, []);
  const kuota = load(F.kuotaCuti, {});

  Object.keys(users).forEach(username => {
    const weekMap = {};
    data.filter(d => d.user === username && d.date && d.date.startsWith(String(tahun)) && d.jamKeluar)
      .forEach(d => {
        const wk = weekKey(d.date);
        if (!weekMap[wk]) weekMap[wk] = 0;
        weekMap[wk] += hitungJamKerja(d);
      });
    let totalOvertimeJam = 0;
    Object.values(weekMap).forEach(jam => { if (jam > JAM_WAJIB_MINGGU) totalOvertimeJam += (jam - JAM_WAJIB_MINGGU); });
    const k = initKuotaUser(kuota, username, tahun);
    k.overtime.jamAkumulasi = parseFloat(totalOvertimeJam.toFixed(2));
  });
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK" });
});

// POST: catat pengambilan cuti tahunan (kurangi saldo)
app.post("/kuota-cuti/ambil-tahunan/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const { hari } = req.body;
  if (!hari || hari < 1) return res.send({ status: "ERROR", msg: "Jumlah hari tidak valid" });
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, req.params.user, tahun);
  const sisa = k.tahunan.total - k.tahunan.terpakai;
  if (hari > sisa) return res.send({ status: "ERROR", msg: "Saldo cuti tahunan tidak cukup" });
  k.tahunan.terpakai += parseInt(hari);
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK", sisa: k.tahunan.total - k.tahunan.terpakai });
});

// POST: catat pengambilan cuti overtime (kurangi jam akumulasi)
app.post("/kuota-cuti/ambil-overtime/:user", requireSelfOrLevel("user", 2), (req, res) => {
  const { hari } = req.body;  // 1 hari overtime = 8 jam
  if (!hari || hari < 1) return res.send({ status: "ERROR", msg: "Jumlah hari tidak valid" });
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, req.params.user, tahun);
  const jamDibutuhkan = parseInt(hari) * 8;
  if (jamDibutuhkan > k.overtime.jamAkumulasi) return res.send({ status: "ERROR", msg: "Jam overtime tidak cukup" });
  k.overtime.jamAkumulasi -= jamDibutuhkan;
  k.overtime.hariDiambil  += parseInt(hari);
  k.overtime.jamAkumulasi  = parseFloat(k.overtime.jamAkumulasi.toFixed(2));
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK", jamSisa: k.overtime.jamAkumulasi });
});

// POST: reset cuti tahunan semua user (dipanggil tiap 31 Des → 1 Jan)
app.post("/kuota-cuti/reset-tahunan", requireLevel(2), (req, res) => {
  const tahunBaru = new Date().getFullYear();
  const users = load(F.users, {});
  const kuota = load(F.kuotaCuti, {});
  Object.keys(users).forEach(username => {
    initKuotaUser(kuota, username, tahunBaru); // buat entry tahun baru (12 hari fresh)
  });
  save(F.kuotaCuti, kuota);
  res.send({ status: "OK", tahun: tahunBaru });
});

// ========================
// PENGAJUAN CUTI
// ========================

// Helper: level hirarki user
function getUserLevel(username) {
  const users  = load(F.users, {});
  const groups = load(F.groups, []);
  const u = users[username];
  if (!u) return 99;
  const g = groups.find(g => g.id === (u.group || "anggota"));
  return g ? g.level : 99;
}

function getUserGroup(username) {
  const users = load(F.users, {});
  const u = users[username];
  return u ? (u.group || "anggota") : "anggota";
}

// GET semua pengajuan cuti (admin/owner/manager bisa lihat semua, lainnya hanya miliknya)
app.get("/pengajuan-cuti", requireLevel(99), (req, res) => {
  const { requester, filter } = req.query;
  const pengajuan = load(F.pengajuanCuti, []);
  const requesterLevel = getUserLevel(requester);
  const requesterGroup = getUserGroup(requester);

  let list = pengajuan;
  // Non-admin/owner hanya lihat miliknya + approval scope
  if (requesterGroup !== "owner" && requesterGroup !== "admin") {
    const users = load(F.users, {});
    // Manager bisa lihat cuti semua anggota di divisinya + koordinator
    if (requesterGroup === "manager") {
      const myDivisi = (users[requester]?.divisi) || [];
      const myDivisiArr = Array.isArray(myDivisi) ? myDivisi : [myDivisi];
      list = pengajuan.filter(p => {
        if (p.username === requester) return true;
        const targetUser = users[p.username];
        if (!targetUser) return false;
        const targetGroup = targetUser.group || "anggota";
        if (targetGroup === "owner" || targetGroup === "admin") return false;
        // manager dan koordinator di divisi yg sama
        const targetDivisi = Array.isArray(targetUser.divisi) ? targetUser.divisi : (targetUser.divisi ? [targetUser.divisi] : []);
        return myDivisiArr.some(d => targetDivisi.includes(d));
      });
    } else {
      // koordinator & anggota: hanya lihat punya sendiri
      list = pengajuan.filter(p => p.username === requester);
    }
  }

  // Filter waktu
  const now = new Date();
  if (filter === "hari") {
    const today = now.toISOString().split("T")[0];
    list = list.filter(p => p.tanggalMulai === today);
  } else if (filter === "minggu") {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay());
    const end   = new Date(start); end.setDate(start.getDate() + 6);
    const s = start.toISOString().split("T")[0], e = end.toISOString().split("T")[0];
    list = list.filter(p => p.tanggalMulai >= s && p.tanggalMulai <= e);
  } else if (filter === "bulan") {
    const ym = now.toISOString().slice(0, 7);
    list = list.filter(p => (p.tanggalMulai || "").startsWith(ym));
  } else if (filter === "tahun") {
    const yr = String(now.getFullYear());
    list = list.filter(p => (p.tanggalMulai || "").startsWith(yr));
  }

  // Sertakan info nama
  const usersData = load(F.users, {});
  list = list.map(p => ({
    ...p,
    namaLengkap: usersData[p.username]?.namaLengkap || p.username,
    jabatan: usersData[p.username]?.jabatan || "-",
    groupTarget: usersData[p.username]?.group || "anggota",
  }));

  res.send(list.sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
});

// POST: ajukan cuti baru
app.post("/pengajuan-cuti", requireLevel(99), (req, res) => {
  const { username, kebijakanId, kebijakanNama, kuotaKey, durasi, satuanDurasi,
          tanggalMulai, tanggalAkhir, jamMulai, jamAkhir } = req.body;
  if (!username || !kebijakanId || !durasi) return res.send({ status: "ERROR", msg: "Data tidak lengkap" });

  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, username, tahun);

  // Cek apakah ini kebijakan custom jenis kuota
  const kebijakan = load(F.kebijakanCuti, []);
  const kb = kebijakan.find(x => x.id === kebijakanId);
  const isCustomKuota = kb && !kb._default && kb.jenis === "kuota";

  // Validasi & kurangi saldo
  if (kuotaKey === "tahunan") {
    const sisa = k.tahunan.total - k.tahunan.terpakai;
    if (parseFloat(durasi) > sisa) return res.send({ status: "ERROR", msg: `Saldo cuti tahunan tidak cukup (sisa: ${sisa} hari)` });
    k.tahunan.terpakai += parseFloat(durasi);
  } else if (kuotaKey === "overtime") {
    const satuanJam = satuanDurasi === "jam" ? parseFloat(durasi) : parseFloat(durasi) * 8;
    if (satuanJam > k.overtime.jamAkumulasi) return res.send({ status: "ERROR", msg: `Jam overtime tidak cukup (sisa: ${k.overtime.jamAkumulasi.toFixed(1)} jam)` });
    k.overtime.jamAkumulasi -= satuanJam;
    k.overtime.hariDiambil  += satuanDurasi === "hari" ? parseFloat(durasi) : 0;
  } else if (isCustomKuota) {
    // Custom kuota: catat saldo
    if (!k.customKuota) k.customKuota = {};
    if (!k.customKuota[kebijakanId]) {
      k.customKuota[kebijakanId] = { nama: kb.nama, total: 0, terpakai: 0, satuanDurasi: kb.satuanDurasi || "hari" };
    }
    const ck = k.customKuota[kebijakanId];
    const sisa = ck.total - ck.terpakai;
    if (parseFloat(durasi) > sisa) {
      return res.send({ status: "ERROR", msg: `Saldo cuti "${kb.nama}" tidak cukup (sisa: ${sisa} ${ck.satuanDurasi || "hari"})` });
    }
    ck.terpakai += parseFloat(durasi);
  }
  // Jika Non-Kuota, tidak perlu catat saldo sama sekali
  save(F.kuotaCuti, kuota);

  const pengajuan = load(F.pengajuanCuti, []);
  const id = "cuti-" + Date.now() + "-" + Math.random().toString(36).slice(2,6);
  const entry = {
    id, username, kebijakanId, kebijakanNama, kuotaKey: kuotaKey || null,
    durasi: parseFloat(durasi), satuanDurasi: satuanDurasi || "hari",
    tanggalMulai: tanggalMulai || null, tanggalAkhir: tanggalAkhir || null,
    jamMulai: jamMulai || null, jamAkhir: jamAkhir || null,
    status: "menunggu",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectedReason: null,
    canceledBy: null, canceledAt: null,
    createdAt: new Date().toISOString()
  };
  pengajuan.push(entry);
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(username, "CUTI_AJUKAN", new Date().toISOString());
  res.send({ status: "OK", id });
});

// POST: approve cuti
app.post("/pengajuan-cuti/:id/approve", requireLevel(99), (req, res) => {
  // Identitas approver diambil dari middleware (X-User header), bukan dari body
  const approver = req._requester;
  const pengajuan = load(F.pengajuanCuti, []);
  const idx = pengajuan.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  const p = pengajuan[idx];

  // User tidak boleh approve cuti miliknya sendiri
  if (approver === p.username) return res.send({ status: "FORBIDDEN", msg: "Tidak bisa menyetujui cuti sendiri" });

  // Cek hak approve
  const approverGroup = getUserGroup(approver);
  const targetGroup   = getUserGroup(p.username);

  let canApprove = false;
  if (approverGroup === "owner" || approverGroup === "admin") {
    canApprove = true;
  } else if (approverGroup === "manager") {
    // Manager hanya bisa approve anggota/koordinator (bukan manager/admin/owner)
    if (targetGroup === "anggota" || targetGroup === "koordinator") canApprove = true;
  }
  if (!canApprove) return res.send({ status: "FORBIDDEN", msg: "Tidak memiliki hak approve" });

  p.status     = "disetujui";
  p.approvedBy = approver;
  p.approvedAt = new Date().toISOString();
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(approver, "CUTI_APPROVE", new Date().toISOString());
  res.send({ status: "OK" });
});

// POST: reject cuti (kembalikan saldo)
app.post("/pengajuan-cuti/:id/reject", requireLevel(99), (req, res) => {
  const { reason } = req.body;
  // Identitas approver diambil dari middleware (X-User header), bukan dari body
  const approver = req._requester;
  const pengajuan = load(F.pengajuanCuti, []);
  const idx = pengajuan.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  const p = pengajuan[idx];
  if (p.status !== "menunggu") return res.send({ status: "ERROR", msg: "Hanya cuti berstatus menunggu yang bisa di-reject" });

  // User tidak boleh reject cuti miliknya sendiri
  if (approver === p.username) return res.send({ status: "FORBIDDEN", msg: "Tidak bisa menolak cuti sendiri" });

  const approverGroup = getUserGroup(approver);
  const targetGroup   = getUserGroup(p.username);

  let canReject = false;
  if (approverGroup === "owner" || approverGroup === "admin") canReject = true;
  else if (approverGroup === "manager" && (targetGroup === "anggota" || targetGroup === "koordinator")) canReject = true;
  if (!canReject) return res.send({ status: "FORBIDDEN" });

  // Kembalikan saldo
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, p.username, tahun);
  if (p.kuotaKey === "tahunan") {
    k.tahunan.terpakai = Math.max(0, k.tahunan.terpakai - p.durasi);
  } else if (p.kuotaKey === "overtime") {
    const jamKembali = p.satuanDurasi === "jam" ? p.durasi : p.durasi * 8;
    k.overtime.jamAkumulasi += jamKembali;
    k.overtime.jamAkumulasi = parseFloat(k.overtime.jamAkumulasi.toFixed(2));
    if (p.satuanDurasi === "hari") k.overtime.hariDiambil = Math.max(0, k.overtime.hariDiambil - p.durasi);
  } else if (p.kebijakanId && k.customKuota && k.customKuota[p.kebijakanId]) {
    // Kembalikan saldo custom kuota
    const ck = k.customKuota[p.kebijakanId];
    ck.terpakai = Math.max(0, ck.terpakai - p.durasi);
  }
  save(F.kuotaCuti, kuota);

  p.status       = "ditolak";
  p.rejectedBy   = approver;
  p.rejectedAt   = new Date().toISOString();
  p.rejectedReason = reason || "";
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(approver, "CUTI_REJECT", new Date().toISOString());
  res.send({ status: "OK" });
});

// POST: batalkan cuti (hanya pengaju sendiri, jika masih menunggu)
app.post("/pengajuan-cuti/:id/cancel", requireLevel(99), (req, res) => {
  // Identitas pembatal diambil dari middleware (X-User header), bukan dari body
  const username = req._requester;
  const pengajuan = load(F.pengajuanCuti, []);
  const idx = pengajuan.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.send({ status: "NOT_FOUND" });
  const p = pengajuan[idx];
  if (p.username !== username) return res.send({ status: "FORBIDDEN" });
  if (p.status !== "menunggu" && p.status !== "disetujui") return res.send({ status: "ERROR", msg: "Tidak bisa dibatalkan" });

  // Kembalikan saldo jika belum expired / masih relevan
  const tahun = new Date().getFullYear();
  const kuota = load(F.kuotaCuti, {});
  const k = initKuotaUser(kuota, p.username, tahun);
  if (p.kuotaKey === "tahunan") {
    k.tahunan.terpakai = Math.max(0, k.tahunan.terpakai - p.durasi);
  } else if (p.kuotaKey === "overtime") {
    const jamKembali = p.satuanDurasi === "jam" ? p.durasi : p.durasi * 8;
    k.overtime.jamAkumulasi += jamKembali;
    k.overtime.jamAkumulasi = parseFloat(k.overtime.jamAkumulasi.toFixed(2));
    if (p.satuanDurasi === "hari") k.overtime.hariDiambil = Math.max(0, k.overtime.hariDiambil - p.durasi);
  } else if (p.kebijakanId && k.customKuota && k.customKuota[p.kebijakanId]) {
    // Kembalikan saldo custom kuota
    const ck = k.customKuota[p.kebijakanId];
    ck.terpakai = Math.max(0, ck.terpakai - p.durasi);
  }
  save(F.kuotaCuti, kuota);

  p.status     = "dibatalkan";
  p.canceledBy = username;
  p.canceledAt = new Date().toISOString();
  save(F.pengajuanCuti, pengajuan);
  logAktivitas(username, "CUTI_CANCEL", new Date().toISOString());
  res.send({ status: "OK" });
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));// ========================
// TRACKING
// ========================

// POST lokasi dari anggota (dipanggil periodik saat sedang kerja)
app.post("/tracking/ping", requireLevel(99), (req, res) => {
  const { lat, lng, accuracy } = req.body;
  // Identitas user diambil dari middleware (X-User header), bukan dari body
  const user = req._requester;
  if (!user || lat == null || lng == null) return res.send({ status: "ERROR" });

  const tracking = load(F.tracking, {});
  const today    = new Date().toISOString().split("T")[0];
  const now      = new Date().toISOString();

  if (!tracking[today]) tracking[today] = {};
  if (!tracking[today][user]) tracking[today][user] = [];

  // Tambah titik baru
  tracking[today][user].push({ lat, lng, accuracy: accuracy || 0, time: now });

  // Batasi 500 titik per user per hari agar file tidak membengkak
  if (tracking[today][user].length > 500) tracking[today][user].splice(0, 1);

  // Hapus data lebih dari 7 hari lalu
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  Object.keys(tracking).forEach(d => { if (d < cutoff) delete tracking[d]; });

  save(F.tracking, tracking);
  res.send({ status: "OK" });
});

// GET rute anggota tertentu untuk tanggal tertentu
app.get("/tracking/:user", requireSelfOrLevel("user", 3), (req, res) => {
  const date     = req.query.date || new Date().toISOString().split("T")[0];
  const tracking = load(F.tracking, {});
  const points   = (tracking[date] || {})[req.params.user] || [];
  res.send({ user: req.params.user, date, points });
});

// GET posisi terakhir semua anggota (live map)
app.get("/tracking/live/all", requireLevel(3), (req, res) => {
  const tracking = load(F.tracking, {});
  const users    = load(F.users, {});
  const data     = load(F.data, []);
  const today    = new Date().toISOString().split("T")[0];
  const todayData = (tracking[today] || {});

  const requester      = req._requester;
  const requesterGroup = getUserGroup(requester);

  // Tentukan divisi requester jika manager
  const requesterDivisi = (() => {
    const u = users[requester];
    if (!u) return [];
    return Array.isArray(u.divisi) ? u.divisi : (u.divisi ? [u.divisi] : []);
  })();

  const result = Object.keys(users)
    .filter(username => {
      // Owner & admin bisa lihat semua kecuali diri sendiri tidak perlu disembunyikan
      if (requesterGroup === "owner" || requesterGroup === "admin") return true;
      // Manager: hanya bisa lihat anggota & koordinator di divisinya sendiri
      // Tidak bisa lihat owner, admin, atau sesama manager
      if (requesterGroup === "manager") {
        const targetGroup  = getUserGroup(username);
        if (targetGroup === "owner" || targetGroup === "admin" || targetGroup === "manager") return false;
        const targetUser   = users[username];
        const targetDivisi = Array.isArray(targetUser?.divisi)
          ? targetUser.divisi
          : (targetUser?.divisi ? [targetUser.divisi] : []);
        return requesterDivisi.some(d => targetDivisi.includes(d));
      }
      return false;
    })
    .map(username => {
      const points  = todayData[username] || [];
      const last    = points.length ? points[points.length - 1] : null;
      const rec     = data.find(d => d.user === username && d.date === today);
      let status    = "OUT";
      if (rec && !rec.jamKeluar) {
        const lb = rec.breaks.at(-1);
        status   = (lb && !lb.end) ? "BREAK" : "IN";
      } else if (rec && rec.jamKeluar) status = "DONE";

      return {
        username,
        namaLengkap: users[username].namaLengkap || username,
        photo:       users[username].photo || "",
        jabatan:     users[username].jabatan || "",
        divisi:      users[username].divisi || "",
        status,
        last,
        totalPoints: points.length,
      };
    });

  res.send(result);
});

