// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
let faceModelsLoaded = false;
let isLoginMode      = true;
let verifyResolve    = null;
let userMenus        = [];
let userRole         = "";
let userLevel        = 99;
let currentProfilData = {};  // data profil yang sedang dilihat
let capturedPhotoData = "";  // foto yang baru diambil dari kamera

// ═══════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════
function showToast(msg, type="success", ms=3000) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = type; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), ms);
}

// ═══════════════════════════════════════════════
// NAVIGASI
// ═══════════════════════════════════════════════
function openView(viewId) {
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  const el = document.getElementById(viewId);
  if (el) el.classList.add("active");
  window.scrollTo(0,0);
  if (viewId==="view-rekap")      loadRekap();
  if (viewId==="view-admin")      loadAdmin();
  if (viewId==="view-aktivitas")  loadAktivitas();
  if (viewId==="view-area")       loadAreas();
  if (viewId==="view-libur")      loadLibur();
  if (viewId==="view-anggota")    { loadAnggota(); loadGroups(); }
  if (viewId==="view-profil")     loadProfil(localStorage.getItem("user"));
  if (viewId==="view-rules")      loadRules();
  if (viewId==="view-timesheet")  {
    const m=document.getElementById("ts-month");
    if(!m.value) m.value=new Date().toISOString().slice(0,7);
    loadTimesheet();
  }
}

function navTo(page) {
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
  const nb=document.getElementById("nav-"+page);
  if(nb) nb.classList.add("active");
  openView("view-"+page);
}

// ═══════════════════════════════════════════════
// FACE API
// ═══════════════════════════════════════════════
async function loadFaceModels() {
  const el=document.getElementById("faceStatus");
  if(el) el.innerText="⏳ Memuat model wajah...";
  try {
    const U="https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
    await faceapi.nets.ssdMobilenetv1.loadFromUri(U);
    await faceapi.nets.faceLandmark68Net.loadFromUri(U);
    await faceapi.nets.faceRecognitionNet.loadFromUri(U);
    faceModelsLoaded=true;
    if(el) el.innerText="✅ Model wajah siap";
  } catch(e) {
    if(el) el.innerText="⚠️ Gagal load model (butuh internet)";
  }
}

async function getFaceDescriptor(videoEl) {
  if(!videoEl) return null;
  const det=await faceapi.detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({minConfidence:0.5}))
    .withFaceLandmarks().withFaceDescriptor();
  return det?det.descriptor:null;
}

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════
function toggleAuthMode() {
  isLoginMode=!isLoginMode;
  document.getElementById("auth-title").innerText    = isLoginMode?"Login":"Sign Up";
  document.getElementById("btn-auth-main").innerText = isLoginMode?"Login":"Sign Up";
  document.getElementById("auth-toggle-text").innerHTML = isLoginMode
    ? 'Belum punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Sign Up</a>'
    : 'Sudah punya akun? <a href="#" onclick="toggleAuthMode()" style="color:#4f8ef7;font-weight:600;">Login</a>';
  document.getElementById("face-signup-section").classList.toggle("hidden",isLoginMode);
  document.getElementById("signup-extra").classList.toggle("hidden",isLoginMode);
  if(!isLoginMode) startCam("video-signup"); else stopCam("video-signup");
}

async function handleAuth() {
  const u=document.getElementById("username").value.trim();
  const p=document.getElementById("password").value;
  if(!u||!p) return showToast("⚠️ Isi username dan password!","warning");
  isLoginMode ? await doLogin(u,p) : await doSignUp(u,p);
}

async function doLogin(u,p) {
  try {
    const r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
    const d=await r.json();
    if(d.status==="OK") {
      localStorage.setItem("user",u);
      localStorage.setItem("menus",JSON.stringify(d.menus||[]));
      localStorage.setItem("role",d.role||"anggota");
      localStorage.setItem("level",d.level||99);
      enterApp(d.menus||[],d.role,d.level);
    } else { showToast("❌ Username atau password salah!","error"); }
  } catch { showToast("❌ Gagal terhubung ke server","error"); }
}

async function doSignUp(u,p) {
  if(!faceModelsLoaded) return showToast("⏳ Model wajah belum siap","warning");
  const btn=document.getElementById("btn-auth-main");
  btn.innerText="⏳ Scanning..."; btn.disabled=true;
  try {
    const videoEl=document.getElementById("video-signup");
    const descriptor=await getFaceDescriptor(videoEl);
    if(!descriptor) {
      showToast("❌ Wajah tidak terdeteksi! Pastikan pencahayaan cukup","error");
      btn.innerText="Sign Up"; btn.disabled=false; return;
    }
    const namaLengkap=document.getElementById("namaLengkap").value.trim()||u;
    const agama=document.getElementById("agama").value;
    const r=await fetch("/signup",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:u,password:p,faceDescriptor:Array.from(descriptor),namaLengkap,agama})});
    const d=await r.json();
    if(d.status==="OK") {
      stopCam("video-signup");
      showToast("✅ Akun berhasil dibuat! Silakan login");
      setTimeout(()=>toggleAuthMode(),1500);
    } else if(d.status==="EXIST") {
      showToast("⚠️ Username sudah terdaftar!","warning");
    } else { showToast("❌ Gagal membuat akun","error"); }
  } catch(e) { showToast("❌ Error: "+e.message,"error"); }
  btn.innerText="Sign Up"; btn.disabled=false;
}

async function checkLoginStatus() {
  const u=localStorage.getItem("user");
  if(!u) { showAuthPage(); return; }
  try {
    const r=await fetch("/check-user/"+u);
    const d=await r.json();
    if(d.valid) {
      localStorage.setItem("menus",JSON.stringify(d.menus||[]));
      localStorage.setItem("role",d.role||"anggota");
      localStorage.setItem("level",d.level||99);
      enterApp(d.menus||[],d.role,d.level);
    } else { localStorage.clear(); showAuthPage(); }
  } catch { localStorage.clear(); showAuthPage(); }
}

