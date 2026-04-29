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
    switchAreaTab("daftar");
    loadAreas();
  }
  if (viewId === "view-libur")      loadLibur();
  if (viewId === "view-anggota")    { loadAnggota(); }
  if (viewId === "view-profil")     loadProfil();
  if (viewId === "view-tracking")   loadTracking();
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

    // Tampilkan pesan pop-up browser untuk izin kamera & lokasi
    requestPermissions().then(perms => {
      if (!perms.camera || !perms.location) {
        const missing = [];
        if (!perms.camera)   missing.push("📷 Kamera");
        if (!perms.location) missing.push("📍 Lokasi");
        if (status) status.innerText = `❌ Izin diperlukan: ${missing.join(" & ")}. Aktifkan di pengaturan browser.`;
        showToast(`⚠️ Izin ${missing.join(" & ")} diperlukan untuk Sign Up`, "warning", 5000);
        // Tetap tampilkan form tapi beri peringatan
      } else {
        if (status) status.innerText = "✅ Izin kamera & lokasi diberikan";
      }
    });

    // Mulai kamera untuk scan wajah
    startCam("video-signup").then(() => {
      const status = document.getElementById("faceStatus");
      if (status && status.innerText.startsWith("✅ Izin")) {
        waitVideoReady("video-signup", 8000)
          .then(() => { status.innerText = "✅ Kamera siap — hadapkan wajah ke kamera"; })
          .catch(() => { status.innerText = "⚠️ Gagal buka kamera. Izinkan akses kamera."; });
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
    // ─── Minta izin kamera & lokasi sebelum proses ───
    btn.innerText = "🔐 Memeriksa izin...";
    if (status) status.innerText = "🔐 Meminta izin kamera & lokasi...";

    const perms = await requestPermissions();

    if (!perms.camera && !perms.location) {
      showToast("❌ Izin kamera dan lokasi diperlukan untuk Sign Up", "error");
      if (status) status.innerText = "❌ Izin kamera & lokasi ditolak. Aktifkan di pengaturan browser lalu coba lagi.";
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }
    if (!perms.camera) {
      showToast("❌ Izin kamera diperlukan untuk Sign Up", "error");
      if (status) status.innerText = "❌ Izin kamera ditolak. Buka pengaturan browser → izinkan akses kamera.";
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }
    if (!perms.location) {
      showToast("❌ Izin lokasi diperlukan untuk Sign Up", "error");
      if (status) status.innerText = "❌ Izin lokasi ditolak. Buka pengaturan browser → izinkan akses lokasi.";
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
    const r = await fetch("/signup", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ username:u, password:p, faceDescriptor:Array.from(avgDescriptor), namaLengkap, agama })
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
  loadWeeklyInfo();
  loadHomeLibur();
  // Jika sudah clock in, mulai tracking ping
  fetch("/status/" + (localStorage.getItem("user")||""))
    .then(r => r.json())
    .then(d => { if (d.status === "IN") startTrackingPing(); })
    .catch(() => {});

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
    "menu-tracking":      "tracking",
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
// ABSENSI
// ============================================================
async function sendAbsen(type, label) {
  const user = localStorage.getItem("user");
  if (!user) return checkLoginStatus();

  // ─── Cek izin kamera ───
  let camOk = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(t => t.stop());
    camOk = true;
  } catch {
    camOk = false;
  }
  if (!camOk) {
    showToast("❌ Izin kamera diperlukan untuk absensi. Aktifkan di pengaturan browser.", "error", 5000);
    return;
  }

  // ─── Cek izin lokasi ───
  const loc = await getLoc();
  if (loc.denied) {
    showToast("❌ Izin lokasi diperlukan untuk absensi. Aktifkan di pengaturan browser.", "error", 5000);
    return;
  }

  const ok = await verifyFace(label);
  if (!ok) return;
  const photo = takePhoto();

  try {
    const now = new Date().toISOString();
    const r = await fetch("/absen", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({user, type, time: now, lat:loc.lat, lng:loc.lng, photo}) });
    const d = await r.json();
    if (d.status === "OK") {
      const msgs = {IN:"✅ Clock In berhasil!",OUT:"👋 Clock Out berhasil!",BREAK_START:"☕ Selamat istirahat!",BREAK_END:"💪 Lanjut kerja!"};
      showToast(msgs[type] || "✅ Berhasil!");
      updateLocalRecord(type, now);
      loadStatus();
      if (type === "OUT") loadWeeklyInfo();
      if (type === "IN" || type === "BREAK_END") startTrackingPing();
      if (type === "OUT") stopTrackingPing();
    } else if (d.status === "OUT_OF_AREA") {
      showToast(`❌ Di luar area kantor! Jarak ${d.distance}m dari ${d.area||"kantor"}. Gunakan status "Tugas Luar" jika bekerja di luar kantor.`, "error", 6000);
    } else if (d.status === "LOCATION_REQUIRED") {
      showToast("❌ Aktifkan layanan lokasi di perangkat Anda untuk Clock In", "error", 5000);
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
    const start = new Date(b.start).getTime();
    const end   = b.end ? new Date(b.end).getTime() : now;
    return total + Math.max(0, (end - start) / 1000);
  }, 0);
}

// Hitung durasi kerja bersih (detik) — realtime jika belum clock out
function hitungKerjaDetik(rec) {
  if (!rec || !rec.jamMasuk) return 0;
  const now      = Date.now();
  const masuk    = new Date(rec.jamMasuk).getTime();
  const keluar   = rec.jamKeluar ? new Date(rec.jamKeluar).getTime() : now;
  const totalSec = Math.max(0, (keluar - masuk) / 1000);
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
    const today = now.toISOString().split("T")[0];

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
  const thisWeek = getWeekKey(new Date().toISOString().split("T")[0]);
  if (_overtimeProcessedWeek === thisWeek) return; // sudah diproses minggu ini
  _overtimeProcessedWeek = thisWeek;

  const user = localStorage.getItem("user");
  if (!user) return;

  try {
    // Panggil endpoint server untuk hitung & simpan overtime user ini
    const tahun = new Date().getFullYear();
    const r = await fetch(`/kuota-cuti/hitung-overtime/${user}?tahun=${tahun}`, { method: "POST" });
    const d = await r.json();
    if (d.status === "OK") {
      const jam = d.jamOvertime || 0;
      if (jam > 0) {
        showToast(`⏱️ Overtime minggu ini: ${jam.toFixed(1)} jam → masuk kuota cuti overtime!`);
      }
    }
  } catch (e) {
    console.warn("Auto overtime gagal:", e);
  }
}

// ─── LOAD DATA HARI INI ─────────────────────────────────────

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

// ─── UPDATE RECORD LOKAL (tanpa fetch ulang) ────────────────

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
  const today = new Date().toISOString().split("T")[0];
  const week  = getWeekKey(today);

  try {
    const r   = await fetch("/history/" + user);
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
    var r     = await fetch('/libur');
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


// ─── Minta izin kamera + lokasi sekaligus, return {camera, location} ───
async function requestPermissions() {
  const result = { camera: false, location: false };

  // Kamera
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    result.camera = true;
    // Langsung stop — hanya untuk trigger permission
    stream.getTracks().forEach(t => t.stop());
  } catch {
    result.camera = false;
  }

  // Lokasi
  result.location = await new Promise(resolve => {
    if (!navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  return result;
}

// ─── Ambil koordinat — return null jika izin ditolak (jangan silent fallback ke 0,0) ───
async function getLoc() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ lat: 0, lng: 0, denied: true });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, denied: false }),
      err => {
        // code 1 = PERMISSION_DENIED
        resolve({ lat: 0, lng: 0, denied: err.code === 1 });
      },
      { enableHighAccuracy: true, timeout: 10000 }
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
            <span class="area-active ${a.active?'on':'off'}" onclick="toggleArea('${a.id}',${!a.active})" style="cursor:pointer;">
              ${a.active?'✅ Aktif':'❌ Nonaktif'}
            </span>
            <button onclick="deleteArea('${a.id}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>
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
    // Ambil data area dari server lalu init peta
    fetch("/areas").then(r => r.json()).then(data => {
      const a = data.find(x => x.id === id);
      if (!a) return;
      const mapEl = document.getElementById(`area-map-mini-${id}`);
      if (!mapEl) return;
      const m = L.map(`area-map-mini-${id}`, { zoomControl: true, dragging: true })
                 .setView([a.lat, a.lng], 17);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors", maxZoom: 19
      }).addTo(m);
      L.marker([a.lat, a.lng]).addTo(m)
       .bindPopup(`📍 ${a.name}<br><small>Radius: ${a.radius}m</small>`).openPopup();
      L.circle([a.lat, a.lng], {
        radius: a.radius, color: "#4f8ef7", fillColor: "#4f8ef7", fillOpacity: 0.15
      }).addTo(m);
      _areaMiniMaps[id] = m;
      setTimeout(() => m.invalidateSize(), 150);
    });
  } else if (!isOpen && _areaMiniMaps[id]) {
    setTimeout(() => _areaMiniMaps[id].invalidateSize(), 150);
  }
}

