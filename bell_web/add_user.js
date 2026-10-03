// add_user.js
// Panelga kirish uchun yangi foydalanuvchi (admin) yaratadi yoki parolini almashtiradi.
//
//   node add_user.js <login> <parol>
//
// Misol:  node add_user.js direktor Maktab2026!
// Login: 2-32 belgi, faqat kichik lotin harflari, raqamlar, nuqta, chiziq va pastki chiziq.
// Supabase .env dagi SUPABASE_SERVICE_ROLE_KEY orqali ishlaydi (kalit hech qayerda chop etilmaydi).

const fs = require("fs");
const path = require("path");

const LOGIN_DOMAIN = "@bell.local";           // index.html dagi LOGIN_DOMAIN bilan bir xil bo'lsin
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

function loadEnv() {
  const env = {};
  const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Foydalanish: node add_user.js <login> <parol>");
    process.exit(1);
  }
  const name = username.trim().toLowerCase();
  if (!USERNAME_RE.test(name)) {
    console.error("Login noto'g'ri: 2-32 belgi, faqat a-z, 0-9, nuqta, chiziq (-) va pastki chiziq (_).");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Parol kamida 8 belgi bo'lsin.");
    process.exit(1);
  }

  const env = loadEnv();
  const url = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("bell_web/.env da SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY bo'lishi kerak.");
    process.exit(1);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const email = name + LOGIN_DOMAIN;

  const create = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { role: "admin" } }),
  });
  if (create.ok) {
    console.log(`Yaratildi: login "${name}" (admin).`);
    return;
  }

  // Allaqachon bor bo'lsa - parolini yangilaymiz va admin rolini ta'minlaymiz
  const err = await create.json().catch(() => ({}));
  if (!/already|exists|registered/i.test(JSON.stringify(err))) {
    console.error("Xato:", create.status, err.msg || err.message || JSON.stringify(err));
    process.exit(1);
  }
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers });
  const users = ((await list.json()).users) || [];
  const found = users.find((u) => (u.email || "").toLowerCase() === email);
  if (!found) {
    console.error("Foydalanuvchi mavjud, lekin ro'yxatdan topilmadi.");
    process.exit(1);
  }
  const upd = await fetch(`${url}/auth/v1/admin/users/${found.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password, app_metadata: { ...(found.app_metadata || {}), role: "admin" } }),
  });
  if (!upd.ok) {
    console.error("Yangilashda xato:", upd.status);
    process.exit(1);
  }
  console.log(`"${name}" allaqachon bor edi: paroli yangilandi (admin).`);
}

main().catch((e) => { console.error("Xato:", e.message || e); process.exit(1); });
