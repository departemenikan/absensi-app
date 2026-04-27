// ============================================================
// GLOBAL STATE
// ============================================================
let pendingAction    = null;
let verifyStream     = null;
let verifyInterval   = null;
let faceModelsLoaded = false;
let storedDescriptor = null;
let userMenus        = [];
let userRole         = "";
let userLevel        = 99;

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.className = "";
  if (type === "error")   t.classList.add("error");
  if (type === "warning") t.classList.add("warning");
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ============================================================
// FACE-API MODELS
// ============================================================
async function loadFaceModels() {
  try {
    const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    faceModelsLoaded = true;
    const el = document.getElementById("faceStatus");
    if (el) el.innerText = "✅ Model siap";
  } catch (e) {
    const el = document.getElementById("faceStatus");
    if (el) el.innerText = "❌ Gagal memuat model: " + e.message;
  }
}

async function getFaceDescriptor(videoEl) {
  const det = await faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return det ? det.descriptor : null;
}

function euclideanDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// ============================================================
// CAMERA HELPERS
// ============================================================
async function startCam(videoId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 320 } });
    document.getElementById(videoId).srcObject = stream;
    return stream;
  } catch (e) {
    showToast("❌ Kamera gagal diakses: " + e.message, "error");
    return null;
  }
}

function stopCam(videoId) {
  const v = document.getElementById(videoId);
  if (v && v.srcObject) {
    v.srcObject.getTracks().forEach(t => t.stop());
    v.srcObject = null;
  }
}

// ============================================================
// AUTH
// ============================================================
function showAuthPage() {
  document.getElementById("auth-page").classList.remove("hidden");
  document.getElementById("main-nav").classList.add("hidden");
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
}

function toggleAuthMode() {
  const title    = document.getElementById("auth-title");
  const toggle   = document.getElementById("auth-toggle-text");
  const mainBtn  = document.getElementById("btn-auth-main");
  const faceSect = document.getElementById("face-signup-section");
  const isLogin  = title.innerText === "Login";

  if (isLogin) {
    title.innerText    = "Sign Up";
    mainBtn.innerText  = "Sign Up";
    toggle.innerHTML   = 'Sudah punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Login</a>';
    faceSect.classList.remove("hidden");
    startCam("video-signup");
  } else {
    title.innerText    = "Login";
    mainBtn.innerText  = "Login";
    toggle.innerHTML   = 'Belum punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Sign Up</a>';
    faceSect.classList.add("hidden");
    stopCam("video-signup");
  }
}

function handleAuth() {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();
  if (!u || !p) return showToast("⚠️ Isi username & password", "warning");
  const isSignup = document.getElementById("auth-title").innerText === "Sign Up";
  if (isSignup) doSignUp(u, p); else doLogin(u, p);
}

async function doSignUp(u, p) {
  if (!faceModelsLoaded) return showToast("⏳ Model wajah belum siap", "warning");
  const fullName = document.getElementById("fullName").value.trim();
  const religion = document.getElementById("religion").value;
  if (!fullName) return showToast("⚠️ Isi Nama Lengkap", "warning");
  if (!religion) return showToast("⚠️ Pilih Agama", "warning");

  const btn = document.getElementById("btn-auth-main");
  btn.innerText = "⏳ Scanning..."; btn.disabled = true;
  try {
    const videoEl    = document.getElementById("video-signup");
    const descriptor = await getFaceDescriptor(videoEl);
    if (!descriptor) {
      showToast("❌ Wajah tidak terdeteksi! Pencahayaan kurang?", "error");
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }
    // Snapshot foto wajah
    const c = document.getElementById("canvas");
    c.width = videoEl.videoWidth; c.height = videoEl.videoHeight;
    c.getContext("2d").drawImage(videoEl, 0, 0);
    const facePhoto = c.toDataURL("image/jpeg", 0.6);

    const r = await fetch("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: u, password: p,
        fullName, religion,
        faceDescriptor: Array.from(descriptor),
        facePhoto
      })
    });
    const d = await r.json();
    if (d.status === "OK") {
      stopCam("video-signup");
      showToast("✅ Akun berhasil dibuat! Silakan login");
      setTimeout(() => toggleAuthMode(), 1500);
    } else if (d.status === "EXIST") {
      showToast("⚠️ Username sudah terdaftar!", "warning");
    } else {
      showToast("❌ " + (d.msg || "Gagal membuat akun"), "error");
    }
  } catch (e) {
    showToast("❌ Error: " + e.message, "error");
  }
  btn.innerText = "Sign Up"; btn.disabled = false;
}

async function doLogin(u, p) {
  try {
    const r = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    const d = await r.json();
    if (d.status === "OK") {
      localStorage.setItem("user", u);
      localStorage.setItem("menus", JSON.stringify(d.menus || []));
      localStorage.setItem("role", d.role || "anggota");
      localStorage.setItem("level", d.level || 99);
      enterApp(d.menus || [], d.role, d.level);
    } else {
      showToast("❌ Username atau password salah!", "error");
    }
  } catch {
    showToast("❌ Gagal terhubung ke server", "error");
  }
}

