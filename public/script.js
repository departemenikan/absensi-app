// Helper: tanggal hari ini lokal (bukan UTC) — aman untuk WITA
function todayLocalStr() { return new Date().toLocaleDateString('sv-SE'); }

// Helper: konversi Date ke ISO string dengan offset timezone lokal (misal +08:00 untuk WITA)
// Ini memastikan format waktu yang dikirim ke server TIDAK ambigu (bukan tanpa timezone, bukan UTC murni)
function localISOStr(date) {
  if (!(date instanceof Date)) date = new Date(date);
  const off = -date.getTimezoneOffset(); // menit, positif untuk UTC+
  const sign = off >= 0 ? "+" : "-";
  const absOff = Math.abs(off);
  const hh = String(Math.floor(absOff / 60)).padStart(2, "0");
  const mm = String(absOff % 60).padStart(2, "0");
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hh}:${mm}`;
}

// Helper: parse ISO string (dengan atau tanpa timezone) menjadi timestamp ms yang benar
// Jika string tidak punya timezone suffix, anggap sebagai waktu lokal (bukan UTC)
function parseLocalISO(str) {
  if (!str) return NaN;
  // Sudah ada timezone info (Z, +HH:MM, -HH:MM) → parse normal
  if (/[Z+\-]\d{2}:\d{2}$/.test(str) || str.endsWith("Z")) {
    return new Date(str).getTime();
  }
  // Tidak ada timezone → anggap waktu lokal, tambahkan offset lokal
  return new Date(str).getTime();
  // new Date("2026-05-04T08:46:00") di browser sudah diparsing sebagai local time
  // jadi ini sudah benar — yang penting kita KONSISTEN semua pakai format ini
}

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
// TOGGLE EYE — universal untuk semua input password
// ============================================================
// SVG icons (inline, no external dependency)
const _EYE_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
</svg>`;
const _EYE_SHUT = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

function toggleEye(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp) return;
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  if (btn) {
    btn.innerHTML = show ? _EYE_SHUT : _EYE_OPEN;
    btn.style.color = show ? "#4f8ef7" : "#bbb";
  }
}

// ============================================================
// NAVIGASI — satu sistem terpusat, tidak ada konflik
// ============================================================
// ============================================================
// AUTH FETCH — semua request ke server wajib sertakan X-User header
// ============================================================
function authFetch(url, options = {}) {
  const user = localStorage.getItem("user") || "";
  options.headers = Object.assign({}, options.headers || {}, { "X-User": user });
  return fetch(url, options);
}

function openView(viewId) {
  // Sembunyikan semua view
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  // Tampilkan view yang diminta
  const el = document.getElementById(viewId);
  if (el) el.classList.add("active");
  // Scroll ke atas
  window.scrollTo(0, 0);
  // Load data jika perlu
  if (viewId === "view-rekap") {
    const rm = document.getElementById("rekap-month");
    if (rm && !rm.value) rm.value = new Date().toISOString().slice(0, 7);
    loadRekap();
  }
  if (viewId === "view-admin")          loadAdmin();
  if (viewId === "view-aktivitas") {
    loadAktivitas();
    const hasDaftar  = userMenus.includes("aktivitas.daftar")  || userMenus.includes("aktivitas");
    const hasMonitor = userMenus.includes("aktivitas.monitor") || userMenus.includes("aktivitas");
    switchAktivitasTab(hasDaftar ? "daftar" : hasMonitor ? "monitor" : "daftar");
  }
  if (viewId === "view-aksesibilitas")  {
    switchAksesTab("akses");
    loadGroups();
    // Pastikan slide-in detail tertutup
    const det = document.getElementById("view-akses-detail");
    if (det) det.classList.remove("open");
    document.body.style.overflow = "";
  }
  if (viewId === "view-area") {
    if (!userMenus.includes("area") && !userMenus.includes("area.daftar")) {
      showToast("⛔ Akses ditolak", "error"); return;
    }
    switchAreaTab("daftar");
    loadAreas();
  }
  if (viewId === "view-libur") {
    if (!userMenus.includes("libur") && !userMenus.includes("libur.hari-libur")) {
      showToast("⛔ Akses ditolak", "error"); return;
    }
    loadLibur();
  }
  if (viewId === "view-anggota") {
    if (!userMenus.includes("anggota") && !userMenus.includes("anggota.daftar")) {
      showToast("⛔ Akses ditolak", "error"); return;
    }
    loadAnggota();
  }
  if (viewId === "view-profil")     loadProfil();
  if (viewId === "view-tracking")   loadTracking();
  // Stop ts ticker saat meninggalkan timesheet
  if (viewId !== "view-timesheet" && typeof stopTsTicker === "function") stopTsTicker();

  if (viewId === "view-timesheet")  {
    if (!_tsWeekStart) _tsWeekStart = tsGetMonday();
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
window.navTo = navTo;

// ============================================================
// FACE API
// ============================================================
async function loadFaceModels() {
  const el = document.getElementById("faceStatus");

  // Coba lokal dulu, fallback ke CDN jika gagal
  const LOCAL_URL = "/model";
  const CDN_URL   = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

  async function tryLoad(baseUrl, label) {
    if (el) el.innerText = `⏳ Mengunduh model (1/3)...`;
    await faceapi.nets.ssdMobilenetv1.loadFromUri(baseUrl);
    if (el) el.innerText = `⏳ Mengunduh model (2/3)...`;
    await faceapi.nets.faceLandmark68Net.loadFromUri(baseUrl);
    if (el) el.innerText = `⏳ Mengunduh model (3/3)...`;
    await faceapi.nets.faceRecognitionNet.loadFromUri(baseUrl);
  }

  // Coba lokal
  try {
    await tryLoad(LOCAL_URL, "lokal");
    faceModelsLoaded = true;
    if (el) el.innerText = "✅ Model wajah siap";
    return;
  } catch (e1) {
    console.warn("[FaceAPI] Model lokal gagal, coba CDN:", e1.message);
    if (el) el.innerText = "⏳ Mengunduh model dari internet...";
  }

  // Fallback ke CDN
  try {
    await tryLoad(CDN_URL, "CDN");
    faceModelsLoaded = true;
    if (el) el.innerText = "✅ Model wajah siap (CDN)";
  } catch (e2) {
    console.error("[FaceAPI] Model CDN juga gagal:", e2.message);
    if (el) el.innerText = "⚠️ Model wajah gagal dimuat. Periksa koneksi internet.";
    faceModelsLoaded = false;
  }
}

async function getFaceDescriptor(videoEl) {
  if (!videoEl) return null;
  // Pastikan video sudah punya frame sebelum deteksi
  if (!videoEl.videoWidth || videoEl.readyState < 2) return null;
  const det = await faceapi
    .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks().withFaceDescriptor();
  return det ? det.descriptor : null;
}

// Ambil rata-rata descriptor dari beberapa sample untuk hasil lebih stabil
async function getFaceDescriptorMultiSample(videoEl, samples = 4, intervalMs = 400) {
  const descriptors = [];
  for (let i = 0; i < samples; i++) {
    // Jeda antar sample agar frame berbeda
    if (i > 0) await new Promise(r => setTimeout(r, intervalMs));
    const d = await getFaceDescriptor(videoEl);
    if (d) descriptors.push(d);
  }
  if (descriptors.length === 0) return null;
  // Rata-ratakan semua descriptor yang berhasil
  const len = descriptors[0].length;
  const avg = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    avg[i] = descriptors.reduce((sum, d) => sum + d[i], 0) / descriptors.length;
  }
  return avg;
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
  const ex = document.getElementById("signup-extra-fields");
  if (ex) ex.classList.toggle("hidden", isLoginMode);
  if (!isLoginMode) {
    const status = document.getElementById("faceStatus");
    if (status) status.innerText = "🔐 Meminta izin kamera & lokasi...";

    // Minta izin dulu — baru buka kamera setelah granted (sequential, bukan paralel)
    requirePermissions(true, true).then(async granted => {
      if (!granted) return; // gate masih terbuka
      if (status) status.innerText = "📷 Membuka kamera...";
      await startCam("video-signup");
      try {
        await waitVideoReady("video-signup", 8000);
        if (status) status.innerText = "✅ Kamera siap — hadapkan wajah ke kamera";
      } catch {
        if (status) status.innerText = "⚠️ Gagal buka kamera. Pastikan izin kamera diberikan.";
      }
    });
  } else {
    stopCam("video-signup");
  }
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
      // Daftarkan push subscription setelah login berhasil
      subscribePushNotification().catch(() => {});
    } else {
      showToast("❌ Username atau password salah!", "error");
    }
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

async function doSignUp(u, p) {
  if (!faceModelsLoaded) return showToast("⏳ Model wajah belum siap, tunggu sebentar...", "warning");
  const btn    = document.getElementById("btn-auth-main");
  const status = document.getElementById("faceStatus");
  btn.disabled = true;

  try {
    // ─── Minta izin kamera & lokasi via gate (sequential) ───
    btn.innerText = "🔐 Memeriksa izin...";
    if (status) status.innerText = "🔐 Memverifikasi izin kamera & lokasi...";

    const granted = await requirePermissions(true, true);
    if (!granted) {
      // Gate modal masih terbuka, user belum beri izin lengkap
      if (status) status.innerText = "❌ Izin belum lengkap. Berikan izin yang diminta.";
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }

    const videoEl = document.getElementById("video-signup");

    // Pastikan kamera sudah benar-benar aktif dan ada frame
    btn.innerText = "⏳ Menunggu kamera...";
    if (status) status.innerText = "📷 Menunggu kamera siap...";
    try {
      await waitVideoReady("video-signup", 8000);
    } catch {
      showToast("❌ Kamera tidak siap. Izinkan akses kamera dan coba lagi.", "error");
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }

    // Jeda 600ms agar kamera stabil setelah ready
    await new Promise(r => setTimeout(r, 600));

    // Scan wajah multi-sample (4x) untuk descriptor berkualitas tinggi
    btn.innerText = "📸 Scanning wajah (1/4)...";
    if (status) status.innerText = "🔍 Scanning wajah, hadapkan wajah ke kamera...";

    const descriptors = [];
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        btn.innerText = `📸 Scanning wajah (${i+1}/4)...`;
        await new Promise(r => setTimeout(r, 500));
      }
      const d = await getFaceDescriptor(videoEl);
      if (d) {
        descriptors.push(d);
        if (status) status.innerText = `✅ Sample ${descriptors.length}/4 berhasil`;
      } else {
        if (status) status.innerText = `⚠️ Sample ${i+1} gagal, coba lagi...`;
      }
    }

    if (descriptors.length < 2) {
      showToast("❌ Wajah tidak terdeteksi! Pastikan pencahayaan cukup dan wajah terlihat jelas.", "error");
      if (status) status.innerText = "❌ Deteksi gagal. Coba ulangi.";
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }

    // Rata-ratakan semua descriptor yang berhasil
    const len = descriptors[0].length;
    const avgDescriptor = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      avgDescriptor[i] = descriptors.reduce((sum, d) => sum + d[i], 0) / descriptors.length;
    }

    if (status) status.innerText = `✅ Wajah terdeteksi (${descriptors.length} sample). Menyimpan...`;
    btn.innerText = "💾 Menyimpan...";

    const namaLengkap = (document.getElementById("signup-nama")?.value || "").trim();
    const agama       = document.getElementById("signup-agama")?.value || "";
    const noHp        = (document.getElementById("signup-nohp")?.value || "").trim();
    const r = await fetch("/signup", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ username:u, password:p, faceDescriptor:Array.from(avgDescriptor), namaLengkap, agama, noHp })
    });
    const d = await r.json();
    if (d.status === "OK") {
      stopCam("video-signup");
      if (status) status.innerText = "✅ Akun berhasil dibuat!";
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
      // Auto-resubscribe push setiap app dibuka (subscription hilang saat server restart)
      subscribePushNotification().catch(() => {});
    } else {
      localStorage.clear(); showAuthPage();
    }
  } catch { localStorage.clear(); showAuthPage(); }
}

function showAuthPage() {
  // Sembunyikan splash screen sebelum tampil form login
  const splash = document.getElementById("splash-screen");
  if (splash) splash.classList.add("hide");
  document.getElementById("auth-page").classList.remove("hidden");
  document.getElementById("main-nav").classList.add("hidden");
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
}

function enterApp(menus, group, level) {
  // Sembunyikan splash screen
  const splash = document.getElementById("splash-screen");
  if (splash) splash.classList.add("hide");

  userMenus = menus || [];
  userGroup = group || "anggota";
  userLevel = level || 99;

  document.getElementById("auth-page").classList.add("hidden");
  document.getElementById("main-nav").classList.remove("hidden");
  stopCam("video-signup");

  // Terapkan akses menu & submenu berdasarkan group
  applyMenuAccess();

  // Update header
  document.getElementById("hdr-user").innerText = localStorage.getItem("user") || "";
  document.getElementById("hdr-date").innerText = new Date().toLocaleDateString("id-ID", {weekday:"long",day:"numeric",month:"long",year:"numeric"});

  // Load foto profil untuk avatar header
  updateHeaderAvatar();

  navTo("home");
  loadStatus();
  loadTodayDetail();
  loadWeeklyInfo();
  loadHomeLibur();
  // Load app settings (timezone dll)
  loadSistemSettings();
  // Load status fitur foto kegiatan (untuk kontrol pop-up Clock Out)
  authFetch("/app-settings").then(r => r.json()).then(d => {
    _wpFeatureEnabled = d.workPhotoEnabled !== false;
  }).catch(() => {});
  // Jika sudah clock in, mulai tracking ping
  authFetch("/status/" + (localStorage.getItem("user")||""))
    .then(r => r.json())
    .then(d => { if (d.status === "IN") startTrackingPing(); })
    .catch(() => {});

  // Set tanggal default admin
  const ad = document.getElementById("adm-date");
  if (ad) ad.value = todayLocalStr();
}

// Sinkronisasi foto profil ke semua avatar di header
async function updateHeaderAvatar() {
  const me = localStorage.getItem("user");
  if (!me) return;
  try {
    const r = await authFetch("/profile/" + me + "?requester=" + encodeURIComponent(me));
    const d = await r.json();
    const avatarIds = [
      "hdr-avatar-home","hdr-avatar-rekap","hdr-avatar-admin",
      "hdr-avatar-setting","hdr-avatar-timesheet","hdr-avatar-cuti"
    ];
    avatarIds.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (d.photo) {
        btn.innerHTML = `<img src="${d.photo}" alt="Profil">`;
      } else {
        // Inisial nama atau username
        const initial = (d.namaLengkap || me).charAt(0).toUpperCase();
        btn.innerHTML = `<span style="font-size:15px;font-weight:800;letter-spacing:0;">${initial}</span>`;
      }
    });
  } catch {}
}

function applyMenuAccess() {
  // ── Navbar ──
  // home selalu tampil (nav-home tidak perlu diatur)
  const navTimesheet = document.getElementById("nav-timesheet");
  const navCuti      = document.getElementById("nav-cuti");
  const navSetting   = document.getElementById("nav-setting");
  // timesheet & cuti = alwaysOn, tetap tampil
  if (navTimesheet) navTimesheet.classList.remove("hidden");
  if (navCuti)      navCuti.classList.remove("hidden");
  if (navSetting)   navSetting.classList.toggle("hidden", !userMenus.includes("setting"));

  // ── Menu Setting (menu-item di halaman setting) ──
  const settingMap = {
    "menu-anggota":       "anggota",
    "menu-area":          "area",
    "menu-libur":         "libur",
    "menu-aktivitas":     "aktivitas",
    "menu-rekap":         "rekap",
    "menu-aksesibilitas": "aksesibilitas",
    "menu-tracking":      "tracking",
    "menu-admin":         "admin",
  };
  Object.entries(settingMap).forEach(([elId, menuKey]) => {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle("hidden", !userMenus.includes(menuKey));
  });

  // ── Submenu: Anggota (tab daftar & divisi) ──
  const tabDaftar = document.getElementById("tab-daftar");
  const tabDivisi = document.getElementById("tab-divisi");
  if (tabDaftar) tabDaftar.classList.toggle("hidden", !userMenus.includes("anggota.daftar") && !userMenus.includes("anggota"));
  if (tabDivisi) tabDivisi.classList.toggle("hidden", !userMenus.includes("anggota.divisi"));

  // ── Submenu: Area (tab daftar & tambah) ──
  const areaDaftar = document.getElementById("area-tab-daftar");
  const areaTambah = document.getElementById("area-tab-tambah");
  if (areaDaftar) areaDaftar.classList.toggle("hidden", false); // daftar selalu tampil jika area bisa diakses
  if (areaTambah) areaTambah.classList.toggle("hidden", !userMenus.includes("area.tambah"));

  // ── Submenu: Libur (tab hari-libur, kebijakan-cuti, kuota-cuti) ──
  const tabHariLibur     = document.getElementById("tab-hari-libur");
  const tabKebijakanCuti = document.getElementById("tab-kebijakan-cuti");
  const tabKuotaCuti     = document.getElementById("tab-kuota-cuti");
  if (tabHariLibur)     tabHariLibur.classList.toggle("hidden",     !userMenus.includes("libur.hari-libur")     && !userMenus.includes("libur"));
  if (tabKebijakanCuti) tabKebijakanCuti.classList.toggle("hidden", !userMenus.includes("libur.kebijakan-cuti"));
  if (tabKuotaCuti)     tabKuotaCuti.classList.toggle("hidden",     !userMenus.includes("libur.kuota-cuti"));

  // ── Submenu: Cuti (tab daftar=pengajuan & saldo) ──
  const cutiDaftar = document.getElementById("cuti-tab-daftar");
  const cutiSaldo  = document.getElementById("cuti-tab-saldo");
  if (cutiDaftar) cutiDaftar.classList.toggle("hidden", !userMenus.includes("cuti.daftar") && !userMenus.includes("cuti"));
  if (cutiSaldo)  cutiSaldo.classList.toggle("hidden",  !userMenus.includes("cuti.saldo"));

  // ── Submenu: Aktivitas (tab daftar & monitor) ──
  const tabAktDaftar  = document.getElementById("tab-btn-daftar");
  const tabAktMonitor = document.getElementById("tab-btn-monitor");
  if (tabAktDaftar)  tabAktDaftar.classList.toggle("hidden",  !userMenus.includes("aktivitas.daftar")  && !userMenus.includes("aktivitas"));
  if (tabAktMonitor) tabAktMonitor.classList.toggle("hidden", !userMenus.includes("aktivitas.monitor") && !userMenus.includes("aktivitas"));
}

function logout() {
  uConfirm({
    icon: "🚪",
    title: "Keluar Aplikasi",
    msg: "Yakin ingin logout dari akun ini?",
    btnOk: "Ya, Keluar", btnOkClass: "danger",
    onOk: () => { localStorage.clear(); location.reload(); }
  });
}

// ============================================================
// UNIVERSAL MODAL ENGINE
// ============================================================
const _uModal = {
  overlay: null, title: null, sub: null, body: null, btns: null,
  _cb: null,
  init() {
    if (this.overlay) return;
    this.overlay = document.getElementById("u-modal-overlay");
    this.title   = document.getElementById("u-modal-title");
    this.sub     = document.getElementById("u-modal-sub");
    this.body    = document.getElementById("u-modal-body");
    this.btns    = document.getElementById("u-modal-btns");
    this.overlay.addEventListener("click", e => { if (e.target === this.overlay) this.close(); });
  },
  open(titleTxt, subTxt, bodyHTML, btnsHTML) {
    this.init();
    this.title.innerHTML = titleTxt || "";
    this.sub.innerHTML   = subTxt   || "";
    this.body.innerHTML  = bodyHTML || "";
    this.btns.innerHTML  = btnsHTML || "";
    this.overlay.classList.add("open");
    setTimeout(() => { const inp = this.body.querySelector("input"); if (inp) inp.focus(); }, 350);
  },
  close() {
    this.init();
    this.overlay.classList.remove("open");
  }
};

// Modal input teks generik
function uInput({ title, sub="", placeholder="", value="", type="text", onOk }) {
  _uModal.open(
    title, sub,
    `<input class="u-modal-input" id="u-inp" type="${type}" placeholder="${placeholder}" value="${value}" autocomplete="off">`,
    `<button class="u-modal-btn cancel" onclick="_uModal.close()">Batal</button>
     <button class="u-modal-btn primary" onclick="_uInputSubmit()">Simpan</button>`
  );
  _uModal._cb = onOk;
  setTimeout(() => {
    const el = document.getElementById("u-inp");
    if (el) el.addEventListener("keydown", e => { if (e.key === "Enter") _uInputSubmit(); });
  }, 360);
}
function _uInputSubmit() {
  const val = document.getElementById("u-inp")?.value ?? "";
  _uModal.close();
  if (_uModal._cb) _uModal._cb(val);
}

// Modal pilih opsi
function uSelect({ title, sub="", options=[], current="", onOk }) {
  const opts = options.map(o =>
    `<button class="u-modal-opt${o===current?' selected':''}" onclick="_uSelectSubmit('${o}')">${o}</button>`
  ).join("");
  _uModal.open(title, sub, `<div class="u-modal-options">${opts}</div>`, "");
  _uModal._cb = onOk;
}
function _uSelectSubmit(val) {
  _uModal.close();
  if (_uModal._cb) _uModal._cb(val);
}

// Modal konfirmasi
function uConfirm({ icon="⚠️", title, msg, btnOk="Ya", btnOkClass="primary", onOk }) {
  _uModal.open(
    title, "",
    `<div class="u-modal-confirm-icon">${icon}</div>
     <div class="u-modal-confirm-msg">${msg}</div>`,
    `<button class="u-modal-btn cancel" onclick="_uModal.close()">Batal</button>
     <button class="u-modal-btn ${btnOkClass}" onclick="_uConfirmOk()">${btnOk}</button>`
  );
  _uModal._cb = onOk;
}
function _uConfirmOk() { _uModal.close(); if (_uModal._cb) _uModal._cb(); }

// Modal password (toggle lihat/sembunyikan, tanpa password lama)
function uPassword({ title, sub="", onOk }) {
  _uModal.open(
    title, sub,
    `<div class="u-modal-input-wrap">
       <input class="u-modal-input" id="u-pw-new" type="password" placeholder="Password baru" autocomplete="new-password">
       <button class="u-modal-eye" tabindex="-1" onclick="_uToggleEye('u-pw-new',this)" style="color:#bbb;">${_EYE_OPEN}</button>
     </div>
     <div class="u-modal-input-wrap">
       <input class="u-modal-input" id="u-pw-cfm" type="password" placeholder="Konfirmasi password baru" autocomplete="new-password">
       <button class="u-modal-eye" tabindex="-1" onclick="_uToggleEye('u-pw-cfm',this)" style="color:#bbb;">${_EYE_OPEN}</button>
     </div>`,
    `<button class="u-modal-btn cancel" onclick="_uModal.close()">Batal</button>
     <button class="u-modal-btn primary" onclick="_uPasswordSubmit()">Simpan</button>`
  );
  _uModal._cb = onOk;
}
function _uToggleEye(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  btn.innerHTML = show ? _EYE_SHUT : _EYE_OPEN;
  btn.style.color = show ? "#4f8ef7" : "#bbb";
}
function _uPasswordSubmit() {
  const pw  = document.getElementById("u-pw-new")?.value  || "";
  const cfm = document.getElementById("u-pw-cfm")?.value || "";
  if (pw.length < 6) return showToast("⚠️ Password minimal 6 karakter", "warning");
  if (pw !== cfm)   return showToast("⚠️ Konfirmasi password tidak cocok!", "warning");
  _uModal.close();
  if (_uModal._cb) _uModal._cb(pw);
}


// ============================================================
// KAMERA
// ============================================================
function startCam(id) {
  const v = document.getElementById(id);
  if (!v) return Promise.resolve();
  // Jika stream sudah berjalan, langsung resolve
  if (v.srcObject && v.srcObject.active) return Promise.resolve();
  return navigator.mediaDevices.getUserMedia({ video:{ facingMode:"user", width:{ideal:640}, height:{ideal:480} }, audio:false })
    .then(s => { v.srcObject = s; })
    .catch(e => console.warn("Kamera:", e));
}

// Tunggu video element benar-benar punya frame (videoWidth > 0)
function waitVideoReady(id, maxMs = 8000) {
  return new Promise((resolve, reject) => {
    const v = document.getElementById(id);
    if (!v) return reject(new Error("Video element tidak ditemukan"));
    const start = Date.now();
    const check = () => {
      if (v.readyState >= 2 && v.videoWidth > 0) return resolve(v);
      if (Date.now() - start > maxMs) return reject(new Error("Timeout: kamera tidak siap"));
      setTimeout(check, 100);
    };
    check();
  });
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
    // Tunggu kamera benar-benar ready sebelum scan
    try {
      await waitVideoReady("video-modal", 6000);
    } catch {
      hideCamModal(); resolve(false);
      showToast("❌ Kamera tidak siap. Coba lagi.", "error"); return;
    }
    await new Promise(r => setTimeout(r, 400));

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
// SCREENSHOT BUKTI KERJA
// ============================================================
let _ssStream        = null;
let _ssInterval      = null;
let _ssCanvas        = null;
let _ssFeatureEnabled = false; // status dari server
const SS_INTERVAL_MS  = 15 * 60 * 1000; // 15 menit

function ssIsSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

async function ssRequestScreen() {
  try {
    if (_ssStream) { _ssStream.getTracks().forEach(t => t.stop()); _ssStream = null; }
    showToast("🖥️ Izinkan berbagi layar untuk melanjutkan Clock In...", "info", 5000);
    _ssStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always", displaySurface: "monitor" },
      audio: false,
    });
    _ssStream.getVideoTracks()[0].addEventListener("ended", () => { ssStop(); });
    return true;
  } catch (e) {
    console.warn("[SS] Izin ditolak:", e.message);
    return false;
  }
}

async function ssTakeAndSend() {
  if (!_ssStream || !_ssStream.active) return;
  try {
    const track = _ssStream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return;
    let base64;
    if (typeof ImageCapture !== "undefined") {
      try {
        const blob = await new ImageCapture(track).takePhoto({ imageWidth: 1280 });
        base64 = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
      } catch { base64 = null; }
    }
    if (!base64) {
      const video = document.createElement("video");
      video.srcObject = new MediaStream([track]); video.muted = true;
      await new Promise(r => { video.onloadedmetadata = r; video.play(); });
      await new Promise(r => setTimeout(r, 200));
      if (!_ssCanvas) _ssCanvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / video.videoWidth);
      _ssCanvas.width  = Math.round(video.videoWidth  * scale);
      _ssCanvas.height = Math.round(video.videoHeight * scale);
      _ssCanvas.getContext("2d").drawImage(video, 0, 0, _ssCanvas.width, _ssCanvas.height);
      base64 = _ssCanvas.toDataURL("image/jpeg", 0.7);
      video.srcObject = null;
    }
    if (!base64 || base64.length < 1000) return;
    const r = await authFetch("/screenshot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64 }),
    });
    if (r.ok) console.log("[SS] Screenshot terkirim @", new Date().toLocaleTimeString("id-ID"));
  } catch (e) { console.warn("[SS] Error capture:", e.message); }
}

function ssStart() {
  ssStop();
  if (!_ssStream || !_ssStream.active) return;
  setTimeout(() => ssTakeAndSend(), 3000);
  _ssInterval = setInterval(() => ssTakeAndSend(), SS_INTERVAL_MS);
  console.log("[SS] Auto-screenshot aktif (15 menit)");
}

function ssStop() {
  if (_ssInterval) { clearInterval(_ssInterval); _ssInterval = null; }
  if (_ssStream)   { _ssStream.getTracks().forEach(t => t.stop()); _ssStream = null; }
}

// Load status toggle dari server & render UI toggle
async function loadScreenshotToggle() {
  try {
    const r = await authFetch("/app-settings");
    if (!r.ok) return;
    const d = await r.json();
    _ssFeatureEnabled = d.screenshotEnabled !== false; // default true jika belum diset
    renderScreenshotToggle(_ssFeatureEnabled);
  } catch {}
}

function renderScreenshotToggle(enabled) {
  const label  = document.getElementById("ss-toggle-label");
  const sub    = document.getElementById("ss-toggle-sub");
  const sw     = document.getElementById("ss-toggle-switch");
  const knob   = document.getElementById("ss-toggle-knob");
  if (!label || !sw || !knob) return;
  if (enabled) {
    label.textContent      = "✅ Fitur Aktif";
    label.style.color      = "#27ae60";
    sub.textContent        = "Karyawan wajib share layar saat Clock In di desktop";
    sw.style.background    = "#27ae60";
    knob.style.left        = "27px";
  } else {
    label.textContent      = "⛔ Fitur Nonaktif";
    label.style.color      = "#95a5a6";
    sub.textContent        = "Screenshot tidak diambil, Clock In bebas tanpa share layar";
    sw.style.background    = "#ccc";
    knob.style.left        = "3px";
  }
}

async function toggleScreenshotFeature() {
  // Hanya owner
  if (userLevel > 1) { showToast("⛔ Hanya Owner yang dapat mengubah pengaturan ini", "error"); return; }
  const newState = !_ssFeatureEnabled;
  try {
    const r = await authFetch("/app-settings/screenshot-toggle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newState }),
    });
    if (!r.ok) { showToast("❌ Gagal menyimpan", "error"); return; }
    _ssFeatureEnabled = newState;
    renderScreenshotToggle(newState);
    showToast(newState ? "✅ Fitur Screenshot diaktifkan" : "🔕 Fitur Screenshot dinonaktifkan");
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

// ============================================================
// ABSENSI
// ============================================================
async function sendAbsen(type, label) {
  const user = localStorage.getItem("user");
  if (!user) return checkLoginStatus();

  // ─── Ambil lokasi + mulai buka kamera BERSAMAAN (hemat waktu) ───
  // Tampilkan status loading dulu
  const btnIn  = document.getElementById("btn-in");
  const btnOut = document.getElementById("btn-out");
  const btnBS  = document.getElementById("btn-bs");
  const btnBE  = document.getElementById("btn-be");
  [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = true; });

  let loc;
  try {
    // ─── Cek & minta izin kamera + lokasi via gate (sequential) ───
    const granted = await requirePermissions(true, true);
    if (!granted) {
      // Gate modal masih terbuka — user belum lengkapi izin
      [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
      return;
    }

    // Ambil lokasi (izin sudah granted)
    loc = await getLoc();

    if (loc.denied) {
      // Seharusnya tidak terjadi setelah gate, tapi jaga-jaga
      await requirePermissions(false, true); // tampilkan gate khusus lokasi
      [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
      return;
    }
    if (loc.timedOut && loc.lat === 0 && loc.lng === 0) {
      showToast("❌ Gagal mendapatkan lokasi. Pastikan GPS aktif, lalu coba lagi.", "error", 5000);
      [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
      return;
    }

    // Validasi aktivitas — required saat Clock In
    if (type === "IN") {
      const selAkt = document.getElementById("home-aktivitas-select");
      const aktivitasVal = selAkt ? selAkt.value.trim() : "";
      if (!aktivitasVal) {
        showToast("⚠️ Pilih aktivitas terlebih dahulu sebelum Clock In", "warning", 4000);
        // Highlight dropdown
        if (selAkt) {
          selAkt.style.borderColor = "#e74c3c";
          selAkt.focus();
          setTimeout(() => { selAkt.style.borderColor = "#e8ecf0"; }, 3000);
        }
        [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
        return;
      }
    }

    // Verifikasi wajah (buka kamera modal)
    const ok = await verifyFace(label);
    if (!ok) return;
    const photo = takePhoto();

    // ── Screen share: wajib jika fitur aktif & browser support & desktop ───
    if (type === "IN" && _ssFeatureEnabled && ssIsSupported()) {
      const ssOk = await ssRequestScreen();
      if (!ssOk) {
        showToast("❌ Clock In dibatalkan. Izin berbagi layar diperlukan.", "error", 6000);
        [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
        setTimeout(async () => { await ssRequestScreen(); }, 1200);
        return;
      }
    }

    // Hentikan screenshot saat Clock Out
    if (type === "OUT") ssStop();

    // Ambil nilai aktivitas
    const selAktFinal = document.getElementById("home-aktivitas-select");
    const aktivitas = selAktFinal ? selAktFinal.value.trim() : "";

    // Kirim waktu dalam ISO string dengan offset lokal agar konsisten dengan edit manual timesheet
    const now = localISOStr(new Date()); // format: 2026-05-04T08:46:00+08:00
    const r = await authFetch("/absen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        time: now,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy || 0,  // ← kirim accuracy agar server toleran GPS lemah
        photo,
        aktivitas: type === "IN" ? aktivitas : undefined,  // hanya kirim saat Clock In
        workPhoto: type === "OUT" ? (_workPhotoData || undefined) : undefined  // foto kegiatan saat Clock Out (opsional)
      })
    });
    const d = await r.json();
    if (d.status === "OK") {
      const msgs = { IN:"✅ Clock In berhasil!", OUT:"👋 Clock Out berhasil!", BREAK_START:"☕ Selamat istirahat!", BREAK_END:"💪 Lanjut kerja!" };
      showToast(msgs[type] || "✅ Berhasil!");
      updateLocalRecord(type, now);
      loadStatus();
      if (type === "OUT") loadWeeklyInfo();
      if (type === "IN" || type === "BREAK_END") startTrackingPing();
      if (type === "OUT") stopTrackingPing();
      if (type === "IN" && _ssFeatureEnabled) ssStart();
    } else if (d.status === "OUT_OF_AREA") {
      const _actionLabel = { IN:"Clock In", OUT:"Clock Out", BREAK_START:"Mulai Istirahat", BREAK_END:"Selesai Istirahat" }[type] || type;
      showToast(`❌ ${_actionLabel} gagal! Anda berada ${d.distance}m dari ${d.area||"kantor"}. Harus berada dalam radius area. Jika sedang Tugas Luar, minta admin ubah status kerja Anda.`, "error", 7000);
    } else if (d.status === "LOCATION_REQUIRED") {
      const _actionLabel = { IN:"Clock In", OUT:"Clock Out", BREAK_START:"Mulai Istirahat", BREAK_END:"Selesai Istirahat" }[type] || type;
      showToast(`❌ Aktifkan layanan lokasi di perangkat Anda untuk ${_actionLabel}`, "error", 5000);
    } else if (d.status === "ALREADY_IN") {
      showToast("⚠️ Sudah Clock In hari ini", "warning"); loadStatus();
    }
  } catch (e) {
    console.error("sendAbsen error:", e);
    showToast("❌ Terjadi kesalahan teknis. Coba lagi.", "error");
  } finally {
    // Selalu aktifkan kembali tombol
    [btnIn, btnOut, btnBS, btnBE].forEach(b => { if (b) b.disabled = false; });
  }
}

function clockIn()    { sendAbsen("IN",          "Clock In"); }
function clockOut() {
  // Pop-up foto kegiatan: hanya mobile (lebar ≤ 768px) DAN fitur diaktifkan admin
  const isMobile = window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);
  if (isMobile && _wpFeatureEnabled) {
    showWorkPhotoPopup();
  } else {
    sendAbsen("OUT", "Clock Out");
  }
}
function breakStart() { sendAbsen("BREAK_START", "Istirahat"); }
function breakEnd()   { sendAbsen("BREAK_END",   "Lanjut Kerja"); }

// ============================================================
// POPUP FOTO KEGIATAN — muncul sebelum kamera Clock Out
// ============================================================
let _workPhotoData = null; // base64 foto kegiatan, bisa null jika dilewati

function showWorkPhotoPopup() {
  _workPhotoData = null;

  // Buat overlay jika belum ada
  let overlay = document.getElementById("work-photo-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "work-photo-overlay";
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,.72);z-index:850;
      display:flex;align-items:flex-end;justify-content:center;
    `;
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div id="work-photo-sheet" style="
      background:#fff;border-radius:24px 24px 0 0;
      width:100%;max-width:480px;padding:24px 20px 32px;
      animation:slideUp .3s ease;
    ">
      <!-- Handle bar -->
      <div style="width:40px;height:4px;background:#ddd;border-radius:4px;margin:0 auto 20px;"></div>

      <!-- Judul -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div>
          <div style="font-size:16px;font-weight:700;color:#2c3e50;">📸 Foto Kegiatan</div>
          <div style="font-size:12px;color:#95a5a6;margin-top:2px;">Opsional — bisa dilewati</div>
        </div>
        <button onclick="_skipWorkPhoto()" style="
          width:32px;height:32px;border-radius:50%;border:none;
          background:#f0f2f5;font-size:18px;cursor:pointer;
          display:flex;align-items:center;justify-content:center;color:#555;
        ">✕</button>
      </div>

      <!-- Preview area (muncul jika foto dipilih) -->
      <div id="wpp-preview-wrap" style="display:none;margin:14px 0;text-align:center;">
        <img id="wpp-preview-img" style="
          max-width:100%;max-height:220px;border-radius:12px;
          object-fit:cover;border:2px solid #e8ecf0;
        "/>
        <div style="margin-top:8px;">
          <button onclick="_clearWorkPhoto()" style="
            font-size:12px;color:#e74c3c;background:none;border:none;cursor:pointer;font-weight:600;
          ">🗑 Hapus foto</button>
        </div>
      </div>

      <!-- Input file tersembunyi -->
      <input type="file" id="wpp-file-input" accept="image/*" style="display:none"
        onchange="_handleWorkPhotoFile(this)"/>

      <!-- Tombol pilihan -->
      <div id="wpp-btn-group" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;">
        <button onclick="_openWorkPhotoCamera()" style="
          padding:14px 8px;border:none;border-radius:12px;cursor:pointer;font-weight:700;font-size:13px;
          background:linear-gradient(135deg,#2980b9,#4f8ef7);color:white;
          display:flex;flex-direction:column;align-items:center;gap:6px;
        ">
          <span style="font-size:22px;">📷</span>
          <span>Ambil Foto</span>
        </button>
        <button onclick="document.getElementById('wpp-file-input').click()" style="
          padding:14px 8px;border:none;border-radius:12px;cursor:pointer;font-weight:700;font-size:13px;
          background:linear-gradient(135deg,#8e44ad,#9b59b6);color:white;
          display:flex;flex-direction:column;align-items:center;gap:6px;
        ">
          <span style="font-size:22px;">🖼️</span>
          <span>Dari Galeri</span>
        </button>
      </div>

      <!-- Kamera inline untuk ambil foto kegiatan -->
      <div id="wpp-camera-section" style="display:none;margin-top:16px;text-align:center;">
        <video id="wpp-video" autoplay playsinline muted style="
          width:100%;max-height:240px;border-radius:12px;object-fit:cover;
          background:#111;
        "></video>
        <div id="wpp-cam-status" style="font-size:12px;color:#888;margin:8px 0;"></div>
        <div style="display:flex;gap:10px;margin-top:4px;">
          <button onclick="_captureWorkPhoto()" style="
            flex:1;padding:12px;border:none;border-radius:10px;cursor:pointer;
            background:linear-gradient(135deg,#27ae60,#2ecc71);color:white;font-weight:700;font-size:14px;
          ">📸 Ambil</button>
          <button onclick="_closeWorkPhotoCamera()" style="
            padding:12px 16px;border:none;border-radius:10px;cursor:pointer;
            background:#f0f2f5;color:#555;font-weight:700;font-size:14px;
          ">Batal</button>
        </div>
      </div>

      <!-- Tombol simpan / lanjut -->
      <div style="margin-top:18px;display:flex;gap:10px;">
        <button id="wpp-skip-btn" onclick="_skipWorkPhoto()" style="
          flex:1;padding:13px;border:1.5px solid #e8ecf0;border-radius:12px;
          background:#f8f9ff;color:#555;font-weight:700;font-size:14px;cursor:pointer;
        ">Lewati</button>
        <button id="wpp-save-btn" onclick="_saveWorkPhotoAndProceed()" style="
          flex:1;padding:13px;border:none;border-radius:12px;
          background:linear-gradient(135deg,#c0392b,#e74c3c);color:white;font-weight:700;font-size:14px;cursor:pointer;
          display:none;
        ">Simpan & Clock Out</button>
      </div>
    </div>
  `;

  overlay.style.display = "flex";
}

function _hideWorkPhotoPopup() {
  const overlay = document.getElementById("work-photo-overlay");
  if (overlay) overlay.style.display = "none";
  _closeWorkPhotoCamera();
}

function _skipWorkPhoto() {
  _workPhotoData = null;
  _hideWorkPhotoPopup();
  sendAbsen("OUT", "Clock Out");
}

function _saveWorkPhotoAndProceed() {
  _hideWorkPhotoPopup();
  sendAbsen("OUT", "Clock Out");
}

function _clearWorkPhoto() {
  _workPhotoData = null;
  document.getElementById("wpp-preview-wrap").style.display = "none";
  document.getElementById("wpp-btn-group").style.display = "grid";
  document.getElementById("wpp-save-btn").style.display = "none";
}

function _handleWorkPhotoFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _workPhotoData = e.target.result; // data:image/jpeg;base64,...
    document.getElementById("wpp-preview-img").src = _workPhotoData;
    document.getElementById("wpp-preview-wrap").style.display = "block";
    document.getElementById("wpp-btn-group").style.display = "none";
    document.getElementById("wpp-save-btn").style.display = "block";
  };
  reader.readAsDataURL(file);
  input.value = ""; // reset agar bisa pilih file sama lagi
}

let _wppStream = null;

async function _openWorkPhotoCamera() {
  const section = document.getElementById("wpp-camera-section");
  const video   = document.getElementById("wpp-video");
  const status  = document.getElementById("wpp-cam-status");
  section.style.display = "block";
  document.getElementById("wpp-btn-group").style.display = "none";
  if (status) status.innerText = "⏳ Membuka kamera...";
  try {
    _wppStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = _wppStream;
    await video.play();
    if (status) status.innerText = "✅ Kamera siap — arahkan ke kegiatan/hasil kerja";
  } catch (e) {
    if (status) status.innerText = "❌ Gagal membuka kamera: " + e.message;
  }
}

function _closeWorkPhotoCamera() {
  const section = document.getElementById("wpp-camera-section");
  const video   = document.getElementById("wpp-video");
  if (section) section.style.display = "none";
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  if (_wppStream) {
    _wppStream.getTracks().forEach(t => t.stop());
    _wppStream = null;
  }
  // Tampilkan kembali tombol pilihan jika belum ada foto
  if (!_workPhotoData) {
    const btnGroup = document.getElementById("wpp-btn-group");
    if (btnGroup) btnGroup.style.display = "grid";
  }
}

function _captureWorkPhoto() {
  const video = document.getElementById("wpp-video");
  if (!video || !video.videoWidth) {
    showToast("⚠️ Kamera belum siap", "warning"); return;
  }
  const canvas = document.createElement("canvas");
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  _workPhotoData = canvas.toDataURL("image/jpeg", 0.82);
  _closeWorkPhotoCamera();
  document.getElementById("wpp-preview-img").src = _workPhotoData;
  document.getElementById("wpp-preview-wrap").style.display = "block";
  document.getElementById("wpp-save-btn").style.display = "block";
}

async function loadStatus() {
  const user = localStorage.getItem("user");
  if (!user) return;
  try {
    const r = await authFetch("/status/" + user);
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
    bOut.classList.remove("hidden"); // FIX: tampilkan Clock Out saat istirahat
  } else {
    el.innerHTML = '<span class="status-dot" style="background:#95a5a6"></span> Belum Absen';
    el.style.background="#f0f2f5"; el.style.color="#95a5a6";
    bIn.classList.remove("hidden");
  }
}

// ─── REALTIME TICKER ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════
// RULE JAM KERJA
// ═══════════════════════════════════════════════════════════

// Jam kerja default per hari (dalam jam)
// Fleksibel: user tetap bisa clock in kapan saja & hari apa saja
// Ini hanya dipakai sebagai ACUAN PENGGAJIAN & perhitungan overtime
const JADWAL_DEFAULT = {
  masuk:         "09:00",
  keluar:        "17:00",
  masukSabtu:    "09:00",
  keluarSabtu:   "15:00",
  istirahatMulai:"12:00",
  istirahatAkhir:"13:00",
  liburMinggu:   true,    // Minggu default libur tapi tetap bisa clock in
};

// Target jam kerja wajib per minggu (Senin-Minggu)
const TARGET_JAM_MINGGU = 40;

// Jam kerja bersih normal per hari (sebagai referensi)
// Senin-Jumat: 09-17 potong istirahat 1j = 7j
// Sabtu: 09-15 potong istirahat 1j = 5j
const JAM_NORMAL_PER_HARI = {
  1: 7,  // Senin
  2: 7,  // Selasa
  3: 7,  // Rabu
  4: 7,  // Kamis
  5: 7,  // Jumat
  6: 5,  // Sabtu (09-15, potong istirahat 1j = 5j)
  0: 0,  // Minggu (default libur, tapi bisa tetap clock in)
};

// ─── FORMAT & HITUNG ────────────────────────────────────────

let _tickerInterval = null;
let _todayRec       = null;   // record absensi hari ini (cache)
let _weeklyInterval = null;   // interval cek minggu untuk auto-overtime

// Format detik → HH:MM:SS
function fmtDuration(sec) {
  if (isNaN(sec) || sec == null) return "00:00:00";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function fmtBreak(sec) { return fmtDuration(sec); }

// Hitung total detik istirahat dari array breaks (termasuk break yg sedang berjalan)
function hitungBreakDetik(breaks) {
  const now = Date.now();
  return (breaks || []).reduce((total, b) => {
    const start = parseLocalISO(b.start);
    const end   = b.end ? parseLocalISO(b.end) : now;
    if (isNaN(start)) return total;
    return total + Math.max(0, (end - start) / 1000);
  }, 0);
}

// Hitung durasi kerja bersih (detik) — realtime jika belum clock out
function hitungKerjaDetik(rec) {
  if (!rec || !rec.jamMasuk) return 0;
  const now      = Date.now();
  const masuk    = parseLocalISO(rec.jamMasuk);
  if (isNaN(masuk)) return 0;
  const keluar   = rec.jamKeluar ? parseLocalISO(rec.jamKeluar) : now;
  if (!isNaN(keluar) && keluar < masuk) return 0; // guard: keluar sebelum masuk
  const totalSec = Math.max(0, ((isNaN(keluar) ? now : keluar) - masuk) / 1000);
  const breakSec = hitungBreakDetik(rec.breaks);
  return Math.max(0, totalSec - breakSec);
}

// Hitung jam kerja bersih dari record (dalam jam, bukan detik)
function hitungJamKerjaRec(rec) {
  return hitungKerjaDetik(rec) / 3600;
}

// Ambil weekKey format "YYYY-Www" (ISO week, Senin = awal minggu)
function getWeekKey(dateStr) {
  const d   = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  const mon  = new Date(d);
  mon.setDate(d.getDate() + diff);
  const year = mon.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const startW1 = new Date(jan4);
  startW1.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));
  const weekNum = Math.floor((mon - startW1) / (7 * 86400000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

// Cek apakah sekarang adalah Minggu pukul 23:55–23:59 (window untuk proses overtime)
function isMingguMalam() {
  const now  = new Date();
  const hari = now.getDay();      // 0 = Minggu
  const jam  = now.getHours();
  const mnt  = now.getMinutes();
  return hari === 0 && jam === 23 && mnt >= 55;
}

// ─── UPDATE UI BERANDA ──────────────────────────────────────

function updateTodayUI(rec) {
  const elIn        = document.getElementById("t-in");
  const elOut       = document.getElementById("t-out");
  const elIstirahat = document.getElementById("t-istirahat");
  const elDur       = document.getElementById("t-dur");

  if (!rec || !rec.jamMasuk) {
    if (elIn)        elIn.innerText        = "--:--";
    if (elOut)       elOut.innerText       = "--:--";
    if (elIstirahat) elIstirahat.innerText = "00:00:00";
    if (elDur)       elDur.innerText       = "00:00:00";
    return;
  }

  if (elIn)  elIn.innerText  = fmt(rec.jamMasuk);
  if (elOut) elOut.innerText = rec.jamKeluar ? fmt(rec.jamKeluar) : "--:--";

  const breakSec = hitungBreakDetik(rec.breaks);
  const kerjaSec = hitungKerjaDetik(rec);

  if (elIstirahat) elIstirahat.innerText = fmtBreak(breakSec);
  if (elDur)       elDur.innerText       = fmtDuration(kerjaSec);
}

// ─── TICKER REALTIME ────────────────────────────────────────

function startTicker(rec) {
  stopTicker();
  _todayRec = rec;
  updateTodayUI(rec);

  // Jika sudah clock out tidak perlu ticker
  if (rec && rec.jamKeluar) return;

  _tickerInterval = setInterval(() => {
    const now   = new Date();
    const today = now.toLocaleDateString("sv-SE");

    // Reset tepat tengah malam (00:00:00)
    if (_todayRec && _todayRec.date && _todayRec.date !== today) {
      stopTicker();
      resetTodayUI();
      // Refresh data hari baru
      setTimeout(() => loadTodayDetail(), 1000);
      return;
    }

    updateTodayUI(_todayRec);

    // Auto-proses overtime setiap Minggu 23:59
    if (isMingguMalam()) {
      _doAutoOvertime();
    }
  }, 1000);
}

function stopTicker() {
  if (_tickerInterval) { clearInterval(_tickerInterval); _tickerInterval = null; }
}

function resetTodayUI() {
  _todayRec = null;
  updateTodayUI(null);
}

// ─── AUTO OVERTIME MINGGU 23:59 ─────────────────────────────

let _overtimeProcessedWeek = null;  // agar tidak proses dua kali dalam minggu yang sama

async function _doAutoOvertime() {
  const thisWeek = getWeekKey(todayLocalStr());
  if (_overtimeProcessedWeek === thisWeek) return; // sudah diproses minggu ini
  _overtimeProcessedWeek = thisWeek;

  const user = localStorage.getItem("user");
  if (!user) return;

  try {
    // Panggil endpoint server untuk hitung & simpan overtime user ini
    const tahun = new Date().getFullYear();
    const r = await authFetch(`/kuota-cuti/hitung-overtime/${user}?tahun=${tahun}`, { method: "POST" });
    const d = await r.json();
    if (d.status === "OK") {
      const jam = (d.jamTL_libur || 0) + (d.jamTL_reguler || 0);
      const hari = Math.floor(jam / 5), sisaJ = parseFloat((jam % 5).toFixed(1));
      if (jam > 0) showToast(hari > 0
        ? `🔄 TL minggu ini: ${hari} hari${sisaJ > 0 ? " + " + sisaJ + "j" : ""} → saldo Tukar Libur!`
        : `🔄 TL minggu ini: +${sisaJ}j → saldo Tukar Libur!`);
      const _jam = jam;
      if (jam > 0) {
        showToast(`⏱️ Overtime minggu ini: ${fmtJamOT(jam)} → masuk kuota cuti overtime!`);
      }
    }
  } catch (e) {
    console.warn("Auto overtime gagal:", e);
  }
}

// ─── LOAD DATA HARI INI ─────────────────────────────────────

function hitungDurasiDetik(rec, nowMs) {
  if (!rec || !rec.jamMasuk) return 0;
  const end = rec.jamKeluar ? new Date(rec.jamKeluar).getTime() : nowMs;
  const work = end - new Date(rec.jamMasuk).getTime();
  let bt = 0;
  (rec.breaks || []).forEach(b => {
    const bStart = new Date(b.start).getTime();
    const bEnd   = b.end ? new Date(b.end).getTime() : nowMs;
    bt += bEnd - bStart;
  });
  return Math.max(0, work - bt) / 1000;
}

async function loadTodayDetail() {
  const user  = localStorage.getItem("user");
  const today = todayLocalStr();
  try {
    const r   = await authFetch("/history/" + user);
    const d   = await r.json();
    const rec = d.find(x => x.date === today) || null;
    startTicker(rec);
  } catch {
    startTicker(null);
  }
}

// ─── UPDATE RECORD LOKAL (tanpa fetch ulang) ────────────────

function updateLocalRecord(type, time) {
  if (!_todayRec) {
    if (type === "IN") {
      _todayRec = {
        date:      todayLocalStr(),
        jamMasuk:  time,
        jamKeluar: null,
        breaks:    [],
      };
      startTicker(_todayRec);
    }
    return;
  }
  if (type === "OUT") {
    _todayRec.jamKeluar = time;
    updateTodayUI(_todayRec);
    stopTicker();

    // Hitung jam kerja hari ini untuk info user
    const jamHariIni = hitungJamKerjaRec(_todayRec).toFixed(1);
    const hari       = new Date(_todayRec.date + "T00:00:00").getDay();
    const target     = JAM_NORMAL_PER_HARI[hari] || 0;
    const lebih      = Math.max(0, parseFloat(jamHariIni) - target);
    if (lebih > 0) {
      showToast(`✅ Kerja ${jamHariIni}j hari ini (+${lebih.toFixed(1)}j dari target)`, "success");
    }
  } else if (type === "BREAK_START") {
    _todayRec.breaks.push({ start: time, end: null });
  } else if (type === "BREAK_END") {
    const lb = _todayRec.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  }
}

// ─── INFO MINGGU INI (untuk Beranda) ────────────────────────

// Hitung total jam kerja minggu ini dari history
async function loadWeeklyInfo() {
  const user  = localStorage.getItem("user");
  const today = todayLocalStr();
  const week  = getWeekKey(today);

  try {
    const r   = await authFetch("/history/" + user);
    const all = await r.json();

    // Filter record minggu ini yang sudah clock out
    const mingguIni = all.filter(d => d.jamKeluar && getWeekKey(d.date) === week);
    const totalJam  = mingguIni.reduce((sum, d) => sum + hitungJamKerjaRec(d), 0);
    const overtime  = Math.max(0, totalJam - TARGET_JAM_MINGGU);

    // Update elemen jika ada
    const elWeek = document.getElementById("t-week");
    const elOT   = document.getElementById("t-overtime");
    if (elWeek) elWeek.innerText = totalJam.toFixed(1) + "j";
    if (elOT)   elOT.innerText  = overtime > 0 ? "+" + overtime.toFixed(1) + "j" : "0j";


  } catch (e) {
    console.warn("loadWeeklyInfo gagal:", e);
  }
}

// ─── HOME TAB SWITCHER ──────────────────────────────────────

function switchHomeTab(tab) {
  var panelHari   = document.getElementById('home-panel-hari');
  var panelMinggu = document.getElementById('home-panel-minggu');
  var tabHari     = document.getElementById('home-tab-hari');
  var tabMinggu   = document.getElementById('home-tab-minggu');

  if (tab === 'hari') {
    if (panelHari)   panelHari.style.display   = 'block';
    if (panelMinggu) panelMinggu.style.display = 'none';
    if (tabHari)   { tabHari.style.background   = 'var(--primary)'; tabHari.style.color   = 'white'; }
    if (tabMinggu) { tabMinggu.style.background = 'white';           tabMinggu.style.color = 'var(--muted)'; }
  } else {
    if (panelHari)   panelHari.style.display   = 'none';
    if (panelMinggu) panelMinggu.style.display = 'block';
    if (tabMinggu) { tabMinggu.style.background = 'var(--primary)'; tabMinggu.style.color = 'white'; }
    if (tabHari)   { tabHari.style.background   = 'white';           tabHari.style.color   = 'var(--muted)'; }
  }
}

// ─── KALENDER LIBUR BULAN BERJALAN (HOME) ───────────────────

async function loadHomeLibur() {
  var now    = new Date();
  var year   = now.getFullYear();
  var month  = String(now.getMonth() + 1).padStart(2, '0');
  var prefix = year + '-' + month;

  var BULAN = ['Januari','Februari','Maret','April','Mei','Juni',
               'Juli','Agustus','September','Oktober','November','Desember'];

  var elBulan = document.getElementById('home-libur-bulan');
  var elList  = document.getElementById('home-libur-list');
  if (elBulan) elBulan.textContent = BULAN[now.getMonth()] + ' ' + year;

  try {
    var user  = localStorage.getItem('user') || '';
    var r     = await authFetch('/libur');
    var semua = await r.json();

    var bulanIni = semua.filter(function(h) {
      var ds = h.dateStart || h.date || '';
      var de = h.dateEnd   || ds;
      return ds.startsWith(prefix) || de.startsWith(prefix) ||
             (ds <= prefix + '-31' && de >= prefix + '-01');
    }).filter(function(h) {
      if (h.type === 'nasional') return true;
      if (Array.isArray(h.anggota) && h.anggota.includes(user)) return true;
      return false;
    });

    if (!bulanIni.length) {
      if (elList) elList.innerHTML = '<p style="color:var(--muted);text-align:center;padding:12px;font-size:13px;">Tidak ada hari libur bulan ini</p>';
      return;
    }

    bulanIni.sort(function(a, b) {
      return (a.dateStart || a.date || '').localeCompare(b.dateStart || b.date || '');
    });

    function fmtTglLibur(d) {
      if (!d) return '';
      var parts = d.split('-');
      return parseInt(parts[2]) + ' ' + BULAN[parseInt(parts[1]) - 1];
    }

    function fmtDateLibur(ds, de) {
      if (!de || de === ds) return fmtTglLibur(ds);
      return fmtTglLibur(ds) + ' - ' + fmtTglLibur(de);
    }

    var html = '';
    bulanIni.forEach(function(h) {
      var ds    = h.dateStart || h.date || '';
      var de    = h.dateEnd   || ds;
      var isNas = h.type === 'nasional';
      var tipe  = isNas
        ? '<span style="font-size:10px;padding:2px 8px;border-radius:50px;background:#fce4ec;color:#c62828;font-weight:700;">Nasional</span>'
        : '<span style="font-size:10px;padding:2px 8px;border-radius:50px;background:#e8f5e9;color:#2e7d32;font-weight:700;">Agama</span>';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f2f5;">' +
              '<div>' +
              '<div style="font-size:13px;font-weight:700;color:var(--text);">' + (h.name || '') + '</div>' +
              '<div style="font-size:11px;color:var(--primary);margin-top:2px;">' + fmtDateLibur(ds, de) + '</div>' +
              '</div>' + tipe + '</div>';
    });
    if (elList) elList.innerHTML = html + '<div style="height:4px;"></div>';

  } catch (e) {
    console.warn('loadHomeLibur error:', e);
    if (elList) elList.innerHTML = '<p style="color:var(--muted);text-align:center;padding:12px;font-size:13px;">Gagal memuat data libur</p>';
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  PERMISSION GATE SYSTEM
//  Logika:
//  1. Cek status tiap izin via Permissions API (camera, geolocation)
//  2. Jika state = "prompt"  → tampilkan popup native browser
//  3. Jika state = "denied"  → tampilkan panduan buka Settings
//  4. Gate modal hanya hilang jika SEMUA izin yang diperlukan = "granted"
//  5. Izin diminta SATU PER SATU (sequential), bukan bersamaan
//  6. Setiap kali ada upaya aksi (sign up / absen), cek ulang dan
//     hanya tampilkan popup untuk izin yang belum diberikan
// ═══════════════════════════════════════════════════════════════════════════

// Cache state izin (di-refresh setiap kali dicek ulang)
let _permState = { camera: "unknown", location: "unknown" };
// Callback yang dipanggil saat semua izin granted
let _permResolve = null;
// Mode gate: "signup" | "absen"
let _permGateMode = "";

// FIX: _grantedFlags HARUS dideklarasikan di sini — capacitor-bridge.js mengisinya
// via window._grantedFlags setelah izin native diberikan
if (typeof window._grantedFlags === "undefined") {
  window._grantedFlags = { camera: false, geolocation: false };
}
// Alias lokal agar kode lama yang pakai _grantedFlags (tanpa window.) tetap jalan
const _grantedFlags = window._grantedFlags;

// ── Cek state izin via Permissions API (non-blocking) ──────────────────────
async function queryPermState(name) {
  // name: "camera" | "geolocation"
  if (!navigator.permissions) return "unknown";
  try {
    const status = await navigator.permissions.query({
      name: name === "camera" ? "camera" : "geolocation"
    });
    return status.state; // "granted" | "denied" | "prompt"
  } catch {
    return "unknown";
  }
}

// ── Minta izin kamera (satu kali, hanya trigger popup) ─────────────────────
async function requestCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }, audio: false
    });
    stream.getTracks().forEach(t => t.stop());
    return "granted";
  } catch (e) {
    if (e.name === "NotAllowedError") return "denied";
    return "unknown";
  }
}

// ── Minta izin lokasi (satu kali, hanya trigger popup) ─────────────────────
async function requestLocationPermission() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve("unavailable");
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (err) => resolve(err.code === 1 ? "denied" : "unknown"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ── Refresh cache state kedua izin ─────────────────────────────────────────
async function refreshPermStates() {
  // FIX Capacitor: jangan overwrite status yang sudah granted via native
  if (typeof _grantedFlags !== "undefined") {
    if (!_grantedFlags.camera)     _permState.camera   = await queryPermState("camera");
    if (!_grantedFlags.geolocation) _permState.location = await queryPermState("geolocation");
    // Pastikan flag granted tidak di-reset
    if (_grantedFlags.camera)      _permState.camera   = "granted";
    if (_grantedFlags.geolocation) _permState.location = "granted";
  } else {
    _permState.camera   = await queryPermState("camera");
    _permState.location = await queryPermState("geolocation");
  }
  return _permState;
}

// ── Update tampilan item di modal ───────────────────────────────────────────
function updatePermItemUI(type, state) {
  // type: "camera" | "location"
  const badge = document.getElementById(`perm-badge-${type}`);
  const icon  = document.getElementById(`perm-icon-${type}`);
  const item  = document.getElementById(`perm-item-${type}`);
  if (!badge) return;

  if (state === "granted") {
    badge.textContent        = "✅ Diizinkan";
    badge.style.background   = "#e8f5e9";
    badge.style.color        = "#1b5e20";
    item.style.borderColor   = "#a5d6a7";
    icon.textContent         = type === "camera" ? "📷" : "📍";
  } else if (state === "denied") {
    badge.textContent        = "❌ Ditolak";
    badge.style.background   = "#ffebee";
    badge.style.color        = "#b71c1c";
    item.style.borderColor   = "#ef9a9a";
    icon.textContent         = type === "camera" ? "🚫" : "🚫";
  } else {
    badge.textContent        = "⏳ Belum diizinkan";
    badge.style.background   = "#fff3e0";
    badge.style.color        = "#e65100";
    item.style.borderColor   = "#e8eaf0";
    icon.textContent         = type === "camera" ? "📷" : "📍";
  }
}

// ── Render ulang seluruh modal berdasarkan state terkini ────────────────────
function renderPermGateModal(neededCamera, neededLocation) {
  const titleEl    = document.getElementById("perm-gate-title");
  const descEl     = document.getElementById("perm-gate-desc");
  const btnEl      = document.getElementById("perm-gate-btn");
  const retryBtn   = document.getElementById("perm-retry-btn");
  const settingsDiv = document.getElementById("perm-settings-guide");
  const settingsBtn = document.getElementById("perm-open-settings-btn");
  const stepsEl    = document.getElementById("perm-settings-steps");
  const iconEl     = document.getElementById("perm-gate-icon");

  // Tampilkan hanya item yang diperlukan
  document.getElementById("perm-item-camera").style.display =
    neededCamera ? "flex" : "none";
  document.getElementById("perm-item-location").style.display =
    neededLocation ? "flex" : "none";

  // Update badge masing-masing
  if (neededCamera)   updatePermItemUI("camera",   _permState.camera);
  if (neededLocation) updatePermItemUI("location", _permState.location);

  // Tentukan izin mana yang masih kurang
  const camDenied  = neededCamera  && _permState.camera   === "denied";
  const locDenied  = neededLocation && _permState.location === "denied";
  const camNeeded  = neededCamera  && _permState.camera   !== "granted";
  const locNeeded  = neededLocation && _permState.location !== "granted";
  const anyDenied  = camDenied || locDenied;

  // Buat deskripsi izin yang masih kurang
  const missingLabels = [];
  if (camNeeded)  missingLabels.push("Kamera");
  if (locNeeded)  missingLabels.push("Lokasi");

  if (missingLabels.length === 0) {
    // Semua sudah granted — tutup modal
    closePermGate(true);
    return;
  }

  iconEl.textContent = anyDenied ? "⛔" : "🔐";
  titleEl.textContent = anyDenied
    ? "Izin Ditolak"
    : `Izin ${missingLabels.join(" & ")} Diperlukan`;

  // Tentukan izin mana yang akan diminta BERIKUTNYA (sequential)
  // Kamera dulu, baru lokasi
  let nextPerm = null;
  if (neededCamera  && _permState.camera   === "prompt") nextPerm = "camera";
  else if (neededLocation && _permState.location === "prompt") nextPerm = "location";

  if (anyDenied && !nextPerm) {
    // Semua yang tersisa = denied, tidak bisa pakai popup
    const deniedLabels = [];
    if (camDenied)  deniedLabels.push("Kamera");
    if (locDenied)  deniedLabels.push("Lokasi");
    descEl.textContent =
      `Izin ${deniedLabels.join(" & ")} telah ditolak sebelumnya. ` +
      `Aktifkan secara manual lewat pengaturan HP Anda.`;
    btnEl.style.display    = "none";
    retryBtn.style.display = "block";

    // Panduan Settings
    const steps = [];
    if (camDenied)  steps.push("• Buka Pengaturan → Aplikasi → Absensi Smart → Izin → Kamera → Izinkan");
    if (locDenied)  steps.push("• Buka Pengaturan → Aplikasi → Absensi Smart → Izin → Lokasi → Izinkan Selalu");
    stepsEl.innerHTML = steps.join("<br>");
    settingsDiv.style.display = "block";
    settingsBtn.style.display = "block";

  } else if (nextPerm) {
    // Ada izin yang bisa di-prompt
    const label = nextPerm === "camera" ? "Kamera" : "Lokasi";
    descEl.textContent =
      `Aplikasi memerlukan izin ${missingLabels.join(" & ")} untuk berjalan. ` +
      `Ketuk tombol di bawah dan pilih "Izinkan" pada popup yang muncul.`;
    btnEl.textContent      = `📲 Izinkan ${label}`;
    btnEl.style.display    = "block";
    settingsDiv.style.display = "none";
    settingsBtn.style.display = "none";
    retryBtn.style.display = "none";

  } else {
    // Mixed: sebagian denied, sebagian prompt — tampilkan yang bisa di-prompt dulu
    descEl.textContent =
      `Beberapa izin belum diberikan. Ketuk "Izinkan" untuk melanjutkan.`;
    btnEl.textContent      = "📲 Izinkan Akses";
    btnEl.style.display    = "block";
    settingsDiv.style.display = anyDenied ? "block" : "none";
    settingsBtn.style.display = anyDenied ? "block" : "none";
    retryBtn.style.display = "none";
  }
}

// ── Aksi tombol utama di modal ──────────────────────────────────────────────
// Dipanggil saat user klik "Izinkan ..."
let _permNeededCamera = true;
let _permNeededLocation = true;
let _permRequesting = false;

async function permGateAction() {
  if (_permRequesting) return;
  _permRequesting = true;

  const btn = document.getElementById("perm-gate-btn");
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Menunggu izin...";

  // Minta izin SATU PER SATU — kamera dulu jika belum granted
  if (_permNeededCamera && _permState.camera !== "granted") {
    updatePermItemUI("camera", "prompt");
    const camResult = await requestCameraPermission();
    _permState.camera = camResult;
    updatePermItemUI("camera", camResult);

    // Jika kamera baru saja granted, cek apakah lokasi juga perlu
    if (camResult === "granted" && _permNeededLocation && _permState.location !== "granted") {
      // Kamera beres — sekarang minta lokasi
      btn.textContent = "⏳ Menunggu izin lokasi...";
      updatePermItemUI("location", "prompt");
      const locResult = await requestLocationPermission();
      _permState.location = locResult;
      updatePermItemUI("location", locResult);
    }
  } else if (_permNeededLocation && _permState.location !== "granted") {
    // Kamera sudah granted, langsung minta lokasi
    btn.textContent = "⏳ Menunggu izin lokasi...";
    updatePermItemUI("location", "prompt");
    const locResult = await requestLocationPermission();
    _permState.location = locResult;
    updatePermItemUI("location", locResult);
  }

  btn.disabled  = false;
  btn.textContent = origText;
  _permRequesting = false;

  // Render ulang modal dengan state terbaru
  renderPermGateModal(_permNeededCamera, _permNeededLocation);
}

// ── Tombol "Sudah diizinkan, coba lagi" ────────────────────────────────────
async function permGateRetry() {
  const retryBtn = document.getElementById("perm-retry-btn");
  retryBtn.disabled = true;
  retryBtn.textContent = "⏳ Memeriksa...";

  await refreshPermStates();
  renderPermGateModal(_permNeededCamera, _permNeededLocation);

  retryBtn.disabled = false;
  retryBtn.textContent = "🔄 Sudah diizinkan, coba lagi";
}

// ── Buka pengaturan aplikasi (Android intent) ───────────────────────────────
function openAppSettings() {
  // TWA Android: intent ke settings aplikasi
  // Di browser biasa akan diabaikan — tidak ada cara lintas platform
  try {
    window.location.href = "intent://settings#Intent;scheme=android-app;end";
  } catch {
    // fallback: beri panduan teks
  }
  showToast("Buka Pengaturan HP → Aplikasi → Absensi Smart → Izin", "warning", 8000);
}

// ── Tutup permission gate ───────────────────────────────────────────────────
function closePermGate(success) {
  const overlay = document.getElementById("perm-gate-overlay");
  if (overlay) overlay.style.display = "none";
  if (success && typeof _permResolve === "function") {
    _permResolve(true);
    _permResolve = null;
  }
}

// ── Fungsi utama: tampilkan gate dan tunggu hingga izin lengkap ─────────────
// needCamera: bool, needLocation: bool
// Return: Promise<boolean> — true jika semua izin granted
async function requirePermissions(needCamera = true, needLocation = true) {
  _permNeededCamera   = needCamera;
  _permNeededLocation = needLocation;

  // Refresh state terkini dari Permissions API
  await refreshPermStates();

  // Cek apakah semua yang diperlukan sudah granted
  const camOk = !needCamera  || _permState.camera   === "granted";
  const locOk = !needLocation || _permState.location === "granted";
  if (camOk && locOk) return true;

  // Jika ada yang belum granted, tampilkan gate modal
  const overlay = document.getElementById("perm-gate-overlay");
  overlay.style.display = "flex";
  renderPermGateModal(needCamera, needLocation);

  // Tunggu sampai closePermGate(true) dipanggil
  return new Promise(resolve => {
    _permResolve = resolve;
    // Auto-resolve jika user tidak melakukan apa-apa (dipantau tiap 1 detik)
    // Ini menangani kasus: user izinkan dari luar app lalu kembali
    const interval = setInterval(async () => {
      // FIX Capacitor: prioritaskan _grantedFlags agar tidak bolak-balik
      if (typeof _grantedFlags !== "undefined") {
        if (needCamera   && _grantedFlags.camera)     _permState.camera   = "granted";
        if (needLocation && _grantedFlags.geolocation) _permState.location = "granted";
      }

      // Hanya query ulang jika belum granted via flag
      if (!(needCamera && _permState.camera === "granted") ||
          !(needLocation && _permState.location === "granted")) {
        await refreshPermStates();
        // Cek lagi setelah refresh — jangan overwrite yang sudah granted
        if (typeof _grantedFlags !== "undefined") {
          if (needCamera   && _grantedFlags.camera)     _permState.camera   = "granted";
          if (needLocation && _grantedFlags.geolocation) _permState.location = "granted";
        }
      }

      const cOk = !needCamera   || _permState.camera   === "granted";
      const lOk = !needLocation || _permState.location === "granted";
      if (cOk && lOk) {
        clearInterval(interval);
        updatePermItemUI("camera",   _permState.camera);
        updatePermItemUI("location", _permState.location);
        closePermGate(true);
      } else {
        if (needCamera)   updatePermItemUI("camera",   _permState.camera);
        if (needLocation) updatePermItemUI("location", _permState.location);
      }
    }, 1500);

    // Simpan interval id agar bisa di-clear saat gate ditutup paksa
    overlay._checkInterval = interval;
  });
}

// ── Backward-compat: requestPermissions() → sekarang pakai gate ─────────────
// Dipakai oleh toggleAuthMode dan doSignUp lama
async function requestPermissions() {
  const granted = await requirePermissions(true, true);
  await refreshPermStates();
  return {
    camera:   _permState.camera   === "granted",
    location: _permState.location === "granted"
  };
}

// ─── Ambil koordinat — return null jika izin ditolak (jangan silent fallback ke 0,0) ───
// ========================
// PUSH NOTIFICATION
// ========================
async function subscribePushNotification() {
  // Cek support dasar
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("[PUSH] PushManager tidak didukung di perangkat ini");
    return;
  }

  try {
    // Ambil VAPID public key dari server
    const r = await fetch("/push/vapid-public-key");
    if (!r.ok) return; // Server belum setup VAPID
    const { key } = await r.json();
    if (!key) return;

    // ── TWA Android: Notification.permission mungkin "default" tapi izin sudah diberikan
    // Selalu coba requestPermission — di TWA tidak muncul dialog jika sudah diizinkan
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      console.warn("[PUSH] Izin notifikasi tidak diberikan:", permission);
      return;
    }

    // Tunggu service worker siap (penting di TWA — SW perlu waktu aktivasi)
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SW timeout")), 10000))
    ]);

    // Hapus subscription lama jika ada (untuk menghindari stale subscription di TWA)
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Cek apakah endpoint masih valid dengan server
      const check = await authFetch("/push/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => null);

      // Jika server bilang subscription sudah expired, unsubscribe dan buat baru
      if (!check || check.status === 410) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }

    // Buat subscription baru jika belum ada
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    // Kirim ke server
    await authFetch("/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });

    console.log("[PUSH] ✅ Push subscription berhasil");
  } catch (e) {
    // Tidak perlu error ke user — fitur opsional
    console.warn("[PUSH] Subscribe gagal:", e.message || e);
  }
}

// Helper: konversi VAPID key base64 ke Uint8Array (dibutuhkan pushManager.subscribe)
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = window.atob(base64);
  const arr     = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getLoc() {
  // ── Cek izin dulu via Permissions API ──────────────────────────────────────
  if (navigator.permissions) {
    try {
      const permStatus = await navigator.permissions.query({ name: "geolocation" });
      if (permStatus.state === "denied") {
        showToast("❌ Izin lokasi ditolak. Buka Pengaturan HP → Aplikasi → Absensi Smart → Izin → Lokasi → Izinkan.", "error", 8000);
        return { lat: 0, lng: 0, accuracy: 0, denied: true };
      }
    } catch { /* browser lama, lanjut */ }
  }

  if (!navigator.geolocation) {
    return { lat: 0, lng: 0, accuracy: 0, denied: true };
  }

  showToast("📍 Mendeteksi lokasi...", "warning", 12000);

  // ── Strategi: RACE antara 3 metode sekaligus ────────────────────────────────
  // Metode 1: Cache terbaru (paling cepat — hasilnya instan jika GPS sudah warm)
  // Metode 2: Network/WiFi low-accuracy (cepat, ~2-5 detik)
  // Metode 3: watchPosition GPS high-accuracy (paling akurat, tapi butuh ~10 detik cold-start)
  // → Siapa yang berhasil pertama dengan accuracy ≤ 200m, itu yang dipakai
  // → Jika semua gagal, ambil hasil terbaik yang ada

  return new Promise(resolve => {
    let settled  = false;
    let bestResult = null;
    let pending  = 0;
    const watchIds = [];

    function makeResult(p) {
      return {
        lat:      p.coords.latitude,
        lng:      p.coords.longitude,
        accuracy: p.coords.accuracy || 999,
        denied:   false,
        timedOut: false,
      };
    }

    function tryDone(result, force = false) {
      if (settled) return;
      // Simpan hasil terbaik (accuracy terkecil)
      if (!bestResult || result.accuracy < bestResult.accuracy) bestResult = result;
      // Selesai jika: accuracy bagus (≤200m) atau dipaksa selesai
      if (result.accuracy <= 200 || force) {
        settled = true;
        watchIds.forEach(id => { try { navigator.geolocation.clearWatch(id); } catch {} });
        resolve(bestResult);
      }
    }

    function onError(err) {
      pending--;
      if (err.code === 1) { // PERMISSION_DENIED
        settled = true;
        watchIds.forEach(id => { try { navigator.geolocation.clearWatch(id); } catch {} });
        showToast("❌ Izin lokasi ditolak. Buka Pengaturan HP → Aplikasi → Absensi Smart → Izin → Lokasi → Izinkan.", "error", 8000);
        resolve({ lat: 0, lng: 0, accuracy: 0, denied: true, timedOut: false });
      } else if (pending <= 0 && !settled) {
        // Semua metode gagal
        if (bestResult) {
          tryDone(bestResult, true);
        } else {
          settled = true;
          showToast("❌ Gagal mendapatkan lokasi. Pastikan GPS aktif dan coba lagi.", "error", 5000);
          resolve({ lat: 0, lng: 0, accuracy: 0, denied: false, timedOut: true });
        }
      }
    }

    // Metode 1: getCurrentPosition dengan cache (cepat — untuk GPS yang sudah warm)
    pending++;
    navigator.geolocation.getCurrentPosition(
      p => { pending--; tryDone(makeResult(p)); },
      err => onError(err),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 }
    );

    // Metode 2: Network/WiFi low-accuracy (cepat untuk Android dalam gedung)
    pending++;
    navigator.geolocation.getCurrentPosition(
      p => { pending--; tryDone(makeResult(p)); },
      err => onError(err),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );

    // Metode 3: watchPosition high-accuracy — paling andal untuk Android cold-start
    // Ambil update pertama yang datang
    pending++;
    let watchGotFirst = false;
    const watchTimer = setTimeout(() => {
      if (!watchGotFirst) onError({ code: 3 }); // timeout
    }, 15000);

    const wid = navigator.geolocation.watchPosition(
      p => {
        if (!watchGotFirst) {
          watchGotFirst = true;
          clearTimeout(watchTimer);
          pending--;
        }
        tryDone(makeResult(p)); // update terus jika accuracy membaik
      },
      err => {
        clearTimeout(watchTimer);
        if (!watchGotFirst) onError(err);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    watchIds.push(wid);

    // Safety: paksa selesai setelah 18 detik apapun yang terjadi
    setTimeout(() => {
      if (!settled) {
        if (bestResult) tryDone(bestResult, true);
        else {
          settled = true;
          showToast("❌ Gagal mendapatkan lokasi. Pastikan GPS aktif dan coba lagi.", "error", 5000);
          resolve({ lat: 0, lng: 0, accuracy: 0, denied: false, timedOut: true });
        }
      }
    }, 18000);
  });
}

function fmt(iso) {
  if (!iso) return "--:--";
  if (/^\d{2}:\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d)) return "--:--";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ============================================================
// REKAP
// ============================================================
// ============================================================
// REKAP — state
// ============================================================
let _rekapData  = null;
let _rekapMonth = null;

const R_DOW_LABEL = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
const R_DOW_COLOR = { 0:"#e53935", 6:"#9c27b0" };

function rFmtJam(jam) {
  if (!jam || jam <= 0) return "";
  const h = Math.floor(jam);
  const m = Math.round((jam - h) * 60);
  return m > 0 ? `${h}j${m}m` : `${h}j`;
}

// Auto-refresh rekap setiap 60 detik jika bulan sekarang sedang ditampilkan
let _rekapRefreshTimer = null;
function startRekapAutoRefresh() {
  if (_rekapRefreshTimer) clearInterval(_rekapRefreshTimer);
  _rekapRefreshTimer = setInterval(() => {
    const nowMonth = new Date().toISOString().slice(0, 7);
    if (_rekapMonth === nowMonth && userLevel <= 2) {
      loadRekap();
    }
  }, 60000); // refresh tiap 60 detik
}

async function loadRekap() {
  // Hanya owner/admin
  if (userLevel > 2) {
    document.getElementById("rekap-content").innerHTML =
      `<div style="text-align:center;padding:40px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">⛔</div>
        <div style="font-weight:700;font-size:16px;color:var(--danger);">Akses Ditolak</div>
        <div style="font-size:13px;color:var(--muted);margin-top:6px;">Hanya Owner dan Admin yang dapat mengakses Rekap.</div>
      </div>`;
    return;
  }

  const me      = localStorage.getItem("user");
  const monthEl = document.getElementById("rekap-month");
  if (!monthEl.value) monthEl.value = new Date().toISOString().slice(0, 7);
  _rekapMonth = monthEl.value;

  const el = document.getElementById("rekap-content");
  el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:32px;">⏳ Memuat rekap...</p>`;

  try {
    const r = await authFetch(`/rekap/monthly?month=${_rekapMonth}`);
    _rekapData = await r.json();

    // Isi dropdown filter minggu
    const selMinggu = document.getElementById("rekap-filter-minggu");
    if (selMinggu) {
      selMinggu.innerHTML = '<option value="">Semua Minggu</option>' +
        (_rekapData.weeks || []).map(w =>
          `<option value="${w.weekIdx}">${w.weekLabel} (${w.weekRange})</option>`
        ).join("");
    }

    rekapRender();
    // Mulai auto-refresh jika bulan ini
    const nowMonth = new Date().toISOString().slice(0, 7);
    if (_rekapMonth === nowMonth) startRekapAutoRefresh();
    else if (_rekapRefreshTimer) { clearInterval(_rekapRefreshTimer); _rekapRefreshTimer = null; }
  } catch(e) {
    el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:24px;">❌ Gagal memuat rekap</p>`;
  }
}

function rekapRender() {
  const el = document.getElementById("rekap-content");
  if (!el || !_rekapData) return;

  const q         = (document.getElementById("rekap-search")?.value || "").toLowerCase();
  const filterW   = parseInt(document.getElementById("rekap-filter-minggu")?.value || "") || 0;
  const today     = todayLocalStr();

  const allUsers  = (_rekapData.users || []);
  const filtered  = allUsers.filter(u =>
    (u.nama || u.username).toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
  );

  if (!filtered.length) {
    el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Tidak ada data</p>`;
    return;
  }

  // Tentukan hari yang akan ditampilkan
  let weeks   = _rekapData.weeks || [];
  let allDates = _rekapData.allDates || [];

  if (filterW) {
    const w = weeks.find(ww => ww.weekIdx === filterW);
    if (w) {
      weeks    = [w];
      allDates = w.dates;
    }
  }

  // ─── BANGUN HEADER ───────────────────────────────────────────
  // Kolom: [Nama | Jabatan | [hari...total_minggu]... per minggu | Total Bulan]
  // Setiap minggu: N kolom hari + 1 kolom total (border kiri tebal)

  let headerHtml = `
    <th rowspan="2" style="text-align:left;padding:8px 10px;font-size:10px;color:var(--muted);
        text-transform:uppercase;letter-spacing:.4px;position:sticky;left:0;background:#f8f9ff;
        min-width:150px;z-index:3;white-space:nowrap;border-right:1px solid #e8ecf0;">Anggota</th>`;

  weeks.forEach((week, wi) => {
    const isLast = wi === weeks.length - 1;
    // Kolom hari
    week.dates.forEach(date => {
      const d   = new Date(date + "T00:00:00");
      const dow = d.getDay();
      const isToday = date === today;
      const color = R_DOW_COLOR[dow] || "var(--text)";
      headerHtml += `
        <th style="text-align:center;min-width:42px;padding:5px 2px;
            background:${isToday ? "#e8f5e9" : "#f8f9ff"};
            color:${isToday ? "#2e7d32" : color};font-size:10px;font-weight:700;
            border-right:1px solid #eee;">
          <div>${R_DOW_LABEL[dow]}</div>
          <div style="font-size:9px;font-weight:400;opacity:.7;">${d.getDate()}/${d.getMonth()+1}</div>
        </th>`;
    });
    // Kolom total minggu
    headerHtml += `
      <th style="text-align:center;min-width:52px;padding:5px 4px;background:#f0f4ff;
          font-size:10px;color:#3949ab;font-weight:700;
          border-left:3px solid #c5cae9;${!isLast ? "border-right:3px solid #9fa8da;" : ""}">
        <div>Total</div>
        <div style="font-size:9px;font-weight:400;">${week.weekLabel}</div>
      </th>`;
  });

  // Kolom total bulan (hanya jika tampil semua minggu)
  if (!filterW) {
    headerHtml += `
      <th style="text-align:center;min-width:58px;padding:5px 4px;background:#e8f5e9;
          font-size:10px;color:#1b5e20;font-weight:700;border-left:3px solid #a5d6a7;">
        <div>Total</div>
        <div style="font-size:9px;font-weight:400;">Bulan</div>
      </th>`;
  }

  // ─── BANGUN BARIS ─────────────────────────────────────────────
  const rows = filtered.map(u => {
    // Avatar — photo tidak disertakan di response rekap, gunakan inisial
    const _rjInfo   = _jabatanInfo(u.group, u.jabatan);
    const _rAvBg    = (_GROUP_LABEL[(u.group||"").toLowerCase()] || {color:"#546e7a"}).color;
    const avatarHtml = `<div style="width:26px;height:26px;border-radius:50%;background:${_rAvBg};
          display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:10px;flex-shrink:0;">
        ${(u.nama||u.username).charAt(0).toUpperCase()}</div>`;

    let rowHtml = `<tr style="border-bottom:1px solid #f0f2f5;">
      <td style="padding:6px 10px;position:sticky;left:0;background:white;z-index:1;border-right:1px solid #e8ecf0;">
        <div style="display:flex;align-items:center;gap:6px;">
          ${avatarHtml}
          <div style="min-width:0;">
            <div style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">${u.nama||u.username}</div>
            <div style="font-size:9px;color:${_rjInfo.color};font-weight:600;">${_rjInfo.label}</div>
          </div>
        </div>
      </td>`;

    weeks.forEach((week, wi) => {
      const isLast = wi === weeks.length - 1;
      // Sel per hari
      week.dates.forEach(date => {
        const day = u.days.find(d => d.date === date);
        const dow = day ? day.dow : new Date(date + "T00:00:00").getDay();
        const isToday  = date === today;
        const isWeekend = dow === 0;
        const jamKerja  = day ? day.jamKerja : 0;
        const jamCuti   = day ? day.jamCuti  : 0;
        const hasCuti   = jamCuti > 0;
        const hasKerja  = jamKerja > 0;

        let cell = "";
        if (isWeekend) {
          cell = `<span style="color:#e0e0e0;font-size:10px;">—</span>`;
        } else if (hasCuti && hasKerja) {
          cell = `<div style="font-size:10px;font-weight:700;">${rFmtJam(jamKerja)}</div>
                  <div style="font-size:9px;color:#1565c0;">+${rFmtJam(jamCuti)}</div>
                  <div style="font-size:8px;color:#1976d2;background:#e3f2fd;border-radius:3px;
                       padding:0 3px;margin-top:1px;line-height:1.4;max-width:38px;overflow:hidden;
                       text-overflow:ellipsis;white-space:nowrap;" title="${day.keteranganCuti||''}">${day.keteranganCuti||'Cuti'}</div>`;
        } else if (hasCuti) {
          cell = `<div style="font-size:10px;color:#1565c0;font-weight:700;">${rFmtJam(jamCuti)}</div>
                  <div style="font-size:8px;color:#1976d2;background:#e3f2fd;border-radius:3px;
                       padding:0 3px;margin-top:1px;line-height:1.4;max-width:38px;overflow:hidden;
                       text-overflow:ellipsis;white-space:nowrap;" title="${day.keteranganCuti||''}">${day.keteranganCuti||'Cuti'}</div>`;
        } else if (hasKerja) {
          cell = `<div style="font-size:10px;font-weight:700;">${rFmtJam(jamKerja)}</div>`;
        } else {
          cell = `<span style="color:#e8e8e8;font-size:10px;">—</span>`;
        }

        rowHtml += `<td style="text-align:center;padding:5px 2px;
            background:${isToday ? "#f1f8e9" : hasCuti&&!hasKerja ? "#fafbff" : ""};
            vertical-align:middle;border-right:1px solid #f5f5f5;">${cell}</td>`;
      });

      // Total minggu ini
      const wt = u.weekTotals?.find(ww => ww.weekIdx === week.weekIdx);
      const tot = wt ? wt.totalEfektif : 0;
      const totalColor = tot < 40 ? "#e53935" : "#2e7d32";
      const totalBg    = tot < 40 ? "#fff8f8" : "#f0fff4";
      const kurang     = Math.max(0, 40 - tot);
      rowHtml += `<td style="text-align:center;padding:5px 6px;background:${totalBg};
          border-left:3px solid #c5cae9;${!isLast ? "border-right:3px solid #9fa8da;" : ""}
          vertical-align:middle;">
        <div style="font-weight:900;font-size:11px;color:${totalColor};">${rFmtJam(tot)||"0j"}</div>
        ${kurang > 0 ? `<div style="font-size:8px;color:#e53935;">-${rFmtJam(kurang)}</div>` : ""}
      </td>`;
    });

    // Total bulan
    if (!filterW) {
      const totB = u.totalBulan || 0;
      const totBColor = totB < 40 * weeks.length ? "#e53935" : "#2e7d32";
      rowHtml += `<td style="text-align:center;padding:5px 6px;background:#f0fff4;
          border-left:3px solid #a5d6a7;vertical-align:middle;">
        <div style="font-weight:900;font-size:11px;color:${totBColor};">${rFmtJam(totB)||"0j"}</div>
      </td>`;
    }

    rowHtml += `</tr>`;
    return rowHtml;
  }).join("");

  el.innerHTML = `
    <div style="overflow-x:auto;border-radius:12px;border:1px solid #e8ecf0;
                background:white;box-shadow:0 2px 8px rgba(0,0,0,.05);">
      <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:500px;">
        <thead>
          <tr style="border-bottom:2px solid #e8ecf0;">
            ${headerHtml}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ============================================================
// DOWNLOAD REKAP XLSX
// ============================================================
async function downloadRekapXLSX() {
  if (userLevel > 2) { showToast("⛔ Hanya Owner/Admin yang bisa download rekap", "error"); return; }
  if (!_rekapData?.users) { showToast("⚠️ Tampilkan rekap terlebih dahulu", "warning"); return; }

  if (typeof XLSX === "undefined") {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const BULAN_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli",
                    "Agustus","September","Oktober","November","Desember"];
  const DOW_S    = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
  const wb       = XLSX.utils.book_new();
  const weeks    = _rekapData.weeks || [];
  const users    = _rekapData.users || [];
  const [yr, mo] = _rekapMonth.split("-").map(Number);

  function fmtJamXlsx(jam) {
    if (!jam || jam <= 0) return "-";
    const h = Math.floor(jam), m = Math.round((jam-h)*60);
    return m > 0 ? `${h}j ${m}m` : `${h}j`;
  }

  // ── Sheet 1: Rekap Lengkap ──
  const wsData = [];
  wsData.push([`REKAP ABSENSI — ${BULAN_ID[mo-1]} ${yr}`]);
  wsData.push([`Diekspor: ${new Date().toLocaleString("id-ID")}`]);
  wsData.push([]);

  // Header baris 1 — label minggu (merge atas hari)
  const h1 = ["Nama","Jabatan"];
  weeks.forEach(w => {
    w.dates.forEach(() => h1.push(""));
    h1[h1.length - w.dates.length] = `${w.weekLabel} (${w.weekRange})`;
    h1.push(`Total ${w.weekLabel}`);
  });
  h1.push("Total Bulan");
  wsData.push(h1);

  // Header baris 2 — nama hari
  const h2 = ["",""];
  weeks.forEach(w => {
    w.dates.forEach(date => {
      const d = new Date(date+"T00:00:00");
      h2.push(`${DOW_S[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`);
    });
    h2.push("");
  });
  h2.push("");
  wsData.push(h2);

  // Baris per user
  users.forEach(u => {
    const row = [u.nama||u.username, u.jabatan];
    weeks.forEach(w => {
      w.dates.forEach(date => {
        const day = u.days.find(d => d.date === date);
        const tot = day ? day.jamKerja + day.jamCuti : 0;
        const dow = day ? day.dow : new Date(date+"T00:00:00").getDay();
        if (dow === 0) { row.push("Libur"); return; }
        row.push(fmtJamXlsx(tot));
      });
      const wt = u.weekTotals?.find(ww => ww.weekIdx === w.weekIdx);
      row.push(fmtJamXlsx(wt?.totalEfektif || 0));
    });
    row.push(fmtJamXlsx(u.totalBulan || 0));
    wsData.push(row);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(wsData);
  const colWidths = [{ wch: 22 }, { wch: 14 }];
  weeks.forEach(w => { w.dates.forEach(() => colWidths.push({ wch: 9 })); colWidths.push({ wch: 12 }); });
  colWidths.push({ wch: 12 });
  ws1["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws1, "Rekap Lengkap");

  // ── Sheet 2: Ringkasan Mingguan ──
  const ws2Data = [];
  ws2Data.push([`RINGKASAN MINGGUAN — ${BULAN_ID[mo-1]} ${yr}`]);
  ws2Data.push([]);
  ws2Data.push(["Nama","Jabatan",...weeks.map(w => `${w.weekLabel} (${w.weekRange})`),"Total Bulan"]);
  users.forEach(u => {
    const row = [u.nama||u.username, u.jabatan];
    weeks.forEach(w => {
      const wt = u.weekTotals?.find(ww => ww.weekIdx === w.weekIdx);
      row.push(fmtJamXlsx(wt?.totalEfektif || 0));
    });
    row.push(fmtJamXlsx(u.totalBulan || 0));
    ws2Data.push(row);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
  ws2["!cols"] = [{ wch:22 },{ wch:14 },...weeks.map(() => ({ wch:16 })),{ wch:14 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Ringkasan Mingguan");

  XLSX.writeFile(wb, `Rekap_${_rekapMonth}.xlsx`);
  showToast("✅ File rekap berhasil diunduh!");
}

// ============================================================
// ADMIN
// ============================================================
async function loadAdmin() {
  const date   = document.getElementById("adm-date").value || todayLocalStr();
  const search = (document.getElementById("adm-search").value||"").toLowerCase();
  try {
    const r = await authFetch("/admin/today?date="+date);
    const d = await r.json();
    document.getElementById("adm-total").innerText = d.totalUsers;
    document.getElementById("adm-hadir").innerText = d.records.filter(x=>x.status!=="OUT").length;
    const filtered = d.records
      .filter(x=>x.user.toLowerCase().includes(search))
      .sort((a, b) => (a.namaLengkap || a.user || '').localeCompare(b.namaLengkap || b.user || '', 'id'));
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
  const isDaftar     = tab === "daftar";
  const isDivisi     = tab === "divisi";
  const isPengaturan = tab === "pengaturan-karyawan";

  document.getElementById("panel-daftar").classList.toggle("hidden", !isDaftar);
  document.getElementById("panel-divisi").classList.toggle("hidden", !isDivisi);
  document.getElementById("panel-pengaturan-karyawan").classList.toggle("hidden", !isPengaturan);

  const tDaftar     = document.getElementById("tab-daftar");
  const tDivisi     = document.getElementById("tab-divisi");
  const tPengaturan = document.getElementById("tab-pengaturan-karyawan");

  [tDaftar, tDivisi, tPengaturan].forEach(t => {
    if (t) { t.style.background = "white"; t.style.color = "var(--muted)"; }
  });
  const active = isDaftar ? tDaftar : isDivisi ? tDivisi : tPengaturan;
  if (active) { active.style.background = "var(--primary)"; active.style.color = "white"; }

  if (isDivisi)     loadDivisi();
  if (isPengaturan) loadRules();
}

// ================================================================
// ANGGOTA — Daftar & Detail
// ================================================================
let _anggotaData     = [];   // cache hasil GET /anggota
let _anggotaGroups   = [];   // cache GET /groups
let _anggotaDivisi   = [];   // cache GET /divisi

/** Konversi ISO timestamp ke "X jam yang lalu" */
function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return "—";
  const m  = Math.floor(diff / 60000);
  const h  = Math.floor(diff / 3600000);
  const d  = Math.floor(diff / 86400000);
  const mo = Math.floor(d / 30);
  if (m < 1)  return "baru saja";
  if (m < 60) return m + " menit yang lalu";
  if (h < 24) return h + " jam yang lalu";
  if (d < 30) return d + " hari yang lalu";
  return mo + " bulan yang lalu";
}

async function loadAnggota() {
  try {
    const [anggotaRes, groupsRes, divisiRes] = await Promise.all([
      authFetch("/anggota"), authFetch("/groups"), authFetch("/divisi")
    ]);
    _anggotaData   = await anggotaRes.json();
    _anggotaGroups = await groupsRes.json();
    _anggotaDivisi = await divisiRes.json();
    _divisiList    = _anggotaDivisi; // sinkronkan cache _divisiList agar renderAnggotaTable bisa baca

    // Tombol Tambahkan Anggota — hanya owner/admin
    const isAdmin = userLevel <= 2;
    const btnTambah = document.getElementById("btn-tambah-anggota");
    if (btnTambah) btnTambah.style.display = isAdmin ? "inline-block" : "none";

    renderAnggotaTable(_anggotaData);
  } catch {
    document.getElementById("member-list").innerHTML =
      '<p style="color:var(--muted);text-align:center;padding:20px;">Gagal memuat</p>';
  }
}

function renderAnggotaTable(list) {
  const el      = document.getElementById("member-list");
  const countEl = document.getElementById("anggota-count");
  if (countEl) countEl.textContent = list.length + " anggota";

  // Sort A-Z berdasarkan nama
  list = [...list].sort((a, b) => (a.namaLengkap || a.username || '').localeCompare(b.namaLengkap || b.username || '', 'id'));

  if (!list.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px;">Tidak ada anggota</p>';
    return;
  }

  el.innerHTML = list.map(m => {
    const nama    = m.namaLengkap || m.username;
    const jabatan = m.jabatan || m.groupName;
    const isTL    = m.statusKerja === "Tugas Luar";

    // --- Kolom Divisi: hitung real-time dari _divisiList (bukan data cache user) ---
    const divisiArr = Array.isArray(m.divisi) ? m.divisi : (m.divisi ? [m.divisi] : []);
    // Sinkronisasi: cek juga dari _divisiList agar langsung update saat baru buat divisi
    const divisiDariList = _divisiList
      .filter(d =>
        d.owner === m.username || d.manager === m.username ||
        d.koordinator === m.username ||
        (Array.isArray(d.anggota) && d.anggota.includes(m.username))
      )
      .map(d => d.nama);
    // Gabungkan keduanya (union), hapus duplikat
    const allDivisi = [...new Set([...divisiArr, ...divisiDariList])];
    const divLabel  = allDivisi.length
      ? allDivisi.map(d => `<span style="display:inline-block;background:#e8f0fe;color:var(--primary);
          border-radius:50px;padding:1px 8px;font-size:11px;font-weight:600;margin:1px 2px 1px 0;">${d}</span>`).join('')
      : '<span style="color:#ccc;">—</span>';

    // Warna nama & avatar selaras GROUP_META
    const _GC = { owner:"#e8541e", admin:"#1a6ac7", manager:"#00796b", koordinator:"#5c35c9", anggota:"#546e7a" };
    const namaColor = _GC[m.group] || "#2c3e50";
    const avatarBg  = _GC[m.group] || "#546e7a";

    // Avatar: foto atau inisial
    const avStyle = `width:40px;height:40px;border-radius:50%;flex-shrink:0;object-fit:cover;`;
    const avatar  = m.photo
      ? `<img src="${m.photo}" style="${avStyle}">`
      : `<div style="${avStyle}background:${avatarBg};color:white;
           display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">
           ${nama.charAt(0).toUpperCase()}</div>`;

    // Badge tugas luar
    const tlBadge = isTL
      ? `<span style="font-size:10px;padding:1px 7px;border-radius:50px;background:#fff3e0;color:#e65100;
           font-weight:700;margin-left:5px;vertical-align:middle;">Tugas Luar</span>`
      : "";

    return `
      <div onclick="openDetailAnggota('${m.username}')"
        style="display:grid;grid-template-columns:2fr 1.2fr 1fr;align-items:center;
               padding:11px 14px;border-bottom:1px solid #f5f5f5;cursor:pointer;
               transition:background .15s;" onmouseover="this.style.background='#fafafa'"
               onmouseout="this.style.background='transparent'">
        <!-- Kolom 1: Avatar + Nama + Jabatan -->
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          ${avatar}
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:700;color:${namaColor};white-space:nowrap;
                        overflow:hidden;text-overflow:ellipsis;">${nama}${tlBadge}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:1px;">${jabatan}</div>
          </div>
        </div>
        <!-- Kolom 2: Divisi (bisa multi) -->
        <div style="font-size:12px;color:#555;padding-right:6px;line-height:1.6;">${divLabel}</div>
        <!-- Kolom 3: Terakhir Aktif -->
        <div style="font-size:12px;color:var(--muted);">${timeAgo(m.lastSeen)}</div>
      </div>`;
  }).join('');
}

function filterAnggota() {
  const q   = (document.getElementById("anggota-search")?.value || "").toLowerCase();
  const out = _anggotaData.filter(m => {
    const nama = (m.namaLengkap || m.username).toLowerCase();
    return !q || nama.includes(q) || m.username.toLowerCase().includes(q);
  });
  renderAnggotaTable(out);
}

function openTambahAnggota() {
  // Bersihkan field sebelum buka
  ["ta-username","ta-password","ta-nama"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const agama = document.getElementById("ta-agama");
  if (agama) agama.value = "";
  document.getElementById("modal-tambah-anggota").style.display = "flex";
}

function closeTambahAnggota() {
  document.getElementById("modal-tambah-anggota").style.display = "none";
}

function _taToggleEye() {
  const inp = document.getElementById("ta-password");
  const btn = document.getElementById("ta-eye-btn");
  if (!inp) return;
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  btn.textContent = show ? "🙈" : "👁️";
}

async function saveTambahAnggota() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  const username    = (document.getElementById("ta-username")?.value || "").trim();
  const password    = document.getElementById("ta-password")?.value  || "";
  const namaLengkap = (document.getElementById("ta-nama")?.value    || "").trim();
  const agama       = document.getElementById("ta-agama")?.value     || "";

  if (!username)        return showToast("⚠️ Username wajib diisi!", "warning");
  if (password.length < 6) return showToast("⚠️ Password minimal 6 karakter!", "warning");

  try {
    const r = await fetch("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, namaLengkap, agama, faceDescriptor: [] })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Anggota berhasil didaftarkan!");
      closeTambahAnggota();
      loadAnggota();
    } else if (d.status === "EXIST") {
      showToast("⚠️ Username sudah terdaftar!", "warning");
    } else {
      showToast("❌ Gagal mendaftarkan anggota", "error");
    }
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

// ----------------------------------------------------------------
// MODAL DETAIL ANGGOTA
// ----------------------------------------------------------------
let _detailUsername = null;

async function openDetailAnggota(username) {
  // Refresh data dulu agar selalu up-to-date
  try {
    const [anggotaRes, groupsRes, divisiRes] = await Promise.all([
      authFetch("/anggota"), authFetch("/groups"), authFetch("/divisi")
    ]);
    _anggotaData   = await anggotaRes.json();
    _anggotaGroups = await groupsRes.json();
    _anggotaDivisi = await divisiRes.json();
  } catch { /* pakai cache lama */ }

  const m = _anggotaData.find(a => a.username === username);
  if (!m) return;
  _detailUsername = username;

  // --- Avatar ---
  const avEl = document.getElementById("da-avatar");
  const nama  = m.namaLengkap || m.username;
  if (m.photo) {
    avEl.innerHTML = `<img src="${m.photo}" style="width:58px;height:58px;object-fit:cover;">`;
    avEl.style.background = "transparent";
  } else {
    avEl.innerHTML = nama.charAt(0).toUpperCase();
    const _GC2 = { owner:"#e8541e", admin:"#1a6ac7", manager:"#00796b", koordinator:"#5c35c9", anggota:"#546e7a" };
    avEl.style.background = _GC2[m.group] || "#546e7a";
  }

  // --- Teks info ---
  document.getElementById("da-nama").textContent = nama;

  // Subtitle: posisi tertinggi di divisi, atau jabatan, atau peran, atau "Anggota"
  const grp     = (m.group || "").toLowerCase();
  const grpName = m.groupName || "";
  const userDivisiArr = Array.isArray(m.divisi) ? m.divisi : (m.divisi ? [m.divisi] : []);
  const posPriority = { "Owner": 1, "Manager": 2, "Koordinator": 3 };
  let bestPosisi = null;
  userDivisiArr.forEach(dNama => {
    const dItem = _anggotaDivisi.find(d => d.nama === dNama);
    if (!dItem) return;
    let pos = null;
    if (dItem.owner === username)            pos = "Owner";
    else if (dItem.manager === username)     pos = "Manager";
    else if (dItem.koordinator === username) pos = "Koordinator";
    if (pos && (!bestPosisi || (posPriority[pos]||9) < (posPriority[bestPosisi]||9))) bestPosisi = pos;
  });
  let subtitleText;
  if (bestPosisi)                                             subtitleText = bestPosisi;
  else if (m.jabatan)                                        subtitleText = m.jabatan;
  else if (grp === "owner")                                  subtitleText = "Owner";
  else if (grp === "admin" || grpName.toLowerCase()==="admin") subtitleText = "Admin";
  else                                                       subtitleText = "Anggota";
  document.getElementById("da-jabatan").textContent = subtitleText;

  // Divisi: tampilkan nama divisi user
  document.getElementById("da-divisi").textContent = userDivisiArr.length ? userDivisiArr.join(", ") : "—";
  document.getElementById("da-lastseen").textContent = timeAgo(m.lastSeen);

  // Badge Tugas Luar
  const tlBadge = document.getElementById("da-status-badge");
  tlBadge.style.display = m.statusKerja === "Tugas Luar" ? "inline-block" : "none";

  // --- Section Edit (owner=1 / admin=2 saja) ---
  const editSec = document.getElementById("da-edit-section");
  const isSelf  = username === localStorage.getItem("user");

  if (userLevel <= 2) {
    editSec.style.display = "block";
    // Tombol hapus — sembunyikan jika diri sendiri
    document.getElementById("da-btn-hapus").style.display = isSelf ? "none" : "inline-block";
  } else {
    editSec.style.display = "none";
  }

  document.getElementById("modal-detail-anggota").style.display = "flex";
}

function closeDetailAnggota() {
  document.getElementById("modal-detail-anggota").style.display = "none";
  _detailUsername = null;
}

async function saveDetailAnggota() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  if (!_detailUsername) return;
  try {
    showToast("✅ Data anggota berhasil diperbarui");
    closeDetailAnggota();
    loadAnggota();
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function deleteAnggotaFromModal() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  const username = _detailUsername;
  if (!username) return;
  uConfirm({
    icon: "👤", title: "Hapus Anggota",
    msg: `Hapus akun <b>${username}</b>?<br>Data absensi akan tetap tersimpan.`,
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await authFetch(`/anggota/${username}`, { method: "DELETE" });
        if ((await r.json()).status === "OK") {
          showToast("🗑 Anggota dihapus");
          closeDetailAnggota();
          loadAnggota();
        }
      } catch { showToast("❌ Gagal menghapus", "error"); }
    }
  });
}

// Tetap ada untuk backward-compat (dipanggil dari tempat lain)
async function changeGroup(username, groupId) {
  try {
    const r = await authFetch(`/anggota/${username}/group`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: groupId })
    });
    const d = await r.json();
    if (d.status === "OK") { showToast("✅ Peran berhasil diubah!"); loadAnggota(); }
    else showToast("❌ Gagal mengubah peran", "error");
  } catch { showToast("❌ Gagal", "error"); }
}

async function deleteAnggota(username) {
  uConfirm({
    icon: "👤", title: "Hapus Anggota",
    msg: `Hapus akun <b>${username}</b>?<br>Data absensi akan tetap tersimpan.`,
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await authFetch(`/anggota/${username}`, { method: "DELETE" });
        if ((await r.json()).status === "OK") { showToast("🗑 Anggota dihapus"); loadAnggota(); }
      } catch { showToast("❌ Gagal menghapus", "error"); }
    }
  });
}

// ============================================================
// DIVISI
// ============================================================
// ---- DIVISI: state cache ----
let _divisiList  = [];
let _anggotaAll  = [];

async function loadDivisi() {
  try {
    const [divisiRes, usersRes] = await Promise.all([authFetch("/divisi"), authFetch("/anggota")]);
    _divisiList  = await divisiRes.json();
    _anggotaAll  = await usersRes.json();
    renderDivisiTable(_divisiList);
  } catch (e) {
    document.getElementById("divisi-list").innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Gagal memuat</p>';
  }
}

function renderDivisiTable(list) {
  const el = document.getElementById("divisi-list");
  document.getElementById("divisi-count").textContent = list.length + " divisi";
  if (!list.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px;">Belum ada divisi</p>';
    return;
  }
  el.innerHTML = list.map(d => {
    // Hitung anggota: cek array divisi ATAU string lama (backward-compat)
    const anggotaDivisi = _anggotaAll.filter(a => {
      const arr = Array.isArray(a.divisi) ? a.divisi : (a.divisi ? [a.divisi] : []);
      return arr.includes(d.nama);
    });
    // Hitung juga dari posisi jabatan di divisi (owner/manager/koordinator)
    const fromPosisi = _anggotaAll.filter(a =>
      a.username === d.owner || a.username === d.manager || a.username === d.koordinator
    );
    const allUniq = [...new Map([...anggotaDivisi, ...fromPosisi].map(a => [a.username, a])).values()];

    const manager = _anggotaAll.find(a => a.username === d.manager);
    const managerLabel = manager
      ? (manager.namaLengkap || manager.username)
      : (d.manager ? d.manager : '<span style="color:#ccc;">—</span>');

    return `
      <div onclick="openDetailDivisi('${d.id}')"
        style="display:grid;grid-template-columns:1fr 1fr;padding:13px 16px;border-bottom:1px solid #f0f2f5;
               align-items:center;cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='#f5f8ff'" onmouseout="this.style.background='transparent'">
        <div>
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${d.nama}</div>
          <div style="font-size:11px;color:var(--primary);margin-top:2px;">👤 ${allUniq.length} anggota</div>
        </div>
        <div style="font-size:13px;color:#444;">${managerLabel}</div>
      </div>`;
  }).join('');
}

function filterDivisi() {
  const q = (document.getElementById("divisi-search").value || "").toLowerCase();
  const filtered = _divisiList.filter(d => d.nama.toLowerCase().includes(q));
  renderDivisiTable(filtered);
}

// ---- HELPER: render field Owner — auto-select jika hanya 1 owner ----
// selectId   = id elemen <select>
// ownerList  = array user dengan group "owner"
// selectedVal = username yang sudah terpilih (untuk mode edit)
function _renderOwnerField(selectId, ownerList, selectedVal = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  if (ownerList.length === 1) {
    // Hanya 1 owner: langsung pilih otomatis, sembunyikan dropdown (tampil sebagai teks)
    sel.innerHTML = `<option value="${ownerList[0].username}">${ownerList[0].namaLengkap || ownerList[0].username}</option>`;
    sel.value = ownerList[0].username;
    sel.disabled = true;
    sel.style.background = "#f0f2f5";
    sel.style.color = "#555";
    sel.title = "Owner otomatis (hanya ada 1 owner)";
  } else {
    // Lebih dari 1 owner: tampilkan dropdown biasa
    sel.innerHTML =
      '<option value="">Pilih Owner</option>' +
      ownerList.map(a =>
        `<option value="${a.username}" ${a.username === selectedVal ? 'selected' : ''}>${a.namaLengkap || a.username}</option>`
      ).join('');
    sel.disabled = false;
    sel.style.background = "";
    sel.style.color = "";
    sel.title = "";
  }
}

// ---- MODAL: BUAT GRUP ----
// State terpilih anggota
let _bgSelectedAnggota = []; // array username

async function openBuatGrup() {
  if (userLevel > 2) { showToast("⛔ Hanya Owner/Admin yang bisa membuat divisi", "error"); return; }
  if (!_anggotaAll.length) {
    const r = await authFetch("/anggota"); _anggotaAll = await r.json();
  }

  // Reset state
  _bgSelectedAnggota = [];
  document.getElementById("bg-nama").value = "";
  document.getElementById("bg-anggota-search").value = "";
  const _bgOverlay = document.getElementById("bg-anggota-overlay");
  if (_bgOverlay) _bgOverlay.style.display = "none";
  _renderAnggotaDropdownItems([..._anggotaAll].filter(a => a.group !== "owner").sort((a, b) => (a.namaLengkap || a.username || '').localeCompare(b.namaLengkap || b.username || '', 'id')));
  _renderAnggotaTags();

  // Dropdown Owner: otomatis jika hanya 1 owner, dropdown jika lebih
  const ownerList = _anggotaAll.filter(a => a.group === "owner");
  _renderOwnerField("bg-owner", ownerList, "");

  // Dropdown Manager & Koordinator: semua anggota
  const allList = _anggotaAll;
  const opts = '<option value="">Pilih</option>' +
    allList.map(a => `<option value="${a.username}">${a.namaLengkap || a.username} (${a.jabatan || a.groupName || a.group})</option>`).join('');
  document.getElementById("bg-manager").innerHTML    = opts.replace('Pilih', 'Pilih Manager');
  document.getElementById("bg-koordinator").innerHTML = opts.replace('Pilih', 'Pilih Koordinator');

  document.getElementById("modal-buat-grup").style.display = "flex";

  // Tutup dropdown jika klik di luar
  setTimeout(() => {
    document.addEventListener("click", _bgOutsideClick);
  }, 100);
}

function _bgOutsideClick(e) {
  const wrap = document.getElementById("bg-anggota-wrap");
  if (wrap && !wrap.contains(e.target)) {
    const ov = document.getElementById("bg-anggota-overlay");
    if (ov) ov.style.display = "none";
    document.removeEventListener("click", _bgOutsideClick);
  }
}

function toggleAnggotaDropdown() {
  const overlay = document.getElementById("bg-anggota-overlay");
  if (!overlay) return;
  const isOpen = overlay.style.display === "flex";
  if (isOpen) {
    overlay.style.display = "none";
    return;
  }
  overlay.style.display = "flex";
  document.getElementById("bg-anggota-search").value = "";
  filterAnggotaDropdown();
  setTimeout(() => document.getElementById("bg-anggota-search").focus(), 50);
}

function _renderAnggotaDropdownItems(list) {
  const container = document.getElementById("bg-anggota-list");
  if (!list.length) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:12px;">Tidak ada anggota</p>';
    return;
  }
  container.innerHTML = list.map(a => {
    const checked = _bgSelectedAnggota.includes(a.username);
    const nama    = a.namaLengkap || a.username;
    const jabatan = a.jabatan || a.groupName || a.group;
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;
                    transition:background .1s;font-size:13px;"
             onmouseover="this.style.background='#f5f8ff'" onmouseout="this.style.background='transparent'"
             onclick="toggleBgAnggota('${a.username}', event)">
        <div style="width:18px;height:18px;border-radius:4px;border:2px solid ${checked ? 'var(--primary)' : '#ccc'};
                    background:${checked ? 'var(--primary)' : 'white'};display:flex;align-items:center;
                    justify-content:center;flex-shrink:0;transition:.15s;">
          ${checked ? '<span style="color:white;font-size:11px;font-weight:900;">✓</span>' : ''}
        </div>
        <div style="min-width:0;">
          <div style="font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nama}</div>
          <div style="font-size:11px;color:var(--muted);">${jabatan}</div>
        </div>
      </label>`;
  }).join('');
}

function toggleBgAnggota(username, e) {
  e.preventDefault();
  e.stopPropagation();
  const idx = _bgSelectedAnggota.indexOf(username);
  if (idx > -1) _bgSelectedAnggota.splice(idx, 1);
  else          _bgSelectedAnggota.push(username);
  // Re-render items dengan filter aktif
  filterAnggotaDropdown();
  _renderAnggotaTags();
}

function filterAnggotaDropdown() {
  const q = (document.getElementById("bg-anggota-search")?.value || "").toLowerCase();
  const nonOwner = _anggotaAll.filter(a => a.group !== "owner");
  const filtered = q ? nonOwner.filter(a =>
    (a.namaLengkap || a.username).toLowerCase().includes(q) ||
    a.username.toLowerCase().includes(q)
  ) : nonOwner;
  _renderAnggotaDropdownItems(filtered);
}

function _renderAnggotaTags() {
  const wrap  = document.getElementById("bg-anggota-tags");
  const label = document.getElementById("bg-anggota-label");
  if (!_bgSelectedAnggota.length) {
    wrap.innerHTML = "";
    label.style.color = "#aaa";
    label.textContent = "Pilih Anggota";
    return;
  }
  label.style.color = "#222";
  label.textContent = _bgSelectedAnggota.length + " anggota dipilih";
  wrap.innerHTML = _bgSelectedAnggota.map(u => {
    const a    = _anggotaAll.find(x => x.username === u);
    const nama = a ? (a.namaLengkap || a.username) : u;
    return `
      <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;
                   background:#e8f0fe;color:var(--primary);border-radius:50px;font-size:12px;font-weight:600;">
        ${nama}
        <span onclick="toggleBgAnggota('${u}', event)" style="cursor:pointer;font-size:14px;line-height:1;
              color:#7090d0;font-weight:700;" title="Hapus">×</span>
      </span>`;
  }).join('');
}

function closeBuatGrup() {
  document.getElementById("modal-buat-grup").style.display = "none";
  const ov = document.getElementById("bg-anggota-overlay");
  if (ov) ov.style.display = "none";
  document.removeEventListener("click", _bgOutsideClick);
  _bgSelectedAnggota = [];
}

function bgCloseAnggotaOverlay() {
  const ov = document.getElementById("bg-anggota-overlay");
  if (ov) ov.style.display = "none";
}

function bgCloseOverlay(e) {
  if (e.target === document.getElementById("bg-anggota-overlay")) {
    bgCloseAnggotaOverlay();
  }
}

async function saveBuatGrup() {
  const nama        = document.getElementById("bg-nama").value.trim();
  const owner       = document.getElementById("bg-owner").value;
  const manager     = document.getElementById("bg-manager").value;
  const koordinator = document.getElementById("bg-koordinator").value;
  if (!nama) { showToast("⚠️ Nama divisi wajib diisi", "warning"); return; }

  // Kumpulkan semua username yang perlu di-assign (dari dropdown anggota + posisi jabatan)
  const checked = [..._bgSelectedAnggota];
  // Pastikan owner/manager/koordinator masuk juga
  for (const u of [owner, manager, koordinator]) {
    if (u && !checked.includes(u)) checked.push(u);
  }

  try {
    const r = await authFetch("/divisi", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nama, owner, manager, koordinator, deskripsi: "" })
    });
    const d = await r.json();
    if (d.status === "EXIST") { showToast("⚠️ Divisi sudah ada", "warning"); return; }
    if (d.status !== "OK")    { showToast("❌ Gagal membuat divisi", "error"); return; }

    // Assign semua anggota dengan action "add" → TIDAK menghapus divisi sebelumnya (multi-divisi)
    await Promise.all(checked.map(u =>
      authFetch(`/anggota/${u}/divisi`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ divisi: nama, action: "add" })
      })
    ));

    showToast("✅ Divisi berhasil dibuat");
    closeBuatGrup();
    // Refresh KEDUANYA agar kolom divisi di Daftar Anggota langsung update
    await loadDivisi();
    loadAnggota();
  } catch { showToast("❌ Gagal", "error"); }
}

// ---- MODAL: DETAIL DIVISI ----
let _detailDivisiId = null;

async function openDetailDivisi(id) {
  // Refresh data terbaru
  try {
    const [divisiRes, usersRes] = await Promise.all([authFetch("/divisi"), authFetch("/anggota")]);
    _divisiList = await divisiRes.json();
    _anggotaAll = await usersRes.json();
  } catch(e) { console.warn("openDetailDivisi: gagal refresh data", e); /* pakai cache */ }

  const d = _divisiList.find(x => x.id === id);
  if (!d) { showToast("⚠️ Data divisi tidak ditemukan", "warning"); return; }
  _detailDivisiId = id;

  // Hitung anggota divisi ini (array-aware)
  const anggotaDivisi = _anggotaAll.filter(a => {
    const arr = Array.isArray(a.divisi) ? a.divisi : (a.divisi ? [a.divisi] : []);
    return arr.includes(d.nama) || a.username === d.owner || a.username === d.manager || a.username === d.koordinator;
  });
  const uniqAnggota = [...new Map(anggotaDivisi.map(a => [a.username, a])).values()];

  document.getElementById("dd-judul").textContent = "🏢 " + d.nama;
  const ownerObj   = _anggotaAll.find(a => a.username === d.owner);
  const managerObj = _anggotaAll.find(a => a.username === d.manager);
  const koordObj   = _anggotaAll.find(a => a.username === d.koordinator);
  const ownerLabel   = ownerObj   ? (ownerObj.namaLengkap   || ownerObj.username)   : (d.owner   || "—");
  const managerLabel = managerObj ? (managerObj.namaLengkap || managerObj.username) : (d.manager || "—");
  const koordLabel   = koordObj   ? (koordObj.namaLengkap   || koordObj.username)   : "";
  document.getElementById("dd-manager-label").textContent =
    "Owner: " + ownerLabel +
    " · Manager: " + managerLabel +
    (koordLabel ? " · Koordinator: " + koordLabel : "");

  // Daftar anggota read-only
  const viewEl = document.getElementById("dd-anggota-view");
  if (uniqAnggota.length) {
    viewEl.innerHTML = `<div style="margin-bottom:4px;font-size:12px;font-weight:700;color:var(--muted);">ANGGOTA (${uniqAnggota.length})</div>` +
      uniqAnggota.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f8f8f8;">
          <div style="width:30px;height:30px;border-radius:50%;background:var(--primary);color:white;
                      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;">
            ${(a.namaLengkap||a.username).charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;">${a.namaLengkap || a.username}</div>
            <div style="font-size:11px;color:var(--muted);">${a.jabatan || a.groupName}</div>
          </div>
        </div>`).join('');
  } else {
    viewEl.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:8px 0;">Belum ada anggota</p>';
  }

  // Edit section hanya owner/admin
  const editSec = document.getElementById("dd-edit-section");
  if (userLevel <= 2) {
    editSec.style.display = "block";
    document.getElementById("dd-nama").value = d.nama;

    const ownerList = _anggotaAll.filter(a => a.group === "owner");
    const nonOwner  = _anggotaAll.filter(a => a.group !== "owner");

    _renderOwnerField("dd-owner", ownerList, d.owner || "");

    document.getElementById("dd-manager").innerHTML =
      '<option value="">Pilih Manager</option>' +
      _anggotaAll.map(a => `<option value="${a.username}" ${a.username===d.manager?'selected':''}>${a.namaLengkap||a.username} (${a.jabatan||a.groupName})</option>`).join('');

    document.getElementById("dd-koordinator").innerHTML =
      '<option value="">Pilih Koordinator</option>' +
      _anggotaAll.map(a => `<option value="${a.username}" ${a.username===(d.koordinator||'')?'selected':''}>${a.namaLengkap||a.username} (${a.jabatan||a.groupName})</option>`).join('');

    // Checkbox anggota — checked jika sudah di divisi ini (array-aware)
    document.getElementById("dd-anggota-edit").innerHTML = nonOwner.map(a => {
      const arr = Array.isArray(a.divisi) ? a.divisi : (a.divisi ? [a.divisi] : []);
      const isIn = arr.includes(d.nama);
      return `
        <label style="display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:13px;cursor:pointer;">
          <input type="checkbox" value="${a.username}" ${isIn?'checked':''} style="width:15px;height:15px;">
          ${a.namaLengkap || a.username}
          <span style="font-size:11px;color:var(--muted);">(${a.jabatan||a.groupName})</span>
        </label>`;
    }).join('');
  } else {
    editSec.style.display = "none";
  }

  document.getElementById("modal-detail-divisi").style.display = "flex";
}

function closeDetailDivisi() {
  document.getElementById("modal-detail-divisi").style.display = "none";
  _detailDivisiId = null;
}

async function saveDetailDivisi() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  const d = _divisiList.find(x => x.id === _detailDivisiId);
  if (!d) return;
  const namaBaru    = document.getElementById("dd-nama").value.trim();
  const ownerBaru   = document.getElementById("dd-owner").value;
  const managerBaru = document.getElementById("dd-manager").value;
  const koordBaru   = document.getElementById("dd-koordinator").value;
  if (!namaBaru) { showToast("⚠️ Nama tidak boleh kosong", "warning"); return; }

  const checked   = [...document.querySelectorAll("#dd-anggota-edit input[type=checkbox]:checked")].map(cb => cb.value);
  const unchecked = [...document.querySelectorAll("#dd-anggota-edit input[type=checkbox]:not(:checked)")].map(cb => cb.value);

  // Gabungkan semua yang harus masuk divisi (checked + jabatan)
  const allToAdd = [...new Set([...checked, ownerBaru, managerBaru, koordBaru].filter(Boolean))];

  try {
    await authFetch(`/divisi/${_detailDivisiId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nama: namaBaru, owner: ownerBaru, manager: managerBaru, koordinator: koordBaru, deskripsi: d.deskripsi || "" })
    });

    // Add anggota yang dicentang (action "add" → tidak hapus divisi lain)
    await Promise.all(allToAdd.map(u => authFetch(`/anggota/${u}/divisi`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ divisi: namaBaru, action: "add" })
    })));

    // Remove anggota yang tidak dicentang dan bukan jabatan
    await Promise.all(unchecked
      .filter(u => !allToAdd.includes(u))
      .map(u => {
        const ang = _anggotaAll.find(a => a.username === u);
        const arr = Array.isArray(ang?.divisi) ? ang.divisi : (ang?.divisi ? [ang.divisi] : []);
        if (arr.includes(d.nama)) {
          return authFetch(`/anggota/${u}/divisi`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ divisi: d.nama, action: "remove" })
          });
        }
        return Promise.resolve();
      })
    );

    showToast("✅ Divisi diperbarui");
    closeDetailDivisi();
    await loadDivisi();
    loadAnggota();
  } catch { showToast("❌ Gagal", "error"); }
}

// ================================================================
// GANTI fungsi deleteDetailDivisi di script.js
// ================================================================
function deleteDetailDivisi() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  const d = _divisiList.find(x => x.id === _detailDivisiId);
  if (!d) return;

  // Tutup modal detail divisi DULU sebelum buka uConfirm
  // supaya tidak tumpang tindih dan confirm bisa diklik
  document.getElementById("modal-detail-divisi").style.display = "none";

  uConfirm({
    icon: "🏢",
    title: "Hapus Divisi",
    msg: `Hapus divisi <b>${d.nama}</b>?<br>Anggota akan dilepas dari divisi ini.`,
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await authFetch(`/divisi/${_detailDivisiId}`, { method: "DELETE" });
        if (!r.ok) {
          showToast("❌ Server error: " + r.status, "error");
          return;
        }
        const res = await r.json();
        if (res.status === "OK") {
          showToast("🗑 Divisi berhasil dihapus");
          _detailDivisiId = null;
          await loadDivisi();
          loadAnggota();
        } else {
          showToast("❌ Gagal menghapus: " + (res.msg || res.status), "error");
        }
      } catch (e) {
        console.error("deleteDetailDivisi error:", e);
        showToast("❌ Gagal menghapus (network error)", "error");
      }
    }
  });
}

// ================================================================
// GANTI fungsi openDetailDivisi — pindah tombol Hapus ke ATAS form
// supaya tidak tersembunyi di belakang scroll
// ================================================================
async function openDetailDivisi(id) {
  try {
    const [divisiRes, usersRes] = await Promise.all([authFetch("/divisi"), authFetch("/anggota")]);
    _divisiList = await divisiRes.json();
    _anggotaAll = await usersRes.json();
  } catch(e) { /* pakai cache */ }

  const d = _divisiList.find(x => x.id === id);
  if (!d) { showToast("⚠️ Data divisi tidak ditemukan", "warning"); return; }
  _detailDivisiId = id;

  const anggotaDivisi = _anggotaAll.filter(a => {
    const arr = Array.isArray(a.divisi) ? a.divisi : (a.divisi ? [a.divisi] : []);
    return arr.includes(d.nama) || a.username === d.owner || a.username === d.manager || a.username === d.koordinator;
  });
  const uniqAnggota = [...new Map(anggotaDivisi.map(a => [a.username, a])).values()];

  document.getElementById("dd-judul").textContent = "🏢 " + d.nama;
  const ownerObj   = _anggotaAll.find(a => a.username === d.owner);
  const managerObj = _anggotaAll.find(a => a.username === d.manager);
  const koordObj   = _anggotaAll.find(a => a.username === d.koordinator);
  const ownerLabel   = ownerObj   ? (ownerObj.namaLengkap   || ownerObj.username)   : (d.owner   || "—");
  const managerLabel = managerObj ? (managerObj.namaLengkap || managerObj.username) : (d.manager || "—");
  const koordLabel   = koordObj   ? (koordObj.namaLengkap   || koordObj.username)   : "";
  document.getElementById("dd-manager-label").textContent =
    "Owner: " + ownerLabel +
    " · Manager: " + managerLabel +
    (koordLabel ? " · Koordinator: " + koordLabel : "");

  // Daftar anggota read-only
  const viewEl = document.getElementById("dd-anggota-view");
  if (uniqAnggota.length) {
    viewEl.innerHTML = `<div style="margin-bottom:4px;font-size:12px;font-weight:700;color:var(--muted);">ANGGOTA (${uniqAnggota.length})</div>` +
      uniqAnggota.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f8f8f8;">
          <div style="width:30px;height:30px;border-radius:50%;background:var(--primary);color:white;
                      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;">
            ${(a.namaLengkap||a.username).charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;">${a.namaLengkap || a.username}</div>
            <div style="font-size:11px;color:var(--muted);">${a.jabatan || a.groupName}</div>
          </div>
        </div>`).join('');
  } else {
    viewEl.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:8px 0;">Belum ada anggota</p>';
  }

  // Edit section — hanya owner/admin
  const editSec = document.getElementById("dd-edit-section");
  if (userLevel <= 2) {
    editSec.style.display = "block";
    document.getElementById("dd-nama").value = d.nama;

    _renderOwnerField("dd-owner", _anggotaAll.filter(a => a.group === "owner"), d.owner || "");

    const opts = '<option value="">Pilih</option>' +
      _anggotaAll.map(a =>
        `<option value="${a.username}">${a.namaLengkap||a.username} (${a.jabatan||a.groupName})</option>`
      ).join('');
    document.getElementById("dd-manager").innerHTML    = opts;
    document.getElementById("dd-koordinator").innerHTML = opts;
    document.getElementById("dd-manager").value    = d.manager    || "";
    document.getElementById("dd-koordinator").value = d.koordinator || "";

    const nonOwner = _anggotaAll.filter(a => a.group !== "owner");
    document.getElementById("dd-anggota-edit").innerHTML = nonOwner.map(a => {
      const arr = Array.isArray(a.divisi) ? a.divisi : (a.divisi ? [a.divisi] : []);
      const isIn = arr.includes(d.nama);
      return `
        <label style="display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:13px;cursor:pointer;">
          <input type="checkbox" value="${a.username}" ${isIn?'checked':''} style="width:15px;height:15px;">
          ${a.namaLengkap || a.username}
          <span style="font-size:11px;color:var(--muted);">(${a.jabatan||a.groupName})</span>
        </label>`;
    }).join('');

    // ── Tombol Hapus dipindah ke ATAS — tampil sebagai bar di bagian atas edit section
    // Ini supaya tidak tersembunyi di bawah scroll yang panjang
    const existingHapusBar = editSec.querySelector(".hapus-bar");
    if (!existingHapusBar) {
      const hapusBar = document.createElement("div");
      hapusBar.className = "hapus-bar";
      hapusBar.style.cssText = `
        display:flex;justify-content:flex-end;
        padding:0 0 12px;border-bottom:1px solid #f0f2f5;margin-bottom:14px;`;
      hapusBar.innerHTML = `
        <button onclick="deleteDetailDivisi()"
          style="padding:9px 18px;border:none;border-radius:10px;
                 background:#fce4ec;color:var(--danger);font-weight:700;
                 font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
          🗑 Hapus Divisi Ini
        </button>`;
      // Sisipkan di awal edit section
      editSec.insertBefore(hapusBar, editSec.firstChild);
    }
  } else {
    editSec.style.display = "none";
  }

  document.getElementById("modal-detail-divisi").style.display = "flex";
}

async function assignDivisi(username, divisiNama) {
  try {
    const r = await authFetch(`/anggota/${username}/divisi`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ divisi: divisiNama })
    });
    const d = await r.json();
    if (d.status === "OK") { showToast("✅ Divisi berhasil diubah"); loadAnggota(); }
    else showToast("❌ Gagal mengubah divisi", "error");
  } catch { showToast("❌ Gagal", "error"); }
}

// ============================================================
// GROUP & AKSES MENU
// ============================================================
// Struktur menu lengkap — parent + children (submenu)
// key unik digunakan sebagai token akses di group.menus[]
const ALL_MENUS = [
  // ── NAVBAR ──────────────────────────────────
  {
    key: "home", label: "Beranda", icon: "🏠", section: "Navigasi",
    alwaysOn: true  // tidak bisa di-toggle, selalu aktif
  },
  {
    key: "timesheet", label: "Timesheet", icon: "🕐", section: "Navigasi",
    alwaysOn: true  // selalu tampil di navbar
  },
  {
    key: "cuti", label: "Cuti", icon: "🌴", section: "Navigasi",
    alwaysOn: true,
    children: [
      { key: "cuti.daftar", label: "Pengajuan Cuti", parentKey: "cuti" },
      { key: "cuti.saldo",  label: "Saldo Cuti",     parentKey: "cuti" },
    ]
  },
  {
    key: "setting", label: "Pengaturan", icon: "⚙️", section: "Navigasi",
  },

  // ── MENU PENGATURAN ─────────────────────────
  {
    key: "anggota", label: "Anggota", icon: "👥", section: "Pengaturan",
    children: [
      { key: "anggota.daftar",  label: "Daftar Anggota", parentKey: "anggota" },
      { key: "anggota.divisi",  label: "Divisi",          parentKey: "anggota" },
    ]
  },
  {
    key: "area", label: "Area Kantor", icon: "📍", section: "Pengaturan",
    children: [
      { key: "area.daftar",  label: "Daftar Area",   parentKey: "area" },
      { key: "area.tambah",  label: "Tambah Area",   parentKey: "area" },
    ]
  },
  {
    key: "libur", label: "Hari Libur & Cuti", icon: "📅", section: "Pengaturan",
    children: [
      { key: "libur.hari-libur",     label: "Hari Libur",      parentKey: "libur" },
      { key: "libur.kebijakan-cuti", label: "Kebijakan Cuti",  parentKey: "libur" },
      { key: "libur.kuota-cuti",     label: "Kuota Cuti",      parentKey: "libur" },
    ]
  },
  {
    key: "aktivitas",    label: "Aktivitas",      icon: "📌", section: "Pengaturan",
    children: [
      { key: "aktivitas.daftar",  label: "Daftar Aktivitas",  parentKey: "aktivitas" },
      { key: "aktivitas.monitor", label: "Monitor Kehadiran", parentKey: "aktivitas" },
    ]
  },
  {
    key: "rekap",        label: "Rekap",           icon: "📋", section: "Pengaturan",
  },
  {
    key: "aksesibilitas", label: "Aksesibilitas",  icon: "🔐", section: "Pengaturan",
  },
  {
    key: "tracking",     label: "Tracking",         icon: "🗺️", section: "Pengaturan",
  },
  {
    key: "profil",       label: "Profil",           icon: "👤", section: "Pengaturan",
  },
];

// Helper: flatten semua key (parent + child) dari ALL_MENUS
function allMenuKeys() {
  const keys = [];
  ALL_MENUS.forEach(m => {
    keys.push(m.key);
    (m.children || []).forEach(c => keys.push(c.key));
  });
  return keys;
}

// Group menus by section
function menusBySection() {
  const sections = {};
  ALL_MENUS.forEach(m => {
    const s = m.section || "Lainnya";
    if (!sections[s]) sections[s] = [];
    sections[s].push(m);
  });
  return sections;
}

// State lokal sementara sebelum disimpan: { [groupId]: Set<menuKey> }
const _aksesTemp = {};

// ─── TAB SWITCHER AKSESIBILITAS ──────────────────────────────
function switchAksesTab(tab) {
  const isAkses = tab === "akses";
  document.getElementById("panel-akses-kontrol").style.display = isAkses ? "" : "none";
  document.getElementById("panel-akses-rules").style.display   = isAkses ? "none" : "";

  const btnAkses = document.getElementById("tab-btn-akses");
  const btnRules = document.getElementById("tab-btn-rules");

  if (isAkses) {
    btnAkses.style.background = "linear-gradient(135deg,#4f8ef7,#1a237e)";
    btnAkses.style.color      = "white";
    btnAkses.style.boxShadow  = "0 2px 8px rgba(79,142,247,.4)";
    btnRules.style.background = "transparent";
    btnRules.style.color      = "var(--muted)";
    btnRules.style.boxShadow  = "none";
  } else {
    btnRules.style.background = "linear-gradient(135deg,#4f8ef7,#1a237e)";
    btnRules.style.color      = "white";
    btnRules.style.boxShadow  = "0 2px 8px rgba(79,142,247,.4)";
    btnAkses.style.background = "transparent";
    btnAkses.style.color      = "var(--muted)";
    btnAkses.style.boxShadow  = "none";
    // Tampilkan akordion Pengaturan Sistem hanya untuk Owner/Admin
    const akordionSistem = document.getElementById("akordion-sistem");
    if (akordionSistem) {
      if (userLevel <= 2) {
        akordionSistem.style.display = "";
        const gbody = document.getElementById("gbody-sistem");
        const chev  = document.getElementById("chev-sistem");
        if (gbody && !gbody.classList.contains("open")) {
          gbody.classList.add("open");
          if (chev) chev.style.transform = "rotate(90deg)";
        }
        loadSistemSettings();
        loadScreenshotToggle();
        loadWorkPhotoToggle();
        loadAutoTutupOvertimeToggle();
      } else {
        akordionSistem.style.display = "none";
      }
    }
  }
}

// ─── RULES ───────────────────────────────────────────────────
let _rulesMessList      = []; // cache server state
let _rulesTugasLuarList = []; // cache tugas luar state
let _rulesAdminList     = []; // cache peran admin/owner state (username → groupId)

async function loadRules() {
  const el = document.getElementById("rules-mess-list");
  if (!el) return;
  el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Memuat...</p>';

  // Fetch anggota dulu — wajib
  let anggota = [];
  try {
    const r = await authFetch("/anggota");
    anggota  = await r.json();
  } catch {
    el.innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px;font-size:13px;">❌ Gagal memuat daftar anggota</p>';
    return;
  }

  // Fetch groups untuk mendapatkan daftar group owner/admin
  let allGroups = [];
  try {
    const rg = await authFetch("/groups");
    allGroups = await rg.json();
  } catch { allGroups = []; }

  // Fetch rules — opsional, gagal = default kosong
  try {
    const r   = await authFetch("/rules");
    const d   = await r.json();
    _rulesMessList = d.messList || [];
  } catch {
    _rulesMessList = [];
  }

  // Fetch tugas luar dari data anggota masing-masing
  _rulesTugasLuarList = anggota
    .filter(u => u.statusKerja === "Tugas Luar")
    .map(u => u.username);

  // State peran admin saat ini: { username: groupId }
  _rulesAdminList = {};
  anggota.forEach(u => { _rulesAdminList[u.username] = u.group || ""; });

  // Hanya tampilkan owner & admin — filter + urutkan owner dulu
  const adminAnggota = anggota.filter(u => u.group === "owner" || u.group === "admin");

  // Groups yg tersedia untuk checkbox (owner & admin saja)
  const adminGroups = allGroups.filter(g => g.id === "owner" || g.id === "admin");

  if (!anggota.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Belum ada anggota</p>';
    return;
  }

  // ── Deteksi layout: mobile jika layar sempit (overlay di desktop sudah lebar 900px) ──
  const isMobile = window.innerWidth <= 600;

  if (isMobile) {
    // ── MOBILE: Spreadsheet / frozen-pane layout seperti Timesheet ──────────
    // Kolom kiri (nama) sticky, kolom kanan (checkbox) scroll horizontal
    // Lebar kolom checkbox: masing-masing 52px
    const COL_W = 52; // px per kolom checkbox

    const headerRow = `
      <div style="display:flex;background:#f8f9ff;border-bottom:2px solid #e0e4f0;
                  position:sticky;top:0;z-index:10;">
        <!-- Kolom nama — sticky kiri -->
        <div style="width:140px;min-width:140px;flex-shrink:0;padding:9px 10px;
                    font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;
                    letter-spacing:.5px;position:sticky;left:0;background:#f8f9ff;
                    border-right:2px solid #e0e4f0;z-index:11;">
          ANGGOTA
        </div>
        <!-- Kolom-kolom checkbox — bisa di-scroll -->
        <div style="display:flex;overflow:hidden;">
          <div style="width:${COL_W}px;min-width:${COL_W}px;padding:6px 4px;text-align:center;border-right:1px solid #eef0f8;">
            <div style="font-size:8px;font-weight:800;color:#e8541e;text-transform:uppercase;letter-spacing:.4px;line-height:1.3;">🎖️<br>Owner</div>
          </div>
          <div style="width:${COL_W}px;min-width:${COL_W}px;padding:6px 4px;text-align:center;border-right:1px solid #eef0f8;">
            <div style="font-size:8px;font-weight:800;color:#1a6ac7;text-transform:uppercase;letter-spacing:.4px;line-height:1.3;">🎖️<br>Admin</div>
          </div>
          <div style="width:${COL_W}px;min-width:${COL_W}px;padding:6px 4px;text-align:center;border-right:1px solid #eef0f8;">
            <div style="font-size:8px;font-weight:800;color:#e65100;text-transform:uppercase;letter-spacing:.4px;line-height:1.3;">🚗<br>Tgs.Luar</div>
          </div>
          <div style="width:${COL_W}px;min-width:${COL_W}px;padding:6px 4px;text-align:center;">
            <div style="font-size:8px;font-weight:800;color:#b45309;text-transform:uppercase;letter-spacing:.4px;line-height:1.3;">🏠<br>Mess</div>
          </div>
        </div>
      </div>`;

    const dataRows = anggota.map((u, i) => {
      const isMess  = _rulesMessList.includes(u.username);
      const isTL    = _rulesTugasLuarList.includes(u.username);
      const isOwner = u.group === "owner";
      const isAdmin = u.group === "admin";
      const nama    = u.namaLengkap || u.username;
      const initials = nama.charAt(0).toUpperCase();
      const rowBg = i % 2 === 0 ? "white" : "#fafbff";
      const avatar  = u.photo
        ? `<img src="${u.photo}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
        : `<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#1a237e,#4f8ef7);
             display:flex;align-items:center;justify-content:center;color:white;
             font-weight:800;font-size:13px;flex-shrink:0;">${initials}</div>`;

      return `
      <div style="display:flex;align-items:center;border-bottom:1px solid #f0f2f5;background:${rowBg};">
        <!-- Kolom nama — sticky kiri -->
        <div style="width:140px;min-width:140px;flex-shrink:0;padding:10px 10px;
                    display:flex;align-items:center;gap:8px;
                    position:sticky;left:0;background:${rowBg};
                    border-right:2px solid #e0e4f0;z-index:5;">
          ${avatar}
          <div style="min-width:0;position:relative;">
            <div onclick="showNamaTooltip(this, '${nama.replace(/'/g,"&#39;")}')"
                 style="font-size:12px;font-weight:700;color:${isOwner?"#e8541e":isAdmin?"#1a6ac7":"#2c3e50"};
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                        max-width:88px;cursor:pointer;user-select:none;">${nama}</div>
            <div id="mess-label-${u.username}" style="font-size:9px;margin-top:2px;display:flex;gap:3px;flex-wrap:wrap;align-items:center;">
              <span id="peran-badge-${u.username}" style="display:none;"></span>
              ${isTL ? `<span style="color:#e65100;font-weight:600;">🚗 Tugas Luar</span>` : ""}
              <span style="color:${isMess?"#e67e22":"var(--muted)"};">${isMess ? "🏠 Mess" : "🏠 Luar Mess"}</span>
            </div>
          </div>
        </div>
        <!-- Kolom checkbox -->
        <div style="display:flex;align-items:center;overflow:hidden;">
          <!-- Owner -->
          <div style="width:${COL_W}px;min-width:${COL_W}px;display:flex;justify-content:center;align-items:center;
                      padding:10px 4px;border-right:1px solid #eef0f8;background:${isOwner?"#fef0ea":"transparent"};">
            <input type="checkbox" id="owner-cb-${u.username}"
              ${isOwner ? "checked" : ""}
              onchange="onPeranToggle('${u.username}', 'owner', this.checked)"
              style="width:15px;height:15px;accent-color:#e8541e;cursor:pointer;">
          </div>
          <!-- Admin -->
          <div style="width:${COL_W}px;min-width:${COL_W}px;display:flex;justify-content:center;align-items:center;
                      padding:10px 4px;border-right:1px solid #eef0f8;background:${isAdmin?"#eaf0fb":"transparent"};">
            <input type="checkbox" id="admin-cb-${u.username}"
              ${isAdmin ? "checked" : ""}
              onchange="onPeranToggle('${u.username}', 'admin', this.checked)"
              style="width:15px;height:15px;accent-color:#1a6ac7;cursor:pointer;">
          </div>
          <!-- Tugas Luar -->
          <div style="width:${COL_W}px;min-width:${COL_W}px;display:flex;justify-content:center;align-items:center;
                      padding:10px 4px;border-right:1px solid #eef0f8;background:${isTL?"#fff2ec":"transparent"};">
            <input type="checkbox" id="tl-cb-${u.username}"
              ${isTL ? "checked" : ""}
              onchange="onTugasLuarToggle('${u.username}', this.checked)"
              style="width:15px;height:15px;accent-color:#e65100;cursor:pointer;">
          </div>
          <!-- Mess -->
          <div style="width:${COL_W}px;min-width:${COL_W}px;display:flex;justify-content:center;align-items:center;
                      padding:10px 4px;background:${isMess?"#fffbf0":"transparent"};">
            <input type="checkbox" id="mess-cb-${u.username}"
              ${isMess ? "checked" : ""}
              onchange="onMessToggle('${u.username}', this.checked)"
              style="width:15px;height:15px;accent-color:#e67e22;cursor:pointer;">
          </div>
        </div>
      </div>`;
    }).join("");

    // Pisah: header ke rules-mess-header (tidak ikut scroll vertikal)
    const hdrEl = document.getElementById("rules-mess-header");
    if (hdrEl) hdrEl.innerHTML = `
      <div style="border-radius:12px 12px 0 0;overflow:hidden;border:1px solid #e0e4f0;
                  border-bottom:none;background:white;overflow-x:auto;-webkit-overflow-scrolling:touch;">
        ${headerRow}
      </div>`;

    el.innerHTML = `
      <div style="border-radius:0 0 12px 12px;overflow:hidden;border:1px solid #e0e4f0;
                  border-top:none;background:white;overflow-x:auto;-webkit-overflow-scrolling:touch;">
        ${dataRows}
        <!-- Hint scroll jika konten melebihi layar -->
        <div id="mess-label-hint" style="display:none;text-align:right;padding:4px 10px 6px;
          font-size:10px;color:#b0b8c8;">← geser untuk kolom lain</div>
      </div>`;

    // Tampilkan hint scroll jika total lebar > container
    requestAnimationFrame(() => {
      const wrap = el.querySelector('div[style*="overflow-x:auto"]');
      const hint = el.querySelector('#mess-label-hint');
      if (wrap && hint && wrap.scrollWidth > wrap.clientWidth) {
        hint.style.display = 'block';
        wrap.addEventListener('scroll', () => { hint.style.display = 'none'; }, { once: true });
      }
    });

    // Tambahkan id mess-label per user (dipakai onMessToggle)
    anggota.forEach(u => {
      // mess-label dipakai onMessToggle — inject sebagai hidden span jika belum ada
      if (!document.getElementById(`mess-label-${u.username}`)) {
        const span = document.createElement('span');
        span.id = `mess-label-${u.username}`;
        span.style.display = 'none';
        el.appendChild(span);
      }
    });

  } else {
    // ── DESKTOP: Nama rata kiri (flex:1), padding tepi, gap antar kolom ──
    const GAP = "margin-right:24px;";
    const COL = {
      owner: "width:80px;flex-shrink:0;display:flex;justify-content:center;align-items:center;",
      admin: "width:80px;flex-shrink:0;display:flex;justify-content:center;align-items:center;",
      tl:    "width:140px;flex-shrink:0;display:flex;justify-content:center;align-items:center;",
      mess:  "width:140px;flex-shrink:0;display:flex;justify-content:center;align-items:center;",
    };

    const colHeaderHTML = `
    <div style="display:flex;align-items:stretch;padding:12px 16px 14px;
                border-bottom:2px solid #e8ecf4;margin-bottom:4px;">
      <div style="flex:1;min-width:0;"></div>

      <div style="display:flex;flex-direction:column;align-items:center;
                  background:#fef3ee;border-radius:12px;border:1px solid #f0c9b0;
                  padding:8px 0 7px;${GAP}width:160px;flex-shrink:0;">
        <span style="font-size:10px;font-weight:800;color:#bf360c;text-transform:uppercase;
                     letter-spacing:.7px;margin-bottom:8px;white-space:nowrap;">🎖️ Peran</span>
        <div style="display:flex;width:100%;">
          <div style="${COL.owner}"><span style="font-size:11px;font-weight:700;color:#e8541e;">Owner</span></div>
          <div style="${COL.admin}"><span style="font-size:11px;font-weight:700;color:#1a6ac7;">Admin</span></div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;align-items:center;
                  background:#fff4ee;border-radius:12px;border:1px solid #f0d0c0;
                  padding:8px 0 7px;${GAP}width:140px;flex-shrink:0;">
        <span style="font-size:10px;font-weight:800;color:#bf360c;text-transform:uppercase;
                     letter-spacing:.7px;margin-bottom:8px;white-space:nowrap;">🚗 Status Kerja</span>
        <div style="display:flex;width:100%;">
          <div style="${COL.tl}"><span style="font-size:11px;font-weight:700;color:#e65100;">Tugas Luar</span></div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;align-items:center;
                  background:#fff8e1;border-radius:12px;border:1px solid #f0e0a0;
                  padding:8px 0 7px;width:140px;flex-shrink:0;">
        <span style="font-size:10px;font-weight:800;color:#b45309;text-transform:uppercase;
                     letter-spacing:.7px;margin-bottom:8px;white-space:nowrap;">🏠 Tempat Tinggal</span>
        <div style="display:flex;width:100%;">
          <div style="${COL.mess}"><span style="font-size:11px;font-weight:700;color:#e67e22;">Mess</span></div>
        </div>
      </div>
    </div>`;

    const rowsHTML = anggota.map(u => {
      const isMess  = _rulesMessList.includes(u.username);
      const isTL    = _rulesTugasLuarList.includes(u.username);
      const isOwner = u.group === "owner";
      const isAdmin = u.group === "admin";
      const nama    = u.namaLengkap || u.username;
      const initials = nama.charAt(0).toUpperCase();
      const avatar  = u.photo
        ? `<img src="${u.photo}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
        : `<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#1a237e,#4f8ef7);
               display:flex;align-items:center;justify-content:center;color:white;
               font-weight:800;font-size:15px;flex-shrink:0;">${initials}</div>`;

      return `
      <div style="display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid #f0f2f5;">
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
          ${avatar}
          <div style="min-width:0;">
            <div><span style="font-size:14px;font-weight:700;color:${isOwner?"#e8541e":isAdmin?"#1a6ac7":"#2c3e50"};">${nama}</span></div>
            <div id="mess-label-${u.username}" style="font-size:11px;margin-top:3px;display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
              <span id="peran-badge-${u.username}" style="display:none;"></span>
              ${isTL ? `<span style="color:#e65100;font-weight:600;">🚗 Tugas Luar</span>` : ""}
              <span style="color:${isMess?"#e67e22":"var(--muted)"};">${isMess ? "🏠 Mess" : "🏠 Luar Mess"}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;width:160px;flex-shrink:0;${GAP}">
          <div style="${COL.owner}">
            <input type="checkbox" id="owner-cb-${u.username}" ${isOwner?"checked":""}
              onchange="onPeranToggle('${u.username}','owner',this.checked)"
              style="width:18px;height:18px;accent-color:#e8541e;cursor:pointer;">
          </div>
          <div style="${COL.admin}">
            <input type="checkbox" id="admin-cb-${u.username}" ${isAdmin?"checked":""}
              onchange="onPeranToggle('${u.username}','admin',this.checked)"
              style="width:18px;height:18px;accent-color:#1a6ac7;cursor:pointer;">
          </div>
        </div>
        <div style="display:flex;width:140px;flex-shrink:0;${GAP}">
          <div style="${COL.tl}">
            <input type="checkbox" id="tl-cb-${u.username}" ${isTL?"checked":""}
              onchange="onTugasLuarToggle('${u.username}',this.checked)"
              style="width:18px;height:18px;accent-color:#e65100;cursor:pointer;">
          </div>
        </div>
        <div style="display:flex;width:140px;flex-shrink:0;">
          <div style="${COL.mess}">
            <input type="checkbox" id="mess-cb-${u.username}" ${isMess?"checked":""}
              onchange="onMessToggle('${u.username}',this.checked)"
              style="width:18px;height:18px;accent-color:#e67e22;cursor:pointer;">
          </div>
        </div>
      </div>`;
    }).join("");

    const hdrElD = document.getElementById("rules-mess-header");
    if (hdrElD) hdrElD.innerHTML = colHeaderHTML;
    el.innerHTML = rowsHTML;
  }
}

// Helper: rebuild baris status (badge peran + Tugas Luar + Mess) dari state cache
function _rebuildStatusLabel(username) {
  const label = document.getElementById(`mess-label-${username}`);
  if (!label) return;
  const isMess  = _rulesMessList.includes(username);
  const isTL    = _rulesTugasLuarList.includes(username);
  const peranNow = _rulesAdminList[username];
  // Tentukan teks & warna badge dari state
  let badgeText = "Anggota", badgeBg = "#546e7a";
  if (peranNow === "owner")  { badgeText = "Owner"; badgeBg = "#e8541e"; }
  else if (peranNow === "admin") { badgeText = "Admin"; badgeBg = "#1a6ac7"; }
  // Rebuild innerHTML — tetap sertakan id peran-badge agar onPeranToggle masih bisa cari elemen
  // Update warna nama sesuai peran baru
  const nameEl = label.closest('[style*="min-width:0"]')?.querySelector('span[style*="font-weight:700"][style*="color"]');
  if (nameEl) {
    nameEl.style.color = peranNow === "owner" ? "#e8541e" : peranNow === "admin" ? "#1a6ac7" : "#2c3e50";
  }
  label.innerHTML =
    `<span id="peran-badge-${username}" style="display:none;"></span>` +
    (isTL ? `<span style="color:#e65100;font-weight:600;">🚗 Tugas Luar</span>` : "") +
    `<span style="color:${isMess ? "#e67e22" : "var(--muted)"};">${isMess ? "🏠 Mess" : "🏠 Luar Mess"}</span>`;
}

function onMessToggle(username, checked) {
  if (checked) {
    if (!_rulesMessList.includes(username)) _rulesMessList.push(username);
  } else {
    _rulesMessList = _rulesMessList.filter(u => u !== username);
  }
  // Update label teks (desktop / card layout)
  _rebuildStatusLabel(username);
  // Update warna sel di spreadsheet layout (mobile)
  const cb = document.getElementById(`mess-cb-${username}`);
  if (cb && cb.parentElement) {
    cb.parentElement.style.background = checked ? "#fffbf0" : "transparent";
  }
}

function onTugasLuarToggle(username, checked) {
  if (checked) {
    if (!_rulesTugasLuarList.includes(username)) _rulesTugasLuarList.push(username);
  } else {
    _rulesTugasLuarList = _rulesTugasLuarList.filter(u => u !== username);
  }
  // Update status label di bawah nama
  _rebuildStatusLabel(username);
}

// Checkbox Owner/Admin — hanya satu yang aktif per anggota, yang lain otomatis uncheck
function onPeranToggle(username, peran, checked) {
  if (checked) {
    // Set peran baru
    _rulesAdminList[username] = peran;
    // Uncheck checkbox peran lain untuk user ini
    const other = peran === "owner" ? "admin" : "owner";
    const otherCb = document.getElementById(`${other}-cb-${username}`);
    if (otherCb) otherCb.checked = false;
  } else {
    // Unchecked → kembalikan ke group anggota biasa (akan ditentukan saat simpan)
    _rulesAdminList[username] = "__remove__";
  }
  // Update tampilan label status di bawah nama
  _rebuildStatusLabel(username);
}

// Helper: update tampilan border label checkbox di mobile card setelah toggle
function updateRulesCardStyle(username) {
  // Tidak perlu aksi tambahan — onPeranToggle sudah update badge
  // Border label di-handle oleh CSS accent-color saja
}

// Tooltip nama lengkap untuk mobile spreadsheet layout
(function() {
  let _tooltip = null;
  let _closeTimer = null;

  window.showNamaTooltip = function(el, namaLengkap) {
    // Hapus tooltip lama jika ada
    if (_tooltip) { _tooltip.remove(); _tooltip = null; }
    if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }

    const tip = document.createElement('div');
    tip.textContent = namaLengkap;
    tip.style.cssText = `
      position:fixed;
      background:#1a237e;
      color:white;
      font-size:12px;
      font-weight:600;
      padding:6px 12px;
      border-radius:20px;
      white-space:nowrap;
      z-index:9999;
      box-shadow:0 4px 16px rgba(0,0,0,.25);
      pointer-events:none;
      opacity:0;
      transition:opacity .15s ease;
    `;
    document.body.appendChild(tip);
    _tooltip = tip;

    // Posisikan di atas elemen yang disentuh
    const rect = el.getBoundingClientRect();
    const tipW  = tip.offsetWidth || 160;
    let left = rect.left + rect.width / 2 - tipW / 2;
    // Jangan sampai keluar layar kanan/kiri
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    tip.style.left = left + 'px';
    tip.style.top  = (rect.top - 36) + 'px';

    // Fade in
    requestAnimationFrame(() => { tip.style.opacity = '1'; });

    // Auto-hilang setelah 2 detik
    _closeTimer = setTimeout(() => {
      if (_tooltip) {
        _tooltip.style.opacity = '0';
        setTimeout(() => { if (_tooltip) { _tooltip.remove(); _tooltip = null; } }, 150);
      }
    }, 2000);

    // Tap di luar = tutup
    const dismiss = (e) => {
      if (e.target !== el) {
        if (_tooltip) { _tooltip.style.opacity='0'; setTimeout(()=>{ if(_tooltip){_tooltip.remove();_tooltip=null;} },150); }
        if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer=null; }
        document.removeEventListener('touchstart', dismiss);
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => {
      document.addEventListener('touchstart', dismiss, { once: false, passive: true });
      document.addEventListener('mousedown', dismiss, { once: false });
    }, 100);
  };
})();

async function saveRulesMess() {
  try {
    // 1. Simpan Mess list
    const r = await authFetch("/rules/mess", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messList: _rulesMessList })
    });
    const d = await r.json();
    if (d.status !== "OK") {
      showToast("❌ Gagal menyimpan", "error");
      return;
    }

    // 2. Fetch state anggota terkini sebagai basis perbandingan
    const ra = await authFetch("/anggota");
    const anggota = await ra.json();

    // Cari group default anggota biasa (bukan owner/admin) — ambil group pertama yang bukan keduanya
    let defaultGroup = "anggota";
    const rg = await authFetch("/groups");
    const allGroups = await rg.json();
    const nonPriv = allGroups.find(g => g.id !== "owner" && g.id !== "admin");
    if (nonPriv) defaultGroup = nonPriv.id;

    // 3. Simpan status Tugas Luar yang berubah
    const tlPromises = anggota.map(u => {
      const shouldBeTL  = _rulesTugasLuarList.includes(u.username);
      const currentlyTL = u.statusKerja === "Tugas Luar";
      if (shouldBeTL === currentlyTL) return Promise.resolve();
      return authFetch(`/anggota/${u.username}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusKerja: shouldBeTL ? "Tugas Luar" : "" })
      });
    });

    // 4. Simpan perubahan Peran (Owner/Admin) yang berubah
    const peranPromises = anggota.map(u => {
      const newGroup = _rulesAdminList[u.username];
      if (!newGroup) return Promise.resolve(); // tidak ada perubahan
      const targetGroup = newGroup === "__remove__" ? defaultGroup : newGroup;
      if (targetGroup === u.group) return Promise.resolve(); // tidak ada perubahan
      return authFetch(`/anggota/${u.username}/group`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: targetGroup })
      });
    });

    await Promise.all([...tlPromises, ...peranPromises]);

    showToast("✅ Aturan absensi berhasil disimpan!");
    loadRules(); // refresh tampilan
  } catch {
    showToast("❌ Gagal menyimpan", "error");
  }
}

// ── ICON & WARNA per group ───────────────────────────────────
const GROUP_META = {
  owner:       { emoji:"👑", strip:"#e64a19", bg:"#bf360c", card:"#e8541e", text:"#fff" },
  admin:       { emoji:"🛡️",  strip:"#1565c0", bg:"#0d47a1", card:"#1a6ac7", text:"#fff" },
  manager:     { emoji:"💼", strip:"#00695c", bg:"#004d40", card:"#00796b", text:"#fff" },
  koordinator: { emoji:"🎯", strip:"#4527a0", bg:"#311b92", card:"#5c35c9", text:"#fff" },
  anggota:     { emoji:"👤", strip:"#455a64", bg:"#263238", card:"#546e7a", text:"#fff" },
};
function _gMeta(gid) {
  return GROUP_META[gid] || { emoji:"👤", strip:"#4f8ef7", bg:"#1a237e" };
}

// Helper: label & warna jabatan konsisten dari group
const _GROUP_LABEL = {
  owner:       { label:"Owner",       color:"#e8541e" },
  admin:       { label:"Admin",       color:"#1a6ac7" },
  manager:     { label:"Manager",     color:"#00796b" },
  koordinator: { label:"Koordinator", color:"#5c35c9" },
  anggota:     { label:"Anggota",     color:"#546e7a" },
};
function _jabatanInfo(group, jabatan) {
  // Normalisasi
  const g   = (group   || "").toLowerCase();
  const jab = (jabatan || "").trim();
  const jabLower = jab.toLowerCase();

  // Jabatan "isi" = ada nilai dan bukan label default group/kosong
  const isDefaultJab = new Set(["anggota","admin","owner","manager","koordinator","-",""]).has(jabLower);
  const hasJabatan   = jab && !isDefaultJab;

  const meta = _GROUP_LABEL[g]; // warna selalu ikut group

  let label;
  if (g === "owner") {
    // Rule 2: Peran Owner → selalu "Owner" apapun jabatannya
    label = "Owner";
  } else if (hasJabatan) {
    // Rule 1 & 3: Jabatan isi + Peran bukan Owner → gunakan jabatan divisi
    label = jab;
  } else if (g === "admin") {
    // Rule 4: Jabatan kosong + Peran Admin → "Admin"
    label = "Admin";
  } else {
    // Rule 5: Jabatan kosong + Peran kosong → "Anggota"
    label = "Anggota";
  }

  return {
    label,
    color: meta ? meta.color : "#546e7a",
  };
}

// ── LOAD GROUPS — render sebagai kartu list ──────────────────
let _aksesGroups = []; // cache dari server

async function loadGroups() {
  const list = document.getElementById("group-list");
  list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px;font-size:13px;">Memuat...</p>';
  try {
    const r = await authFetch("/groups");
    _aksesGroups = await r.json();

    // Inisialisasi state lokal
    _aksesGroups.forEach(g => {
      _aksesTemp[g.id] = new Set(g.menus || []);
    });

    _renderGroupList();
  } catch(e) {
    list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Gagal memuat data jabatan</p>';
  }
}

function _renderGroupList() {
  const list = document.getElementById("group-list");
  if (!list) return;
  list.innerHTML = _aksesGroups.map(g => {
    const isOwner = g.id === "owner";
    const meta    = _gMeta(g.id);
    const total   = allMenuKeys().length;
    const cnt     = isOwner ? total : (_aksesTemp[g.id] ? _aksesTemp[g.id].size : 0);
    return `
    <div class="group-card-new" style="background:${meta.card};" onclick="openAksesDetail('${g.id}')">
      <div class="gc-row">
        <div class="gc-left">
          <div class="gc-avatar">${meta.emoji}</div>
          <div>
            <div class="gc-name" style="color:#fff;">${g.name}</div>
            <div class="gc-meta" style="color:#fff;">Level ${g.level} · ${isOwner ? 'Akses penuh' : cnt+' dari '+total+' akses aktif'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${isOwner ? '<span class="gc-lock">Terkunci</span>' : ''}
          <span class="gc-chevron" style="color:#fff;">›</span>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ── SLIDE-IN DETAIL ──────────────────────────────────────────
let _aksesActiveGid  = null;
let _aksesOrigSnap   = {};   // snapshot sebelum edit: { gid: Set }

function openAksesDetail(gid) {
  const g = _aksesGroups.find(x => x.id === gid);
  if (!g) return;
  _aksesActiveGid = gid;

  // Snapshot state awal (untuk deteksi dirty)
  _aksesOrigSnap[gid] = new Set(_aksesTemp[gid] || []);

  const meta    = _gMeta(gid);
  const isOwner = gid === "owner";

  // Warnai header
  const headerBg = meta.bg;
  document.getElementById("akd-topbar").style.background = headerBg;
  document.getElementById("akd-meta").style.background   = headerBg;
  document.getElementById("akd-strip").style.background  = meta.strip;
  document.getElementById("akd-title").textContent       = g.name + " " + meta.emoji;

  const total = allMenuKeys().length;
  const cnt   = isOwner ? total : (_aksesTemp[gid] ? _aksesTemp[gid].size : 0);
  document.getElementById("akd-meta-text").textContent =
    `Level ${g.level} · ${isOwner ? "Akses penuh" : cnt+" akses aktif"}`;

  _renderAksesDetail(gid, isOwner);
  _updateAkdSaveBtn(gid);

  // Buka slide
  document.getElementById("view-akses-detail").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeAksesDetail() {
  document.getElementById("view-akses-detail").classList.remove("open");
  document.body.style.overflow = "";
  _aksesActiveGid = null;
  // Refresh list agar counter akses terupdate
  _renderGroupList();
}

function _renderAksesDetail(gid, isOwner) {
  const body = document.getElementById("akd-body");
  const cur  = _aksesTemp[gid];
  const orig = _aksesOrigSnap[gid];

  const sections = menusBySection();
  body.innerHTML = Object.entries(sections).map(([secName, menus]) => {
    // Semua key di section ini (parent + child)
    const secKeys = menus.flatMap(m => [m.key, ...(m.children||[]).map(c=>c.key)]);
    const allOn   = secKeys.every(k => {
      const mDef = ALL_MENUS.find(x=>x.key===k) || menus.flatMap(m=>(m.children||[])).find(c=>c.key===k);
      return isOwner || (mDef && mDef.alwaysOn) || (cur && cur.has(k));
    });

    const rows = menus.map(m => {
      const isAlways   = m.alwaysOn === true;
      const isChecked  = isOwner || (cur && cur.has(m.key)) || isAlways;
      const isDisabled = isOwner || isAlways;
      const changed    = !isDisabled && orig && (cur.has(m.key) !== orig.has(m.key));

      const parentRow = `
        <div class="akd-row${changed?' changed':''}">
          <div class="akd-row-left">
            <span class="akd-icon">${m.icon||'📌'}</span>
            <span class="akd-label">${m.label}</span>
            ${isAlways ? '<span class="akd-always">Selalu aktif</span>' : ''}
          </div>
          <label class="akd-tog">
            <input type="checkbox" ${isChecked?'checked':''} ${isDisabled?'disabled':''}
              onchange="onAksesToggle('${gid}','${m.key}',this.checked)">
            <div class="akd-tog-sl"></div>
          </label>
        </div>`;

      const childRows = (m.children||[]).map(c => {
        const cChecked  = isOwner || (cur && cur.has(c.key)) || isAlways;
        const cDisabled = isOwner || isAlways;
        const cChanged  = !cDisabled && orig && (cur.has(c.key) !== orig.has(c.key));
        return `
        <div class="akd-row child${cChanged?' changed':''}">
          <div class="akd-row-left">
            <span class="akd-label sub" style="padding-left:4px;">└ ${c.label}</span>
          </div>
          <label class="akd-tog">
            <input type="checkbox" ${cChecked?'checked':''} ${cDisabled?'disabled':''}
              onchange="onAksesToggle('${gid}','${c.key}',this.checked)">
            <div class="akd-tog-sl"></div>
          </label>
        </div>`;
      }).join("");

      return parentRow + childRows;
    }).join("");

    // Tombol "aktifkan/nonaktifkan semua" — hanya untuk non-owner
    const sectionAllBtn = (!isOwner) ? `
      <span class="akd-section-all"
        onclick="toggleAksesSection('${gid}','${secName}',${allOn})">
        ${allOn ? 'Nonaktifkan semua' : 'Aktifkan semua'}
      </span>` : '';

    return `
    <div class="akd-section">
      <div class="akd-section-head">
        <span class="akd-section-label">${secName}</span>
        ${sectionAllBtn}
      </div>
      ${isOwner ? '<div style="font-size:12px;color:var(--muted);padding:12px 14px;text-align:center;">👑 Owner selalu memiliki akses penuh ke semua menu.</div>' : rows}
    </div>`;
  }).join("");
}

function _updateAkdSaveBtn(gid) {
  const btn    = document.getElementById("akd-save-btn");
  const banner = document.getElementById("akd-dirty-banner");
  const dirty  = _isAksesDirty(gid);
  btn.disabled = !dirty;
  btn.classList.toggle("dirty", dirty);
  if (banner) banner.style.display = dirty ? "block" : "none";
}

function _isAksesDirty(gid) {
  const cur  = _aksesTemp[gid];
  const orig = _aksesOrigSnap[gid];
  if (!cur || !orig) return false;
  return Array.from(cur).sort().join() !== Array.from(orig).sort().join();
}

// Toggle section semua menu
function toggleAksesSection(gid, secName, currentlyAllOn) {
  const sections = menusBySection();
  const menus    = sections[secName] || [];
  const cur      = _aksesTemp[gid];
  if (!cur) return;
  menus.forEach(m => {
    const isAlways = m.alwaysOn === true;
    if (isAlways) return;
    const keys = [m.key, ...(m.children||[]).map(c=>c.key)];
    keys.forEach(k => currentlyAllOn ? cur.delete(k) : cur.add(k));
  });
  cur.add("home");
  _renderAksesDetail(gid, false);
  _updateAkdSaveBtn(gid);
}

// Simpan dari detail view
async function saveAksesDetail() {
  const gid = _aksesActiveGid;
  if (!gid) return;
  const state = _aksesTemp[gid];
  if (!state) return;

  const btn = document.getElementById("akd-save-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Menyimpan...";

  try {
    const menus = Array.from(state);
    const r = await authFetch(`/groups/${gid}/menus`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menus })
    });
    const d = await r.json();
    if (d.status === "OK") {
      // Update snapshot setelah berhasil simpan
      _aksesOrigSnap[gid] = new Set(state);
      // Update cache _aksesGroups agar list terupdate
      const g = _aksesGroups.find(x=>x.id===gid);
      if (g) g.menus = menus;
      showToast("✅ Pengaturan akses berhasil disimpan!");
      _updateAkdSaveBtn(gid);
      // Update meta text
      const total = allMenuKeys().length;
      const cnt   = state.size;
      document.getElementById("akd-meta-text").textContent =
        `Level ${g ? g.level : ''} · ${cnt} akses aktif`;
    } else if (d.status === "PROTECTED") {
      showToast("⚠️ Owner tidak bisa diubah", "warning");
    } else {
      showToast("❌ Gagal menyimpan", "error");
    }
  } catch {
    showToast("❌ Gagal terhubung ke server", "error");
  }

  btn.disabled = false;
  btn.textContent = "Simpan";
  btn.classList.toggle("dirty", _isAksesDirty(gid));
}

window.openAksesDetail    = openAksesDetail;
window.closeAksesDetail   = closeAksesDetail;
window.saveAksesDetail    = saveAksesDetail;
window.toggleAksesSection = toggleAksesSection;

// Toggle hanya update state lokal — TIDAK langsung simpan ke server
function onAksesToggle(groupId, menuKey, enabled) {
  const state = _aksesTemp[groupId];
  if (!state) return;

  // Jika parent di-toggle, ikutkan semua child
  const parentMenu = ALL_MENUS.find(m => m.key === menuKey);
  if (parentMenu?.children) {
    parentMenu.children.forEach(c => {
      enabled ? state.add(c.key) : state.delete(c.key);
    });
  }

  if (enabled) {
    state.add(menuKey);
    // Jika child di-enable, pastikan parentnya ikut aktif
    const parentEntry = ALL_MENUS.find(m => (m.children||[]).some(c => c.key === menuKey));
    if (parentEntry) state.add(parentEntry.key);
  } else {
    state.delete(menuKey);
  }

  // home selalu ada
  state.add("home");

  // Re-render detail view dan update save button
  if (_aksesActiveGid === groupId) {
    _renderAksesDetail(groupId, false);
    _updateAkdSaveBtn(groupId);
  }
}

// Simpan state lokal ke server untuk satu group
async function saveGroupMenus(groupId) {
  const state = _aksesTemp[groupId];
  if (!state) return;

  const btn = document.getElementById("save-btn-" + groupId);
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Menyimpan..."; }

  try {
    const menus = Array.from(state);
    const r = await authFetch(`/groups/${groupId}/menus`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menus })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Pengaturan akses berhasil disimpan!");
    } else if (d.status === "PROTECTED") {
      showToast("⚠️ Owner tidak bisa diubah", "warning");
    } else {
      showToast("❌ Gagal menyimpan", "error");
    }
  } catch {
    showToast("❌ Gagal menyimpan", "error");
  }

  if (btn) { btn.disabled = false; btn.innerHTML = `💾 Simpan Pengaturan`; }
}

let _groupOverlayActiveId  = null;
let _groupOverlayPlaceholder = null; // penampung sementara saat elemen dipindah

// Daftar gbody yang punya elemen dengan ID unik — harus dipindah, bukan dicopy
const GROUP_MOVE_IDS = new Set(["gbody-sistem", "gbody-rules-absensi"]);

function toggleGroupBody(id) {
  if (_groupOverlayActiveId === id) { closeGroupOverlay(); return; }
  openGroupOverlay(id);
}

function openGroupOverlay(id) {
  const body    = document.getElementById(id);
  const overlay = document.getElementById("group-overlay");
  const obody   = document.getElementById("group-overlay-body");
  const ofooter = document.getElementById("group-overlay-footer");
  const otitle  = document.getElementById("group-overlay-title");
  const osub    = document.getElementById("group-overlay-subtitle");
  if (!body || !overlay || !obody) return;

  // Tutup overlay sebelumnya jika ada
  if (_groupOverlayActiveId) _restoreGroupBody();

  // Ambil info judul dari group-header
  const groupItem   = body.parentElement;
  const titleEl     = groupItem ? groupItem.querySelector(".group-title") : null;
  const levelEl     = groupItem ? groupItem.querySelector(".group-level,.group-level-sub") : null;
  const headerEl    = groupItem ? groupItem.querySelector(".group-header") : null;
  const headerBg    = headerEl ? headerEl.style.background : "var(--primary)";

  if (otitle) otitle.textContent = titleEl ? titleEl.textContent.trim() : "";
  if (osub)   osub.textContent   = levelEl ? levelEl.textContent.trim() : "";

  // Warnai titlebar sesuai header accordion
  const titlebar = document.getElementById("group-overlay-titlebar");
  if (titlebar) {
    titlebar.style.background = headerBg;
    titlebar.style.borderBottom = "none";
  }
  const titleDiv = document.getElementById("group-overlay-title");
  const subDiv   = document.getElementById("group-overlay-subtitle");
  const closeBtn = document.getElementById("group-overlay-close");
  if (titleDiv) titleDiv.style.color = "white";
  if (subDiv)   subDiv.style.color   = "rgba(255,255,255,.75)";
  if (closeBtn) { closeBtn.style.background = "rgba(255,255,255,.2)"; closeBtn.style.color = "white"; }

  if (GROUP_MOVE_IDS.has(id)) {
    // ── PINDAH elemen (agar ID unik tidak duplikat) ──
    const ph = document.createElement("div");
    ph.id = "grp-ph-" + id;
    ph.style.display = "none";
    body.parentNode.insertBefore(ph, body);
    _groupOverlayPlaceholder = ph;

    // Pisah save-bar dulu ke footer
    const saveBar = body.querySelector(".group-save-bar");
    if (saveBar && ofooter) {
      ofooter.appendChild(saveBar);
      ofooter.style.display = "block";
    } else if (ofooter) {
      ofooter.style.display = "none";
    }

    // Pindah SEMUA sisa children ke obody (header + scroll-area)
    obody.innerHTML = "";
    while (body.firstChild) {
      obody.appendChild(body.firstChild);
    }
  } else {
    // ── COPY innerHTML (accordion biasa tanpa ID unik) ──
    const scrollArea = body.querySelector(".group-scroll-area");
    const saveBar    = body.querySelector(".group-save-bar");
    obody.innerHTML  = scrollArea ? scrollArea.innerHTML : body.innerHTML;
    if (saveBar && ofooter) {
      ofooter.innerHTML     = saveBar.innerHTML;
      ofooter.style.display = "block";
    } else if (ofooter) {
      ofooter.style.display = "none";
    }
  }

  // Chevron aktif
  document.querySelectorAll(".akses-chevron").forEach(c => c.style.transform = "");
  const chev = document.getElementById("chev-" + id.replace("gbody-", ""));
  if (chev) chev.style.transform = "rotate(90deg)";

  _groupOverlayActiveId = id;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  // Untuk Pengaturan Karyawan: reload setelah overlay terbuka agar lebar container akurat
  if (id === "gbody-rules-absensi" && typeof loadRules === "function") {
    requestAnimationFrame(() => loadRules());
  }
}

function _restoreGroupBody() {
  if (!_groupOverlayActiveId) return;
  const id      = _groupOverlayActiveId;
  const body    = document.getElementById(id);
  const obody   = document.getElementById("group-overlay-body");
  const ofooter = document.getElementById("group-overlay-footer");

  if (GROUP_MOVE_IDS.has(id) && body) {
    const ph      = document.getElementById("grp-ph-" + id);
    const saveBar = ofooter ? ofooter.querySelector(".group-save-bar") : null;

    // Kembalikan save-bar ke body dulu
    if (saveBar) body.appendChild(saveBar);

    // Kembalikan semua children obody ke body (header + scroll-area)
    while (obody && obody.firstChild) {
      body.appendChild(obody.firstChild);
    }

    if (ph) ph.parentNode.removeChild(ph);
  }

  if (obody)   obody.innerHTML = "";
  if (ofooter) { ofooter.innerHTML = ""; ofooter.style.display = "none"; }
  _groupOverlayPlaceholder = null;
}

function closeGroupOverlay() {
  const overlay = document.getElementById("group-overlay");
  _restoreGroupBody();
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
  if (_groupOverlayActiveId) {
    const chev = document.getElementById("chev-" + _groupOverlayActiveId.replace("gbody-", ""));
    if (chev) chev.style.transform = "";
  }
  _groupOverlayActiveId = null;
}

function _groupOverlayBgClick(e) {
  if (e.target === document.getElementById("group-overlay")) closeGroupOverlay();
}

// Tutup overlay saat pindah halaman — patch openView tanpa redeclare const
(function() {
  const _prev = window.openView;
  if (_prev) {
    window.openView = function(viewId) {
      if (_groupOverlayActiveId) closeGroupOverlay();
      _prev(viewId);
    };
  }
})();

window.toggleGroupBody       = toggleGroupBody;
window.openGroupOverlay      = openGroupOverlay;
window.closeGroupOverlay     = closeGroupOverlay;
window._groupOverlayBgClick  = _groupOverlayBgClick;

// ============================================================
// AREA
// ============================================================
// Cache data area (hanya owner/admin yang bisa akses, tidak bocor ke anggota biasa)
let _areasCache = [];

async function loadAreas() {
  try {
    const r    = await authFetch("/areas");
    if (!r.ok) { document.getElementById("area-list").innerHTML='<p style="color:var(--danger);text-align:center;padding:20px;">⛔ Akses ditolak</p>'; return; }
    const data = await r.json();
    _areasCache = data;
    const list = document.getElementById("area-list");
    if (!data.length) { list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada area</p>'; return; }
    list.innerHTML = data.map(a => `
      <div class="area-item" style="flex-direction:column;align-items:stretch;padding:0;">
        <!-- Baris utama: nama + tombol aksi -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;"
             onclick="toggleAreaMap('${a.id}')" style="cursor:pointer;">
          <div style="cursor:pointer;flex:1;">
            <div class="area-name">📍 ${a.name}
              <span id="area-chevron-${a.id}" style="font-size:11px;color:var(--muted);margin-left:6px;transition:transform .2s;">▼</span>
            </div>
            <div class="area-detail">Radius: ${a.radius}m · ${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;" onclick="event.stopPropagation()">
            ${userLevel <= 2
              ? `<span class="area-active ${a.active?'on':'off'}" onclick="toggleArea('${a.id}',${!a.active})" style="cursor:pointer;">
                  ${a.active?'✅ Aktif':'❌ Nonaktif'}
                 </span>
                 <button onclick="deleteArea('${a.id}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>`
              : `<span class="area-active ${a.active?'on':'off'}" style="pointer-events:none;opacity:.8;">
                  ${a.active?'✅ Aktif':'❌ Nonaktif'}
                 </span>`
            }
          </div>
        </div>
        <!-- Peta mini (tersembunyi default) -->
        <div id="area-map-wrap-${a.id}" style="display:none;padding:0 12px 12px;">
          <div id="area-map-mini-${a.id}" style="width:100%;height:200px;border-radius:10px;border:1.5px solid #e8ecf0;z-index:1;"></div>
        </div>
      </div>`).join("");
  } catch {}
}

// Objek simpan instance peta mini agar tidak double-init
const _areaMiniMaps = {};

function toggleAreaMap(id) {
  const wrap     = document.getElementById(`area-map-wrap-${id}`);
  const chevron  = document.getElementById(`area-chevron-${id}`);
  const isOpen   = wrap.style.display !== "none";

  wrap.style.display = isOpen ? "none" : "block";
  chevron.style.transform = isOpen ? "" : "rotate(180deg)";

  if (!isOpen && !_areaMiniMaps[id]) {
    // Gunakan cache — tidak fetch ulang (hindari expose koordinat)
    const data = _areasCache;
    (() => {
      const a = data.find(x => x.id === id);
      if (!a) return;
      const mapEl = document.getElementById(`area-map-mini-${id}`);
      if (!mapEl) return;
      const m = L.map(`area-map-mini-${id}`, { zoomControl: true, dragging: true })
                 .setView([a.lat, a.lng], 17);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles © Esri", maxZoom: 19
      }).addTo(m);
      L.marker([a.lat, a.lng]).addTo(m)
       .bindPopup(`📍 ${a.name}<br><small>Radius: ${a.radius}m</small>`).openPopup();
      L.circle([a.lat, a.lng], {
        radius: a.radius, color: "#4f8ef7", fillColor: "#4f8ef7", fillOpacity: 0.15
      }).addTo(m);
      _areaMiniMaps[id] = m;
      setTimeout(() => m.invalidateSize(), 150);
    })();
  } else if (!isOpen && _areaMiniMaps[id]) {
    setTimeout(() => _areaMiniMaps[id].invalidateSize(), 150);
  }
}

// ---- TAB SWITCHER AREA ----
function switchAreaTab(tab) {
  // Non-admin tidak boleh akses tab tambah meski dipanggil langsung
  if (tab === "tambah" && userLevel > 2) {
    showToast("⛔ Hanya Owner/Admin yang bisa menambah area", "error"); return;
  }
  const isTambah = tab === "tambah";
  document.getElementById("area-panel-daftar").style.display = isTambah ? "none" : "block";
  document.getElementById("area-panel-tambah").style.display = isTambah ? "block" : "none";
  document.getElementById("area-tab-daftar").style.background = isTambah ? "white" : "var(--primary)";
  document.getElementById("area-tab-daftar").style.color      = isTambah ? "var(--muted)" : "white";
  document.getElementById("area-tab-tambah").style.background = isTambah ? "var(--primary)" : "white";
  document.getElementById("area-tab-tambah").style.color      = isTambah ? "white" : "var(--muted)";

  if (isTambah) {
    setTimeout(() => {
      if (!_areaMap) {
        // ── Init map langsung dengan koordinat default (Bali) ─────────────
        // Tidak tunggu GPS agar map langsung muncul dan search bisa dipakai
        const defLat = -8.6500000, defLng = 115.2200000;
        initAreaMap(defLat, defLng);

        // ── GPS hanya untuk update bias search — TIDAK paksa pindah map ──
        // Ini penting agar admin bisa cari lokasi cabang di kota lain
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            p => {
              // Hanya update bias koordinat untuk relevansi search
              _updateLocationBias(p.coords.latitude, p.coords.longitude);
              // Tampilkan info di coords display
              const coordEl = document.getElementById("area-coords-display");
              if (coordEl && coordEl.textContent.includes("Belum")) {
                coordEl.textContent = `📡 GPS siap — gunakan search atau klik peta`;
              }
            },
            () => { /* GPS gagal — bias tetap default, tidak masalah */ },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
          );
        }
      } else {
        // Map sudah ada — pastikan render ulang setelah panel visible
        _areaMap.invalidateSize();
      }
    }, 250); // sedikit lebih lama agar panel sudah fully visible
  }
}

// ---- MAP AREA KANTOR ----
let _areaMap = null;
let _areaMarker = null;
let _areaCircle = null;

function initAreaMap(lat, lng) {
  if (_areaMap) {
    _areaMap.setView([lat, lng], 16);
    _setAreaMarker(lat, lng);
    return;
  }
  _areaMap = L.map("area-map").setView([lat, lng], 16);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles © Esri", maxZoom: 19
  }).addTo(_areaMap);

  // Klik peta = pindah marker
  _areaMap.on("click", function(e) {
    _setAreaMarker(e.latlng.lat, e.latlng.lng);
  });

  _setAreaMarker(lat, lng);
}

function _setAreaMarker(lat, lng) {
  const radius = parseInt(document.getElementById("area-radius").value) || 100;
  if (_areaMarker) {
    _areaMarker.setLatLng([lat, lng]);
  } else {
    _areaMarker = L.marker([lat, lng], { draggable: true })
      .addTo(_areaMap)
      .bindPopup("📍 Titik Kantor<br><small>Seret untuk pindah</small>")
      .openPopup();
    _areaMarker.on("dragend", function(e) {
      const pos = e.target.getLatLng();
      _updateAreaCoords(pos.lat, pos.lng);
    });
  }
  if (_areaCircle) {
    _areaCircle.setLatLng([lat, lng]).setRadius(radius);
  } else {
    _areaCircle = L.circle([lat, lng], { radius, color:"#4f8ef7", fillColor:"#4f8ef7", fillOpacity:0.15 }).addTo(_areaMap);
  }
  _updateAreaCoords(lat, lng);
}

function _updateAreaCoords(lat, lng) {
  _updateLocationBias(lat, lng);
  document.getElementById("area-lat").value = lat.toFixed(7);
  document.getElementById("area-lng").value = lng.toFixed(7);
  document.getElementById("area-coords-display").textContent =
    `📌 Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
}

function updateAreaCircle() {
  if (!_areaCircle || !_areaMarker) return;
  const radius = parseInt(document.getElementById("area-radius").value) || 100;
  _areaCircle.setRadius(radius);
}

function getMyLoc() {
  const btn = document.querySelector("button[onclick='getMyLoc()']");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Mengambil..."; }

  navigator.geolocation.getCurrentPosition(
    p => {
      const lat = p.coords.latitude;
      const lng = p.coords.longitude;
      _updateLocationBias(lat, lng);

      // Kosongkan search input agar user tahu posisi diambil dari GPS
      const searchEl = document.getElementById("area-search-input");
      if (searchEl) searchEl.value = "";
      const suggestEl = document.getElementById("area-search-suggest");
      if (suggestEl) suggestEl.style.display = "none";

      if (_areaMap) {
        _areaMap.invalidateSize();
        _areaMap.setView([lat, lng], 17);
        _setAreaMarker(lat, lng);
      } else {
        initAreaMap(lat, lng);
      }

      // Update coords display dengan label jelas
      const coordEl = document.getElementById("area-coords-display");
      if (coordEl) {
        const acc = p.coords.accuracy ? ` ±${Math.round(p.coords.accuracy)}m` : "";
        coordEl.textContent = `📍 Lokasi saya: ${lat.toFixed(6)}, ${lng.toFixed(6)}${acc}`;
      }

      showToast("📍 Lokasi berhasil diambil!");
      if (btn) { btn.disabled = false; btn.innerHTML = "📍 Lokasi Saya"; }
    },
    err => {
      if (btn) { btn.disabled = false; btn.innerHTML = "📍 Lokasi Saya"; }
      if (err.code === 1) {
        showToast("❌ Izin lokasi ditolak. Aktifkan di Pengaturan HP.", "error");
      } else {
        showToast("❌ Gagal ambil lokasi. Pastikan GPS aktif.", "error");
      }
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

// ─── Search lokasi via Photon (Komoot) ───
let _searchTimeout = null;

// Simpan koordinat user terakhir untuk location bias Photon
let _userLat = -8.6500000;
let _userLng = 115.2200000;

// Update bias koordinat setiap kali ada lokasi baru (GPS / klik map / getMyLoc)
function _updateLocationBias(lat, lng) {
  _userLat = lat;
  _userLng = lng;
}

// Helper: parse hasil Photon GeoJSON ke format display
function _photonDisplayName(props) {
  const parts = [
    props.name,
    props.street,
    props.district || props.suburb,
    props.city || props.town || props.village,
    props.state,
    props.country
  ].filter(Boolean);
  return parts.join(", ");
}

// ─── Bounding box — filter hasil hanya Indonesia & prioritaskan Bali ───────────
const BBOX_INDONESIA = { minLat: -11.0, maxLat:  6.0, minLng:  95.0, maxLng: 141.0 };
const BBOX_BALI      = { minLat: -8.85, maxLat: -8.05, minLng: 114.4, maxLng: 115.75 };

// Photon pakai format: "lon_min,lat_min,lon_max,lat_max"
const PHOTON_BBOX_ID   = `${BBOX_INDONESIA.minLng},${BBOX_INDONESIA.minLat},${BBOX_INDONESIA.maxLng},${BBOX_INDONESIA.maxLat}`;
const PHOTON_BBOX_BALI = `${BBOX_BALI.minLng},${BBOX_BALI.minLat},${BBOX_BALI.maxLng},${BBOX_BALI.maxLat}`;

// Nominatim pakai format: "lon_min,lat_max,lon_max,lat_min"
const NM_BBOX_ID   = `${BBOX_INDONESIA.minLng},${BBOX_INDONESIA.maxLat},${BBOX_INDONESIA.maxLng},${BBOX_INDONESIA.minLat}`;
const NM_BBOX_BALI = `${BBOX_BALI.minLng},${BBOX_BALI.maxLat},${BBOX_BALI.maxLng},${BBOX_BALI.minLat}`;

function _inBbox(lat, lng, bbox) {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

// Fetch Photon — coba bbox tertentu, filter ketat hanya Indonesia
async function _fetchPhoton(q, bbox, limit = 6) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=id&bbox=${bbox}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.features || []).filter(f => {
    const [lng, lat] = f.geometry.coordinates;
    return _inBbox(lat, lng, BBOX_INDONESIA); // buang hasil luar Indonesia
  });
}

// Fetch Nominatim — selalu filter countrycodes=id + viewbox Indonesia
async function _fetchNominatim(q, bbox, bounded = 1, limit = 6) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}`
            + `&format=json&limit=${limit}&accept-language=id,en`
            + `&countrycodes=id&viewbox=${bbox}&bounded=${bounded}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "AbsensiSmartApp/1.0" }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data
    .filter(d => _inBbox(parseFloat(d.lat), parseFloat(d.lon), BBOX_INDONESIA))
    .map(d => ({
      geometry: { coordinates: [parseFloat(d.lon), parseFloat(d.lat)] },
      properties: { name: d.display_name.split(",")[0], _fullName: d.display_name }
    }));
}

// Helper: pastikan map sudah init dan visible sebelum setView
function _ensureMapReady(lat, lng, zoom) {
  return new Promise(resolve => {
    if (!_areaMap) {
      initAreaMap(lat, lng);
      setTimeout(() => {
        _areaMap.invalidateSize();
        _areaMap.setView([lat, lng], zoom || 17);
        resolve();
      }, 300);
    } else {
      _areaMap.invalidateSize();
      _areaMap.setView([lat, lng], zoom || 17);
      setTimeout(resolve, 50);
    }
  });
}

async function areaSearchSuggest() {
  const q = document.getElementById("area-search-input")?.value.trim();
  const box = document.getElementById("area-search-suggest");
  if (!box) return;
  clearTimeout(_searchTimeout);
  if (q.length < 2) { box.style.display = "none"; return; }

  // Tampilkan loading di dropdown
  box.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--muted);">🔍 Mencari...</div>`;
  box.style.display = "block";

  _searchTimeout = setTimeout(async () => {
    try {
      let features = [];

      // ── Strategi: Bali dulu → seluruh Indonesia → Nominatim Indonesia ──────
      // Langkah 1: Photon dengan bbox Bali (prioritas utama)
      try { features = await _fetchPhoton(q, PHOTON_BBOX_BALI, 6); } catch {}

      // Langkah 2: Photon seluruh Indonesia jika hasil Bali kosong
      if (!features.length) {
        try { features = await _fetchPhoton(q, PHOTON_BBOX_ID, 6); } catch {}
      }

      // Langkah 3: Nominatim Indonesia (bounded ke Bali dulu)
      if (!features.length) {
        try { features = await _fetchNominatim(q, NM_BBOX_BALI, 1, 6); } catch {}
      }

      // Langkah 4: Nominatim seluruh Indonesia
      if (!features.length) {
        try { features = await _fetchNominatim(q, NM_BBOX_ID, 1, 6); } catch {}
      }

      // Pastikan sekali lagi tidak ada hasil luar Indonesia yang lolos
      features = features.filter(f => {
        const [lng, lat] = f.geometry.coordinates;
        return _inBbox(lat, lng, BBOX_INDONESIA);
      });

      if (!features.length) {
        box.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--muted);">Tidak ditemukan di Indonesia. Coba tambah nama kota/kabupaten.</div>`;
        return;
      }

      box.innerHTML = features.map(f => {
        const [lng, lat] = f.geometry.coordinates;
        const props      = f.properties;
        const title      = props.name || props.street || q;
        const subtitle   = props._fullName || _photonDisplayName(props);
        const safeSubtitle = JSON.stringify(subtitle).replace(/"/g, "'");
        return `<div onclick="areaSelectSuggest(${lat},${lng},${safeSubtitle})"
          style="padding:10px 14px;font-size:13px;cursor:pointer;border-bottom:1px solid #f5f5f5;
                 color:var(--text);line-height:1.4;"
          onmouseenter="this.style.background='#f8f9ff'"
          onmouseleave="this.style.background=''">
          <div style="font-weight:600;">${title}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${subtitle}
          </div>
        </div>`;
      }).join("");
      box.style.display = "block";
    } catch {
      box.style.display = "none";
    }
  }, 400);
}

async function areaSelectSuggest(lat, lng, displayName) {
  lat = parseFloat(lat); lng = parseFloat(lng);
  document.getElementById("area-search-input").value = displayName;
  document.getElementById("area-search-suggest").style.display = "none";
  _updateLocationBias(lat, lng);
  await _ensureMapReady(lat, lng, 17);
  _setAreaMarker(lat, lng);
}

async function searchAreaLocation() {
  const q = document.getElementById("area-search-input")?.value.trim();
  if (!q) return showToast("⚠️ Masukkan nama lokasi yang ingin dicari", "warning");

  const box     = document.getElementById("area-search-suggest");
  const inputEl = document.getElementById("area-search-input");
  if (box) box.style.display = "none";

  // Loading state
  if (inputEl) inputEl.style.opacity = "0.5";
  showToast("🔍 Mencari lokasi...", "info", 3000);

  try {
    let lat, lng, displayNameResult;
    let found = false;

    // ── Strategi bertahap: Bali → Indonesia → tidak ketemu ──────────────────
    let features = [];

    // Langkah 1: Photon bbox Bali (paling presisi untuk lokasi Bali)
    try { features = await _fetchPhoton(q, PHOTON_BBOX_BALI, 5); } catch {}

    // Langkah 2: Photon seluruh Indonesia
    if (!features.length) {
      try { features = await _fetchPhoton(q, PHOTON_BBOX_ID, 5); } catch {}
    }

    // Langkah 3: Nominatim bounded Bali
    if (!features.length) {
      try { features = await _fetchNominatim(q, NM_BBOX_BALI, 1, 5); } catch {}
    }

    // Langkah 4: Nominatim seluruh Indonesia
    if (!features.length) {
      try { features = await _fetchNominatim(q, NM_BBOX_ID, 1, 5); } catch {}
    }

    // Filter terakhir — pastikan tidak ada yang lolos dari luar Indonesia
    features = features.filter(f => {
      const [fLng, fLat] = f.geometry.coordinates;
      return _inBbox(fLat, fLng, BBOX_INDONESIA);
    });

    if (features.length) {
      const best = features[0];
      [lng, lat] = best.geometry.coordinates;
      displayNameResult = best.properties._fullName || _photonDisplayName(best.properties);
      found = true;
    }

    if (inputEl) inputEl.style.opacity = "1";

    if (!found) {
      showToast("❌ Lokasi tidak ditemukan di Indonesia. Coba tambahkan nama kota/kabupaten (contoh: 'Reefmaster Klungkung Bali').", "error", 6000);
      return;
    }

    await areaSelectSuggest(lat, lng, displayNameResult);
    showToast("✅ Lokasi ditemukan!");

  } catch (err) {
    if (inputEl) inputEl.style.opacity = "1";
    console.error("Search error:", err);
    showToast("❌ Gagal mencari lokasi. Periksa koneksi internet.", "error");
  }
}

// Tutup suggest saat klik di luar
document.addEventListener("click", e => {
  if (!e.target.closest("#area-search-input") && !e.target.closest("#area-search-suggest")) {
    const box = document.getElementById("area-search-suggest");
    if (box) box.style.display = "none";
  }
});

async function saveArea() {
  if (userLevel > 2) { showToast("⛔ Hanya Owner/Admin yang bisa menambah area", "error"); return; }
  const name   = document.getElementById("area-name").value.trim();
  const lat    = document.getElementById("area-lat").value;
  const lng    = document.getElementById("area-lng").value;
  const radius = document.getElementById("area-radius").value;
  if (!name || !lat || !lng) return showToast("⚠️ Isi nama area dan tentukan titik di peta!", "warning");
  try {
    const r = await authFetch("/areas", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,lat,lng,radius}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Area berhasil ditambahkan!");
      document.getElementById("area-name").value = "";
      document.getElementById("area-lat").value  = "";
      document.getElementById("area-lng").value  = "";
      document.getElementById("area-coords-display").textContent = "Belum ada titik dipilih";
      // Reset marker & circle
      if (_areaMarker) { _areaMap.removeLayer(_areaMarker); _areaMarker = null; }
      if (_areaCircle) { _areaMap.removeLayer(_areaCircle); _areaCircle = null; }
      loadAreas();
      switchAreaTab("daftar");
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function toggleArea(id, active) {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  try {
    await authFetch(`/areas/${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({active}) });
    showToast(active ? "✅ Area diaktifkan" : "❌ Area dinonaktifkan");
    loadAreas();
  } catch {}
}

async function deleteArea(id) {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  uConfirm({
    icon: "📍",
    title: "Hapus Area",
    msg: "Yakin ingin menghapus area ini?<br>Tindakan tidak bisa dibatalkan.",
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await authFetch(`/areas/${id}`, {method:"DELETE"});
        if ((await r.json()).status === "OK") { showToast("🗑 Area dihapus"); loadAreas(); }
      } catch { showToast("❌ Gagal menghapus", "error"); }
    }
  });
}

// ============================================================
// HARI LIBUR & CUTI
// ============================================================

// Config semua kalender yang mungkin muncul
const _KALENDER_CONFIG = [
  { key: "nasional", label: "🔴 Nasional",  icon: "🔴", agama: null,       color: "#e74c3c", bg: "#fff0f0" },
  { key: "Islam",    label: "☪️ Islam",      icon: "☪️",  agama: "Islam",    color: "#27ae60", bg: "#e8f5e9" },
  { key: "Hindu",    label: "🕉️ Hindu",      icon: "🕉️",  agama: "Hindu",    color: "#8e44ad", bg: "#f5eef8" },
  { key: "Kristen",  label: "✝️ Kristen",    icon: "✝️",  agama: "Kristen",  color: "#2980b9", bg: "#eaf4fb" },
  { key: "Katolik",  label: "⛪ Katolik",    icon: "⛪",  agama: "Katolik",  color: "#1a5276", bg: "#d6eaf8" },
  { key: "Buddha",   label: "☸️ Buddha",     icon: "☸️",  agama: "Buddha",   color: "#d4ac0d", bg: "#fef9e7" },
  { key: "Konghucu", label: "🔯 Konghucu",   icon: "🔯",  agama: "Konghucu", color: "#c0392b", bg: "#fdedec" },
];

let _activeKalenderKey = "nasional";
let _allLiburData      = [];
let _agamaAnggota      = []; // agama unik dari seluruh anggota

// ================================================================
// HARI LIBUR — Tab switching (antara Hari Libur & Kebijakan Cuti)
// ================================================================
function switchLiburTab(tab) {
  // Guard: tab kebijakan-cuti & kuota-cuti hanya untuk admin/owner
  if (tab === "kebijakan-cuti" && !userMenus.includes("libur.kebijakan-cuti")) {
    showToast("⛔ Akses ditolak", "error"); return;
  }
  if (tab === "kuota-cuti" && !userMenus.includes("libur.kuota-cuti")) {
    showToast("⛔ Akses ditolak", "error"); return;
  }
  const tabs = ["hari-libur", "kebijakan-cuti", "kuota-cuti"];
  tabs.forEach(t => {
    const panel = document.getElementById("panel-" + t);
    const btn   = document.getElementById("tab-" + t);
    if (!panel || !btn) return;
    const active = t === tab;
    panel.classList.toggle("hidden", !active);
    btn.style.background = active ? "var(--primary)" : "white";
    btn.style.color      = active ? "white" : "var(--muted)";
  });
  if (tab === "kebijakan-cuti") loadKebijakanCuti();
  if (tab === "kuota-cuti") loadKuotaCuti();
}

function _formatTanggalLibur(dateStart, dateEnd) {
  const fmt = d => {
    const [y,m,dy] = d.split("-");
    const bulan = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
    return `${parseInt(dy)} ${bulan[parseInt(m)-1]} ${y}`;
  };
  if (!dateEnd || dateEnd === dateStart) return fmt(dateStart);
  return `${fmt(dateStart)} – ${fmt(dateEnd)}`;
}

// ================================================================
// LOAD LIBUR — entry point utama
// ================================================================
async function loadLibur() {
  try {
    // Ambil data libur dan daftar agama unik paralel
    const [rLibur, rAgama] = await Promise.all([authFetch("/libur"), authFetch("/libur/agama-list")]);
    _allLiburData  = await rLibur.json();
    _agamaAnggota  = await rAgama.json();

    _renderKalenderSubmenu();
    _renderKalenderContent(_activeKalenderKey);
  } catch (e) {
    showToast("❌ Gagal memuat data libur", "error");
  }
}

// ================================================================
// RENDER SUBMENU KALENDER (hanya tampil yg ada anggotanya + nasional)
// ================================================================
function _renderKalenderSubmenu() {
  const wrap = document.getElementById("kalender-submenu");
  if (!wrap) return;

  // Filter: nasional selalu tampil, agama hanya jika ada anggota
  const visible = _KALENDER_CONFIG.filter(k =>
    k.key === "nasional" || _agamaAnggota.includes(k.agama)
  );

  wrap.innerHTML = visible.map(k => {
    const isActive = k.key === _activeKalenderKey;
    return `<button onclick="switchKalender('${k.key}')" id="kalsub-${k.key}"
      style="padding:9px 16px;border:2px solid ${isActive ? k.color : '#e0e0e0'};
        border-radius:20px;background:${isActive ? k.color : 'white'};
        color:${isActive ? 'white' : 'var(--text)'};font-weight:700;font-size:13px;
        cursor:pointer;white-space:nowrap;transition:.2s;flex-shrink:0;">
      ${k.label}
    </button>`;
  }).join("");
}

// ================================================================
// SWITCH KALENDER AKTIF
// ================================================================
function switchKalender(key) {
  _activeKalenderKey = key;
  _renderKalenderSubmenu();
  _renderKalenderContent(key);
}

// ================================================================
// RENDER KONTEN KALENDER (daftar libur + tombol tambah)
// ================================================================
function _renderKalenderContent(key) {
  const wrap = document.getElementById("kalender-content-wrap");
  if (!wrap) return;

  const cfg = _KALENDER_CONFIG.find(k => k.key === key);
  if (!cfg) return;

  const isNasional = key === "nasional";

  // Filter data libur sesuai kalender aktif
  let filtered;
  if (isNasional) {
    filtered = _allLiburData.filter(x => x.type === "nasional");
  } else {
    filtered = _allLiburData.filter(x => {
      if (x.type !== "agama") return false;
      const agamaList = Array.isArray(x.agama) ? x.agama : [x.agama];
      return agamaList.includes(key);
    });
  }

  // Sort berdasarkan tanggal
  filtered.sort((a,b) => (a.dateStart||a.date||"").localeCompare(b.dateStart||b.date||""));

  const tahunNow = new Date().getFullYear();
  const filteredThisYear = filtered.filter(x => (x.dateStart||x.date||"").startsWith(String(tahunNow)));

  // Deskripsi otomatis anggota
  const anggotaDesc = isNasional
    ? "Berlaku untuk semua anggota otomatis."
    : `Berlaku otomatis untuk anggota beragama <b>${key}</b>.`;

  wrap.innerHTML = `
    <div class="card" style="margin-top:0;padding:0;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:14px 16px;border-bottom:1px solid #f0f2f5;gap:8px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:15px;color:var(--text);">
            ${cfg.icon} Kalender Libur ${isNasional ? "Nasional" : key}
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${anggotaDesc}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${userLevel <= 2 ? `
          <button onclick="openImportModal('${key}')"
            style="padding:9px 14px;background:white;color:${cfg.color};border:2px solid ${cfg.color};
              border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;">
            📥 Import
          </button>
          <button onclick="openLiburModal('${key}')"
            style="padding:9px 16px;background:${cfg.color};color:white;border:none;
              border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
            ➕ Tambah Hari Libur
          </button>` : ''}
        </div>
      </div>
      <div id="kal-list-${key}">
        ${_renderLiburItems(filtered)}
      </div>
    </div>`;
}

function _renderLiburItems(list) {
  if (!list.length) return '<p style="color:var(--muted);text-align:center;padding:24px;">Belum ada data libur</p>';
  return list.map(x => {
    const isNasional = x.type === "nasional";
    const tglText    = _formatTanggalLibur(x.dateStart || x.date, x.dateEnd);
    const anggotaCount = x.anggota ? x.anggota.length : null;
    return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;
      padding:13px 16px;border-bottom:1px solid #f8f8f8;gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:2px;">${x.name}</div>
        <div style="font-size:12px;color:var(--muted);">📆 ${tglText}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">
          👥 ${isNasional ? "Semua anggota" : (anggotaCount !== null ? anggotaCount + " anggota" : "—")}
        </div>
      </div>
      ${userLevel <= 2 ? `<button onclick="deleteLibur('${x.id}')"
        style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer;padding:2px 6px;flex-shrink:0;">🗑</button>` : ''}
    </div>`;
  }).join("");
}

// ================================================================
// MODAL TAMBAH HARI LIBUR
// ================================================================
function openLiburModal(kalenderKey) {
  const cfg = _KALENDER_CONFIG.find(k => k.key === kalenderKey) || {};
  const isNasional = kalenderKey === "nasional";

  document.getElementById("libur-modal-title").textContent =
    `➕ Tambah Libur ${isNasional ? "Nasional" : cfg.label || kalenderKey}`;
  document.getElementById("libur-modal-sub").innerHTML =
    isNasional
      ? "Akan berlaku untuk <b>semua anggota</b> otomatis."
      : `Akan berlaku untuk anggota beragama <b>${kalenderKey}</b> otomatis.`;
  document.getElementById("libur-modal-type").value  = isNasional ? "nasional" : "agama";
  document.getElementById("libur-modal-agama").value = isNasional ? "" : kalenderKey;
  document.getElementById("libur-modal-name").value  = "";
  document.getElementById("libur-modal-date-start").value = "";
  document.getElementById("libur-modal-date-end").value   = "";

  const overlay = document.getElementById("libur-modal-overlay");
  overlay.style.display = "flex";
  setTimeout(() => document.getElementById("libur-modal-name").focus(), 100);
}

function closeLiburModal() {
  document.getElementById("libur-modal-overlay").style.display = "none";
}

async function saveLiburFromModal() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  const name      = document.getElementById("libur-modal-name").value.trim();
  const dateStart = document.getElementById("libur-modal-date-start").value;
  const dateEnd   = document.getElementById("libur-modal-date-end").value;
  const type      = document.getElementById("libur-modal-type").value;
  const agamaVal  = document.getElementById("libur-modal-agama").value;

  if (!name)      return showToast("⚠️ Isi nama hari libur!", "warning");
  if (!dateStart) return showToast("⚠️ Isi tanggal mulai!", "warning");

  const agama = agamaVal ? [agamaVal] : [];

  try {
    const payload = { name, dateStart, dateEnd: dateEnd || dateStart, type, agama, date: dateStart };
    const r = await authFetch("/libur", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Hari libur berhasil ditambahkan!");
      closeLiburModal();
      await loadLibur();
      // Pastikan tetap di kalender yang sama
      _renderKalenderContent(_activeKalenderKey);
    } else {
      showToast("❌ Gagal menyimpan", "error");
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function deleteLibur(id) {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  uConfirm({
    icon: "📅",
    title: "Hapus Data Libur",
    msg: "Yakin ingin menghapus hari libur ini?",
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await authFetch(`/libur/${id}`, {method:"DELETE"});
        if ((await r.json()).status === "OK") {
          showToast("🗑 Berhasil dihapus");
          await loadLibur();
          _renderKalenderContent(_activeKalenderKey);
        }
      } catch {}
    }
  });
}

// Legacy compat — tidak dipakai lagi tapi jaga-jaga dipanggil dari tempat lain
function toggleAgamaField() {}
function saveLibur() { openLiburModal(_activeKalenderKey); }

// ================================================================
// IMPORT CSV / XLSX — Hari Libur
// ================================================================

let _importParsedRows = []; // hasil parse file, disimpan sementara

function openImportModal(kalenderKey) {
  const cfg = _KALENDER_CONFIG.find(k => k.key === kalenderKey) || {};
  const isNasional = kalenderKey === "nasional";

  document.getElementById("import-modal-title").textContent =
    `📥 Import Libur ${isNasional ? "Nasional" : cfg.label || kalenderKey}`;
  document.getElementById("import-modal-sub").innerHTML =
    isNasional
      ? "Akan berlaku untuk <b>semua anggota</b> otomatis."
      : `Akan berlaku untuk anggota beragama <b>${kalenderKey}</b> otomatis.`;
  document.getElementById("import-modal-type").value  = isNasional ? "nasional" : "agama";
  document.getElementById("import-modal-agama").value = isNasional ? "" : kalenderKey;

  // Reset state
  _importParsedRows = [];
  document.getElementById("import-file-input").value = "";
  document.getElementById("import-preview-wrap").style.display  = "none";
  document.getElementById("import-errors-wrap").style.display   = "none";
  document.getElementById("import-progress-wrap").style.display = "none";
  _setImportDropzoneDefault();
  _setImportBtnState(false);

  document.getElementById("libur-import-overlay").style.display = "flex";
}

function closeImportModal() {
  document.getElementById("libur-import-overlay").style.display = "none";
}

function _setImportBtnState(enabled) {
  const btn = document.getElementById("btn-do-import");
  btn.disabled = !enabled;
  btn.style.background = enabled ? "var(--success)" : "#ccc";
  btn.style.cursor     = enabled ? "pointer" : "not-allowed";
}

function _setImportDropzoneDefault() {
  const dz = document.getElementById("import-dropzone");
  dz.style.borderColor = "#ddd";
  dz.style.background  = "#fafafa";
  dz.innerHTML = `
    <div style="font-size:36px;margin-bottom:8px;">📂</div>
    <div style="font-weight:700;font-size:14px;color:var(--text);">Klik atau seret file ke sini</div>
    <div style="font-size:12px;color:var(--muted);margin-top:4px;">Format: <b>.csv</b> atau <b>.xlsx</b></div>`;
}

function handleImportDrop(event) {
  event.preventDefault();
  const dz = document.getElementById("import-dropzone");
  dz.style.borderColor = "#ddd";
  dz.style.background  = "#fafafa";
  const file = event.dataTransfer.files[0];
  if (file) _processImportFile(file);
}

function handleImportFileSelect(input) {
  const file = input.files[0];
  if (file) _processImportFile(file);
}

async function _processImportFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv","xlsx","xls"].includes(ext)) {
    showToast("⚠️ Format tidak didukung. Gunakan .csv atau .xlsx", "warning");
    return;
  }

  // Update dropzone UI
  const dz = document.getElementById("import-dropzone");
  dz.innerHTML = `<div style="font-size:28px;margin-bottom:6px;">⏳</div>
    <div style="font-weight:700;font-size:13px;color:var(--text);">Memproses ${file.name}...</div>`;

  try {
    let rows = [];
    if (ext === "csv") {
      rows = await _parseCSV(file);
    } else {
      rows = await _parseXLSX(file);
    }

    _importParsedRows = rows;
    _renderImportPreview(rows, file.name);
  } catch (e) {
    dz.innerHTML = `<div style="font-size:28px;margin-bottom:6px;">❌</div>
      <div style="font-weight:700;font-size:13px;color:var(--danger);">Gagal membaca file</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px;">${e.message}</div>`;
    showToast("❌ Gagal membaca file", "error");
  }
}

// Parse CSV (pakai FileReader)
function _parseCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { reject(new Error("File kosong atau hanya header")); return; }

        const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = _splitCSVLine(lines[i]);
          if (vals.every(v => !v.trim())) continue;
          const obj = {};
          headers.forEach((h, idx) => { obj[h] = (vals[idx] || "").trim().replace(/^"|"$/g, ""); });
          rows.push(obj);
        }
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsText(file, "UTF-8");
  });
}

// Fungsi split CSV yang handle tanda kutip
function _splitCSVLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === "," && !inQ) { result.push(cur); cur = ""; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

// Parse XLSX — dinamis load SheetJS dari CDN jika belum tersedia
function _parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const doRead = () => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb   = XLSX.read(data, { type: "array" });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
          // Normalize keys to lowercase
          const rows = json.map(row => {
            const obj = {};
            Object.keys(row).forEach(k => { obj[k.toLowerCase().replace(/ /g,"_")] = row[k]; });
            return obj;
          });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error("Gagal membaca XLSX"));
      reader.readAsArrayBuffer(file);
    };

    if (typeof XLSX !== "undefined") { doRead(); return; }
    // Lazy-load SheetJS
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload  = doRead;
    s.onerror = () => reject(new Error("Gagal memuat library XLSX"));
    document.head.appendChild(s);
  });
}

// Validasi dan render preview
function _renderImportPreview(rows, fileName) {
  const validRows  = [];
  const errorLines = [];

  rows.forEach((row, i) => {
    const name      = (row.name || row.nama || row["nama libur"] || row["nama_libur"] || "").toString().trim();
    const dateStart = _normalizeDate(row.datestart || row.date_start || row.tanggal_mulai || row.tanggal || row.date || "");
    const dateEnd   = _normalizeDate(row.dateend   || row.date_end   || row.tanggal_akhir || "");

    let status = "✅ OK";
    let ok = true;

    if (!name) { status = "❌ Nama kosong"; ok = false; }
    else if (!dateStart) { status = "❌ Tanggal kosong/salah"; ok = false; }
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) { status = "❌ Format tgl salah"; ok = false; }

    if (!ok) errorLines.push(`Baris ${i+2}: ${status}`);
    else validRows.push({ name, dateStart, dateEnd: dateEnd || dateStart });

    // Tambah ke preview (max 100 baris)
    if (i < 100) {
      const tr = document.createElement("tr");
      tr.style.background = ok ? "white" : "#fff3f3";
      tr.innerHTML = `
        <td style="padding:7px 10px;border-bottom:1px solid #f0f2f5;color:var(--text);">${name || "<i style='color:#ccc'>—</i>"}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f0f2f5;color:var(--muted);font-size:11px;">${dateStart || "—"}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f0f2f5;color:var(--muted);font-size:11px;">${dateEnd || "—"}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f0f2f5;font-size:11px;">${status}</td>`;
      document.getElementById("import-preview-body").appendChild(tr);
    }
  });

  // Simpan hanya rows valid
  _importParsedRows = validRows;

  // Update dropzone
  const dz = document.getElementById("import-dropzone");
  dz.innerHTML = `<div style="font-size:28px;margin-bottom:6px;">${validRows.length > 0 ? "✅" : "⚠️"}</div>
    <div style="font-weight:700;font-size:13px;color:var(--text);">${fileName}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:3px;">${rows.length} baris dibaca · <b style="color:var(--success);">${validRows.length} valid</b>${errorLines.length ? ` · <b style="color:var(--danger);">${errorLines.length} error</b>` : ""}</div>`;

  // Preview
  document.getElementById("import-preview-wrap").style.display = "block";
  document.getElementById("import-row-count").textContent =
    `${rows.length} baris (${validRows.length} siap diimport)`;

  // Errors
  if (errorLines.length) {
    document.getElementById("import-errors-wrap").style.display = "block";
    document.getElementById("import-errors-list").innerHTML = errorLines.join("<br>");
  } else {
    document.getElementById("import-errors-wrap").style.display = "none";
  }

  _setImportBtnState(validRows.length > 0);
}

// Normalisasi berbagai format tanggal ke YYYY-MM-DD
function _normalizeDate(val) {
  if (!val) return "";
  const s = val.toString().trim();
  // Sudah YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY atau DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2,"0")}-${m1[1].padStart(2,"0")}`;
  // YYYY/MM/DD
  const m2 = s.match(/^(\d{4})[\/](\d{1,2})[\/](\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2,"0")}-${m2[3].padStart(2,"0")}`;
  // Excel serial number
  if (/^\d+$/.test(s)) {
    const d = new Date(Math.round((parseInt(s) - 25569) * 86400 * 1000));
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  return "";
}

async function doImport() {
  if (!_importParsedRows.length) return;

  const type  = document.getElementById("import-modal-type").value;
  const agama = document.getElementById("import-modal-agama").value;

  // Show progress
  document.getElementById("import-progress-wrap").style.display = "block";
  document.getElementById("import-progress-label").textContent = "Mengimpor...";
  document.getElementById("import-progress-bar").style.width   = "30%";
  _setImportBtnState(false);

  try {
    const r = await authFetch("/libur/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: _importParsedRows, type, agama: agama || null })
    });
    const result = await r.json();

    document.getElementById("import-progress-bar").style.width = "100%";

    if (result.status === "OK") {
      document.getElementById("import-progress-label").textContent =
        `✅ Berhasil mengimpor ${result.imported} hari libur!`;

      showToast(`✅ ${result.imported} hari libur berhasil diimport!`);

      if (result.errors && result.errors.length) {
        showToast(`⚠️ ${result.errors.length} baris gagal`, "warning");
      }

      setTimeout(async () => {
        closeImportModal();
        await loadLibur();
        _renderKalenderContent(_activeKalenderKey);
      }, 1000);
    } else {
      document.getElementById("import-progress-label").textContent = "❌ Import gagal";
      showToast("❌ Import gagal: " + (result.msg || ""), "error");
      _setImportBtnState(true);
    }
  } catch (e) {
    document.getElementById("import-progress-label").textContent = "❌ Koneksi error";
    showToast("❌ Gagal terhubung ke server", "error");
    _setImportBtnState(true);
  }
}

function downloadImportTemplate() {
  const csv = `name,dateStart,dateEnd\nHari Raya Idul Fitri,2025-03-31,2025-04-01\nHari Raya Idul Adha,2025-06-07,\nTahun Baru Islam,2025-06-27,`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "template_import_libur.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ================================================================
// KEBIJAKAN CUTI
// ================================================================
// ============================================================
// KEBIJAKAN CUTI — Modal & CRUD
// ============================================================

// Aturan jam kerja per hari (untuk konversi cuti harian → jam)
const JAM_KERJA_PER_HARI = {
  1: 7, // Senin
  2: 7, // Selasa
  3: 7, // Rabu
  4: 7, // Kamis
  5: 7, // Jumat
  6: 5, // Sabtu
  0: 0, // Minggu (tidak kerja)
};
const JAM_KERJA_SEMINGGU = 40;

function openKebijakanCutiModal() {
  const overlay = document.getElementById("kebijakan-cuti-modal-overlay");
  overlay.style.display = "flex";
  document.getElementById("modal-cuti-nama").value    = "";
  document.getElementById("modal-cuti-jenis").value   = "";
  document.getElementById("modal-cuti-satuan").value  = "";
  setTimeout(() => document.getElementById("modal-cuti-nama").focus(), 100);
  // Tutup overlay jika klik di luar modal
  overlay.onclick = e => { if (e.target === overlay) closeKebijakanCutiModal(); };
}

function closeKebijakanCutiModal() {
  document.getElementById("kebijakan-cuti-modal-overlay").style.display = "none";
}

async function loadKebijakanCuti() {
  try {
    const r = await authFetch("/kebijakan-cuti");
    const d = await r.json();
    const list = document.getElementById("kebijakan-cuti-list");
    if (!d.length) {
      list.innerHTML = `<div style="padding:32px 20px;text-align:center;">
        <div style="font-size:40px;margin-bottom:8px;">🌴</div>
        <div style="color:var(--muted);font-size:14px;">Belum ada kebijakan cuti</div>
        <div style="color:var(--muted);font-size:12px;margin-top:4px;">Klik "Buat Kebijakan Cuti" untuk menambahkan</div>
      </div>`;
      return;
    }
    list.innerHTML = d.map(x => {
      const jenis    = x.jenis || "kuota";
      const isKuota  = jenis === "kuota";
      const isDefault = !!x._default;
      const isLocked  = !!x._locked;

      const jenisLabel = isKuota ? "📊 Kuota" : "🔓 Non-Kuota";
      const badgeColor = isKuota
        ? "background:#e8f5e9;color:#2e7d32;"
        : "background:#e3f2fd;color:#1565c0;";

      // Badge satuan durasi (hanya untuk kebijakan custom)
      let satuanBadge = "";
      if (!isDefault && x.satuanDurasi) {
        const sc = x.satuanDurasi === "hari"
          ? "background:#f3e5f5;color:#6a1b9a;"
          : "background:#e0f7fa;color:#006064;";
        const sl = x.satuanDurasi === "hari" ? "📅 Hari" : "⏱ Jam";
        satuanBadge = `<span style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700;${sc}">${sl}</span>`;
      }

      // Label koneksi ke kuota cuti
      let kuotaBadge = "";
      if (isDefault && x.kuotaKey === "tahunan") {
        kuotaBadge = `<span style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700;
          background:#e8f5e9;color:#1b5e20;margin-left:6px;">🔗 Kuota Cuti Tahunan</span>`;
      } else if (isDefault && x.kuotaKey === "overtime") {
        kuotaBadge = `<span style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700;
          background:#fff8e1;color:#e65100;margin-left:6px;">🔗 Kuota Cuti Overtime</span>`;
      } else if (!isDefault && isKuota) {
        kuotaBadge = `<span style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700;
          background:#e8f5e9;color:#1b5e20;margin-left:6px;">🔗 Terhubung ke Kuota Cuti</span>`;
      }

      // Tombol hapus: sembunyikan jika locked atau bukan admin
      const deleteBtn = isLocked
        ? `<span title="Kebijakan default tidak dapat dihapus"
             style="font-size:18px;color:#ddd;padding:4px 6px;flex-shrink:0;">🔒</span>`
        : userLevel <= 2
          ? `<button onclick="deleteKebijakanCuti('${x.id}')"
               style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer;
                      padding:4px 6px;flex-shrink:0;border-radius:8px;"
               title="Hapus kebijakan ini">🗑</button>`
          : '';

      // Info keterangan jika default
      const keteranganEl = isDefault && x.keterangan
        ? `<div style="font-size:11px;color:var(--muted);margin-top:5px;">${x.keterangan}</div>`
        : "";

      return `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:14px 16px;border-bottom:1px solid #f5f5f5;gap:8px;
                  ${isDefault ? 'background:#fafffe;' : ''}">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
            <span style="font-weight:700;font-size:14px;color:var(--text);">${x.nama}</span>
            ${isDefault ? `<span style="font-size:10px;padding:2px 8px;border-radius:50px;font-weight:700;background:#f0f4ff;color:#3949ab;">⭐ Default</span>` : ""}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
            <span style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700;${badgeColor}">
              ${jenisLabel}
            </span>
            ${satuanBadge}
            ${kuotaBadge}
          </div>
          ${keteranganEl}
        </div>
        ${deleteBtn}
      </div>`;
    }).join("");
  } catch { showToast("❌ Gagal memuat kebijakan cuti", "error"); }
}

async function saveKebijakanCuti() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  const nama        = document.getElementById("modal-cuti-nama").value.trim();
  const jenis       = document.getElementById("modal-cuti-jenis").value;
  const satuanDurasi = document.getElementById("modal-cuti-satuan").value;

  if (!nama)         return showToast("⚠️ Isi nama cuti!", "warning");
  if (!jenis)        return showToast("⚠️ Pilih jenis cuti!", "warning");
  if (!satuanDurasi) return showToast("⚠️ Pilih satuan durasi!", "warning");

  const payload = {
    nama,
    jenis,          // "kuota" | "non-kuota"
    satuanDurasi,   // "hari" | "jam"
    berlaku: "semua",
  };

  try {
    const r = await authFetch("/kebijakan-cuti", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    if ((await r.json()).status === "OK") {
      showToast("✅ Kebijakan cuti berhasil ditambahkan!");
      closeKebijakanCutiModal();
      loadKebijakanCuti();
      // Reload kuota cuti jika jenis kuota (supaya entry baru muncul)
      if (jenis === "kuota") loadKuotaCuti();
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function deleteKebijakanCuti(id) {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  uConfirm({
    icon: "🌴",
    title: "Hapus Kebijakan Cuti",
    msg: "Yakin ingin menghapus kebijakan cuti ini?",
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await authFetch(`/kebijakan-cuti/${id}`, {method:"DELETE"});
        const res = await r.json();
        if (res.status === "OK") { showToast("🗑 Berhasil dihapus"); loadKebijakanCuti(); }
        else if (res.status === "LOCKED") showToast("🔒 " + (res.msg || "Kebijakan default tidak dapat dihapus"), "warning");
      } catch {}
    }
  });
}

// ============================================================
// OVERTIME — Perhitungan & Simpanan
// ============================================================

/**
 * Hitung overtime dari total jam kerja seminggu.
 * @param {number} totalJamSeminggu - total jam kerja anggota dalam 1 minggu (Senin-Minggu)
 * @returns {number} jam overtime (0 jika tidak ada kelebihan)
 */
function hitungOvertimeSeminggu(totalJamSeminggu) {
  return Math.max(0, totalJamSeminggu - JAM_KERJA_SEMINGGU);
}

/**
 * Konversi cuti harian ke jam kerja berdasarkan hari dalam seminggu.
 * @param {string} tanggalCuti - format "YYYY-MM-DD"
 * @returns {number} jam kerja yang dikreditkan (7 untuk Sen-Jum, 5 untuk Sabtu, 0 untuk Minggu)
 */
function konversiCutiHariKeJam(tanggalCuti) {
  const hari = new Date(tanggalCuti).getDay(); // 0=Minggu, 1=Senin, dst
  return JAM_KERJA_PER_HARI[hari] || 0;
}

// ============================================================
// AKTIVITAS
// ============================================================
async function loadAktivitas() {
  const list = document.getElementById("aktivitas-list");
  if (list) list.innerHTML = "";
}

// ─── TAB SWITCHER AKTIVITAS ─────────────────────────────────
function switchAktivitasTab(tab) {
  const isDaftar = tab === "daftar";
  const panelDaftar  = document.getElementById("panel-aktivitas-daftar");
  const panelMonitor = document.getElementById("panel-aktivitas-monitor");
  if (panelDaftar)  panelDaftar.style.display  = isDaftar ? "" : "none";
  if (panelMonitor) panelMonitor.style.display = isDaftar ? "none" : "";

  const btnDaftar  = document.getElementById("tab-btn-daftar");
  const btnMonitor = document.getElementById("tab-btn-monitor");

  if (isDaftar) {
    if (btnDaftar)  { btnDaftar.style.background  = "linear-gradient(135deg,#4f8ef7,#1a237e)"; btnDaftar.style.color  = "white"; btnDaftar.style.boxShadow  = "0 2px 8px rgba(79,142,247,.4)"; }
    if (btnMonitor) { btnMonitor.style.background = "transparent"; btnMonitor.style.color = "var(--muted)"; btnMonitor.style.boxShadow = "none"; }
  } else {
    if (btnMonitor) { btnMonitor.style.background = "linear-gradient(135deg,#4f8ef7,#1a237e)"; btnMonitor.style.color = "white"; btnMonitor.style.boxShadow = "0 2px 8px rgba(79,142,247,.4)"; }
    if (btnDaftar)  { btnDaftar.style.background  = "transparent"; btnDaftar.style.color  = "var(--muted)"; btnDaftar.style.boxShadow  = "none"; }
    loadMonitorKehadiran();
  }
}

// ─── MONITOR KEHADIRAN ───────────────────────────────────────
async function loadMonitorKehadiran() {
  const elBekerja = document.getElementById("monitor-sedang-bekerja");
  const elTidak   = document.getElementById("monitor-tidak-hadir");
  const elDivider = document.getElementById("monitor-divider");
  if (!elBekerja) return;

  elBekerja.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Memuat...</p>';
  elTidak.innerHTML   = "";
  elDivider.style.display = "none";

  try {
    const r = await authFetch("/admin/today");
    const d = await r.json();
    const records = d.records || [];

    const bekerja = records.filter(x => x.status === "IN" || x.status === "BREAK");
    const lainnya = records.filter(x => x.status === "OUT" || x.status === "DONE");

    // ── Sedang bekerja ──
    if (!bekerja.length) {
      elBekerja.innerHTML = '<p style="color:var(--muted);text-align:center;padding:16px;font-size:13px;">Belum ada yang clock in hari ini</p>';
    } else {
      const label = `<div style="font-size:11px;font-weight:700;color:#27ae60;letter-spacing:.5px;
        text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e8f5e9;">
        🟢 Sedang Bekerja (${bekerja.length})</div>`;
      elBekerja.innerHTML = label + bekerja.map(x => {
        const isBreak   = x.status === "BREAK";
        const dotColor  = isBreak ? "#f39c12" : "#27ae60";
        const statusTxt = isBreak ? "Sedang Istirahat" : "Sedang Berlangsung";
        const masukTxt  = x.jamMasuk ? " · Masuk " + new Date(x.jamMasuk).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
        return `<div style="display:flex;align-items:center;justify-content:space-between;
          padding:10px 0;border-bottom:1px solid #f5f5f5;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${dotColor};
              display:inline-block;flex-shrink:0;box-shadow:0 0 0 3px ${dotColor}33;"></span>
            <div>
              <div style="font-size:14px;font-weight:700;color:#2c3e50;">${x.user}</div>
              <div style="font-size:11px;color:${dotColor};font-weight:600;">${statusTxt}${masukTxt}</div>
            </div>
          </div>
        </div>`;
      }).join("");
    }

    // ── Belum / sudah pulang ──
    if (lainnya.length) {
      elDivider.style.display = "";
      const label = `<div style="font-size:11px;font-weight:700;color:#95a5a6;letter-spacing:.5px;
        text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #f0f2f5;">
        ⚪ Belum / Sudah Selesai (${lainnya.length})</div>`;
      elTidak.innerHTML = label + lainnya.map(x => {
        const isDone   = x.status === "DONE";
        const dotColor = isDone ? "#4f8ef7" : "#bdc3c7";
        const subTxt   = isDone
          ? "Selesai · Keluar " + new Date(x.jamKeluar).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false})
          : "Belum Absen";
        return `<div style="display:flex;align-items:center;gap:10px;
          padding:10px 0;border-bottom:1px solid #f5f5f5;">
          <span style="width:10px;height:10px;border-radius:50%;background:${dotColor};
            display:inline-block;flex-shrink:0;"></span>
          <div>
            <div style="font-size:14px;font-weight:600;color:#7f8c8d;">${x.user}</div>
            <div style="font-size:11px;color:${dotColor};">${subTxt}</div>
          </div>
        </div>`;
      }).join("");
    }

  } catch {
    elBekerja.innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px;font-size:13px;">❌ Gagal memuat data</p>';
  }
}

// ============================================================
// TIMESHEET
// ============================================================
// ================================================================
// TIMESHEET MINGGUAN
// ================================================================

let _tsWeekStart  = null;  // "YYYY-MM-DD" (Senin minggu ini)
let _tsData       = null;  // response dari /timesheet/weekly
let _tsCurrent    = null;  // {username, date} untuk modal edit

const DOW_LABEL = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
const DOW_COLOR = { 0:"#e53935", 6:"#9c27b0" }; // Minggu merah, Sabtu ungu

// ─── TIMESHEET REALTIME TICKER ───────────────────────────────
let _tsTicker = null;

function startTsTicker() {
  stopTsTicker();
  const me = localStorage.getItem("user") || "";

  function getJamForCell(cell) {
    const cellUser = cell.getAttribute("data-username") || "";
    if (cellUser === me) {
      // Self — baca dari t-dur beranda, selalu akurat
      const tDur = document.getElementById("t-dur");
      if (tDur && tDur.innerText && tDur.innerText !== "00:00:00" && !tDur.innerText.includes("N")) {
        const parts = tDur.innerText.split(":");
        if (parts.length >= 2) {
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const s = parseInt(parts[2], 10) || 0;
          if (!isNaN(h) && !isNaN(m)) return h + m / 60 + s / 3600;
        }
      }
      // Fallback ke _todayRec jika t-dur belum terisi atau NaN
      if (typeof _todayRec !== "undefined" && _todayRec && _todayRec.jamMasuk && !_todayRec.jamKeluar) {
        const now = Date.now();
        const masuk = parseLocalISO(_todayRec.jamMasuk);
        if (isNaN(masuk)) return 0;
        let breakSec = 0;
        (_todayRec.breaks || []).forEach(b => {
          const bStart = parseLocalISO(b.start);
          const end = b.end ? parseLocalISO(b.end) : now;
          if (!isNaN(bStart)) breakSec += Math.max(0, end - bStart) / 1000;
        });
        return Math.max(0, (now - masuk) / 1000 - breakSec) / 3600;
      }
    } else {
      // User lain — hitung dari snapshot server (multi-sesi)
      const jamMasuk       = cell.getAttribute("data-jammasuk");
      const breakDetik     = parseFloat(cell.getAttribute("data-breakdetik") || "0");
      const jamSesiSelesai = parseFloat(cell.getAttribute("data-sesi-selesai") || "0");
      if (!jamMasuk) return isNaN(jamSesiSelesai) ? 0 : jamSesiSelesai;
      const masukMs = parseLocalISO(jamMasuk);
      if (isNaN(masukMs)) return isNaN(jamSesiSelesai) ? 0 : jamSesiSelesai;
      const sesiAktif = Math.max(0, (Date.now() - masukMs) / 1000 - (isNaN(breakDetik) ? 0 : breakDetik)) / 3600;
      return (isNaN(jamSesiSelesai) ? 0 : jamSesiSelesai) + sesiAktif;
    }
    return 0;
  }

  function tickCells() {
    document.querySelectorAll(".ts-active-cell").forEach(cell => {
      const activeJam = getJamForCell(cell);
      if (isNaN(activeJam)) return;
      const h = Math.floor(activeJam);
      const m = Math.floor((activeJam - h) * 60);
      cell.textContent = `${h}:${String(m).padStart(2, "0")}`;
    });

    // Update kolom total per baris masing-masing
    document.querySelectorAll(".ts-total-cell").forEach(td => {
      const nonActive = parseFloat(td.getAttribute("data-nonactive") || "0");
      const row = td.closest("tr");
      const activeCell = row ? row.querySelector(".ts-active-cell") : null;
      const activeJam = activeCell ? getJamForCell(activeCell) : 0;
      const safeActive = isNaN(activeJam) ? 0 : activeJam;
      const safeNon    = isNaN(nonActive) ? 0 : nonActive;
      const total  = safeNon + safeActive;
      const kurang = Math.max(0, 40 - total);
      const lebih  = Math.max(0, total - 40);
      const color  = kurang > 0 ? "#e53935" : lebih > 0 ? "#f57f17" : "#2e7d32";
      td.style.color = color;
      td.innerHTML =
        `<div>${fmtJam(total)}</div>` +
        (kurang > 0 ? `<div style="font-size:9px;color:#e53935;font-weight:600;">-${fmtJam(kurang)}</div>` : "") +
        (lebih  > 0 ? `<div style="font-size:9px;color:#f57f17;font-weight:600;">+${fmtJam(lebih)}</div>`  : "");
    });
  }
  tickCells();
  _tsTicker = setInterval(tickCells, 1000);
}

function stopTsTicker() {
  if (_tsTicker) { clearInterval(_tsTicker); _tsTicker = null; }
}
// ─────────────────────────────────────────────────────────────

function tsGetMonday(d = new Date()) {
  // Pakai T12:00:00 agar tidak geser saat konversi timezone
  const localStr = d.toLocaleDateString("sv-SE"); // YYYY-MM-DD lokal
  const local = new Date(localStr + "T12:00:00"); // tengah hari, aman dari shift
  const day = local.getDay(); // 0=Minggu, 1=Senin, ...
  const diff = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + diff);
  return local.toLocaleDateString("sv-SE"); // kembalikan format lokal, bukan UTC
}

function tsNavWeek(delta) {
  const d = new Date(_tsWeekStart + "T12:00:00");
  d.setDate(d.getDate() + delta * 7);
  _tsWeekStart = d.toLocaleDateString("sv-SE");
  loadTimesheet();
}

function tsGoToday() {
  _tsWeekStart = tsGetMonday();
  loadTimesheet();
}

function fmtJam(jam) {
  if (!jam || jam <= 0) return "-";
  const h = Math.floor(jam);
  const m = Math.round((jam - h) * 60);
  return m > 0 ? `${h}j ${m}m` : `${h}j`;
}

// Format jam desimal → "Xj Ym" untuk overtime/TL (0 tetap tampil sebagai "0j")
function fmtJamOT(jam) {
  if (!jam || jam <= 0) return "0j";
  const h = Math.floor(jam);
  const m = Math.round((jam - h) * 60);
  return m > 0 ? `${h}j ${m}m` : `${h}j`;
}

// Format jam realtime HH:MM — tanpa detik, untuk sel aktif timesheet
function fmtJamRealtime(jam) {
  if (!jam || jam < 0) return "0:00";
  const totalMin = Math.floor(jam * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtTime(isoStr) {
  if (!isoStr) return "--:--";
  // HH:MM plain → langsung kembalikan
  if (/^\d{2}:\d{2}$/.test(isoStr)) return isoStr;
  // ISO string → parse lalu format ke waktu lokal (handle UTC offset otomatis)
  if (isoStr.includes("T")) {
    const d = new Date(isoStr);
    if (isNaN(d)) return "--:--";
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return isoStr.slice(0, 5);
}

// ── Custom time input: text biasa format HH:MM, bebas AM/PM ──────────────────────
// Dipakai di semua form agar tidak bergantung format browser/OS
function timeInputHtml({ id, value = "", onchange = "", extraStyle = "", placeholder = "HH:MM" }) {
  const oc = onchange ? `data-onchange="${onchange}"` : "";
  return `<input
    id="${id}"
    type="text"
    inputmode="numeric"
    maxlength="5"
    placeholder="${placeholder}"
    value="${value}"
    autocomplete="off"
    ${oc}
    oninput="autoFormatTimeInput(this)"
    onblur="validateTimeInput(this)"
    style="font-variant-numeric:tabular-nums;${extraStyle}">`;
}

// Auto-format: ketik 4 digit → otomatis jadi HH:MM
function autoFormatTimeInput(el) {
  let v = el.value.replace(/[^0-9]/g, "").slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + ":" + v.slice(2);
  el.value = v;
  // Panggil onchange callback jika ada
  const cb = el.getAttribute("data-onchange");
  if (cb) { try { eval(cb + "(el)"); } catch(e) {} }
  // Dispatch change event agar onchange= attribute juga terpanggil
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// Validasi saat blur: pastikan HH:MM valid 24 jam
function validateTimeInput(el) {
  const v = el.value.trim();
  if (!v) return;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) { el.style.color = "#e53935"; el.title = "Format salah, gunakan HH:MM (contoh: 08:30)"; return; }
  const h = parseInt(m[1]), mn = parseInt(m[2]);
  if (h > 23 || mn > 59) { el.style.color = "#e53935"; el.title = "Jam tidak valid"; return; }
  // Normalize: pastikan dua digit
  el.value = String(h).padStart(2,"0") + ":" + String(mn).padStart(2,"0");
  el.style.color = "";
  el.title = "";
}

async function loadTimesheet() {
  const me = localStorage.getItem("user");
  // Selalu validasi: pastikan _tsWeekStart adalah hari Senin yang valid
  if (!_tsWeekStart) {
    _tsWeekStart = tsGetMonday();
  } else {
    // Cek apakah nilai yang tersimpan benar-benar hari Senin
    const d = new Date(_tsWeekStart + "T12:00:00");
    if (d.getDay() !== 1) _tsWeekStart = tsGetMonday(); // bukan Senin → reset
  }

  // Update label minggu
  const mon = new Date(_tsWeekStart + "T12:00:00");
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => `${d.getDate()} ${["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"][d.getMonth()]} ${d.getFullYear()}`;
  const lbl = document.getElementById("ts-week-label");
  if (lbl) lbl.textContent = `${fmt(mon)} – ${fmt(sun)}`;

  const el = document.getElementById("ts-content");
  if (el) el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Memuat...</p>`;

  try {
    const r = await authFetch(`/timesheet/weekly?weekStart=${_tsWeekStart}`);
    _tsData = await r.json();
    tsRender();
  } catch(e) {
    if (el) el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:24px;">❌ Gagal memuat</p>`;
  }
}

function tsRender() {
  const el = document.getElementById("ts-content");
  if (!el || !_tsData) return;

  const q = (document.getElementById("ts-search")?.value || "").toLowerCase();
  const filtered = (_tsData.users || []).filter(u =>
    (u.nama || u.username).toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
  );

  if (!filtered.length) {
    el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Tidak ada data</p>`;
    return;
  }

  const dates = _tsData.weekDates || [];
  const me    = localStorage.getItem("user");

  // Header tabel
  const headerCols = dates.map(date => {
    const d   = new Date(date + "T00:00:00");
    const dow = d.getDay();
    const isToday = date === todayLocalStr();
    const color = DOW_COLOR[dow] || "var(--text)";
    return `<th style="text-align:center;min-width:68px;padding:8px 4px;
               background:${isToday ? "#e8f5e9" : ""};border-radius:${isToday?"6px":""};
               color:${isToday?"#2e7d32":color};font-weight:${isToday?"900":"700"};">
      <div style="font-size:11px;">${DOW_LABEL[dow]}</div>
      <div style="font-size:10px;font-weight:400;opacity:.7;">${d.getDate()}/${d.getMonth()+1}</div>
    </th>`;
  }).join("");

  const rows = filtered.map(u => {
    const isSelf = u.username === me;

    // Sel data per hari
    const dayCols = u.days.map(day => {
      const hasKerja = day.jamKerja > 0;
      const hasCuti  = day.jamCuti  > 0;
      const isToday  = day.date === todayLocalStr();
      const dow      = day.dow;
      const isWeekend = dow === 0; // Minggu

      let cellContent = "";
      const isHariLibur = day.isHariLibur || false;
      const namaLibur   = day.namaLibur   || "";
      const jamTL       = day.jamTL       || 0;

      if (isWeekend && !hasKerja && !hasCuti && !isHariLibur) {
        // Minggu tanpa aktivitas apapun → —
        cellContent = `<span style="color:#ddd;font-size:11px;">—</span>`;
      } else if (isHariLibur && !hasKerja && !hasCuti) {
        // Hari libur, tidak masuk → label libur otomatis (hijau)
        cellContent = `
          <div style="font-size:12px;font-weight:700;color:#1b5e20;">${fmtJam(day.jamKerja)}</div>
          <div style="font-size:9px;color:#43a047;margin-top:2px;">🏖️ ${namaLibur}</div>`;
      } else if (isHariLibur && hasKerja && jamTL > 0) {
        // Hari libur, masuk kerja → jam libur + badge TL (oranye)
        const tlH = Math.floor(jamTL), tlM = Math.round((jamTL % 1) * 60);
        const tlStr = tlM > 0 ? (tlH + "j " + tlM + "m") : (tlH + "j");
        cellContent = `
          <div style="font-size:12px;font-weight:700;color:#1b5e20;">${fmtJam(day.jamKerja)}</div>
          <div style="font-size:9px;color:#e65100;margin-top:2px;">⏱️ +${tlStr} TL</div>`;
      } else if (hasCuti && hasKerja) {
        // Kerja + cuti dalam hari sama
        cellContent = `
          <div style="font-size:12px;font-weight:700;color:var(--text);">${fmtJam(day.jamKerja)}</div>
          <div style="font-size:10px;color:#1565c0;margin-top:2px;">+${fmtJam(day.jamCuti)}</div>
          <div style="font-size:9px;color:#1976d2;background:#e3f2fd;border-radius:4px;padding:1px 4px;margin-top:2px;line-height:1.3;">${day.keteranganCuti}</div>`;
      } else if (hasCuti) {
        // Cuti murni
        cellContent = `
          <div style="font-size:11px;color:#1565c0;font-weight:700;">${fmtJam(day.jamCuti)}</div>
          <div style="font-size:9px;color:#1976d2;background:#e3f2fd;border-radius:4px;padding:1px 4px;margin-top:2px;line-height:1.3;">${day.keteranganCuti}</div>`;
      } else if (hasKerja) {
        if (day.isActive) {
          const sesiLbl = day.sesiCount > 1 ? `<div style="font-size:9px;color:#ffa726;margin-top:1px;">sesi ${day.sesiCount}</div>` : "";
          cellContent = `
            <div class="ts-active-cell"
              data-username="${u.username}"
              data-jammasuk="${day.jamMasuk || ''}"
              data-breakdetik="${day.breakDetik || 0}"
              data-sesi-selesai="${day.jamSesiSelesai || 0}"
              style="font-size:12px;font-weight:700;color:#2e7d32;font-variant-numeric:tabular-nums;">
              ${fmtJamRealtime(day.jamKerja)}
            </div>
            <div style="font-size:9px;color:#66bb6a;margin-top:1px;">▶ aktif</div>
            ${sesiLbl}`;
        } else {
          const sesiInfo = day.sesiCount > 1
            ? `<div style="font-size:9px;color:#ffa726;margin-top:1px;">${day.sesiCount} sesi</div>` : "";
          cellContent = `<div style="font-size:12px;font-weight:700;color:var(--text);">${fmtJam(day.jamKerja)}</div>${sesiInfo}`;
        }
      } else {
        cellContent = `<span style="color:#ddd;font-size:12px;">—</span>`;
      }

      // Tombol edit: muncul di semua hari kerja (termasuk sel kosong) agar bisa tambah absen manual
      // Minggu: hanya jika sudah ada data. Hari libur: tetap bisa edit jika sudah ada absen.
      const canEditCell = u.canEdit && (!isWeekend || hasKerja) && (!isHariLibur || hasKerja);
      const editBtn = canEditCell ? `
        <div class="ts-edit-btn"
          data-empty="${!hasKerja ? '1' : '0'}"
          onclick="event.stopPropagation();openTsModal('${u.username}','${day.date}')"
          style="margin-top:3px;font-size:9px;color:var(--primary);cursor:pointer;font-weight:700;
                 opacity:0;pointer-events:none;transition:opacity .15s;">✏️</div>` : "";

      const sundayBg     = isWeekend   && hasKerja  ? "#fff8e1" : "";
      const liburBg      = isHariLibur && !hasKerja ? "#f1f8e9" : "";
      const liburKerjaBg = isHariLibur && hasKerja  ? "#fff3e0" : "";
      const bgColor = isToday ? "#f1f8e9"
                    : liburKerjaBg || liburBg || sundayBg
                    || (hasCuti && !hasKerja ? "#fafeff" : "");
      return `<td style="text-align:center;padding:7px 4px;border-bottom:1px solid #f5f5f5;
                 background:${bgColor};
                 vertical-align:middle;">
        ${cellContent}${editBtn}
      </td>`;
    }).join("");

    // Total kolom
    const totalEfektif = u.totalEfektif;
    const kurang = Math.max(0, 40 - totalEfektif);
    const totalColor = kurang > 0 ? "#e53935" : totalEfektif > 40 ? "#f57f17" : "#2e7d32";

    // Avatar
    const avatarHtml = u.photo
      ? `<img src="${u.photo}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
      : `<div style="width:30px;height:30px;border-radius:50%;background:${(_GROUP_LABEL[(u.group||"").toLowerCase()]||{color:"#546e7a"}).color};
              display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:12px;flex-shrink:0;">
          ${(u.nama||u.username).charAt(0).toUpperCase()}</div>`;

    return `
    <tr class="ts-row" data-canedit="${u.canEdit ? '1' : '0'}" style="border-bottom:1px solid #f0f2f5;">
      <!-- Kolom nama (sticky) — klik buka drawer detail -->
      <td style="padding:8px 12px;min-width:160px;max-width:200px;position:sticky;left:0;background:white;z-index:1;cursor:pointer;"
          onclick="_tsDrawerOpenByUsername('${u.username}', '${u.days.find(d=>d.date===todayLocalStr())?.date || u.days[0]?.date || ""}')">
        <div style="display:flex;align-items:center;gap:8px;">
          ${avatarHtml}
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.nama||u.username}</div>
            <div style="font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${_jabatanInfo(u.group,u.jabatan).color};font-weight:600;">${_jabatanInfo(u.group,u.jabatan).label}</div>
          </div>
        </div>
      </td>
      ${dayCols}
      <!-- Total -->
      <td class="ts-total-cell" data-nonactive="${u.totalEfektif - (u.days.find(d=>d.isActive)?.jamKerja||0)}"
          style="text-align:center;padding:8px 10px;font-weight:900;font-size:13px;color:${totalColor};
                 border-left:2px solid #f0f2f5;min-width:70px;">
        <div>${fmtJam(totalEfektif)}</div>
        ${kurang > 0 ? `<div style="font-size:9px;color:#e53935;font-weight:600;">-${fmtJam(kurang)}</div>` : ""}
        ${totalEfektif > 40 ? `<div style="font-size:9px;color:#f57f17;font-weight:600;">+${fmtJam(totalEfektif-40)}</div>` : ""}
      </td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <div style="overflow-x:auto;border-radius:12px;border:1px solid #e8ecf0;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:600px;">
        <thead>
          <tr style="border-bottom:2px solid #e8ecf0;">
            <th style="text-align:left;padding:10px 12px;font-size:11px;color:var(--muted);
                       text-transform:uppercase;letter-spacing:.4px;position:sticky;left:0;background:#f8f9ff;min-width:160px;">
              Anggota
            </th>
            ${headerCols}
            <th style="text-align:center;padding:10px;font-size:11px;color:var(--muted);
                       text-transform:uppercase;letter-spacing:.4px;border-left:2px solid #e8ecf0;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
`;  // (legend dihapus per permintaan revisi)

  // Start realtime ticker untuk sel aktif hari ini
  setTimeout(startTsTicker, 300);

  // Hover listener: tampilkan/sembunyikan ikon pensil hanya untuk baris canEdit
  const isMobileTsView = window.innerWidth <= 600;

  el.querySelectorAll("tr.ts-row[data-canedit='1']").forEach(row => {
    if (!isMobileTsView) {
      // ── DESKTOP: hover mouse ──
      row.addEventListener("mouseenter", () => {
        row.querySelectorAll(".ts-edit-btn").forEach(btn => {
          btn.style.opacity       = "1";
          btn.style.pointerEvents = "auto";
        });
      });
      row.addEventListener("mouseleave", () => {
        row.querySelectorAll(".ts-edit-btn").forEach(btn => {
          btn.style.opacity       = "0";
          btn.style.pointerEvents = "none";
        });
      });
    } else {
      // ── MOBILE: tap baris untuk tampilkan pensil, satu baris aktif saja ──
      row.addEventListener("touchstart", (e) => {
        if (e.target.closest(".ts-edit-btn")) return;

        const isActive = row.getAttribute("data-ts-active") === "1";

        // Sembunyikan semua baris dulu
        el.querySelectorAll("tr.ts-row[data-canedit='1']").forEach(r => {
          r.setAttribute("data-ts-active", "0");
          r.querySelectorAll(".ts-edit-btn").forEach(btn => {
            btn.style.opacity       = "0";
            btn.style.pointerEvents = "none";
          });
        });

        // Jika baris ini belum aktif → tampilkan pensilnya
        if (!isActive) {
          row.setAttribute("data-ts-active", "1");
          row.querySelectorAll(".ts-edit-btn").forEach(btn => {
            btn.style.opacity       = "1";
            btn.style.pointerEvents = "auto";
          });
        }
      }, { passive: true });
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// DRAWER DETAIL TIMESHEET — menggantikan modal lama sepenuhnya
// ═══════════════════════════════════════════════════════════════

let _drUser      = null;   // { username, nama, jabatan, photo, group, days, canEdit }
let _drDate      = null;   // tanggal aktif di drawer "YYYY-MM-DD"
let _drSesiList  = [];     // sesi yang ter-fetch untuk _drDate
let _drAreas     = [];     // cache areas

// Untuk kompatibilitas: openTsModal lama dipanggil dari tsRender via onclick
// Sekarang dialihkan ke drawer
function openTsModal(username, date) {
  _tsDrawerOpenByUsername(username, date);
}

// ── Buka drawer ──────────────────────────────────────────────
async function openTsDrawer(userObj, date) {
  _drUser = userObj;
  _drDate = date || userObj.days[0]?.date || todayLocalStr();

  // Isi header
  const avatarEl = document.getElementById("ts-dr-avatar");
  avatarEl.innerHTML = userObj.photo
    ? `<img src="${userObj.photo}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">`
    : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#1a237e,#4f8ef7);
          display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:18px;">
        ${(userObj.nama||userObj.username).charAt(0).toUpperCase()}</div>`;
  document.getElementById("ts-dr-nama").textContent    = userObj.nama || userObj.username;
  document.getElementById("ts-dr-jabatan").textContent = userObj.jabatan || "—";
  document.getElementById("ts-dr-grup").textContent    = userObj.group || "—";

  // Render strip hari
  _tsDrawerRenderDays();

  // Preload areas
  try {
    const r = await authFetch("/areas");
    if (r.ok) _drAreas = (await r.json()).filter(a => a.active !== false);
  } catch { _drAreas = []; }

  // Load sesi hari aktif
  await _tsDrawerLoadDay(_drDate);

  // Tampilkan drawer dengan animasi
  const overlay = document.getElementById("ts-drawer-overlay");
  const drawer  = document.getElementById("ts-drawer");
  overlay.style.display  = "block";
  overlay.style.opacity  = "0";
  drawer.style.transform = "translateX(100%)";
  requestAnimationFrame(() => {
    overlay.style.opacity  = "1";
    drawer.style.transform = "translateX(0)";
  });
  overlay.onclick = e => { if (e.target === overlay) closeTsDrawer(); };

  // Tampilkan footer hanya jika user bisa diedit
  document.getElementById("ts-dr-footer").style.display = userObj.canEdit ? "block" : "none";
}

function closeTsDrawer() {
  const overlay = document.getElementById("ts-drawer-overlay");
  const drawer  = document.getElementById("ts-drawer");
  drawer.style.transform = "translateX(100%)";
  overlay.style.opacity  = "0";
  setTimeout(() => { overlay.style.display = "none"; }, 300);
  _drUser = null; _drDate = null; _drSesiList = [];
}

// ── Render strip 7 hari minggu ────────────────────────────────
function _tsDrawerRenderDays() {
  const el = document.getElementById("ts-dr-days");
  if (!el || !_drUser) return;
  const DOW  = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
  el.innerHTML = (_drUser.days || []).map(day => {
    const d      = new Date(day.date + "T12:00:00");
    const dowLbl = DOW[d.getDay()];
    const tgl    = d.getDate();
    const isAct  = day.date === _drDate;
    const hasK   = day.jamKerja > 0;
    const jamStr = hasK ? fmtJam(day.jamKerja) : "—";
    return `
      <div onclick="_tsDrawerSelectDay('${day.date}')"
        style="flex:0 0 auto;padding:10px 10px 8px;cursor:pointer;text-align:center;min-width:56px;
               border-bottom:2.5px solid ${isAct ? "#f57c00" : "transparent"};
               transition:border-color .15s;">
        <div style="font-size:10px;font-weight:600;color:${isAct?"#f57c00":"var(--muted)"};">${dowLbl}</div>
        <div style="font-size:16px;font-weight:${isAct?"900":"700"};color:${isAct?"#f57c00":"var(--text)"};">${tgl}</div>
        <div style="font-size:10px;color:${hasK?"#43a047":"#ccc"};margin-top:2px;">${jamStr}</div>
      </div>`;
  }).join("");
}

async function _tsDrawerSelectDay(date) {
  _drDate = date;
  _tsDrawerRenderDays();
  await _tsDrawerLoadDay(date);
}

// ── Fetch & render sesi untuk satu hari ──────────────────────
async function _tsDrawerLoadDay(date) {
  const body = document.getElementById("ts-dr-body");
  if (!body) return;
  body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px;">Memuat...</div>`;

  try {
    const r = await authFetch(`/timesheet/absen/${_drUser.username}/${date}`);
    const d = await r.json();
    _drSesiList = (d.sesi || []);
  } catch {
    _drSesiList = [];
  }

  _tsDrawerRenderBody();
}

// ── Render daftar sesi (tampilan per-baris: Clock In, Istirahat, Clock Out) ──────────

// Inject CSS hover untuk ts-row-actions
(function() {
  const st = document.createElement("style");
  st.textContent = ".ts-dr-row:hover .ts-row-actions { opacity: 1 !important; } .ts-dr-row { transition: background .1s; } .ts-dr-row:hover { background: #fafafa; }";
  document.head.appendChild(st);
})();

function _tsDrawerRenderBody() {
  const body = document.getElementById("ts-dr-body");
  if (!body || !_drUser) return;

  const d      = new Date(_drDate + "T12:00:00");
  const DOW    = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const BLN    = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  const tglStr = `${DOW[d.getDay()]}, ${d.getDate()} ${BLN[d.getMonth()]} ${d.getFullYear()}`;

  // Hitung total jam hari ini — pakai hitungJamKerjaRec agar konsisten
  let totalMenit = 0;
  _drSesiList.forEach(s => {
    if (s.jamMasuk && s.jamKeluar) {
      const masuk  = new Date(s.jamMasuk).getTime();
      const keluar = new Date(s.jamKeluar).getTime();
      if (isNaN(masuk) || isNaN(keluar)) return;
      let diff = (keluar - masuk) / 60000;
      (s.breaks || []).forEach(b => {
        if (b.start && b.end) {
          const bs = new Date(b.start).getTime();
          const be = new Date(b.end).getTime();
          if (!isNaN(bs) && !isNaN(be)) diff -= (be - bs) / 60000;
        }
      });
      totalMenit += Math.max(0, diff);
    }
  });
  const fmtTotal = m => {
    if (m <= 0) return "—";
    const h = Math.floor(m/60), mn = Math.round(m%60);
    return mn > 0 ? `${h}h ${mn}m` : `${h}h`;
  };
  const totalStr = fmtTotal(totalMenit);

  // Avatar user untuk foto di setiap baris
  const avatarHtml = _drUser.photo
    ? `<img src="${_drUser.photo}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
    : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#1a237e,#4f8ef7);
         display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:15px;flex-shrink:0;">
         ${(_drUser.nama||_drUser.username).charAt(0).toUpperCase()}</div>`;

  let html = `
    <div style="padding:14px 16px 6px;display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:13px;font-weight:700;color:var(--text);">${tglStr}</div>
      <div style="font-size:12px;color:var(--muted);">Total: <b style="color:#f57c00;">${totalStr}</b></div>
    </div>`;

  if (_drSesiList.length === 0) {
    // Hari kosong — area bersih, tanpa ilustrasi
    html += `<div style="height:120px;"></div>`;
  } else {
    _drSesiList.forEach((s, sIdx) => {
      const isAktif = s.jamMasuk && !s.jamKeluar;
      const multiSesi = _drSesiList.length > 1;
      const sesiLabel = multiSesi ? ` · Sesi ${s.sesi || sIdx+1}` : "";

      // Baris edit/hapus helper — icon hanya muncul saat hover
      const canEdit = _drUser.canEdit;
      const rowActions = (type, breakIdx) => {
        if (!canEdit) return "";
        const editArgs  = `${sIdx},'${type}',${breakIdx ?? -1}`;
        const hapusArgs = `${sIdx},'${type}',${breakIdx ?? -1}`;
        return `
          <div class="ts-row-actions" style="display:flex;gap:4px;flex-shrink:0;opacity:0;transition:opacity .15s;">
            <button onclick="tsDrawerEditRow(${editArgs})"
              style="background:none;border:none;padding:4px 6px;cursor:pointer;font-size:16px;color:#888;border-radius:6px;"
              title="Edit">✏️</button>
            <button onclick="tsDrawerHapusRow(${hapusArgs})"
              style="background:none;border:none;padding:4px 6px;cursor:pointer;font-size:16px;color:#e53935;border-radius:6px;"
              title="Hapus">🗑</button>
          </div>`;
      };

      // ── Baris Clock In ──
      html += `
        <div class="ts-dr-row" style="display:flex;align-items:center;gap:10px;padding:8px 16px;
                    border-bottom:1px solid #f5f5f5;">
          ${avatarHtml}
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:800;color:#222;letter-spacing:.3px;">
              ${s.jamMasuk ? fmtTime(s.jamMasuk) : "--:--"}
            </div>
            <div style="display:flex;align-items:center;gap:5px;margin-top:2px;">
              <span style="font-size:10px;background:#e8f5e9;color:#2e7d32;border-radius:4px;
                           padding:1px 7px;font-weight:700;">+ Clock in</span>
              ${s.lokasiNama ? `<span style="font-size:10px;color:var(--muted);">${s.lokasiNama}${sesiLabel}</span>` : `<span style="font-size:10px;color:var(--muted);">${sesiLabel.slice(3)}</span>`}
            </div>
          </div>
          ${rowActions('masuk', null)}
        </div>`;

      // ── Baris Istirahat (setiap break) ──
      if (s.breaks && s.breaks.length > 0) {
        s.breaks.forEach((b, bIdx) => {
          const bsMulai    = b.start ? fmtTime(b.start) : "--:--";
          const bsSelesai  = b.end   ? fmtTime(b.end)   : "--:--";
          const bDurMenit  = (b.start && b.end) ? (new Date(b.end) - new Date(b.start))/60000 : 0;
          const bDurStr    = bDurMenit > 0 ? ` · ${Math.round(bDurMenit)}m` : "";

          // Baris Mulai Istirahat
          html += `
            <div class="ts-dr-row" style="display:flex;align-items:center;gap:10px;padding:8px 16px;
                        border-bottom:1px solid #f5f5f5;background:#fffde7;">
              ${avatarHtml}
              <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:800;color:#222;letter-spacing:.3px;">${bsMulai}</div>
                <div style="margin-top:2px;">
                  <span style="font-size:10px;background:#fff3e0;color:#e65100;border-radius:4px;
                               padding:1px 7px;font-weight:700;">Istirahat${bDurStr}</span>
                </div>
              </div>
              ${rowActions('break-start', bIdx)}
            </div>`;

          // Baris Lanjut Kerja (break end)
          if (b.end) {
            html += `
              <div class="ts-dr-row" style="display:flex;align-items:center;gap:10px;padding:8px 16px;
                          border-bottom:1px solid #f5f5f5;background:#f3fff3;">
                ${avatarHtml}
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:800;color:#222;letter-spacing:.3px;">${bsSelesai}</div>
                  <div style="margin-top:2px;">
                    <span style="font-size:10px;background:#e8f5e9;color:#2e7d32;border-radius:4px;
                                 padding:1px 7px;font-weight:700;">Lanjut Kerja</span>
                  </div>
                </div>
                ${rowActions('break-end', bIdx)}
              </div>`;
          }
        });
      }

      // ── Baris Clock Out ──
      html += `
        <div class="ts-dr-row" style="display:flex;align-items:center;gap:10px;padding:8px 16px;
                    border-bottom:1px solid #f5f5f5;${isAktif?"background:#fffde7;":""}">
          ${avatarHtml}
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:800;color:${isAktif?"#f9a825":"#222"};letter-spacing:.3px;">
              ${isAktif ? "--:--" : (s.jamKeluar ? fmtTime(s.jamKeluar) : "--:--")}
            </div>
            <div style="margin-top:2px;">
              <span style="font-size:10px;background:${isAktif?"#fff8e1":"#fce4ec"};
                           color:${isAktif?"#f57f17":"#c62828"};border-radius:4px;
                           padding:1px 7px;font-weight:700;">
                ${isAktif ? "▶ Sedang aktif" : "- Clock out"}
              </span>
              ${(() => {
                let m = 0;
                if (s.jamMasuk && s.jamKeluar) {
                  let diff = (new Date(s.jamKeluar) - new Date(s.jamMasuk)) / 60000;
                  (s.breaks||[]).forEach(b => { if (b.start && b.end) diff -= (new Date(b.end)-new Date(b.start))/60000; });
                  m = Math.max(0, diff);
                }
                return m > 0 ? `<span style="font-size:10px;color:var(--muted);margin-left:4px;">${fmtTotal(m)}</span>` : "";
              })()}
            </div>
          </div>
          ${isAktif ? "" : rowActions('keluar', null)}
        </div>`;

      // Catatan sesi (jika ada)
      if (s.catatan) {
        html += `
          <div style="padding:7px 16px 7px 62px;border-bottom:1px solid #f5f5f5;
                      font-size:11px;color:var(--muted);background:#fafafa;">
            📝 ${s.catatan}
          </div>`;
      }
    });
  }

  body.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// TIME PICKER — dropdown overlay jam & menit (24 jam, tanpa AM/PM)
// Dipakai di: ts-er (edit row) dan ts-tambah (tambah entri)
// Default: collapsed (baris jam saja). Klik → dropdown overlay muncul.
// ═══════════════════════════════════════════════════════════════

// Isi konten drum ke dalam elemen drum-wrap
function _tsPickerFillDrum(idPrefix, h, m) {
  const drum = document.getElementById(`${idPrefix}-drum-wrap`);
  if (!drum) return;
  drum.innerHTML = `
    <div style="position:relative;">
      <!-- highlight baris aktif -->
      <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);
                  height:38px;background:rgba(245,124,0,.09);pointer-events:none;z-index:1;
                  border-top:1.5px solid rgba(245,124,0,.35);
                  border-bottom:1.5px solid rgba(245,124,0,.35);"></div>
      <div style="display:flex;height:152px;overflow:hidden;">
        <!-- Kolom Jam -->
        <div id="${idPrefix}-col-h" class="ts-dr-col"
             style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;
                    border-right:1px solid #f0f2f5;"
             onscroll="_tsPickerScrollH('${idPrefix}',this)">
          <div style="height:57px;"></div>
          ${Array.from({length:24},(_,n)=>`
            <div data-v="${n}"
              style="height:38px;display:flex;align-items:center;justify-content:center;
                     font-size:15px;font-weight:${n===h?"700":"400"};
                     scroll-snap-align:center;cursor:pointer;
                     color:${n===h?"#e65100":"var(--text)"};"
              class="ts-pk-h ${n===h?"ts-picker-selected":""}"
              onclick="_tsPickerClickH('${idPrefix}',${n})">
              ${String(n).padStart(2,"0")}
            </div>`).join("")}
          <div style="height:57px;"></div>
        </div>
        <!-- Kolom Menit -->
        <div id="${idPrefix}-col-m" class="ts-dr-col"
             style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;"
             onscroll="_tsPickerScrollM('${idPrefix}',this)">
          <div style="height:57px;"></div>
          ${Array.from({length:60},(_,n)=>`
            <div data-v="${n}"
              style="height:38px;display:flex;align-items:center;justify-content:center;
                     font-size:15px;font-weight:${n===m?"700":"400"};
                     scroll-snap-align:center;cursor:pointer;
                     color:${n===m?"#e65100":"var(--text)"};"
              class="ts-pk-m ${n===m?"ts-picker-selected":""}"
              onclick="_tsPickerClickM('${idPrefix}',${n})">
              ${String(n).padStart(2,"0")}
            </div>`).join("")}
          <div style="height:57px;"></div>
        </div>
      </div>
    </div>`;
}

// Buat HTML collapsed row untuk picker (hanya row jam, tanpa drum)
// Drum diisi terpisah oleh _tsPickerFillDrum
function _tsPickerHTML(idPrefix, initJam, initMenit) {
  // Tidak dipakai lagi untuk ts-er karena HTML-nya sudah ada di index.html
  // Fungsi ini tetap ada untuk kompatibilitas dengan ts-tambah
  const h = initJam   !== undefined ? initJam   : new Date().getHours();
  const m = initMenit !== undefined ? initMenit : new Date().getMinutes();
  return `
    <div id="${idPrefix}-collapsed-row"
         onclick="_tsPickerToggle('${idPrefix}')"
         style="padding:12px 14px;display:flex;align-items:center;gap:8px;
                cursor:pointer;user-select:none;background:white;">
      <span id="${idPrefix}-display"
        style="font-size:15px;font-weight:600;color:var(--text);
               font-variant-numeric:tabular-nums;flex:1;">
        ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}
      </span>
      <span style="font-size:10px;color:var(--muted);background:#f5f5f5;border-radius:4px;
                   padding:2px 7px;white-space:nowrap;">GMT+8</span>
      <svg id="${idPrefix}-clock-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
           viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
    <div id="${idPrefix}-drum-wrap"
         style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
                background:white;border:1.5px solid #e65100;border-radius:12px;
                overflow:hidden;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.12);">
    </div>`;
}

// Toggle dropdown drum picker
function _tsPickerToggle(prefix) {
  const drum    = document.getElementById(`${prefix}-drum-wrap`);
  const icon    = document.getElementById(`${prefix}-clock-icon`);
  const row     = document.getElementById(`${prefix}-collapsed-row`);
  const display = document.getElementById(`${prefix}-display`);
  if (!drum || !row) return;

  const isOpen = drum.style.display !== "none";
  if (isOpen) {
    // Tutup
    drum.style.display  = "none";
    row.style.background = "white";
    row.style.borderColor = "";
    if (icon)    icon.setAttribute("stroke", "#bbb");
    if (display) display.style.color = "var(--text)";
  } else {
    // Isi drum jika belum ada konten
    if (!drum.querySelector(".ts-dr-col")) {
      const disp = document.getElementById(`${prefix}-display`);
      const parts = (disp?.textContent || "00:00").trim().split(":");
      _tsPickerFillDrum(prefix, parseInt(parts[0])||0, parseInt(parts[1])||0);
    }

    // Posisikan drum tepat di bawah collapsed-row (fixed)
    const rect = row.getBoundingClientRect();
    drum.style.top   = (rect.bottom + 4) + "px";
    drum.style.left  = rect.left + "px";
    drum.style.width = rect.width + "px";
    drum.style.display = "block";

    row.style.background  = "#fff8f2";
    row.style.borderColor = "#e65100";
    if (icon)    icon.setAttribute("stroke", "#e65100");
    if (display) display.style.color = "#e65100";

    // Scroll ke nilai yang benar setelah visible
    setTimeout(() => {
      const colH = document.getElementById(`${prefix}-col-h`);
      const colM = document.getElementById(`${prefix}-col-m`);
      if (colH) {
        const sel = colH.querySelector(".ts-picker-selected");
        colH.scrollTop = sel ? parseInt(sel.dataset.v) * 38 : 0;
      }
      if (colM) {
        const sel = colM.querySelector(".ts-picker-selected");
        colM.scrollTop = sel ? parseInt(sel.dataset.v) * 38 : 0;
      }
    }, 10);
  }
}

// Tutup semua picker terbuka (klik di luar)
function _tsPickerCloseAll() {
  document.querySelectorAll('[id$="-drum-wrap"]').forEach(drum => {
    if (drum.style.display !== "none") {
      const prefix = drum.id.replace("-drum-wrap", "");
      drum.style.display = "none";
      const icon = document.getElementById(`${prefix}-clock-icon`);
      if (icon) icon.setAttribute("stroke", "#bbb");
      const row = document.getElementById(`${prefix}-collapsed-row`);
      if (row) { row.style.background = "white"; row.style.borderColor = ""; }
      const display = document.getElementById(`${prefix}-display`);
      if (display) display.style.color = "var(--text)";
    }
  });
}
// Klik di luar picker → tutup
document.addEventListener("click", function(e) {
  if (!e.target.closest('[id$="-picker-wrap"]') &&
      !e.target.closest('[id$="-collapsed-row"]') &&
      !e.target.closest('[id$="-drum-wrap"]')) {
    _tsPickerCloseAll();
  }
}, true);

// Scroll ke posisi nilai tertentu
function _tsPickerScrollTo(colEl, val) {
  if (!colEl) return;
  colEl.scrollTop = val * 38;
}

// Ambil nilai jam aktif berdasarkan posisi scroll
function _tsPickerGetValFromScroll(colEl) {
  return Math.round(colEl.scrollTop / 38);
}

// Update display + hidden value
function _tsPickerUpdate(prefix) {
  const colH = document.getElementById(`${prefix}-col-h`);
  const colM = document.getElementById(`${prefix}-col-m`);
  if (!colH || !colM) return;
  const h = Math.min(23, Math.max(0, _tsPickerGetValFromScroll(colH)));
  const m = Math.min(59, Math.max(0, _tsPickerGetValFromScroll(colM)));
  const str = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

  const disp = document.getElementById(`${prefix}-display`);
  if (disp) disp.textContent = str;

  // Update highlight
  colH.querySelectorAll(".ts-pk-h").forEach(el => {
    const isActive = parseInt(el.dataset.v) === h;
    el.classList.toggle("ts-picker-selected", isActive);
    el.style.color      = isActive ? "#e65100" : "var(--text)";
    el.style.fontWeight = isActive ? "700" : "400";
  });
  colM.querySelectorAll(".ts-pk-m").forEach(el => {
    const isActive = parseInt(el.dataset.v) === m;
    el.classList.toggle("ts-picker-selected", isActive);
    el.style.color      = isActive ? "#e65100" : "var(--text)";
    el.style.fontWeight = isActive ? "700" : "400";
  });

  // Tulis ke hidden input / state
  const hiddenInput = document.getElementById(`${prefix}-val`);
  if (hiddenInput) hiddenInput.value = str;

  // Untuk ts-er: update hidden ts-er-jam
  if (prefix === "ts-er") {
    const erJam = document.getElementById("ts-er-jam");
    if (erJam) erJam.value = str;
  }

  return str;
}

let _tsPickerScrollTimer = {};
function _tsPickerScrollH(prefix, el) {
  clearTimeout(_tsPickerScrollTimer[prefix+"h"]);
  _tsPickerScrollTimer[prefix+"h"] = setTimeout(() => {
    const v = Math.round(el.scrollTop / 38);
    el.scrollTop = v * 38;
    _tsPickerUpdate(prefix);
  }, 60);
}
function _tsPickerScrollM(prefix, el) {
  clearTimeout(_tsPickerScrollTimer[prefix+"m"]);
  _tsPickerScrollTimer[prefix+"m"] = setTimeout(() => {
    const v = Math.round(el.scrollTop / 38);
    el.scrollTop = v * 38;
    _tsPickerUpdate(prefix);
  }, 60);
}
function _tsPickerClickH(prefix, val) {
  const col = document.getElementById(`${prefix}-col-h`);
  if (col) { col.scrollTop = val * 38; }
  setTimeout(() => _tsPickerUpdate(prefix), 50);
}
function _tsPickerClickM(prefix, val) {
  const col = document.getElementById(`${prefix}-col-m`);
  if (col) { col.scrollTop = val * 38; }
  setTimeout(() => _tsPickerUpdate(prefix), 50);
}

// Inisialisasi picker: set nilai awal di display dan scroll drum jika sudah ada
function _tsPickerInit(prefix, jamStr) {
  const parts = (jamStr||"").split(":");
  const h = parseInt(parts[0]||"0")||0;
  const m = parseInt(parts[1]||"0")||0;

  // Update display text
  const disp = document.getElementById(`${prefix}-display`);
  if (disp) disp.textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

  // Update hidden jam
  const hiddenJam = document.getElementById(`${prefix}-jam`) || document.getElementById("ts-er-jam");
  if (hiddenJam) hiddenJam.value = jamStr || "00:00";

  // Isi drum (lazy — akan otomatis terisi saat toggle, tapi isi sekarang supaya nilai benar)
  _tsPickerFillDrum(prefix, h, m);
}

// Ambil nilai dari picker (string "HH:MM")
function _tsPickerGetVal(prefix) {
  // Prioritas 1: hidden input (selalu diupdate saat scroll/click)
  const hiddenJam = document.getElementById(`${prefix}-jam`);
  if (hiddenJam && hiddenJam.value && /^\d{2}:\d{2}$/.test(hiddenJam.value)) {
    return hiddenJam.value;
  }

  // Prioritas 2: display text (diupdate saat scroll)
  const disp = document.getElementById(`${prefix}-display`);
  if (disp) {
    const txt = disp.textContent.trim();
    if (txt && /^\d{2}:\d{2}$/.test(txt)) return txt;
  }

  // Prioritas 3: baca scrollTop drum (hanya valid saat drum terbuka)
  const colH = document.getElementById(`${prefix}-col-h`);
  const colM = document.getElementById(`${prefix}-col-m`);
  if (!colH || !colM) return "";
  const h = Math.min(23, Math.max(0, Math.round(colH.scrollTop / 38)));
  const m = Math.min(59, Math.max(0, Math.round(colM.scrollTop / 38)));
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

// ── Load aktivitas kustom dari server (generic) ───────────────
async function _tsLoadAktivitasKustom(selEl, currentVal) {
  if (!selEl) return;
  while (selEl.options.length > 1) selEl.remove(1);
  try {
    const r = await authFetch("/aktivitas-kustom");
    if (!r.ok) return;
    const list = await r.json();
    list.forEach(nama => {
      const o = document.createElement("option");
      o.value = nama; o.textContent = nama;
      selEl.appendChild(o);
    });
  } catch {}
  if (currentVal) selEl.value = currentVal;
}

// Helper: ekstrak {h, m} dari ISO string atau HH:MM secara reliable (tidak bergantung locale)
function _extractHM(isoStr) {
  if (!isoStr) return { h: 0, m: 0 };
  if (/^\d{1,2}:\d{2}$/.test(isoStr)) {
    const p = isoStr.split(":");
    return { h: parseInt(p[0]) || 0, m: parseInt(p[1]) || 0 };
  }
  const d = new Date(isoStr);
  if (!isNaN(d)) return { h: d.getHours(), m: d.getMinutes() };
  return { h: 0, m: 0 };
}

// ── Edit satu baris (masuk / break-start / break-end / keluar) ────────────────────
function tsDrawerEditRow(sIdx, type, breakIdx) {
  const s = _drSesiList[sIdx];
  if (!s) return;

  let _rawIso = "";
  if (type === "masuk")       _rawIso = s.jamMasuk || "";
  else if (type === "keluar") _rawIso = s.jamKeluar || "";
  else if (type === "break-start" && breakIdx >= 0) _rawIso = s.breaks?.[breakIdx]?.start || "";
  else if (type === "break-end"   && breakIdx >= 0) _rawIso = s.breaks?.[breakIdx]?.end   || "";
  const { h: _rh, m: _rm } = _extractHM(_rawIso);
  const jamVal = _rawIso ? String(_rh).padStart(2,"0") + ":" + String(_rm).padStart(2,"0") : "";

  const typeLabel = {
    "masuk":       "Clock In",
    "keluar":      "Clock Out",
    "break-start": "Mulai Istirahat",
    "break-end":   "Lanjut Kerja",
  }[type] || type;

  _tsEditRowCtx = { sIdx, type, breakIdx };
  document.getElementById("ts-er-title").textContent = `Edit ${typeLabel}`;
  document.getElementById("ts-er-sub").textContent   = `${_drUser.nama || _drUser.username} · ${_drDate}`;
  document.getElementById("ts-er-date").value        = _drDate;

  // Set nilai display dan drum picker (tanpa inject HTML baru)
  const jamStr = jamVal || "00:00";
  const parts  = jamStr.split(":");
  const h = parseInt(parts[0])||0, m = parseInt(parts[1])||0;

  // Reset collapsed row
  const display = document.getElementById("ts-er-display");
  if (display) {
    display.textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    display.style.color = "var(--text)";
  }
  // Reset border & state
  const collRow = document.getElementById("ts-er-collapsed-row");
  if (collRow) collRow.style.background = "white";
  const clockIcon = document.getElementById("ts-er-clock-icon");
  if (clockIcon) clockIcon.setAttribute("stroke", "#bbb");
  // Tutup dropdown jika terbuka
  const drum = document.getElementById("ts-er-drum-wrap");
  if (drum) { drum.style.display = "none"; drum.innerHTML = ""; }
  // Isi drum dengan nilai baru (siap saat diklik)
  _tsPickerFillDrum("ts-er", h, m);

  // Hidden value
  const hiddenJam = document.getElementById("ts-er-jam");
  if (hiddenJam) hiddenJam.value = jamVal || "00:00";

  // Lokasi & aktivitas hanya untuk masuk/keluar
  const showMeta = (type === "masuk" || type === "keluar");
  document.getElementById("ts-er-meta-wrap").style.display = showMeta ? "flex" : "none";
  if (showMeta) {
    const selLok = document.getElementById("ts-er-lokasi");
    while (selLok.options.length > 1) selLok.remove(1);
    _drAreas.forEach(a => {
      const o = document.createElement("option");
      o.value = a.name; o.textContent = a.name; selLok.appendChild(o);
    });
    selLok.value = s.lokasiNama || "";

    const selAkt = document.getElementById("ts-er-aktivitas");
    _tsLoadAktivitasKustom(selAkt, s.aktivitas || "");
    document.getElementById("ts-er-catatan").value = s.catatan || "";
  }

  const ov = document.getElementById("ts-er-overlay");
  ov.style.display = "flex";
  ov.onclick = e => { if (e.target === ov) closeTsErForm(); };
}
let _tsEditRowCtx = null;

function closeTsErForm() {
  document.getElementById("ts-er-overlay").style.display = "none";
  _tsEditRowCtx = null;
}

async function tsSimpanEditRow() {
  const ctx = _tsEditRowCtx;
  if (!ctx) return;

  // Ambil jam dari picker atau hidden input
  const jamRaw = _tsPickerGetVal("ts-er") || document.getElementById("ts-er-jam")?.value?.trim();
  const date   = document.getElementById("ts-er-date").value;
  if (!jamRaw || jamRaw === "00:00" && ctx.type !== "masuk") {
    // Izinkan 00:00 untuk masuk, tapi warn jika kosong
  }
  if (!jamRaw) { showToast("⚠️ Pilih jam terlebih dahulu", "warning"); return; }
  if (!/^\d{2}:\d{2}$/.test(jamRaw)) { showToast("⚠️ Format jam tidak valid", "warning"); return; }
  const jam = jamRaw;

  const s       = JSON.parse(JSON.stringify(_drSesiList[ctx.sIdx])); // clone
  const isoFull = localISOStr(new Date(`${date}T${jam}:00`));

  if      (ctx.type === "masuk")       s.jamMasuk  = isoFull;
  else if (ctx.type === "keluar")      s.jamKeluar = isoFull;
  else if (ctx.type === "break-start") { if (!s.breaks) s.breaks=[]; if (!s.breaks[ctx.breakIdx]) s.breaks[ctx.breakIdx]={}; s.breaks[ctx.breakIdx].start = isoFull; }
  else if (ctx.type === "break-end")   { if (!s.breaks) s.breaks=[]; if (!s.breaks[ctx.breakIdx]) s.breaks[ctx.breakIdx]={}; s.breaks[ctx.breakIdx].end   = isoFull; }

  const showMeta = (ctx.type === "masuk" || ctx.type === "keluar");
  if (showMeta) {
    s.lokasiNama = document.getElementById("ts-er-lokasi").value;
    s.aktivitas  = document.getElementById("ts-er-aktivitas").value;
    s.catatan    = document.getElementById("ts-er-catatan").value.trim();
  }

  try {
    const r = await authFetch(`/timesheet/absen/${_drUser.username}/${date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...s, sesi: s.sesi })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Berhasil disimpan!");
      closeTsErForm();
      await _tsDrawerLoadDay(_drDate);
      await loadTimesheet();
      startTsTicker();
    } else { showToast("❌ " + (d.msg || "Gagal"), "error"); }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

// ── Hapus satu baris dengan alasan wajib ────────────────────────────────────────
function tsDrawerHapusRow(sIdx, type, breakIdx) {
  const s = _drSesiList[sIdx];
  if (!s) return;

  const typeLabel = {
    "masuk":       "Clock In",
    "keluar":      "Clock Out",
    "break-start": "Mulai Istirahat",
    "break-end":   "Lanjut Kerja",
  }[type] || type;

  _tsHapusRowCtx = { sIdx, type, breakIdx, sesi: s };
  document.getElementById("ts-hapus-title").textContent = `Hapus ${typeLabel}`;
  document.getElementById("ts-hapus-alasan").value = "";

  const ov = document.getElementById("ts-hapus-overlay");
  ov.style.display = "flex";
  ov.onclick = e => { if (e.target === ov) closeTsHapusForm(); };
}
let _tsHapusRowCtx = null;

function closeTsHapusForm() {
  document.getElementById("ts-hapus-overlay").style.display = "none";
  _tsHapusRowCtx = null;
}

async function tsSimpanHapusRow() {
  const alasan = document.getElementById("ts-hapus-alasan").value.trim();
  if (!alasan) { showToast("⚠️ Alasan penghapusan wajib diisi", "warning"); return; }
  const ctx = _tsHapusRowCtx;
  if (!ctx) return;

  const s       = JSON.parse(JSON.stringify(ctx.sesi));
  const sesiNum = s.sesi || (ctx.sIdx + 1);

  // Jika hapus Clock In atau Clock Out → hapus seluruh sesi
  if (ctx.type === "masuk" || ctx.type === "keluar") {
    try {
      const r = await authFetch(`/timesheet/absen/${_drUser.username}/${_drDate}?sesi=${sesiNum}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alasan })
      });
      const d = await r.json();
      if (d.status === "OK") {
        showToast("✅ Berhasil dihapus");
        closeTsHapusForm();
        await _tsDrawerLoadDay(_drDate);
        await loadTimesheet();
      } else { showToast("❌ " + (d.message||"Gagal hapus"), "error"); }
    } catch { showToast("❌ Gagal hapus", "error"); }
    return;
  }

  // Hapus break tertentu → edit sesi tanpa break itu
  if (ctx.type === "break-start" || ctx.type === "break-end") {
    if (!s.breaks) s.breaks = [];
    if (ctx.type === "break-start") {
      // Hapus seluruh break entry ini
      s.breaks.splice(ctx.breakIdx, 1);
    } else {
      // Hapus hanya end (jadikan break tanpa akhir)
      if (s.breaks[ctx.breakIdx]) s.breaks[ctx.breakIdx].end = null;
    }
    try {
      const r = await authFetch(`/timesheet/absen/${_drUser.username}/${_drDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, sesi: sesiNum, alasan })
      });
      const d = await r.json();
      if (d.status === "OK") {
        showToast("✅ Berhasil dihapus");
        closeTsHapusForm();
        await _tsDrawerLoadDay(_drDate);
        await loadTimesheet();
      } else { showToast("❌ " + (d.msg||"Gagal"), "error"); }
    } catch { showToast("❌ Gagal hapus", "error"); }
  }
}

// ── Tambah Entri Waktu (multi-entry: Masuk | Istirahat | Keluar) ─────────────────
let _drEntries = []; // array entri yang akan disimpan sekaligus

function tsDrawerTambahSesi() {
  _drEntries = [{ tab: "masuk", jam: "", tanggal: _drDate, lokasi: "", aktivitas: "", catatan: "" }];
  _renderTambahEntriForm();
  const ov = document.getElementById("ts-tambah-overlay");
  ov.style.display = "flex";
  ov.onclick = e => { if (e.target === ov) closeTsTambahForm(); };
}

function closeTsTambahForm() {
  document.getElementById("ts-tambah-overlay").style.display = "none";
  _drEntries = [];
}

function _renderTambahEntriForm() {
  const wrap = document.getElementById("ts-tambah-entries");
  if (!wrap) return;
  const now = new Date();
  const nowH = now.getHours(), nowM = now.getMinutes();

  wrap.innerHTML = _drEntries.map((e, i) => {
    const tabs = ["masuk","istirahat","keluar"];
    const tabLabels = { masuk:"Masuk", istirahat:"Istirahat", keluar:"Keluar" };
    const prefix = `tse-${i}`;

    // Tentukan jam awal picker
    const parts = (e.jam||"").split(":");
    const eH = parseInt(parts[0])||nowH;
    const eM = parseInt(parts[1])||nowM;
    const partsS = (e.jamSelesai||"").split(":");
    const eSH = parseInt(partsS[0])||nowH;
    const eSM = parseInt(partsS[1])||nowM;

    // Lokasi options
    const lokasiOpts = `<option value="">Pilih lokasi</option>` +
      _drAreas.map(a => `<option value="${a.name}" ${e.lokasi===a.name?"selected":""}>${a.name}</option>`).join("");

    const isIstirahat = e.tab === "istirahat";
    const showMeta    = !isIstirahat;

    return `
      <div style="border:1.5px solid #e8ecf0;border-radius:14px;overflow:hidden;margin-bottom:12px;background:white;">
        <!-- Tab Masuk | Istirahat | Keluar -->
        <div style="display:flex;border-bottom:1px solid #f0f2f5;">
          ${tabs.map(t => `
            <button onclick="_drSetTab(${i},'${t}')"
              style="flex:1;padding:11px 4px;border:none;cursor:pointer;font-size:13px;font-weight:700;
                     background:${e.tab===t?"#f57c00":"white"};
                     color:${e.tab===t?"white":"var(--muted)"};transition:.15s;border-radius:0;">
              ${tabLabels[t]}
            </button>`).join("")}
        </div>

        <!-- Picker jam -->
        <div style="border-bottom:1px solid #f0f2f5;">
          ${isIstirahat ? `
            <!-- Istirahat: 2 picker berdampingan -->
            <div style="display:flex;gap:0;">
              <!-- Picker mulai -->
              <div style="flex:1;border-right:1px solid #f0f2f5;">
                <div style="padding:8px 12px 4px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Mulai</div>
                <div style="padding:4px 12px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #f0f2f5;">
                  <span id="${prefix}-disp-a" style="font-size:24px;font-weight:800;color:#e65100;font-variant-numeric:tabular-nums;">
                    ${String(eH).padStart(2,"0")}:${String(eM).padStart(2,"0")}
                  </span>
                </div>
                <div style="display:flex;height:140px;overflow:hidden;position:relative;">
                  <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:36px;
                              background:rgba(245,124,0,.07);border-top:1.5px solid rgba(245,124,0,.25);
                              border-bottom:1.5px solid rgba(245,124,0,.25);pointer-events:none;z-index:1;"></div>
                  <div id="${prefix}-col-ah" class="ts-dr-col"
                    style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;border-right:1px solid #f5f5f5;"
                    onscroll="_tsPickerScrollH('${prefix}-a',this)">
                    <div style="height:52px;"></div>
                    ${Array.from({length:24},(_,n)=>`<div data-v="${n}" onclick="_tsPickerClickH('${prefix}-a',${n})"
                      style="height:36px;display:flex;align-items:center;justify-content:center;font-size:17px;
                             font-weight:${n===eH?900:700};color:${n===eH?"#e65100":"var(--text)"};
                             scroll-snap-align:center;cursor:pointer;" class="ts-pk-h ${n===eH?"ts-picker-selected":""}">
                      ${String(n).padStart(2,"0")}</div>`).join("")}
                    <div style="height:52px;"></div>
                  </div>
                  <div id="${prefix}-col-am" class="ts-dr-col"
                    style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;"
                    onscroll="_tsPickerScrollM('${prefix}-a',this)">
                    <div style="height:52px;"></div>
                    ${Array.from({length:60},(_,n)=>`<div data-v="${n}" onclick="_tsPickerClickM('${prefix}-a',${n})"
                      style="height:36px;display:flex;align-items:center;justify-content:center;font-size:17px;
                             font-weight:${n===eM?900:700};color:${n===eM?"#e65100":"var(--text)"};
                             scroll-snap-align:center;cursor:pointer;" class="ts-pk-m ${n===eM?"ts-picker-selected":""}">
                      ${String(n).padStart(2,"0")}</div>`).join("")}
                    <div style="height:52px;"></div>
                  </div>
                </div>
              </div>
              <!-- Picker selesai -->
              <div style="flex:1;">
                <div style="padding:8px 12px 4px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Selesai</div>
                <div style="padding:4px 12px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #f0f2f5;">
                  <span id="${prefix}-disp-b" style="font-size:24px;font-weight:800;color:#e65100;font-variant-numeric:tabular-nums;">
                    ${String(eSH).padStart(2,"0")}:${String(eSM).padStart(2,"0")}
                  </span>
                </div>
                <div style="display:flex;height:140px;overflow:hidden;position:relative;">
                  <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:36px;
                              background:rgba(245,124,0,.07);border-top:1.5px solid rgba(245,124,0,.25);
                              border-bottom:1.5px solid rgba(245,124,0,.25);pointer-events:none;z-index:1;"></div>
                  <div id="${prefix}-col-bh" class="ts-dr-col"
                    style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;border-right:1px solid #f5f5f5;"
                    onscroll="_tsPickerScrollH('${prefix}-b',this)">
                    <div style="height:52px;"></div>
                    ${Array.from({length:24},(_,n)=>`<div data-v="${n}" onclick="_tsPickerClickH('${prefix}-b',${n})"
                      style="height:36px;display:flex;align-items:center;justify-content:center;font-size:17px;
                             font-weight:${n===eSH?900:700};color:${n===eSH?"#e65100":"var(--text)"};
                             scroll-snap-align:center;cursor:pointer;" class="ts-pk-h ${n===eSH?"ts-picker-selected":""}">
                      ${String(n).padStart(2,"0")}</div>`).join("")}
                    <div style="height:52px;"></div>
                  </div>
                  <div id="${prefix}-col-bm" class="ts-dr-col"
                    style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;"
                    onscroll="_tsPickerScrollM('${prefix}-b',this)">
                    <div style="height:52px;"></div>
                    ${Array.from({length:60},(_,n)=>`<div data-v="${n}" onclick="_tsPickerClickM('${prefix}-b',${n})"
                      style="height:36px;display:flex;align-items:center;justify-content:center;font-size:17px;
                             font-weight:${n===eSM?900:700};color:${n===eSM?"#e65100":"var(--text)"};
                             scroll-snap-align:center;cursor:pointer;" class="ts-pk-m ${n===eSM?"ts-picker-selected":""}">
                      ${String(n).padStart(2,"0")}</div>`).join("")}
                    <div style="height:52px;"></div>
                  </div>
                </div>
              </div>
            </div>
          ` : `
            <!-- Masuk / Keluar: satu picker penuh -->
            <div style="padding:10px 14px 8px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f0f2f5;">
              <span id="${prefix}-disp-a" style="font-size:32px;font-weight:800;color:#e65100;
                     font-variant-numeric:tabular-nums;flex:1;">
                ${String(eH).padStart(2,"0")}:${String(eM).padStart(2,"0")}
              </span>
              <span style="font-size:10px;color:var(--muted);background:#f5f5f5;border-radius:5px;padding:3px 7px;">GMT+8</span>
            </div>
            <div style="display:flex;height:160px;overflow:hidden;position:relative;">
              <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:40px;
                          background:rgba(245,124,0,.07);border-top:1.5px solid rgba(245,124,0,.25);
                          border-bottom:1.5px solid rgba(245,124,0,.25);pointer-events:none;z-index:1;"></div>
              <div id="${prefix}-col-ah" class="ts-dr-col"
                style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;border-right:1px solid #f0f2f5;"
                onscroll="_tsPickerScrollH('${prefix}-a',this)">
                <div style="height:60px;"></div>
                ${Array.from({length:24},(_,n)=>`<div data-v="${n}" onclick="_tsPickerClickH('${prefix}-a',${n})"
                  style="height:40px;display:flex;align-items:center;justify-content:center;font-size:20px;
                         font-weight:${n===eH?900:700};color:${n===eH?"#e65100":"var(--text)"};
                         scroll-snap-align:center;cursor:pointer;" class="ts-pk-h ${n===eH?"ts-picker-selected":""}">
                  ${String(n).padStart(2,"0")}</div>`).join("")}
                <div style="height:60px;"></div>
              </div>
              <div id="${prefix}-col-am" class="ts-dr-col"
                style="flex:1;overflow-y:auto;scroll-snap-type:y mandatory;"
                onscroll="_tsPickerScrollM('${prefix}-a',this)">
                <div style="height:60px;"></div>
                ${Array.from({length:60},(_,n)=>`<div data-v="${n}" onclick="_tsPickerClickM('${prefix}-a',${n})"
                  style="height:40px;display:flex;align-items:center;justify-content:center;font-size:20px;
                         font-weight:${n===eM?900:700};color:${n===eM?"#e65100":"var(--text)"};
                         scroll-snap-align:center;cursor:pointer;" class="ts-pk-m ${n===eM?"ts-picker-selected":""}">
                  ${String(n).padStart(2,"0")}</div>`).join("")}
                <div style="height:60px;"></div>
              </div>
            </div>
          `}
        </div>

        <!-- Field lainnya -->
        <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
          <!-- Tanggal -->
          <div style="border:1.5px solid #e8ecf0;border-radius:10px;padding:10px 14px;
                      display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:var(--muted);font-weight:600;">📅</span>
            <input type="date" value="${e.tanggal||_drDate}"
              onchange="_drSetField(${i},'tanggal',this.value)"
              style="flex:1;border:none;outline:none;font-size:14px;color:var(--text);">
          </div>

          ${showMeta ? `
            <!-- Lokasi -->
            <div style="border:1.5px solid #e8ecf0;border-radius:10px;padding:10px 14px;">
              <div style="font-size:10px;color:var(--muted);font-weight:600;margin-bottom:4px;">📍 Lokasi <span style="color:#e53935;">*</span></div>
              <select onchange="_drSetField(${i},'lokasi',this.value)"
                style="width:100%;border:none;outline:none;font-size:14px;color:var(--text);background:transparent;">${lokasiOpts}</select>
            </div>
            <!-- Aktivitas (dari server) -->
            <div style="border:1.5px solid #e8ecf0;border-radius:10px;padding:10px 14px;">
              <div style="font-size:10px;color:var(--muted);font-weight:600;margin-bottom:4px;">🏃 Pilih jenis aktivitas</div>
              <select id="tse-akt-${i}" onchange="_drSetField(${i},'aktivitas',this.value)"
                style="width:100%;border:none;outline:none;font-size:14px;color:var(--text);background:transparent;">
                <option value="">Pilih aktivitas</option>
              </select>
            </div>
            <!-- Catatan -->
            <div style="border:1.5px solid #e8ecf0;border-radius:10px;padding:10px 14px;">
              <div style="font-size:10px;color:var(--muted);font-weight:600;margin-bottom:4px;">📝 Catatan (opsional)</div>
              <textarea rows="2" onchange="_drSetField(${i},'catatan',this.value)"
                placeholder="Tambahkan catatan..."
                style="width:100%;border:none;outline:none;font-size:13px;color:var(--text);resize:none;font-family:inherit;">${e.catatan||""}</textarea>
            </div>
          ` : ""}
        </div>

        <!-- Hapus entri ini (jika lebih dari 1) -->
        ${_drEntries.length > 1 ? `
          <div style="padding:0 14px 12px;text-align:right;">
            <button onclick="_drRemoveEntry(${i})"
              style="background:none;border:none;color:#e53935;font-size:12px;cursor:pointer;font-weight:600;">
              🗑 Hapus entri ini
            </button>
          </div>` : ""}
      </div>`;
  }).join("");

  // Scroll picker ke posisi yang benar + load aktivitas kustom setelah render
  requestAnimationFrame(() => {
    _drEntries.forEach((e, i) => {
      const prefix = `tse-${i}`;
      const parts = (e.jam||"00:00").split(":");
      const h = parseInt(parts[0])||0, m = parseInt(parts[1])||0;
      const colAH = document.getElementById(`${prefix}-col-ah`);
      const colAM = document.getElementById(`${prefix}-col-am`);
      const isIstirahat = e.tab === "istirahat";
      const itemH = isIstirahat ? 36 : 40;
      if (colAH) colAH.scrollTop = h * itemH;
      if (colAM) colAM.scrollTop = m * itemH;

      if (isIstirahat) {
        const partsS = (e.jamSelesai||"00:00").split(":");
        const sH = parseInt(partsS[0])||0, sM = parseInt(partsS[1])||0;
        const colBH = document.getElementById(`${prefix}-col-bh`);
        const colBM = document.getElementById(`${prefix}-col-bm`);
        if (colBH) colBH.scrollTop = sH * 36;
        if (colBM) colBM.scrollTop = sM * 36;
      }

      // Load aktivitas kustom
      const selAkt = document.getElementById(`tse-akt-${i}`);
      if (selAkt) _tsLoadAktivitasKustom(selAkt, e.aktivitas || "");
    });
  });
}

function _drSetTab(i, tab) {
  _drEntries[i].tab = tab;
  _renderTambahEntriForm();
}
function _drSetField(i, field, val) {
  _drEntries[i][field] = val;
}
function _drRemoveEntry(i) {
  _drEntries.splice(i, 1);
  _renderTambahEntriForm();
}
function drTambahEntryBaru() {
  _drEntries.push({ tab: "masuk", jam: "", tanggal: _drDate, lokasi: "", aktivitas: "", catatan: "" });
  _renderTambahEntriForm();
  // Scroll ke bawah
  setTimeout(() => {
    const wrap = document.getElementById("ts-tambah-entries");
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }, 50);
}

async function tsSimpanTambahEntri() {
  if (_drEntries.length === 0) return;

  // Baca nilai jam dari picker untuk setiap entri
  _drEntries.forEach((e, i) => {
    const prefix = `tse-${i}`;
    const itemH = e.tab === "istirahat" ? 36 : 40;
    const colAH = document.getElementById(`${prefix}-col-ah`);
    const colAM = document.getElementById(`${prefix}-col-am`);
    if (colAH && colAM) {
      const h = Math.min(23, Math.max(0, Math.round(colAH.scrollTop / itemH)));
      const m = Math.min(59, Math.max(0, Math.round(colAM.scrollTop / itemH)));
      e.jam = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    }
    if (e.tab === "istirahat") {
      const colBH = document.getElementById(`${prefix}-col-bh`);
      const colBM = document.getElementById(`${prefix}-col-bm`);
      if (colBH && colBM) {
        const h2 = Math.min(23, Math.max(0, Math.round(colBH.scrollTop / 36)));
        const m2 = Math.min(59, Math.max(0, Math.round(colBM.scrollTop / 36)));
        e.jamSelesai = `${String(h2).padStart(2,"0")}:${String(m2).padStart(2,"0")}`;
      }
    }
  });

  // Validasi semua entri
  for (let i = 0; i < _drEntries.length; i++) {
    const e = _drEntries[i];
    if (e.tab !== "istirahat" && !e.lokasi) {
      showToast(`⚠️ Entri ${i+1}: Pilih lokasi`,"warning"); return;
    }
    if (!e.jam) {
      showToast(`⚠️ Entri ${i+1}: Pilih jam`,"warning"); return;
    }
    if (e.tab === "istirahat" && !e.jamSelesai) {
      showToast(`⚠️ Entri ${i+1}: Isi jam selesai istirahat`, "warning"); return;
    }
  }

  // Bangun payload: kumpulkan masuk, keluar, dan breaks
  // Cari masuk & keluar dari entri yang ada
  const entriMasuk    = _drEntries.filter(e => e.tab === "masuk");
  const entriKeluar   = _drEntries.filter(e => e.tab === "keluar");
  const entriIstirahat= _drEntries.filter(e => e.tab === "istirahat");

  const tanggal = _drEntries[0].tanggal || _drDate;

  const payload = {
    targetUser:  _drUser.username,
    date:        tanggal,
    jamMasuk:    entriMasuk[0]   ? localISOStr(new Date(`${tanggal}T${entriMasuk[0].jam}:00`))   : null,
    jamKeluar:   entriKeluar[0]  ? localISOStr(new Date(`${tanggal}T${entriKeluar[0].jam}:00`))  : null,
    breaks:      entriIstirahat.map(e => ({
      start: localISOStr(new Date(`${tanggal}T${e.jam}:00`)),
      end:   e.jamSelesai ? localISOStr(new Date(`${tanggal}T${e.jamSelesai}:00`)) : null
    })),
    lokasiNama:  entriMasuk[0]?.lokasi  || entriKeluar[0]?.lokasi  || "",
    aktivitas:   entriMasuk[0]?.aktivitas || entriKeluar[0]?.aktivitas || "",
    catatan:     entriMasuk[0]?.catatan   || entriKeluar[0]?.catatan   || "",
  };

  if (!payload.jamMasuk) { showToast("⚠️ Minimal tambahkan entri Masuk (Clock In)", "warning"); return; }

  try {
    const r = await authFetch("/timesheet/absen-manual", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Entri berhasil ditambahkan!");
      closeTsTambahForm();
      await _tsDrawerLoadDay(_drDate);
      await loadTimesheet();
      startTsTicker();
    } else { showToast("❌ " + (d.msg||"Gagal menyimpan"), "error"); }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

// ── Klik nama user di tabel → buka drawer ────────────────────
// (dipanggil dari tsRender via onclick di kolom nama)
function _tsDrawerOpenByUsername(username, date) {
  const u = _tsData?.users?.find(u => u.username === username);
  if (u) openTsDrawer(u, date || u.days[0]?.date);
}

// ============================================================
// PROFIL
// ============================================================
let _profilData      = null;
let _profilNewPhoto  = null; // base64 foto baru
let _profilNewFaceDesc = null; // Float32Array descriptor baru

async function loadProfil() {
  const me = localStorage.getItem("user");
  switchProfilTab("profil"); // reset ke tab profil
  try {
    const r = await authFetch("/profile/" + me);
    _profilData = await r.json();
    renderProfil();
  } catch { showToast("❌ Gagal memuat profil", "error"); }
}

function renderProfil() {
  const d = _profilData;
  if (!d) return;
  const me = localStorage.getItem("user");
  document.getElementById("profil-username-label").innerText = "@" + me;

  // Foto profil
  const photoEl = document.getElementById("profil-photo-display");
  if (d.photo) {
    photoEl.outerHTML = `<img id="profil-photo-display" class="profil-avatar" src="${d.photo}">`;
  } else {
    if (photoEl.tagName !== "DIV") {
      const div = document.createElement("div");
      div.id = "profil-photo-display";
      div.className = "profil-avatar-placeholder";
      div.innerText = "👤";
      photoEl.replaceWith(div);
    }
  }

  // Data diri
  document.getElementById("pf-nama").innerText    = d.namaLengkap  || "—";
  document.getElementById("pf-agama").innerText   = d.agama        || "—";
  document.getElementById("pf-nohp").innerText    = d.noHp         || "—";
  document.getElementById("pf-jabatan").innerText = d.jabatan      || "—";
  // Peran hanya ditampilkan jika Owner atau Admin
  const peranRow = document.getElementById("pf-peran")?.closest(".profil-field-row");
  if (d.peran && (d.group === "owner" || d.group === "admin")) {
    document.getElementById("pf-peran").innerText = d.peran;
    if (peranRow) peranRow.style.display = "flex";
  } else {
    if (peranRow) peranRow.style.display = "none";
  }
  document.getElementById("pf-divisi").innerText      = d.divisi      || "—";
  // Status Kerja: hanya tampil jika "Tugas Luar"
  const rowStatusKerja = document.getElementById("row-status-kerja");
  if (d.statusKerja === "Tugas Luar") {
    rowStatusKerja.style.display = "flex";
    document.getElementById("pf-status-kerja").innerText = "🚗 Tugas Luar";
  } else {
    rowStatusKerja.style.display = "none";
  }

  // Gaji — hanya terlihat oleh owner
  const rowGaji = document.getElementById("row-gaji");
  if (userLevel <= 1) {
    rowGaji.style.display = "flex";
    const gajiEl = document.getElementById("pf-gaji");
    gajiEl.setAttribute("data-val", "Rp " + (Number(d.nominalGaji)||0).toLocaleString("id-ID"));
    gajiEl.innerText = "Rp ••••••";
    gajiEl.classList.remove("revealed");
    gajiEl.onclick = function() {
      this.classList.toggle("revealed");
      this.innerText = this.classList.contains("revealed") ? this.getAttribute("data-val") : "Rp ••••••";
    };
  } else {
    rowGaji.style.display = "none";
  }

  // Username & password (keamanan)
  document.getElementById("pk-username").innerText = me;
  const pwEl = document.getElementById("pk-password");
  // Untuk keamanan, password hanya bisa dilihat oleh pemilik sendiri — kita simpan dummy
  pwEl.setAttribute("data-val", "••••••••");
  pwEl.innerText = "••••••••";

  // Hapus Akun — hanya Owner (level 1) atau Admin (level 2)
  const dz = document.getElementById("danger-zone-hapus");
  if (userLevel <= 2) {
    dz.style.display = "block";
    populateHapusSelect();
  } else {
    dz.style.display = "none";
  }
}

async function populateHapusSelect() {
  try {
    const me  = localStorage.getItem("user");
    const r   = await authFetch("/anggota");
    const all = await r.json();
    const sel = document.getElementById("hapus-target-select");
    sel.innerHTML = '<option value="">Pilih akun yang akan dihapus</option>';
    all.forEach(m => {
      if (m.username === me) return; // tidak bisa hapus diri sendiri dari sini
      const opt = document.createElement("option");
      opt.value = m.username;
      opt.textContent = m.username + " (" + m.groupName + ")";
      sel.appendChild(opt);
    });
    // Owner level 1 juga bisa hapus akun diri sendiri melalui pilihan lain
  } catch {}
}

function switchProfilTab(tab) {
  const isProfil = tab === "profil";
  document.getElementById("ppanel-profil").classList.toggle("hidden", !isProfil);
  document.getElementById("ppanel-keamanan").classList.toggle("hidden", isProfil);
  document.getElementById("ptab-profil").style.background   = isProfil ? "var(--primary)" : "white";
  document.getElementById("ptab-profil").style.color        = isProfil ? "white" : "var(--muted)";
  document.getElementById("ptab-keamanan").style.background = isProfil ? "white" : "var(--primary)";
  document.getElementById("ptab-keamanan").style.color      = isProfil ? "var(--muted)" : "white";
  // Hentikan kamera wajah saat pindah tab
  if (isProfil) {
    stopCam("video-face-update");
    document.getElementById("profil-face-cam-wrap").classList.add("hidden");
    _profilNewFaceDesc = null;
  }
}

// ── FOTO PROFIL ──────────────────────────────────────────────
function profilOpenCamera() {
  profilHidePhotoMenu();
  document.getElementById("profil-cam-wrap").classList.remove("hidden");
  document.getElementById("profil-preview-wrap").classList.add("hidden");
  startCam("video-profil");
}

// ── POPUP MENU FOTO PROFIL ──────────────────────────────────
function profilShowPhotoMenu() {
  const menu = document.getElementById("profil-photo-menu");
  if (menu) menu.classList.remove("hidden");
}
function profilHidePhotoMenu() {
  const menu = document.getElementById("profil-photo-menu");
  if (menu) menu.classList.add("hidden");
}
function profilPhotoMenuCamera() {
  profilHidePhotoMenu();
  profilOpenCamera();
}

function profilStopCamera() {
  stopCam("video-profil");
  document.getElementById("profil-cam-wrap").classList.add("hidden");
}

function profilTakePhoto() {
  const v = document.getElementById("video-profil");
  const c = document.getElementById("canvas-profil");
  if (!v || !v.videoWidth) return showToast("⚠️ Kamera belum siap", "warning");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  _profilNewPhoto = c.toDataURL("image/jpeg", 0.7);
  profilStopCamera();
  const img = document.getElementById("profil-preview-img");
  img.src = _profilNewPhoto;
  document.getElementById("profil-preview-wrap").classList.remove("hidden");
  showToast("📸 Foto diambil, klik Simpan untuk menyimpan");
}

function profilLoadFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    _profilNewPhoto = e.target.result;
    const img = document.getElementById("profil-preview-img");
    img.src = _profilNewPhoto;
    document.getElementById("profil-preview-wrap").classList.remove("hidden");
    document.getElementById("profil-cam-wrap").classList.add("hidden");
    showToast("🖼 Foto dipilih, klik Simpan untuk menyimpan");
  };
  reader.readAsDataURL(file);
}

async function profilSavePhoto() {
  if (!_profilNewPhoto) return showToast("⚠️ Belum ada foto baru", "warning");
  const me = localStorage.getItem("user");
  try {
    const r = await authFetch(`/profile/${me}/photo`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({photo:_profilNewPhoto}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Foto profil berhasil disimpan!");
      _profilNewPhoto = null;
      document.getElementById("profil-preview-wrap").classList.add("hidden");
      updateHeaderAvatar();
      loadProfil();
    } else showToast("❌ Gagal menyimpan foto", "error");
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

// ── EDIT FIELD ───────────────────────────────────────────────
function profilEditField(field, label) {
  const cur = _profilData ? (_profilData[field] || "") : "";
  uInput({
    title: `Ubah ${label}`,
    placeholder: label,
    value: cur,
    onOk: val => { if (val.trim() !== "") profilSaveField(field, val.trim()); }
  });
}

async function profilEditAgama() {
  const agamas = ["Islam","Kristen","Katolik","Hindu","Buddha","Konghucu"];
  const cur    = _profilData?.agama || "";
  uSelect({
    title: "Pilih Agama",
    options: agamas,
    current: cur,
    onOk: val => profilSaveField("agama", val)
  });
}

async function profilSaveField(field, value) {
  const me = localStorage.getItem("user");
  try {
    const r = await authFetch(`/profile/${me}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({[field]:value}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Berhasil disimpan!");
      loadProfil();
    } else showToast("❌ Gagal menyimpan", "error");
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

// ── GANTI PASSWORD ───────────────────────────────────────────
async function profilChangePassword() {
  const me = localStorage.getItem("user");
  uPassword({
    title: "Ubah Password",
    sub: "Masukkan password baru untuk akun ini",
    onOk: async (newPw) => {
      try {
        const r = await authFetch(`/profile/${me}/password`, {
          method:"PUT", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ newPassword: newPw })
        });
        const d = await r.json();
        if (d.status === "OK") showToast("✅ Password berhasil diubah!");
        else showToast("❌ Gagal mengubah password", "error");
      } catch { showToast("❌ Gagal terhubung ke server", "error"); }
    }
  });
}

// ── PERBARUI DATA WAJAH ──────────────────────────────────────
function profilStartFaceUpdate() {
  document.getElementById("profil-face-cam-wrap").classList.remove("hidden");
  document.getElementById("face-update-status").innerText = "Hadapkan wajah ke kamera...";
  _profilNewFaceDesc = null;
  startCam("video-face-update");
  document.getElementById("btn-start-face").innerText = "🔄 Scanning...";
  // Mulai deteksi otomatis
  profilScanFace(0);
}

async function profilScanFace(attempt) {
  if (attempt >= 15) {
    document.getElementById("face-update-status").innerText = "❌ Wajah tidak terdeteksi. Coba lagi.";
    document.getElementById("btn-start-face").innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Perbarui Data Wajah`;
    document.getElementById("btn-save-face").classList.add("hidden");
    return;
  }
  const v = document.getElementById("video-face-update");
  if (!v || !v.srcObject) return;
  document.getElementById("face-update-status").innerText = `Mendeteksi wajah... (${attempt+1}/15)`;
  if (!faceModelsLoaded) {
    document.getElementById("face-update-status").innerText = "⚠️ Model wajah belum dimuat";
    return;
  }
  const desc = await getFaceDescriptor(v);
  if (desc) {
    _profilNewFaceDesc = desc;
    document.getElementById("face-update-status").innerText = "✅ Wajah terdeteksi! Klik Simpan.";
    document.getElementById("btn-start-face").innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Perbarui Data Wajah`;
    document.getElementById("btn-save-face").classList.remove("hidden");
    stopCam("video-face-update");
  } else {
    setTimeout(() => profilScanFace(attempt + 1), 700);
  }
}

async function profilSaveFace() {
  if (!_profilNewFaceDesc) return showToast("⚠️ Belum ada data wajah baru. Klik 'Perbarui Data Wajah' dulu.", "warning");
  const me = localStorage.getItem("user");
  try {
    const r = await authFetch(`/profile/${me}/face`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({faceDescriptor:Array.from(_profilNewFaceDesc)}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Data wajah berhasil diperbarui!");
      _profilNewFaceDesc = null;
      document.getElementById("profil-face-cam-wrap").classList.add("hidden");
      document.getElementById("face-update-status").innerText = "Hadapkan wajah ke kamera";
      document.getElementById("btn-save-face").classList.add("hidden");
    } else showToast("❌ Gagal menyimpan data wajah", "error");
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

// ── HAPUS AKUN (Owner/Admin) ─────────────────────────────────
async function profilHapusAkun() {
  const target = document.getElementById("hapus-target-select")?.value;
  if (!target) return showToast("⚠️ Pilih akun yang akan dihapus!", "warning");
  uConfirm({
    icon: "🗑️",
    title: "Hapus Akun",
    msg: `Hapus akun <b>${target}</b>?<br>Tindakan ini <b>tidak bisa dibatalkan</b>.<br><span style="color:#27ae60;">Data absensi tetap tersimpan.</span>`,
    btnOk: "Hapus Permanen", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await authFetch(`/anggota/${target}`, {method:"DELETE"});
        if ((await r.json()).status === "OK") {
          showToast(`🗑 Akun "${target}" berhasil dihapus`);
          populateHapusSelect();
        } else showToast("❌ Gagal menghapus", "error");
      } catch { showToast("❌ Gagal terhubung ke server", "error"); }
    }
  });
}

// ============================================================
// TRACKING — ping lokasi & tampilan peta
// ============================================================
let _trackPingInterval = null;
let _trkLiveMap        = null;
let _trkRiwayatMap     = null;
let _trkLiveMarkers    = [];
let _trkRiwayatLayer   = null;
let _trkSelectedUser   = null; // untuk modal detail → lihat rute

// --- Ping lokasi ke server setiap 30 detik saat bekerja ---
async function sendTrackPing() {
  const user = localStorage.getItem("user");
  if (!user) return;
  try {
    // Pakai maximumAge 25 detik agar selaras dengan interval 30 detik
    // Jika cache terlalu lama, paksa ambil baru
    const pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("no geolocation"));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy || 0 }),
        err => reject(err),
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 25000 }
      );
    });
    if (!pos.lat && !pos.lng) return;
    await authFetch("/tracking/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy })
    });
  } catch {} // silent fail — tracking bukan fitur kritis
}

function startTrackingPing() {
  if (_trackPingInterval) return; // sudah berjalan
  sendTrackPing(); // kirim segera
  _trackPingInterval = setInterval(sendTrackPing, 30000); // lalu tiap 30 detik
}

function stopTrackingPing() {
  if (_trackPingInterval) { clearInterval(_trackPingInterval); _trackPingInterval = null; }
}

// --- Tab switch ---
function switchTrackTab(tab) {
  const isLive = tab === "live";
  document.getElementById("trk-panel-live").style.display    = isLive ? "block" : "none";
  document.getElementById("trk-panel-riwayat").style.display = isLive ? "none"  : "block";
  document.getElementById("trk-tab-live").style.background    = isLive ? "var(--primary)" : "white";
  document.getElementById("trk-tab-live").style.color         = isLive ? "white" : "var(--muted)";
  document.getElementById("trk-tab-riwayat").style.background = isLive ? "white" : "var(--primary)";
  document.getElementById("trk-tab-riwayat").style.color      = isLive ? "var(--muted)" : "white";
  if (isLive) refreshLiveTracking();
  else        initRiwayatMap();
}

// --- Load / inisialisasi halaman tracking ---
async function loadTracking() {
  // Set tanggal default riwayat ke hari ini
  const dateEl = document.getElementById("trk-pilih-date");
  if (dateEl && !dateEl.value) dateEl.value = todayLocalStr();
  // Load daftar anggota untuk dropdown riwayat
  try {
    if (!_anggotaAll.length) {
      const r = await authFetch("/anggota"); _anggotaAll = await r.json();
    }
    const sel = document.getElementById("trk-pilih-user");
    const sortedAnggota = [..._anggotaAll].sort((a, b) => (a.namaLengkap || a.username || '').localeCompare(b.namaLengkap || b.username || '', 'id'));
    sel.innerHTML = '<option value="">Pilih Anggota</option>' +
      sortedAnggota.map(a => `<option value="${a.username}">${a.namaLengkap || a.username}</option>`).join('');
  } catch {}
  refreshLiveTracking();
}

// --- Live map ---
async function refreshLiveTracking() {
  try {
    const r    = await authFetch("/tracking/live/all");
    const list = await r.json();
    renderLiveList(list);
    renderLiveMap(list);
  } catch { document.getElementById("trk-live-list").innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Gagal memuat data</p>'; }
}

const _statusColor = { IN: "#27ae60", BREAK: "#f39c12", DONE: "#4f8ef7", OUT: "#bdc3c7" };
const _statusLabel = { IN: "Bekerja", BREAK: "Istirahat", DONE: "Selesai", OUT: "Belum Absen" };

function renderLiveList(list) {
  const el = document.getElementById("trk-live-list");
  if (!list.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada anggota</p>'; return; }

  const sortNama = (a, b) => (a.namaLengkap || a.username || '').localeCompare(b.namaLengkap || b.username || '', 'id');

  // Pisah: aktif (IN/BREAK) dan tidak aktif (DONE/OUT)
  const aktif    = [...list].filter(a => a.status === "IN" || a.status === "BREAK").sort(sortNama);
  const tidakAktif = [...list].filter(a => a.status !== "IN" && a.status !== "BREAK").sort(sortNama);

  const renderItem = a => {
    const color    = _statusColor[a.status] || "#bdc3c7";
    const label    = _statusLabel[a.status] || a.status;
    const lastTime = a.last ? new Date(a.last.time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false}) : "—";
    const hasLoc   = a.last && a.last.lat;
    return `
      <div onclick="openTrkDetail('${a.username}')"
        style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f0f2f5;cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='#f5f8ff'" onmouseout="this.style.background='transparent'">
        <div style="width:40px;height:40px;border-radius:50%;background:${color};color:white;
          display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;">
          ${(a.namaLengkap||a.username).charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.namaLengkap||a.username}</div>
          <div style="font-size:11px;color:var(--muted);">${a.jabatan||""} ${a.divisi?'· '+a.divisi:''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:12px;font-weight:700;color:${color};">● ${label}</div>
          <div style="font-size:11px;color:var(--muted);">${hasLoc ? '📍 ' + lastTime : 'Tidak ada lokasi'}</div>
        </div>
      </div>`;
  };

  const renderSection = (title, items, badgeColor) => {
    if (!items.length) return '';
    return `
      <div style="padding:8px 16px 4px;background:#f8f9ff;border-bottom:1px solid #e8ecf0;
        display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:1;">
        <span style="font-size:11px;font-weight:800;color:${badgeColor};text-transform:uppercase;letter-spacing:.5px;">${title}</span>
        <span style="font-size:11px;background:${badgeColor};color:white;border-radius:50px;
          padding:1px 8px;font-weight:700;">${items.length}</span>
      </div>
      ${items.map(renderItem).join('')}`;
  };

  el.innerHTML =
    renderSection("🟢 Sedang Bekerja", aktif, "#27ae60") +
    renderSection("⚪ Tidak Aktif", tidakAktif, "#95a5a6");
}

function renderLiveMap(list) {
  // Init peta jika belum
  if (!_trkLiveMap) {
    _trkLiveMap = L.map("trk-live-map", { zoomControl: true });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles © Esri", maxZoom: 19
    }).addTo(_trkLiveMap);
  }
  // Hapus marker lama
  _trkLiveMarkers.forEach(m => m.remove());
  _trkLiveMarkers = [];

  const bounds = [];
  list.forEach(a => {
    if (!a.last || !a.last.lat) return;
    const color = _statusColor[a.status] || "#bdc3c7";
    const icon  = L.divIcon({
      className: "",
      html: `<div style="width:32px;height:32px;border-radius:50%;background:${color};
        border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);
        display:flex;align-items:center;justify-content:center;
        color:white;font-weight:700;font-size:13px;">
        ${(a.namaLengkap||a.username).charAt(0).toUpperCase()}
      </div>`,
      iconSize: [32, 32], iconAnchor: [16, 16]
    });
    const marker = L.marker([a.last.lat, a.last.lng], { icon })
      .addTo(_trkLiveMap)
      .bindPopup(`<b>${a.namaLengkap||a.username}</b><br>${_statusLabel[a.status]||a.status}<br>
        ${new Date(a.last.time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false})}`);
    marker.on("click", () => openTrkDetail(a.username));
    _trkLiveMarkers.push(marker);
    bounds.push([a.last.lat, a.last.lng]);
  });

  if (bounds.length === 1) {
    _trkLiveMap.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    _trkLiveMap.fitBounds(bounds, { padding: [30, 30] });
  } else {
    // Default ke Bali jika tidak ada lokasi
    _trkLiveMap.setView([-8.65, 115.22], 12);
  }
  setTimeout(() => _trkLiveMap.invalidateSize(), 200);
}

// --- Detail popup dari live list ---
let _trkDetailUsername = "";
async function openTrkDetail(username) {
  _trkDetailUsername = username;
  const a = (_anggotaAll.length ? _anggotaAll : []).find(x => x.username === username);
  const nama = a ? (a.namaLengkap || username) : username;
  document.getElementById("trkd-nama").textContent = "👤 " + nama;
  // Ambil data live
  try {
    const r    = await authFetch("/tracking/live/all");
    const list = await r.json();
    const info = list.find(x => x.username === username);
    if (info) {
      const color = _statusColor[info.status] || "#bdc3c7";
      const label = _statusLabel[info.status] || info.status;
      const lastTime = info.last ? new Date(info.last.time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false}) : "—";
      const coords   = info.last ? `${info.last.lat.toFixed(5)}, ${info.last.lng.toFixed(5)}` : "Tidak tersedia";
      document.getElementById("trkd-body").innerHTML =
        `<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;">
          <span style="color:var(--muted);">Status</span>
          <span style="color:${color};font-weight:700;">● ${label}</span>
          <span style="color:var(--muted);">Jabatan</span>
          <span>${info.jabatan||"—"}</span>
          <span style="color:var(--muted);">Divisi</span>
          <span>${Array.isArray(info.divisi) ? info.divisi.join(", ") : (info.divisi||"—")}</span>
          <span style="color:var(--muted);">Lokasi terakhir</span>
          <span>${coords}</span>
          <span style="color:var(--muted);">Waktu</span>
          <span>${lastTime}</span>
          <span style="color:var(--muted);">Total titik</span>
          <span>${info.totalPoints} titik hari ini</span>
        </div>`;
    }
  } catch {}
  document.getElementById("trk-modal-detail").style.display = "flex";
}

function viewRouteFromModal() {
  document.getElementById("trk-modal-detail").style.display = "none";
  // Pindah ke tab riwayat, pilih user ini
  switchTrackTab("riwayat");
  const sel  = document.getElementById("trk-pilih-user");
  const date = document.getElementById("trk-pilih-date");
  if (sel) sel.value = _trkDetailUsername;
  if (!date.value) date.value = todayLocalStr();
  loadRiwayatRute();
}

// --- Riwayat rute ---
function initRiwayatMap() {
  if (_trkRiwayatMap) { setTimeout(() => _trkRiwayatMap.invalidateSize(), 200); return; }
  _trkRiwayatMap = L.map("trk-riwayat-map", { zoomControl: true });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles © Esri", maxZoom: 19
  }).addTo(_trkRiwayatMap);
  _trkRiwayatMap.setView([-8.65, 115.22], 12);
  setTimeout(() => _trkRiwayatMap.invalidateSize(), 200);
}

async function loadRiwayatRute() {
  const user = document.getElementById("trk-pilih-user").value;
  const date = document.getElementById("trk-pilih-date").value;
  const info = document.getElementById("trk-riwayat-info");
  const tl   = document.getElementById("trk-timeline");

  if (!user || !date) { info.textContent = "Pilih anggota dan tanggal untuk melihat rute"; return; }

  initRiwayatMap();
  info.textContent = "Memuat rute...";
  tl.innerHTML     = '<p style="color:var(--muted);text-align:center;padding:16px;">Memuat...</p>';

  try {
    const r   = await authFetch(`/tracking/${user}?date=${date}`);
    const d   = await r.json();
    const pts = d.points || [];

    if (!pts.length) {
      info.textContent = "Tidak ada data lokasi untuk tanggal ini";
      tl.innerHTML     = '<p style="color:var(--muted);text-align:center;padding:16px;">Belum ada titik rute</p>';
      return;
    }

    // Hapus layer lama
    if (_trkRiwayatLayer) { _trkRiwayatLayer.remove(); _trkRiwayatLayer = null; }

    const latlngs = pts.map(p => [p.lat, p.lng]);

    // Garis rute
    const polyline = L.polyline(latlngs, { color: "#4f8ef7", weight: 4, opacity: 0.8 }).addTo(_trkRiwayatMap);

    // Marker start
    L.marker(latlngs[0], {
      icon: L.divIcon({ className:"", html:`<div style="background:#27ae60;color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);">▶</div>`, iconSize:[26,26], iconAnchor:[13,13] })
    }).addTo(_trkRiwayatMap).bindPopup(`Mulai: ${new Date(pts[0].time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false})}`);

    // Marker end
    if (latlngs.length > 1) {
      L.marker(latlngs[latlngs.length-1], {
        icon: L.divIcon({ className:"", html:`<div style="background:#e74c3c;color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);">■</div>`, iconSize:[26,26], iconAnchor:[13,13] })
      }).addTo(_trkRiwayatMap).bindPopup(`Terakhir: ${new Date(pts[pts.length-1].time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false})}`);
    }

    _trkRiwayatLayer = polyline;
    _trkRiwayatMap.fitBounds(polyline.getBounds(), { padding: [30, 30] });
    setTimeout(() => _trkRiwayatMap.invalidateSize(), 200);

    // Info ringkasan
    const durMenit = Math.round((new Date(pts[pts.length-1].time) - new Date(pts[0].time)) / 60000);
    info.innerHTML = `<b>${pts.length} titik lokasi</b> · Durasi: <b>${durMenit} menit</b> · 
      ${new Date(pts[0].time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false})} – ${new Date(pts[pts.length-1].time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false})}`;

    // Timeline
    // Ambil setiap N titik agar tidak terlalu panjang (maks 20 entri)
    const step = Math.max(1, Math.floor(pts.length / 20));
    const shown = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    tl.innerHTML = shown.map((p, i) => {
      const t = new Date(p.time).toLocaleTimeString("id-ID", {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
      const isFirst = i === 0, isLast = i === shown.length - 1;
      const dot = isFirst ? "🟢" : isLast ? "🔴" : "🔵";
      return `<div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid #f8f8f8;">
        <span style="font-size:15px;flex-shrink:0;">${dot}</span>
        <div>
          <div style="font-size:13px;font-weight:600;">${t}</div>
          <div style="font-size:11px;color:var(--muted);">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
        </div>
      </div>`;
    }).join('');

  } catch { info.textContent = "Gagal memuat data rute"; }
}

// ============================================================
// INIT
// ============================================================
window.onload = async function () {
  await loadFaceModels();
  checkLoginStatus();
};

// ================================================================
// KUOTA CUTI — client-side logic
// ================================================================

let _kuotaData = []; // cache hasil load
let _customKebijakanKuota = []; // cache kebijakan custom jenis kuota

async function loadKuotaCuti() {
  // Isi dropdown tahun (5 tahun ke belakang + tahun ini)
  const tahunEl = document.getElementById("kuota-filter-tahun");
  if (tahunEl && !tahunEl.options.length) {
    const now = new Date().getFullYear();
    for (let y = now; y >= now - 4; y--) {
      const o = document.createElement("option");
      o.value = y; o.textContent = "Tahun " + y;
      if (y === now) o.selected = true;
      tahunEl.appendChild(o);
    }
  }

  const tahun = (tahunEl && tahunEl.value) || new Date().getFullYear();
  const listEl = document.getElementById("kuota-cuti-list");
  if (listEl) listEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Memuat...</p>`;

  // Kuota cuti semua anggota hanya untuk admin/owner
  if (userLevel > 2) {
    if (listEl) listEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">⛔ Hanya Owner/Admin yang dapat melihat kuota cuti semua anggota</p>`;
    return;
  }
  try {
    const [r, rk] = await Promise.all([
      authFetch(`/kuota-cuti?tahun=${tahun}`),
      authFetch("/kebijakan-cuti")
    ]);
    _kuotaData = await r.json();
    const allKebijakan = await rk.json();
    // Filter kebijakan custom (bukan default) dengan jenis kuota
    _customKebijakanKuota = allKebijakan.filter(k => !k._default && k.jenis === "kuota");
    renderKuotaList();
    renderCustomKuotaSection();
  } catch {
    if (listEl) listEl.innerHTML = `<p style="color:var(--danger);text-align:center;padding:24px;">❌ Gagal memuat data</p>`;
  }
}

// Render section kuota kebijakan custom (nama + input kuota + simpan)
function renderCustomKuotaSection() {
  const section = document.getElementById("custom-kuota-section");
  const listEl  = document.getElementById("custom-kuota-list");
  if (!section || !listEl) return;

  if (!_customKebijakanKuota.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  listEl.innerHTML = _customKebijakanKuota.map(k => {
    const satuanLabel = k.satuanDurasi === "jam" ? "jam" : "hari";
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:12px 16px;border-bottom:1px solid #f5f5f5;gap:10px;flex-wrap:wrap;">
      <div style="flex:1;">
        <div style="font-weight:700;font-size:13px;color:var(--text);">${k.nama}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">
          Satuan: <b>${satuanLabel}</b>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <input type="number" min="0" placeholder="0" id="custom-kuota-input-${k.id}"
          style="width:70px;padding:7px 10px;border:1.5px solid #e8eaf0;border-radius:8px;
                 font-size:13px;font-weight:700;text-align:center;outline:none;"
          onfocus="this.style.borderColor='#27ae60'" onblur="this.style.borderColor='#e8eaf0'">
        <span style="font-size:12px;color:var(--muted);">${satuanLabel}</span>
        <button onclick="saveCustomKuota('${k.id}', '${k.nama}')"
          style="padding:7px 14px;background:linear-gradient(135deg,#27ae60,#2ecc71);color:white;
                 border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
          💾 Simpan
        </button>
      </div>
    </div>`;
  }).join("");
}

async function saveCustomKuota(kebijakanId, kebijakanNama) {
  const inputEl = document.getElementById(`custom-kuota-input-${kebijakanId}`);
  const kuota   = parseFloat(inputEl?.value);
  if (!kuota || kuota < 0) return showToast("⚠️ Isi jumlah kuota yang valid!", "warning");
  const tahunEl = document.getElementById("kuota-filter-tahun");
  const tahun   = (tahunEl && tahunEl.value) || new Date().getFullYear();
  try {
    const r = await authFetch("/kuota-cuti/set-custom", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kebijakanId, kebijakanNama, kuota, tahun })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast(`✅ Kuota "${kebijakanNama}" berhasil disimpan!`);
      inputEl.value = "";
      loadKuotaCuti();
    } else {
      showToast("❌ " + (d.msg || "Gagal menyimpan kuota"), "error");
    }
  } catch { showToast("❌ Gagal menyimpan kuota", "error"); }
}

function renderKuotaList() {
  const listEl = document.getElementById("kuota-cuti-list");
  if (!listEl) return;

  const q = (document.getElementById("kuota-search")?.value || "").toLowerCase();
  const filtered = _kuotaData
    .filter(d => (d.nama || d.username).toLowerCase().includes(q) || d.username.toLowerCase().includes(q))
    .sort((a, b) => (a.nama || a.username || '').localeCompare(b.nama || b.username || '', 'id'));

  if (!filtered.length) {
    listEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Tidak ada data anggota</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(d => {
    const tSisa  = d.tahunan.total - d.tahunan.terpakai;
    const tPct   = Math.round((d.tahunan.terpakai / d.tahunan.total) * 100);
    const saldoOT  = d.overtime._saldo   || { hari: 0, sisaJam: 0, totalJam: 0 };
    const saldoTL  = d.tukarLibur?._saldo || { hari: 0, sisaJam: 0, totalJam: 0 };
    const otHari    = saldoOT.hari;
    const otSisaJam = saldoOT.sisaJam;
    const tlHari    = saldoTL.hari;
    const tlSisaJam = saldoTL.sisaJam;

    // Warna sisa cuti tahunan
    const sisaColor = tSisa <= 3 ? "#e53935" : tSisa <= 6 ? "#f57f17" : "#2e7d32";

    return `
    <div onclick="openKuotaDetailModal('${d.username}')"
      style="display:flex;align-items:center;justify-content:space-between;
             padding:13px 16px;border-bottom:1px solid #f5f5f5;cursor:pointer;
             transition:background .15s;gap:10px;"
      onmouseenter="this.style.background='#fafbff'" onmouseleave="this.style.background=''">
      <!-- Avatar + nama -->
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#1a237e,#4f8ef7);
                    display:flex;align-items:center;justify-content:center;color:white;font-weight:800;
                    font-size:14px;flex-shrink:0;">
          ${(d.nama||d.username).charAt(0).toUpperCase()}
        </div>
        <div style="min-width:0;">
          <div style="font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.nama || d.username}</div>
          <div style="font-size:11px;color:var(--muted);">@${d.username} · ${d.divisi||'—'}</div>
        </div>
      </div>

      <!-- Cuti Tahunan chip -->
      <div style="text-align:center;flex:0 0 auto;">
        <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:2px;">📅 Tahunan</div>
        <div style="display:inline-flex;align-items:center;gap:3px;">
          <span style="font-size:18px;font-weight:900;color:${sisaColor};">${tSisa}</span>
          <span style="font-size:10px;color:var(--muted);">/ ${d.tahunan.total}</span>
        </div>
        <div style="background:#e8ecf0;border-radius:50px;height:4px;width:52px;overflow:hidden;margin-top:3px;">
          <div style="height:100%;border-radius:50px;width:${tPct}%;background:${sisaColor};transition:width .3s;"></div>
        </div>
      </div>

      <!-- Overtime chip -->
      <div style="text-align:center;flex:0 0 auto;">
        <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:2px;">⏱️ Overtime</div>
        <div style="display:inline-flex;align-items:baseline;gap:2px;">
          <span style="font-size:18px;font-weight:900;color:#1565c0;">${fmtJamOT((saldoOT.totalJam != null ? saldoOT.totalJam : (saldoOT.hari * 5 + saldoOT.sisaJam)) || 0)}</span>
          <span style="font-size:10px;color:var(--muted);font-weight:400;"></span>
        </div>
      </div>
      <!-- Tukar Libur chip -->
      <div style="text-align:center;flex:0 0 auto;">
        <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:2px;">🔄 Tukar Libur</div>
        <div style="display:inline-flex;align-items:baseline;gap:2px;">
          <span style="font-size:18px;font-weight:900;color:#e65100;">${tlHari}</span>
          <span style="font-size:10px;color:var(--muted);font-weight:400;">hari</span>
          ${tlSisaJam > 0 ? `<span style="font-size:11px;color:#ffa726;font-weight:700;margin-left:2px;">+${tlSisaJam}j</span>` : ""}
        </div>
      </div>

      <span style="color:#ddd;font-size:18px;flex-shrink:0;">›</span>
    </div>`;
  }).join("");
}

let _kuotaModalUser = null;

function openKuotaDetailModal(username) {
  _kuotaModalUser = username;
  const d = _kuotaData.find(x => x.username === username);
  if (!d) return;

  document.getElementById("mkd-nama").textContent   = d.nama || d.username;
  document.getElementById("mkd-divisi").textContent = `@${d.username}` + (d.divisi && d.divisi !== "-" ? ` · ${d.divisi}` : "");

  // Tahunan
  const sisa = d.tahunan.total - d.tahunan.terpakai;
  const pct  = Math.round((d.tahunan.terpakai / d.tahunan.total) * 100);
  document.getElementById("mkd-tahunan-total").textContent = d.tahunan.total;
  document.getElementById("mkd-tahunan-pakai").textContent = d.tahunan.terpakai;
  document.getElementById("mkd-tahunan-sisa").textContent  = sisa;
  document.getElementById("mkd-tahunan-bar").style.width   = pct + "%";

  // Tukar Libur — tampilkan dalam HARI + sisa jam
  const saldoTLModal = d.overtime._saldo || { hari: 0, sisaJam: 0, totalJam: 0 };
  const mkdJamEl  = document.getElementById("mkd-ot-jam");
  const mkdHariEl = document.getElementById("mkd-ot-hari");
  if (mkdJamEl)  mkdJamEl.textContent  = fmtJamOT(saldoTLModal.sisaJam) + " sisa";
  if (mkdHariEl) mkdHariEl.textContent = saldoTLModal.hari;
  document.getElementById("mkd-ot-diambil").textContent = d.overtime.hariDiambil || 0;

  const overlay = document.getElementById("modal-kuota-detail-overlay");
  overlay.style.display = "flex";
  overlay.onclick = e => { if (e.target === overlay) closeKuotaDetailModal(); };
}

function closeKuotaDetailModal() {
  document.getElementById("modal-kuota-detail-overlay").style.display = "none";
  _kuotaModalUser = null;
}

async function hitungOvertimeSemua() {
  if (userLevel > 2) { showToast("⛔ Akses ditolak", "error"); return; }
  const tahunEl = document.getElementById("kuota-filter-tahun");
  const tahun   = tahunEl ? tahunEl.value : new Date().getFullYear();
  showToast("🔄 Menghitung overtime semua anggota...", "warning");
  try {
    const r = await authFetch(`/kuota-cuti/hitung-overtime-semua?tahun=${tahun}`, { method: "POST" });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Overtime berhasil dihitung ulang!");
      loadKuotaCuti();
    }
  } catch { showToast("❌ Gagal menghitung overtime", "error"); }
}

// ============================================================
// SEGMEN CUTI — Tab, Daftar Cuti, Saldo Cuti
// ============================================================

let _cutiFilter = "semua";   // filter aktif: semua|hari|minggu|bulan|tahun
let _cutiTab    = "daftar";  // tab aktif: daftar|saldo
let _kebijakanList = [];     // cache kebijakan cuti
let _kuotaSaya  = null;      // cache kuota user saat ini

// --- Navigasi tab ---
function switchCutiTab(tab) {
  _cutiTab = tab;
  const isDaftar = tab === "daftar";
  document.getElementById("cuti-panel-daftar").style.display = isDaftar ? "" : "none";
  document.getElementById("cuti-panel-saldo").style.display  = isDaftar ? "none" : "";

  const tDaftar = document.getElementById("cuti-tab-daftar");
  const tSaldo  = document.getElementById("cuti-tab-saldo");
  tDaftar.style.background = isDaftar ? "var(--primary)" : "white";
  tDaftar.style.color      = isDaftar ? "white" : "var(--muted)";
  tSaldo.style.background  = isDaftar ? "white" : "var(--primary)";
  tSaldo.style.color       = isDaftar ? "var(--muted)" : "white";

  if (isDaftar) loadDaftarCuti();
  else          loadSaldoCuti();
}

// --- Filter waktu ---
function setCutiFilter(f) {
  _cutiFilter = f;
  // Sync dropdown value
  const sel = document.getElementById("cuti-filter-select");
  if (sel) sel.value = f;
  loadDaftarCuti();
}

// Load daftar pengajuan cuti
async function loadDaftarCuti() {
  const el = document.getElementById("cuti-daftar-list");
  if (!el) return;
  el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Memuat...</p>`;
  const user = localStorage.getItem("user") || "";
  try {
    const r = await authFetch(`/pengajuan-cuti?filter=${_cutiFilter}`);
    const list = await r.json();
    renderDaftarCuti(list, user);
  } catch {
    el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:28px;">Gagal memuat data</p>`;
  }
}

function renderDaftarCuti(list, currentUser) {
  const el = document.getElementById("cuti-daftar-list");
  if (!list || list.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:32px;">
      <div style="font-size:36px;margin-bottom:8px;">🌴</div>
      <div style="color:var(--muted);font-size:14px;">Belum ada pengajuan cuti</div>
    </div>`;
    return;
  }

  const myGroup = userGroup || "";
  const myLevel = userLevel || 99;

  el.innerHTML = list.map(p => {
    const statusColor = {
      menunggu: "#f39c12", disetujui: "#27ae60", ditolak: "#e74c3c", dibatalkan: "#95a5a6"
    }[p.status] || "#95a5a6";
    const statusLabel = {
      menunggu: "⏳ Menunggu", disetujui: "✅ Disetujui", ditolak: "❌ Ditolak", dibatalkan: "🚫 Dibatalkan"
    }[p.status] || p.status;

    const tglInfo = p.satuanDurasi === "jam"
      ? `${p.jamMulai || "--"} – ${p.jamAkhir || "--"}`
      : `${fmtTanggal(p.tanggalMulai)}${p.tanggalAkhir && p.tanggalAkhir !== p.tanggalMulai ? " – " + fmtTanggal(p.tanggalAkhir) : ""}`;

    const durInfo = `${p.durasi} ${p.satuanDurasi}`;

    // Tombol berdasarkan hak akses
    let btns = "";
    const isOwner   = myGroup === "owner";
    const isAdmin   = myGroup === "admin";
    const isManager = myGroup === "manager";
    const targetGroup = p.groupTarget || "anggota";
    const isMine    = p.username === currentUser;

    // Dapat approve/reject?
    let canApproveReject = false;
    if ((isOwner || isAdmin) && p.username !== currentUser) canApproveReject = true;
    if (isManager && (targetGroup === "anggota" || targetGroup === "koordinator")) canApproveReject = true;

    if (p.status === "menunggu") {
      if (canApproveReject) {
        btns += `<button onclick="doApproveCuti('${p.id}')"
          style="padding:6px 14px;border:none;border-radius:8px;background:#e8f5e9;color:#27ae60;
            font-weight:700;font-size:12px;cursor:pointer;">✅ Setujui</button>`;
        btns += `<button onclick="openRejectCutiModal('${p.id}')"
          style="padding:6px 14px;border:none;border-radius:8px;background:#fce4ec;color:#e74c3c;
            font-weight:700;font-size:12px;cursor:pointer;margin-left:6px;">❌ Tolak</button>`;
      }
      if (isMine) {
        btns += `<button onclick="doCancelCuti('${p.id}')"
          style="padding:6px 14px;border:none;border-radius:8px;background:#f0f2f5;color:#95a5a6;
            font-weight:700;font-size:12px;cursor:pointer;margin-left:6px;">🚫 Batalkan</button>`;
      }
    } else if (p.status === "disetujui" && isMine) {
      btns += `<button onclick="doCancelCuti('${p.id}')"
        style="padding:6px 14px;border:none;border-radius:8px;background:#f0f2f5;color:#95a5a6;
          font-weight:700;font-size:12px;cursor:pointer;">🚫 Batalkan</button>`;
    }

    return `<div style="padding:14px 16px;border-bottom:1px solid #f0f2f5;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${(_GROUP_LABEL[(p.groupTarget||'').toLowerCase()]||{color:'#546e7a'}).color};
              display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;flex-shrink:0;">
              ${(p.namaLengkap || p.username).charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:${(_GROUP_LABEL[(p.groupTarget||'').toLowerCase()]||{color:'#2c3e50'}).color};">${p.namaLengkap || p.username}</div>
              <div style="font-size:11px;font-weight:600;color:${(_GROUP_LABEL[(p.groupTarget||'').toLowerCase()]||{color:'#546e7a'}).color};">${_jabatanInfo(p.groupTarget, p.jabatan).label}</div>
            </div>
          </div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;">
            🌴 ${p.kebijakanNama}
          </div>
          <div style="font-size:12px;color:var(--muted);">
            📅 ${tglInfo} &nbsp;|&nbsp; ⏱ ${durInfo}
          </div>
          ${p.rejectedReason ? `<div style="font-size:11px;color:#e74c3c;margin-top:3px;">Alasan: ${p.rejectedReason}</div>` : ""}
        </div>
        <div style="flex-shrink:0;text-align:right;">
          <span style="display:inline-block;padding:4px 12px;border-radius:50px;font-size:11px;font-weight:700;
            background:${statusColor}20;color:${statusColor};">${statusLabel}</span>
          <div style="font-size:10px;color:#b2bec3;margin-top:4px;">${fmtWaktuSingkat(p.createdAt)}</div>
        </div>
      </div>
      ${btns ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">${btns}</div>` : ""}
    </div>`;
  }).join("");
}

function fmtTanggal(d) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  const days = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${days[dt.getDay()]}, ${dt.getDate()} ${months[dt.getMonth()]}`;
}

function fmtWaktuSingkat(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000)    return "Baru saja";
  if (diff < 3600000)  return Math.floor(diff/60000) + " mnt lalu";
  if (diff < 86400000) return Math.floor(diff/3600000) + " jam lalu";
  return fmtTanggal(iso.split("T")[0]);
}

// --- Approve ---
async function doApproveCuti(id) {
  const user = localStorage.getItem("user") || "";
  try {
    const r = await authFetch(`/pengajuan-cuti/${id}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approver: user })
    });
    const d = await r.json();
    if (d.status === "OK") { showToast("✅ Cuti berhasil disetujui!"); loadDaftarCuti(); }
    else showToast(d.msg || "Gagal menyetujui", "error");
  } catch { showToast("❌ Gagal", "error"); }
}

// --- Reject modal ---
function openRejectCutiModal(id) {
  document.getElementById("reject-target-id").value = id;
  document.getElementById("reject-alasan").value = "";
  const m = document.getElementById("modal-reject-cuti");
  m.style.display = "flex";
}
function closeRejectCutiModal() {
  document.getElementById("modal-reject-cuti").style.display = "none";
}
async function doRejectCuti() {
  const id     = document.getElementById("reject-target-id").value;
  const reason = document.getElementById("reject-alasan").value.trim();
  const user   = localStorage.getItem("user") || "";
  try {
    const r = await authFetch(`/pengajuan-cuti/${id}/reject`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approver: user, reason })
    });
    const d = await r.json();
    if (d.status === "OK") { showToast("❌ Cuti berhasil ditolak"); closeRejectCutiModal(); loadDaftarCuti(); }
    else showToast(d.msg || "Gagal menolak", "error");
  } catch { showToast("❌ Gagal", "error"); }
}

// --- Cancel ---
async function doCancelCuti(id) {
  const user = localStorage.getItem("user") || "";
  if (!confirm("Batalkan pengajuan cuti ini? Saldo cuti akan dikembalikan.")) return;
  try {
    const r = await authFetch(`/pengajuan-cuti/${id}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user })
    });
    const d = await r.json();
    if (d.status === "OK") { showToast("🚫 Pengajuan berhasil dibatalkan"); loadDaftarCuti(); }
    else showToast(d.msg || "Gagal membatalkan", "error");
  } catch { showToast("❌ Gagal", "error"); }
}

// --- Saldo Cuti ---
async function loadSaldoCuti() {
  const el = document.getElementById("cuti-saldo-content");
  if (!el) return;
  const user  = localStorage.getItem("user") || "";
  const tahun = new Date().getFullYear();
  try {
    const r = await authFetch(`/kuota-cuti/${user}?tahun=${tahun}`);
    const k = await r.json();
    renderSaldoCuti(k, user);
  } catch {
    el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:28px;">Gagal memuat saldo</p>`;
  }
}

function renderSaldoCuti(k, user) {
  const el = document.getElementById("cuti-saldo-content");
  if (!el) return;

  const tahunanSisa  = k.tahunan.total - k.tahunan.terpakai;
  const tahunanPct   = k.tahunan.total > 0 ? Math.round((k.tahunan.terpakai / k.tahunan.total) * 100) : 0;
  // Overtime — satuan JAM (bukan hari)
  const saldoOTCard  = k.overtime._saldo || { hari: 0, sisaJam: 0, totalJam: 0 };
  const otTotalJam   = parseFloat(((k.overtime.jamTL_reguler || 0) + (k.overtime.jamCarryOver || 0)).toFixed(2));
  const otTerpakai   = parseFloat((k.overtime.jamTerpakai || 0).toFixed(2));
  const otSisaJam    = parseFloat((saldoOTCard.totalJam || 0).toFixed(2));  // dari server, sudah akurat
  const otPct        = otTotalJam > 0 ? Math.min(100, Math.round((otTerpakai / otTotalJam) * 100)) : 0;

  // Tukar Libur — satuan HARI (konversi 5 jam = 1 hari, dari server)
  const tl           = k.tukarLibur || {};
  const saldoTLCard  = tl._saldo || { hari: 0, sisaJam: 0, totalJam: 0 };
  const tlTotalMasuk = parseFloat(((tl.jamAkumulasi || 0) + (tl.jamCarryOver || 0)).toFixed(2));
  const tlTotalHari  = Math.floor(tlTotalMasuk / 5);   // 5 jam = 1 hari
  const tlDiambil    = tl.hariDiambil || 0;
  const tlSisaHari   = saldoTLCard.hari;               // dari server, sudah akurat
  const tlSisaJam    = saldoTLCard.sisaJam;            // sisa jam belum cukup 1 hari
  const tlTerpakai   = parseFloat((tl.jamTerpakai || 0).toFixed(2));
  const tlPct        = tlTotalMasuk > 0 ? Math.min(100, Math.round((tlTerpakai / tlTotalMasuk) * 100)) : 0;

  el.innerHTML = `
    <div class="card" style="margin-top:0;padding:18px 18px 14px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#1a237e,#4f8ef7);
          display:flex;align-items:center;justify-content:center;color:white;font-size:18px;">🌴</div>
        <div>
          <div style="font-weight:800;font-size:15px;">Saldo Cuti Saya</div>
          <div style="font-size:12px;color:var(--muted);">Tahun ${new Date().getFullYear()}</div>
        </div>
      </div>

      <!-- Cuti Tahunan -->
      <div style="background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border-radius:14px;padding:16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-weight:800;font-size:14px;color:#2e7d32;">📅 Cuti Tahunan</span>
          <span style="font-size:11px;color:#66bb6a;font-weight:700;">Reset setiap 1 Januari</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:26px;font-weight:900;color:#2e7d32;">${k.tahunan.total}</div>
            <div style="font-size:10px;color:#81c784;font-weight:700;margin-top:2px;">Total (hari)</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:26px;font-weight:900;color:#e57373;">${k.tahunan.terpakai}</div>
            <div style="font-size:10px;color:#ef9a9a;font-weight:700;margin-top:2px;">Terpakai (hari)</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;
            box-shadow:0 2px 8px rgba(46,125,50,.15);">
            <div style="font-size:26px;font-weight:900;color:#1565c0;">${tahunanSisa}</div>
            <div style="font-size:10px;color:#64b5f6;font-weight:700;margin-top:2px;">Sisa (hari)</div>
          </div>
        </div>
        <div style="background:#c8e6c9;border-radius:50px;height:8px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#43a047,#66bb6a);border-radius:50px;
            width:${tahunanPct}%;transition:width .5s;"></div>
        </div>
        <div style="font-size:11px;color:#388e3c;margin-top:5px;text-align:right;">${tahunanPct}% terpakai</div>
      </div>

      <!-- Cuti Overtime — satuan JAM -->
      <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:14px;padding:16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-weight:800;font-size:14px;color:#1565c0;">⏱️ Cuti Overtime</span>
          <span style="font-size:11px;color:#64b5f6;font-weight:700;">Dari kelebihan jam/minggu</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:22px;font-weight:900;color:#1565c0;">${fmtJamOT(otTotalJam)}</div>
            <div style="font-size:10px;color:#64b5f6;font-weight:700;margin-top:2px;">Total (jam)</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:22px;font-weight:900;color:#e57373;">${fmtJamOT(otTerpakai)}</div>
            <div style="font-size:10px;color:#ef9a9a;font-weight:700;margin-top:2px;">Diambil (jam)</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;box-shadow:0 2px 8px rgba(21,101,192,.15);">
            <div style="font-size:22px;font-weight:900;color:#1565c0;">${fmtJamOT(otSisaJam)}</div>
            <div style="font-size:10px;color:#64b5f6;font-weight:700;margin-top:2px;">Sisa (jam)</div>
          </div>
        </div>
        <div style="background:#bbdefb;border-radius:50px;height:8px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#1565c0,#42a5f5);border-radius:50px;width:${otPct}%;transition:width .5s;"></div>
        </div>
        <div style="font-size:11px;color:#1976d2;margin-top:5px;text-align:right;">${otPct}% terpakai</div>
        ${(k.overtime.riwayat||[]).length > 0 ? `
        <div style="margin-top:10px;border-top:1px solid #bbdefb;padding-top:8px;">
          <div style="font-size:11px;font-weight:700;color:#1565c0;margin-bottom:6px;">📜 Riwayat</div>
          ${(k.overtime.riwayat||[]).slice().reverse().slice(0,3).map(r => {
            const warna = r.jam < 0 ? "#e53935" : "#2e7d32";
            const prefix = r.jam < 0 ? "-" : "+";
            return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid #e3f2fd;">
              <div><div style="font-weight:600;">${r.keterangan}</div><div style="color:var(--muted);font-size:10px;">${r.tanggal}</div></div>
              <div style="font-weight:800;color:${warna};">${prefix}${fmtJamOT(Math.abs(r.jam))}</div>
            </div>`;
          }).join("")}
        </div>` : ""}
      </div>

      <!-- Tukar Libur — satuan HARI (5 jam = 1 hari) -->
      <div style="background:linear-gradient(135deg,#fff8e1,#fff3e0);border-radius:14px;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-weight:800;font-size:14px;color:#e65100;">🔄 Tukar Libur</span>
          <span style="font-size:11px;color:#ffa726;font-weight:700;">Tukar Libur Hari Nasional dan Keagamaan</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:26px;font-weight:900;color:#e65100;">${tlTotalHari}</div>
            <div style="font-size:10px;color:#ffa726;font-weight:700;margin-top:2px;">Total (hari)</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:26px;font-weight:900;color:#e57373;">${tlDiambil}</div>
            <div style="font-size:10px;color:#ef9a9a;font-weight:700;margin-top:2px;">Diambil (hari)</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;box-shadow:0 2px 8px rgba(230,81,0,.15);">
            <div style="font-size:26px;font-weight:900;color:#e65100;">${tlSisaHari}</div>
            <div style="font-size:10px;color:#ffa726;font-weight:700;margin-top:2px;">Sisa (hari)</div>
          </div>
        </div>
        ${tlSisaJam > 0 ? `<div style="font-size:11px;color:#f57f17;margin-bottom:8px;text-align:center;">+ ${tlSisaJam} jam (belum cukup 1 hari, terakumulasi)</div>` : ""}
        <div style="background:#ffe0b2;border-radius:50px;height:8px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#e65100,#ffa726);border-radius:50px;width:${tlPct}%;transition:width .5s;"></div>
        </div>
        <div style="font-size:11px;color:#f57f17;margin-top:5px;text-align:right;">${tlPct}% terpakai</div>
        ${(tl.riwayat||[]).length > 0 ? `
        <div style="margin-top:10px;border-top:1px solid #ffe0b2;padding-top:8px;">
          <div style="font-size:11px;font-weight:700;color:#e65100;margin-bottom:6px;">📜 Riwayat</div>
          ${(tl.riwayat||[]).slice().reverse().slice(0,3).map(r => {
            const icon = r.sumber==="libur" ? "🏖️" : r.sumber==="carry-over" ? "↩️" : r.sumber==="ambil" ? "✅" : "📌";
            const warna = r.jam < 0 ? "#e53935" : "#2e7d32";
            const prefix = r.jam < 0 ? "-" : "+";
            return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid #fff3e0;">
              <div><div style="font-weight:600;">${icon} ${r.keterangan}</div><div style="color:var(--muted);font-size:10px;">${r.tanggal}</div></div>
              <div style="font-weight:800;color:${warna};">${prefix}${fmtJamOT(Math.abs(r.jam))}</div>
            </div>`;
          }).join("")}
        </div>` : ""}
      </div>
    </div>

    <!-- Riwayat cuti saya -->
    <div class="card" style="margin-top:12px;padding:0;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid #f0f2f5;">
        <span style="font-size:14px;font-weight:700;">📋 Riwayat Pengajuan Saya</span>
      </div>
      <div id="cuti-saldo-riwayat">
        <p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Memuat...</p>
      </div>
    </div>`;

  // Load riwayat pengajuan user ini
  loadRiwayatCutiSaya(user);
}

async function loadRiwayatCutiSaya(user) {
  const el = document.getElementById("cuti-saldo-riwayat");
  if (!el) return;
  try {
    const r = await authFetch(`/pengajuan-cuti?filter=semua`);
    const list = await r.json();
    const mine = list.filter(p => p.username === user).slice(0, 10);
    if (!mine.length) {
      el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Belum ada pengajuan</p>`;
      return;
    }
    const statusColor = { menunggu:"#f39c12", disetujui:"#27ae60", ditolak:"#e74c3c", dibatalkan:"#95a5a6" };
    const statusLabel = { menunggu:"⏳ Menunggu", disetujui:"✅ Disetujui", ditolak:"❌ Ditolak", dibatalkan:"🚫 Dibatalkan" };
    el.innerHTML = mine.map(p => {
      const sc = statusColor[p.status] || "#95a5a6";
      const sl = statusLabel[p.status] || p.status;
      const tgl = p.satuanDurasi === "jam"
        ? `${p.jamMulai||"--"} – ${p.jamAkhir||"--"}`
        : fmtTanggal(p.tanggalMulai);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #f0f2f5;">
        <div>
          <div style="font-size:13px;font-weight:700;">${p.kebijakanNama}</div>
          <div style="font-size:11px;color:var(--muted);">📅 ${tgl} &nbsp;|&nbsp; ${p.durasi} ${p.satuanDurasi}</div>
        </div>
        <span style="padding:4px 12px;border-radius:50px;font-size:11px;font-weight:700;background:${sc}20;color:${sc};">${sl}</span>
      </div>`;
    }).join("");
  } catch {
    el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:20px;">Gagal memuat riwayat</p>`;
  }
}

// ============================================================
// MODAL TAMBAH CUTI
// ============================================================

async function openTambahCutiModal() {
  // Load kebijakan
  try {
    const r = await authFetch("/kebijakan-cuti");
    _kebijakanList = await r.json();
  } catch { _kebijakanList = []; }

  const sel = document.getElementById("tc-kebijakan");
  sel.innerHTML = `<option value="">Pilih Kebijakan Cuti</option>`;
  _kebijakanList.forEach(k => {
    sel.innerHTML += `<option value="${k.id}" data-kuota="${k.kuotaKey||""}" data-nama="${k.nama}" data-satuan="${k.satuanDurasi||""}">${k.nama}</option>`;
  });

  // Reset fields
  document.getElementById("tc-durasi").value        = "";
  document.getElementById("tc-satuan").value        = "hari";
  document.getElementById("tc-tgl-mulai").value     = "";
  document.getElementById("tc-tgl-akhir").value     = "";
  document.getElementById("tc-jam-mulai").value     = "";
  document.getElementById("tc-jam-akhir").value     = "";
  const tcTglOt = document.getElementById("tc-tgl-ot");
  if (tcTglOt) tcTglOt.value = "";
  const tcComputed = document.getElementById("tc-durasi-computed");
  if (tcComputed) tcComputed.value = "";
  document.getElementById("tc-saldo-info").style.display        = "none";
  // Sembunyikan semua section — akan ditampilkan oleh onTcKebijakanChange
  document.getElementById("tc-wrap-durasi").style.display       = "none";
  const tcWrapSatuan = document.getElementById("tc-wrap-satuan");
  if (tcWrapSatuan) tcWrapSatuan.style.display = "none";
  document.getElementById("tc-wrap-tanggal").style.display      = "none";
  document.getElementById("tc-wrap-jam").style.display          = "none";
  const tcWrapTglOt = document.getElementById("tc-wrap-tanggal-ot");
  if (tcWrapTglOt) tcWrapTglOt.style.display = "none";
  const tcInfoKal = document.getElementById("tc-info-kalkulasi");
  if (tcInfoKal) { tcInfoKal.innerHTML = ""; tcInfoKal.style.display = "none"; }

  // Load kuota saya
  const user  = localStorage.getItem("user") || "";
  const tahun = new Date().getFullYear();
  try {
    const rk = await authFetch(`/kuota-cuti/${user}?tahun=${tahun}`);
    _kuotaSaya = await rk.json();
  } catch { _kuotaSaya = null; }

  const m = document.getElementById("modal-tambah-cuti");
  m.style.display = "flex";
  setTimeout(() => sel.focus(), 100);
}

function closeTambahCutiModal() {
  document.getElementById("modal-tambah-cuti").style.display = "none";
}

function onTcKebijakanChange() {
  const sel      = document.getElementById("tc-kebijakan");
  const opt      = sel.options[sel.selectedIndex];
  const kuotaKey = opt?.getAttribute("data-kuota") || "";
  const satuan   = opt?.getAttribute("data-satuan") || "";
  const infoEl   = document.getElementById("tc-saldo-info");

  // Sembunyikan semua section form dulu
  document.getElementById("tc-wrap-durasi").style.display        = "none";
  document.getElementById("tc-wrap-satuan").style.display        = "none";
  document.getElementById("tc-wrap-tanggal").style.display       = "none";
  document.getElementById("tc-wrap-jam").style.display           = "none";
  document.getElementById("tc-wrap-tanggal-ot").style.display    = "none";
  document.getElementById("tc-info-kalkulasi").style.display     = "none";
  infoEl.style.display = "none";

  if (!sel.value) return;

  if (kuotaKey === "tahunan") {
    // ── Cuti Tahunan: input tanggal mulai & akhir, durasi jam dihitung otomatis
    document.getElementById("tc-wrap-tanggal").style.display = "";
    // Tampilkan saldo tersedia
    if (_kuotaSaya) {
      const sisa = _kuotaSaya.tahunan.total - _kuotaSaya.tahunan.terpakai;
      infoEl.innerHTML = `📅 Saldo tersedia: <b>${sisa} hari</b> dari ${_kuotaSaya.tahunan.total} hari`;
      infoEl.style.display = "";
    }

  } else if (kuotaKey === "overtime") {
    // ── Cuti Overtime: input tanggal + jam mulai + jam akhir, durasi dihitung otomatis
    document.getElementById("tc-wrap-tanggal-ot").style.display = "";
    document.getElementById("tc-wrap-jam").style.display        = "";
    // Tampilkan saldo dalam JAM saja (bukan hari)
    if (_kuotaSaya) {
      const jam = (_kuotaSaya.overtime?._saldo || {}).totalJam || 0;
      infoEl.innerHTML = `⏱ Saldo tersedia: <b>${fmtJamOT(jam)}</b> akumulasi overtime`;
      infoEl.style.display = "";
    }

  } else {
    // ── Kebijakan custom: form sesuai satuanDurasi yang ditentukan saat buat kebijakan
    if (satuan === "jam") {
      // Form seperti cuti overtime: tanggal + jam mulai + jam akhir
      document.getElementById("tc-wrap-tanggal-ot").style.display = "";
      document.getElementById("tc-wrap-jam").style.display        = "";
    } else {
      // Form seperti cuti tahunan: tanggal mulai + tanggal akhir
      document.getElementById("tc-wrap-tanggal").style.display = "";
    }
    // Tampilkan saldo jika ada custom kuota
    if (_kuotaSaya && _kuotaSaya.customKuota) {
      const kebijakanId = sel.value;
      const ck = _kuotaSaya.customKuota[kebijakanId];
      if (ck) {
        const sisa = ck.total - ck.terpakai;
        const unit = satuan === "jam" ? "jam" : "hari";
        infoEl.innerHTML = `📋 Saldo tersedia: <b>${sisa} ${unit}</b> dari ${ck.total} ${unit}`;
        infoEl.style.display = "";
      }
    }
  }
}

function onTcSatuanChange() {
  // Hanya berlaku untuk kebijakan non-tahunan / non-overtime
  const sel      = document.getElementById("tc-kebijakan");
  const opt      = sel?.options[sel.selectedIndex];
  const kuotaKey = opt?.getAttribute("data-kuota") || "";
  if (kuotaKey === "tahunan" || kuotaKey === "overtime") return;

  const s = document.getElementById("tc-satuan").value;
  document.getElementById("tc-wrap-tanggal").style.display = s === "hari" ? "" : "none";
  document.getElementById("tc-wrap-jam").style.display     = s === "jam"  ? "" : "none";
}

// ── Hitung otomatis jam cuti tahunan dari rentang tanggal ──────────────────
// Senin–Jumat = 7 jam, Sabtu = 5 jam, Minggu = 0 (dilewati)
function onTcTanggalChange() {
  const tglMulai = document.getElementById("tc-tgl-mulai").value;
  const tglAkhir = document.getElementById("tc-tgl-akhir").value || tglMulai;
  const infoEl   = document.getElementById("tc-info-kalkulasi");
  infoEl.style.display = "none";
  if (!tglMulai) return;

  const start = new Date(tglMulai + "T00:00:00");
  const end   = new Date((tglAkhir || tglMulai) + "T00:00:00");
  if (end < start) {
    infoEl.innerHTML = "⚠️ Tanggal akhir harus sama atau setelah tanggal mulai";
    infoEl.style.background = "#fff3e0"; infoEl.style.color = "#e65100";
    infoEl.style.display = "";
    document.getElementById("tc-durasi-computed").value = "";
    return;
  }

  let totalJam = 0;
  const cur = new Date(start);
  while (cur <= end) {
    totalJam += JAM_KERJA_PER_HARI[cur.getDay()] || 0;
    cur.setDate(cur.getDate() + 1);
  }

  document.getElementById("tc-durasi-computed").value = totalJam;

  if (totalJam > 0) {
    const hari = tglMulai === (tglAkhir || tglMulai) ? "1 hari" : `rentang ${tglMulai} – ${tglAkhir}`;
    infoEl.innerHTML = `📊 Total: <b>${totalJam} jam</b> cuti (${hari})`;
    infoEl.style.background = "#e8f5e9"; infoEl.style.color = "#2e7d32";
  } else {
    infoEl.innerHTML = "⚠️ Tidak ada hari kerja dalam rentang tanggal ini";
    infoEl.style.background = "#fff3e0"; infoEl.style.color = "#e65100";
  }
  infoEl.style.display = "";
}

// ── Hitung otomatis durasi cuti overtime dari jam mulai – jam akhir ─────────
function onTcJamChange() {
  const jamMulai = document.getElementById("tc-jam-mulai").value;
  const jamAkhir = document.getElementById("tc-jam-akhir").value;
  const infoEl   = document.getElementById("tc-info-kalkulasi");
  infoEl.style.display = "none";
  if (!jamMulai || !jamAkhir) return;

  const [h1, m1] = jamMulai.split(":").map(Number);
  const [h2, m2] = jamAkhir.split(":").map(Number);
  const totalMenit = (h2 * 60 + m2) - (h1 * 60 + m1);

  if (totalMenit <= 0) {
    infoEl.innerHTML = "⚠️ Jam akhir harus lebih besar dari jam mulai";
    infoEl.style.background = "#fff3e0"; infoEl.style.color = "#e65100";
    infoEl.style.display = "";
    document.getElementById("tc-durasi-computed").value = "";
    return;
  }
  const totalJam = parseFloat((totalMenit / 60).toFixed(2));
  document.getElementById("tc-durasi-computed").value = totalJam;

  infoEl.innerHTML = `⏱ Durasi: <b>${totalJam} jam</b> (${totalMenit} menit)`;
  infoEl.style.background = "#fff8e1"; infoEl.style.color = "#e65100";
  infoEl.style.display = "";
}

async function saveTambahCuti() {
  const kebijakanEl  = document.getElementById("tc-kebijakan");
  const kebijakanId  = kebijakanEl.value;
  if (!kebijakanId) return showToast("⚠️ Pilih kebijakan cuti!", "warning");

  const opt          = kebijakanEl.options[kebijakanEl.selectedIndex];
  const kuotaKey     = opt?.getAttribute("data-kuota") || null;
  const kebijakanNama = opt?.getAttribute("data-nama") || "";
  const satuanKebijakan = opt?.getAttribute("data-satuan") || "";

  let durasi, satuanDurasi, tanggalMulai, tanggalAkhir, jamMulai, jamAkhir;

  if (kuotaKey === "tahunan") {
    // ── Cuti Tahunan: durasi HARI KERJA dihitung dari rentang tanggal ──────
    tanggalMulai = document.getElementById("tc-tgl-mulai").value || null;
    tanggalAkhir = document.getElementById("tc-tgl-akhir").value || null;
    if (!tanggalMulai) return showToast("⚠️ Pilih tanggal mulai cuti!", "warning");

    // Hitung hari kerja aktual (Minggu = 0, tidak dihitung)
    let hariKerja = 0;
    const _cur = new Date(tanggalMulai + "T00:00:00");
    const _end = new Date((tanggalAkhir || tanggalMulai) + "T00:00:00");
    while (_cur <= _end) {
      if (_cur.getDay() !== 0) hariKerja++; // Minggu dilewati
      _cur.setDate(_cur.getDate() + 1);
    }
    durasi = hariKerja;
    if (!durasi || durasi <= 0)
      return showToast("⚠️ Tidak ada hari kerja dalam rentang tanggal yang dipilih!", "warning");

    satuanDurasi = "hari";  // satuan hari — server simpan & kurangi saldo dalam hari
    jamMulai     = null;
    jamAkhir     = null;

  } else if (kuotaKey === "overtime") {
    // ── Cuti Overtime: durasi JAM dari selisih jam mulai–akhir ───────────────
    tanggalMulai = document.getElementById("tc-tgl-ot").value || null;
    if (!tanggalMulai) return showToast("⚠️ Pilih tanggal cuti overtime!", "warning");

    jamMulai = document.getElementById("tc-jam-mulai").value || null;
    jamAkhir = document.getElementById("tc-jam-akhir").value || null;
    if (!jamMulai || !jamAkhir)
      return showToast("⚠️ Isi jam mulai dan jam akhir!", "warning");

    durasi = parseFloat(document.getElementById("tc-durasi-computed").value);
    if (!durasi || durasi <= 0)
      return showToast("⚠️ Durasi tidak valid. Pastikan jam akhir > jam mulai!", "warning");

    satuanDurasi = "jam";
    tanggalAkhir = null;

  } else if (satuanKebijakan === "jam") {
    // ── Kebijakan custom satuan JAM: form seperti overtime ───────────────────
    tanggalMulai = document.getElementById("tc-tgl-ot").value || null;
    if (!tanggalMulai) return showToast("⚠️ Pilih tanggal cuti!", "warning");

    jamMulai = document.getElementById("tc-jam-mulai").value || null;
    jamAkhir = document.getElementById("tc-jam-akhir").value || null;
    if (!jamMulai || !jamAkhir)
      return showToast("⚠️ Isi jam mulai dan jam akhir!", "warning");

    durasi = parseFloat(document.getElementById("tc-durasi-computed").value);
    if (!durasi || durasi <= 0)
      return showToast("⚠️ Durasi tidak valid. Pastikan jam akhir > jam mulai!", "warning");

    satuanDurasi = "jam";
    tanggalAkhir = null;

  } else {
    // ── Kebijakan custom satuan HARI: hitung hari kerja aktual ─────────────
    tanggalMulai = document.getElementById("tc-tgl-mulai").value || null;
    tanggalAkhir = document.getElementById("tc-tgl-akhir").value || null;
    if (!tanggalMulai) return showToast("⚠️ Pilih tanggal mulai cuti!", "warning");

    // Hitung hari kerja aktual (Minggu tidak dihitung)
    let hariKerja = 0;
    const _cur2 = new Date(tanggalMulai + "T00:00:00");
    const _end2 = new Date((tanggalAkhir || tanggalMulai) + "T00:00:00");
    while (_cur2 <= _end2) {
      if (_cur2.getDay() !== 0) hariKerja++;
      _cur2.setDate(_cur2.getDate() + 1);
    }
    durasi = hariKerja;
    if (!durasi || durasi <= 0)
      return showToast("⚠️ Tidak ada hari kerja dalam rentang tanggal yang dipilih!", "warning");

    satuanDurasi = "hari";
    jamMulai     = null;
    jamAkhir     = null;
  }

  const user = localStorage.getItem("user") || "";
  try {
    const r = await authFetch("/pengajuan-cuti", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kebijakanId, kebijakanNama, kuotaKey,
        durasi, satuanDurasi, tanggalMulai, tanggalAkhir, jamMulai, jamAkhir })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Pengajuan cuti berhasil!");
      closeTambahCutiModal();
      loadDaftarCuti();
    } else {
      showToast("❌ " + (d.msg || "Gagal mengajukan cuti"), "error");
    }
  } catch { showToast("❌ Gagal mengajukan cuti", "error"); }
}

// ============================================================
// Hook ke openView & navTo — load cuti saat masuk halaman
// ============================================================
const _origOpenView_cuti = openView;
// Patch openView agar load daftar cuti ketika view-cuti dibuka
(function() {
  const _orig = openView;
  openView = window.openView = function(viewId) {
    _orig(viewId);
    if (viewId === "view-cuti") {
      _cutiFilter = "semua";
      _cutiTab    = "daftar";
      // Reset tab UI
      const td = document.getElementById("cuti-tab-daftar");
      const ts = document.getElementById("cuti-tab-saldo");
      if (td) { td.style.background="var(--primary)"; td.style.color="white"; }
      if (ts) { ts.style.background="white"; ts.style.color="var(--muted)"; }
      const pd = document.getElementById("cuti-panel-daftar");
      const ps = document.getElementById("cuti-panel-saldo");
      if (pd) pd.style.display = "";
      if (ps) ps.style.display = "none";
      // Reset dropdown filter
      const sel = document.getElementById("cuti-filter-select");
      if (sel) sel.value = "semua";
      loadDaftarCuti();
    }
  };
})();

// Patch untuk simpan currentUser ke window
(function() {
  const _orig = navTo;
  // Cari username setelah login (di fungsi handleAuth atau loadAdmin yg sudah ada)
  // Kita baca dari _currentUser yang di-set saat login
})();


// ============================================================
// AKTIVITAS KUSTOM (Daftar Aktivitas yg bisa di-tambah admin)
// ============================================================

const AKTIVITAS_KEY = "daftar_aktivitas_kustom";

function getDaftarAktivitas() {
  try { return JSON.parse(localStorage.getItem(AKTIVITAS_KEY) || "[]"); } catch { return []; }
}

function saveDaftarAktivitas(list) {
  localStorage.setItem(AKTIVITAS_KEY, JSON.stringify(list));
}

function openTambahAktivitas() {
  const el = document.getElementById("modal-tambah-aktivitas");
  el.style.display = "flex";
  setTimeout(() => document.getElementById("input-nama-aktivitas").focus(), 100);
}

function closeTambahAktivitas() {
  document.getElementById("modal-tambah-aktivitas").style.display = "none";
  document.getElementById("input-nama-aktivitas").value = "";
}

function simpanAktivitas() {
  const nama = (document.getElementById("input-nama-aktivitas").value || "").trim();
  if (!nama) { showToast("⚠️ Nama aktivitas wajib diisi", "warning"); return; }
  const list = getDaftarAktivitas();
  if (list.find(a => a.toLowerCase() === nama.toLowerCase())) {
    showToast("⚠️ Aktivitas sudah ada", "warning"); return;
  }
  list.push(nama);
  saveDaftarAktivitas(list);
  closeTambahAktivitas();
  renderDaftarAktivitas();
  loadHomeAktivitasDropdown();
  showToast("✅ Aktivitas berhasil ditambahkan");
}

function hapusAktivitas(nama) {
  if (!confirm(`Hapus aktivitas "${nama}"?`)) return;
  const list = getDaftarAktivitas().filter(a => a !== nama);
  saveDaftarAktivitas(list);
  renderDaftarAktivitas();
  loadHomeAktivitasDropdown();
  showToast("🗑️ Aktivitas dihapus");
}

function renderDaftarAktivitas() {
  const el = document.getElementById("daftar-aktivitas-list");
  if (!el) return;
  const list = getDaftarAktivitas();
  if (!list.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Belum ada aktivitas kustom. Klik ＋ Tambah Aktivitas.</p>';
    return;
  }
  el.innerHTML = list.map(a => `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:11px 0;border-bottom:1px solid #f0f2f5;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:16px;">📌</span>
        <span style="font-size:14px;font-weight:600;">${a}</span>
      </div>
      <button onclick="hapusAktivitas('${a.replace(/'/g,"\\'")}') "
        style="padding:5px 12px;border:none;border-radius:8px;background:#fce4ec;
               color:#c62828;font-weight:700;font-size:12px;cursor:pointer;">🗑️</button>
    </div>`).join("") + '<div style="height:4px;"></div>';
}

// Override loadAktivitas to also render daftar
const _origLoadAktivitas = loadAktivitas;
loadAktivitas = async function() {
  await _origLoadAktivitas();
  renderDaftarAktivitas();
};

// ============================================================
// HOME: Lokasi Auto-detect + Aktivitas Dropdown
// ============================================================

let _homeLokWatcher = null;

function loadHomeAktivitasDropdown() {
  const sel = document.getElementById("home-aktivitas-select");
  if (!sel) return;
  const list = getDaftarAktivitas();
  const cur = sel.value;
  sel.innerHTML = '<option value="">Pilih Aktivitas</option>' +
    list.map(a => `<option value="${a}"${a===cur?' selected':''}>${a}</option>`).join("");
}

async function startHomeLokasi() {
  const el = document.getElementById("home-lokasi-text");
  if (!el) return;
  if (!navigator.geolocation) {
    el.innerHTML = '<span style="color:var(--muted);font-size:13px;">Geolokasi tidak didukung browser ini</span>';
    return;
  }

  // Cek permission dulu sebelum watchPosition (penting untuk Android/TWA)
  if (navigator.permissions) {
    try {
      const permStatus = await navigator.permissions.query({ name: "geolocation" });
      if (permStatus.state === "denied") {
        el.innerHTML = '<span style="color:#e74c3c;font-size:13px;">\u274C Izin lokasi ditolak. Buka Pengaturan HP \u2192 Aplikasi \u2192 Absensi Smart \u2192 Izin \u2192 Lokasi \u2192 Izinkan.</span>';
        return;
      }
      if (permStatus.state === "prompt") {
        el.innerHTML = '<span style="color:var(--muted);font-size:13px;">\u23F3 Meminta izin lokasi...</span>';
        // Tunggu izin diberikan dulu dengan getCurrentPosition
        await new Promise(resolve => {
          navigator.geolocation.getCurrentPosition(resolve, resolve, { timeout: 12000, maximumAge: 60000 });
        });
      }
    } catch { /* lanjut */ }
  }

  el.innerHTML = '<span style="color:var(--muted);font-size:13px;">\u23F3 Mendeteksi lokasi...</span>';

  // Ambil posisi pertama kali dulu (getCurrentPosition) sebelum watchPosition
  // Ini penting di Android — GPS butuh "warm up" sebelum watchPosition bisa akurat
  const firstPos = await new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });

  if (firstPos) {
    const lat = firstPos.coords.latitude;
    const lng = firstPos.coords.longitude;
    const acc = firstPos.coords.accuracy || 0;
    checkLokasiRadius(lat, lng, acc);
  } else {
    // Coba low accuracy sebagai fallback
    const fallbackPos = await new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        p => resolve(p),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
      );
    });
    if (fallbackPos) {
      checkLokasiRadius(fallbackPos.coords.latitude, fallbackPos.coords.longitude, fallbackPos.coords.accuracy || 0);
    } else {
      el.innerHTML = '<span style="color:var(--muted);font-size:13px;">\u26A0\uFE0F Pastikan GPS aktif.</span>';
    }
  }

  // Mulai watchPosition untuk update real-time
  function updateLokasi(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = pos.coords.accuracy || 0;
    checkLokasiRadius(lat, lng, acc);
  }

  function errLokasi(err) {
    if (!el) return;
    if (err.code === 1) {
      el.innerHTML = '<span style="color:#e74c3c;font-size:12px;">\u274C Izin lokasi ditolak. Buka Pengaturan HP \u2192 Izin \u2192 Lokasi \u2192 Izinkan.</span>';
    } else if (err.code === 3) {
      // Timeout pada watchPosition: tidak tampilkan error — posisi terakhir masih valid
      console.warn("watchPosition timeout, posisi terakhir tetap ditampilkan");
    } else {
      console.warn("watchPosition error:", err.code, err.message);
    }
  }

  if (_homeLokWatcher) navigator.geolocation.clearWatch(_homeLokWatcher);
  _homeLokWatcher = navigator.geolocation.watchPosition(updateLokasi, errLokasi, {
    enableHighAccuracy: true,
    maximumAge: 15000,   // terima posisi cached sampai 15 detik
    timeout: 30000       // timeout lebih panjang untuk watchPosition
  });
}

function stopHomeLokasi() {
  if (_homeLokWatcher) { navigator.geolocation.clearWatch(_homeLokWatcher); _homeLokWatcher = null; }
}

async function checkLokasiRadius(lat, lng, accuracy) {
  const el = document.getElementById("home-lokasi-text");
  if (!el) return;
  try {
    // Pakai /areas/check — semua level user bisa akses, koordinat area tidak bocor ke client
    const r = await authFetch("/areas/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, accuracy: accuracy || 0 })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();

    if (data.status === "NO_AREA") {
      el.innerHTML = '<span style="color:var(--muted);font-size:13px;">Belum ada area kantor terdaftar</span>';
    } else if (data.status === "NO_LOCATION") {
      el.innerHTML = '<span style="color:var(--muted);font-size:13px;">⚠️ Lokasi tidak tersedia</span>';
    } else if (data.status === "IN_AREA") {
      el.innerHTML = `<span style="color:var(--success);font-weight:700;font-size:14px;">✅ ${data.name}</span>`;
    } else if (data.status === "NEAR") {
      const distLabel = data.distance < 1000 ? data.distance + ' m' : (data.distance/1000).toFixed(1) + ' km';
      el.innerHTML = `<span style="color:var(--warning);font-weight:600;font-size:13px;">📍 ${distLabel} dari ${data.name}</span>`;
    } else {
      el.innerHTML = `<span style="color:var(--muted);font-size:13px;">Di luar Radius Area</span>`;
    }
  } catch (e) {
    console.warn("checkLokasiRadius error:", e);
    el.innerHTML = '<span style="color:var(--muted);font-size:13px;">⚠️ Gagal cek area</span>';
  }
}

// Hook ke openView untuk memulai/hentikan tracking lokasi
const _origOpenView = openView;
openView = function(viewId) {
  _origOpenView(viewId);
  if (viewId === "view-home") {
    loadHomeAktivitasDropdown();
    startHomeLokasi();
  } else {
    stopHomeLokasi();
  }
};

// Hook ke navTo juga
const _origNavTo = typeof navTo === "function" ? navTo : null;
if (_origNavTo) {
  navTo = window.navTo = function(page) {
    _origNavTo(page);
    if (page === "home") {
      setTimeout(() => { loadHomeAktivitasDropdown(); startHomeLokasi(); }, 200);
    } else {
      stopHomeLokasi();
    }
  };
}

// Auto-start lokasi jika view-home sudah aktif saat load
document.addEventListener("DOMContentLoaded", () => {
  const homeView = document.getElementById("view-home");
  if (homeView && homeView.classList.contains("active")) {
    loadHomeAktivitasDropdown();
    startHomeLokasi();
  }
});

// ============================================================
// OVERRIDE: Gunakan server-side aktivitas-kustom
// ============================================================
(function() {
  // Replace localStorage-based functions with server-based ones

  async function getDaftarAktivitasServer() {
    try {
      const r = await authFetch("/aktivitas-kustom");
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  }

  async function renderDaftarAktivitasServer() {
    const el = document.getElementById("daftar-aktivitas-list");
    if (!el) return;
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:16px;font-size:13px;">Memuat...</p>';
    const list = await getDaftarAktivitasServer();
    if (!list.length) {
      el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Belum ada aktivitas kustom. Klik ＋ Tambah Aktivitas.</p>';
      return;
    }
    el.innerHTML = list.map(a => `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:11px 0;border-bottom:1px solid #f0f2f5;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:16px;">📌</span>
          <span style="font-size:14px;font-weight:600;">${a}</span>
        </div>
        <button onclick="hapusAktivitasServer('${a.replace(/'/g,"\\'")}') "
          style="padding:5px 12px;border:none;border-radius:8px;background:#fce4ec;
                 color:#c62828;font-weight:700;font-size:12px;cursor:pointer;">🗑️</button>
      </div>`).join("") + '<div style="height:4px;"></div>';
  }

  window.hapusAktivitasServer = async function(nama) {
    if (!confirm(`Hapus aktivitas "${nama}"?`)) return;
    try {
      await authFetch(`/aktivitas-kustom/${encodeURIComponent(nama)}`, { method: "DELETE" });
      renderDaftarAktivitasServer();
      loadHomeAktivitasDropdownServer();
      showToast("🗑️ Aktivitas dihapus");
    } catch { showToast("Gagal menghapus", "error"); }
  };

  // Replace simpanAktivitas
  window.simpanAktivitas = async function() {
    const nama = (document.getElementById("input-nama-aktivitas").value || "").trim();
    if (!nama) { showToast("⚠️ Nama aktivitas wajib diisi", "warning"); return; }
    try {
      const r = await authFetch("/aktivitas-kustom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nama })
      });
      if (r.status === 409) { showToast("⚠️ Aktivitas sudah ada", "warning"); return; }
      if (!r.ok) throw new Error();
      closeTambahAktivitas();
      renderDaftarAktivitasServer();
      loadHomeAktivitasDropdownServer();
      showToast("✅ Aktivitas berhasil ditambahkan");
    } catch { showToast("Gagal menyimpan", "error"); }
  };

  // Replace renderDaftarAktivitas
  window.renderDaftarAktivitas = renderDaftarAktivitasServer;

  // Load aktivitas home dropdown from server
  async function loadHomeAktivitasDropdownServer() {
    const sel = document.getElementById("home-aktivitas-select");
    if (!sel) return;
    const list = await getDaftarAktivitasServer();
    const cur = sel.value;
    sel.innerHTML = '<option value="">Pilih Aktivitas</option>' +
      list.map(a => `<option value="${a}"${a===cur?' selected':''}>${a}</option>`).join("");
  }
  window.loadHomeAktivitasDropdown = loadHomeAktivitasDropdownServer;
  window.loadHomeAktivitasDropdownServer = loadHomeAktivitasDropdownServer;

  // Also patch loadAktivitas to call server render
  const _orig2 = loadAktivitas;
  loadAktivitas = async function() {
    await _orig2();
    renderDaftarAktivitasServer();
  };
  window.loadAktivitas = loadAktivitas;
})();

// ============================================================
// PENGATURAN SISTEM — Timezone (hanya Owner/Admin)
// ============================================================
let _appTimezone = "Asia/Makassar"; // default, akan di-update dari server

async function loadSistemSettings() {
  try {
    const r = await authFetch("/app-settings");
    if (!r.ok) return;
    const d = await r.json();
    _appTimezone = d.timezone || "Asia/Makassar";

    // Set dropdown sesuai nilai tersimpan
    const sel = document.getElementById("select-timezone");
    if (sel) sel.value = _appTimezone;

    // Update info timezone saat ini
    _updateTzInfo(_appTimezone);
  } catch (e) {
    console.warn("loadSistemSettings gagal:", e);
  }
}

function _updateTzInfo(tz) {
  const el = document.getElementById("tz-current-info");
  if (!el) return;
  const label = { "Asia/Jakarta": "WIB (UTC+7)", "Asia/Makassar": "WITA (UTC+8)", "Asia/Jayapura": "WIT (UTC+9)" };
  const now = new Date().toLocaleString("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  el.innerHTML = `✅ Aktif: <b>${label[tz] || tz}</b> &nbsp;|&nbsp; Jam server sekarang: <b>${now}</b>`;
}

async function saveSistemSettings() {
  const sel = document.getElementById("select-timezone");
  if (!sel) return;
  const tz = sel.value;
  try {
    const r = await authFetch("/app-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz })
    });
    const d = await r.json();
    if (d.status === "OK") {
      _appTimezone = tz;
      _updateTzInfo(tz);
      showToast("✅ Pengaturan timezone berhasil disimpan!");
    } else if (d.status === "FORBIDDEN") {
      showToast("⛔ Hanya Owner/Admin yang bisa ubah pengaturan ini", "error");
    } else {
      showToast("⚠️ Timezone tidak valid", "warning");
    }
  } catch (e) {
    showToast("❌ Gagal menyimpan pengaturan", "error");
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => console.log("SW registered:", reg.scope))
      .catch((err) => console.warn("SW failed:", err));
  });
}

// ========================
// CHATBOT
// ========================
let _chatHistory = [];
let _chatOpen    = false;

function toggleChatPanel() {
  _chatOpen = !_chatOpen;
  const panel = document.getElementById("chat-panel");
  if (_chatOpen) {
    panel.classList.add("open");
    document.getElementById("chat-input").focus();
  } else {
    panel.classList.remove("open");
  }
}

function chatAppend(role, text) {
  const box = document.getElementById("chat-messages");
  const el  = document.createElement("div");
  el.className = "chat-bubble " + role;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const btn   = document.getElementById("chat-send");
  const msg   = input.value.trim();
  if (!msg) return;

  input.value = "";
  btn.disabled = true;

  chatAppend("user", msg);

  // Typing indicator
  const typing = chatAppend("bot typing", "⏳ Sedang memproses...");

  try {
    const r = await authFetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, history: _chatHistory })
    });
    const d = await r.json();
    const reply = d.reply || "Maaf, tidak ada respons.";

    // Update history untuk konteks percakapan berikutnya
    _chatHistory.push({ role: "user", content: msg });
    _chatHistory.push({ role: "assistant", content: reply });
    if (_chatHistory.length > 20) _chatHistory = _chatHistory.slice(-20);

    // Ganti typing indicator dengan jawaban asli
    typing.className   = "chat-bubble bot";
    typing.textContent = reply;
  } catch {
    typing.className   = "chat-bubble bot";
    typing.textContent = "❌ Gagal menghubungi server. Coba lagi.";
  }

  btn.disabled = false;
  input.focus();

  const box = document.getElementById("chat-messages");
  box.scrollTop = box.scrollHeight;
}

// ============================================================
// MONITOR LAYAR — UI Halaman view-screenshot
// ============================================================

// Hook openView untuk load halaman screenshot
const _origOpenView_ss = openView;
openView = window.openView = function(viewId) {
  _origOpenView_ss(viewId);
  if (viewId === "view-screenshot") { loadScreenshotPage(); switchMonitorTab("layar"); }
};

// ── Helpers tanggal untuk Monitor Layar ──
function ssGetDate() {
  const inp = document.getElementById("ss-pilih-tanggal");
  return inp && inp.value ? inp.value : todayLocalStr();
}
function ssSetDateToday() {
  const inp = document.getElementById("ss-pilih-tanggal");
  if (inp) inp.value = todayLocalStr();
}
function ssOnDateChange() {
  const date = ssGetDate();
  const isToday = date === todayLocalStr();
  const titleEl = document.getElementById("ss-active-list-title");
  if (titleEl) {
    titleEl.textContent = isToday
      ? "👥 Karyawan Aktif Hari Ini"
      : `👥 Karyawan — ${new Date(date).toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}`;
  }
  loadScreenshotActiveList();
  ssPopulateUserSelect();
  // sembunyikan grid saat ganti tanggal
  const wrap = document.getElementById("ss-grid-wrap");
  if (wrap) wrap.style.display = "none";
}
function ssRefreshAll() {
  loadScreenshotActiveList(true);
  ssPopulateUserSelect();
  ssLoadDateChips();
}

async function ssLoadDateChips() {
  const chipsEl = document.getElementById("ss-date-chips");
  if (!chipsEl) return;
  // chips 7 hari terakhir (hari ini s.d 6 hari lalu)
  const today = todayLocalStr();
  const chips = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    chips.push(d.toLocaleDateString("sv-SE")); // YYYY-MM-DD
  }
  chipsEl.innerHTML = chips.map(date => {
    const isToday = date === today;
    const label = isToday ? "Hari ini" : new Date(date).toLocaleDateString("id-ID",{weekday:"short",day:"numeric",month:"short"});
    return `<button onclick="ssSetDate('${date}')" id="ss-chip-${date}"
      style="padding:6px 12px;border:none;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;
             white-space:nowrap;flex-shrink:0;
             background:${isToday?'var(--primary)':'#e8ecf0'};color:${isToday?'white':'var(--text)'};
             transition:.15s;" data-date="${date}">${label}</button>`;
  }).join("");
}
function ssSetDate(date) {
  const inp = document.getElementById("ss-pilih-tanggal");
  if (inp) inp.value = date;
  // update chip highlight
  document.querySelectorAll("#ss-date-chips button").forEach(b => {
    const isActive = b.dataset.date === date;
    b.style.background = isActive ? "var(--primary)" : "#e8ecf0";
    b.style.color = isActive ? "white" : "var(--text)";
  });
  ssOnDateChange();
}
window.ssSetDate = ssSetDate;
window.ssOnDateChange = ssOnDateChange;
window.ssRefreshAll = ssRefreshAll;

async function loadScreenshotPage() {
  ssSetDateToday();
  await ssLoadDateChips();
  await ssPopulateUserSelect();
  await loadScreenshotActiveList();
}

function _applySelectPlaceholderColor(sel) {
  if (!sel) return;
  sel.style.color = sel.value === "" ? "#aaa" : "var(--text)";
}

async function ssPopulateUserSelect() {
  const sel  = document.getElementById("ss-pilih-user");
  const date = ssGetDate();
  if (!sel) return;
  // update warna saat user ganti pilihan
  sel.onchange = function() { _applySelectPlaceholderColor(sel); ssOnDateChange(); };
  try {
    const endpoint = date === todayLocalStr() ? "/screenshots/today" : `/screenshots/list-users?date=${date}`;
    const r = await authFetch(endpoint);
    if (!r.ok) return;
    const list = await r.json();
    // Urutkan: alfabetis nama A→Z
    list.sort((a, b) => a.namaLengkap.localeCompare(b.namaLengkap, 'id'));
    const prev = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    list.forEach(u => {
      const o = document.createElement("option");
      o.value = u.username;
      o.textContent = `${u.namaLengkap} (${u.totalScreenshots || u.totalPhotos || 0} foto)`;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
    _applySelectPlaceholderColor(sel);
  } catch {}
}

async function loadScreenshotActiveList(silent = false) {
  const el   = document.getElementById("ss-active-list");
  const date = ssGetDate();
  const isToday = date === todayLocalStr();
  if (!el) return;
  if (!silent) el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:12px 0;">Memuat...</p>';
  try {
    const endpoint = isToday ? "/screenshots/today" : `/screenshots/list-users?date=${date}`;
    const r = await authFetch(endpoint);
    if (!r.ok) { el.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:12px;">Gagal memuat data</p>'; return; }
    const list = await r.json();
    const emptyMsg = isToday ? "Tidak ada karyawan aktif hari ini" : "Tidak ada record screenshot pada tanggal ini";
    if (!list.length) {
      el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:12px 0;">${emptyMsg}</p>`;
      return;
    }
    const statusColor = { IN:"#27ae60", BREAK:"#f39c12", DONE:"#95a5a6" };
    const statusLabel = { IN:"Sedang Bekerja", BREAK:"Istirahat", DONE:"Selesai" };
    el.innerHTML = list.map(u => {
      const lastFmt = u.lastScreenshot
        ? new Date(u.lastScreenshot).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})
        : "--:--";
      const total = u.totalScreenshots || u.totalPhotos || 0;
      return `
        <div onclick="ssSelectUser('${u.username}')"
          style="display:flex;align-items:center;gap:12px;padding:10px 12px;
                 border-bottom:1px solid #f5f5f5;cursor:pointer;transition:background .15s;"
          onmouseover="this.style.background='#f9f9f9'" onmouseout="this.style.background='white'">
          <div style="width:38px;height:38px;border-radius:50%;background:var(--primary);color:white;
                      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;">
            ${(u.namaLengkap||u.username).charAt(0).toUpperCase()}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;">${u.namaLengkap}</div>
            <div style="font-size:11px;color:var(--muted);">${u.jabatan||""}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            ${u.status ? `<div style="display:inline-block;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:700;
                        background:${statusColor[u.status]}22;color:${statusColor[u.status]};">
              ${statusLabel[u.status]||u.status}
            </div>` : ""}
            <div style="font-size:11px;color:var(--muted);margin-top:3px;">
              ${total > 0 ? `🖥️ ${total} foto · terakhir ${lastFmt}` : "Belum ada screenshot"}
            </div>
          </div>
        </div>`;
    }).join("");
    await ssPopulateUserSelect();
  } catch {
    el.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:12px;">Terjadi kesalahan</p>';
  }
}

function ssSelectUser(username) {
  const sel = document.getElementById("ss-pilih-user");
  if (sel) sel.value = username;
  loadScreenshots();
}

async function loadScreenshots(silent = false) {
  const sel      = document.getElementById("ss-pilih-user");
  const username = sel ? sel.value : "";
  if (!username) { showToast("⚠️ Pilih karyawan terlebih dahulu", "warning"); return; }

  const date  = ssGetDate();
  const wrap  = document.getElementById("ss-grid-wrap");
  const grid  = document.getElementById("ss-grid");
  const empty = document.getElementById("ss-grid-empty");
  const title = document.getElementById("ss-grid-title");
  const count = document.getElementById("ss-grid-count");
  if (!wrap || !grid) return;

  wrap.style.display = "block";
  if (!silent) grid.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;grid-column:1/-1;">Memuat...</p>';
  if (empty) empty.style.display = "none";

  try {
    const r = await authFetch(`/screenshots/${username}?date=${date}`);
    if (!r.ok) { grid.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:20px;grid-column:1/-1;">Gagal memuat</p>'; return; }
    const shots = await r.json();
    const dateFmt = new Date(date).toLocaleDateString("id-ID",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
    if (title) title.textContent = `🖥️ ${username} — ${dateFmt}`;
    if (!shots.length) {
      grid.innerHTML = "";
      if (empty) { empty.style.display = "block"; empty.textContent = `Tidak ada screenshot untuk ${username} pada ${dateFmt}.`; }
      if (count) count.textContent = "0 foto";
      return;
    }
    if (count) count.textContent = `${shots.length} foto`;
    grid.innerHTML = shots.map((s, i) => {
      const waktu = new Date(s.ts).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});
      return `
        <div id="ss-thumb-${i}" onclick="ssOpenModal(${i},'${username}','${date}')"
          style="border-radius:10px;overflow:hidden;background:#f0f2f5;cursor:pointer;
                 position:relative;aspect-ratio:16/9;display:flex;align-items:center;
                 justify-content:center;transition:transform .15s;box-shadow:0 2px 8px rgba(0,0,0,.08);"
          onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
          <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.6));
                      padding:4px 6px;color:white;font-size:10px;font-weight:700;">${waktu}</div>
          <span style="font-size:28px;color:#bbb;" id="ss-loading-${i}">⏳</span>
        </div>`;
    }).join("");
    for (const s of shots) ssLoadThumb(s.index, username, date);
  } catch {
    grid.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:20px;grid-column:1/-1;">Terjadi kesalahan</p>';
  }
}

async function ssLoadThumb(index, username, date) {
  date = date || ssGetDate();
  try {
    const r = await authFetch(`/screenshots/${username}/${index}?date=${date}`);
    if (!r.ok) return;
    const d     = await r.json();
    const thumb = document.getElementById(`ss-thumb-${index}`);
    const load  = document.getElementById(`ss-loading-${index}`);
    if (!thumb || !d.image) return;
    if (load) load.remove();
    const img = document.createElement("img");
    img.src = d.image;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;position:absolute;inset:0;";
    thumb.insertBefore(img, thumb.firstChild);
  } catch {}
}

async function ssOpenModal(index, username, date) {
  date = date || ssGetDate();
  const modal = document.getElementById("ss-modal");
  const img   = document.getElementById("ss-modal-img");
  const info  = document.getElementById("ss-modal-info");
  if (!modal || !img) return;
  modal.style.display = "flex";
  img.src = "";
  if (info) info.textContent = "Memuat...";
  try {
    const r = await authFetch(`/screenshots/${username}/${index}?date=${date}`);
    if (!r.ok) { modal.style.display = "none"; showToast("❌ Gagal memuat gambar","error"); return; }
    const d = await r.json();
    img.src = d.image;
    const waktu = new Date(d.ts).toLocaleString("id-ID",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
    if (info) info.textContent = `🖥️ ${username} · ${waktu}`;
  } catch { modal.style.display = "none"; }
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const m = document.getElementById("ss-modal");
    if (m && m.style.display !== "none") m.style.display = "none";
  }
});

// Tambahkan menu-screenshot ke settingMap (patch applyMenuAccess)
const _origApplyMenuAccess = applyMenuAccess;
applyMenuAccess = window.applyMenuAccess = function() {
  _origApplyMenuAccess();
  const elSS = document.getElementById("menu-screenshot");
  // Tampil untuk owner/admin/manager (level <= 3) ATAU jika ada di userMenus
  if (elSS) elSS.classList.toggle("hidden", userLevel > 3 && !userMenus.includes("screenshot"));
};

// Juga load status toggle saat app start
const _origAfterLogin_ss = typeof afterLogin === "function" ? afterLogin : null;

window.loadScreenshots            = loadScreenshots;
window.ssSelectUser               = ssSelectUser;
window.ssOpenModal                = ssOpenModal;
window.loadScreenshotActiveList   = loadScreenshotActiveList;
window.ssPopulateUserSelect       = ssPopulateUserSelect;
window.loadScreenshotToggle       = loadScreenshotToggle;
window.renderScreenshotToggle     = renderScreenshotToggle;
window.toggleScreenshotFeature    = toggleScreenshotFeature;
window.ssLoadDateChips            = ssLoadDateChips;

// ============================================================
// MONITOR AKTIVITAS — Tab Switcher
// ============================================================
function switchMonitorTab(tab) {
  const isLayar = tab === "layar";
  document.getElementById("panel-monitor-layar").style.display = isLayar ? "block" : "none";
  document.getElementById("panel-foto-kerja").style.display    = isLayar ? "none"  : "block";

  const btnLayar = document.getElementById("tab-monitor-layar");
  const btnFoto  = document.getElementById("tab-foto-kerja");
  const activeStyle   = "background:linear-gradient(135deg,#1a237e,#4f8ef7);color:white;";
  const inactiveStyle = "background:transparent;color:#95a5a6;";
  if (btnLayar) btnLayar.style.cssText += isLayar ? activeStyle : inactiveStyle;
  if (btnFoto)  btnFoto.style.cssText  += isLayar ? inactiveStyle : activeStyle;

  if (!isLayar) {
    wpSetDateToday();
    wpLoadDateChips();
    wpPopulateUserSelect();
    loadWorkPhotoList();
  }
}
window.switchMonitorTab = switchMonitorTab;

// ============================================================
// FOTO KERJA — loader & viewer
// ============================================================
// ── Helpers tanggal untuk Foto Kerja ──
function wpGetDate() {
  const inp = document.getElementById("wp-pilih-tanggal");
  return inp && inp.value ? inp.value : todayLocalStr();
}
function wpSetDateToday() {
  const inp = document.getElementById("wp-pilih-tanggal");
  if (inp) inp.value = todayLocalStr();
}
function wpOnDateChange() {
  const date = wpGetDate();
  const isToday = date === todayLocalStr();
  const titleEl = document.getElementById("wp-user-list-title");
  if (titleEl) {
    titleEl.textContent = isToday
      ? "📋 Foto Kegiatan Hari Ini"
      : `📋 Foto Kegiatan — ${new Date(date).toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}`;
  }
  wpActiveUser = null;
  const wrap = document.getElementById("wp-grid-wrap");
  if (wrap) wrap.style.display = "none";
  loadWorkPhotoList();
  wpPopulateUserSelect();
}
function wpRefreshAll() {
  loadWorkPhotoList(true);
  wpPopulateUserSelect();
  wpLoadDateChips();
}
async function wpLoadDateChips() {
  const chipsEl = document.getElementById("wp-date-chips");
  if (!chipsEl) return;
  const today = todayLocalStr();
  const chips = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    chips.push(d.toLocaleDateString("sv-SE"));
  }
  chipsEl.innerHTML = chips.map(date => {
    const isToday = date === today;
    const label = isToday ? "Hari ini" : new Date(date).toLocaleDateString("id-ID",{weekday:"short",day:"numeric",month:"short"});
    return `<button onclick="wpSetDate('${date}')" id="wp-chip-${date}"
      style="padding:6px 12px;border:none;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;
             white-space:nowrap;flex-shrink:0;
             background:${isToday?'#8e44ad':'#e8ecf0'};color:${isToday?'white':'var(--text)'};
             transition:.15s;" data-date="${date}">${label}</button>`;
  }).join("");
}
function wpSetDate(date) {
  const inp = document.getElementById("wp-pilih-tanggal");
  if (inp) inp.value = date;
  document.querySelectorAll("#wp-date-chips button").forEach(b => {
    const isActive = b.dataset.date === date;
    b.style.background = isActive ? "#8e44ad" : "#e8ecf0";
    b.style.color = isActive ? "white" : "var(--text)";
  });
  wpOnDateChange();
}
window.wpSetDate = wpSetDate;
window.wpOnDateChange = wpOnDateChange;
window.wpRefreshAll = wpRefreshAll;

async function wpPopulateUserSelect() {
  const sel  = document.getElementById("wp-pilih-user");
  const date = wpGetDate();
  if (!sel) return;
  sel.onchange = function() { _applySelectPlaceholderColor(sel); wpOnDateChange(); };
  try {
    const endpoint = date === todayLocalStr() ? "/work-photos/today" : `/work-photos/list-users?date=${date}`;
    const r = await authFetch(endpoint);
    if (!r.ok) return;
    const list = await r.json();
    // Urutkan: alfabetis nama A→Z
    list.sort((a, b) => a.namaLengkap.localeCompare(b.namaLengkap, 'id'));
    const prev = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    list.forEach(u => {
      const o = document.createElement("option");
      o.value = u.username;
      o.textContent = `${u.namaLengkap} (${u.totalPhotos || 0} foto)`;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
    _applySelectPlaceholderColor(sel);
  } catch {}
}

async function loadWorkPhotoList(silent = false) {
  const el   = document.getElementById("wp-user-list");
  const date = wpGetDate();
  const isToday = date === todayLocalStr();
  if (!el) return;
  // Reset state aktif saat list di-refresh
  wpActiveUser = null;
  const wrap = document.getElementById("wp-grid-wrap");
  if (wrap) wrap.style.display = "none";
  if (!silent) el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:12px 0;">Memuat...</p>';
  try {
    const endpoint = isToday ? "/work-photos/today" : `/work-photos/list-users?date=${date}`;
    const r = await authFetch(endpoint);
    if (!r.ok) { el.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:12px;">Gagal memuat data</p>'; return; }
    const list = await r.json();
    const emptyMsg = isToday ? "Belum ada foto kegiatan hari ini" : "Tidak ada foto kegiatan pada tanggal ini";
    if (!list.length) {
      el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:12px 0;">${emptyMsg}</p>`;
      return;
    }
    el.innerHTML = list.map(u => {
      const lastFmt = u.lastPhoto
        ? new Date(u.lastPhoto).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
        : "--:--";
      return `
        <div id="wp-row-${u.username}" onclick="wpSelectUser('${u.username}')"
          style="display:flex;align-items:center;gap:12px;padding:10px 12px;
                 border-bottom:1px solid #f5f5f5;cursor:pointer;transition:background .15s;border-radius:10px;"
          onmouseover="this.style.background='#f9f9f9'" onmouseout="this.id===('wp-row-'+wpActiveUser)?this.style.background='#f3e5f5':this.style.background='white'">
          <div style="width:38px;height:38px;border-radius:50%;background:#8e44ad;color:white;
                      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;">
            ${(u.namaLengkap || u.username).charAt(0).toUpperCase()}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;">${u.namaLengkap}</div>
            <div style="font-size:11px;color:var(--muted);">${u.jabatan || ""}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="display:inline-block;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:700;
                        background:#f3e5f522;color:#8e44ad;">
              📸 ${u.totalPhotos} foto
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:3px;">terakhir ${lastFmt}</div>
          </div>
          <div id="wp-chevron-${u.username}" style="font-size:16px;color:#ccc;margin-left:4px;transition:transform .2s;">›</div>
        </div>`;
    }).join("");
    await wpPopulateUserSelect();
  } catch {
    el.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:12px;">Terjadi kesalahan</p>';
  }
}

let wpActiveUser = null; // track username yang sedang terbuka

function wpSelectUser(username) {
  const wrap = document.getElementById("wp-grid-wrap");

  // Jika klik user yang sama dan grid sedang tampil → tutup (toggle off)
  if (wpActiveUser === username && wrap && wrap.style.display !== "none") {
    wrap.style.display = "none";
    // Reset highlight & chevron
    const prevRow  = document.getElementById(`wp-row-${username}`);
    const prevChev = document.getElementById(`wp-chevron-${username}`);
    if (prevRow)  { prevRow.style.background = "white"; prevRow.onmouseout = function(){ this.style.background="white"; }; }
    if (prevChev) { prevChev.style.transform = "rotate(0deg)"; prevChev.style.color = "#ccc"; }
    wpActiveUser = null;
    return;
  }

  // Tutup highlight user sebelumnya jika ada
  if (wpActiveUser && wpActiveUser !== username) {
    const oldRow  = document.getElementById(`wp-row-${wpActiveUser}`);
    const oldChev = document.getElementById(`wp-chevron-${wpActiveUser}`);
    if (oldRow)  { oldRow.style.background = "white"; oldRow.onmouseout = function(){ this.style.background="white"; }; }
    if (oldChev) { oldChev.style.transform = "rotate(0deg)"; oldChev.style.color = "#ccc"; }
  }

  // Set highlight & chevron user baru
  const newRow  = document.getElementById(`wp-row-${username}`);
  const newChev = document.getElementById(`wp-chevron-${username}`);
  if (newRow)  { newRow.style.background = "#f3e5f5"; newRow.onmouseout = function(){}; }
  if (newChev) { newChev.style.transform = "rotate(90deg)"; newChev.style.color = "#8e44ad"; }

  wpActiveUser = username;
  const sel = document.getElementById("wp-pilih-user");
  if (sel) sel.value = username;
  loadWorkPhotos();
}

async function loadWorkPhotos(silent = false) {
  const sel      = document.getElementById("wp-pilih-user");
  const username = sel ? sel.value : "";
  if (!username) { showToast("⚠️ Pilih karyawan terlebih dahulu", "warning"); return; }

  const date  = wpGetDate();
  const wrap  = document.getElementById("wp-grid-wrap");
  const grid  = document.getElementById("wp-grid");
  const empty = document.getElementById("wp-grid-empty");
  const title = document.getElementById("wp-grid-title");
  const count = document.getElementById("wp-grid-count");
  if (!wrap || !grid) return;

  wrap.style.display = "block";
  if (!silent) grid.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;grid-column:1/-1;">Memuat...</p>';
  if (empty) empty.style.display = "none";

  try {
    const r = await authFetch(`/work-photos/${username}?date=${date}`);
    if (!r.ok) { grid.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:20px;grid-column:1/-1;">Gagal memuat</p>'; return; }
    const photos = await r.json();
    const dateFmt = new Date(date).toLocaleDateString("id-ID",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
    if (title) title.textContent = `📸 ${username} — ${dateFmt}`;
    if (!photos.length) {
      grid.innerHTML = "";
      if (empty) { empty.style.display = "block"; empty.textContent = `Tidak ada foto untuk ${username} pada ${dateFmt}.`; }
      if (count) count.textContent = "0 foto";
      return;
    }
    if (count) count.textContent = `${photos.length} foto`;
    grid.innerHTML = photos.map((p, i) => {
      const waktu = new Date(p.ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      return `
        <div id="wp-thumb-${i}" onclick="wpOpenModal(${i},'${username}','${date}')"
          style="border-radius:10px;overflow:hidden;background:#f0f2f5;cursor:pointer;
                 position:relative;aspect-ratio:4/3;display:flex;align-items:center;
                 justify-content:center;transition:transform .15s;box-shadow:0 2px 8px rgba(0,0,0,.08);"
          onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
          <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.6));
                      padding:4px 6px;color:white;font-size:10px;font-weight:700;">${waktu}</div>
          <span style="font-size:28px;color:#bbb;" id="wp-loading-${i}">⏳</span>
        </div>`;
    }).join("");
    for (const p of photos) wpLoadThumb(p.index, username, date);
  } catch {
    grid.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:20px;grid-column:1/-1;">Terjadi kesalahan</p>';
  }
}

async function wpLoadThumb(index, username, date) {
  date = date || wpGetDate();
  try {
    const r = await authFetch(`/work-photos/${username}/${index}?date=${date}`);
    if (!r.ok) return;
    const d     = await r.json();
    const thumb = document.getElementById(`wp-thumb-${index}`);
    const load  = document.getElementById(`wp-loading-${index}`);
    if (!thumb || !d.image) return;
    if (load) load.remove();
    const img = document.createElement("img");
    img.src = d.image;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;position:absolute;inset:0;";
    thumb.insertBefore(img, thumb.firstChild);
  } catch {}
}

async function wpOpenModal(index, username, date) {
  date = date || wpGetDate();
  const modal = document.getElementById("ss-modal"); // reuse modal yang sama
  const img   = document.getElementById("ss-modal-img");
  const info  = document.getElementById("ss-modal-info");
  if (!modal || !img) return;
  modal.style.display = "flex";
  img.src = "";
  if (info) info.textContent = "Memuat...";
  try {
    const r = await authFetch(`/work-photos/${username}/${index}?date=${date}`);
    if (!r.ok) { modal.style.display = "none"; showToast("❌ Gagal memuat gambar", "error"); return; }
    const d = await r.json();
    img.src = d.image;
    const waktu = new Date(d.ts).toLocaleString("id-ID", { day: "2-digit", month: "short", year:"numeric", hour: "2-digit", minute: "2-digit" });
    if (info) info.textContent = `📸 Foto Kerja — ${username} · ${waktu}`;
  } catch { modal.style.display = "none"; }
}

window.switchMonitorTab     = switchMonitorTab;
window.wpPopulateUserSelect = wpPopulateUserSelect;
window.loadWorkPhotoList    = loadWorkPhotoList;
window.wpSelectUser         = wpSelectUser;
window.loadWorkPhotos       = loadWorkPhotos;
window.wpOpenModal          = wpOpenModal;
window.wpLoadDateChips      = wpLoadDateChips;

// ============================================================
// TOGGLE FITUR FOTO KERJA
// ============================================================
let _wpFeatureEnabled = true; // default aktif

async function loadWorkPhotoToggle() {
  try {
    const r = await authFetch("/app-settings");
    if (!r.ok) return;
    const d = await r.json();
    _wpFeatureEnabled = d.workPhotoEnabled !== false; // default true
    renderWorkPhotoToggle(_wpFeatureEnabled);
  } catch {}
}

function renderWorkPhotoToggle(enabled) {
  const label  = document.getElementById("wp-toggle-label");
  const sub    = document.getElementById("wp-toggle-sub");
  const sw     = document.getElementById("wp-toggle-switch");
  const knob   = document.getElementById("wp-toggle-knob");
  if (!label || !sw || !knob) return;
  label.textContent  = enabled ? "📸 Foto Kerja Aktif" : "📸 Foto Kerja Nonaktif";
  if (sub) sub.textContent = enabled
    ? "Pop-up foto muncul saat mobile Clock Out"
    : "Pop-up foto tidak ditampilkan ke karyawan";
  sw.style.background  = enabled ? "var(--primary)" : "#ccc";
  knob.style.left      = enabled ? "27px" : "3px";
}

async function toggleWorkPhotoFeature() {
  const newState = !_wpFeatureEnabled;
  try {
    const r = await authFetch("/app-settings/work-photo-toggle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ enabled: newState })
    });
    const d = await r.json();
    if (d.status === "OK") {
      _wpFeatureEnabled = newState;
      renderWorkPhotoToggle(newState);
      showToast(newState ? "✅ Foto Kerja diaktifkan" : "🔕 Foto Kerja dinonaktifkan");
    }
  } catch { showToast("❌ Gagal mengubah pengaturan", "error"); }
}

window.loadWorkPhotoToggle   = loadWorkPhotoToggle;
window.renderWorkPhotoToggle = renderWorkPhotoToggle;
window.toggleWorkPhotoFeature = toggleWorkPhotoFeature;

// ============================================================
// TOGGLE AUTO TUTUP KEKURANGAN JAM DARI OVERTIME
// ============================================================
let _atoFeatureEnabled = false; // default nonaktif

async function loadAutoTutupOvertimeToggle() {
  try {
    const r = await authFetch("/app-settings");
    if (!r.ok) return;
    const d = await r.json();
    _atoFeatureEnabled = d.autoTutupOvertimeEnabled === true; // default false
    renderAutoTutupOvertimeToggle(_atoFeatureEnabled);
  } catch {}
}

function renderAutoTutupOvertimeToggle(enabled) {
  const label = document.getElementById("ato-toggle-label");
  const sub   = document.getElementById("ato-toggle-sub");
  const sw    = document.getElementById("ato-toggle-switch");
  const knob  = document.getElementById("ato-toggle-knob");
  if (!label || !sw || !knob) return;
  if (enabled) {
    label.textContent   = "✅ Fitur Aktif";
    label.style.color   = "#27ae60";
    sub.textContent     = "Kekurangan jam otomatis ditutupi dari saldo overtime tiap tgl 1 jam 06:00";
    sw.style.background = "#27ae60";
    knob.style.left     = "27px";
  } else {
    label.textContent   = "⛔ Fitur Nonaktif";
    label.style.color   = "#95a5a6";
    sub.textContent     = "Kekurangan jam tidak otomatis ditutupi dari overtime";
    sw.style.background = "#ccc";
    knob.style.left     = "3px";
  }
}

async function toggleAutoTutupOvertime() {
  if (userLevel > 1) { showToast("⛔ Hanya Owner yang dapat mengubah pengaturan ini", "error"); return; }
  const newState = !_atoFeatureEnabled;
  try {
    const r = await authFetch("/app-settings/auto-tutup-overtime-toggle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newState }),
    });
    if (!r.ok) { showToast("❌ Gagal menyimpan", "error"); return; }
    _atoFeatureEnabled = newState;
    renderAutoTutupOvertimeToggle(newState);
    showToast(newState ? "✅ Auto Tutup Overtime diaktifkan" : "🔕 Auto Tutup Overtime dinonaktifkan");
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

window.loadAutoTutupOvertimeToggle    = loadAutoTutupOvertimeToggle;
window.renderAutoTutupOvertimeToggle  = renderAutoTutupOvertimeToggle;
window.toggleAutoTutupOvertime        = toggleAutoTutupOvertime;
