const express = require("express");
const fs      = require("fs");
const path    = require("path");
const app     = express();

const PORT     = process.env.PORT || 3000;
const IS_CLOUD = process.env.RAILWAY_ENVIRONMENT !== undefined;
const DATA_DIR = IS_CLOUD ? "/tmp" : ".";

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const F = {
  data:      path.join(DATA_DIR, "data.json"),
  users:     path.join(DATA_DIR, "users.json"),
  areas:     path.join(DATA_DIR, "areas.json"),
  libur:     path.join(DATA_DIR, "libur.json"),
  aktivitas: path.join(DATA_DIR, "aktivitas.json"),
  roles:     path.join(DATA_DIR, "roles.json"),   // Owner/Admin/Anggota (peran sistem)
  groups:    path.join(DATA_DIR, "groups.json"),  // divisi/jabatan (group organisasi)
};

// ─── HELPERS ───────────────────────────────────────────────
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

// Roles sistem (peran): Owner > Admin > Anggota
function initRoles() {
  if (!fs.existsSync(F.roles)) {
    save(F.roles, [
      { id:"owner",   name:"Owner",   level:1, color:"#8e44ad",
        menus:["home","rekap","admin","setting","anggota","rules","area","libur","aktivitas","timesheet","profil","group"] },
      { id:"admin",   name:"Admin",   level:2, color:"#2980b9",
        menus:["home","rekap","admin","setting","anggota","area","libur","aktivitas","timesheet","profil","group"] },
      { id:"anggota", name:"Anggota", level:5, color:"#7f8c8d",
        menus:["home","rekap","profil"] },
    ]);
  }
}
initRoles();

// ─── AUTH ──────────────────────────────────────────────────
app.post("/signup", (req, res) => {
  const { username, password, faceDescriptor, namaLengkap, agama } = req.body;
  if (!username || !password) return res.send({ status:"ERROR" });
  const users   = load(F.users, {});
  if (users[username]) return res.send({ status:"EXIST" });
  const isFirst = Object.keys(users).length === 0;
  users[username] = {
    password,
    faceDescriptor:  faceDescriptor || [],
    role:            isFirst ? "owner" : "anggota",  // peran sistem
    namaLengkap:     namaLengkap || username,
    agama:           agama || "",
    photoProfil:     "",
    lingkupKerja:    "default",   // "default"=wajib area, "luar"=bebas area
    jabatan:         "",          // diisi Owner via menu Anggota
    groupId:         "",          // diisi Owner via menu Group
    nominalGaji:     "",          // hanya Owner yg lihat
    createdAt:       new Date().toISOString(),
  };
  save(F.users, users);
  res.send({ status:"OK" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const users = load(F.users, {});
  const user  = users[username];
  if (!user || user.password !== password) return res.send({ status:"FAIL" });
  const roles = load(F.roles, []);
  const role  = roles.find(r => r.id === (user.role || "anggota")) || roles[roles.length-1];
  res.send({ status:"OK", role: role.id, menus: role.menus, level: role.level });
});

app.get("/check-user/:username", (req, res) => {
  const users = load(F.users, {});
  const user  = users[req.params.username];
  if (!user) return res.send({ valid:false });
  const roles = load(F.roles, []);
  const role  = roles.find(r => r.id === (user.role || "anggota")) || roles[roles.length-1];
  res.send({ valid:true, role: role.id, menus: role.menus, level: role.level });
});

app.get("/face-descriptor/:username", (req, res) => {
  const users = load(F.users, {});
  const user  = users[req.params.username];
  res.send({ descriptor: user ? (user.faceDescriptor || []) : [] });
});

// ─── PROFIL ────────────────────────────────────────────────
// Ambil profil satu user
app.get("/profil/:username", (req, res) => {
  const users    = load(F.users, {});
  const roles    = load(F.roles, []);
  const groups   = load(F.groups, []);
  const u        = users[req.params.username];
  if (!u) return res.status(404).send({ status:"NOT_FOUND" });
  const role     = roles.find(r => r.id === (u.role||"anggota"));
  const group    = groups.find(g => g.id === u.groupId);
  // Kembalikan profil — password dan faceDescriptor disertakan (untuk owner/admin/diri sendiri, difilter di FE)
  res.send({
    username:      req.params.username,
    password:      u.password,
    namaLengkap:   u.namaLengkap || req.params.username,
    agama:         u.agama || "",
    photoProfil:   u.photoProfil || "",
    jabatan:       u.jabatan || "",
    lingkupKerja:  u.lingkupKerja || "default",
    nominalGaji:   u.nominalGaji || "",
    role:          u.role || "anggota",
    roleName:      role?.name || "Anggota",
    roleColor:     role?.color || "#7f8c8d",
    groupId:       u.groupId || "",
    groupName:     group?.nama || "",
    createdAt:     u.createdAt || "",
    hasFace:       (u.faceDescriptor||[]).length > 0,
  });
});

// Update profil (nama, agama, photo) — oleh pemilik akun sendiri
app.put("/profil/:username", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.status(404).send({ status:"NOT_FOUND" });
  const allowed = ["namaLengkap","agama","photoProfil"];
  allowed.forEach(k => { if (req.body[k] !== undefined) users[req.params.username][k] = req.body[k]; });
  save(F.users, users);
  res.send({ status:"OK" });
});

// Update password — oleh pemilik akun sendiri
app.put("/profil/:username/password", (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const users = load(F.users, {});
  const user  = users[req.params.username];
  if (!user) return res.status(404).send({ status:"NOT_FOUND" });
  if (user.password !== oldPassword) return res.send({ status:"WRONG_PASSWORD" });
  user.password = newPassword;
  save(F.users, users);
  res.send({ status:"OK" });
});

// Update face descriptor — oleh pemilik akun
app.put("/profil/:username/face", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.status(404).send({ status:"NOT_FOUND" });
  users[req.params.username].faceDescriptor = req.body.faceDescriptor || [];
  save(F.users, users);
  res.send({ status:"OK" });
});

