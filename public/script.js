// ==========================================
// KONFIGURASI
// ==========================================
let isLoginMode = true;
let faceModelsLoaded = false;
let verifyResolve = null;
let modalStream = null;

// ==========================================
// TOAST NOTIFIKASI
// ==========================================
function showToast(msg, type = "success", duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = type;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

// ==========================================
// LOAD MODEL FACE-API
// ==========================================
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
    console.error(e);
  }
}

async function getFaceDescriptor(videoEl) {
  if (!videoEl) return null;
  const det = await faceapi
    .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks().withFaceDescriptor();
  return det ? det.descriptor : null;
}

// ==========================================
// AUTH
// ==========================================
function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById("auth-title").innerText       = isLoginMode ? "Login" : "Sign Up";
  document.getElementById("btn-auth-main").innerText    = isLoginMode ? "Login" : "Sign Up";
  document.getElementById("auth-toggle-text").innerHTML = isLoginMode
    ? 'Belum punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Sign Up</a>'
    : 'Sudah punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Login</a>';

  const fs = document.getElementById("face-signup-section");
  fs.classList.toggle("hidden", isLoginMode);
  if (!isLoginMode) startCameraEl("video-signup");
  else stopCameraEl("video-signup");
}

async function handleAuth() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (!username || !password) return showToast("⚠️ Isi username dan password!", "warning");
  isLoginMode ? await doLogin(username, password) : await doSignUp(username, password);
}

async function doLogin(username, password) {
  try {
    const res  = await fetch("/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({username, password}) });
    const data = await res.json();
    if (data.status === "OK") {
      localStorage.setItem("user", username);
      localStorage.setItem("isAdmin", data.isAdmin ? "1" : "0");
      checkLoginStatus();
    } else {
      showToast("❌ Username atau password salah!", "error");
    }
  } catch { showToast("❌ Gagal terhubung ke server", "error"); }
}

async function doSignUp(username, password) {
  if (!faceModelsLoaded) return showToast("⏳ Model wajah belum siap, tunggu sebentar", "warning");
  const btn = document.getElementById("btn-auth-main");
  btn.innerText = "⏳ Scanning..."; btn.disabled = true;
  try {
    const videoEl    = document.getElementById("video-signup");
    const descriptor = await getFaceDescriptor(videoEl);
    if (!descriptor) {
      showToast("❌ Wajah tidak terdeteksi! Pastikan pencahayaan cukup", "error");
      btn.innerText = "Sign Up"; btn.disabled = false; return;
    }
    const res  = await fetch("/signup", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({username, password, faceDescriptor: Array.from(descriptor)}) });
    const data = await res.json();
    if (data.status === "OK") {
      stopCameraEl("video-signup");
      showToast("✅ Akun berhasil dibuat! Silakan login");
      setTimeout(() => toggleAuthMode(), 1500);
    } else if (data.status === "EXIST") {
      showToast("⚠️ Username sudah terdaftar!", "warning");
    } else {
      showToast("❌ Gagal membuat akun", "error");
    }
  } catch (e) { showToast("❌ Error: " + e.message, "error"); }
  btn.innerText = "Sign Up"; btn.disabled = false;
}

async function checkLoginStatus() {
  const user = localStorage.getItem("user");
  if (!user) { showAuthPage(); return; }
  try {
    const res  = await fetch("/check-user/" + user);
    const data = await res.json();
    if (data.valid) {
      localStorage.setItem("isAdmin", data.isAdmin ? "1" : "0");
      showAppPage();
    } else {
      localStorage.clear(); showAuthPage();
    }
  } catch { localStorage.clear(); showAuthPage(); }
}

function showAuthPage() {
  document.getElementById("auth-page").classList.remove("hidden");
  document.getElementById("main-nav").classList.add("hidden");
}

function showAppPage() {
  document.getElementById("auth-page").classList.add("hidden");
  document.getElementById("main-nav").classList.remove("hidden");
  stopCameraEl("video-signup");

  // Tampilkan/sembunyikan tab admin
  const isAdmin = localStorage.getItem("isAdmin") === "1";
  document.getElementById("tab-admin").classList.toggle("hidden", !isAdmin);

  showPage("home");
  loadStatus();
  loadTodayDetail();
}

function logout() {
  if (confirm("Yakin ingin keluar?")) { localStorage.clear(); location.reload(); }
}

