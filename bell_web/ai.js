// ai.js
// AI e'lon: matndan ovoz yasash va Gemini bilan xomaki matnni muloyim e'lon matniga aylantirish.
// Ovoz uchun ikki xizmatdan biri ishlatiladi:
//   - Azure AI Speech (agar kalit bo'lsa) - o'zbekcha neyron ovozlar Madina/Sardor, eng sifatli;
//   - aks holda Gemini TTS - faqat bitta Gemini kaliti bilan ishlaydi.
// Tashqi paket kerak emas - Node'ning o'zidagi fetch ishlatiladi.
// Kalitlar faqat serverda (bell_web/.env) turadi va brauzerga hech qachon berilmaydi.

// Diktorlar (operatorlar): har biri o'z Gemini ovozi va xarakteri bilan.
// Azure ishlatilsa, jinsiga qarab o'zbekcha Madina yoki Sardor neyron ovozi olinadi.
const OPERATORS = [
  { id: "madina", name: "Madina", gender: "female", voice: "Sulafat", persona: "a warm, kind and very polite female school announcer",
    desc: { uz: "Iliq va muloyim", ru: "Тёплый и вежливый", en: "Warm and polite" } },
  { id: "laylo", name: "Laylo", gender: "female", voice: "Vindemiatrix", persona: "a gentle, tender and caring female announcer",
    desc: { uz: "Nozik va mehribon", ru: "Нежный и заботливый", en: "Gentle and caring" } },
  { id: "dilnoza", name: "Dilnoza", gender: "female", voice: "Kore", persona: "a confident, clear and official female announcer",
    desc: { uz: "Rasmiy va aniq", ru: "Официальный и чёткий", en: "Official and clear" } },
  { id: "nilufar", name: "Nilufar", gender: "female", voice: "Laomedeia", persona: "a cheerful, bright and friendly young female announcer",
    desc: { uz: "Quvnoq va yorqin", ru: "Весёлый и яркий", en: "Cheerful and bright" } },
  { id: "malika", name: "Malika", gender: "female", voice: "Achernar", persona: "a soft, calm and soothing female announcer",
    desc: { uz: "Yumshoq va osoyishta", ru: "Мягкий и спокойный", en: "Soft and calm" } },
  { id: "sardor", name: "Sardor", gender: "male", voice: "Charon", persona: "a dignified, clear and informative male announcer",
    desc: { uz: "Salobatli rasmiy diktor", ru: "Солидный диктор", en: "Dignified announcer" } },
  { id: "jasur", name: "Jasur", gender: "male", voice: "Achird", persona: "a friendly, sincere and approachable male announcer",
    desc: { uz: "Do'stona va samimiy", ru: "Дружелюбный и искренний", en: "Friendly and sincere" } },
  { id: "bobur", name: "Bobur", gender: "male", voice: "Sadaltager", persona: "an experienced, wise and trustworthy male announcer",
    desc: { uz: "Tajribali va ishonchli", ru: "Опытный и надёжный", en: "Experienced and trustworthy" } },
  { id: "akmal", name: "Akmal", gender: "male", voice: "Algieba", persona: "a smooth, pleasant and velvety-voiced male announcer",
    desc: { uz: "Mayin va yoqimli", ru: "Мягкий и приятный", en: "Smooth and pleasant" } },
  { id: "shohruh", name: "Shohruh", gender: "male", voice: "Alnilam", persona: "a firm and focused male announcer for important notices",
    desc: { uz: "Qat'iy - muhim e'lonlar uchun", ru: "Твёрдый - для важных объявлений", en: "Firm - for important notices" } },
];
const AZURE_VOICE = { female: "uz-UZ-MadinaNeural", male: "uz-UZ-SardorNeural" };

