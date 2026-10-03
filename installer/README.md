# OIS School Bell — o'rnatuvchi (setup.exe)

Natija: `Output\OIS-School-Bell-Setup-1.0.0.exe` — oddiy Windows "Setup" oynasi (litsenziya, papka tanlash,
Next/Back). Ichida **Python va Node.js bor** — o'rnatiladigan kompyuterda oldindan hech narsa kerak emas,
admin huquqi ham kerak emas.

## O'rnatilgandan keyin nima bo'ladi

- Dastur `%LOCALAPPDATA%\Programs\OIS School Bell` ga o'rnatiladi.
- Qo'ng'iroq dasturi va boshqaruv paneli **darrov** ishga tushadi va bundan keyin **Windows'ga har kirilganda o'zi** ishga tushadi (Startup).
- Ish stoli va Start menyuda "OIS School Bell" yorlig'i — panelni (`http://localhost:3000`) ochadi.
- Eski usulda (`o'rnatish.bat`) o'rnatilgan nusxa bo'lsa, u to'xtatiladi va yorlig'i o'chiriladi (qo'ng'iroq ikki marta chalinmasligi uchun).
- Qayta o'rnatish/yangilashda qo'ng'iroqlar jadvali va jurnal saqlanib qoladi.

## Maxfiy kalitlar (.env)

Odatda `.env` **setup.exe ichiga qo'shilmaydi** — o'rnatish paytida ".env faylini tanlang" sahifasi chiqadi,
faylni fleshkadan tanlaysiz. Tanlanmasa: qo'ng'iroqlar ishlaydi, lekin panelga kirish va musiqa kutubxonasi ishlamaydi.

Kalitni setup.exe ichiga joylash uchun `OIS-School-Bell.iss` dagi `;#define IncludeSecrets` qatoridan `;` ni olib tashlang.
**Unda setup.exe ni hech qachon maktabdan tashqariga bermang** — undan bazaga to'liq kirish kalitini olish mumkin.

## Yasash (bir marta sozlash)

1. **Inno Setup 6** ni o'rnating: https://jrsoftware.org/isdl.php
2. Python embeddable faylini qo'ying (bir marta):
   `installer\build\downloads\python-3.14.0-embed-amd64.zip`
   (https://www.python.org/ftp/python/3.14.0/python-3.14.0-embed-amd64.zip)
3. Yasang:

   ```
   powershell -ExecutionPolicy Bypass -File installer\build_installer.ps1
   ```

Skript kerak bo'lsa `stage_runtime.py` ni o'zi chaqiradi: u Python'ni ochadi, jonli e'lon paketlarini
(`sounddevice`, `numpy`, `cffi`, `pycparser`) shu kompyuterdagi Python 3.14 dan nusxalaydi va `node.exe` ni qo'shadi.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `OIS-School-Bell.iss` | Inno Setup skripti (oyna, fayllar, yorliqlar, avtoishga tushirish, o'chirish) |
| `stage_runtime.py` | Ichki Python + Node muhitini `build\runtime` ga yig'adi |
| `make_icon.py` | `files\bell.ico` ni yasaydi (panel logotipiga mos) |
| `build_installer.ps1` | Hammasini birga yasaydi |
| `files\start_scheduler.vbs`, `files\start_panel.vbs` | Konsol oynasisiz ishga tushirgichlar |
| `files\LICENSE.txt` | Litsenziya oynasidagi matn (o'zbek + rus) — o'zingizga moslab tahrirlang |
| `files\schedule.default.json` | Birinchi o'rnatishdagi bo'sh jadval |
