// ==========================================
// 1. KONFIGURASI & BAHASA
// ==========================================
const LANG = {
  id: {
    title: "Absensi Smart", masuk: "Clock In", pulang: "Clock Out",
    istirahat: "Istirahat", selesaiIstirahat: "Selesai Istirahat",
    belum: "Belum Absen", kerja: "Sedang Bekerja",
    break: "Sedang Istirahat", selesai: "Sudah Pulang",
  }
};
let currentLang = "id";
let isLoginMode = true;
let faceModelsLoaded = false;
const t = (key) => LANG[currentLang][key] || key;

// ==========================================
// 2. LOAD MODEL FACE-API
// ==========================================
async function loadFaceModels() {
  const statusEl = document.getElementById("faceStatus");
  if (statusEl) statusEl.innerText = "⏳ Memuat model wajah...";
  try {
    const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    faceModelsLoaded = true;
    if (statusEl) statusEl.innerText = "✅ Model wajah siap";
    console.log("Face models loaded OK");
  } catch (e) {
    console.error("Gagal load model wajah:", e);
    if (statusEl) statusEl.innerText = "⚠️ Model wajah gagal (butuh internet)";
  }
}

async function getFaceDescriptor(videoEl) {
  if (!videoEl) return null;
  const detection = await faceapi
    .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection ? detection.descriptor : null;
}

// ==========================================
// 3. AUTH — LOGIN, SIGNUP, LOGOUT
// ==========================================
function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById("auth-title").innerText = isLoginMode ? "Login" : "Sign Up";
  document.getElementById("btn-auth-main").innerText = isLoginMode ? "Login" : "Sign Up";
  document.getElementById("auth-toggle-text").innerHTML = isLoginMode
    ? 'Belum punya akun? <a href="#" onclick="toggleAuthMode()">Sign Up</a>'
    : 'Sudah punya akun? <a href="#" onclick="toggleAuthMode()">Login</a>';

  // Tampilkan/sembunyikan kamera signup
  const faceSection = document.getElementById("face-signup-section");
  if (faceSection) faceSection.classList.toggle("hidden", isLoginMode);

  if (!isLoginMode) {
    startCameraEl("video-signup");
  } else {
    stopCameraEl("video-signup");
  }
}

async function handleAuth() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (!username || !password) return alert("Isi username dan password!");

  if (!isLoginMode) {
    await doSignUp(username, password);
  } else {
    await doLogin(username, password);
  }
}

async function doLogin(username, password) {
  try {
    const res  = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.status === "OK") {
      localStorage.setItem("user", username);
      checkLoginStatus();
    } else {
      alert("Login gagal! Username atau password salah.");
    }
  } catch (err) {
    alert("Gagal terhubung ke server.");
    console.error(err);
  }
}

async function doSignUp(username, password) {
  if (!faceModelsLoaded) {
    return alert("Model wajah belum siap. Tunggu sebentar lalu coba lagi.\nPastikan ada koneksi internet.");
  }

  const btn = document.getElementById("btn-auth-main");
  btn.innerText = "⏳ Scanning wajah...";
  btn.disabled = true;

  try {
    const videoEl = document.getElementById("video-signup");
    const descriptor = await getFaceDescriptor(videoEl);

    if (!descriptor) {
      alert("❌ Wajah tidak terdeteksi!\nPastikan:\n- Wajah terlihat jelas di kamera\n- Pencahayaan cukup\n- Tidak pakai masker");
      btn.innerText = "Sign Up"; btn.disabled = false;
      return;
    }

    const res = await fetch("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, faceDescriptor: Array.from(descriptor) })
    });
    const data = await res.json();

    if (data.status === "OK") {
      alert("✅ Akun berhasil dibuat!\nSilakan login.");
      toggleAuthMode();
    } else if (data.status === "EXIST") {
      alert("Username sudah terdaftar!");
    } else {
      alert("Gagal membuat akun.");
    }
  } catch (err) {
    alert("Terjadi kesalahan: " + err.message);
    console.error(err);
  }

  btn.innerText = "Sign Up"; btn.disabled = false;
}

async function checkLoginStatus() {
  const user = localStorage.getItem("user");
  if (!user) { showAuthPage(); return; }

  try {
    const res  = await fetch("/check-user/" + user);
    const data = await res.json();
    if (data.valid) {
      showAppPage();
    } else {
      localStorage.removeItem("user");
      showAuthPage();
    }
  } catch (e) {
    localStorage.removeItem("user");
    showAuthPage();
  }
}

function showAuthPage() {
  document.getElementById("auth-page").classList.remove("hidden");
  document.getElementById("main-nav").classList.add("hidden");
}

function showAppPage() {
  document.getElementById("auth-page").classList.add("hidden");
  document.getElementById("main-nav").classList.remove("hidden");
  stopCameraEl("video-signup");
  showPage("home");
  startCameraEl("video");
  loadStatus();
}

function logout() {
  if (confirm("Yakin ingin keluar?")) {
    localStorage.removeItem("user");
    location.reload();
  }
}

// ==========================================
// 4. NAVIGASI
// ==========================================
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(page).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active-tab"));
  const tab = document.getElementById("tab-" + page);
  if (tab) tab.classList.add("active-tab");
  if (page === "setting") loadSetting();
}

// ==========================================
// 5. KAMERA & GPS
// ==========================================
function startCameraEl(videoId) {
  const video = document.getElementById(videoId);
  if (!video) return;
  if (video.srcObject) return; // sudah jalan
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
    .then(stream => { video.srcObject = stream; })
    .catch(err => console.warn("Kamera tidak tersedia:", err));
}

