// cloud_sync.js - maktab kompyuteri <-> Supabase (onlayn panel uchun).
// Maktab kompyuteri internetga hech narsa ochmaydi: o'zi Supabase'ga murojaat qiladi (faqat chiquvchi so'rovlar).
//   1) Jadval: config/schedule.json <-> app_state['schedule'] (ikki tomonlama, version bilan).
//   2) Holat: har 15 soniyada app_state['status'] (onlayn panel "maktab kompyuteri onlayn" deb ko'radi,
//      jurnal, ovozlar ro'yxati, AI holati).
//   3) Buyruqlar: onlayn paneldan kelgan ruxsat etilgan buyruqlar (commands jadvali) shu yerda bajariladi.
// Internet uzilsa - hech narsa buzilmaydi: qo'ng'iroqlar lokal jadval bo'yicha chalinaveradi,
// aloqa tiklanganda sinxronlash o'zi davom etadi.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const SCHEDULE_EVERY_MS = 5 * 1000;
const STATUS_EVERY_MS = 15 * 1000;
const COMMANDS_EVERY_MS = 2 * 1000;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;
// eskirgan "chal" / "efir" buyrug'i bajarilmaydi
const COMMAND_MAX_AGE_MS = { ai_play: 60 * 1000, ai_stop: 60 * 1000, live_start: 30 * 1000, live_stop: 60 * 1000 };
const COMMAND_DEFAULT_MAX_AGE_MS = 3 * 60 * 1000;
const TRANSFER_BUCKET = "transfer";
const MAX_PLAY_BYTES = 25 * 1024 * 1024;

// jsonb kalitlar tartibini o'zgartiradi - shuning uchun solishtirish uchun kalitlari tartiblangan JSON ishlatamiz
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}
const hashOf = (obj) => crypto.createHash("sha256").update(stableStringify(obj)).digest("hex");

