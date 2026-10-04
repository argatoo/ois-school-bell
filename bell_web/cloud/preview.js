// cloud/preview.js - yig'ilgan onlayn panelni (cloud/dist) kompyuterda ko'rib chiqish uchun oddiy statik server.
// Ishga tushirish:  node cloud/preview.js   ->  http://localhost:3070
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "dist");
const PORT = Number(process.env.PORT) || 3070;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json" };

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(DIST, p === "/" ? "index.html" : p);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Topilmadi"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Onlayn panel (sinov): http://localhost:${PORT}`));
