// server.js
// OIS School Bell (Oxford International School) - local web boshqaruv paneli.
// Hech qanday tashqi paket (npm install) kerak emas - faqat Node.js o'zining
// ichki (built-in) modullaridan foydalanadi.
//
// Bu server ikkita ishni bajaradi:
//   1) public/index.html sahifasini (boshqaruv paneli dizayni) ko'rsatadi
//   2) /api/... orqali, bell_scheduler.py o'qiydigan AYNAN O'SHA
//      config/schedule.json faylini o'qiydi/yozadi - shuning uchun bu
//      panelda qilingan o'zgarish, Python dasturi ishlab turgan bo'lsa,
//      bir daqiqa ichida haqiqatan ham kuchga kiradi.
//
// Ishga tushirish:  npm run dev   (yoki: node server.js)

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { spawn } = require("child_process");
const crypto = require("crypto");

// .env faylini o'qiydi (tashqi paket kerak emas). Muhit o'zgaruvchisi allaqachon berilgan bo'lsa, tegmaydi.
function loadEnvFile() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env yo'q - Supabase o'chiq holda ishlayveradi */ }
}
loadEnvFile();

// .env dagi qiymatlarni yangilaydi (bor qatorni almashtiradi, yo'g'ini oxiriga qo'shadi) va darhol kuchga kiritadi.
// Panelning "AI kalitlari" bo'limi shu orqali kalitni saqlaydi - faylni qo'lda ochish shart emas.
function saveEnvValues(values) {
  const envPath = path.join(__dirname, ".env");
  let lines = [];
  try { lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/); } catch { /* hali yo'q */ }
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${key}\\s*=`);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx === -1) lines.push(`${key}=${value}`);
    else lines[idx] = `${key}=${value}`;
    process.env[key] = value;
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
}

const ai = require("./ai"); // AI e'lon: Azure (ovoz) va Gemini (matn) - .env dan keyin yuklanadi

// Standart 3000. PORT muhit o'zgaruvchisi berilsa, o'sha port ishlatiladi.
const PORT = Number(process.env.PORT) || 3000;

// bell_web/ va bell_system/ bir xil ota-papkada (masalan "School Bell/") turadi deb
// faraz qilinadi. Agar boshqacha joylashgan bo'lsa, shu yo'lni o'zgartiring.
const BELL_SYSTEM_DIR = path.join(__dirname, "..", "bell_system");
const SCHEDULE_PATH = path.join(BELL_SYSTEM_DIR, "config", "schedule.json");
const PUBLIC_HOLIDAYS_PATH = path.join(BELL_SYSTEM_DIR, "config", "uz_holidays.json"); // O'zbekiston davlat bayramlari
const LOG_PATH = path.join(BELL_SYSTEM_DIR, "logs", "bell_log.csv");
const LIVE_ANNOUNCE_SCRIPT = path.join(BELL_SYSTEM_DIR, "live_announce.py");
const AUDIO_DIR = path.join(BELL_SYSTEM_DIR, "audios");
// O'rnatuvchi (setup.exe) bilan o'rnatilganda Python dastur ichida keladi (runtime/python) -
// kompyuterda alohida Python o'rnatilmagan bo'lsa ham jonli e'lon ishlashi uchun. Bo'lmasa - tizimdagi "python".
const BUNDLED_PYTHON = path.join(__dirname, "..", "runtime", "python", "python.exe");
const PYTHON_EXE = fs.existsSync(BUNDLED_PYTHON) ? BUNDLED_PYTHON : "python";
const PUBLIC_DIR = path.join(__dirname, "public");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MAX_RINGS = 20;
const MAX_WEEKS = 520;

function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function listAudioFiles() {
  try {
    return fs.readdirSync(AUDIO_DIR).filter((f) => /\.(mp3|wav)$/i.test(f)).sort();
  } catch {
    return [];
  }
}

// ---------- Ovoz kutubxonasi (Supabase) -> lokal kesh ----------
// Fayllar Supabase Storage'da saqlanadi. Maktab kompyuteri ularni audios/library/ ga
// yuklab qo'yadi va bell_scheduler.py aynan shu lokal nusxadan chaladi, shuning uchun
// internet uzilsa ham qo'ng'iroqlar ishlayveradi.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SOUNDS_BUCKET = "sounds";
const LIB_DIR = path.join(AUDIO_DIR, "library");
const LIB_INDEX = path.join(LIB_DIR, "index.json");
const LIB_FILE_RE = /^[0-9a-f-]{36}\.(mp3|wav)$/i;
const LIB_SYNC_EVERY_MS = 60 * 1000;
const libSync = { running: false, lastRun: null, lastOk: null, lastError: null };

function readLibraryIndex() {
  try { return JSON.parse(fs.readFileSync(LIB_INDEX, "utf-8")); } catch { return []; }
}

function libraryFileName(row) {
  const ext = path.extname(row.storage_path || "").toLowerCase() === ".wav" ? ".wav" : ".mp3";
  return `${row.id}${ext}`;
}

async function syncLibrary() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    libSync.lastError = "Supabase sozlanmagan (.env faylini tekshiring)";
    return libSync;
  }
  if (libSync.running) return libSync;
  libSync.running = true;
  libSync.lastRun = new Date().toISOString();
  const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
  const errors = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/sounds?select=id,name,kind,storage_path,size_bytes,duration_seconds&order=created_at.asc`,
      { headers }
    );
    if (!r.ok) throw new Error(`sounds jadvali: HTTP ${r.status}`);
    const rows = await r.json();
    fs.mkdirSync(LIB_DIR, { recursive: true });

    const index = [];
    for (const row of rows) {
      const fileName = libraryFileName(row);
      const dest = path.join(LIB_DIR, fileName);
      let have = false;
      try { have = fs.statSync(dest).size === Number(row.size_bytes); } catch { /* hali yo'q */ }
      if (!have) {
        try {
          const objPath = String(row.storage_path).split("/").map(encodeURIComponent).join("/");
          const obj = await fetch(`${SUPABASE_URL}/storage/v1/object/${SOUNDS_BUCKET}/${objPath}`, { headers });
          if (!obj.ok) throw new Error(`HTTP ${obj.status}`);
          fs.writeFileSync(dest + ".part", Buffer.from(await obj.arrayBuffer()));
          fs.renameSync(dest + ".part", dest);
          have = true;
        } catch (e) {
          errors.push(`${row.name}: ${e.message}`);
        }
      }
      if (have) {
        index.push({
          id: row.id, name: row.name, kind: row.kind, file: `library/${fileName}`,
          size: row.size_bytes, duration: row.duration_seconds,
        });
      }
    }

    // Kutubxonadan o'chirilgan ovozlarning lokal nusxasini tozalaymiz
    const keep = new Set(rows.map(libraryFileName));
    for (const f of fs.readdirSync(LIB_DIR)) {
      if ((LIB_FILE_RE.test(f) && !keep.has(f)) || f.endsWith(".part")) {
        try { fs.unlinkSync(path.join(LIB_DIR, f)); } catch { /* band bo'lishi mumkin */ }
      }
    }
    fs.writeFileSync(LIB_INDEX, JSON.stringify(index, null, 2));
    libSync.lastOk = new Date().toISOString();
    libSync.lastError = errors.length ? errors.join("; ") : null;
  } catch (e) {
    // Internet yo'q bo'lsa ham eski lokal nusxalar (va index) joyida qoladi
    libSync.lastError = String((e && e.message) || e);
  } finally {
    libSync.running = false;
  }
  return libSync;
}