function showAuthPage() {
  document.getElementById("auth-page").classList.remove("hidden");
  document.getElementById("main-nav").classList.add("hidden");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
}

function enterApp(menus,role,level) {
  userMenus=menus||[]; userRole=role||"anggota"; userLevel=parseInt(level)||99;
  document.getElementById("auth-page").classList.add("hidden");
  document.getElementById("main-nav").classList.remove("hidden");
  stopCam("video-signup");

  // Nav visibility
  document.getElementById("nav-admin").classList.toggle("hidden",!userMenus.includes("admin"));

  // Setting menu visibility
  applyMenuAccess();

  // Header
  document.getElementById("hdr-user").innerText=localStorage.getItem("user")||"";
  document.getElementById("hdr-date").innerText=new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  document.getElementById("rekap-lbl").innerText=localStorage.getItem("user")||"";

  navTo("home");
  loadStatus();
  loadTodayDetail();
  const ad=document.getElementById("adm-date");
  if(ad) ad.value=new Date().toISOString().split("T")[0];
}

function applyMenuAccess() {
  const map={
    "smenu-anggota":"anggota","smenu-area":"area","smenu-libur":"libur",
    "smenu-aktivitas":"aktivitas","smenu-timesheet":"timesheet","smenu-rules":"rules",
  };
  Object.entries(map).forEach(([id,key])=>{
    const el=document.getElementById(id);
    if(el) el.classList.toggle("hidden",!userMenus.includes(key));
  });
}

function logout() {
  if(confirm("Yakin ingin keluar?")) { localStorage.clear(); location.reload(); }
}

// ═══════════════════════════════════════════════
// KAMERA
// ═══════════════════════════════════════════════
function startCam(id) {
  const v=document.getElementById(id);
  if(!v||v.srcObject) return;
  navigator.mediaDevices.getUserMedia({video:{facingMode:"user"},audio:false})
    .then(s=>{ v.srcObject=s; })
    .catch(e=>console.warn("Kamera:",e));
}
function stopCam(id) {
  const v=document.getElementById(id);
  if(v&&v.srcObject){ v.srcObject.getTracks().forEach(t=>t.stop()); v.srcObject=null; }
}
function takePhoto() {
  const c=document.getElementById("canvas");
  const v=document.getElementById("video-modal");
  if(!v||!v.videoWidth) return "";
  c.width=v.videoWidth; c.height=v.videoHeight;
  c.getContext("2d").drawImage(v,0,0);
  return c.toDataURL("image/jpeg",0.7);
}
function takePhotoFromEl(videoId) {
  const c=document.getElementById("canvas");
  const v=document.getElementById(videoId);
  if(!v||!v.videoWidth) return "";
  c.width=v.videoWidth; c.height=v.videoHeight;
  c.getContext("2d").drawImage(v,0,0);
  return c.toDataURL("image/jpeg",0.8);
}

// ═══════════════════════════════════════════════
// CAMERA MODAL (verifikasi wajah absen)
// ═══════════════════════════════════════════════
function showCamModal(title) {
  document.getElementById("cam-title").innerText=title;
  document.getElementById("camera-modal").classList.remove("hidden");
  document.getElementById("camera-status").innerText="Mendeteksi wajah...";
  startCam("video-modal");
}
function hideCamModal() {
  document.getElementById("camera-modal").classList.add("hidden");
  stopCam("video-modal");
}
function cancelVerify() {
  hideCamModal();
  if(verifyResolve){ verifyResolve(false); verifyResolve=null; }
}
async function verifyFace(label) {
  return new Promise(async(resolve)=>{
    verifyResolve=resolve;
    showCamModal("🔍 "+label);
    await new Promise(r=>setTimeout(r,1500));
    if(!faceModelsLoaded){ hideCamModal(); resolve(true); return; }
    const user=localStorage.getItem("user");
    let savedDesc;
    try {
      const r=await fetch("/face-descriptor/"+user);
      const d=await r.json();
      if(!d.descriptor||!d.descriptor.length){ hideCamModal(); resolve(true); return; }
      savedDesc=new Float32Array(d.descriptor);
    } catch { hideCamModal(); resolve(true); return; }
    let attempts=0;
    const tryDetect=async()=>{
      if(!document.getElementById("video-modal").srcObject){ resolve(false); return; }
      attempts++;
      document.getElementById("camera-status").innerText=`Mendeteksi... (${attempts}/10)`;
      const cur=await getFaceDescriptor(document.getElementById("video-modal"));
      if(cur){
        const d=faceapi.euclideanDistance(savedDesc,cur);
        hideCamModal(); verifyResolve=null;
        if(d<=0.55){ resolve(true); }
        else{ showToast("❌ Wajah tidak dikenali! Coba lagi.","error"); resolve(false); }
      } else if(attempts<10) { setTimeout(tryDetect,800); }
      else { hideCamModal(); verifyResolve=null; showToast("❌ Wajah tidak terdeteksi!","error"); resolve(false); }
    };
    setTimeout(tryDetect,800);
  });
}

// ═══════════════════════════════════════════════
// ABSENSI
// ═══════════════════════════════════════════════
async function sendAbsen(type,label) {
  const user=localStorage.getItem("user");
  if(!user) return checkLoginStatus();
  const ok=await verifyFace(label);
  if(!ok) return;
  const photo=takePhoto();
  const loc=await getLoc();
  try {
    const r=await fetch("/absen",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({user,type,time:new Date().toISOString(),lat:loc.lat,lng:loc.lng,photo})});
    const d=await r.json();
    if(d.status==="OK"){
      const msgs={IN:"✅ Clock In berhasil!",OUT:"👋 Clock Out berhasil!",BREAK_START:"☕ Selamat istirahat!",BREAK_END:"💪 Lanjut kerja!"};
      showToast(msgs[type]||"✅ Berhasil!"); loadStatus(); loadTodayDetail();
    } else if(d.status==="OUT_OF_AREA") {
      showToast(`❌ Di luar area kantor (${d.distance}m dari ${d.area||"kantor"})`, "error");
    } else if(d.status==="ALREADY_IN") {
      showToast("⚠️ Sudah Clock In hari ini","warning"); loadStatus();
    }
  } catch { showToast("❌ Terjadi kesalahan teknis","error"); }
}

