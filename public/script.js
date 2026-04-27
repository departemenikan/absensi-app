// ============================================================
// STATE
// ============================================================
let faceModelsLoaded = false;
let isLoginMode      = true;
let verifyResolve    = null;
let userMenus        = [];   // menu yang boleh diakses user ini
let userGroup        = "";
let userLevel        = 99;

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = "success", ms = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = type;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
}

// ============================================================
// NAVIGASI — satu sistem terpusat, tidak ada konflik
// ============================================================
function openView(viewId) {
  // Sembunyikan semua view
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  // Tampilkan view yang diminta
  const el = document.getElementById(viewId);
  if (el) el.classList.add("active");
  // Scroll ke atas
  window.scrollTo(0, 0);
  // Load data jika perlu
  if (viewId === "view-rekap")      loadRekap();
  if (viewId === "view-admin")      loadAdmin();
  if (viewId === "view-aktivitas")  loadAktivitas();
  if (viewId === "view-area")       loadAreas();
  if (viewId === "view-libur")      loadLibur();
  if (viewId === "view-anggota")    { loadAnggota(); loadGroups(); }
  if (viewId === "view-timesheet")  {
    const m = document.getElementById("ts-month");
    if (!m.value) m.value = new Date().toISOString().slice(0, 7);
    loadTimesheet();
  }
}

function navTo(page) {
  // Update nav aktif
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const navBtn = document.getElementById("nav-" + page);
  if (navBtn) navBtn.classList.add("active");
  openView("view-" + page);
}

// ============================================================
// FACE API
// ============================================================
async function loadFaceModels() {
  const el = document.getElementById("faceStatus");
  if (el) el.innerText = "⏳ Memuat model wajah...";
  try {
    const URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
    await faceapi.nets.ssdMobilenetv1.loadFromUri(URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(URL);
    faceModelsLoaded = true;
    if (el) el.innerText = "✅ Model wajah siap";
  } catch (e) {
    if (el) el.innerText = "⚠️ Gagal load model (butuh internet)";
  }
}

async function getFaceDescriptor(videoEl) {
  if (!videoEl) return null;
  const det = await faceapi
    .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks().withFaceDescriptor();
  return det ? det.descriptor : null;
}

// ============================================================
// AUTH
// ============================================================
function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById("auth-title").innerText    = isLoginMode ? "Login" : "Sign Up";
  document.getElementById("btn-auth-main").innerText = isLoginMode ? "Login" : "Sign Up";
  document.getElementById("auth-toggle-text").innerHTML = isLoginMode
    ? 'Belum punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Sign Up</a>'
    : 'Sudah punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Login</a>';
  const fs = document.getElementById("face-signup-section");
  fs.classList.toggle("hidden", isLoginMode);
  if (!isLoginMode) startCam("video-signup");
  else stopCam("video-signup");
}

async function handleAuth() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (!username || !password) return showToast("⚠️ Isi username dan password!", "warning");
  isLoginMode ? await doLogin(username, password) : await doSignUp(username, password);
}