// Ohanglar: diktorga beriladigan "rejissyor ko'rsatmasi"
const TONES = {
  polite: "warm, very polite and respectful, with a gentle smile in the voice",
  official: "calm, composed and respectful official tone, clear and confident",
  festive: "joyful, celebratory and uplifting, energetic yet still polite and dignified",
  important: "serious and attentive, firm but calm and reassuring - asks for full attention without causing alarm",
  soft: "soft, soothing and gentle, quiet and unhurried",
};
const SAMPLE_TEXT = "Assalomu alaykum, hurmatli o'quvchilar va ustozlar! Bugungi darslar soat sakkiz yarimda boshlanadi. Barchangizga omad tilaymiz!";

const MAX_TEXT = 1500;
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
// Asosiy model band yoki topilmasa, matnni yaxshilash uchun navbatdagi modellar
const ENHANCE_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-flash-lite-latest"];
// Gemini TTS modellari: birinchisi topilmasa, band bo'lsa yoki uning limiti tugasa - keyingisi
const GEMINI_TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function azureConfig() {
  const key = (process.env.AZURE_SPEECH_KEY || "").trim();
  // "West Europe" kabi yozilsa ham ishlaydi -> "westeurope"
  const region = (process.env.AZURE_SPEECH_REGION || "").trim().toLowerCase().replace(/\s+/g, "");
  return key && /^[a-z0-9]+$/.test(region) ? { key, region } : null;
}

function geminiConfig() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  return key ? { key, model } : null;
}

function aiStatus() {
  const azure = !!azureConfig();
  const gemini = !!geminiConfig();
  return {
    tts: azure || gemini, ttsProvider: azure ? "azure" : gemini ? "gemini" : null, enhance: gemini, azure, gemini,
    operators: OPERATORS.map(({ id, name, gender, desc }) => ({ id, name, gender, desc })),
    tones: Object.keys(TONES),
  };
}

function findOperator(id) {
  const op = OPERATORS.find((o) => o.id === id);
  if (!op) throw httpError(400, "Noma'lum diktor");
  return op;
}

// Gemini TTS uchun batafsil ko'rsatma: kim, qayerda, qanday ohangda, qanday tezlikda va pauzalar bilan o'qiydi
function directorPrompt(op, toneId, rate, text) {
  const tone = TONES[toneId] || TONES.polite;
  const pace = rate <= -10 ? "slow and very clear, with generous pauses"
    : rate >= 10 ? "slightly brisk but still clear and calm"
    : "unhurried, natural announcer pace";
  return `# AUDIO PROFILE: ${op.name}, ${op.persona} at Oxford International School in Uzbekistan
## SCENE: An announcement over the school PA system to students, teachers and parents.
### DIRECTOR'S NOTES
Style: ${tone}. Natural, expressive intonation with melodic rises and falls like a skilled radio announcer - never flat or robotic.
Pacing: ${pace}. Short natural pauses at commas and a longer pause between sentences. Gently emphasize key details such as times, places, dates and names.
Language: Uzbek (Latin script) with native Uzbek pronunciation. Read only the transcript below.
#### TRANSCRIPT
${text}`;
}

function cleanText(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) throw httpError(400, "E'lon matni bo'sh");
  if (t.length > MAX_TEXT) throw httpError(400, `Matn juda uzun (ko'pi bilan ${MAX_TEXT} belgi)`);
  return t;
}

function escapeXml(s) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}

// Gemini TTS ovoz ma'lumotining oxiriga C2PA "kelib chiqish" imzosini (JUMBF bloki, ~6 KB) qo'shadi.
// U ovoz emas - xom PCM deb chalinsa oxirida ~0.1 s baland "tzz" shovqini bo'lib eshitiladi. Shuni kesib tashlaymiz.
function stripC2pa(pcm) {
  const tailStart = Math.max(0, pcm.length - 256 * 1024); // imzo faqat oxirida bo'ladi
  // "C2PA" belgisidan keyin yaqin orada "jumb" (JUMBF qutisi) kelsa - imzo shu yerdan boshlanadi
  for (let i = pcm.indexOf("C2PA", tailStart, "latin1"); i !== -1; i = pcm.indexOf("C2PA", i + 1, "latin1")) {
    const jumb = pcm.indexOf("jumb", i, "latin1");
    if (jumb !== -1 && jumb - i <= 64) return pcm.subarray(0, i - (i % 2)); // 16-bit namuna chegarasida kesamiz
  }
  return pcm;
}

