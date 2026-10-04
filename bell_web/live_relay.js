// live_relay.js - onlayn paneldan "jonli efir": brauzer mikrofon ovozini Supabase Realtime kanaliga
// bo'laklab yuboradi, maktab kompyuteri shu kanalga o'zi ulanib (chiquvchi ulanish - kompyuter internetga
// ochilmaydi) ovozni bell_system/live_stream.py orqali speakerlarga chiqaradi.
//
// Xavfsizlik: efirni faqat admin boshlay oladi (commands jadvali, RLS). Har efir uchun tasodifiy kanal nomi
// va kalit yaratiladi va faqat o'sha buyruq natijasida (admin ko'radi) qaytariladi; kalitsiz bo'lak chalinmaydi.
const crypto = require("crypto");

const IDLE_STOP_MS = 8000;              // shuncha vaqt ovoz kelmasa - efir tugagan deb hisoblanadi
const MAX_SESSION_MS = 15 * 60 * 1000;  // bitta efir ko'pi bilan 15 daqiqa
const HEARTBEAT_MS = 25000;
const MAX_CHUNK_BYTES = 64 * 1024;

function createLiveRelay(ctx) {
  // ctx: { env() -> {url, anonKey}, spawnPlayer(volume) -> ChildProcess, setMic(on), log(msg) }
  let session = null;

  function status() {
    return session ? { live: true, since: session.startedAt } : { live: false };
  }

  function stop(reason) {
    const s = session;
    if (!s) return status();
    session = null;
    clearTimeout(s.idleTimer);
    clearTimeout(s.maxTimer);
    clearInterval(s.heartbeat);
    try { s.ws.close(); } catch { /* allaqachon yopiq */ }
    try { s.player.stdin.end(); } catch { /* jarayon tugagan */ }
    setTimeout(() => { try { s.player.kill(); } catch { /* tugagan */ } }, 3000);
    ctx.setMic(false);
    ctx.log(`Onlayn jonli efir tugadi (${reason})`);
    return status();
  }

  function touch(s) {
    clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(() => { if (session === s) stop("ovoz kelmay qoldi"); }, IDLE_STOP_MS);
  }

  function start(volume) {
    const c = ctx.env();
    if (!c.url || !c.anonKey) throw new Error("Supabase sozlanmagan");
    if (typeof WebSocket !== "function") throw new Error("Bu kompyuterdagi Node.js eskirgan (WebSocket yo'q)");
    if (session) stop("yangi efir boshlandi");

    const vol = Number.isInteger(volume) && volume >= 1 && volume <= 100 ? volume : 100;
    const id = crypto.randomUUID();
    const key = crypto.randomBytes(16).toString("hex");
    const topic = `live-${id}`;
    const player = ctx.spawnPlayer(vol);
    const wsUrl = `${c.url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(c.anonKey)}&vsn=1.0.0`;
    const ws = new WebSocket(wsUrl);
    const s = { id, key, topic, player, ws, startedAt: new Date().toISOString(), seq: -1, ref: 1 };
    session = s;

    player.on("exit", () => { if (session === s) stop("chalish jarayoni tugadi"); });
    player.on("error", () => { if (session === s) stop("chalish jarayoni ishga tushmadi"); });
    player.stdin.on("error", () => { /* jarayon yopilgan - stop() hal qiladi */ });

    const send = (msg) => { try { ws.send(JSON.stringify({ ...msg, ref: String(s.ref++) })); } catch { /* yopiq */ } };
    ws.addEventListener("open", () => {
      send({
        topic: `realtime:${topic}`, event: "phx_join", join_ref: "1",
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, postgres_changes: [], private: false } },
      });
      s.heartbeat = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {} }), HEARTBEAT_MS);
    });
    ws.addEventListener("message", (ev) => {
      if (session !== s) return;
      let msg;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf-8")); } catch { return; }
      if (msg.event !== "broadcast" || !msg.payload) return;
      const inner = msg.payload;
      const p = inner.payload || {};
      if (p.k !== key) return;  // boshqa (yoki begona) xabar
      if (inner.event === "end") { stop("efir tugatildi"); return; }
      if (inner.event !== "audio" || typeof p.d !== "string") return;
      const seq = Number(p.s);
      if (Number.isFinite(seq) && seq <= s.seq) return;  // takroriy yoki eski bo'lak
      if (Number.isFinite(seq)) s.seq = seq;
      const pcm = Buffer.from(p.d, "base64");
      if (!pcm.length || pcm.length > MAX_CHUNK_BYTES) return;
      touch(s);
      try { player.stdin.write(pcm); } catch { /* jarayon yopilgan */ }
    });
    ws.addEventListener("close", () => { if (session === s) stop("aloqa uzildi"); });
    ws.addEventListener("error", () => { /* close hodisasi keladi */ });

    // Birinchi bo'lak kelguncha (brauzer kanalga ulanayotgan payt) - ikki barobar ko'proq kutamiz
    s.idleTimer = setTimeout(() => { if (session === s) stop("ovoz kelmadi"); }, IDLE_STOP_MS * 2);
    s.maxTimer = setTimeout(() => { if (session === s) stop("15 daqiqalik chegara"); }, MAX_SESSION_MS);
    ctx.setMic(true); // musiqa pasayadi, qo'ng'iroqlar efir tugashini kutadi
    ctx.log("Onlayn jonli efir boshlandi");
    return { topic, key, volume: vol };
  }

  return { start, stop, status };
}

module.exports = { createLiveRelay };