// ==========================================
// NAVIGASI
// ==========================================
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(page).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active-tab"));
  const tab = document.getElementById("tab-" + page);
  if (tab) tab.classList.add("active-tab");

  if (page === "setting") loadSetting();
  if (page === "rekap")   loadRekap();
  if (page === "admin")   loadAdmin();
}

// ==========================================
// KAMERA
// ==========================================
function startCameraEl(videoId) {
  const video = document.getElementById(videoId);
  if (!video || video.srcObject) return;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
    .then(stream => {
      video.srcObject = stream;
      if (videoId === "video-modal") modalStream = stream;
    })
    .catch(err => console.warn("Kamera tidak tersedia:", err));
}

function stopCameraEl(videoId) {
  const video = document.getElementById(videoId);
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  if (videoId === "video-modal") modalStream = null;
}

function takePhoto() {
  const canvas = document.getElementById("canvas");
  const video  = document.getElementById("video-modal");
  if (!video || !video.videoWidth) return "";
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
}

// ==========================================
// MODAL KAMERA + FACE VERIFY
// ==========================================
function showCameraModal(title) {
  document.getElementById("camera-modal-title").innerText = title;
  document.getElementById("camera-modal").classList.remove("hidden");
  document.getElementById("camera-status").innerText = "Mendeteksi wajah...";
  document.getElementById("camera-status").classList.add("scanning");
  startCameraEl("video-modal");
}

function hideCameraModal() {
  document.getElementById("camera-modal").classList.add("hidden");
  stopCameraEl("video-modal");
  document.getElementById("camera-status").classList.remove("scanning");
}

function cancelVerify() {
  hideCameraModal();
  if (verifyResolve) { verifyResolve(false); verifyResolve = null; }
}

async function verifyFace(actionLabel) {
  return new Promise(async (resolve) => {
    verifyResolve = resolve;
    showCameraModal("🔍 Verifikasi Wajah — " + actionLabel);

    // Tunggu kamera siap
    await new Promise(r => setTimeout(r, 1500));

    if (!faceModelsLoaded) { hideCameraModal(); resolve(true); return; }

    const user = localStorage.getItem("user");
    let savedDescriptor;
    try {
      const res  = await fetch("/face-descriptor/" + user);
      const data = await res.json();
      if (!data.descriptor || data.descriptor.length === 0) { hideCameraModal(); resolve(true); return; }
      savedDescriptor = new Float32Array(data.descriptor);
    } catch { hideCameraModal(); resolve(true); return; }

    // Coba deteksi wajah maksimal 10x
    let attempts = 0;
    const tryDetect = async () => {
      if (!document.getElementById("video-modal").srcObject) { resolve(false); return; }
      attempts++;
      document.getElementById("camera-status").innerText = `Mendeteksi... (${attempts}/10)`;

      const videoEl = document.getElementById("video-modal");
      const current = await getFaceDescriptor(videoEl);

      if (current) {
        const dist = faceapi.euclideanDistance(savedDescriptor, current);
        console.log("Face distance:", dist.toFixed(3));
        hideCameraModal();
        if (dist <= 0.55) {
          resolve(true);
        } else {
          showToast("❌ Wajah tidak dikenali! Coba lagi.", "error");
          resolve(false);
        }
        verifyResolve = null;
      } else if (attempts < 10) {
        setTimeout(tryDetect, 800);
      } else {
        hideCameraModal();
        showToast("❌ Wajah tidak terdeteksi! Pastikan pencahayaan cukup.", "error");
        resolve(false);
        verifyResolve = null;
      }
    };
    setTimeout(tryDetect, 800);
  });
}

// ==========================================
// ABSENSI
// ==========================================
async function sendAbsen(type, label) {
  const user = localStorage.getItem("user");
  if (!user) return checkLoginStatus();

  const faceOK = await verifyFace(label);
  if (!faceOK) return;

  const photo = takePhoto();
  const loc   = await getLocation();

  try {
    const res    = await fetch("/absen", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ user, type, time: new Date().toISOString(), lat: loc.lat, lng: loc.lng, photo }) });
    const result = await res.json();

    if (result.status === "OK") {
      const msgs = { IN:"✅ Clock In berhasil!", OUT:"👋 Clock Out berhasil! Sampai jumpa.", BREAK_START:"☕ Selamat istirahat!", BREAK_END:"💪 Lanjut kerja!" };
      showToast(msgs[type] || "✅ Berhasil!");
      loadStatus();
      loadTodayDetail();
    } else if (result.status === "OUT_OF_AREA") {
      showToast(`❌ Di luar area kantor (${result.distance}m)`, "error");
    } else if (result.status === "ALREADY_IN") {
      showToast("⚠️ Anda sudah Clock In hari ini", "warning");
      loadStatus();
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
    const res  = await fetch("/status/" + user);
    const data = await res.json();
    updateButtons(data.status);
  } catch { updateButtons("OUT"); }
}