async function checkLoginStatus() {
  const u = localStorage.getItem("user");
  if (!u) { showAuthPage(); return; }
  try {
    const r = await fetch("/check-user/" + u);
    const d = await r.json();
    if (d.valid) {
      localStorage.setItem("menus", JSON.stringify(d.menus || []));
      localStorage.setItem("role", d.role || "anggota");
      localStorage.setItem("level", d.level || 99);
      enterApp(d.menus || [], d.role, d.level);
    } else {
      localStorage.clear();
      showAuthPage();
    }
  } catch {
    localStorage.clear();
    showAuthPage();
  }
}

function enterApp(menus, role, level) {
  userMenus = menus || [];
  userRole  = role  || "anggota";
  userLevel = level || 99;

  document.getElementById("auth-page").classList.add("hidden");
  document.getElementById("main-nav").classList.remove("hidden");
  stopCam("video-signup");

  document.getElementById("nav-admin").classList.toggle("hidden",   !userMenus.includes("admin"));
  document.getElementById("nav-setting").classList.toggle("hidden", !userMenus.includes("setting"));

  applyMenuAccess();

  document.getElementById("hdr-user").innerText = localStorage.getItem("user") || "";
  document.getElementById("hdr-date").innerText = new Date().toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  document.getElementById("rekap-user-label").innerText = localStorage.getItem("user") || "";

  navTo("home");
  loadStatus();
  loadTodayDetail();

  const ad = document.getElementById("adm-date");
  if (ad) ad.value = new Date().toISOString().split("T")[0];
}

function applyMenuAccess() {
  const map = {
    "menu-profil":    "profil",
    "menu-anggota":   "anggota",
    "menu-area":      "area",
    "menu-libur":     "libur",
    "menu-aktivitas": "aktivitas",
    "menu-timesheet": "timesheet",
  };
  Object.entries(map).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle("hidden", !userMenus.includes(key));
  });
}

function logout() {
  localStorage.clear();
  location.reload();
}

// ============================================================
// NAVIGATION
// ============================================================
function navTo(page) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const nav = document.getElementById("nav-" + page);
  if (nav) nav.classList.add("active");
  openView("view-" + page);
}

function openView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const el = document.getElementById(viewId);
  if (el) el.classList.add("active");
  window.scrollTo(0, 0);

  if (viewId === "view-rekap")     { loadRekap(); }
  if (viewId === "view-admin")     { loadAdmin(); }
  if (viewId === "view-aktivitas") { loadAktivitas(); }
  if (viewId === "view-area")      { loadAreas(); }
  if (viewId === "view-libur")     { loadLibur(); }
  if (viewId === "view-anggota")   { loadAnggota(); }
  if (viewId === "view-profil")    { loadProfil(); }
  if (viewId === "view-timesheet") {
    const m = document.getElementById("ts-month");
    if (!m.value) m.value = new Date().toISOString().slice(0, 7);
    loadTimesheet();
  }
}

// ============================================================
// STATUS & REPORT (HOME)
// ============================================================
async function loadStatus() {
  const u = localStorage.getItem("user");
  if (!u) return;
  try {
    const r = await fetch("/status/" + u);
    const d = await r.json();
    const t = document.getElementById("statusText");
    const btnIn = document.getElementById("btn-in");
    const btnBs = document.getElementById("btn-bs");
    const btnBe = document.getElementById("btn-be");
    const btnOut= document.getElementById("btn-out");

    btnIn.classList.add("hidden"); btnBs.classList.add("hidden");
    btnBe.classList.add("hidden"); btnOut.classList.add("hidden");

    if (d.status === "OUT") {
      t.innerHTML = '<span class="status-dot"></span> Belum Clock In';
      t.style.color = "#95a5a6";
      btnIn.classList.remove("hidden");
    } else if (d.status === "IN") {
      t.innerHTML = '<span class="status-dot" style="background:#27ae60;"></span> Sedang Bekerja';
      t.style.color = "#27ae60";
      btnBs.classList.remove("hidden");
      btnOut.classList.remove("hidden");
    } else if (d.status === "BREAK") {
      t.innerHTML = '<span class="status-dot" style="background:#f39c12;"></span> Istirahat';
      t.style.color = "#f39c12";
      btnBe.classList.remove("hidden");
      btnOut.classList.remove("hidden");
    }
  } catch {}
}