// ---- TAB SWITCHER AREA ----
function switchAreaTab(tab) {
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
      switchAreaTab("daftar");
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
    const [rLibur, rAgama] = await Promise.all([fetch("/libur"), fetch("/libur/agama-list")]);
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
          <button onclick="openImportModal('${key}')"
            style="padding:9px 14px;background:white;color:${cfg.color};border:2px solid ${cfg.color};
              border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;">
            📥 Import
          </button>
          <button onclick="openLiburModal('${key}')"
            style="padding:9px 16px;background:${cfg.color};color:white;border:none;
              border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
            ➕ Tambah Hari Libur
          </button>
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
      <button onclick="deleteLibur('${x.id}')"
        style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer;padding:2px 6px;flex-shrink:0;">🗑</button>
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
    const r = await fetch("/libur", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
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
  uConfirm({
    icon: "📅",
    title: "Hapus Data Libur",
    msg: "Yakin ingin menghapus hari libur ini?",
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await fetch(`/libur/${id}`, {method:"DELETE"});
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
    const r = await fetch("/libur/import", {
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
  document.getElementById("modal-cuti-nama").value  = "";
  document.getElementById("modal-cuti-jenis").value = "";
  setTimeout(() => document.getElementById("modal-cuti-nama").focus(), 100);
  // Tutup overlay jika klik di luar modal
  overlay.onclick = e => { if (e.target === overlay) closeKebijakanCutiModal(); };
}

function closeKebijakanCutiModal() {
  document.getElementById("kebijakan-cuti-modal-overlay").style.display = "none";
}

async function loadKebijakanCuti() {
  try {
    const r = await fetch("/kebijakan-cuti");
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

      // Label koneksi ke kuota cuti
      let kuotaBadge = "";
      if (isDefault && x.kuotaKey === "tahunan") {
        kuotaBadge = `<span style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700;
          background:#e8f5e9;color:#1b5e20;margin-left:6px;">🔗 Kuota Cuti Tahunan</span>`;
      } else if (isDefault && x.kuotaKey === "overtime") {
        kuotaBadge = `<span style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700;
          background:#fff8e1;color:#e65100;margin-left:6px;">🔗 Kuota Cuti Overtime</span>`;
      }

      // Tombol hapus: sembunyikan jika locked
      const deleteBtn = isLocked
        ? `<span title="Kebijakan default tidak dapat dihapus"
             style="font-size:18px;color:#ddd;padding:4px 6px;flex-shrink:0;">🔒</span>`
        : `<button onclick="deleteKebijakanCuti('${x.id}')"
             style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer;
                    padding:4px 6px;flex-shrink:0;border-radius:8px;"
             title="Hapus kebijakan ini">🗑</button>`;

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
  const nama  = document.getElementById("modal-cuti-nama").value.trim();
  const jenis = document.getElementById("modal-cuti-jenis").value;

  if (!nama)  return showToast("⚠️ Isi nama cuti!", "warning");
  if (!jenis) return showToast("⚠️ Pilih jenis cuti!", "warning");

  const payload = {
    nama,
    jenis,          // "kuota" | "non-kuota"
    berlaku: "semua",
  };

  try {
    const r = await fetch("/kebijakan-cuti", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    if ((await r.json()).status === "OK") {
      showToast("✅ Kebijakan cuti berhasil ditambahkan!");
      closeKebijakanCutiModal();
      loadKebijakanCuti();
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function deleteKebijakanCuti(id) {
  uConfirm({
    icon: "🌴",
    title: "Hapus Kebijakan Cuti",
    msg: "Yakin ingin menghapus kebijakan cuti ini?",
    btnOk: "Hapus", btnOkClass: "danger",
    onOk: async () => {
      try {
        const r = await fetch(`/kebijakan-cuti/${id}`, {method:"DELETE"});
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
// ================================================================
// TIMESHEET MINGGUAN
// ================================================================

let _tsWeekStart  = null;  // "YYYY-MM-DD" (Senin minggu ini)
let _tsData       = null;  // response dari /timesheet/weekly
let _tsCurrent    = null;  // {username, date} untuk modal edit

const DOW_LABEL = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
const DOW_COLOR = { 0:"#e53935", 6:"#9c27b0" }; // Minggu merah, Sabtu ungu

function tsGetMonday(d = new Date()) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon.toISOString().split("T")[0];
}

function tsNavWeek(delta) {
  const d = new Date(_tsWeekStart + "T00:00:00");
  d.setDate(d.getDate() + delta * 7);
  _tsWeekStart = d.toISOString().split("T")[0];
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
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(isoStr) {
  if (!isoStr) return "--:--";
  // bisa berupa "HH:MM" atau ISO full
  if (isoStr.includes("T")) return isoStr.slice(11, 16);
  return isoStr.slice(0, 5);
}

async function loadTimesheet() {
  const me = localStorage.getItem("user");
  if (!_tsWeekStart) _tsWeekStart = tsGetMonday();

  // Update label minggu
  const mon = new Date(_tsWeekStart + "T00:00:00");
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => `${d.getDate()} ${["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"][d.getMonth()]} ${d.getFullYear()}`;
  const lbl = document.getElementById("ts-week-label");
  if (lbl) lbl.textContent = `${fmt(mon)} – ${fmt(sun)}`;

  const el = document.getElementById("ts-content");
  if (el) el.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Memuat...</p>`;

  try {
    const r = await fetch(`/timesheet/weekly?weekStart=${_tsWeekStart}&requester=${me}`);
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
    const isToday = date === new Date().toISOString().split("T")[0];
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
      const isToday  = day.date === new Date().toISOString().split("T")[0];
      const dow      = day.dow;
      const isWeekend = dow === 0; // Minggu

      let cellContent = "";
      if (isWeekend) {
        cellContent = `<span style="color:#ddd;font-size:11px;">—</span>`;
      } else if (hasCuti && hasKerja) {
        // Kerja + cuti dalam hari sama
        cellContent = `
          <div style="font-size:12px;font-weight:700;color:var(--text);">${fmtJam(day.jamKerja)}</div>
          <div style="font-size:10px;color:#1565c0;margin-top:2px;">+${fmtJam(day.jamCuti)}</div>
          <div style="font-size:9px;color:#1976d2;background:#e3f2fd;border-radius:4px;padding:1px 4px;margin-top:2px;line-height:1.3;">${day.keteranganCuti}</div>`;
      } else if (hasCuti) {
        // Cuti murni (tidak ada absen biasa)
        cellContent = `
          <div style="font-size:11px;color:#1565c0;font-weight:700;">${fmtJam(day.jamCuti)}</div>
          <div style="font-size:9px;color:#1976d2;background:#e3f2fd;border-radius:4px;padding:1px 4px;margin-top:2px;line-height:1.3;">${day.keteranganCuti}</div>`;
      } else if (hasKerja) {
        cellContent = `<div style="font-size:12px;font-weight:700;color:var(--text);">${fmtJam(day.jamKerja)}</div>`;
      } else {
        cellContent = `<span style="color:#ddd;font-size:12px;">—</span>`;
      }

      // Tombol edit (hanya jika canEdit + bukan weekend)
      const canEditCell = u.canEdit && !isWeekend;
      const editBtn = canEditCell ? `
        <div onclick="openTsModal('${u.username}','${day.date}','${day.jamMasuk||""}','${day.jamKeluar||""}')"
          style="margin-top:3px;font-size:9px;color:var(--primary);cursor:pointer;font-weight:700;">✏️</div>` : "";

      return `<td style="text-align:center;padding:7px 4px;border-bottom:1px solid #f5f5f5;
                 background:${isToday?"#f1f8e9":hasCuti&&!hasKerja?"#fafeff":""};
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
      : `<div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#1a237e,#4f8ef7);
              display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:12px;flex-shrink:0;">
          ${(u.nama||u.username).charAt(0).toUpperCase()}</div>`;

    return `
    <tr style="border-bottom:1px solid #f0f2f5;">
      <!-- Kolom nama (sticky) -->
      <td style="padding:8px 12px;min-width:160px;max-width:200px;position:sticky;left:0;background:white;z-index:1;">
        <div style="display:flex;align-items:center;gap:8px;">
          ${avatarHtml}
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.nama||u.username}</div>
            <div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.jabatan}</div>
          </div>
        </div>
      </td>
      ${dayCols}
      <!-- Total -->
      <td style="text-align:center;padding:8px 10px;font-weight:900;font-size:13px;color:${totalColor};
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
}

// ─── Modal Entri Waktu Manual ───

let _tsMode    = "waktu";  // "waktu" | "jam"
let _tsSubTab  = "masuk";  // "masuk" | "istirahat" | "keluar"
let _tsEntries = [];       // multi-entry: [{tab, time, date, ...}]

function tsSwitchMode(mode) {
  _tsMode = mode;
  const isWaktu = mode === "waktu";
  document.getElementById("ts-panel-waktu").style.display = isWaktu ? "flex" : "none";
  document.getElementById("ts-panel-jam").style.display   = isWaktu ? "none" : "flex";
  document.getElementById("ts-mode-waktu").style.borderBottomColor = isWaktu ? "#f57c00" : "transparent";
  document.getElementById("ts-mode-waktu").style.color    = isWaktu ? "#f57c00" : "var(--muted)";
  document.getElementById("ts-mode-waktu").style.fontWeight = isWaktu ? "700" : "600";
  document.getElementById("ts-mode-jam").style.borderBottomColor = !isWaktu ? "#f57c00" : "transparent";
  document.getElementById("ts-mode-jam").style.color    = !isWaktu ? "#f57c00" : "var(--muted)";
  document.getElementById("ts-mode-jam").style.fontWeight = !isWaktu ? "700" : "600";
}

function tsSwitchTab(tab) {
  _tsSubTab = tab;
  ["masuk","istirahat","keluar"].forEach(t => {
    const btn  = document.getElementById(`ts-tab-${t}`);
    const pnl  = document.getElementById(`ts-subtab-${t}`);
    const active = t === tab;
    btn.style.borderColor  = active ? "#f57c00" : "#e8ecf0";
    btn.style.background   = active ? "#fff8f0" : "white";
    btn.style.color        = active ? "#f57c00" : "var(--muted)";
    btn.style.fontWeight   = active ? "700" : "600";
    if (pnl) pnl.style.display = active ? "block" : "none";
  });
}

async function _tsLoadAreas() {
  try {
    const r = await fetch("/areas");
    const areas = await r.json();
    ["ts-lokasi","ts-jam-lokasi"].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      // Hapus semua kecuali option pertama
      while (sel.options.length > 1) sel.remove(1);
      areas.filter(a => a.active !== false).forEach(a => {
        const o = document.createElement("option");
        o.value = a.name; o.textContent = a.name;
        sel.appendChild(o);
      });
    });
  } catch {}
}

// Live preview jam total di panel Entri Jam
function tsUpdateJamPreview() {
  const masuk   = document.getElementById("ts-jam-masuk")?.value;
  const keluar  = document.getElementById("ts-jam-keluar")?.value;
  const bMulai  = document.getElementById("ts-jam-istirahat-mulai")?.value;
  const bSelesai= document.getElementById("ts-jam-istirahat-selesai")?.value;
  const el      = document.getElementById("ts-jam-preview");
  if (!el) return;
  if (!masuk || !keluar) { el.textContent = "—"; return; }
  let diff = (toMin(keluar) - toMin(masuk));
  if (bMulai && bSelesai) diff -= (toMin(bSelesai) - toMin(bMulai));
  if (diff <= 0) { el.textContent = "—"; return; }
  const h = Math.floor(diff/60), m = diff % 60;
  el.textContent = m > 0 ? `${h}j ${m}m` : `${h}j`;
}
function toMin(t) { const [h,m] = t.split(":").map(Number); return h*60+m; }

async function openTsModal(username, date, jamMasuk, jamKeluar) {
  _tsCurrent  = { username, date };
  _tsEntries  = [];
  _tsMode     = "waktu";
  _tsSubTab   = "masuk";

  const isNew = !jamMasuk;
  const u = _tsData?.users?.find(u => u.username === username);
  const nama = u?.nama || username;
  document.getElementById("modal-ts-title").textContent    = isNew ? "Tambahkan Entri Waktu Manual" : "Edit Entri Waktu";
  document.getElementById("modal-ts-subtitle").textContent = `${nama} · ${date}`;

  // Set nilai default
  const nowTime = new Date().toTimeString().slice(0,5);
  document.getElementById("ts-masuk-time").value  = jamMasuk ? fmtTime(jamMasuk) : nowTime;
  document.getElementById("ts-masuk-date").value  = date;
  document.getElementById("ts-keluar-time").value = jamKeluar ? fmtTime(jamKeluar) : "";
  document.getElementById("ts-keluar-date").value = date;
  document.getElementById("ts-istirahat-mulai").value   = "";
  document.getElementById("ts-istirahat-selesai").value = "";

  // Panel Entri Jam
  document.getElementById("ts-jam-date").value    = date;
  document.getElementById("ts-jam-masuk").value   = jamMasuk ? fmtTime(jamMasuk) : "";
  document.getElementById("ts-jam-keluar").value  = jamKeluar ? fmtTime(jamKeluar) : "";
  document.getElementById("ts-jam-istirahat-mulai").value   = "";
  document.getElementById("ts-jam-istirahat-selesai").value = "";
  document.getElementById("ts-catatan").value     = "";
  document.getElementById("ts-jam-catatan").value = "";
  document.getElementById("ts-aktivitas").value   = "";
  document.getElementById("ts-jam-aktivitas").value = "";
  document.getElementById("ts-lokasi").value      = "";
  document.getElementById("ts-jam-lokasi").value  = "";
  tsUpdateJamPreview();

  // Tambahkan listener live preview
  ["ts-jam-masuk","ts-jam-keluar","ts-jam-istirahat-mulai","ts-jam-istirahat-selesai"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = tsUpdateJamPreview;
  });

  tsSwitchMode("waktu");
  tsSwitchTab("masuk");
  await _tsLoadAreas();

  const overlay = document.getElementById("modal-ts-absen-overlay");
  overlay.style.display = "flex";
  overlay.onclick = e => { if (e.target === overlay) closeTsModal(); };
}

function closeTsModal() {
  document.getElementById("modal-ts-absen-overlay").style.display = "none";
  _tsCurrent = null;
}

function tsTambahBaru() {
  // Reset form untuk entri berikutnya (multi-entry)
  if (_tsMode === "waktu") {
    const nowTime = new Date().toTimeString().slice(0,5);
    if (_tsSubTab === "masuk") {
      document.getElementById("ts-masuk-time").value = nowTime;
    } else if (_tsSubTab === "istirahat") {
      document.getElementById("ts-istirahat-mulai").value   = "";
      document.getElementById("ts-istirahat-selesai").value = "";
    } else {
      document.getElementById("ts-keluar-time").value = nowTime;
    }
  }
  showToast("✅ Entri ditambahkan, isi entri berikutnya", "warning");
}

async function saveTsAbsen() {
  if (!_tsCurrent) return;
  const me = localStorage.getItem("user");
  const { username, date } = _tsCurrent;

  let jamMasukFull, jamKeluarFull, breaks = [], catatan = "", aktivitas = "", lokasiNama = "";

  if (_tsMode === "waktu") {
    const tMasuk  = document.getElementById("ts-masuk-time").value;
    const tKeluar = document.getElementById("ts-keluar-time").value;
    const dMasuk  = document.getElementById("ts-masuk-date").value || date;
    const dKeluar = document.getElementById("ts-keluar-date").value || date;
    lokasiNama = document.getElementById("ts-lokasi").value;
    aktivitas  = document.getElementById("ts-aktivitas").value;
    catatan    = document.getElementById("ts-catatan").value.trim();

    if (!lokasiNama) { showToast("⚠️ Pilih lokasi terlebih dahulu", "warning"); return; }
    if (!tMasuk)     { showToast("⚠️ Isi jam masuk", "warning"); return; }
    if (!tKeluar)    { showToast("⚠️ Isi jam keluar", "warning"); return; }

    jamMasukFull  = `${dMasuk}T${tMasuk}:00`;
    jamKeluarFull = `${dKeluar}T${tKeluar}:00`;

    const isMulai  = document.getElementById("ts-istirahat-mulai").value;
    const isSelesai= document.getElementById("ts-istirahat-selesai").value;
    if (isMulai && isSelesai) {
      breaks = [{ start: `${date}T${isMulai}:00`, end: `${date}T${isSelesai}:00` }];
    }
  } else {
    // Entri jam
    const tDate   = document.getElementById("ts-jam-date").value || date;
    const tMasuk  = document.getElementById("ts-jam-masuk").value;
    const tKeluar = document.getElementById("ts-jam-keluar").value;
    lokasiNama = document.getElementById("ts-jam-lokasi").value;
    aktivitas  = document.getElementById("ts-jam-aktivitas").value;
    catatan    = document.getElementById("ts-jam-catatan").value.trim();

    if (!lokasiNama) { showToast("⚠️ Pilih lokasi terlebih dahulu", "warning"); return; }
    if (!tMasuk)     { showToast("⚠️ Isi jam masuk", "warning"); return; }
    if (!tKeluar)    { showToast("⚠️ Isi jam keluar", "warning"); return; }

    jamMasukFull  = `${tDate}T${tMasuk}:00`;
    jamKeluarFull = `${tDate}T${tKeluar}:00`;

    const isMulai  = document.getElementById("ts-jam-istirahat-mulai").value;
    const isSelesai= document.getElementById("ts-jam-istirahat-selesai").value;
    if (isMulai && isSelesai) {
      breaks = [{ start: `${tDate}T${isMulai}:00`, end: `${tDate}T${isSelesai}:00` }];
    }
  }

  const uData   = _tsData?.users?.find(u => u.username === username);
  const dayData = uData?.days?.find(d => d.date === date);
  const isNew   = !dayData?.jamMasuk;
  const endpoint = isNew ? "/timesheet/absen-manual" : `/timesheet/absen/${username}/${date}`;
  const method   = isNew ? "POST" : "PUT";

  try {
    const r = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requester: me, targetUser: username, date, jamMasuk: jamMasukFull, jamKeluar: jamKeluarFull, breaks, catatan, aktivitas, lokasiNama })
    });
    const d = await r.json();
    if (d.status === "OK") {
      showToast("✅ Absen berhasil disimpan!");
      closeTsModal();
      loadTimesheet();
    } else {
      showToast("❌ " + (d.msg || "Gagal menyimpan"), "error");
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
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
    const loc = await getLoc();
    if (!loc.lat && !loc.lng) return;
    await fetch("/tracking/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy || 0 })
    });
  } catch {}
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
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split("T")[0];
  // Load daftar anggota untuk dropdown riwayat
  try {
    if (!_anggotaAll.length) {
      const r = await fetch("/anggota"); _anggotaAll = await r.json();
    }
    const sel = document.getElementById("trk-pilih-user");
    sel.innerHTML = '<option value="">— Pilih Anggota —</option>' +
      _anggotaAll.map(a => `<option value="${a.username}">${a.namaLengkap || a.username}</option>`).join('');
  } catch {}
  refreshLiveTracking();
}

// --- Live map ---
async function refreshLiveTracking() {
  try {
    const r    = await fetch("/tracking/live/all");
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
  el.innerHTML = list.map(a => {
    const color = _statusColor[a.status] || "#bdc3c7";
    const label = _statusLabel[a.status] || a.status;
    const lastTime = a.last ? new Date(a.last.time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}) : "—";
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
  }).join('');
}

function renderLiveMap(list) {
  // Init peta jika belum
  if (!_trkLiveMap) {
    _trkLiveMap = L.map("trk-live-map", { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap", maxZoom: 19
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
        ${new Date(a.last.time).toLocaleTimeString("id-ID")}`);
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
    const r    = await fetch("/tracking/live/all");
    const list = await r.json();
    const info = list.find(x => x.username === username);
    if (info) {
      const color = _statusColor[info.status] || "#bdc3c7";
      const label = _statusLabel[info.status] || info.status;
      const lastTime = info.last ? new Date(info.last.time).toLocaleTimeString("id-ID") : "—";
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
  if (!date.value) date.value = new Date().toISOString().split("T")[0];
  loadRiwayatRute();
}

// --- Riwayat rute ---
function initRiwayatMap() {
  if (_trkRiwayatMap) { setTimeout(() => _trkRiwayatMap.invalidateSize(), 200); return; }
  _trkRiwayatMap = L.map("trk-riwayat-map", { zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap", maxZoom: 19
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
    const r   = await fetch(`/tracking/${user}?date=${date}`);
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
    }).addTo(_trkRiwayatMap).bindPopup(`Mulai: ${new Date(pts[0].time).toLocaleTimeString("id-ID")}`);

    // Marker end
    if (latlngs.length > 1) {
      L.marker(latlngs[latlngs.length-1], {
        icon: L.divIcon({ className:"", html:`<div style="background:#e74c3c;color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);">■</div>`, iconSize:[26,26], iconAnchor:[13,13] })
      }).addTo(_trkRiwayatMap).bindPopup(`Terakhir: ${new Date(pts[pts.length-1].time).toLocaleTimeString("id-ID")}`);
    }

    _trkRiwayatLayer = polyline;
    _trkRiwayatMap.fitBounds(polyline.getBounds(), { padding: [30, 30] });
    setTimeout(() => _trkRiwayatMap.invalidateSize(), 200);

    // Info ringkasan
    const durMenit = Math.round((new Date(pts[pts.length-1].time) - new Date(pts[0].time)) / 60000);
    info.innerHTML = `<b>${pts.length} titik lokasi</b> · Durasi: <b>${durMenit} menit</b> · 
      ${new Date(pts[0].time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})} – ${new Date(pts[pts.length-1].time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}`;

    // Timeline
    // Ambil setiap N titik agar tidak terlalu panjang (maks 20 entri)
    const step = Math.max(1, Math.floor(pts.length / 20));
    const shown = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    tl.innerHTML = shown.map((p, i) => {
      const t = new Date(p.time).toLocaleTimeString("id-ID", {hour:"2-digit",minute:"2-digit",second:"2-digit"});
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

  try {
    const r = await fetch(`/kuota-cuti?tahun=${tahun}`);
    _kuotaData = await r.json();
    renderKuotaList();
  } catch {
    if (listEl) listEl.innerHTML = `<p style="color:var(--danger);text-align:center;padding:24px;">❌ Gagal memuat data</p>`;
  }
}

function renderKuotaList() {
  const listEl = document.getElementById("kuota-cuti-list");
  if (!listEl) return;

  const q = (document.getElementById("kuota-search")?.value || "").toLowerCase();
  const filtered = _kuotaData.filter(d =>
    (d.nama || d.username).toLowerCase().includes(q) || d.username.toLowerCase().includes(q)
  );

  if (!filtered.length) {
    listEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:28px;">Tidak ada data anggota</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(d => {
    const tSisa  = d.tahunan.total - d.tahunan.terpakai;
    const tPct   = Math.round((d.tahunan.terpakai / d.tahunan.total) * 100);
    const otJam  = d.overtime.jamAkumulasi || 0;
    const otHari = Math.floor(otJam / 8);
    const otSisa = (otJam % 8).toFixed(1);

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
        <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:2px;">⏱ Overtime</div>
        <div style="font-size:18px;font-weight:900;color:#e65100;">${otJam.toFixed(1)}<span style="font-size:10px;color:var(--muted);font-weight:400;"> jam</span></div>
        <div style="font-size:10px;color:#81c784;">${otHari} hari ${otSisa>0?'+ '+otSisa+' jam':''}</div>
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

  // Overtime
  const otJam  = d.overtime.jamAkumulasi || 0;
  const otHari = Math.floor(otJam / 8);
  document.getElementById("mkd-ot-jam").textContent    = otJam.toFixed(1);
  document.getElementById("mkd-ot-hari").textContent   = otHari;
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
  const tahunEl = document.getElementById("kuota-filter-tahun");
  const tahun   = tahunEl ? tahunEl.value : new Date().getFullYear();
  showToast("🔄 Menghitung overtime semua anggota...", "warning");
  try {
    const r = await fetch(`/kuota-cuti/hitung-overtime-semua?tahun=${tahun}`, { method: "POST" });
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
    const r = await fetch(`/pengajuan-cuti?requester=${user}&filter=${_cutiFilter}`);
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
            <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#4f8ef7,#1a237e);
              display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;flex-shrink:0;">
              ${(p.namaLengkap || p.username).charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;">${p.namaLengkap || p.username}</div>
              <div style="font-size:11px;color:var(--muted);">${p.jabatan || ""}</div>
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
    const r = await fetch(`/pengajuan-cuti/${id}/approve`, {
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
    const r = await fetch(`/pengajuan-cuti/${id}/reject`, {
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
    const r = await fetch(`/pengajuan-cuti/${id}/cancel`, {
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
    const r = await fetch(`/kuota-cuti/${user}?tahun=${tahun}`);
    const k = await r.json();
    renderSaldoCuti(k, user);
  } catch {
    el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:28px;">Gagal memuat saldo</p>`;
  }
}

function renderSaldoCuti(k, user) {
  const el = document.getElementById("cuti-saldo-content");
  if (!el) return;

  const tahunanSisa    = k.tahunan.total - k.tahunan.terpakai;
  const tahunanPct     = k.tahunan.total > 0 ? Math.round((k.tahunan.terpakai / k.tahunan.total) * 100) : 0;
  const otHariSetara   = Math.floor(k.overtime.jamAkumulasi / 8);
  const otJamSisa      = parseFloat((k.overtime.jamAkumulasi % 8).toFixed(1));
  const otPct          = k.overtime.jamAkumulasi > 0
    ? Math.min(100, Math.round((k.overtime.hariDiambil * 8 / (k.overtime.jamAkumulasi + k.overtime.hariDiambil * 8)) * 100))
    : 0;

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
            <div style="font-size:10px;color:#81c784;font-weight:700;margin-top:2px;">Total</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:26px;font-weight:900;color:#e57373;">${k.tahunan.terpakai}</div>
            <div style="font-size:10px;color:#ef9a9a;font-weight:700;margin-top:2px;">Terpakai</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;
            box-shadow:0 2px 8px rgba(46,125,50,.15);">
            <div style="font-size:26px;font-weight:900;color:#1565c0;">${tahunanSisa}</div>
            <div style="font-size:10px;color:#64b5f6;font-weight:700;margin-top:2px;">Sisa</div>
          </div>
        </div>
        <div style="background:#c8e6c9;border-radius:50px;height:8px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#43a047,#66bb6a);border-radius:50px;
            width:${tahunanPct}%;transition:width .5s;"></div>
        </div>
        <div style="font-size:11px;color:#388e3c;margin-top:5px;text-align:right;">${tahunanPct}% terpakai</div>
      </div>

      <!-- Cuti Overtime -->
      <div style="background:linear-gradient(135deg,#fff8e1,#fff3e0);border-radius:14px;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-weight:800;font-size:14px;color:#e65100;">⏱ Cuti Overtime</span>
          <span style="font-size:11px;color:#ffa726;font-weight:700;">1 hari = 8 jam akumulasi</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:22px;font-weight:900;color:#e65100;">${k.overtime.jamAkumulasi.toFixed(1)}</div>
            <div style="font-size:10px;color:#ffa726;font-weight:700;margin-top:2px;">Jam Sisa</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;
            box-shadow:0 2px 8px rgba(230,81,0,.15);">
            <div style="font-size:22px;font-weight:900;color:#2e7d32;">${otHariSetara}</div>
            <div style="font-size:10px;color:#81c784;font-weight:700;margin-top:2px;">Setara Hari</div>
          </div>
          <div style="text-align:center;background:white;border-radius:10px;padding:12px 8px;">
            <div style="font-size:22px;font-weight:900;color:#7b1fa2;">${k.overtime.hariDiambil}</div>
            <div style="font-size:10px;color:#ba68c8;font-weight:700;margin-top:2px;">Hari Diambil</div>
          </div>
        </div>
        <div style="font-size:12px;color:#f57f17;text-align:center;padding:8px;background:rgba(255,152,0,.08);border-radius:8px;">
          💡 Kamu punya <b>${otHariSetara} hari${otJamSisa > 0 ? " + " + otJamSisa + " jam" : ""}</b> cuti overtime tersedia
        </div>
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
    const r = await fetch(`/pengajuan-cuti?requester=${user}&filter=semua`);
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
    const r = await fetch("/kebijakan-cuti");
    _kebijakanList = await r.json();
  } catch { _kebijakanList = []; }

  const sel = document.getElementById("tc-kebijakan");
  sel.innerHTML = `<option value="">— Pilih Kebijakan Cuti —</option>`;
  _kebijakanList.forEach(k => {
    sel.innerHTML += `<option value="${k.id}" data-kuota="${k.kuotaKey||""}" data-nama="${k.nama}">${k.nama}</option>`;
  });

  // Reset fields
  document.getElementById("tc-durasi").value   = "";
  document.getElementById("tc-satuan").value   = "hari";
  document.getElementById("tc-tgl-mulai").value = "";
  document.getElementById("tc-tgl-akhir").value = "";
  document.getElementById("tc-jam-mulai").value = "";
  document.getElementById("tc-jam-akhir").value = "";
  document.getElementById("tc-saldo-info").style.display = "none";
  document.getElementById("tc-wrap-tanggal").style.display = "";
  document.getElementById("tc-wrap-jam").style.display = "none";

  // Load kuota saya
  const user  = localStorage.getItem("user") || "";
  const tahun = new Date().getFullYear();
  try {
    const rk = await fetch(`/kuota-cuti/${user}?tahun=${tahun}`);
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
  const sel = document.getElementById("tc-kebijakan");
  const opt = sel.options[sel.selectedIndex];
  const kuotaKey = opt?.getAttribute("data-kuota") || "";
  const infoEl   = document.getElementById("tc-saldo-info");

  if (!kuotaKey || !_kuotaSaya) { infoEl.style.display = "none"; return; }

  let info = "";
  if (kuotaKey === "tahunan") {
    const sisa = _kuotaSaya.tahunan.total - _kuotaSaya.tahunan.terpakai;
    info = `📅 Saldo tersedia: <b>${sisa} hari</b> dari ${_kuotaSaya.tahunan.total} hari`;
  } else if (kuotaKey === "overtime") {
    const jam = _kuotaSaya.overtime.jamAkumulasi;
    const hari = Math.floor(jam / 8);
    info = `⏱ Saldo tersedia: <b>${hari} hari</b> (${jam.toFixed(1)} jam akumulasi)`;
  }

  if (info) { infoEl.innerHTML = info; infoEl.style.display = ""; }
  else infoEl.style.display = "none";
}

function onTcSatuanChange() {
  const s = document.getElementById("tc-satuan").value;
  document.getElementById("tc-wrap-tanggal").style.display = s === "hari" ? "" : "none";
  document.getElementById("tc-wrap-jam").style.display     = s === "jam"  ? "" : "none";
}

async function saveTambahCuti() {
  const kebijakanEl = document.getElementById("tc-kebijakan");
  const kebijakanId = kebijakanEl.value;
  if (!kebijakanId) return showToast("⚠️ Pilih kebijakan cuti!", "warning");

  const opt        = kebijakanEl.options[kebijakanEl.selectedIndex];
  const kuotaKey   = opt?.getAttribute("data-kuota") || null;
  const kebijakanNama = opt?.getAttribute("data-nama") || "";
  const durasi     = parseFloat(document.getElementById("tc-durasi").value);
  if (!durasi || durasi <= 0) return showToast("⚠️ Isi durasi dengan benar!", "warning");

  const satuanDurasi = document.getElementById("tc-satuan").value;
  const tanggalMulai = document.getElementById("tc-tgl-mulai").value || null;
  const tanggalAkhir = document.getElementById("tc-tgl-akhir").value || null;
  const jamMulai     = document.getElementById("tc-jam-mulai").value || null;
  const jamAkhir     = document.getElementById("tc-jam-akhir").value || null;

  const user = localStorage.getItem("user") || "";
  try {
    const r = await fetch("/pengajuan-cuti", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, kebijakanId, kebijakanNama, kuotaKey,
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
  window.openView = function(viewId) {
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

