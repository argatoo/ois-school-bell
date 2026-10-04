// schedule_core.js - jadvalni o'zgartirish qoidalari (qo'ng'iroq, dam olish kuni, bir martalik qo'ng'iroq).
// Bitta fayl ikki joyda ishlaydi:
//   - maktab kompyuteridagi server.js (require) - lokal panel;
//   - brauzer (<script src>) - onlayn panel jadvalni to'g'ridan-to'g'ri Supabase'da o'zgartiradi.
// Shuning uchun ikkala panelda tekshiruv va xato matnlari bir xil bo'ladi.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ScheduleCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const MAX_RINGS = 20;
  const MAX_WEEKS = 520;
  const PRUNE_DAYS = 60;

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Bugungi sana "YYYY-MM-DD". timeZone berilsa - o'sha mintaqa bo'yicha (onlayn panel maktab vaqtida hisoblaydi).
  function todayIn(timeZone) {
    if (timeZone) {
      try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
      catch { /* noma'lum mintaqa - shu qurilma vaqti */ }
    }
    return ymd(new Date());
  }

  // "YYYY-MM-DD" haqiqiy sanami (masalan 2026-02-30 emas)
  function isValidDate(s) {
    if (!DATE_RE.test(s || "")) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return ymd(new Date(y, m - 1, d + n));
  }

  function newId() {
    const b = new Uint8Array(4);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // 60 kundan ko'proq oldin tugagan yozuvlarni (eski ta'tillar, o'tgan bir martalik qo'ng'iroqlar) olib tashlaydi
  function pruneOld(list, dateOf, today) {
    const cutoff = addDays(today, -PRUNE_DAYS);
    return list.filter((x) => x && typeof x === "object" && String(dateOf(x) || "") >= cutoff);
  }

  // Qo'ng'iroq maydonlarini tekshiradi (qo'shish va tahrirlash uchun umumiy).
  // oneTime = true - bir martalik qo'ng'iroq: hafta kunlari/hafta soni o'rniga aniq sana ("date").
  // Natija: { bell: {...} } yoki { error: "..." }
  function parseBellBody(body, oneTime, today) {
    const { time, label, sound } = body;
    if (!TIME_RE.test(time || "")) {
      return { error: "Vaqt HH:MM formatida bo'lishi kerak (masalan 08:25)" };
    }
    if (!sound || !String(sound).trim()) {
      return { error: "'sound' (ovoz fayli) maydoni kerak" };
    }
    if (oneTime) {
      if (!isValidDate(body.date)) return { error: "Sana YYYY-MM-DD formatida bo'lishi kerak" };
      if (body.date < today) return { error: "O'tib ketgan sanaga qo'ng'iroq qo'yib bo'lmaydi" };
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

  const byTime = (a, b) => a.time.localeCompare(b.time);

  // Jadvalga bitta o'zgarish kiritadi. op - panel API yo'li ("bell/add", "holiday/remove", ...).
  // config o'zgartirilmaydi - yangi nusxa qaytariladi: { config } yoki { error }.
  const OPS = {
    "bell/add"(config, body, today) {
      const parsed = parseBellBody(body, false, today);
      if (parsed.error) return parsed;
      config.bells = config.bells || [];
      config.bells.push({ id: newId(), ...parsed.bell, start_date: today });
      config.bells.sort(byTime);
      return { config };
    },

    // Mavjud qo'ng'iroqni tahrirlash (id o'zgarmaydi)
    "bell/update"(config, body, today) {
      const parsed = parseBellBody(body, false, today);
      if (parsed.error) return parsed;
      config.bells = config.bells || [];
      const idx = config.bells.findIndex((b) => b.id === body.id);
      if (idx === -1) return { error: "Bunday qo'ng'iroq topilmadi (o'chirilgan bo'lishi mumkin)" };
      const old = config.bells[idx];
      // Hafta soni o'zgarsa, hisob bugundan qaytadan boshlanadi; o'zgarmasa - eski boshlanish sanasi qoladi
      const start_date = old.weeks === parsed.bell.weeks && old.start_date ? old.start_date : today;
      config.bells[idx] = { id: old.id, ...parsed.bell, start_date };
      config.bells.sort(byTime);
      return { config };
    },

    "bell/remove"(config, body) {
      const before = (config.bells || []).length;
      config.bells = (config.bells || []).filter((b) => b.id !== body.id);
      if (config.bells.length === before) return { error: "Bunday qo'ng'iroq topilmadi" };
      return { config };
    },

    // Kalendar: dam olish kunlari / ta'tillar - shu kunlari haftalik qo'ng'iroqlar chalinmaydi
    "holiday/add"(config, body, today) {
      const start = String(body.start || "");
      const end = String(body.end || body.start || "");
      if (!isValidDate(start) || !isValidDate(end)) return { error: "Sanalar YYYY-MM-DD formatida bo'lishi kerak" };
      if (end < start) return { error: "Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas" };
      if (end < today) return { error: "O'tib ketgan sanalarni belgilash shart emas" };
      if (end > addDays(start, 366)) return { error: "Ko'pi bilan 1 yillik oraliq belgilash mumkin" };
      config.holidays = pruneOld(config.holidays || [], (h) => h.end || h.start, today);
      config.holidays.push({
        id: newId(),
        start, end,
        label: String(body.label || "").trim().slice(0, 200) || "Dam olish kuni",
      });
      config.holidays.sort((a, b) => a.start.localeCompare(b.start));
      return { config };
    },

    "holiday/remove"(config, body) {
      const before = (config.holidays || []).length;
      config.holidays = (config.holidays || []).filter((h) => h.id !== body.id);
      if (config.holidays.length === before) return { error: "Bunday dam olish kuni topilmadi" };
      return { config };
    },

    // Davlat bayramlarida jadvaldagi qo'ng'iroqlar chalinsinmi (standart: chalinmaydi)
    "settings/public-holidays"(config, body) {
      config.public_holidays = body.enabled !== false;
      return { config };
    },

    // Kalendar: bir martalik qo'ng'iroqlar (aniq sanaga)
    "event/add"(config, body, today) {
      const parsed = parseBellBody(body, true, today);
      if (parsed.error) return parsed;
      config.events = pruneOld(config.events || [], (e) => e.date, today);
      config.events.push({ id: newId(), ...parsed.bell });
      config.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return { config };
    },

    "event/remove"(config, body) {
      const before = (config.events || []).length;
      config.events = (config.events || []).filter((e) => e.id !== body.id);
      if (config.events.length === before) return { error: "Bunday bir martalik qo'ng'iroq topilmadi" };
      return { config };
    },
  };

  function applyOp(op, config, body, today) {
    const fn = OPS[op];
    if (!fn) return { error: "Noma'lum amal: " + op };
    return fn(JSON.parse(JSON.stringify(config || {})), body || {}, today || todayIn());
  }

  return { OPS: Object.keys(OPS), applyOp, parseBellBody, isValidDate, todayIn, WEEKDAYS };
});