// Hapus akun — hanya owner/admin
app.delete("/profil/:username", (req, res) => {
  const { byUser } = req.body;
  const users  = load(F.users, {});
  const roles  = load(F.roles, []);
  const byRole = users[byUser]?.role || "anggota";
  const byLvl  = roles.find(r => r.id === byRole)?.level || 99;
  if (byLvl > 2) return res.send({ status:"FORBIDDEN" });
  if (!users[req.params.username]) return res.status(404).send({ status:"NOT_FOUND" });
  delete users[req.params.username];
  save(F.users, users);
  res.send({ status:"OK" });
});

// ─── ANGGOTA (admin view) ──────────────────────────────────
app.get("/anggota", (req, res) => {
  const users  = load(F.users, {});
  const roles  = load(F.roles, []);
  const groups = load(F.groups, []);
  const list   = Object.keys(users).map(u => {
    const r = roles.find(x => x.id === (users[u].role||"anggota"));
    const g = groups.find(x => x.id === users[u].groupId);
    return {
      username:     u,
      namaLengkap:  users[u].namaLengkap || u,
      photoProfil:  users[u].photoProfil || "",
      role:         users[u].role || "anggota",
      roleName:     r?.name || "Anggota",
      roleColor:    r?.color || "#7f8c8d",
      jabatan:      users[u].jabatan || "",
      groupId:      users[u].groupId || "",
      groupName:    g?.nama || "",
      lingkupKerja: users[u].lingkupKerja || "default",
      createdAt:    users[u].createdAt || "",
    };
  });
  res.send(list);
});

// Update field anggota oleh owner/admin: role, jabatan, lingkupKerja, groupId, nominalGaji
app.put("/anggota/:username", (req, res) => {
  const users   = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status:"NOT_FOUND" });
  const allowed = ["role","jabatan","lingkupKerja","groupId","nominalGaji"];
  allowed.forEach(k => { if (req.body[k] !== undefined) users[req.params.username][k] = req.body[k]; });
  save(F.users, users);
  res.send({ status:"OK" });
});

app.delete("/anggota/:username", (req, res) => {
  const users = load(F.users, {});
  if (!users[req.params.username]) return res.send({ status:"NOT_FOUND" });
  delete users[req.params.username];
  save(F.users, users);
  res.send({ status:"OK" });
});

// ─── ROLES (Rules) ─────────────────────────────────────────
app.get("/roles", (req, res) => res.send(load(F.roles, [])));

app.put("/roles/:id/menus", (req, res) => {
  const roles = load(F.roles, []);
  const role  = roles.find(r => r.id === req.params.id);
  if (!role) return res.send({ status:"NOT_FOUND" });
  if (role.id === "owner") return res.send({ status:"PROTECTED" });
  role.menus = req.body.menus || [];
  if (!role.menus.includes("home")) role.menus.push("home");
  save(F.roles, roles);
  res.send({ status:"OK" });
});