function clockIn()    { sendAbsen("IN","Clock In"); }
function clockOut()   { sendAbsen("OUT","Clock Out"); }
function breakStart() { sendAbsen("BREAK_START","Istirahat"); }
function breakEnd()   { sendAbsen("BREAK_END","Lanjut Kerja"); }

async function loadStatus() {
  const user=localStorage.getItem("user");
  if(!user) return;
  try {
    const r=await fetch("/status/"+user);
    const d=await r.json();
    updateBtns(d.status);
  } catch { updateBtns("OUT"); }
}

function updateBtns(status) {
  const el=document.getElementById("statusText");
  const bIn=document.getElementById("btn-in");
  const bOut=document.getElementById("btn-out");
  const bBS=document.getElementById("btn-bs");
  const bBE=document.getElementById("btn-be");
  [bIn,bOut,bBS,bBE].forEach(b=>b.classList.add("hidden"));
  if(status==="IN"){
    el.innerHTML='<span class="status-dot" style="background:#27ae60"></span> Sedang Bekerja';
    el.style.background="#e8f5e9"; el.style.color="#27ae60";
    bBS.classList.remove("hidden"); bOut.classList.remove("hidden");
  } else if(status==="BREAK"){
    el.innerHTML='<span class="status-dot" style="background:#f39c12"></span> Sedang Istirahat';
    el.style.background="#fff3e0"; el.style.color="#f39c12";
    bBE.classList.remove("hidden");
  } else {
    el.innerHTML='<span class="status-dot" style="background:#95a5a6"></span> Belum Absen';
    el.style.background="#f0f2f5"; el.style.color="#95a5a6";
    bIn.classList.remove("hidden");
  }
}

async function loadTodayDetail() {
  const user=localStorage.getItem("user");
  const today=new Date().toISOString().split("T")[0];
  try {
    const r=await fetch("/history/"+user);
    const d=await r.json();
    const rec=d.find(x=>x.date===today);
    if(rec){
      document.getElementById("t-in").innerText  = rec.jamMasuk  ? fmt(rec.jamMasuk)  : "--:--";
      document.getElementById("t-out").innerText = rec.jamKeluar ? fmt(rec.jamKeluar) : "--:--";
      if(rec.jamMasuk&&rec.jamKeluar)
        document.getElementById("t-dur").innerText=((new Date(rec.jamKeluar)-new Date(rec.jamMasuk))/3600000).toFixed(1)+"j";
    }
  } catch {}
}

async function getLoc() {
  return new Promise(resolve=>{
    if(!navigator.geolocation) return resolve({lat:0,lng:0});
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude}),
      ()=>resolve({lat:0,lng:0}), {enableHighAccuracy:true,timeout:8000}
    );
  });
}
function fmt(iso){ return new Date(iso).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}); }