async function loadTodayDetail() {
  const u = localStorage.getItem("user");
  if (!u) return;
  try {
    const r = await fetch("/history/" + u);
    const d = await r.json();
    const today = new Date().toISOString().split("T")[0];
    const t = d.find(x => x.date === today);
    const fmt = (x) => x ? new Date(x).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "--:--";
    document.getElementById("t-in").innerText  = fmt(t?.jamMasuk);
    document.getElementById("t-out").innerText = fmt(t?.jamKeluar);
    if (t && t.jamMasuk) {
      const end = t.jamKeluar ? new Date(t.jamKeluar) : new Date();
      let ms = end - new Date(t.jamMasuk);
      t.breaks.forEach(b => {
        if (b.end) ms -= (new Date(b.end) - new Date(b.start));
        else if (!t.jamKeluar) ms -= (new Date() - new Date(b.start));
      });
      const h = Math.max(0, ms / 3600000).toFixed(1);
      document.getElementById("t-dur").innerText = h + "j";
    } else {
      document.getElementById("t-dur").innerText = "0j";
    }
  } catch {}
}

// ============================================================
// REKAP
// ============================================================
async function loadRekap() {
  const u = localStorage.getItem("user");
  if (!u) return;
  try {
    const r1 = await fetch("/report/" + u); const rep = await r1.json();
    document.getElementById("r-kerja").innerText = rep.totalKerja;
    document.getElementById("r-break").innerText = rep.totalBreak;
    document.getElementById("r-over").innerText  = rep.overtime;

    const r2 = await fetch("/history/" + u); const hist = await r2.json();
    const el = document.getElementById("history-list");
    if (!hist.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada riwayat</p>'; return; }
    el.innerHTML = hist.map(h => {
      const tgl = new Date(h.date).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
      const masuk  = h.jamMasuk  ? new Date(h.jamMasuk).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "--";
      const keluar = h.jamKeluar ? new Date(h.jamKeluar).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "--";
      const late = h.jamMasuk && new Date(h.jamMasuk).getHours() >= 9 && new Date(h.jamMasuk).getMinutes() > 0;
      return `<div class="history-item">
        <div><div class="h-date">${tgl}</div><div class="h-time">${masuk} - ${keluar}</div></div>
        <span class="h-badge ${late?'late':'ok'}">${late?'⚠ Telat':'✓ OK'}</span>
      </div>`;
    }).join("");
  } catch {}
}

// ============================================================
// CLOCK IN / OUT + FACE VERIFY
// ============================================================
function clockIn()     { pendingAction = "IN";          openVerify("Clock In"); }
function clockOut()    { pendingAction = "OUT";         openVerify("Clock Out"); }
function breakStart()  { pendingAction = "BREAK_START"; openVerify("Istirahat"); }
function breakEnd()    { pendingAction = "BREAK_END";   openVerify("Lanjut Kerja"); }

async function openVerify(title) {
  if (!faceModelsLoaded) return showToast("⏳ Model wajah belum siap", "warning");
  document.getElementById("cam-modal-title").innerText = "Verifikasi: " + title;
  document.getElementById("camera-modal").classList.remove("hidden");
  document.getElementById("camera-status").innerText = "Memuat kamera...";
  verifyStream = await startCam("video-modal");
  if (!verifyStream) { cancelVerify(); return; }

  const u = localStorage.getItem("user");
  try {
    const r = await fetch("/face-descriptor/" + u);
    const d = await r.json();
    storedDescriptor = d.descriptor && d.descriptor.length ? d.descriptor : null;
  } catch {}

  if (!storedDescriptor) {
    showToast("⚠️ Data wajah belum terdaftar — absen tanpa verifikasi", "warning");
    setTimeout(() => { doAbsen(); cancelVerify(); }, 800);
    return;
  }

  document.getElementById("camera-status").innerText = "Mendeteksi wajah...";
  verifyInterval = setInterval(verifyFace, 700);
}

async function verifyFace() {
  const v = document.getElementById("video-modal");
  if (!v || !v.videoWidth) return;
  const desc = await getFaceDescriptor(v);
  if (!desc) return;
  const d = euclideanDist(Array.from(desc), storedDescriptor);
  const status = document.getElementById("camera-status");
  if (d < 0.55) {
    clearInterval(verifyInterval); verifyInterval = null;
    status.innerText = "✅ Wajah cocok!";
    status.classList.remove("scanning");
    setTimeout(() => { doAbsen(); cancelVerify(); }, 400);
  } else {
    status.innerText = "Wajah tidak cocok, coba lagi... (" + d.toFixed(2) + ")";
  }
}

function cancelVerify() {
  if (verifyInterval) { clearInterval(verifyInterval); verifyInterval = null; }
  stopCam("video-modal");
  document.getElementById("camera-modal").classList.add("hidden");
  document.getElementById("camera-status").classList.add("scanning");
}

async function doAbsen() {
  const u = localStorage.getItem("user");
  const type = pendingAction;
  const v = document.getElementById("video-modal");
  let photo = "";
  if (v && v.videoWidth) {
    const c = document.getElementById("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    photo = c.toDataURL("image/jpeg", 0.5);
  }
  let lat = 0, lng = 0;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
    lat = pos.coords.latitude; lng = pos.coords.longitude;
  } catch {}
  try {
    const r = await fetch("/absen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: u, type, time: new Date().toISOString(), lat, lng, photo })
    });
    const d = await r.json();
    if (r.status === 400 && d.status === "OUT_OF_AREA") {
      showToast(`❌ Di luar area (${d.area} • ${d.distance}m)`, "error");
    } else if (d.status === "ALREADY_IN") {
      showToast("⚠️ Anda sudah Clock In hari ini", "warning");
    } else if (d.status === "OK") {
      const label = { IN:"Clock In", OUT:"Clock Out", BREAK_START:"Istirahat", BREAK_END:"Lanjut Kerja" }[type];
      showToast("✅ " + label + " berhasil!");
      loadStatus(); loadTodayDetail();
    }
  } catch { showToast("❌ Gagal kirim absen", "error"); }
}
// ============================================================
// ADMIN
// ============================================================
async function loadAdmin() {
  const date = document.getElementById("adm-date").value || new Date().toISOString().split("T")[0];
  const search = (document.getElementById("adm-search").value || "").toLowerCase();
  try {
    const r = await fetch("/admin/today?date=" + date);
    const d = await r.json();
    document.getElementById("adm-total").innerText = d.totalUsers;
    const hadir = d.records.filter(x => x.status !== "OUT").length;
    document.getElementById("adm-hadir").innerText = hadir;

    const filtered = d.records.filter(x => x.user.toLowerCase().includes(search));
    const el = document.getElementById("admin-list");
    if (!filtered.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }
    el.innerHTML = filtered.map(x => {
      const badge = {
        IN:    '<span class="emp-badge in">🟢 Hadir</span>',
        BREAK: '<span class="emp-badge break">☕ Istirahat</span>',
        DONE:  '<span class="emp-badge out">✓ Selesai</span>',
        OUT:   '<span class="emp-badge out">— Belum</span>'
      }[x.status];
      const jm = x.jamMasuk  ? new Date(x.jamMasuk).toLocaleTimeString("id-ID", { hour:"2-digit", minute:"2-digit" }) : "--";
      const jk = x.jamKeluar ? new Date(x.jamKeluar).toLocaleTimeString("id-ID", { hour:"2-digit", minute:"2-digit" }) : "--";
      return `<div class="emp-item">
        <div><div class="emp-name">${x.user}</div><div class="emp-time">${jm} - ${jk}</div></div>
        ${badge}
      </div>`;
    }).join("");
  } catch {}
}