function updateButtons(status) {
  const el  = document.getElementById("statusText");
  const bIn = document.getElementById("btn-in");
  const bOut= document.getElementById("btn-out");
  const bBS = document.getElementById("btn-break-start");
  const bBE = document.getElementById("btn-break-end");
  [bIn, bOut, bBS, bBE].forEach(b => b.classList.add("hidden"));

  if (status === "IN") {
    el.innerHTML = '<span class="status-dot" style="background:#27ae60"></span> Sedang Bekerja';
    el.style.background = "#e8f5e9"; el.style.color = "#27ae60";
    bBS.classList.remove("hidden"); bOut.classList.remove("hidden");
  } else if (status === "BREAK") {
    el.innerHTML = '<span class="status-dot" style="background:#f39c12"></span> Sedang Istirahat';
    el.style.background = "#fff3e0"; el.style.color = "#f39c12";
    bBE.classList.remove("hidden");
  } else {
    el.innerHTML = '<span class="status-dot" style="background:#95a5a6"></span> Belum Absen';
    el.style.background = "#f0f2f5"; el.style.color = "#95a5a6";
    bIn.classList.remove("hidden");
  }
}

async function loadTodayDetail() {
  const user  = localStorage.getItem("user");
  const today = new Date().toISOString().split("T")[0];
  try {
    const res  = await fetch("/history/" + user);
    const data = await res.json();
    const rec  = data.find(d => d.date === today);
    if (rec) {
      document.getElementById("today-in").innerText  = rec.jamMasuk ? new Date(rec.jamMasuk).toLocaleTimeString("id",{hour:"2-digit",minute:"2-digit"}) : "--:--";
      document.getElementById("today-out").innerText = rec.jamKeluar ? new Date(rec.jamKeluar).toLocaleTimeString("id",{hour:"2-digit",minute:"2-digit"}) : "--:--";
      if (rec.jamMasuk && rec.jamKeluar) {
        const dur = (new Date(rec.jamKeluar) - new Date(rec.jamMasuk)) / 3600000;
        document.getElementById("today-dur").innerText = dur.toFixed(1) + "j";
      }
    }
  } catch {}
}

async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: 0, lng: 0 });
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve({ lat: 0, lng: 0 }),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