// ═══════════════════════════════════════════════
// REKAP
// ═══════════════════════════════════════════════
async function loadRekap() {
  const user=localStorage.getItem("user");
  try {
    const [rr,hr]=await Promise.all([fetch("/report/"+user),fetch("/history/"+user)]);
    const rep=await rr.json(), his=await hr.json();
    document.getElementById("r-kerja").innerText=rep.totalKerja||"0h";
    document.getElementById("r-break").innerText=rep.totalBreak||"0h";
    document.getElementById("r-over").innerText=rep.overtime||"0h";
    const list=document.getElementById("history-list");
    if(!his.length){ list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada data</p>'; return; }
    list.innerHTML=his.map(d=>{
      const masuk=d.jamMasuk?fmt(d.jamMasuk):"--:--";
      const keluar=d.jamKeluar?fmt(d.jamKeluar):"--:--";
      const dur=d.jamMasuk&&d.jamKeluar?((new Date(d.jamKeluar)-new Date(d.jamMasuk))/3600000).toFixed(1)+"j":"-";
      const late=d.jamMasuk&&new Date(d.jamMasuk).getHours()>=9;
      return `<div class="history-item">
        <div><div class="h-date">${d.date}</div><div class="h-time">Masuk: ${masuk} · Keluar: ${keluar} · ${dur}</div></div>
        <span class="h-badge ${late?'late':'ok'}">${late?'⚠️ Terlambat':'✅ Tepat'}</span>
      </div>`;
    }).join("");
  } catch {}
}

// ═══════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════
async function loadAdmin() {
  const date=(document.getElementById("adm-date")?.value)||new Date().toISOString().split("T")[0];
  const search=(document.getElementById("adm-search")?.value||"").toLowerCase();
  try {
    const r=await fetch("/admin/today?date="+date);
    const d=await r.json();
    document.getElementById("adm-total").innerText=d.totalUsers;
    document.getElementById("adm-hadir").innerText=d.records.filter(x=>x.status!=="OUT"&&x.status!=="DONE").length;
    const filtered=d.records.filter(x=>(x.namaLengkap||x.user).toLowerCase().includes(search));
    const list=document.getElementById("admin-list");
    if(!filtered.length){ list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }
    const sc={IN:"in",BREAK:"break",OUT:"out",DONE:"out"};
    const sl={IN:"Bekerja",BREAK:"Istirahat",OUT:"Belum Absen",DONE:"Selesai"};
    list.innerHTML=filtered.map(x=>`
      <div class="emp-item">
        <div><div class="emp-name">👤 ${x.namaLengkap||x.user}</div>
        <div class="emp-time">Masuk: ${x.jamMasuk?fmt(x.jamMasuk):"--:--"} · Keluar: ${x.jamKeluar?fmt(x.jamKeluar):"--:--"}</div></div>
        <span class="emp-badge ${sc[x.status]||'out'}">${sl[x.status]||x.status}</span>
      </div>`).join("");
  } catch {}
}

// ═══════════════════════════════════════════════
// PROFIL — load & tampilkan
// ═══════════════════════════════════════════════
async function loadProfil(username) {
  if(!username) return;
  try {
    const r=await fetch("/profil/"+username);
    if(!r.ok) return;
    const d=await r.json();
    currentProfilData=d;

    // Avatar
    const photoWrap=document.getElementById("profil-photo-wrap");
    if(d.photoProfil) {
      photoWrap.innerHTML=`<img src="${d.photoProfil}" class="profil-avatar" alt="foto">`;
    } else {
      photoWrap.innerHTML=`<div class="profil-avatar-placeholder">${(d.namaLengkap||"?")[0].toUpperCase()}</div>`;
    }
    document.getElementById("profil-photo-name").innerText = d.namaLengkap||username;
    document.getElementById("profil-photo-role").innerText = d.roleName||"";
    document.getElementById("profil-photo-role").style.color = d.roleColor||"var(--muted)";

    // Info
    document.getElementById("profil-nama").innerText    = d.namaLengkap||"-";
    document.getElementById("profil-agama").innerText   = d.agama||"-";
    document.getElementById("profil-jabatan").innerText = d.jabatan||"-";
    document.getElementById("profil-role").innerText    = d.roleName||"-";
    document.getElementById("profil-role").style.color  = d.roleColor||"var(--muted)";
    document.getElementById("profil-group").innerText   = d.groupName||"-";
    document.getElementById("profil-lingkup").innerText = d.lingkupKerja==="luar"?"🌍 Tugas Luar (Bebas Area)":"🏢 Default (Wajib Area)";

    // Gaji hanya untuk owner
    if(userLevel<=1) {
      document.getElementById("profil-gaji-row").style.display="flex";
      document.getElementById("profil-gaji").innerText = d.nominalGaji ? "Rp "+Number(d.nominalGaji).toLocaleString("id-ID") : "-";
    }

    // Keamanan
    document.getElementById("sec-username").innerText=d.username||username;
    const pwEl=document.getElementById("sec-password");
    pwEl.dataset.actual=d.password; pwEl.classList.remove("revealed"); pwEl.innerText="••••••••";
    document.getElementById("sec-face-status").innerText = d.hasFace?"✅ Sudah terdaftar":"⚠️ Belum ada data wajah";

    // Hapus akun — hanya owner/admin dan bukan diri sendiri
    const hapusCard=document.getElementById("hapus-akun-card");
    if(hapusCard) hapusCard.style.display = (userLevel<=2&&username!==localStorage.getItem("user")) ? "block" : "none";

  } catch(e) { console.error(e); }
}

function togglePasswordReveal(el) {
  if(el.classList.contains("revealed")) {
    el.classList.remove("revealed"); el.innerText="••••••••";
  } else {
    el.classList.add("revealed"); el.innerText=el.dataset.actual||"";
  }
}

function switchProfilTab(tab) {
  const isProfil=tab==="profil";
  document.getElementById("ppanel-profil").classList.toggle("hidden",!isProfil);
  document.getElementById("ppanel-keamanan").classList.toggle("hidden",isProfil);
  document.getElementById("ptab-profil").classList.toggle("active",isProfil);
  document.getElementById("ptab-keamanan").classList.toggle("active",!isProfil);
}

// Edit Nama
function editNama() {
  document.getElementById("edit-nama-form").classList.remove("hidden");
  document.getElementById("input-nama-baru").value=currentProfilData.namaLengkap||"";
}
function cancelEditNama() { document.getElementById("edit-nama-form").classList.add("hidden"); }
async function saveNama() {
  const nama=document.getElementById("input-nama-baru").value.trim();
  if(!nama) return showToast("⚠️ Nama tidak boleh kosong","warning");
  try {
    const r=await fetch("/profil/"+localStorage.getItem("user"),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({namaLengkap:nama})});
    if((await r.json()).status==="OK") {
      showToast("✅ Nama berhasil diubah!");
      cancelEditNama();
      loadProfil(localStorage.getItem("user"));
    }
  } catch { showToast("❌ Gagal menyimpan","error"); }
}

// Edit Password
function editPassword() { document.getElementById("edit-pw-form").classList.remove("hidden"); }
function cancelEditPw() { document.getElementById("edit-pw-form").classList.add("hidden"); }
async function savePassword() {
  const old=document.getElementById("pw-old").value;
  const nw=document.getElementById("pw-new").value;
  const cf=document.getElementById("pw-confirm").value;
  if(!old||!nw||!cf) return showToast("⚠️ Isi semua field password","warning");
  if(nw!==cf) return showToast("⚠️ Password baru tidak cocok","warning");
  if(nw.length<4) return showToast("⚠️ Password minimal 4 karakter","warning");
  try {
    const r=await fetch("/profil/"+localStorage.getItem("user")+"/password",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({oldPassword:old,newPassword:nw})});
    const d=await r.json();
    if(d.status==="OK") { showToast("✅ Password berhasil diubah!"); cancelEditPw(); loadProfil(localStorage.getItem("user")); }
    else if(d.status==="WRONG_PASSWORD") showToast("❌ Password lama salah!","error");
    else showToast("❌ Gagal mengubah password","error");
  } catch { showToast("❌ Gagal","error"); }
}