// ============================================================
// ANGGOTA (tab Daftar + tab Group/Role)
// ============================================================
let _anggotaCache = [];

function switchAnggotaTab(tab) {
  const td = document.getElementById("tab-daftar");
  const tg = document.getElementById("tab-group");
  const pd = document.getElementById("panel-daftar");
  const pg = document.getElementById("panel-group");
  if (tab === "daftar") {
    td.style.background = "var(--primary)"; td.style.color = "white";
    tg.style.background = "white";          tg.style.color = "var(--muted)";
    pd.classList.remove("hidden"); pg.classList.add("hidden");
  } else {
    tg.style.background = "var(--primary)"; tg.style.color = "white";
    td.style.background = "white";          td.style.color = "var(--muted)";
    pg.classList.remove("hidden"); pd.classList.add("hidden");
    renderGroupRolePanel();
  }
}

async function loadAnggota() {
  try {
    const r = await fetch("/anggota");
    const d = await r.json();
    _anggotaCache = d;
    const list = document.getElementById("member-list");
    if (!d.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada anggota</p>'; return; }
    list.innerHTML = d.map(a => {
      const initial = (a.fullName || a.username || "?").charAt(0).toUpperCase();
      const photo = a.profilePhoto
        ? `<img src="${a.profilePhoto}">`
        : `<span>${initial}</span>`;
      return `<div class="member-item" onclick="openDetailAnggota('${a.username}')">
        <div style="display:flex;align-items:center;flex:1;">
          <div class="avatar" style="background:${a.roleColor};">${photo}</div>
          <div>
            <div class="m-name">${a.fullName || a.username}</div>
            <div class="m-role" style="color:${a.roleColor};">${a.roleName}${a.jabatan ? ' • '+a.jabatan : ''}</div>
          </div>
        </div>
        <span class="menu-arrow">›</span>
      </div>`;
    }).join("");
  } catch {}
}

// Tab Group — dipakai untuk ubah Role (Owner/Admin/Anggota) per anggota
function renderGroupRolePanel() {
  const el = document.getElementById("group-list");
  if (!_anggotaCache.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Memuat...</p>'; loadAnggota().then(renderGroupRolePanel); return; }
  el.innerHTML = _anggotaCache.map(a => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f2f5;gap:10px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:700;">${a.fullName || a.username}</div>
        <div style="font-size:11px;color:var(--muted);">@${a.username}</div>
      </div>
      <select onchange="changeUserRole('${a.username}', this.value)" style="padding:8px;border:2px solid #e8ecf0;border-radius:8px;font-size:12px;">
        <option value="owner"   ${a.role==='owner'  ?'selected':''}>Owner</option>
        <option value="admin"   ${a.role==='admin'  ?'selected':''}>Admin</option>
        <option value="anggota" ${a.role==='anggota'?'selected':''}>Anggota</option>
      </select>
    </div>
  `).join("");
}

async function changeUserRole(username, role) {
  if (!confirm(`Ubah peran ${username} menjadi ${role.toUpperCase()}?`)) { loadAnggota(); return; }
  try {
    const r = await fetch(`/anggota/${username}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role })
    });
    const d = await r.json();
    if (d.status === "OK") { showToast("✅ Peran diperbarui"); loadAnggota(); }
    else showToast("❌ Gagal ubah peran", "error");
  } catch { showToast("❌ Server error", "error"); }
}