// Gemini ovozi ikki ko'rinishda keladi: xom PCM ("audio/L16;rate=24000") yoki tayyor WAV fayl ("audio/wav").
// WAV bo'lsa - faqat "data" bo'lagini olamiz: aks holda fayl sarlavhasi (44 bayt) ovoz deb chalinib, boshida
// keskin "chirt" eshitiladi; C2PA imzosi esa alohida bo'lak bo'lgani uchun o'zi tashlab ketiladi.
// Natija: { pcm, rate } (16-bit mono)
function geminiAudioToPcm(buf, mimeType) {
  const rateFromMime = /rate=(\d+)/.exec(mimeType || "");
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WAVE") {
    let rate = 24000, channels = 1, bits = 16, data = null;
    for (let p = 12; p + 8 <= buf.length;) {
      const id = buf.toString("latin1", p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      const body = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size));
      if (id === "fmt " && body.length >= 16) {
        channels = body.readUInt16LE(2); rate = body.readUInt32LE(4); bits = body.readUInt16LE(14);
      } else if (id === "data") {
        data = body;
      }
      p += 8 + size + (size % 2);
    }
    if (!data) throw httpError(502, "Gemini ovozi buzilgan keldi - qayta urinib ko'ring");
    if (bits !== 16 || channels !== 1) throw httpError(502, `Gemini kutilmagan ovoz formatini qaytardi (${bits}-bit, ${channels} kanal)`);
    return { pcm: data.subarray(0, data.length - (data.length % 2)), rate };
  }
  return { pcm: stripC2pa(buf), rate: rateFromMime ? Number(rateFromMime[1]) : 24000 };
}

// Boshi va oxirini silliqlaydi (keskin boshlanish/tugash ham "chirt" bo'lib eshitiladi) va oxiriga
// qisqa jimlik qo'shadi - har qanday pleyerda ovoz toza tugaydi.
function smoothEdges(pcm, rate) {
  const out = Buffer.from(pcm);
  const n = out.length / 2;
  const fadeIn = Math.min(n, Math.round(rate * 0.015));
  const fadeOut = Math.min(n, Math.round(rate * 0.04));
  for (let i = 0; i < fadeIn; i++) out.writeInt16LE(Math.round(out.readInt16LE(i * 2) * (i / fadeIn)), i * 2);
  for (let i = 0; i < fadeOut; i++) {
    const k = n - 1 - i;
    out.writeInt16LE(Math.round(out.readInt16LE(k * 2) * (i / fadeOut)), k * 2);
  }
  return Buffer.concat([out, Buffer.alloc(Math.round(rate * 0.25) * 2)]);
}