// Update foto profil
function startPhotoUpdate() {
  document.getElementById("foto-cam-wrap").classList.remove("hidden");
  document.getElementById("btn-simpan-foto").classList.add("hidden");
  capturedPhotoData="";
  startCam("video-foto");
}
function cancelPhoto() {
  document.getElementById("foto-cam-wrap").classList.add("hidden");
  document.getElementById("btn-simpan-foto").classList.add("hidden");
  stopCam("video-foto"); capturedPhotoData="";
}
function capturePhoto() {
  capturedPhotoData=takePhotoFromEl("video-foto");
  if(!capturedPhotoData) return showToast("⚠️ Kamera belum siap","warning");
  // Preview
  const wrap=document.getElementById("profil-photo-wrap");
  wrap.innerHTML=`<img src="${capturedPhotoData}" class="profil-avatar" alt="preview">`;
  stopCam("video-foto");
  document.getElementById("foto-cam-wrap").classList.add("hidden");
  document.getElementById("btn-simpan-foto").classList.remove("hidden");
  showToast("📸 Foto diambil! Klik Simpan untuk menyimpan.");
}
async function savePhoto() {
  if(!capturedPhotoData) return showToast("⚠️ Belum ada foto","warning");
  try {
    const r=await fetch("/profil/"+localStorage.getItem("user"),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoProfil:capturedPhotoData})});
    if((await r.json()).status==="OK") {
      showToast("✅ Foto profil berhasil disimpan!");
      document.getElementById("btn-simpan-foto").classList.add("hidden");
      capturedPhotoData="";
      loadProfil(localStorage.getItem("user"));
    }
  } catch { showToast("❌ Gagal menyimpan foto","error"); }
}

// Update data wajah
function startFaceUpdate() {
  document.getElementById("face-update-wrap").classList.remove("hidden");
  startCam("video-face-update");
}
function cancelFaceUpdate() {
  document.getElementById("face-update-wrap").classList.add("hidden");
  stopCam("video-face-update");
}
async function captureFaceUpdate() {
  if(!faceModelsLoaded) return showToast("⏳ Model wajah belum siap","warning");
  document.getElementById("face-update-status").innerText="Mendeteksi wajah...";
  const videoEl=document.getElementById("video-face-update");
  const descriptor=await getFaceDescriptor(videoEl);
  if(!descriptor) return showToast("❌ Wajah tidak terdeteksi! Pastikan pencahayaan cukup","error");
  try {
    const r=await fetch("/profil/"+localStorage.getItem("user")+"/face",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({faceDescriptor:Array.from(descriptor)})});
    if((await r.json()).status==="OK") {
      showToast("✅ Data wajah berhasil diperbarui!");
      cancelFaceUpdate();
      loadProfil(localStorage.getItem("user"));
    }
  } catch { showToast("❌ Gagal","error"); }
}

// Hapus akun
async function hapusAkunSendiri() {
  if(!confirm("⚠️ Hapus akun ini? Tindakan tidak bisa dibatalkan!")) return;
  try {
    const r=await fetch("/profil/"+currentProfilData.username,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({byUser:localStorage.getItem("user")})});
    const d=await r.json();
    if(d.status==="OK") { showToast("🗑 Akun berhasil dihapus"); openView("view-anggota"); }
    else if(d.status==="FORBIDDEN") showToast("❌ Tidak punya akses untuk menghapus akun","error");
  } catch { showToast("❌ Gagal","error"); }
}

// ═══════════════════════════════════════════════
// ANGGOTA
// ═══════════════════════════════════════════════
function switchAnggotaTab(tab) {
  const isDaftar=tab==="daftar";
  document.getElementById("apanel-daftar").classList.toggle("hidden",!isDaftar);
  document.getElementById("apanel-group").classList.toggle("hidden",isDaftar);
  document.getElementById("atab-daftar").classList.toggle("active",isDaftar);
  document.getElementById("atab-group").classList.toggle("active",!isDaftar);
  if(!isDaftar) loadGroups();
}

