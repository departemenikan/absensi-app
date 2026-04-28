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
  if (viewId === "view-rekap")          loadRekap();
  if (viewId === "view-admin")          loadAdmin();
  if (viewId === "view-aktivitas")      loadAktivitas();
  if (viewId === "view-aksesibilitas")  loadGroups();
  if (viewId === "view-area") {
    loadAreas();
    setTimeout(() => {
      if (!_areaMap) {
        const defLat = -8.6500000, defLng = 115.2200000;
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            p => initAreaMap(p.coords.latitude, p.coords.longitude),
            () => initAreaMap(defLat, defLng),
            { enableHighAccuracy: true, timeout: 5000 }
          );
        } else {
          initAreaMap(defLat, defLng);
        }
      } else {
        _areaMap.invalidateSize();
      }
    }, 200);
  }
  if (viewId === "view-libur")      loadLibur();
  if (viewId === "view-anggota")    { loadAnggota(); }
  if (viewId === "view-profil")     loadProfil();
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
  const ex = document.getElementById("signup-extra-fields");
  if (ex) ex.classList.toggle("hidden", isLoginMode);
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
    const namaLengkap = (document.getElementById("signup-nama")?.value || "").trim();
    const agama       = document.getElementById("signup-agama")?.value || "";
    const r = await fetch("/signup", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({username:u, password:p, faceDescriptor:Array.from(descriptor), namaLengkap, agama}) });
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
  // Timesheet & Cuti selalu tampil (seperti Beranda), Setting dikontrol hak akses
  document.getElementById("nav-timesheet").classList.remove("hidden");
  document.getElementById("nav-cuti").classList.remove("hidden");
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
    "menu-anggota":       "anggota",
    "menu-area":          "area",
    "menu-libur":         "libur",
    "menu-aktivitas":     "aktivitas",
    "menu-rekap":         "rekap",
    "menu-aksesibilitas": "aksesibilitas",
  };
  Object.entries(map).forEach(([elId, menuKey]) => {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle("hidden", !userMenus.includes(menuKey));
  });
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
       <button class="u-modal-eye" tabindex="-1" onclick="_uToggleEye('u-pw-new',this)">👁️</button>
     </div>
     <div class="u-modal-input-wrap">
       <input class="u-modal-input" id="u-pw-cfm" type="password" placeholder="Konfirmasi password baru" autocomplete="new-password">
       <button class="u-modal-eye" tabindex="-1" onclick="_uToggleEye('u-pw-cfm',this)">👁️</button>
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
  btn.textContent = show ? "🙈" : "👁️";
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
    const now = new Date().toISOString();
    const r = await fetch("/absen", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({user, type, time: now, lat:loc.lat, lng:loc.lng, photo}) });
    const d = await r.json();
    if (d.status === "OK") {
      const msgs = {IN:"✅ Clock In berhasil!",OUT:"👋 Clock Out berhasil!",BREAK_START:"☕ Selamat istirahat!",BREAK_END:"💪 Lanjut kerja!"};
      showToast(msgs[type] || "✅ Berhasil!");
      // Update record lokal langsung agar ticker responsif
      updateLocalRecord(type, now);
      loadStatus();
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

// ─── REALTIME TICKER ───────────────────────────────────────
let _tickerInterval = null;
let _todayRec       = null;   // record absensi hari ini (cache)

// Format detik → HH:MM:SS
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// Format detik → MM:SS (untuk istirahat, biasanya < 1 jam cukup tapi tetap HH:MM:SS)
function fmtBreak(sec) { return fmtDuration(sec); }

// Hitung total detik istirahat dari array breaks (termasuk break yg masih berjalan)
function hitungBreakDetik(breaks) {
  const now = Date.now();
  return (breaks || []).reduce((total, b) => {
    const start = new Date(b.start).getTime();
    const end   = b.end ? new Date(b.end).getTime() : now;
    return total + Math.max(0, (end - start) / 1000);
  }, 0);
}

// Hitung durasi kerja bersih (detik)
function hitungKerjaDetik(rec) {
  if (!rec || !rec.jamMasuk) return 0;
  const now      = Date.now();
  const masuk    = new Date(rec.jamMasuk).getTime();
  const keluar   = rec.jamKeluar ? new Date(rec.jamKeluar).getTime() : now;
  const totalSec = Math.max(0, (keluar - masuk) / 1000);
  const breakSec = hitungBreakDetik(rec.breaks);
  return Math.max(0, totalSec - breakSec);
}

// Update tampilan kotak Hari Ini
function updateTodayUI(rec) {
  const elIn       = document.getElementById("t-in");
  const elOut      = document.getElementById("t-out");
  const elIstirahat= document.getElementById("t-istirahat");
  const elDur      = document.getElementById("t-dur");

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

// Mulai ticker realtime (update setiap detik)
function startTicker(rec) {
  stopTicker();
  _todayRec = rec;
  updateTodayUI(rec);

  // Jika sudah clock out, tidak perlu ticker
  if (rec && rec.jamKeluar) return;

  _tickerInterval = setInterval(() => {
    // Cek reset tengah malam
    const today = new Date().toISOString().split("T")[0];
    if (_todayRec && _todayRec.date && _todayRec.date !== today) {
      stopTicker();
      resetTodayUI();
      return;
    }
    updateTodayUI(_todayRec);
  }, 1000);
}

function stopTicker() {
  if (_tickerInterval) { clearInterval(_tickerInterval); _tickerInterval = null; }
}

function resetTodayUI() {
  _todayRec = null;
  updateTodayUI(null);
}

// Muat data hari ini dari server lalu mulai ticker
async function loadTodayDetail() {
  const user  = localStorage.getItem("user");
  const today = new Date().toISOString().split("T")[0];
  try {
    const r   = await fetch("/history/" + user);
    const d   = await r.json();
    const rec = d.find(x => x.date === today) || null;
    startTicker(rec);
  } catch {
    startTicker(null);
  }
}

// Saat status absen berubah (clock in/out/break), update record lokal langsung
// agar ticker tidak perlu nunggu fetch berikutnya
function updateLocalRecord(type, time) {
  if (!_todayRec) {
    if (type === "IN") {
      _todayRec = {
        date:      new Date().toISOString().split("T")[0],
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
  } else if (type === "BREAK_START") {
    _todayRec.breaks.push({ start: time, end: null });
  } else if (type === "BREAK_END") {
    const lb = _todayRec.breaks.at(-1);
    if (lb && !lb.end) lb.end = time;
  }
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
  document.getElementById("panel-divisi").classList.toggle("hidden", isDaftar);
  document.getElementById("tab-daftar").style.background = isDaftar ? "var(--primary)" : "white";
  document.getElementById("tab-daftar").style.color      = isDaftar ? "white" : "var(--muted)";
  document.getElementById("tab-divisi").style.background = isDaftar ? "white" : "var(--primary)";
  document.getElementById("tab-divisi").style.color      = isDaftar ? "var(--muted)" : "white";
  if (!isDaftar) loadDivisi();
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
      fetch("/anggota"), fetch("/groups"), fetch("/divisi")
    ]);
    _anggotaData   = await anggotaRes.json();
    _anggotaGroups = await groupsRes.json();
    _anggotaDivisi = await divisiRes.json();
    _divisiList    = _anggotaDivisi; // sinkronkan cache _divisiList agar renderAnggotaTable bisa baca

    // Isi filter Peran
    const selPeran = document.getElementById("anggota-filter-peran");
    if (selPeran) {
      selPeran.innerHTML = '<option value="">Peran ▾</option>' +
        _anggotaGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    }
    // Isi filter Grup/Divisi
    const selDiv = document.getElementById("anggota-filter-divisi");
    if (selDiv) {
      selDiv.innerHTML = '<option value="">Grup ▾</option>' +
        _anggotaDivisi.map(d => `<option value="${d.nama}">${d.nama}</option>`).join('');
    }
    // Tombol Tambahkan Anggota — hanya owner/admin
    const btnTambah = document.getElementById("btn-tambah-anggota");
    if (btnTambah) btnTambah.style.display = userLevel <= 2 ? "inline-block" : "none";

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

    // Avatar: foto atau inisial
    const avStyle = `width:40px;height:40px;border-radius:50%;flex-shrink:0;object-fit:cover;`;
    const avatar  = m.photo
      ? `<img src="${m.photo}" style="${avStyle}">`
      : `<div style="${avStyle}background:${m.groupColor||'#7f8c8d'};color:white;
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
            <div style="font-size:13px;font-weight:700;color:#111;white-space:nowrap;
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
  const q     = (document.getElementById("anggota-search")?.value || "").toLowerCase();
  const peran = document.getElementById("anggota-filter-peran")?.value  || "";
  const div   = document.getElementById("anggota-filter-divisi")?.value || "";
  const out   = _anggotaData.filter(m => {
    const nama = (m.namaLengkap || m.username).toLowerCase();
    return (!q     || nama.includes(q) || m.username.toLowerCase().includes(q))
        && (!peran || m.group  === peran)
        && (!div   || m.divisi === div);
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
      fetch("/anggota"), fetch("/groups"), fetch("/divisi")
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
    avEl.style.background = m.groupColor || "#7f8c8d";
  }

  // --- Teks info ---
  document.getElementById("da-nama").textContent    = nama;
  document.getElementById("da-jabatan").textContent = m.jabatan || "—";
  // Divisi bisa array — tampilkan semua
  const divisiArr = Array.isArray(m.divisi) ? m.divisi : (m.divisi ? [m.divisi] : []);
  document.getElementById("da-divisi").textContent  = divisiArr.length ? divisiArr.join(", ") : "—";
  document.getElementById("da-lastseen").textContent = timeAgo(m.lastSeen);

  // Badge peran
  const badge = document.getElementById("da-peran-badge");
  badge.textContent   = m.groupName;
  badge.style.background = (m.groupColor || "#7f8c8d") + "22";
  badge.style.color      = m.groupColor || "#7f8c8d";

  // Badge Tugas Luar
  const tlBadge = document.getElementById("da-status-badge");
  tlBadge.style.display = m.statusKerja === "Tugas Luar" ? "inline-block" : "none";

  // --- Section Edit (owner=1 / admin=2 saja) ---
  const editSec = document.getElementById("da-edit-section");
  const isSelf  = username === localStorage.getItem("user");

  if (userLevel <= 2) {
    editSec.style.display = "block";

    // Checkbox Tugas Luar
    document.getElementById("da-chk-tugasluar").checked = m.statusKerja === "Tugas Luar";

    // Dropdown Peran — hanya Owner dan Admin (level 1 & 2)
    const selGroup = document.getElementById("da-select-group");
    const peranGroups = _anggotaGroups.filter(g => g.id === "owner" || g.id === "admin");
    selGroup.innerHTML = peranGroups.map(g =>
      `<option value="${g.id}" ${g.id === m.group ? "selected" : ""}>${g.name}</option>`
    ).join('');
    // Tambahkan opsi Anggota (non-admin) jika group saat ini bukan owner/admin
    if (m.group !== "owner" && m.group !== "admin") {
      selGroup.innerHTML += `<option value="${m.group}" selected>${m.groupName} (Bukan Owner/Admin)</option>`;
      // Untuk mengubah peran, tampilkan semua group
      selGroup.innerHTML = _anggotaGroups.map(g =>
        `<option value="${g.id}" ${g.id === m.group ? "selected" : ""}>${g.name}</option>`
      ).join('');
    }

    // Dropdown Divisi — multi-select dengan checkbox
    const selDiv = document.getElementById("da-select-divisi");
    const divisiArrM = Array.isArray(m.divisi) ? m.divisi : (m.divisi ? [m.divisi] : []);
    selDiv.innerHTML = '<option value="">— Tanpa Divisi —</option>' +
      _anggotaDivisi.map(d =>
        `<option value="${d.nama}" ${divisiArrM.includes(d.nama) ? "selected" : ""}>${d.nama}</option>`
      ).join('');
    // Aktifkan multiple select
    selDiv.setAttribute("multiple", "true");
    selDiv.style.height = Math.min(_anggotaDivisi.length * 34 + 34, 150) + "px";

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

// Live preview badge Tugas Luar saat checkbox berubah
function onToggleTugasLuar(cb) {
  document.getElementById("da-status-badge").style.display = cb.checked ? "inline-block" : "none";
}

async function saveDetailAnggota() {
  if (!_detailUsername) return;
  const groupId   = document.getElementById("da-select-group").value;
  const tugasLuar = document.getElementById("da-chk-tugasluar").checked;
  const statusKerja = tugasLuar ? "Tugas Luar" : "";

  // Ambil semua divisi yang dipilih (multi-select)
  const selDiv    = document.getElementById("da-select-divisi");
  const divisiList = [...selDiv.selectedOptions]
    .map(o => o.value)
    .filter(v => v !== "");

  try {
    await Promise.all([
      fetch(`/anggota/${_detailUsername}/group`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: groupId })
      }),
      fetch(`/anggota/${_detailUsername}/divisi`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", divisiList })
      }),
      fetch(`/anggota/${_detailUsername}/status`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusKerja })
      }),
    ]);
    showToast("✅ Data anggota berhasil diperbarui");
    closeDetailAnggota();
    loadAnggota();
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function deleteAnggotaFromModal() {
  const username = _detailUsername;
  if (!username) return;
  uConfirm({
    icon: "👤", title: "Hapus Anggota",
    msg: `Hapus akun <b>${username}</b>?<br>Data absensi akan tetap tersimpan.`,
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await fetch(`/anggota/${username}`, { method: "DELETE" });
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
    const r = await fetch(`/anggota/${username}/group`, {
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
        const r = await fetch(`/anggota/${username}`, { method: "DELETE" });
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
    const [divisiRes, usersRes] = await Promise.all([fetch("/divisi"), fetch("/anggota")]);
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

// ---- MODAL: BUAT GRUP ----
// State terpilih anggota
let _bgSelectedAnggota = []; // array username

async function openBuatGrup() {
  if (userLevel > 2) { showToast("⛔ Hanya Owner/Admin yang bisa membuat divisi", "error"); return; }
  if (!_anggotaAll.length) {
    const r = await fetch("/anggota"); _anggotaAll = await r.json();
  }

  // Reset state
  _bgSelectedAnggota = [];
  document.getElementById("bg-nama").value = "";
  document.getElementById("bg-anggota-search").value = "";
  document.getElementById("bg-anggota-panel").style.display = "none";
  _renderAnggotaDropdownItems(_anggotaAll.filter(a => a.group !== "owner"));
  _renderAnggotaTags();

  // Dropdown Owner: semua user group "owner"
  const ownerList = _anggotaAll.filter(a => a.group === "owner");
  document.getElementById("bg-owner").innerHTML =
    '<option value="">— Pilih Owner —</option>' +
    ownerList.map(a => `<option value="${a.username}">${a.namaLengkap || a.username}</option>`).join('');

  // Dropdown Manager & Koordinator: semua anggota
  const allList = _anggotaAll;
  const opts = '<option value="">— Pilih —</option>' +
    allList.map(a => `<option value="${a.username}">${a.namaLengkap || a.username} (${a.jabatan || a.groupName || a.group})</option>`).join('');
  document.getElementById("bg-manager").innerHTML    = opts.replace('— Pilih —', '— Pilih Manager —');
  document.getElementById("bg-koordinator").innerHTML = opts.replace('— Pilih —', '— Pilih Koordinator —');

  document.getElementById("modal-buat-grup").style.display = "flex";

  // Tutup dropdown jika klik di luar
  setTimeout(() => {
    document.addEventListener("click", _bgOutsideClick);
  }, 100);
}

function _bgOutsideClick(e) {
  const wrap = document.getElementById("bg-anggota-wrap");
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById("bg-anggota-panel").style.display = "none";
    document.removeEventListener("click", _bgOutsideClick);
  }
}

function toggleAnggotaDropdown() {
  const panel   = document.getElementById("bg-anggota-panel");
  const trigger = document.getElementById("bg-anggota-trigger");
  const isOpen  = panel.style.display !== "none";
  if (isOpen) {
    panel.style.display = "none";
    return;
  }
  // Hitung posisi trigger untuk tempatkan panel fixed tepat di bawahnya
  const rect = trigger.getBoundingClientRect();
  panel.style.top   = (rect.bottom + 4) + "px";
  panel.style.left  = rect.left + "px";
  panel.style.width = rect.width + "px";
  panel.style.display = "block";
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
    label.textContent = "— Pilih Anggota —";
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
  document.getElementById("bg-anggota-panel").style.display = "none";
  document.removeEventListener("click", _bgOutsideClick);
  _bgSelectedAnggota = [];
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
    const r = await fetch("/divisi", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nama, owner, manager, koordinator, deskripsi: "" })
    });
    const d = await r.json();
    if (d.status === "EXIST") { showToast("⚠️ Divisi sudah ada", "warning"); return; }
    if (d.status !== "OK")    { showToast("❌ Gagal membuat divisi", "error"); return; }

    // Assign semua anggota dengan action "add" → TIDAK menghapus divisi sebelumnya (multi-divisi)
    await Promise.all(checked.map(u =>
      fetch(`/anggota/${u}/divisi`, {
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
    const [divisiRes, usersRes] = await Promise.all([fetch("/divisi"), fetch("/anggota")]);
    _divisiList = await divisiRes.json();
    _anggotaAll = await usersRes.json();
  } catch { /* pakai cache */ }

  const d = _divisiList.find(x => x.id === id);
  if (!d) return;
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

    document.getElementById("dd-owner").innerHTML =
      '<option value="">— Pilih Owner —</option>' +
      ownerList.map(a => `<option value="${a.username}" ${a.username===(d.owner||'')?'selected':''}>${a.namaLengkap||a.username}</option>`).join('');

    document.getElementById("dd-manager").innerHTML =
      '<option value="">— Pilih Manager —</option>' +
      _anggotaAll.map(a => `<option value="${a.username}" ${a.username===d.manager?'selected':''}>${a.namaLengkap||a.username} (${a.jabatan||a.groupName})</option>`).join('');

    document.getElementById("dd-koordinator").innerHTML =
      '<option value="">— Pilih Koordinator —</option>' +
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
    await fetch(`/divisi/${_detailDivisiId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nama: namaBaru, owner: ownerBaru, manager: managerBaru, koordinator: koordBaru, deskripsi: d.deskripsi || "" })
    });

    // Add anggota yang dicentang (action "add" → tidak hapus divisi lain)
    await Promise.all(allToAdd.map(u => fetch(`/anggota/${u}/divisi`, {
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
          return fetch(`/anggota/${u}/divisi`, {
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

function deleteDetailDivisi() {
  const d = _divisiList.find(x => x.id === _detailDivisiId);
  if (!d) return;
  uConfirm({
    icon: "🏢", title: "Hapus Divisi",
    msg: `Hapus divisi <b>${d.nama}</b>?<br>Anggota akan dilepas dari divisi ini.`,
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await fetch(`/divisi/${_detailDivisiId}`, { method: "DELETE" });
        const res = await r.json();
        if (res.status === "OK") { showToast("🗑 Divisi dihapus"); closeDetailDivisi(); loadDivisi(); }
        else showToast("❌ Gagal menghapus", "error");
      } catch { showToast("❌ Gagal", "error"); }
    }
  });
}

async function assignDivisi(username, divisiNama) {
  try {
    const r = await fetch(`/anggota/${username}/divisi`, {
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
const ALL_MENUS = [
  { key:"home",           label:"🏠 Beranda" },
  { key:"rekap",          label:"📋 Rekap" },
  { key:"admin",          label:"👑 Admin Panel" },
  { key:"setting",        label:"⚙️ Pengaturan" },
  { key:"anggota",        label:"👥 Anggota" },
  { key:"aksesibilitas",  label:"🔐 Aksesibilitas" },
  { key:"area",           label:"📍 Area Kantor" },
  { key:"libur",          label:"📅 Hari Libur & Cuti" },
  { key:"aktivitas",      label:"📌 Aktivitas" },
  { key:"timesheet",      label:"🕐 Timesheet" },
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
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 19
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
  navigator.geolocation.getCurrentPosition(p => {
    const lat = p.coords.latitude;
    const lng = p.coords.longitude;
    if (_areaMap) {
      _areaMap.setView([lat, lng], 17);
      _setAreaMarker(lat, lng);
    } else {
      initAreaMap(lat, lng);
    }
    showToast("📍 Lokasi berhasil diambil!");
  }, null, {enableHighAccuracy:true});
}

async function saveArea() {
  const name   = document.getElementById("area-name").value.trim();
  const lat    = document.getElementById("area-lat").value;
  const lng    = document.getElementById("area-lng").value;
  const radius = document.getElementById("area-radius").value;
  if (!name || !lat || !lng) return showToast("⚠️ Isi nama area dan tentukan titik di peta!", "warning");
  try {
    const r = await fetch("/areas", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,lat,lng,radius}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Area berhasil ditambahkan!");
      document.getElementById("area-name").value = "";
      document.getElementById("area-lat").value  = "";
      document.getElementById("area-lng").value  = "";
      document.getElementById("area-coords-display").textContent = "— Belum ada titik dipilih —";
      // Reset marker & circle
      if (_areaMarker) { _areaMap.removeLayer(_areaMarker); _areaMarker = null; }
      if (_areaCircle) { _areaMap.removeLayer(_areaCircle); _areaCircle = null; }
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
  uConfirm({
    icon: "📍",
    title: "Hapus Area",
    msg: "Yakin ingin menghapus area ini?<br>Tindakan tidak bisa dibatalkan.",
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await fetch(`/areas/${id}`, {method:"DELETE"});
        if ((await r.json()).status === "OK") { showToast("🗑 Area dihapus"); loadAreas(); }
      } catch { showToast("❌ Gagal menghapus", "error"); }
    }
  });
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
  uConfirm({
    icon: "📅",
    title: "Hapus Data Libur",
    msg: "Yakin ingin menghapus data libur ini?",
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await fetch(`/libur/${id}`, {method:"DELETE"});
        if ((await r.json()).status === "OK") { showToast("🗑 Berhasil dihapus"); loadLibur(); }
      } catch {}
    }
  });
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
// PROFIL
// ============================================================
let _profilData      = null;
let _profilNewPhoto  = null; // base64 foto baru
let _profilNewFaceDesc = null; // Float32Array descriptor baru

async function loadProfil() {
  const me = localStorage.getItem("user");
  switchProfilTab("profil"); // reset ke tab profil
  try {
    const r = await fetch("/profile/" + me);
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
    const r   = await fetch("/anggota");
    const all = await r.json();
    const sel = document.getElementById("hapus-target-select");
    sel.innerHTML = '<option value="">— Pilih akun yang akan dihapus —</option>';
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
    const r = await fetch(`/profile/${me}/photo`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({photo:_profilNewPhoto}) });
    if ((await r.json()).status === "OK") {
      showToast("✅ Foto profil berhasil disimpan!");
      _profilNewPhoto = null;
      document.getElementById("profil-preview-wrap").classList.add("hidden");
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
    const r = await fetch(`/profile/${me}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({[field]:value}) });
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
        const r = await fetch(`/profile/${me}/password`, {
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
    const r = await fetch(`/profile/${me}/face`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({faceDescriptor:Array.from(_profilNewFaceDesc)}) });
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
        const r = await fetch(`/anggota/${target}`, {method:"DELETE"});
        if ((await r.json()).status === "OK") {
          showToast(`🗑 Akun "${target}" berhasil dihapus`);
          populateHapusSelect();
        } else showToast("❌ Gagal menghapus", "error");
      } catch { showToast("❌ Gagal terhubung ke server", "error"); }
    }
  });
}

// ============================================================
// INIT
// ============================================================
window.onload = async function () {
  await loadFaceModels();
  checkLoginStatus();
};