// ─── GROUPS (divisi/organisasi) ────────────────────────────
app.get("/groups", (req, res) => res.send(load(F.groups, [])));

app.post("/groups", (req, res) => {
  const { nama, managerId, anggotaIds } = req.body;
  if (!nama) return res.send({ status:"ERROR" });
  const groups = load(F.groups, []);
  groups.push({ id: Date.now().toString(), nama, managerId: managerId||"", anggotaIds: anggotaIds||[], createdAt: new Date().toISOString() });
  save(F.groups, groups);
  res.send({ status:"OK" });
});

app.put("/groups/:id", (req, res) => {
  const groups = load(F.groups, []);
  const group  = groups.find(g => g.id === req.params.id);
  if (!group) return res.send({ status:"NOT_FOUND" });
  if (req.body.nama       !== undefined) group.nama       = req.body.nama;
  if (req.body.managerId  !== undefined) group.managerId  = req.body.managerId;
  if (req.body.anggotaIds !== undefined) group.anggotaIds = req.body.anggotaIds;
  save(F.groups, groups);
  res.send({ status:"OK" });
});

app.delete("/groups/:id", (req, res) => {
  const groups = load(F.groups, []);
  const idx    = groups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.send({ status:"NOT_FOUND" });
  groups.splice(idx, 1);
  save(F.groups, groups);
  res.send({ status:"OK" });
});

// ─── ABSENSI ───────────────────────────────────────────────
app.post("/absen", (req, res) => {
  const data  = load(F.data, []);
  const areas = load(F.areas, []);
  const users = load(F.users, {});
  const { user, type, time, lat, lng, photo } = req.body;
  const today = new Date().toISOString().split("T")[0];
  const uData = users[user] || {};

  // Geofencing — skip jika lingkupKerja = "luar" (Tugas Luar)
  if (uData.lingkupKerja !== "luar" && lat !== 0 && lng !== 0 && areas.length > 0) {
    const aktifAreas = areas.filter(a => a.active);
    if (aktifAreas.length > 0) {
      const inAny = aktifAreas.some(a => dist(lat, lng, a.lat, a.lng) <= a.radius);
      if (!inAny) {
        const nearest = aktifAreas.reduce((b,a) => { const d=dist(lat,lng,a.lat,a.lng); return d<b.d?{d,name:a.name}:b; }, {d:Infinity,name:""});
        return res.status(400).send({ status:"OUT_OF_AREA", distance:Math.round(nearest.d), area:nearest.name });
      }
    }
  }

  let record = data.find(d => d.user===user && d.date===today && !d.jamKeluar);
  if (type==="IN") {
    if (record) return res.send({ status:"ALREADY_IN" });
    data.push({ user, date:today, jamMasuk:time, jamKeluar:null, lokasi:{lat,lng}, foto:photo, breaks:[] });
  } else if (type==="OUT" && record) {
    record.jamKeluar = time;
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  } else if (type==="BREAK_START" && record) {
    record.breaks.push({ start:time, end:null });
  } else if (type==="BREAK_END" && record) {
    const lb = record.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  }

  save(F.data, data);
  logAktivitas(user, type, time);
  res.send({ status:"OK" });
});

app.get("/status/:user", (req, res) => {
  const data  = load(F.data, []);
  const today = new Date().toISOString().split("T")[0];
  const aktif = data.find(d => d.user===req.params.user && d.date===today && !d.jamKeluar);
  if (!aktif) return res.send({ status:"OUT" });
  const lb = aktif.breaks.at(-1);
  if (lb && !lb.end) return res.send({ status:"BREAK" });
  return res.send({ status:"IN" });
});

// ─── REPORT & HISTORY ──────────────────────────────────────
app.get("/report/:user", (req, res) => {
  const data = load(F.data, []);
  let totalKerja=0, totalBreak=0;
  data.filter(d => d.user===req.params.user && d.jamKeluar).forEach(d => {
    const work=(new Date(d.jamKeluar)-new Date(d.jamMasuk))/3600000;
    let bt=0; d.breaks.forEach(b=>{ if(b.end) bt+=(new Date(b.end)-new Date(b.start))/3600000; });
    totalKerja+=(work-bt); totalBreak+=bt;
  });
  res.send({ totalKerja:totalKerja.toFixed(1)+"h", totalBreak:totalBreak.toFixed(1)+"h", overtime:Math.max(0,totalKerja-8).toFixed(1)+"h" });
});