// ---------- Kirish (login) tekshiruvi ----------
// Panelning barcha /api/... va /audios/... so'rovlari Supabase login tokenini talab qiladi va
// foydalanuvchida app_metadata.role = 'admin' bo'lishi shart (bazadagi is_admin() bilan bir xil qoida).
// Token Supabase'ning o'zida tekshiriladi va bir necha soniyaga eslab qolinadi. Internet uzilsa,
// avval tasdiqlangan (muddati o'tmagan) token ishlashda davom etadi - qo'ng'iroqlarning o'zi
// baribir bell_scheduler.py orqali internetsiz ishlaydi.
const AUTH_OK_MS = 60 * 1000;
const AUTH_BAD_MS = 10 * 1000;
const AUTH_CACHE_MAX = 200;
const authCache = new Map(); // tokenning sha256 -> { result, until }

function jwtExpiresAt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8"));
    return Number(payload.exp) * 1000 || 0;
  } catch { return 0; }
}

async function checkAuth(req) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, status: 503, error: "Supabase sozlanmagan (bell_web/.env faylini tekshiring)" };
  }
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
  if (!m) return { ok: false, status: 401, error: "Avval tizimga kiring" };
  const token = m[1];
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const hit = authCache.get(key);
  const now = Date.now();
  if (hit && hit.until > now) return hit.result;

  const remember = (result, ms) => {
    if (authCache.size >= AUTH_CACHE_MAX) authCache.delete(authCache.keys().next().value);
    authCache.set(key, { result, until: now + ms });
    return result;
  };

  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Supabase'ga yetib bo'lmadi: oldin tasdiqlangan token bo'lsa va muddati o'tmagan bo'lsa, ruxsat beramiz
    if (hit && hit.result.ok && jwtExpiresAt(token) > now) return hit.result;
    return { ok: false, status: 503, error: "Supabase bilan aloqa yo'q - internetni tekshiring" };
  }
  if (r.status === 401 || r.status === 403) {
    return remember({ ok: false, status: 401, error: "Sessiya eskirgan - qayta kiring" }, AUTH_BAD_MS);
  }
  if (!r.ok) return { ok: false, status: 503, error: `Supabase javobi: HTTP ${r.status}` };
  const user = await r.json();
  if (!user || !user.app_metadata || user.app_metadata.role !== "admin") {
    return remember({ ok: false, status: 403, error: "Bu akkauntga ruxsat berilmagan (admin roli kerak)" }, AUTH_BAD_MS);
  }
  return remember({ ok: true, email: user.email }, AUTH_OK_MS);
}