function stopCameraEl(videoId) {
  const video = document.getElementById(videoId);
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
}

function startCamera() { startCameraEl("video"); }

function takePhoto() {
  const canvas = document.getElementById("canvas");
  const video  = document.getElementById("video");
  const ctx    = canvas.getContext("2d");
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  if (w === 0 || h === 0) return "";
  canvas.width = w; canvas.height = h;
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
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
// 6. FACE RECOGNITION SAAT ABSEN
// ==========================================
async function verifyFace() {
  if (!faceModelsLoaded) return true; // skip jika model belum load

  const user    = localStorage.getItem("user");
  const videoEl = document.getElementById("video");

  // Ambil data wajah terdaftar dari server
  let savedDescriptor;
  try {
    const res  = await fetch("/face-descriptor/" + user);
    const data = await res.json();
    if (!data.descriptor || data.descriptor.length === 0) return true; // tidak ada data wajah, skip
    savedDescriptor = new Float32Array(data.descriptor);
  } catch (e) {
    return true; // jika gagal fetch, izinkan absen
  }

  // Scan wajah sekarang
  const currentDescriptor = await getFaceDescriptor(videoEl);
  if (!currentDescriptor) {
    alert("❌ Wajah tidak terdeteksi!\nPastikan wajah terlihat jelas di kamera.");
    return false;
  }

  // Bandingkan jarak wajah (threshold 0.55 = cukup ketat)
  const distance = faceapi.euclideanDistance(savedDescriptor, currentDescriptor);
  console.log("Face distance:", distance.toFixed(3));

  if (distance > 0.55) {
    alert(`❌ Wajah tidak dikenali! (skor: ${distance.toFixed(2)})\nPastikan pencahayaan cukup dan hadap kamera dengan jelas.`);
    return false;
  }

  return true;
}

// ==========================================
// 7. LOGIKA ABSENSI
// ==========================================
async function sendAbsen(type) {
  const user = localStorage.getItem("user");
  if (!user) return checkLoginStatus();

  const statusEl = document.getElementById("statusText");
  const originalText = statusEl.innerText;
  statusEl.innerText = "🔍 Verifikasi wajah...";

  const faceOK = await verifyFace();
  if (!faceOK) { statusEl.innerText = originalText; return; }

  statusEl.innerText = "📤 Mengirim...";

  try {
    const photo = takePhoto();
    const loc   = await getLocation();

    const res = await fetch("/absen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user, type,
        time: new Date().toISOString(),
        lat: loc.lat, lng: loc.lng, photo
      })
    });

    const result = await res.json();
    if (result.status === "OK") {
      loadStatus();
    } else if (result.status === "OUT_OF_AREA") {
      alert(`❌ Gagal! Anda di luar area (${result.distance}m dari kantor).`);
      statusEl.innerText = originalText;
    } else if (result.status === "ALREADY_IN") {
      alert("Anda sudah Clock In hari ini.");
      loadStatus();
    }
  } catch (error) {
    alert("Terjadi kesalahan teknis.");
    statusEl.innerText = originalText;
    console.error(error);
  }
}

function clockIn()    { sendAbsen("IN"); }
function clockOut()   { sendAbsen("OUT"); }
function breakStart() { sendAbsen("BREAK_START"); }
function breakEnd()   { sendAbsen("BREAK_END"); }

async function loadStatus() {
  const user = localStorage.getItem("user");
  if (!user) return;
  try {
    const res  = await fetch("/status/" + user);
    const data = await res.json();
    updateButtons(data.status);
  } catch (e) { updateButtons("OUT"); }
}

function updateButtons(status) {
  const el  = document.getElementById("statusText");
  const bIn = document.getElementById("btn-in");
  const bOut= document.getElementById("btn-out");
  const bBS = document.getElementById("btn-break-start");
  const bBE = document.getElementById("btn-break-end");

  [bIn, bOut, bBS, bBE].forEach(b => b.classList.add("hidden"));

  if (status === "IN") {
    el.innerText = t("kerja");
    el.style.background = "#d5f5e3"; el.style.color = "#1e8449";
    bBS.classList.remove("hidden");
    bOut.classList.remove("hidden");
  } else if (status === "BREAK") {
    el.innerText = t("break");
    el.style.background = "#fef9e7"; el.style.color = "#9a7d0a";
    bBE.classList.remove("hidden");
  } else {
    el.innerText = t("belum");
    el.style.background = "#eee"; el.style.color = "#555";
    bIn.classList.remove("hidden");
  }
}

// ==========================================
// 8. SETTING
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
  } catch(e) { console.warn("Gagal load config:", e); }
}

async function saveSetting() {
  const lat    = document.getElementById("setLat").value;
  const lng    = document.getElementById("setLng").value;
  const radius = document.getElementById("setRadius").value;
  if (!lat || !lng) return alert("Isi koordinat terlebih dahulu!");
  const res = await fetch("/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, radius })
  });
  if ((await res.json()).status === "OK") alert("✅ Area berhasil disimpan!");
}

function getMyLocation() {
  navigator.geolocation.getCurrentPosition((pos) => {
    document.getElementById("setLat").value = pos.coords.latitude.toFixed(7);
    document.getElementById("setLng").value = pos.coords.longitude.toFixed(7);
    alert("📍 Lokasi berhasil diambil! Jangan lupa klik Simpan.");
  }, null, { enableHighAccuracy: true });
}

// ==========================================
// 9. INISIALISASI
// ==========================================
window.onload = async function () {
  await loadFaceModels();
  checkLoginStatus();
};