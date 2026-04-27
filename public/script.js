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

// BATCH 2 — state untuk form divisi
let _divisiEditId    = null;     // null = tambah, berisi id = edit
let _dfAllMembers    = [];       // cache list anggota untuk picker
let _dfSelected      = new Set();// usernames yang terpilih

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
    title.innerText   = "Sign Up";
    mainBtn.innerText = "Sign Up";
    toggle.innerHTML  = 'Sudah punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Login</a>';
    faceSect.classList.remove("hidden");
    startCam("video-signup");
  } else {
    title.innerText   = "Login";
    mainBtn.innerText = "Login";
    toggle.innerHTML  = 'Belum punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Sign Up</a>';
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
  document.getElementById("nav-timesheet").classList.toggle("hidden", !userMenus.includes("timesheet"));

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
    "menu-divisi":    "divisi",
    "menu-area":      "area",
    "menu-libur":     "libur",
    "menu-aktivitas": "aktivitas",
    "menu-timesheet": "timesheet",
    "menu-admin":     "admin",
    "menu-rekap":     "rekap"
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
  if (viewId === "view-divisi")    { loadDivisi(); }
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
  const date   = document.getElementById("adm-date").value || new Date().toISOString().split("T")[0];
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