// ---------- Ovoz dispetcheri (bell_scheduler.py ichida) bilan aloqa ----------
// Karnayga chiqadigan hamma narsani dispetcher boshqaradi (e'lon > qo'ng'iroq > musiqa). Panel unga faqat
// shu kompyuter ichidagi port orqali xabar beradi. Qo'ng'iroq dasturi ishlamayotgan bo'lsa - null qaytadi.
const ENGINE_URL = `http://127.0.0.1:${Number(process.env.BELL_ENGINE_PORT) || 3901}`;

async function engineCall(method, p, body) {
  try {
    const r = await fetch(ENGINE_URL + p, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// ---------- Jonli e'lon (mikrofon -> speaker) jarayonini boshqarish ----------
// Mikrofon yoqilganda dispetcherga aytiladi: musiqa pasayadi, qo'ng'iroqlar e'lon tugashini kutadi.
let announceProc = null;
let announceError = null;

function announceStatus() {
  return { running: !!announceProc, error: announceError };
}

function startAnnounce() {
  if (announceProc) return announceStatus();
  announceError = null;
  announceProc = spawn(PYTHON_EXE, [LIVE_ANNOUNCE_SCRIPT], { cwd: BELL_SYSTEM_DIR, windowsHide: true });
  announceProc.stderr.on("data", (d) => {
    console.error("live_announce:", d.toString());
  });
  const proc = announceProc;
  proc.on("exit", (code) => {
    if (code && code !== 0) announceError = `live_announce.py kod ${code} bilan to'xtadi`;
    if (announceProc === proc) { announceProc = null; engineCall("POST", "/mic", { on: false }); }
  });
  proc.on("error", (err) => {
    announceError = String(err.message || err);
    if (announceProc === proc) { announceProc = null; engineCall("POST", "/mic", { on: false }); }
  });
  engineCall("POST", "/mic", { on: true });
  return announceStatus();
}

function stopAnnounce() {
  if (announceProc) {
    announceProc.kill();
    announceProc = null;
  }
  engineCall("POST", "/mic", { on: false });
  return announceStatus();
}

// ---------- AI e'lonni darhol dinamikdan chalish ----------
// Brauzerda yasalgan WAV vaqtincha audios/_live/ ga yoziladi va ovoz dispetcheriga "e'lon" sifatida beriladi:
// musiqa pasayadi, chalinayotgan qo'ng'iroq tugagach darhol boshlanadi; dispetcher faylni o'zi o'chiradi.
// Qo'ng'iroq dasturi ishlamayotgan bo'lsa - eski usul: alohida jarayon bilan to'g'ridan-to'g'ri chalinadi.
const LIVE_DIR = path.join(AUDIO_DIR, "_live");
const SAMPLE_CACHE_DIR = path.join(__dirname, ".cache", "samples"); // diktor namunalari keshi
const MAX_LIVE_BYTES = 25 * 1024 * 1024;
let liveProc = null;        // eski usul (dispetchersiz) jarayoni
let liveEngineId = null;    // dispetcherdagi e'lon raqami
let liveError = null;

async function liveStatus() {
  if (liveEngineId !== null) {
    const st = await engineCall("GET", "/status");
    if (st) {
      const cur = st.current.announcement;
      const queued = (st.queued.announcement || []).some((i) => i.id === liveEngineId);
      const playing = !!(cur && cur.id === liveEngineId) || queued;
      if (!playing) liveEngineId = null;
      return { playing, waiting: queued, error: liveError };
    }
    liveEngineId = null;
  }
  return { playing: !!liveProc, waiting: false, error: liveError };
}

async function stopLive() {
  if (liveEngineId !== null) {
    await engineCall("POST", "/stop", { priority: "announcement" });
    liveEngineId = null;
  }
  if (liveProc) { liveProc.kill(); liveProc = null; }
  return liveStatus();
}

async function playLive(wavBuffer, volume) {
  await stopLive();
  liveError = null;
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  const name = crypto.randomBytes(6).toString("hex") + ".wav";
  const filePath = path.join(LIVE_DIR, name);
  fs.writeFileSync(filePath, wavBuffer);

  const res = await engineCall("POST", "/play", { file: "_live/" + name, priority: "announcement", volume, label: "AI e'lon (darhol)" });
  if (res && res.ok) {
    liveEngineId = res.id;
    return liveStatus();
  }

  // Dispetcher javob bermadi (qo'ng'iroq dasturi o'chiq) - to'g'ridan-to'g'ri chalamiz
  for (const f of fs.readdirSync(LIVE_DIR)) {
    if (f !== name) { try { fs.unlinkSync(path.join(LIVE_DIR, f)); } catch { /* band bo'lishi mumkin */ } }
  }
  const code =
    "import sys, os\n" +
    "sys.path.insert(0, os.getcwd())  # o'rnatilgan (embeddable) Python joriy papkani o'zi qidirmaydi\n" +
    "import bell_scheduler as b\n" +
    "ok = b.play_sound(sys.argv[1], 1, int(sys.argv[2]))\n" +
    "b.log(\"AI e'lon darhol chalindi\" if ok else \"XATO - AI e'lon chalinmadi\")\n" +
    "sys.exit(0 if ok else 1)\n";
  const proc = spawn(PYTHON_EXE, ["-c", code, "_live/" + name, String(volume)], { cwd: BELL_SYSTEM_DIR, windowsHide: true });
  liveProc = proc;
  proc.on("exit", (exitCode) => {
    if (liveProc === proc) liveProc = null;
    if (exitCode && exitCode !== 0 && exitCode !== null) liveError = "E'lonni chalib bo'lmadi (jurnalga qarang)";
    try { fs.unlinkSync(filePath); } catch { /* keyingi chalishda tozalanadi */ }
  });
  proc.on("error", (err) => {
    if (liveProc === proc) liveProc = null;
    liveError = String(err.message || err);
  });
  return liveStatus();
}

// Ikkilik (audio) so'rov tanasini o'qiydi
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); reject(Object.assign(new Error("Fayl juda katta"), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readSchedule() {
  const raw = fs.readFileSync(SCHEDULE_PATH, "utf-8");
  return JSON.parse(raw);
}

// 60 kundan ko'proq oldin tugagan yozuvlarni (eski ta'tillar, o'tgan bir martalik qo'ng'iroqlar) olib tashlaydi
function pruneOld(list, dateOf) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const pad = (n) => String(n).padStart(2, "0");
  const c = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
  return list.filter((x) => x && typeof x === "object" && String(dateOf(x) || "") >= c);
}

function writeSchedule(config) {
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// Juda oddiy CSV o'qish (bell_scheduler.py logs/bell_log.csv shu formatda yozadi:
// "vaqt","xabar" - Python csv.writer kerak bo'lsa qo'shtirnoqqa oladi)
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function readLog(limit) {
  if (!fs.existsSync(LOG_PATH)) return [];
  const raw = fs.readFileSync(LOG_PATH, "utf-8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return []; // faqat sarlavha yoki bo'sh
  const rows = lines.slice(1).map(parseCsvLine).map(([vaqt, xabar]) => ({ vaqt, xabar }));
  rows.reverse(); // eng oxirgisi birinchi
  return limit ? rows.slice(0, limit) : rows;
}

// "YYYY-MM-DD" haqiqiy sanami (masalan 2026-02-30 emas)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(s) {
  if (!DATE_RE.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Qo'ng'iroq maydonlarini tekshiradi (qo'shish va tahrirlash uchun umumiy).
// oneTime = true - bir martalik qo'ng'iroq: hafta kunlari/hafta soni o'rniga aniq sana ("date").
// Natija: { bell: {...} } yoki { error: "..." }
function parseBellBody(body, oneTime = false) {
  const { time, label, sound } = body;
  if (!TIME_RE.test(time || "")) {
    return { error: "Vaqt HH:MM formatida bo'lishi kerak (masalan 08:25)" };
  }
  if (!sound || !String(sound).trim()) {
    return { error: "'sound' (ovoz fayli) maydoni kerak" };
  }
  if (oneTime) {
    if (!isValidDate(body.date)) return { error: "Sana YYYY-MM-DD formatida bo'lishi kerak" };
    if (body.date < todayLocal()) return { error: "O'tib ketgan sanaga qo'ng'iroq qo'yib bo'lmaydi" };
  }
  const days = oneTime ? null : Array.isArray(body.days) ? WEEKDAYS.filter((d) => body.days.includes(d)) : [];
  if (!oneTime && !days.length) {
    return { error: "Kamida bitta hafta kunini tanlang" };
  }
  const rings = body.rings === undefined || body.rings === null || body.rings === "" ? 1 : Number(body.rings);
  if (!Number.isInteger(rings) || rings < 1 || rings > MAX_RINGS) {
    return { error: `Takrorlanish soni 1 dan ${MAX_RINGS} gacha butun son bo'lishi kerak` };
  }
  const volume = body.volume === undefined || body.volume === null || body.volume === "" ? 100 : Number(body.volume);
  if (!Number.isInteger(volume) || volume < 1 || volume > 100) {
    return { error: "Ovoz balandligi 1 dan 100 gacha butun son (foiz) bo'lishi kerak" };
  }
  if (oneTime) {
    return {
      bell: {
        date: body.date,
        time,
        label: (label && String(label).trim()) || "Bir martalik qo'ng'iroq",
        sound: String(sound).trim(),
        rings,
        volume,
      },
    };
  }
  const weeks = body.weeks === undefined || body.weeks === null || body.weeks === "" ? null : Number(body.weeks);
  if (weeks !== null && (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS)) {
    return { error: `Hafta soni 1 dan ${MAX_WEEKS} gacha butun son bo'lishi kerak (bo'sh = doimiy)` };
  }
  return {
    bell: {
      time,
      label: (label && String(label).trim()) || "Qo'ng'iroq",
      sound: String(sound).trim(),
      days,
      rings,
      volume,
      weeks,
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) { req.destroy(); reject(new Error("Body juda katta")); }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function serveAudio(req, res, pathname) {
  const name = decodeURIComponent(pathname.slice("/audios/".length));
  const filePath = path.join(AUDIO_DIR, name);
  if (!filePath.startsWith(AUDIO_DIR) || name.includes("..")) {
    res.writeHead(403); res.end("Taqiqlangan"); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Topilmadi: " + name);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  // xavfsizlik: public papkadan tashqariga chiqishga yo'l qo'ymaslik
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("Taqiqlangan"); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Topilmadi: " + pathname);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // ---------- Kirish talab qilinadigan yo'llar ----------
    // Ochiq qoladigan yagona narsa: sahifaning o'zi va /api/config (login uchun kerak, unda maxfiy kalit yo'q).
    if ((pathname.startsWith("/api/") && pathname !== "/api/config") || pathname.startsWith("/audios/")) {
      const auth = await checkAuth(req);
      if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    }

    // ---------- API ----------
    if (pathname === "/api/schedule" && req.method === "GET") {
      const config = readSchedule();
      return sendJson(res, 200, config);
    }

    if (pathname === "/api/log" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || "50");
      return sendJson(res, 200, { rows: readLog(limit) });
    }

    if (pathname === "/api/audios" && req.method === "GET") {
      return sendJson(res, 200, { files: listAudioFiles(), library: readLibraryIndex() });
    }

    // Brauzer Supabase'ga ulanishi uchun OCHIQ qiymatlar (service_role kalit hech qachon berilmaydi)
    if (pathname === "/api/config" && req.method === "GET") {
      return sendJson(res, 200, {
        enabled: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
        url: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
      });
    }

    if (pathname === "/api/library" && req.method === "GET") {
      return sendJson(res, 200, { sounds: readLibraryIndex(), sync: libSync });
    }

    if (pathname === "/api/library/sync" && req.method === "POST") {
      await syncLibrary();
      return sendJson(res, 200, { sounds: readLibraryIndex(), sync: libSync });
    }

    if (pathname === "/api/bell/add" && req.method === "POST") {
      const parsed = parseBellBody(await readBody(req));
      if (parsed.error) return sendJson(res, 400, { error: parsed.error });
      const config = readSchedule();
      config.bells = config.bells || [];
      config.bells.push({
        id: crypto.randomBytes(4).toString("hex"),
        ...parsed.bell,
        start_date: todayLocal(),
      });
      config.bells.sort((a, b) => a.time.localeCompare(b.time));
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    // Mavjud qo'ng'iroqni tahrirlash (id o'zgarmaydi)
    if (pathname === "/api/bell/update" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = parseBellBody(body);
      if (parsed.error) return sendJson(res, 400, { error: parsed.error });
      const config = readSchedule();
      config.bells = config.bells || [];
      const idx = config.bells.findIndex((b) => b.id === body.id);
      if (idx === -1) {
        return sendJson(res, 400, { error: "Bunday qo'ng'iroq topilmadi (o'chirilgan bo'lishi mumkin)" });
      }
      const old = config.bells[idx];
      // Hafta soni o'zgarsa, hisob bugundan qaytadan boshlanadi; o'zgarmasa - eski boshlanish sanasi qoladi
      const start_date = old.weeks === parsed.bell.weeks && old.start_date ? old.start_date : todayLocal();
      config.bells[idx] = { id: old.id, ...parsed.bell, start_date };
      config.bells.sort((a, b) => a.time.localeCompare(b.time));
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    if (pathname === "/api/bell/remove" && req.method === "POST") {
      const body = await readBody(req);
      const config = readSchedule();
      const before = (config.bells || []).length;
      config.bells = (config.bells || []).filter((b) => b.id !== body.id);
      if (config.bells.length === before) {
        return sendJson(res, 400, { error: "Bunday qo'ng'iroq topilmadi" });
      }
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    // ---------- Kalendar: dam olish kunlari / ta'tillar ----------
    // Shu kunlari jadvaldagi (haftalik) qo'ng'iroqlar chalinmaydi.
    if (pathname === "/api/holiday/add" && req.method === "POST") {
      const body = await readBody(req);
      const start = String(body.start || "");
      const end = String(body.end || body.start || "");
      if (!isValidDate(start) || !isValidDate(end)) return sendJson(res, 400, { error: "Sanalar YYYY-MM-DD formatida bo'lishi kerak" });
      if (end < start) return sendJson(res, 400, { error: "Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas" });
      if (end < todayLocal()) return sendJson(res, 400, { error: "O'tib ketgan sanalarni belgilash shart emas" });
      const days = (new Date(end) - new Date(start)) / 86400000;
      if (days > 366) return sendJson(res, 400, { error: "Ko'pi bilan 1 yillik oraliq belgilash mumkin" });
      const config = readSchedule();
      config.holidays = pruneOld(config.holidays || [], (h) => h.end || h.start);
      config.holidays.push({
        id: crypto.randomBytes(4).toString("hex"),
        start, end,
        label: String(body.label || "").trim().slice(0, 200) || "Dam olish kuni",
      });
      config.holidays.sort((a, b) => a.start.localeCompare(b.start));
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    if (pathname === "/api/holiday/remove" && req.method === "POST") {
      const body = await readBody(req);
      const config = readSchedule();
      const before = (config.holidays || []).length;
      config.holidays = (config.holidays || []).filter((h) => h.id !== body.id);
      if (config.holidays.length === before) return sendJson(res, 400, { error: "Bunday dam olish kuni topilmadi" });
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    // ---------- Kalendar: O'zbekiston davlat bayramlari ----------
    if (pathname === "/api/public-holidays" && req.method === "GET") {
      let data = { fixed: [], dated: [] };
      try { data = JSON.parse(fs.readFileSync(PUBLIC_HOLIDAYS_PATH, "utf-8")); } catch { /* fayl yo'q - bo'sh ro'yxat */ }
      return sendJson(res, 200, { fixed: data.fixed || [], dated: data.dated || [] });
    }

    // Davlat bayramlarida jadvaldagi qo'ng'iroqlar chalinsinmi (standart: chalinmaydi)
    if (pathname === "/api/settings/public-holidays" && req.method === "POST") {
      const body = await readBody(req);
      const config = readSchedule();
      config.public_holidays = body.enabled !== false;
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    // ---------- Kalendar: bir martalik qo'ng'iroqlar (aniq sanaga) ----------
    if (pathname === "/api/event/add" && req.method === "POST") {
      const parsed = parseBellBody(await readBody(req), true);
      if (parsed.error) return sendJson(res, 400, { error: parsed.error });
      const config = readSchedule();
      config.events = pruneOld(config.events || [], (e) => e.date);
      config.events.push({ id: crypto.randomBytes(4).toString("hex"), ...parsed.bell });
      config.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    if (pathname === "/api/event/remove" && req.method === "POST") {
      const body = await readBody(req);
      const config = readSchedule();
      const before = (config.events || []).length;
      config.events = (config.events || []).filter((e) => e.id !== body.id);
      if (config.events.length === before) return sendJson(res, 400, { error: "Bunday bir martalik qo'ng'iroq topilmadi" });
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    if (pathname === "/api/announce/status" && req.method === "GET") {
      return sendJson(res, 200, announceStatus());
    }

    if (pathname === "/api/announce/start" && req.method === "POST") {
      return sendJson(res, 200, startAnnounce());
    }

    if (pathname === "/api/announce/stop" && req.method === "POST") {
      return sendJson(res, 200, stopAnnounce());
    }

    // ---------- AI e'lon ----------
    if (pathname === "/api/ai/status" && req.method === "GET") {
      return sendJson(res, 200, { ...ai.aiStatus(), ...(await liveStatus()), maxText: ai.MAX_TEXT });
    }

    if (pathname === "/api/ai/enhance" && req.method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, await ai.enhance({ text: body.text }));
    }

    if (pathname === "/api/ai/tts" && req.method === "POST") {
      const body = await readBody(req);
      const wav = await ai.synthesize({ text: body.text, voice: body.voice, tone: body.tone, rate: body.rate });
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length });
      return res.end(wav);
    }

    // Diktor namunasi: bir marta yasaladi va diskda saqlanadi (keyingi safar darrov, limit sarflanmaydi)
    if (pathname === "/api/ai/sample" && req.method === "GET") {
      const { key, tone } = ai.sampleKey(url.searchParams.get("voice"), url.searchParams.get("tone"));
      const file = path.join(SAMPLE_CACHE_DIR, key + ".wav");
      let wav;
      try { wav = fs.readFileSync(file); } catch {
        wav = await ai.synthesizeSample(url.searchParams.get("voice"), tone);
        fs.mkdirSync(SAMPLE_CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, wav);
      }
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length });
      return res.end(wav);
    }

    if (pathname === "/api/ai/play" && req.method === "POST") {
      const volume = Number(url.searchParams.get("volume") || "100");
      if (!Number.isInteger(volume) || volume < 1 || volume > 100) {
        return sendJson(res, 400, { error: "Ovoz balandligi 1 dan 100 gacha bo'lishi kerak" });
      }
      const wav = await readRawBody(req, MAX_LIVE_BYTES);
      if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
        return sendJson(res, 400, { error: "WAV fayl kutilgan edi" });
      }
      return sendJson(res, 200, await playLive(wav, volume));
    }

    if (pathname === "/api/ai/stop" && req.method === "POST") {
      return sendJson(res, 200, await stopLive());
    }

    // AI kalitlarini saqlash (faqat bo'sh bo'lmagan maydonlar o'zgaradi). Kalitlar javobda qaytarilmaydi.
    if (pathname === "/api/ai/keys" && req.method === "POST") {
      const body = await readBody(req);
      const fields = { geminiKey: "GEMINI_API_KEY", azureKey: "AZURE_SPEECH_KEY", azureRegion: "AZURE_SPEECH_REGION" };
      const updates = {};
      for (const [field, envKey] of Object.entries(fields)) {
        let v = String(body[field] || "").trim();
        if (!v) continue;
        if (field === "azureRegion") v = v.toLowerCase().replace(/\s+/g, "");
        if (v.length > 300 || /[\s"'#\\]/.test(v)) {
          return sendJson(res, 400, { error: "Kalitda bo'sh joy yoki ruxsat etilmagan belgi bor - nusxani tekshiring" });
        }
        updates[envKey] = v;
      }
      if (!Object.keys(updates).length) return sendJson(res, 400, { error: "Hech qanday kalit kiritilmadi" });
      saveEnvValues(updates);
      return sendJson(res, 200, { ...ai.aiStatus(), ...(await liveStatus()), maxText: ai.MAX_TEXT });
    }

    if (pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "Noma'lum API yo'li" });
    }

    // ---------- Audio preview ----------
    if (pathname.startsWith("/audios/") && req.method === "GET") {
      return serveAudio(req, res, pathname);
    }

    // ---------- Static frontend ----------
    if (req.method === "GET") {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(405); res.end("Ruxsat etilmagan metod");
  } catch (err) {
    console.error(err);
    sendJson(res, err.status || 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`\nOIS School Bell - boshqaruv paneli ishga tushdi:`);
  console.log(`  -> http://localhost:${PORT}\n`);
  console.log(`Jadval fayli: ${SCHEDULE_PATH}`);
  console.log(`  ${fs.existsSync(SCHEDULE_PATH) ? "(topildi)" : "(TOPILMADI! bell_system papkasi to'g'ri joydami tekshiring)"}`);
  console.log(`Supabase: ${SUPABASE_URL && SUPABASE_SERVICE_KEY ? SUPABASE_URL : "sozlanmagan (bell_web/.env)"}`);
  console.log(`Jurnal fayli: ${LOG_PATH}`);
  console.log(`  ${fs.existsSync(LOG_PATH) ? "(topildi)" : "(hali yaratilmagan - bell_scheduler.py ishga tushganda paydo bo'ladi)"}\n`);
});

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  syncLibrary();
  setInterval(syncLibrary, LIB_SYNC_EVERY_MS);
}

process.on("SIGINT", () => { stopAnnounce(); if (liveProc) liveProc.kill(); process.exit(0); });
process.on("SIGTERM", () => { stopAnnounce(); if (liveProc) liveProc.kill(); process.exit(0); });