// ============================================================
// DETAIL ANGGOTA (modal)
// ============================================================
let _daCurrentUser = null;

async function openDetailAnggota(username) {
  const me = localStorage.getItem("user");
  _daCurrentUser = username;
  try {
    const r = await fetch(`/profil/${username}?by=${encodeURIComponent(me)}`);
    const d = await r.json();

    document.getElementById("da-title").innerText = "Detail: " + (d.fullName || username);
    const initial = (d.fullName || username || "?").charAt(0).toUpperCase();
    document.getElementById("da-initial").innerText = initial;
    const img = document.getElementById("da-photo");
    if (d.profilePhoto) { img.src = d.profilePhoto; img.style.display = "block"; document.getElementById("da-initial").style.display = "none"; }
    else { img.style.display = "none"; document.getElementById("da-initial").style.display = "block"; }

    document.getElementById("da-fullname").value = d.fullName || "";
    document.getElementById("da-username").value = d.username;
    document.getElementById("da-religion").value = d.religion || "";
    document.getElementById("da-role").value     = d.role     || "anggota";
    document.getElementById("da-jabatan").value  = d.jabatan  || "";
    document.getElementById("da-lingkup").value  = d.lingkupKerja || "";

    // Gaji hanya Owner bisa lihat/isi
    if (d.canSeeGaji) {
      document.getElementById("da-gaji-wrap").style.display = "block";
      document.getElementById("da-gaji").value = d.nominalGaji || 0;
    } else {
      document.getElementById("da-gaji-wrap").style.display = "none";
    }

    // Role dropdown hanya bisa diubah Owner
    const canEditRole = userRole === "owner";
    document.getElementById("da-role").disabled = !canEditRole;

    // Tombol hapus: Owner/Admin, bukan diri sendiri, Admin tidak bisa hapus Owner
    const canDelete = (userRole === "owner" || userRole === "admin") && (username !== me) && !(d.role === "owner" && userRole !== "owner");
    document.getElementById("da-delete-btn").classList.toggle("hidden", !canDelete);

    // Non-owner/admin hanya bisa lihat (readonly)
    const canEdit = (userRole === "owner" || userRole === "admin");
    ["da-jabatan","da-lingkup","da-gaji"].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.readOnly = !canEdit; e.style.background = canEdit ? "white" : "#f8f9ff"; }
    });

    document.getElementById("detail-anggota-modal").classList.remove("hidden");
  } catch { showToast("❌ Gagal memuat detail", "error"); }
}