async function doLogin(u, p) {
  try {
    const r = await fetch("/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({username:u, password:p}) });
    const d = await r.json();
    if (d.status === "OK") {
      localStorage.setItem("user", u);
      localStorage.setItem("menus", JSON.stringify(d.menus || []));
      localStorage.setItem("group", d.group || "anggota");
      localStorage.setItem("level", d.level || 99);
      enterApp(d.menus || [], d.group, d.level);
    } else {
      showToast("❌ Username atau password salah!", "error");
    }
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

async function doSignUp(u, p) {
  if (!faceModelsLoaded) return showToast("⏳ Model wajah belum siap", "warning");
  const btn = document.getElementById("btn-auth-main");
  btn.innerText = "⏳ Scanning..."; btn.disabled = true;
  try {
    const videoEl    = document.getElementById("video-signup");
    const descriptor = await getFaceDescriptor(videoEl);
    if (!descriptor) {
      showToast("❌ Wajah tidak terdeteksi! Pastikan pencahayaan cukup", "error");
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }
    const r = await fetch("/signup", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({username:u, password:p, faceDescriptor:Array.from(descriptor)}) });
    const d = await r.json();
    if (d.status === "OK") {
      stopCam("video-signup");
      showToast("✅ Akun berhasil dibuat! Silakan login");
      setTimeout(() => toggleAuthMode(), 1500);
    } else if (d.status === "EXIST") {
      showToast("⚠️ Username sudah terdaftar!", "warning");
    } else {
      showToast("❌ Gagal membuat akun", "error");
    }
  } catch (e) { showToast("❌ Error: " + e.message, "error"); }
  btn.innerText = "Sign Up"; btn.disabled = false;
}

async function checkLoginStatus() {
  const u = localStorage.getItem("user");
  if (!u) { showAuthPage(); return; }
  try {
    const r = await fetch("/check-user/" + u);
    const d = await r.json();
    if (d.valid) {
      localStorage.setItem("menus", JSON.stringify(d.menus || []));
      localStorage.setItem("group", d.group || "anggota");
      localStorage.setItem("level", d.level || 99);
      enterApp(d.menus || [], d.group, d.level);
    } else {
      localStorage.clear(); showAuthPage();
    }
  } catch { localStorage.clear(); showAuthPage(); }
}

function showAuthPage() {
  document.getElementById("auth-page").classList.remove("hidden");
  document.getElementById("main-nav").classList.add("hidden");
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
}

function enterApp(menus, group, level) {
  userMenus = menus || [];
  userGroup = group || "anggota";
  userLevel = level || 99;

  document.getElementById("auth-page").classList.add("hidden");
  document.getElementById("main-nav").classList.remove("hidden");
  stopCam("video-signup");

  // Tampilkan/sembunyikan nav berdasarkan akses
  document.getElementById("nav-admin").classList.toggle("hidden",   !userMenus.includes("admin"));
  document.getElementById("nav-setting").classList.toggle("hidden", !userMenus.includes("setting"));

  // Tampilkan/sembunyikan menu di setting
  applyMenuAccess();

  // Update header
  document.getElementById("hdr-user").innerText = localStorage.getItem("user") || "";
  document.getElementById("hdr-date").innerText = new Date().toLocaleDateString("id-ID", {weekday:"long",day:"numeric",month:"long",year:"numeric"});
  document.getElementById("rekap-user-label").innerText = localStorage.getItem("user") || "";

  navTo("home");
  loadStatus();
  loadTodayDetail();

  // Set tanggal default admin
  const ad = document.getElementById("adm-date");
  if (ad) ad.value = new Date().toISOString().split("T")[0];
}

function applyMenuAccess() {
  const map = {
    "menu-anggota":   "anggota",
    "menu-area":      "area",
    "menu-libur":     "libur",
    "menu-aktivitas": "aktivitas",
    "menu-timesheet": "timesheet",
  };
  Object.entries(map).forEach(([elId, menuKey]) => {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle("hidden", !userMenus.includes(menuKey));
  });
}

function logout() {
  if (confirm("Yakin ingin keluar?")) { localStorage.clear(); location.reload(); }
}

// ============================================================
// KAMERA
// ============================================================
function startCam(id) {
  const v = document.getElementById(id);
  if (!v || v.srcObject) return;
  navigator.mediaDevices.getUserMedia({ video:{facingMode:"user"}, audio:false })
    .then(s => { v.srcObject = s; })
    .catch(e => console.warn("Kamera:", e));
}

function stopCam(id) {
  const v = document.getElementById(id);
  if (v && v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
}

function takePhoto() {
  const c = document.getElementById("canvas");
  const v = document.getElementById("video-modal");
  if (!v || !v.videoWidth) return "";
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  return c.toDataURL("image/jpeg", 0.7);
}

// ============================================================
// CAMERA MODAL + FACE VERIFY
// ============================================================
function showCamModal(title) {
  document.getElementById("cam-modal-title").innerText = title;
  document.getElementById("camera-modal").classList.remove("hidden");
  document.getElementById("camera-status").innerText = "Mendeteksi wajah...";
  startCam("video-modal");
}

function hideCamModal() {
  document.getElementById("camera-modal").classList.add("hidden");
  stopCam("video-modal");
}

function cancelVerify() {
  hideCamModal();
  if (verifyResolve) { verifyResolve(false); verifyResolve = null; }
}

async function verifyFace(label) {
  return new Promise(async (resolve) => {
    verifyResolve = resolve;
    showCamModal("🔍 " + label);
    await new Promise(r => setTimeout(r, 1500));

    if (!faceModelsLoaded) { hideCamModal(); resolve(true); return; }

    const user = localStorage.getItem("user");
    let savedDesc;
    try {
      const r = await fetch("/face-descriptor/" + user);
      const d = await r.json();
      if (!d.descriptor || !d.descriptor.length) { hideCamModal(); resolve(true); return; }
      savedDesc = new Float32Array(d.descriptor);
    } catch { hideCamModal(); resolve(true); return; }

    let attempts = 0;
    const tryDetect = async () => {
      if (!document.getElementById("video-modal").srcObject) { resolve(false); return; }
      attempts++;
      document.getElementById("camera-status").innerText = `Mendeteksi... (${attempts}/10)`;
      const cur = await getFaceDescriptor(document.getElementById("video-modal"));
      if (cur) {
        const d = faceapi.euclideanDistance(savedDesc, cur);
        hideCamModal();
        verifyResolve = null;
        if (d <= 0.55) { resolve(true); }
        else { showToast("❌ Wajah tidak dikenali! Coba lagi.", "error"); resolve(false); }
      } else if (attempts < 10) {
        setTimeout(tryDetect, 800);
      } else {
        hideCamModal(); verifyResolve = null;
        showToast("❌ Wajah tidak terdeteksi! Pastikan pencahayaan cukup.", "error");
        resolve(false);
      }
    };
    setTimeout(tryDetect, 800);
  });
}

// ============================================================
// ABSENSI
// ============================================================
async function sendAbsen(type, label) {
  const user = localStorage.getItem("user");
  if (!user) return checkLoginStatus();
  const ok = await verifyFace(label);
  if (!ok) return;
  const photo = takePhoto();
  const loc   = await getLoc();
  try {
    const r = await fetch("/absen", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({user, type, time:new Date().toISOString(), lat:loc.lat, lng:loc.lng, photo}) });
    const d = await r.json();
    if (d.status === "OK") {
      const msgs = {IN:"✅ Clock In berhasil!",OUT:"👋 Clock Out berhasil!",BREAK_START:"☕ Selamat istirahat!",BREAK_END:"💪 Lanjut kerja!"};
      showToast(msgs[type] || "✅ Berhasil!");
      loadStatus(); loadTodayDetail();
    } else if (d.status === "OUT_OF_AREA") {
      showToast(`❌ Di luar area kantor (${d.distance}m dari ${d.area||"kantor"})`, "error");
    } else if (d.status === "ALREADY_IN") {
      showToast("⚠️ Sudah Clock In hari ini", "warning"); loadStatus();
    }
  } catch { showToast("❌ Terjadi kesalahan teknis", "error"); }
}

function clockIn()    { sendAbsen("IN",          "Clock In"); }
function clockOut()   { sendAbsen("OUT",         "Clock Out"); }
function breakStart() { sendAbsen("BREAK_START", "Istirahat"); }
function breakEnd()   { sendAbsen("BREAK_END",   "Lanjut Kerja"); }

async function loadStatus() {
  const user = localStorage.getItem("user");
  if (!user) return;
  try {
    const r = await fetch("/status/" + user);
    const d = await r.json();
    updateBtns(d.status);
  } catch { updateBtns("OUT"); }
}

function updateBtns(status) {
  const el   = document.getElementById("statusText");
  const bIn  = document.getElementById("btn-in");
  const bOut = document.getElementById("btn-out");
  const bBS  = document.getElementById("btn-bs");
  const bBE  = document.getElementById("btn-be");
  [bIn,bOut,bBS,bBE].forEach(b => b.classList.add("hidden"));
  if (status === "IN") {
    el.innerHTML = '<span class="status-dot" style="background:#27ae60"></span> Sedang Bekerja';
    el.style.background="#e8f5e9"; el.style.color="#27ae60";
    bBS.classList.remove("hidden"); bOut.classList.remove("hidden");
  } else if (status === "BREAK") {
    el.innerHTML = '<span class="status-dot" style="background:#f39c12"></span> Sedang Istirahat';
    el.style.background="#fff3e0"; el.style.color="#f39c12";
    bBE.classList.remove("hidden");
  } else {
    el.innerHTML = '<span class="status-dot" style="background:#95a5a6"></span> Belum Absen';
    el.style.background="#f0f2f5"; el.style.color="#95a5a6";
    bIn.classList.remove("hidden");
  }
}

async function loadTodayDetail() {
  const user  = localStorage.getItem("user");
  const today = new Date().toISOString().split("T")[0];
  try {
    const r = await fetch("/history/" + user);
    const d = await r.json();
    const rec = d.find(x => x.date === today);
    if (rec) {
      document.getElementById("t-in").innerText  = rec.jamMasuk  ? fmt(rec.jamMasuk)  : "--:--";
      document.getElementById("t-out").innerText = rec.jamKeluar ? fmt(rec.jamKeluar) : "--:--";
      if (rec.jamMasuk && rec.jamKeluar)
        document.getElementById("t-dur").innerText = ((new Date(rec.jamKeluar)-new Date(rec.jamMasuk))/3600000).toFixed(1)+"j";
    }
  } catch {}
}

async function getLoc() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({lat:0,lng:0});
    navigator.geolocation.getCurrentPosition(
      p => resolve({lat:p.coords.latitude,lng:p.coords.longitude}),
      () => resolve({lat:0,lng:0}), {enableHighAccuracy:true,timeout:8000}
    );
  });
}