// 16-bit mono PCM ga WAV sarlavhasini qo'shadi
function pcmToWav(pcm, sampleRate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Matndan ovoz: WAV (16-bit, mono) Buffer qaytaradi. Azure bo'lsa Azure, bo'lmasa Gemini.
async function synthesize({ text, voice, tone, rate }) {
  const t = cleanText(text);
  const op = findOperator(voice);
  if (tone !== undefined && tone !== null && tone !== "" && !TONES[tone]) throw httpError(400, "Noma'lum ohang");
  const r = Number(rate || 0);
  if (!Number.isInteger(r) || r < -50 || r > 50) throw httpError(400, "Tezlik -50..50 oralig'ida bo'lishi kerak");
  if (azureConfig()) return synthesizeAzure(t, AZURE_VOICE[op.gender], r);
  if (geminiConfig()) return synthesizeGemini(directorPrompt(op, tone, r, t), op.voice);
  throw httpError(503, "Ovoz yaratish sozlanmagan: AI kalitlari bo'limiga Gemini kalitini qo'ying");
}

// Diktor namunasi (har bir diktor+ohang uchun bir marta yasaladi va keshlanadi - limitni tejash uchun)
function sampleKey(voice, tone) {
  findOperator(voice);
  const t = TONES[tone] ? tone : "polite";
  const provider = azureConfig() ? "azure" : "gemini";
  // "v2": eski keshdagi namunalarda boshida "chirt" bor edi (WAV sarlavhasi) - ular endi ishlatilmaydi
  return { key: `${provider}_v2_${voice}_${t}`, tone: t };
}

async function synthesizeSample(voice, tone) {
  return synthesize({ text: SAMPLE_TEXT, voice, tone, rate: 0 });
}

async function synthesizeGemini(prompt, voiceName) {
  const cfg = geminiConfig();
  const models = process.env.GEMINI_TTS_MODEL ? [process.env.GEMINI_TTS_MODEL.trim()] : GEMINI_TTS_MODELS;
  let lastStatus = 0;
  const attempts = models.flatMap((m) => [m, m]); // har bir model 2 marta (band bo'lsa qayta urinish)
  for (let ai_ = 0; ai_ < attempts.length; ai_++) {
    const model = attempts[ai_];
    if (ai_ > 0 && lastStatus === 404 && attempts[ai_ - 1] === model) continue; // topilmagan modelni qayta so'ramaymiz
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
        signal: AbortSignal.timeout(90000),
      });
    } catch (e) {
      throw httpError(502, "Gemini bilan aloqa yo'q - internetni tekshiring");
    }
    lastStatus = res.status;
    if (res.status === 404) continue; // bu model yo'q - keyingisini sinaymiz
    if (res.status === 429) { if (attempts[ai_ + 1] === model) ai_++; continue; } // shu modelning limiti tugagan - darrov keyingi model
    if (res.status === 500 || res.status === 503) { await new Promise((r) => setTimeout(r, 1500)); continue; } // band
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      throw httpError(502, /API key|API_KEY|permission/i.test(body) ? "Gemini kaliti noto'g'ri" : `Gemini ovoz so'rovi rad etildi (HTTP ${res.status})`);
    }
    if (!res.ok) throw httpError(502, `Gemini xatosi: HTTP ${res.status}`);
    const data = await res.json();
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const audio = parts.find((p) => p.inlineData && p.inlineData.data);
    if (!audio) throw httpError(502, "Gemini ovoz qaytarmadi - qayta urinib ko'ring");
    const { pcm, rate } = geminiAudioToPcm(Buffer.from(audio.inlineData.data, "base64"), audio.inlineData.mimeType);
    return pcmToWav(smoothEdges(pcm, rate), rate);
  }
  if (lastStatus === 429) throw httpError(502, "Gemini'ning bugungi bepul limiti tugadi - ertaga yoki birozdan keyin urinib ko'ring");
  if (lastStatus === 500 || lastStatus === 503) throw httpError(502, "Gemini hozir band - bir necha soniyadan keyin qayta urinib ko'ring");
  throw httpError(502, `Gemini ovoz modeli topilmadi (HTTP ${lastStatus}) - GEMINI_TTS_MODEL ni tekshiring`);
}

async function synthesizeAzure(t, voiceName, r) {
  const cfg = azureConfig();
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="uz-UZ">` +
    `<voice name="${voiceName}"><prosody rate="${r >= 0 ? "+" : ""}${r}%">${escapeXml(t)}</prosody></voice></speak>`;

  let res;
  try {
    res = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": cfg.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "OIS-School-Bell",
      },
      body: ssml,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw httpError(502, "Azure bilan aloqa yo'q - internetni yoki AZURE_SPEECH_REGION ni tekshiring");
  }
  if (res.status === 401 || res.status === 403) throw httpError(502, "Azure kaliti yoki hududi (region) noto'g'ri");
  if (res.status === 429) throw httpError(502, "Azure limiti tugadi - birozdan keyin urinib ko'ring");
  if (!res.ok) throw httpError(502, `Azure xatosi: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw httpError(502, "Azure bo'sh javob qaytardi");
  return buf;
}