function createCloudSync(ctx) {
  // ctx: { env(), schedulePath, stateDir, publicHolidaysPath, sampleCacheDir, ai, syncLibrary, readLibraryIndex,
  //        libSync, listAudioFiles, readLog, liveStatus, playLive, stopLive, announceStatus, engineStatus }
  const statePath = path.join(ctx.stateDir, "cloud_sync.json");
  const st = { lastOk: null, lastError: null };
  let synced = { version: 0, hash: null };
  try { synced = JSON.parse(fs.readFileSync(statePath, "utf-8")); } catch { /* birinchi ishga tushish */ }
  let started = false;
  let scheduleBusy = false;
  let commandsBusy = false;
  let holidaysMtime = 0;

  const conf = () => ctx.env();
  const enabled = () => { const c = conf(); return !!(c.url && c.serviceKey); };

  async function rest(method, p, body, extraHeaders) {
    const c = conf();
    const r = await fetch(`${c.url}/rest/v1/${p}`, {
      method,
      headers: {
        apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}`,
        "Content-Type": "application/json", Prefer: "return=representation",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Supabase ${p.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function storage(method, p, body, headers) {
    const c = conf();
    const r = await fetch(`${c.url}/storage/v1/${p}`, {
      method,
      headers: { apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}`, ...headers },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`Storage ${p}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r;
  }
  const objPath = (p) => p.split("/").map(encodeURIComponent).join("/");
  const uploadWav = (p, buf) => storage("POST", `object/${TRANSFER_BUCKET}/${objPath(p)}`, buf,
    { "Content-Type": "audio/wav", "x-upsert": "true" });

  function saveSynced() {
    try {
      fs.mkdirSync(ctx.stateDir, { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(synced));
    } catch (e) { console.error("cloud_sync: holatni saqlab bo'lmadi:", e.message); }
  }

  function readLocalSchedule() {
    return JSON.parse(fs.readFileSync(ctx.schedulePath, "utf-8"));
  }

  function writeLocalSchedule(value) {
    const tmp = ctx.schedulePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, ctx.schedulePath);
  }

  // ---------- 1) Jadval ----------
  async function syncSchedule() {
    if (!enabled() || scheduleBusy) return;
    scheduleBusy = true;
    try {
      const local = readLocalSchedule();
      const localHash = hashOf(local);
      const rows = await rest("GET", "app_state?key=eq.schedule&select=version");
      const remote = rows[0];

      if (!remote) {
        // Supabase'da hali jadval yo'q - shu kompyuterdagisini yuboramiz
        await rest("POST", "app_state", { key: "schedule", value: local, version: 1, updated_by: "school-pc" });
        synced = { version: 1, hash: localHash };
        saveSynced();
      } else if (Number(remote.version) !== synced.version) {
        // Onlayn panelda o'zgargan - lokal faylga yozamiz (bell_scheduler.py uni o'zi qayta o'qiydi)
        const full = (await rest("GET", "app_state?key=eq.schedule&select=version,value"))[0];
        if (localHash !== synced.hash && synced.hash !== null) {
          console.warn("cloud_sync: jadval ikkala joyda ham o'zgargan - onlayn nusxa olindi");
        }
        writeLocalSchedule(full.value);
        synced = { version: Number(full.version), hash: hashOf(full.value) };
        saveSynced();
      } else if (localHash !== synced.hash) {
        // Shu kompyuterdagi panelda o'zgargan - Supabase'ga yuboramiz (faqat u yerda boshqa o'zgarish bo'lmasa)
        const next = synced.version + 1;
        const upd = await rest("PATCH", `app_state?key=eq.schedule&version=eq.${synced.version}`,
          { value: local, version: next, updated_at: new Date().toISOString(), updated_by: "school-pc" });
        if (upd && upd.length) {
          synced = { version: next, hash: localHash };
          saveSynced();
        } // aks holda keyingi aylanishda onlayn o'zgarish olinadi
      }
      st.lastOk = new Date().toISOString();
      st.lastError = null;
    } catch (e) {
      st.lastError = String(e.message || e);
    } finally {
      scheduleBusy = false;
    }
  }

  // ---------- 2) Holat ----------
  async function publishStatus() {
    if (!enabled()) return;
    try {
      let tz = null;
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* yo'q */ }
      const engine = await ctx.engineStatus();
      const value = {
        seen_at: new Date().toISOString(),
        host: os.hostname(),
        tz,
        scheduler_running: !!engine,
        now_playing: engine ? engine.current : null,
        audios: ctx.listAudioFiles(),
        library: ctx.readLibraryIndex(),
        lib_sync: ctx.libSync,
        ai: { ...ctx.ai.aiStatus(), ...(await ctx.liveStatus()), maxText: ctx.ai.MAX_TEXT },
        live: ctx.live.status(),
        log: ctx.readLog(60),
      };
      const rows = [{ key: "status", value, updated_at: value.seen_at, updated_by: "school-pc" }];
      // Davlat bayramlari ro'yxati - faqat fayl o'zgarganda
      try {
        const m = fs.statSync(ctx.publicHolidaysPath).mtimeMs;
        if (m !== holidaysMtime) {
          const data = JSON.parse(fs.readFileSync(ctx.publicHolidaysPath, "utf-8"));
          rows.push({ key: "public_holidays", value: { fixed: data.fixed || [], dated: data.dated || [] }, updated_at: value.seen_at, updated_by: "school-pc" });
          holidaysMtime = m;
        }
      } catch { /* fayl yo'q */ }
      await rest("POST", "app_state?on_conflict=key", rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
    } catch (e) {
      st.lastError = String(e.message || e);
    }
  }

  // ---------- 3) Buyruqlar ----------
  const handlers = {
    async library_sync() {
      await ctx.syncLibrary();
      return { sounds: ctx.readLibraryIndex(), sync: ctx.libSync };
    },
    async ai_enhance(p) {
      return await ctx.ai.enhance({ text: p.text });
    },
    async ai_tts(p, cmd) {
      const wav = await ctx.ai.synthesize({ text: p.text, voice: p.voice, tone: p.tone, rate: p.rate });
      const dest = `tts/${cmd.id}.wav`;
      await uploadWav(dest, wav);
      return { path: dest };
    },
    async ai_sample(p) {
      const { key, tone } = ctx.ai.sampleKey(p.voice, p.tone);
      const file = path.join(ctx.sampleCacheDir, key + ".wav");
      let wav;
      try { wav = fs.readFileSync(file); } catch {
        wav = await ctx.ai.synthesizeSample(p.voice, tone);
        fs.mkdirSync(ctx.sampleCacheDir, { recursive: true });
        fs.writeFileSync(file, wav);
      }
      const dest = `samples/${key}.wav`;
      await uploadWav(dest, wav);
      return { path: dest };
    },
    async ai_play(p) {
      const volume = Number(p.volume || 100);
      if (!Number.isInteger(volume) || volume < 1 || volume > 100) throw new Error("Ovoz balandligi 1 dan 100 gacha bo'lishi kerak");
      if (!/^play\/[0-9a-f-]{36}\.wav$/i.test(String(p.path || ""))) throw new Error("Noto'g'ri fayl yo'li");
      const r = await storage("GET", `object/${TRANSFER_BUCKET}/${objPath(p.path)}`);
      const wav = Buffer.from(await r.arrayBuffer());
      if (wav.length > MAX_PLAY_BYTES || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error("WAV fayl kutilgan edi");
      }
      storage("DELETE", `object/${TRANSFER_BUCKET}`, JSON.stringify({ prefixes: [p.path] }), { "Content-Type": "application/json" }).catch(() => {});
      return await ctx.playLive(wav, volume);
    },
    async ai_stop() {
      return await ctx.stopLive();
    },
    // Onlayn jonli efir: kanal nomi va kalit qaytariladi, ovoz Realtime orqali keladi (live_relay.js)
    async live_start(p) {
      return ctx.live.start(Number(p.volume));
    },
    async live_stop() {
      return ctx.live.stop("paneldan to'xtatildi");
    },
  };

  async function finishCommand(id, status, result) {
    await rest("PATCH", `commands?id=eq.${id}`, { status, result, finished_at: new Date().toISOString() },
      { Prefer: "return=minimal" });
  }

  async function processCommands() {
    if (!enabled() || commandsBusy) return;
    commandsBusy = true;
    try {
      const pending = await rest("GET", "commands?status=eq.pending&order=created_at.asc&limit=5&select=id,op,payload,created_at");
      for (const cmd of pending || []) {
        // Navbatni boshqa nusxa olib qo'ymagan bo'lsa - o'zimizga olamiz
        const claimed = await rest("PATCH", `commands?id=eq.${cmd.id}&status=eq.pending`, { status: "running" });
        if (!claimed || !claimed.length) continue;
        const age = Date.now() - new Date(cmd.created_at).getTime();
        if (age > (COMMAND_MAX_AGE_MS[cmd.op] || COMMAND_DEFAULT_MAX_AGE_MS)) {
          await finishCommand(cmd.id, "expired", { error: "Buyruq eskirdi (maktab kompyuteri o'sha paytda oflayn edi)" });
          continue;
        }
        const handler = handlers[cmd.op];
        try {
          if (!handler) throw new Error("Noma'lum buyruq: " + cmd.op);
          const result = await handler(cmd.payload || {}, cmd);
          await finishCommand(cmd.id, "done", result === undefined ? {} : result);
        } catch (e) {
          await finishCommand(cmd.id, "error", { error: String(e.message || e) }).catch(() => {});
        }
        if (["ai_play", "ai_stop", "library_sync", "live_start", "live_stop"].includes(cmd.op)) publishStatus();
      }
    } catch (e) {
      st.lastError = String(e.message || e);
    } finally {
      commandsBusy = false;
    }
  }

  // Bir kundan eski buyruqlar va vaqtinchalik audio fayllarni tozalash (diktor namunalari qoladi)
  async function cleanup() {
    if (!enabled()) return;
    try {
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      await rest("DELETE", `commands?created_at=lt.${cutoff}`, undefined, { Prefer: "return=minimal" });
      for (const prefix of ["tts", "play"]) {
        const r = await storage("POST", `object/list/${TRANSFER_BUCKET}`,
          JSON.stringify({ prefix, limit: 1000, sortBy: { column: "created_at", order: "asc" } }),
          { "Content-Type": "application/json" });
        const old = (await r.json()).filter((o) => o.created_at && o.created_at < cutoff).map((o) => `${prefix}/${o.name}`);
        if (old.length) {
          await storage("DELETE", `object/${TRANSFER_BUCKET}`, JSON.stringify({ prefixes: old }), { "Content-Type": "application/json" });
        }
      }
    } catch (e) {
      console.error("cloud_sync tozalash:", e.message || e);
    }
  }

  function start() {
    if (started || !enabled()) return;
    started = true;
    syncSchedule().then(publishStatus);
    setInterval(syncSchedule, SCHEDULE_EVERY_MS);
    setInterval(publishStatus, STATUS_EVERY_MS);
    setInterval(processCommands, COMMANDS_EVERY_MS);
    setTimeout(cleanup, 30 * 1000);
    setInterval(cleanup, CLEANUP_EVERY_MS);
  }

  // Lokal panelda jadval o'zgarganda darhol yuborish uchun
  function kick() { setTimeout(syncSchedule, 50); }

  return { start, kick, status: () => ({ ...st, version: synced.version }) };
}

module.exports = { createCloudSync, stableStringify };