async function loadAnggota() {
  const search=(document.getElementById("anggota-search")?.value||"").toLowerCase();
  try {
    const r=await fetch("/anggota");
    const data=await r.json();
    const filtered=data.filter(m=>(m.namaLengkap||m.username).toLowerCase().includes(search));
    const list=document.getElementById("member-list");
    if(!filtered.length){ list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada anggota</p>'; return; }
    list.innerHTML=filtered.map(m=>`
      <div class="emp-item" onclick="openAnggotaDetail('${m.username}')">
        <div style="display:flex;align-items:center;gap:10px;">
          ${m.photoProfil
            ? `<img src="${m.photoProfil}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;" alt="">`
            : `<div style="width:38px;height:38px;border-radius:50%;background:${m.roleColor||'#7f8c8d'};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:15px;flex-shrink:0;">${(m.namaLengkap||m.username)[0].toUpperCase()}</div>`
          }
          <div>
            <div class="emp-name">${m.namaLengkap||m.username}</div>
            <div class="emp-time" style="color:${m.roleColor||'#7f8c8d'};font-weight:600;">● ${m.roleName||'Anggota'} ${m.groupName?'· '+m.groupName:''}</div>
          </div>
        </div>
        <span style="color:#ccc;font-size:20px;">›</span>
      </div>`).join("");
  } catch { document.getElementById("member-list").innerHTML='<p style="color:var(--muted);text-align:center;">Gagal memuat</p>'; }
}

// Bottom sheet detail anggota
async function openAnggotaDetail(username) {
  try {
    const [pr, rl, gr] = await Promise.all([fetch("/profil/"+username), fetch("/roles"), fetch("/groups")]);
    const profil  = await pr.json();
    const roles   = await rl.json();
    const groups  = await gr.json();

    const canEdit = userLevel<=2; // owner atau admin

    const roleOpts  = roles.map(r=>`<option value="${r.id}" ${r.id===profil.role?'selected':''}>${r.name}</option>`).join("");
    const groupOpts = `<option value="">-- Tidak ada --</option>`+groups.map(g=>`<option value="${g.id}" ${g.id===profil.groupId?'selected':''}>${g.nama}</option>`).join("");

    document.getElementById("anggota-detail-content").innerHTML=`
      <!-- Header profil -->
      <div style="text-align:center;margin-bottom:20px;">
        ${profil.photoProfil
          ? `<img src="${profil.photoProfil}" style="width:70px;height:70px;border-radius:50%;object-fit:cover;border:3px solid var(--primary);margin-bottom:8px;" alt="">`
          : `<div style="width:70px;height:70px;border-radius:50%;background:${profil.roleColor||'#7f8c8d'};display:flex;align-items:center;justify-content:center;font-size:26px;color:white;margin:0 auto 8px;">${(profil.namaLengkap||username)[0].toUpperCase()}</div>`
        }
        <div style="font-size:16px;font-weight:700;">${profil.namaLengkap||username}</div>
        <div style="font-size:13px;color:${profil.roleColor};font-weight:600;">● ${profil.roleName}</div>
      </div>

      <!-- Info Akun -->
      <div style="background:#f8f9ff;border-radius:12px;padding:14px;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:10px;">INFORMASI AKUN</div>
        <div class="profil-row"><div><div class="profil-label">Username</div><div class="profil-value">${profil.username}</div></div></div>
        ${canEdit ? `<div class="profil-row"><div><div class="profil-label">Password</div>
          <div class="profil-value secret" onclick="togglePasswordReveal(this)" data-actual="${profil.password}">••••••••</div></div></div>` : ""}
        <div class="profil-row"><div><div class="profil-label">Agama</div><div class="profil-value">${profil.agama||"-"}</div></div></div>
        <div class="profil-row"><div><div class="profil-label">Jabatan</div><div class="profil-value">${profil.jabatan||"-"}</div></div></div>
        <div class="profil-row"><div><div class="profil-label">Group</div><div class="profil-value">${profil.groupName||"-"}</div></div></div>
        <div class="profil-row"><div><div class="profil-label">Lingkup Kerja</div>
          <div class="profil-value">${profil.lingkupKerja==="luar"?"🌍 Tugas Luar":"🏢 Default"}</div></div></div>
        ${userLevel<=1 ? `<div class="profil-row"><div><div class="profil-label">Nominal Gaji</div>
          <div class="profil-value">${profil.nominalGaji?"Rp "+Number(profil.nominalGaji).toLocaleString("id-ID"):"-"}</div></div></div>` : ""}
      </div>

      ${canEdit ? `
      <!-- Form Edit oleh Owner/Admin -->
      <div style="background:#fff3e0;border-radius:12px;padding:14px;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--warning);margin-bottom:10px;">✏️ EDIT ANGGOTA (Owner/Admin)</div>

        <div class="form-group"><label>Peran (Role)</label>
          <select id="edit-role-${username}">${roleOpts}</select>
        </div>
        <div class="form-group"><label>Jabatan</label>
          <input type="text" id="edit-jabatan-${username}" value="${profil.jabatan||''}" placeholder="contoh: Staff, Koordinator">
        </div>
        <div class="form-group"><label>Group</label>
          <select id="edit-group-${username}">${groupOpts}</select>
        </div>
        <div class="form-group"><label>Lingkup Kerja</label>
          <select id="edit-lingkup-${username}">
            <option value="default" ${profil.lingkupKerja!=="luar"?'selected':''}>🏢 Default (Wajib di Area)</option>
            <option value="luar"    ${profil.lingkupKerja==="luar"?'selected':''}>🌍 Tugas Luar (Bebas Area)</option>
          </select>
        </div>
        ${userLevel<=1 ? `<div class="form-group"><label>Nominal Gaji (Rp)</label>
          <input type="number" id="edit-gaji-${username}" value="${profil.nominalGaji||''}" placeholder="contoh: 5000000">
        </div>` : ""}
        <button onclick="saveAnggotaEdit('${username}')" class="btn-green" style="width:100%;padding:12px;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;">💾 Simpan Perubahan</button>
      </div>

      ${username!==localStorage.getItem("user") ? `
      <button onclick="deleteAnggota('${username}')" style="width:100%;padding:12px;border:none;border-radius:10px;
        background:var(--danger);color:white;font-weight:700;font-size:14px;cursor:pointer;">🗑 Hapus Anggota</button>` : ""}
      ` : ""}
    `;

    document.getElementById("anggota-modal").classList.remove("hidden");
  } catch(e) { console.error(e); showToast("❌ Gagal memuat profil","error"); }
}

function closeAnggotaModal(e) {
  if(e.target===document.getElementById("anggota-modal"))
    document.getElementById("anggota-modal").classList.add("hidden");
}

async function saveAnggotaEdit(username) {
  const role     = document.getElementById(`edit-role-${username}`)?.value;
  const jabatan  = document.getElementById(`edit-jabatan-${username}`)?.value;
  const groupId  = document.getElementById(`edit-group-${username}`)?.value;
  const lingkup  = document.getElementById(`edit-lingkup-${username}`)?.value;
  const gaji     = document.getElementById(`edit-gaji-${username}`)?.value;

  const body = { role, jabatan, lingkupKerja:lingkup, groupId };
  if(gaji!==undefined) body.nominalGaji=gaji;

  try {
    const r=await fetch("/anggota/"+username,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if((await r.json()).status==="OK") {
      showToast("✅ Data anggota berhasil disimpan!");
      document.getElementById("anggota-modal").classList.add("hidden");
      loadAnggota();
    }
  } catch { showToast("❌ Gagal menyimpan","error"); }
}

async function deleteAnggota(username) {
  if(!confirm(`Hapus anggota "${username}"?`)) return;
  try {
    const r=await fetch("/anggota/"+username,{method:"DELETE"});
    if((await r.json()).status==="OK") {
      showToast("🗑 Anggota dihapus");
      document.getElementById("anggota-modal").classList.add("hidden");
      loadAnggota();
    }
  } catch { showToast("❌ Gagal","error"); }
}

// ═══════════════════════════════════════════════
// GROUP
// ═══════════════════════════════════════════════
async function loadGroups() {
  try {
    const [gr, ar] = await Promise.all([fetch("/groups"), fetch("/anggota")]);
    const groups   = await gr.json();
    const anggota  = await ar.json();
    const list     = document.getElementById("group-list");

    // Populate dropdown manager & anggota form
    const mSel=document.getElementById("gform-manager");
    const aSel=document.getElementById("gform-anggota");
    if(mSel){
      mSel.innerHTML=`<option value="">-- Pilih Manager --</option>`+anggota.map(a=>`<option value="${a.username}">${a.namaLengkap||a.username}</option>`).join("");
    }
    if(aSel){
      aSel.innerHTML=anggota.map(a=>`<option value="${a.username}">${a.namaLengkap||a.username}</option>`).join("");
    }

    if(!groups.length){ list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada group</p>'; return; }

    list.innerHTML=groups.map(g=>{
      const mgr     = anggota.find(a=>a.username===g.managerId);
      const members = (g.anggotaIds||[]).map(id=>{ const a=anggota.find(x=>x.username===id); return a?a.namaLengkap||a.username:id; });
      return `<div class="group-card">
        <div class="group-card-header" onclick="toggleGroupCard('gc-${g.id}')">
          <div>
            <div class="group-card-title">🏷️ ${g.nama}</div>
            <div class="group-card-sub">Manager: ${mgr?mgr.namaLengkap||mgr.username:'(belum ditentukan)'} · ${members.length} anggota</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button onclick="event.stopPropagation();deleteGroup('${g.id}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>
            <span style="color:#ccc;font-size:20px;">›</span>
          </div>
        </div>
        <div class="group-card-body" id="gc-${g.id}">
          <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Anggota Group:</div>
          ${members.length ? members.map(m=>`<div style="font-size:13px;padding:4px 0;border-bottom:1px solid #f0f2f5;">👤 ${m}</div>`).join("") : '<div style="font-size:12px;color:var(--muted);">Belum ada anggota</div>'}
        </div>
      </div>`;
    }).join("");
  } catch { document.getElementById("group-list").innerHTML='<p style="color:var(--muted);text-align:center;">Gagal memuat</p>'; }
}

function toggleGroupCard(id) {
  const el=document.getElementById(id);
  if(el) el.classList.toggle("open");
}

function showAddGroup() { document.getElementById("add-group-form").classList.toggle("hidden"); }
function cancelAddGroup() { document.getElementById("add-group-form").classList.add("hidden"); }

async function saveGroup() {
  const nama    = document.getElementById("gform-nama").value.trim();
  const manager = document.getElementById("gform-manager").value;
  const sel     = document.getElementById("gform-anggota");
  const anggotaIds = Array.from(sel.selectedOptions).map(o=>o.value);
  if(!nama) return showToast("⚠️ Isi nama group!","warning");
  try {
    const r=await fetch("/groups",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nama,managerId:manager,anggotaIds})});
    if((await r.json()).status==="OK") {
      showToast("✅ Group berhasil dibuat!");
      document.getElementById("gform-nama").value="";
      cancelAddGroup();
      loadGroups();
    }
  } catch { showToast("❌ Gagal menyimpan","error"); }
}