function fmt(iso) {
  return new Date(iso).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});
}

// ============================================================
// REKAP
// ============================================================
async function loadRekap() {
  const user = localStorage.getItem("user");
  try {
    const [rr, hr] = await Promise.all([fetch("/report/"+user), fetch("/history/"+user)]);
    const rep = await rr.json(), his = await hr.json();
    document.getElementById("r-kerja").innerText = rep.totalKerja||"0h";
    document.getElementById("r-break").innerText = rep.totalBreak||"0h";
    document.getElementById("r-over").innerText  = rep.overtime||"0h";
    const list = document.getElementById("history-list");
    if (!his.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada data</p>'; return; }
    list.innerHTML = his.map(d => {
      const masuk  = d.jamMasuk  ? fmt(d.jamMasuk)  : "--:--";
      const keluar = d.jamKeluar ? fmt(d.jamKeluar) : "--:--";
      const dur    = d.jamMasuk && d.jamKeluar ? ((new Date(d.jamKeluar)-new Date(d.jamMasuk))/3600000).toFixed(1)+"j" : "-";
      const late   = d.jamMasuk && new Date(d.jamMasuk).getHours() >= 9;
      return `<div class="history-item">
        <div><div class="h-date">${d.date}</div><div class="h-time">Masuk: ${masuk} · Keluar: ${keluar} · ${dur}</div></div>
        <span class="h-badge ${late?'late':'ok'}">${late?'⚠️ Terlambat':'✅ Tepat'}</span>
      </div>`;
    }).join("");
  } catch {}
}

// ============================================================
// ADMIN
// ============================================================
async function loadAdmin() {
  const date   = document.getElementById("adm-date").value || new Date().toISOString().split("T")[0];
  const search = (document.getElementById("adm-search").value||"").toLowerCase();
  try {
    const r = await fetch("/admin/today?date="+date);
    const d = await r.json();
    document.getElementById("adm-total").innerText = d.totalUsers;
    document.getElementById("adm-hadir").innerText = d.records.filter(x=>x.status!=="OUT").length;
    const filtered = d.records.filter(x=>x.user.toLowerCase().includes(search));
    const list = document.getElementById("admin-list");
    if (!filtered.length) { list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }
    const sc = {IN:"in",BREAK:"break",OUT:"out",DONE:"out"};
    const sl = {IN:"Bekerja",BREAK:"Istirahat",OUT:"Belum Absen",DONE:"Selesai"};
    list.innerHTML = filtered.map(x => `
      <div class="emp-item">
        <div><div class="emp-name">👤 ${x.user}</div>
        <div class="emp-time">Masuk: ${x.jamMasuk?fmt(x.jamMasuk):"--:--"} · Keluar: ${x.jamKeluar?fmt(x.jamKeluar):"--:--"}</div></div>
        <span class="emp-badge ${sc[x.status]||'out'}">${sl[x.status]||x.status}</span>
      </div>`).join("");
  } catch {}
}

// ============================================================
// ANGGOTA (daftar + group)
// ============================================================
function switchAnggotaTab(tab) {
  const isDaftar = tab === "daftar";
  document.getElementById("panel-daftar").classList.toggle("hidden", !isDaftar);
  document.getElementById("panel-group").classList.toggle("hidden", isDaftar);
  document.getElementById("tab-daftar").style.background = isDaftar ? "var(--primary)" : "white";
  document.getElementById("tab-daftar").style.color      = isDaftar ? "white" : "var(--muted)";
  document.getElementById("tab-group").style.background  = isDaftar ? "white" : "var(--primary)";
  document.getElementById("tab-group").style.color       = isDaftar ? "var(--muted)" : "white";
}

async function loadAnggota() {
  try {
    const r = await fetch("/anggota");
    const d = await r.json();
    const groups = await (await fetch("/groups")).json();
    const list   = document.getElementById("member-list");
    if (!d.length) { list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada anggota</p>'; return; }
    list.innerHTML = d.map(m => {
      const gOpts = groups.map(g =>
        `<option value="${g.id}" ${g.id===m.group?'selected':''}>${g.name}</option>`
      ).join("");
      return `<div class="member-item">
        <div style="display:flex;align-items:center;">
          <div class="avatar" style="background:${m.groupColor||'#7f8c8d'};">${m.username[0].toUpperCase()}</div>
          <div><div class="m-name">${m.username}</div>
          <div class="m-role" style="color:${m.groupColor||'#7f8c8d'};">● ${m.groupName}</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <select onchange="changeGroup('${m.username}',this.value)"
            style="padding:5px 8px;border:1px solid #e8ecf0;border-radius:8px;font-size:12px;outline:none;">
            ${gOpts}
          </select>
          ${m.username !== localStorage.getItem("user") && userLevel <= 2
            ? `<button onclick="deleteAnggota('${m.username}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>`
            : ""}
        </div>
      </div>`;
    }).join("");
  } catch { document.getElementById("member-list").innerHTML='<p style="color:var(--muted);text-align:center;">Gagal memuat</p>'; }
}

async function changeGroup(username, groupId) {
  try {
    const r = await fetch(`/anggota/${username}/group`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({group:groupId}) });
    const d = await r.json();
    if (d.status === "OK") { showToast("✅ Jabatan berhasil diubah!"); loadAnggota(); }
    else showToast("❌ Gagal mengubah jabatan", "error");
  } catch { showToast("❌ Gagal", "error"); }
}

async function deleteAnggota(username) {
  if (!confirm(`Hapus anggota "${username}"? Data absensi akan tetap tersimpan.`)) return;
  try {
    const r = await fetch(`/anggota/${username}`, { method:"DELETE" });
    if ((await r.json()).status === "OK") { showToast("🗑 Anggota dihapus"); loadAnggota(); }
  } catch { showToast("❌ Gagal menghapus", "error"); }
}

// ============================================================
// GROUP & AKSES MENU
// ============================================================
const ALL_MENUS = [
  { key:"home",       label:"🏠 Beranda" },
  { key:"rekap",      label:"📋 Rekap" },
  { key:"admin",      label:"👑 Admin Panel" },
  { key:"setting",    label:"⚙️ Pengaturan" },
  { key:"anggota",    label:"👥 Anggota" },
  { key:"area",       label:"📍 Area Kantor" },
  { key:"libur",      label:"📅 Hari Libur & Cuti" },
  { key:"aktivitas",  label:"📌 Aktivitas" },
  { key:"timesheet",  label:"🕐 Timesheet" },
];

async function loadGroups() {
  try {
    const r = await fetch("/groups");
    const groups = await r.json();
    const list   = document.getElementById("group-list");
    list.innerHTML = groups.map(g => {
      const isOwner   = g.id === "owner";
      const menuRows  = ALL_MENUS.map(m => {
        const checked = g.menus.includes(m.key);
        const disabled = isOwner || m.key === "home"; // home selalu aktif
        return `<div class="menu-toggle-row">
          <span class="menu-toggle-label">${m.label}</span>
          <label class="toggle-switch">
            <input type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''}
              onchange="toggleGroupMenu('${g.id}','${m.key}',this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>`;
      }).join("");
      return `<div class="group-item">
        <div class="group-header" style="background:${g.color};" onclick="toggleGroupBody('gbody-${g.id}')">
          <div>
            <div class="group-title">${g.name} ${isOwner?'👑':''}</div>
            <div class="group-level">Level ${g.level} · ${g.menus.length} menu aktif</div>
          </div>
          <span style="color:rgba(255,255,255,.7);font-size:20px;">›</span>
        </div>
        <div class="group-body" id="gbody-${g.id}">
          ${isOwner ? '<p style="font-size:12px;color:var(--muted);margin-bottom:8px;">Owner selalu memiliki akses penuh ke semua menu.</p>' : ''}
          ${menuRows}
        </div>
      </div>`;
    }).join("");
  } catch { document.getElementById("group-list").innerHTML='<p style="color:var(--muted);text-align:center;">Gagal memuat</p>'; }
}