async function saveDetailAnggota() {
  if (!_daCurrentUser) return;
  const me = localStorage.getItem("user");
  const body = {
    by:           me,
    jabatan:      document.getElementById("da-jabatan").value.trim(),
    lingkupKerja: document.getElementById("da-lingkup").value.trim(),
  };
  if (userRole === "owner") {
    body.role        = document.getElementById("da-role").value;
    body.nominalGaji = parseInt(document.getElementById("da-gaji").value) || 0;
  }
  try {
    const r = await fetch(`/profil/${_daCurrentUser}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Detail anggota diperbarui");
      document.getElementById("detail-anggota-modal").classList.add("hidden");
      loadAnggota();
    } else showToast("❌ Gagal menyimpan", "error");
  } catch { showToast("❌ Server error", "error"); }
}

async function deleteAnggotaFromDetail() {
  if (!_daCurrentUser) return;
  if (!confirm(`⚠️ Yakin hapus anggota "${_daCurrentUser}"?`)) return;
  const me = localStorage.getItem("user");
  try {
    const r = await fetch(`/anggota/${_daCurrentUser}?by=${encodeURIComponent(me)}`, { method: "DELETE" });
    const d = await r.json();
    if (d.status === "SELF_NOT_ALLOWED") showToast("❌ Tidak bisa hapus diri sendiri", "error");
    else if (d.status === "FORBIDDEN")   showToast("❌ Tidak diizinkan", "error");
    else if (d.status === "OK") {
      showToast("🗑 Anggota dihapus");
      document.getElementById("detail-anggota-modal").classList.add("hidden");
      loadAnggota();
    } else showToast("❌ Gagal menghapus", "error");
  } catch { showToast("❌ Server error", "error"); }
}

// ============================================================
// PROFIL (Menu Setting → Profil)
// ============================================================
function switchProfilTab(tab) {
  const tp = document.getElementById("tab-profil");
  const tl = document.getElementById("tab-login");
  const pp = document.getElementById("panel-profil");
  const pl = document.getElementById("panel-login");
  if (tab === "profil") {
    tp.style.background = "var(--primary)"; tp.style.color = "white";
    tl.style.background = "white";          tl.style.color = "var(--muted)";
    pp.classList.remove("hidden"); pl.classList.add("hidden");
  } else {
    tl.style.background = "var(--primary)"; tl.style.color = "white";
    tp.style.background = "white";          tp.style.color = "var(--muted)";
    pl.classList.remove("hidden"); pp.classList.add("hidden");
  }
}

async function loadProfil() {
  const me = localStorage.getItem("user");
  try {
    const r = await fetch(`/profil/${me}?by=${encodeURIComponent(me)}`);
    const d = await r.json();

    // Foto profil
    const img = document.getElementById("prof-photo-img");
    const ini = document.getElementById("prof-photo-initial");
    if (d.profilePhoto) { img.src = d.profilePhoto; img.style.display = "block"; ini.style.display = "none"; }
    else { img.style.display = "none"; ini.style.display = "block"; ini.innerText = (d.fullName || d.username || "?").charAt(0).toUpperCase(); }
    img.dataset.pending = "";

    document.getElementById("prof-fullname").value = d.fullName || "";
    document.getElementById("prof-fullname").readOnly = true;
    document.getElementById("prof-fullname").style.background = "#f8f9ff";
    document.getElementById("btn-edit-name").classList.remove("hidden");
    document.getElementById("btn-save-name").classList.add("hidden");

    document.getElementById("prof-religion").value = d.religion || "";
    document.getElementById("prof-jabatan").value  = d.jabatan  || "";
    document.getElementById("prof-role").value     = d.roleName || "";
    document.getElementById("prof-group").value    = d.groupId  || "";
    document.getElementById("prof-lingkup").value  = d.lingkupKerja || "";

    if (d.canSeeGaji) {
      document.getElementById("gaji-wrap").style.display = "block";
      document.getElementById("prof-gaji").value = "Rp " + (d.nominalGaji || 0).toLocaleString("id-ID");
    } else {
      document.getElementById("gaji-wrap").style.display = "none";
    }

    document.getElementById("prof-username").value = d.username;
    document.getElementById("prof-password").value = d.password || "";
    document.getElementById("prof-password").type  = "password";

    const fImg = document.getElementById("face-photo-img");
    const fEmp = document.getElementById("face-photo-empty");
    if (d.facePhoto) { fImg.src = d.facePhoto; fImg.style.display = "block"; fEmp.style.display = "none"; }
    else { fImg.style.display = "none"; fEmp.style.display = "block"; }

    const canDelete = (userRole === "owner" || userRole === "admin");
    document.getElementById("delete-acc-wrap").style.display = canDelete ? "block" : "none";

    switchProfilTab("profil");
  } catch { showToast("❌ Gagal memuat profil", "error"); }
}

function onProfilePhotoPick(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById("prof-photo-img");
    const ini = document.getElementById("prof-photo-initial");
    img.src = e.target.result; img.style.display = "block"; ini.style.display = "none";
    img.dataset.pending = "1";
  };
  reader.readAsDataURL(file);
}

async function saveProfilePhoto() {
  const img = document.getElementById("prof-photo-img");
  if (!img.dataset.pending) return showToast("ℹ️ Belum ada foto baru dipilih", "warning");
  const me = localStorage.getItem("user");
  try {
    const r = await fetch(`/profil/${me}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ by: me, profilePhoto: img.src })
    });
    const d = await r.json();
    if (d.status === "OK") { showToast("✅ Foto profil tersimpan"); img.dataset.pending = ""; }
    else showToast("❌ Gagal menyimpan", "error");
  } catch { showToast("❌ Server error", "error"); }
}

function toggleEditName() {
  const inp = document.getElementById("prof-fullname");
  inp.readOnly = false; inp.style.background = "white"; inp.focus();
  document.getElementById("btn-edit-name").classList.add("hidden");
  document.getElementById("btn-save-name").classList.remove("hidden");
}