async function deleteGroup(id) {
  if(!confirm("Hapus group ini?")) return;
  try {
    const r=await fetch("/groups/"+id,{method:"DELETE"});
    if((await r.json()).status==="OK") { showToast("🗑 Group dihapus"); loadGroups(); }
  } catch { showToast("❌ Gagal","error"); }
}

// ═══════════════════════════════════════════════
// RULES
// ═══════════════════════════════════════════════
const ALL_MENUS=[
  {key:"home",label:"🏠 Beranda"},{key:"rekap",label:"📋 Rekap"},
  {key:"admin",label:"👑 Admin Panel"},{key:"setting",label:"⚙️ Pengaturan"},
  {key:"profil",label:"👤 Profil"},{key:"anggota",label:"👥 Anggota"},
  {key:"rules",label:"🔐 Rules"},{key:"area",label:"📍 Area Kantor"},
  {key:"libur",label:"📅 Hari Libur & Cuti"},{key:"aktivitas",label:"📌 Aktivitas"},
  {key:"timesheet",label:"🕐 Timesheet"},
];

async function loadRules() {
  try {
    const r=await fetch("/roles");
    const roles=await r.json();
    const list=document.getElementById("rules-list");
    list.innerHTML=roles.map(role=>{
      const isOwner=role.id==="owner";
      const rows=ALL_MENUS.map(m=>{
        const checked=role.menus.includes(m.key);
        const disabled=isOwner||m.key==="home";
        return `<div class="toggle-row">
          <span class="toggle-label">${m.label}</span>
          <label class="toggle-sw">
            <input type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''}
              onchange="toggleRoleMenu('${role.id}','${m.key}',this.checked)">
            <span class="toggle-sl"></span>
          </label>
        </div>`;
      }).join("");
      return `<div class="group-card" style="margin-bottom:10px;">
        <div class="group-card-header" style="background:${role.color}15;" onclick="toggleGroupCard('rc-${role.id}')">
          <div>
            <div class="group-card-title" style="color:${role.color};">${role.name} ${isOwner?'👑':''}</div>
            <div class="group-card-sub">${role.menus.length} menu aktif ${isOwner?'· Tidak bisa diubah':''}</div>
          </div>
          <span style="color:#ccc;font-size:20px;">›</span>
        </div>
        <div class="group-card-body" id="rc-${role.id}">
          ${isOwner?'<p style="font-size:12px;color:var(--muted);margin-bottom:8px;">Owner selalu memiliki akses penuh.</p>':''}
          ${rows}
        </div>
      </div>`;
    }).join("");
  } catch {}
}

async function toggleRoleMenu(roleId, menuKey, enabled) {
  try {
    const r=await fetch("/roles");
    const roles=await r.json();
    const role=roles.find(x=>x.id===roleId);
    if(!role) return;
    if(enabled&&!role.menus.includes(menuKey)) role.menus.push(menuKey);
    if(!enabled) role.menus=role.menus.filter(m=>m!==menuKey);
    if(!role.menus.includes("home")) role.menus.push("home");
    const rr=await fetch("/roles/"+roleId+"/menus",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({menus:role.menus})});
    const dd=await rr.json();
    if(dd.status==="OK") showToast("✅ Akses diperbarui");
    else if(dd.status==="PROTECTED") showToast("⚠️ Owner tidak bisa diubah","warning");
    loadRules();
  } catch { showToast("❌ Gagal","error"); }
}

