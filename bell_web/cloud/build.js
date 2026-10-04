// cloud/build.js - internetdagi (onlayn) panelni yig'adi: bell_web/public -> bell_web/cloud/dist
// Natija oddiy statik sayt (Vercel va h.k.ga joylanadi). Ichiga faqat OCHIQ qiymatlar qo'shiladi:
// Supabase manzili va anon (publishable) kalit - ular baribir har bir brauzerga beriladi.
// service_role va AI kalitlari hech qachon bu yerga tushmaydi.
//
// Ishga tushirish:  node cloud/build.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "public");
const DIST = path.join(__dirname, "dist");

function readEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf-8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env yo'q */ }
  return { ...out, ...process.env };
}

const env = readEnv();
const url = (env.SUPABASE_URL || "").replace(/\/+$/, "");
const anonKey = env.SUPABASE_ANON_KEY || "";
if (!url || !anonKey) {
  console.error("SUPABASE_URL va SUPABASE_ANON_KEY topilmadi (bell_web/.env)");
  process.exit(1);
}
if (/service_role|sb_secret_/i.test(anonKey) || anonKey === env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Xato: anon kalit o'rnida maxfiy kalit turibdi - yig'ish to'xtatildi");
  process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(SRC, DIST, { recursive: true });

const indexPath = path.join(DIST, "index.html");
const marker = '<script src="/vendor/supabase.js"></script>';
let html = fs.readFileSync(indexPath, "utf-8");
if (!html.includes(marker)) {
  console.error("index.html da supabase.js qatori topilmadi");
  process.exit(1);
}
const inject = `<script>window.OIS_CLOUD = ${JSON.stringify({ url, anonKey })};</script>\n`;
html = html.replace(marker, inject + marker);
fs.writeFileSync(indexPath, html);

// Xavfsizlik sarlavhalari (sahifani boshqa saytga joylab bo'lmaydi va h.k.)
fs.writeFileSync(path.join(DIST, "vercel.json"), JSON.stringify({
  headers: [{
    source: "/(.*)",
    headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ],
  }],
}, null, 2));

console.log("Tayyor:", DIST);