// ==========================================
// REKAP
// ==========================================
async function loadRekap() {
  const user = localStorage.getItem("user");
  document.getElementById("rekap-username-label").innerText = user;
  try {
    const [repRes, hisRes] = await Promise.all([fetch("/report/" + user), fetch("/history/" + user)]);
    const rep = await repRes.json();
    const his = await hisRes.json();

    document.getElementById("r-kerja").innerText = rep.totalKerja || "0h";
    document.getElementById("r-break").innerText = rep.totalBreak || "0h";
    document.getElementById("r-over").innerText  = rep.overtime   || "0h";

    const list = document.getElementById("history-list");
    if (!his.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada data</p>'; return; }

    list.innerHTML = his.map(d => {
      const masuk  = d.jamMasuk  ? new Date(d.jamMasuk).toLocaleTimeString("id",{hour:"2-digit",minute:"2-digit"})  : "--:--";
      const keluar = d.jamKeluar ? new Date(d.jamKeluar).toLocaleTimeString("id",{hour:"2-digit",minute:"2-digit"}) : "--:--";
      const dur    = d.jamMasuk && d.jamKeluar ? ((new Date(d.jamKeluar) - new Date(d.jamMasuk))/3600000).toFixed(1)+"j" : "-";
      const late   = d.jamMasuk && new Date(d.jamMasuk).getHours() >= 9;
      return `
        <div class="history-item">
          <div>
            <div class="history-date">${d.date}</div>
            <div class="history-time">Masuk: ${masuk} · Keluar: ${keluar} · ${dur}</div>
          </div>
          <span class="history-badge ${late ? 'late' : ''}">${late ? '⚠️ Terlambat' : '✅ Tepat'}</span>
        </div>`;
    }).join("");
  } catch { document.getElementById("history-list").innerHTML = '<p style="color:var(--muted);text-align:center;">Gagal memuat data</p>'; }
}

// ==========================================
// ADMIN PANEL
// ==========================================
async function loadAdmin() {
  const dateEl   = document.getElementById("adm-date");
  const searchEl = document.getElementById("adm-search");
  const date     = dateEl.value || new Date().toISOString().split("T")[0];
  const search   = (searchEl.value || "").toLowerCase();

  try {
    const res  = await fetch("/admin/today?date=" + date);
    const data = await res.json();

    const filtered = data.records.filter(r => r.user.toLowerCase().includes(search));
    document.getElementById("adm-total").innerText  = data.totalUsers;
    document.getElementById("adm-hadir").innerText  = data.records.filter(r => r.status !== "OUT").length;

    const list = document.getElementById("admin-list");
    if (!filtered.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }

    list.innerHTML = filtered.map(r => {
      const masuk  = r.jamMasuk  ? new Date(r.jamMasuk).toLocaleTimeString("id",{hour:"2-digit",minute:"2-digit"})  : "--:--";
      const keluar = r.jamKeluar ? new Date(r.jamKeluar).toLocaleTimeString("id",{hour:"2-digit",minute:"2-digit"}) : "--:--";
      const statusClass = r.status === "IN" ? "in" : r.status === "BREAK" ? "break" : "out";
      const statusLabel = r.status === "IN" ? "Bekerja" : r.status === "BREAK" ? "Istirahat" : "Belum/Selesai";
      return `
        <div class="employee-item">
          <div>
            <div class="emp-name">👤 ${r.user}</div>
            <div class="emp-time">Masuk: ${masuk} · Keluar: ${keluar}</div>
          </div>
          <span class="emp-status ${statusClass}">${statusLabel}</span>
        </div>`;
    }).join("");
  } catch { document.getElementById("admin-list").innerHTML = '<p style="color:var(--muted);text-align:center;">Gagal memuat data</p>'; }
}

// ==========================================
// SETTING
// ==========================================
async function loadSetting() {
  try {
    const res  = await fetch("/config");
    const data = await res.json();
    if (data.office) {
      document.getElementById("setLat").value    = data.office.lat    || "";
      document.getElementById("setLng").value    = data.office.lng    || "";
      document.getElementById("setRadius").value = data.office.radius || 100;
    }
  } catch {}
}

async function saveSetting() {
  const lat = document.getElementById("setLat").value;
  const lng = document.getElementById("setLng").value;
  const radius = document.getElementById("setRadius").value;
  if (!lat || !lng) return showToast("⚠️ Isi koordinat dulu!", "warning");
  try {
    const res = await fetch("/config", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({lat, lng, radius}) });
    if ((await res.json()).status === "OK") showToast("✅ Area berhasil disimpan!");
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

function getMyLocation() {
  navigator.geolocation.getCurrentPosition((pos) => {
    document.getElementById("setLat").value = pos.coords.latitude.toFixed(7);
    document.getElementById("setLng").value = pos.coords.longitude.toFixed(7);
    showToast("📍 Lokasi berhasil diambil!");
  }, null, { enableHighAccuracy: true });
}

// ==========================================
// HEADER INFO
// ==========================================
function updateHeader() {
  const user = localStorage.getItem("user");
  const el   = document.getElementById("header-username");
  const elD  = document.getElementById("header-date");
  if (el) el.innerText = user || "";
  if (elD) {
    const now = new Date();
    elD.innerText = now.toLocaleDateString("id-ID", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  }
}

// ==========================================
// INIT
// ==========================================
window.onload = async function () {
  updateHeader();
  // Set default tanggal admin ke hari ini
  const admDate = document.getElementById("adm-date");
  if (admDate) admDate.value = new Date().toISOString().split("T")[0];

  await loadFaceModels();
  checkLoginStatus();
};

// ==========================================
// SUB PAGES (Anggota, Libur, Aktivitas, Timesheet)
// ==========================================
function showSubPage(id) {
  document.querySelectorAll(".sub-page").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.getElementById("setting").style.display = "none";

  if (id === "sub-anggota")   loadAnggota();
  if (id === "sub-libur")     loadLibur();
  if (id === "sub-aktivitas") loadAktivitas();
  if (id === "sub-timesheet") {
    const m = document.getElementById("ts-month");
    if (!m.value) m.value = new Date().toISOString().slice(0,7);
    loadTimesheet();
  }
}

function hideSubPage() {
  document.querySelectorAll(".sub-page").forEach(p => p.classList.remove("active"));
  document.getElementById("setting").style.display = "block";
}

// --- ANGGOTA ---
async function loadAnggota() {
  try {
    const res  = await fetch("/admin/members");
    const data = await res.json();
    const list = document.getElementById("member-list");
    if (!data.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada anggota</p>'; return; }
    list.innerHTML = data.map(m => `
      <div class="member-item">
        <div style="display:flex;align-items:center;">
          <div class="member-avatar">${m.username[0].toUpperCase()}</div>
          <div>
            <div class="member-name">${m.username}</div>
            <div class="member-role">${m.isAdmin ? "Administrator" : "Karyawan"}</div>
          </div>
        </div>
        <span class="${m.isAdmin ? 'badge-admin' : 'badge-user'}">${m.isAdmin ? 'Admin' : 'User'}</span>
      </div>`).join("");
  } catch { document.getElementById("member-list").innerHTML = '<p style="color:var(--muted);text-align:center;">Gagal memuat</p>'; }
}

// --- HARI LIBUR & CUTI ---
async function loadLibur() {
  try {
    const res  = await fetch("/libur");
    const data = await res.json();
    const list = document.getElementById("libur-list");
    if (!data.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada data</p>'; return; }
    list.innerHTML = data.sort((a,b)=>a.date.localeCompare(b.date)).map((d,i) => `
      <div class="holiday-item">
        <div>
          <div class="holiday-date">${d.date}</div>
          <div class="holiday-name">${d.name}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="holiday-type ${d.type}">${d.type === 'nasional' ? '🔴 Nasional' : '🟢 Cuti'}</span>
          <button onclick="deleteLibur(${i})" style="background:none;border:none;color:#e74c3c;font-size:16px;cursor:pointer;">🗑</button>
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
    const res = await fetch("/libur", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({date, name, type}) });
    if ((await res.json()).status === "OK") {
      showToast("✅ Berhasil ditambahkan!");
      document.getElementById("libur-date").value = "";
      document.getElementById("libur-name").value = "";
      loadLibur();
    }
  } catch { showToast("❌ Gagal menyimpan", "error"); }
}

async function deleteLibur(index) {
  if (!confirm("Hapus data ini?")) return;
  try {
    const res = await fetch("/libur/" + index, { method:"DELETE" });
    if ((await res.json()).status === "OK") { showToast("🗑 Berhasil dihapus"); loadLibur(); }
  } catch { showToast("❌ Gagal menghapus", "error"); }
}

// --- AKTIVITAS ---
async function loadAktivitas() {
  try {
    const res  = await fetch("/aktivitas");
    const data = await res.json();
    const list = document.getElementById("aktivitas-list");
    if (!data.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada aktivitas</p>'; return; }
    const icons = { IN:"🟢", OUT:"🔴", BREAK_START:"☕", BREAK_END:"💪" };
    const labels = { IN:"Clock In", OUT:"Clock Out", BREAK_START:"Mulai Istirahat", BREAK_END:"Selesai Istirahat" };
    list.innerHTML = data.map(a => `
      <div class="activity-item">
        <div class="activity-user">${icons[a.type]||"📌"} ${a.user}</div>
        <div class="activity-desc">${labels[a.type]||a.type}</div>
        <div class="activity-time">${new Date(a.time).toLocaleString("id-ID")}</div>
      </div>`).join("");
  } catch { document.getElementById("aktivitas-list").innerHTML = '<p style="color:var(--muted);text-align:center;">Gagal memuat</p>'; }
}

// --- TIMESHEET ---
async function loadTimesheet() {
  const month  = document.getElementById("ts-month").value;
  const search = (document.getElementById("ts-search").value || "").toLowerCase();
  if (!month) return;
  try {
    const res  = await fetch("/timesheet?month=" + month);
    const data = await res.json();
    const filtered = data.filter(r => r.user.toLowerCase().includes(search));
    const el = document.getElementById("timesheet-content");
    if (!filtered.length) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }
    el.innerHTML = `
      <table class="timesheet-table">
        <thead><tr><th>Nama</th><th>Hari</th><th>Jam Kerja</th><th>Lembur</th></tr></thead>
        <tbody>${filtered.map(r => `
          <tr>
            <td><b>${r.user}</b></td>
            <td>${r.totalDays}h</td>
            <td>${r.totalJam}j</td>
            <td style="color:${parseFloat(r.overtime)>0?'var(--warning)':'var(--muted)'};">${r.overtime}j</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } catch { document.getElementById("timesheet-content").innerHTML = '<p style="color:var(--muted);text-align:center;">Gagal memuat</p>'; }
}