async function saveName() {
  const me = localStorage.getItem("user");
  const val = document.getElementById("prof-fullname").value.trim();
  if (!val) return showToast("⚠️ Nama tidak boleh kosong", "warning");
  try {
    const r = await fetch(`/profil/${me}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ by: me, fullName: val })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Nama diperbarui");
      document.getElementById("prof-fullname").readOnly = true;
      document.getElementById("prof-fullname").style.background = "#f8f9ff";
      document.getElementById("btn-edit-name").classList.remove("hidden");
      document.getElementById("btn-save-name").classList.add("hidden");
    } else showToast("❌ Gagal menyimpan", "error");
  } catch { showToast("❌ Server error", "error"); }
}

function togglePassShow() {
  const inp = document.getElementById("prof-password");
  inp.type = inp.type === "password" ? "text" : "password";
}

function openChangePass() {
  document.getElementById("new-pass").value = "";
  document.getElementById("new-pass2").value = "";
  document.getElementById("change-pass-modal").classList.remove("hidden");
}

async function savePassword() {
  const p1 = document.getElementById("new-pass").value;
  const p2 = document.getElementById("new-pass2").value;
  if (p1.length < 4) return showToast("⚠️ Min 4 karakter", "warning");
  if (p1 !== p2)     return showToast("⚠️ Konfirmasi tidak cocok", "warning");
  const me = localStorage.getItem("user");
  try {
    const r = await fetch(`/profil/${me}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ by: me, password: p1 })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Password diperbarui");
      document.getElementById("change-pass-modal").classList.add("hidden");
      document.getElementById("prof-password").value = p1;
    } else showToast("❌ Gagal", "error");
  } catch { showToast("❌ Server error", "error"); }
}

async function openUpdateFace() {
  document.getElementById("update-face-modal").classList.remove("hidden");
  await startCam("video-face-update");
}

function cancelUpdateFace() {
  stopCam("video-face-update");
  document.getElementById("update-face-modal").classList.add("hidden");
}

async function confirmUpdateFace() {
  if (!faceModelsLoaded) return showToast("⏳ Model wajah belum siap", "warning");
  const btn = document.getElementById("btn-confirm-face");
  btn.innerText = "⏳ Scan..."; btn.disabled = true;

  const v = document.getElementById("video-face-update");
  const desc = await getFaceDescriptor(v);
  if (!desc) {
    btn.innerText = "💾 Simpan"; btn.disabled = false;
    return showToast("❌ Wajah tidak terdeteksi", "error");
  }
  const c = document.getElementById("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  const photo = c.toDataURL("image/jpeg", 0.6);

  const me = localStorage.getItem("user");
  try {
    const r = await fetch(`/profil/${me}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ by: me, faceDescriptor: Array.from(desc), facePhoto: photo })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Data wajah diperbarui");
      const fImg = document.getElementById("face-photo-img");
      fImg.src = photo; fImg.style.display = "block";
      document.getElementById("face-photo-empty").style.display = "none";
      cancelUpdateFace();
    } else showToast("❌ Gagal", "error");
  } catch { showToast("❌ Server error", "error"); }
  btn.innerText = "💾 Simpan"; btn.disabled = false;
}

async function deleteMyAccount() {
  if (!confirm("⚠️ Yakin hapus akun Anda? Tindakan ini tidak bisa dibatalkan!")) return;
  const me = localStorage.getItem("user");
  try {
    const r = await fetch(`/anggota/${me}?by=${encodeURIComponent(me)}`, { method: "DELETE" });
    const d = await r.json();
    if (d.status === "SELF_NOT_ALLOWED") showToast("❌ Anda tidak bisa hapus akun sendiri. Minta Owner lain.", "error");
    else if (d.status === "OK") {
      showToast("✅ Akun dihapus");
      localStorage.clear();
      setTimeout(() => location.reload(), 1000);
    } else showToast("❌ Gagal menghapus", "error");
  } catch { showToast("❌ Server error", "error"); }
}

// ============================================================
// AREA
// ============================================================
function getMyLoc() {
  if (!navigator.geolocation) return showToast("❌ Geolocation tidak didukung", "error");
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById("area-lat").value = pos.coords.latitude.toFixed(7);
      document.getElementById("area-lng").value = pos.coords.longitude.toFixed(7);
      showToast("📍 Lokasi didapat");
    },
    err => showToast("❌ Gagal mendapat lokasi: " + err.message, "error"),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}
// ============================================================
// AREA (lanjutan)
// ============================================================
async function saveArea() {
  const name   = document.getElementById("area-name").value.trim();
  const lat    = document.getElementById("area-lat").value;
  const lng    = document.getElementById("area-lng").value;
  const radius = document.getElementById("area-radius").value || 100;
  if (!name || !lat || !lng) return showToast("⚠️ Isi nama, lat, lng", "warning");
  try {
    const r = await fetch("/areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lat, lng, radius })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Area ditambahkan");
      document.getElementById("area-name").value = "";
      document.getElementById("area-lat").value = "";
      document.getElementById("area-lng").value = "";
      document.getElementById("area-radius").value = "100";
      loadAreas();
    } else showToast("❌ Gagal menyimpan area", "error");
  } catch { showToast("❌ Server error", "error"); }
}

async function loadAreas() {
  try {
    const r = await fetch("/areas");
    const d = await r.json();
    const el = document.getElementById("area-list");
    if (!d.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada area</p>'; return; }
    el.innerHTML = d.map(a => `
      <div class="area-item">
        <div style="flex:1;min-width:0;">
          <div class="area-name">${a.name}</div>
          <div class="area-detail">${a.lat.toFixed(5)}, ${a.lng.toFixed(5)} • R ${a.radius}m</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="area-active ${a.active?'on':'off'}" onclick="toggleAreaActive('${a.id}', ${!a.active})" style="cursor:pointer;">
            ${a.active?'✓ Aktif':'✗ Nonaktif'}
          </span>
          <button onclick="deleteArea('${a.id}')" class="btn-red" style="padding:6px 10px;border:none;border-radius:6px;color:white;font-size:11px;cursor:pointer;">🗑</button>
        </div>
      </div>
    `).join("");
  } catch {}
}

async function toggleAreaActive(id, active) {
  try {
    const r = await fetch(`/areas/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active })
    });
    if ((await r.json()).status === "OK") { showToast("✅ Status area diperbarui"); loadAreas(); }
  } catch {}
}