app.get("/history/:user", (req, res) => {
  const data = load(F.data, []);
  res.send(data.filter(d=>d.user===req.params.user).slice(-30).reverse());
});

// ─── ADMIN ─────────────────────────────────────────────────
app.get("/admin/today", (req, res) => {
  const data  = load(F.data, []);
  const users = load(F.users, {});
  const date  = req.query.date || new Date().toISOString().split("T")[0];
  const records = Object.keys(users).map(u => {
    const rec = data.find(d=>d.user===u && d.date===date);
    let status="OUT";
    if (rec && !rec.jamKeluar) { const lb=rec.breaks.at(-1); status=(lb&&!lb.end)?"BREAK":"IN"; }
    else if (rec?.jamKeluar) status="DONE";
    return { user:u, namaLengkap:users[u].namaLengkap||u, jamMasuk:rec?.jamMasuk||null, jamKeluar:rec?.jamKeluar||null, status };
  });
  res.send({ totalUsers:Object.keys(users).length, records });
});

// ─── AREAS ─────────────────────────────────────────────────
app.get("/areas",      (req, res) => res.send(load(F.areas, [])));
app.post("/areas",     (req, res) => {
  const { name,lat,lng,radius } = req.body;
  if (!name||!lat||!lng) return res.send({ status:"ERROR" });
  const areas = load(F.areas, []);
  areas.push({ id:Date.now().toString(), name, lat:parseFloat(lat), lng:parseFloat(lng), radius:parseInt(radius)||100, active:true });
  save(F.areas, areas); res.send({ status:"OK" });
});
app.put("/areas/:id",  (req, res) => {
  const areas=load(F.areas,[]); const a=areas.find(x=>x.id===req.params.id);
  if (!a) return res.send({ status:"NOT_FOUND" });
  Object.assign(a,{ name:req.body.name??a.name, lat:parseFloat(req.body.lat)||a.lat, lng:parseFloat(req.body.lng)||a.lng, radius:parseInt(req.body.radius)||a.radius, active:req.body.active??a.active });
  save(F.areas,areas); res.send({ status:"OK" });
});
app.delete("/areas/:id",(req,res)=>{
  const areas=load(F.areas,[]); const idx=areas.findIndex(x=>x.id===req.params.id);
  if(idx===-1) return res.send({status:"NOT_FOUND"});
  areas.splice(idx,1); save(F.areas,areas); res.send({status:"OK"});
});

// ─── LIBUR ─────────────────────────────────────────────────
app.get("/libur",       (req,res)=>res.send(load(F.libur,[])));
app.post("/libur",      (req,res)=>{
  const {date,name,type}=req.body; if(!date||!name) return res.send({status:"ERROR"});
  const d=load(F.libur,[]); d.push({id:Date.now().toString(),date,name,type:type||"nasional"});
  save(F.libur,d); res.send({status:"OK"});
});
app.delete("/libur/:id",(req,res)=>{
  const d=load(F.libur,[]); const i=d.findIndex(x=>x.id===req.params.id);
  if(i===-1) return res.send({status:"NOT_FOUND"});
  d.splice(i,1); save(F.libur,d); res.send({status:"OK"});
});

// ─── AKTIVITAS ─────────────────────────────────────────────
app.get("/aktivitas",(req,res)=>{ const d=load(F.aktivitas,[]); res.send(d.slice(-100).reverse()); });

// ─── TIMESHEET ─────────────────────────────────────────────
app.get("/timesheet",(req,res)=>{
  const month=req.query.month; if(!month) return res.send([]);
  const data=load(F.data,[]); const users=load(F.users,{});
  const result=Object.keys(users).map(u=>{
    const recs=data.filter(d=>d.user===u && d.date.startsWith(month) && d.jamKeluar);
    let tj=0,ot=0;
    recs.forEach(d=>{
      const w=(new Date(d.jamKeluar)-new Date(d.jamMasuk))/3600000;
      let bt=0; d.breaks.forEach(b=>{if(b.end) bt+=(new Date(b.end)-new Date(b.start))/3600000;});
      const net=w-bt; tj+=net; ot+=Math.max(0,net-8);
    });
    return {user:u, namaLengkap:users[u].namaLengkap||u, totalDays:recs.length, totalJam:tj.toFixed(1), overtime:ot.toFixed(1)};
  });
  res.send(result);
});

app.listen(PORT, ()=>console.log(`✅ Server running on port ${PORT}`));