// ═══════════════════════════════════════════════
// AREA, LIBUR, AKTIVITAS, TIMESHEET
// ═══════════════════════════════════════════════
async function loadAreas() {
  try {
    const r=await fetch("/areas"), d=await r.json();
    const list=document.getElementById("area-list");
    if(!d.length){ list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada area</p>'; return; }
    list.innerHTML=d.map(a=>`<div class="area-item">
      <div><div class="area-name">📍 ${a.name}</div><div class="area-detail">Radius: ${a.radius}m · ${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}</div></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="area-badge ${a.active?'on':'off'}" onclick="toggleArea('${a.id}',${!a.active})">${a.active?'✅ Aktif':'❌ Nonaktif'}</span>
        <button onclick="deleteArea('${a.id}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>
      </div></div>`).join("");
  } catch {}
}

function getMyLoc() {
  navigator.geolocation.getCurrentPosition(p=>{
    document.getElementById("area-lat").value=p.coords.latitude.toFixed(7);
    document.getElementById("area-lng").value=p.coords.longitude.toFixed(7);
    showToast("📍 Lokasi berhasil diambil!");
  },null,{enableHighAccuracy:true});
}
async function saveArea() {
  const name=document.getElementById("area-name").value.trim();
  const lat=document.getElementById("area-lat").value;
  const lng=document.getElementById("area-lng").value;
  const radius=document.getElementById("area-radius").value;
  if(!name||!lat||!lng) return showToast("⚠️ Isi semua field!","warning");
  try {
    const r=await fetch("/areas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,lat,lng,radius})});
    if((await r.json()).status==="OK") {
      showToast("✅ Area ditambahkan!");
      document.getElementById("area-name").value="";
      document.getElementById("area-lat").value="";
      document.getElementById("area-lng").value="";
      loadAreas();
    }
  } catch { showToast("❌ Gagal","error"); }
}
async function toggleArea(id,active) {
  try { await fetch("/areas/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({active})}); showToast(active?"✅ Area diaktifkan":"❌ Area dinonaktifkan"); loadAreas(); } catch {}
}
async function deleteArea(id) {
  if(!confirm("Hapus area ini?")) return;
  try { const r=await fetch("/areas/"+id,{method:"DELETE"}); if((await r.json()).status==="OK"){ showToast("🗑 Area dihapus"); loadAreas(); } } catch { showToast("❌ Gagal","error"); }
}

async function loadLibur() {
  try {
    const r=await fetch("/libur"), d=await r.json();
    const list=document.getElementById("libur-list");
    if(!d.length){ list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada data</p>'; return; }
    list.innerHTML=d.sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<div class="holiday-item">
      <div><div class="h-date-text">${x.date}</div><div class="h-name-text">${x.name}</div></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="h-type-badge ${x.type}">${x.type==='nasional'?'🔴 Nasional':'🟢 Cuti'}</span>
        <button onclick="deleteLibur('${x.id}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">🗑</button>
      </div></div>`).join("");
  } catch {}
}
async function saveLibur() {
  const date=document.getElementById("libur-date").value;
  const name=document.getElementById("libur-name").value.trim();
  const type=document.getElementById("libur-type").value;
  if(!date||!name) return showToast("⚠️ Isi tanggal dan nama!","warning");
  try {
    const r=await fetch("/libur",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date,name,type})});
    if((await r.json()).status==="OK"){ showToast("✅ Berhasil ditambahkan!"); document.getElementById("libur-date").value=""; document.getElementById("libur-name").value=""; loadLibur(); }
  } catch { showToast("❌ Gagal","error"); }
}
async function deleteLibur(id) {
  if(!confirm("Hapus data ini?")) return;
  try { const r=await fetch("/libur/"+id,{method:"DELETE"}); if((await r.json()).status==="OK"){ showToast("🗑 Berhasil dihapus"); loadLibur(); } } catch {}
}

async function loadAktivitas() {
  try {
    const r=await fetch("/aktivitas"), d=await r.json();
    const list=document.getElementById("aktivitas-list");
    if(!d.length){ list.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Belum ada aktivitas</p>'; return; }
    const icons={IN:"🟢",OUT:"🔴",BREAK_START:"☕",BREAK_END:"💪"};
    const labels={IN:"Clock In",OUT:"Clock Out",BREAK_START:"Mulai Istirahat",BREAK_END:"Selesai Istirahat"};
    list.innerHTML=d.map(a=>`<div class="act-item">
      <div class="act-user">${icons[a.type]||"📌"} ${a.user}</div>
      <div class="act-desc">${labels[a.type]||a.type}</div>
      <div class="act-time">${new Date(a.time).toLocaleString("id-ID")}</div>
    </div>`).join("");
  } catch {}
}

async function loadTimesheet() {
  const month=document.getElementById("ts-month").value;
  const search=(document.getElementById("ts-search").value||"").toLowerCase();
  if(!month) return;
  try {
    const r=await fetch("/timesheet?month="+month), d=await r.json();
    const filtered=d.filter(x=>(x.namaLengkap||x.user).toLowerCase().includes(search));
    const el=document.getElementById("ts-content");
    if(!filtered.length){ el.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Tidak ada data</p>'; return; }
    el.innerHTML=`<table class="ts-table">
      <thead><tr><th>Nama</th><th>Hari</th><th>Jam Kerja</th><th>Lembur</th></tr></thead>
      <tbody>${filtered.map(x=>`<tr>
        <td><b>${x.namaLengkap||x.user}</b></td>
        <td>${x.totalDays}</td><td>${x.totalJam}j</td>
        <td style="color:${parseFloat(x.overtime)>0?'var(--warning)':'var(--muted)'};">${x.overtime}j</td>
      </tr>`).join("")}</tbody>
    </table>`;
  } catch {}
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
window.onload=async function(){
  await loadFaceModels();
  checkLoginStatus();
};