async function deleteArea(id) {
  if (!confirm("Hapus area ini?")) return;
  try {
    const r = await fetch(`/areas/${id}`, { method: "DELETE" });
    if ((await r.json()).status === "OK") { showToast("🗑 Area dihapus"); loadAreas(); }
  } catch {}
}

// ============================================================
// HARI LIBUR & CUTI
// ============================================================
async function loadLibur() {
  try {
    const r = await fetch("/libur");
    const d = await r.json();
    const el = document.getElementById("libur-list");
    if (!d.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada data</p>'; return; }
    const sorted = d.sort((a, b) => a.date.localeCompare(b.date));
    el.innerHTML = sorted.map(h => {
      const tgl = new Date(h.date).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
      return `<div class="holiday-item">
        <div style="flex:1;">
          <div class="h-date-text">${tgl}</div>
          <div class="h-name">${h.name}</div>
        </div>
        <span class="h-type ${h.type}">${h.type === 'nasional' ? '🔴 Libur' : '🟢 Cuti'}</span>
        <button onclick="deleteLibur('${h.id}')" class="btn-red" style="padding:6px 10px;border:none;border-radius:6px;color:white;font-size:11px;cursor:pointer;margin-left:6px;">🗑</button>
      </div>`;
    }).join("");
  } catch {}
}

async function saveLibur() {
  const date = document.getElementById("libur-date").value;
  const name = document.getElementById("libur-name").value.trim();
  const type = document.getElementById("libur-type").value;
  if (!date || !name) return showToast("⚠️ Isi tanggal & nama", "warning");
  try {
    const r = await fetch("/libur", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, name, type })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Libur ditambahkan");
      document.getElementById("libur-date").value = "";
      document.getElementById("libur-name").value = "";
      loadLibur();
    } else showToast("❌ Gagal menyimpan", "error");
  } catch { showToast("❌ Server error", "error"); }
}

async function deleteLibur(id) {
  if (!confirm("Hapus data ini?")) return;
  try {
    const r = await fetch(`/libur/${id}`, { method: "DELETE" });
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
    if (!d.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada aktivitas</p>'; return; }
    const icons  = { IN:"🟢", OUT:"🔴", BREAK_START:"☕", BREAK_END:"💪" };
    const labels = { IN:"Clock In", OUT:"Clock Out", BREAK_START:"Mulai Istirahat", BREAK_END:"Selesai Istirahat" };
    list.innerHTML = d.map(a => `
      <div class="act-item">
        <div class="act-user">${icons[a.type] || "📌"} ${a.user}</div>
        <div class="act-desc">${labels[a.type] || a.type}</div>
        <div class="act-time">${new Date(a.time).toLocaleString("id-ID")}</div>
      </div>`).join("");
  } catch {}
}

// ============================================================
// TIMESHEET
// ============================================================
async function loadTimesheet() {
  const month  = document.getElementById("ts-month").value;
  const search = (document.getElementById("ts-search").value || "").toLowerCase();
  if (!month) return;
  try {
    const r = await fetch("/timesheet?month=" + month);
    const d = await r.json();
    const filtered = d.filter(x => x.user.toLowerCase().includes(search));
    const el = document.getElementById("ts-content");
    if (!filtered.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }
    el.innerHTML = `<table class="ts-table">
      <thead><tr><th>Nama</th><th>Hari</th><th>Jam Kerja</th><th>Lembur</th></tr></thead>
      <tbody>${filtered.map(x => `
        <tr>
          <td><b>${x.user}</b></td>
          <td>${x.totalDays}</td>
          <td>${x.totalJam}j</td>
          <td style="color:${parseFloat(x.overtime) > 0 ? 'var(--warning)' : 'var(--muted)'};">${x.overtime}j</td>
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