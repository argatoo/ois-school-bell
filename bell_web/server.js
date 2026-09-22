// server.js
// Oxford International School qo'ng'iroq tizimi - local web boshqaruv paneli.
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

const PORT = 3000;

// bell_web/ va bell_system/ bir xil ota-papkada (masalan "School Bell/") turadi deb
// faraz qilinadi. Agar boshqacha joylashgan bo'lsa, shu yo'lni o'zgartiring.
const BELL_SYSTEM_DIR = path.join(__dirname, "..", "bell_system");
const SCHEDULE_PATH = path.join(BELL_SYSTEM_DIR, "config", "schedule.json");
const LOG_PATH = path.join(BELL_SYSTEM_DIR, "logs", "bell_log.csv");
const LIVE_ANNOUNCE_SCRIPT = path.join(BELL_SYSTEM_DIR, "live_announce.py");
const AUDIO_DIR = path.join(BELL_SYSTEM_DIR, "audios");
const PUBLIC_DIR = path.join(__dirname, "public");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function listAudioFiles() {
  try {
    return fs.readdirSync(AUDIO_DIR).filter((f) => /\.(mp3|wav)$/i.test(f)).sort();
  } catch {
    return [];
  }
}

// ---------- Jonli e'lon (mikrofon -> speaker) jarayonini boshqarish ----------
let announceProc = null;
let announceError = null;

function announceStatus() {
  return { running: !!announceProc, error: announceError };
}

function startAnnounce() {
  if (announceProc) return announceStatus();
  announceError = null;
  announceProc = spawn("python", [LIVE_ANNOUNCE_SCRIPT], { cwd: BELL_SYSTEM_DIR });
  announceProc.stderr.on("data", (d) => {
    console.error("live_announce:", d.toString());
  });
  announceProc.on("exit", (code) => {
    if (code && code !== 0) announceError = `live_announce.py kod ${code} bilan to'xtadi`;
    announceProc = null;
  });
  announceProc.on("error", (err) => {
    announceError = String(err.message || err);
    announceProc = null;
  });
  return announceStatus();
}

function stopAnnounce() {
  if (announceProc) {
    announceProc.kill();
    announceProc = null;
  }
  return announceStatus();
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
    // ---------- API ----------
    if (pathname === "/api/schedule" && req.method === "GET") {
      const config = readSchedule();
      return sendJson(res, 200, config);
    }

    if (pathname === "/api/log" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || "50");
      return sendJson(res, 200, { rows: readLog(limit) });
    }

    if (pathname === "/api/day-type" && req.method === "POST") {
      const body = await readBody(req);
      const { date, dayType } = body;
      if (!date) return sendJson(res, 400, { error: "'date' maydoni kerak (YYYY-MM-DD)" });
      const config = readSchedule();
      config.date_overrides = config.date_overrides || {};
      if (dayType) {
        if (!config.day_types[dayType]) {
          return sendJson(res, 400, { error: `Noma'lum kun turi: ${dayType}` });
        }
        config.date_overrides[date] = dayType;
      } else {
        delete config.date_overrides[date];
      }
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    if (pathname === "/api/audios" && req.method === "GET") {
      return sendJson(res, 200, { files: listAudioFiles() });
    }

    if (pathname === "/api/signal/add" && req.method === "POST") {
      const body = await readBody(req);
      const { dayType, time, label, sound } = body;
      const config = readSchedule();
      if (!config.day_types[dayType]) {
        return sendJson(res, 400, { error: `Noma'lum kun turi: ${dayType}` });
      }
      if (!TIME_RE.test(time || "")) {
        return sendJson(res, 400, { error: "Vaqt HH:MM formatida bo'lishi kerak (masalan 08:25)" });
      }
      if (!label || !label.trim()) {
        return sendJson(res, 400, { error: "'label' (nom) maydoni kerak" });
      }
      if (!sound || !sound.trim()) {
        return sendJson(res, 400, { error: "'sound' (ovoz fayli) maydoni kerak" });
      }
      config.day_types[dayType].push({ time, label: label.trim(), sound: sound.trim() });
      config.day_types[dayType].sort((a, b) => a.time.localeCompare(b.time));
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    if (pathname === "/api/signal/remove" && req.method === "POST") {
      const body = await readBody(req);
      const { dayType, index } = body;
      const config = readSchedule();
      const list = config.day_types[dayType];
      if (!list) return sendJson(res, 400, { error: `Noma'lum kun turi: ${dayType}` });
      if (!Number.isInteger(index) || index < 0 || index >= list.length) {
        return sendJson(res, 400, { error: "Noto'g'ri signal indeksi" });
      }
      list.splice(index, 1);
      writeSchedule(config);
      return sendJson(res, 200, { ok: true, config });
    }

    if (pathname === "/api/week" && req.method === "POST") {
      const body = await readBody(req);
      const { weekday, dayType } = body;
      const valid = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
      if (!valid.includes(weekday)) return sendJson(res, 400, { error: "Noto'g'ri hafta kuni" });
      const config = readSchedule();
      config.week_schedule = config.week_schedule || {};
      if (dayType && !config.day_types[dayType]) {
        return sendJson(res, 400, { error: `Noma'lum kun turi: ${dayType}` });
      }
      config.week_schedule[weekday] = dayType || null;
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
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`\nQo'ng'iroq boshqaruv paneli ishga tushdi:`);
  console.log(`  -> http://localhost:${PORT}\n`);
  console.log(`Jadval fayli: ${SCHEDULE_PATH}`);
  console.log(`  ${fs.existsSync(SCHEDULE_PATH) ? "(topildi)" : "(TOPILMADI! bell_system papkasi to'g'ri joydami tekshiring)"}`);
  console.log(`Jurnal fayli: ${LOG_PATH}`);
  console.log(`  ${fs.existsSync(LOG_PATH) ? "(topildi)" : "(hali yaratilmagan - bell_scheduler.py ishga tushganda paydo bo'ladi)"}\n`);
});

process.on("SIGINT", () => { stopAnnounce(); process.exit(0); });
process.on("SIGTERM", () => { stopAnnounce(); process.exit(0); });