function toggleGroupBody(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("open");
}

async function toggleGroupMenu(groupId, menuKey, enabled) {
  try {
    // Ambil group terbaru, ubah menu, simpan
    const r = await fetch("/groups");
    const groups = await r.json();
    const group  = groups.find(g => g.id === groupId);
    if (!group) return;
    if (enabled && !group.menus.includes(menuKey)) group.menus.push(menuKey);
    if (!enabled) group.menus = group.menus.filter(m => m !== menuKey);
    // Pastikan home selalu ada
    if (!group.menus.includes("home")) group.menus.push("home");
    const rr = await fetch(`/groups/${groupId}/menus`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({menus:group.menus}) });
    const dd = await rr.json();
    if (dd.status === "OK") showToast("✅ Akses diperbarui");
    else if (dd.status === "PROTECTED") showToast("⚠️ Owner tidak bisa diubah", "warning");
    loadGroups();
  } catch { showToast("❌ Gagal memperbarui", "error"); }
}

// ============================================================
// AREA
// ============================================================
async function loadAreas() {
  try {
    const r    = await fetch("/areas");
    const data = await r.json();
    const list = document.getElementById("area-list");
    if (!data.length) { list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada area</p>'; return; }
    list.innerHTML = data.map(a => `
      <div class="area-item">
        <div>
          <div class="area-name">📍 ${a.name}</div>
          <div class="area-detail">Radius: ${a.radius}m · ${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="area-active ${a.active?'on':'off'}" onclick="toggleArea('${a.id}',${!a.active})" style="cursor:pointer;">
            ${a.active?'✅ Aktif':'❌ Nonaktif'}
          </span>
          <button onclick="deleteArea('${a.id}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>
        </div>
      </div>`).join("");
  } catch {}
}

function getMyLoc() {
  navigator.geolocation.getCurrentPosition(p => {
    document.getElementById("area-lat").value = p.coords.latitude.toFixed(7);
    document.getElementById("area-lng").value = p.coords.longitude.toFixed(7);
    showToast("📍 Lokasi berhasil diambil!");
  }, null, {enableHighAccuracy:true});
}

async function saveArea() {
  const name   = document.getElementById("area-name").value.trim();
  const lat    = document.getElementById("area-lat").value;
  const lng    = document.getElementById("area-lng").value;
  const radius = document.getElementById("area-radius").value;
  if (!name || !lat || !lng) return showToast("⚠️ Isi semua field!", "warning");
  try {
    const r = await fetch("/areas", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,lat,lng,radius}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Area berhasil ditambahkan!");
      document.getElementById("area-name").value = "";
      document.getElementById("area-lat").value  = "";
      document.getElementById("area-lng").value  = "";
      loadAreas();
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function toggleArea(id, active) {
  try {
    await fetch(`/areas/${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({active}) });
    showToast(active ? "✅ Area diaktifkan" : "❌ Area dinonaktifkan");
    loadAreas();
  } catch {}
}

async function deleteArea(id) {
  if (!confirm("Hapus area ini?")) return;
  try {
    const r = await fetch(`/areas/${id}`, {method:"DELETE"});
    if ((await r.json()).status === "OK") { showToast("🗑 Area dihapus"); loadAreas(); }
  } catch { showToast("❌ Gagal menghapus", "error"); }
}

// ============================================================
// HARI LIBUR & CUTI
// ============================================================
async function loadLibur() {
  try {
    const r = await fetch("/libur");
    const d = await r.json();
    const list = document.getElementById("libur-list");
    if (!d.length) { list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada data</p>'; return; }
    list.innerHTML = d.sort((a,b)=>a.date.localeCompare(b.date)).map(x => `
      <div class="holiday-item">
        <div><div class="h-date-text">${x.date}</div><div class="h-name">${x.name}</div></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="h-type ${x.type}">${x.type==='nasional'?'🔴 Nasional':'🟢 Cuti'}</span>
          <button onclick="deleteLibur('${x.id}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>
        </div>
      </div>`).join("");
  } catch {}
}

async function saveLibur() {
  const date = document.getElementById("libur-date").value;
  const name = document.getElementById("libur-name").value.trim();
  const type = document.getElementById("libur-type").value;
  if (!date || !name) return showToast("⚠️ Isi tanggal dan nama!", "warning");
  try {
    const r = await fetch("/libur", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date,name,type}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Berhasil ditambahkan!");
      document.getElementById("libur-date").value = "";
      document.getElementById("libur-name").value = "";
      loadLibur();
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function deleteLibur(id) {
  if (!confirm("Hapus data ini?")) return;
  try {
    const r = await fetch(`/libur/${id}`, {method:"DELETE"});
    if ((await r.json()).status === "OK") { showToast("🗑 Berhasil dihapus"); loadLibur(); }
  } catch {}
}

// ============================================================
// AKTIVITAS
// ============================================================
async function loadAktivitas() {
  try {
    const r = await fetch("/aktivitas");
    const d = await r.json();
    const list = document.getElementById("aktivitas-list");
    if (!d.length) { list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada aktivitas</p>'; return; }
    const icons  = {IN:"🟢",OUT:"🔴",BREAK_START:"☕",BREAK_END:"💪"};
    const labels = {IN:"Clock In",OUT:"Clock Out",BREAK_START:"Mulai Istirahat",BREAK_END:"Selesai Istirahat"};
    list.innerHTML = d.map(a => `
      <div class="act-item">
        <div class="act-user">${icons[a.type]||"📌"} ${a.user}</div>
        <div class="act-desc">${labels[a.type]||a.type}</div>
        <div class="act-time">${new Date(a.time).toLocaleString("id-ID")}</div>
      </div>`).join("");
  } catch {}
}

// ============================================================
// TIMESHEET
// ============================================================
async function loadTimesheet() {
  const month  = document.getElementById("ts-month").value;
  const search = (document.getElementById("ts-search").value||"").toLowerCase();
  if (!month) return;
  try {
    const r = await fetch("/timesheet?month="+month);
    const d = await r.json();
    const filtered = d.filter(x => x.user.toLowerCase().includes(search));
    const el = document.getElementById("ts-content");
    if (!filtered.length) { el.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }
    el.innerHTML = `<table class="ts-table">
      <thead><tr><th>Nama</th><th>Hari</th><th>Jam Kerja</th><th>Lembur</th></tr></thead>
      <tbody>${filtered.map(x=>`
        <tr>
          <td><b>${x.user}</b></td>
          <td>${x.totalDays}</td>
          <td>${x.totalJam}j</td>
          <td style="color:${parseFloat(x.overtime)>0?'var(--warning)':'var(--muted)'};">${x.overtime}j</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  } catch {}
}

// ============================================================
// INIT
// ============================================================
window.onload = async function () {
  await loadFaceModels();
  checkLoginStatus();
};