// Xomaki matn -> muloyim maktab e'loni (asosiy variant + muqobillar)
async function enhance({ text }) {
  const cfg = geminiConfig();
  if (!cfg) throw httpError(503, "Matnni yaxshilash sozlanmagan: bell_web/.env da GEMINI_API_KEY kerak");
  const t = cleanText(text);

  const prompt = `Siz maktab radiosi uchun e'lon matnlarini tayyorlaydigan tajribali o'zbek tili muharriri va diktorisiz.
Quyidagi xomaki matnni Oxford International School maktabida karnay orqali o'qiladigan e'longa aylantiring:
- o'zbek adabiy tilida (lotin yozuvida), muloyim, hurmat bilan va aniq;
- ovoz chiqarib o'qishga qulay: qisqa jumlalar, raqamlar va vaqtlar so'z bilan yoki tushunarli shaklda;
- murojaat auditoriyaga mos ("Hurmatli o'quvchilar", "Aziz ustozlar", "Hurmatli ota-onalar" va h.k.);
- asl ma'no va barcha faktlar (vaqt, joy, sana, ism) aynan saqlansin, yangi fakt qo'shilmasin.

Xomaki matn:
"""${t}"""

Faqat quyidagi JSON shaklida javob bering:
{"enhancedText": "eng yaxshi to'liq variant", "suggestions": ["qisqaroq variant", "rasmiyroq variant"]}`;

  // Google modeli band bo'lsa (500/503) - biroz kutib qayta uriniladi, keyin keyingi modelga o'tiladi
  const models = [...new Set([cfg.model, ...ENHANCE_FALLBACK_MODELS])];
  let res = null;
  let lastStatus = 0;
  outer: for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "x-goog-api-key": cfg.key, "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
            }),
            signal: AbortSignal.timeout(45000),
          }
        );
      } catch (e) {
        throw httpError(502, "Gemini bilan aloqa yo'q - internetni tekshiring");
      }
      lastStatus = res.status;
      if (res.ok) break outer;
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => "");
        throw httpError(502, /API key|API_KEY|permission/i.test(body) ? "Gemini kaliti noto'g'ri" : `Gemini so'rovi rad etildi (HTTP ${res.status})`);
      }
      if (res.status === 429) throw httpError(502, "Gemini limiti tugadi - birozdan keyin urinib ko'ring");
      if (res.status === 404) continue outer;              // bunday model yo'q - keyingisi
      if (res.status !== 500 && res.status !== 503) throw httpError(502, `Gemini xatosi: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 1500));       // band - biroz kutib qayta urinamiz
    }
  }
  if (!res || !res.ok) {
    throw httpError(502, lastStatus === 404
      ? `Gemini modeli topilmadi: ${cfg.model} (GEMINI_MODEL ni tekshiring)`
      : "Gemini hozir band - bir necha soniyadan keyin qayta urinib ko'ring");
  }

  const data = await res.json();
  const raw = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const out = raw.map((p) => p.text || "").join("");
  let parsed;
  try {
    parsed = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw httpError(502, "Gemini tushunarsiz javob qaytardi - qayta urinib ko'ring");
  }
  const enhancedText = String(parsed.enhancedText || "").trim();
  if (!enhancedText) throw httpError(502, "Gemini bo'sh javob qaytardi");
  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map((s) => String(s || "").trim())
    .filter((s) => s && s !== enhancedText)
    .slice(0, 3);
  return { enhancedText: enhancedText.slice(0, MAX_TEXT), suggestions: suggestions.map((s) => s.slice(0, MAX_TEXT)) };
}

module.exports = { aiStatus, synthesize, synthesizeSample, sampleKey, enhance, MAX_TEXT };
