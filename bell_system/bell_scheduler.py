#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bell_scheduler.py
OIS School Bell - jadval asosida avtomatik ishlaydigan asosiy dastur.

Bu dastur SIP / jonli e'lon tizimidan BUTUNLAY ALOHIDA ishlaydi.
Faqat config/schedule.json faylini o'qiydi va har bir qo'ng'iroq uchun
belgilangan vaqtda, belgilangan hafta kunlari ovoz faylini chaladi
(kerak bo'lsa ketma-ket bir necha marta).

Ishga tushirish:
    python bell_scheduler.py

To'xtatish: Ctrl+C

Config faylini o'zgartirsangiz (masalan web panel yoki bell_admin.py orqali),
dastur uni avtomatik qayta o'qiydi - qayta ishga tushirish shart emas.

Karnayga chiqadigan hamma tovush audio_engine.py dagi "ovoz dispetcheri" orqali o'tadi:
e'lon > qo'ng'iroq > musiqa (musiqa pasayadi, qo'ng'iroqlar navbat bilan - ustma-ust chalinmaydi).
Panel (bell_web/server.js) "hozir chalish" va jonli mikrofon haqida faqat shu kompyuter ichidagi
boshqaruv porti (127.0.0.1:3901) orqali xabar beradi.
"""

import json
import os
import sys
import time
import platform
import subprocess
import csv
import threading
from datetime import datetime, date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# O'rnatuvchi bilan keladigan (embeddable) Python skript papkasini o'zi qidirmaydi -
# yonidagi audio_engine.py topilishi uchun shu papkani qo'lda qo'shamiz.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audio_engine import AudioEngine, Item, PRI_ANNOUNCE, PRI_BELL, PRI_MUSIC, LAYERS  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "schedule.json")
AUDIO_DIR = os.path.join(BASE_DIR, "audios")
LOG_PATH = os.path.join(BASE_DIR, "logs", "bell_log.csv")
LIB_INDEX = os.path.join(AUDIO_DIR, "library", "index.json")   # server yozadi: fayl -> turi (bell/music/announcement)
LIVE_DIR = os.path.join(AUDIO_DIR, "_live")                      # "hozir chalish" uchun vaqtinchalik fayllar
ENGINE_PORT = int(os.environ.get("BELL_ENGINE_PORT", "3901"))
KIND_TO_PRIORITY = {"music": PRI_MUSIC, "announcement": PRI_ANNOUNCE, "bell": PRI_BELL}

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

_log_lock = threading.Lock()


def log(message, to_console=True):
    """Har bir voqeani logs/bell_log.csv fayliga va konsolga yozadi."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _log_lock:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        file_exists = os.path.isfile(LOG_PATH)
        with open(LOG_PATH, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["vaqt", "xabar"])
            writer.writerow([timestamp, message])
    if to_console:
        print(f"[{timestamp}] {message}")


def load_config():
    """schedule.json faylini o'qiydi. Xato bo'lsa None qaytaradi va logga yozadi."""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log(f"XATOLIK: config o'qishda muammo: {e}")
        return None


def is_active_on(bell, today: date):
    """
    Qo'ng'iroq shu sanada chalinishi kerakmi?
    - 'days' ichida bugungi hafta kuni bo'lishi kerak;
    - 'weeks' berilgan bo'lsa, 'start_date' dan boshlab shuncha hafta ichida bo'lishi kerak.
    """
    if WEEKDAY_NAMES[today.weekday()] not in bell.get("days", []):
        return False
    weeks = bell.get("weeks")
    start = bell.get("start_date")
    if weeks and start:
        try:
            start_date = date.fromisoformat(start)
        except ValueError:
            return True
        if today < start_date or (today - start_date).days >= int(weeks) * 7:
            return False
    return True


PUBLIC_HOLIDAYS_PATH = os.path.join(BASE_DIR, "config", "uz_holidays.json")
_public_cache = {"mtime": None, "data": {}}


def load_public_holidays():
    """O'zbekiston davlat bayramlari (config/uz_holidays.json). Fayl o'zgarsa qayta o'qiladi."""
    try:
        mtime = os.path.getmtime(PUBLIC_HOLIDAYS_PATH)
        if mtime != _public_cache["mtime"]:
            with open(PUBLIC_HOLIDAYS_PATH, "r", encoding="utf-8") as f:
                _public_cache["data"] = json.load(f)
            _public_cache["mtime"] = mtime
    except Exception:
        pass  # fayl yo'q yoki buzilgan - oxirgi yaxshi nusxa (yoki bo'sh) ishlatiladi
    return _public_cache["data"]


def public_holiday_on(today: date):
    """Bugun davlat bayramimi? Bo'lsa {"id", "label"}, bo'lmasa None."""
    data = load_public_holidays()
    md = today.strftime("%m-%d")
    iso = today.isoformat()
    for h in (data.get("fixed") or []):
        if isinstance(h, dict) and h.get("md") == md:
            return {"id": "pub:" + iso, "label": (h.get("label") or {}).get("uz", "Davlat bayrami")}
    for h in (data.get("dated") or []):
        if isinstance(h, dict) and h.get("date") == iso:
            return {"id": "pub:" + iso, "label": (h.get("label") or {}).get("uz", "Davlat bayrami")}
    return None


def holiday_on(config, today: date):
    """Bugun dam olish kuni / ta'til / davlat bayramimi? Bo'lsa - o'sha yozuv (dict), bo'lmasa None.
    Dam olish kunida jadvaldagi (haftalik) qo'ng'iroqlar chalinmaydi; bir martalik qo'ng'iroqlar esa chalinadi.
    Davlat bayramlari config["public_holidays"] = false bo'lsa hisobga olinmaydi (standart - hisobga olinadi)."""
    for h in config.get("holidays", []) or []:
        try:
            if not isinstance(h, dict):
                continue
            start = date.fromisoformat(h.get("start"))
            end = date.fromisoformat(h.get("end") or h.get("start"))
            if start <= today <= end:
                return h
        except (TypeError, ValueError):
            continue
    if config.get("public_holidays", True) is not False:
        return public_holiday_on(today)
    return None


def bell_volume(bell):
    """Qo'ng'iroqning ovoz balandligi, foizda (1..100). Berilmagan yoki noto'g'ri bo'lsa - 100."""
    try:
        v = int(bell.get("volume", 100))
    except (TypeError, ValueError):
        return 100
    return min(100, max(1, v))


def _play_once_blocking(filepath, volume=100):
    """Ovoz faylini bir marta, `volume` foiz balandlikda chalib, tugaguncha kutadi. Muvaffaqiyatli bo'lsa True."""
    system = platform.system()
    if system == "Windows":
        import ctypes
        winmm = ctypes.windll.winmm  # type: ignore[attr-defined]
        alias = f"bell{threading.get_ident()}"
        ext = os.path.splitext(filepath)[1].lower()
        # "waveaudio" ovoz balandligini o'zgartirishni qo'llamaydi, "mpegvideo" esa wav va mp3 ning ikkalasini
        # chaladi va balandlikni (0..1000) qabul qiladi. 100% da avvalgidek ishlayveradi.
        dev = "waveaudio" if ext == ".wav" and volume >= 100 else "mpegvideo"
        path = filepath.replace('"', "")
        if winmm.mciSendStringW(f'open "{path}" type {dev} alias {alias}', None, 0, None) != 0:
            return False
        try:
            if volume < 100:
                winmm.mciSendStringW(f"setaudio {alias} volume to {volume * 10}", None, 0, None)
            return winmm.mciSendStringW(f"play {alias} wait", None, 0, None) == 0
        finally:
            winmm.mciSendStringW(f"close {alias}", None, 0, None)
    if system == "Darwin":  # macOS
        return subprocess.run(["afplay", "-v", str(volume / 100), filepath]).returncode == 0
    # Linux: mavjud pleyerlardan birini sinab ko'radi
    players = [
        ["mpg123", "-q", "-f", str(int(32768 * volume / 100)), filepath],
        ["mpg321", "-q", "-g", str(volume), filepath],
        ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", str(volume), filepath],
        ["paplay", f"--volume={int(65536 * volume / 100)}", filepath],
        ["aplay", "-q", filepath],  # aplay balandlikni o'zgartira olmaydi - oxirgi chora
    ]
    for cmd in players:
        try:
            return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        except FileNotFoundError:
            continue
    log("XATOLIK: hech qanday audio pleyer topilmadi (mpg123/ffplay/aplay/paplay o'rnatilmagan)")
    return False


def play_sound(filename, times=1, volume=100):
    """Ovoz faylini ketma-ket `times` marta, `volume` foiz balandlikda chaladi. Hech bo'lmasa bir marta chalinsa True."""
    filepath = os.path.join(AUDIO_DIR, filename)
    if not os.path.isfile(filepath):
        log(f"OGOHLANTIRISH: ovoz fayli topilmadi: {filepath}")
        return False
    played = 0
    try:
        for _ in range(max(1, times)):
            if _play_once_blocking(filepath, volume):
                played += 1
    except Exception as e:
        log(f"XATOLIK: ovoz chalishda muammo ({filename}): {e}")
    return played > 0


_engine = None


def engine():
    """Yagona ovoz dispetcheri (birinchi chaqirilganda yaratiladi)."""
    global _engine
    if _engine is None:
        _engine = AudioEngine(log=log)
    return _engine


def sound_kind(filename):
    """Kutubxonadagi faylning turi (bell/music/announcement). Kutubxonada bo'lmasa - None (qo'ng'iroq deb olinadi)."""
    try:
        with open(LIB_INDEX, "r", encoding="utf-8") as f:
            for entry in json.load(f):
                if entry.get("file") == filename:
                    return entry.get("kind")
    except Exception:
        pass
    return None


def fire_bell(bell, time_str):
    """Qo'ng'iroqni dispetcher navbatiga qo'yadi (asosiy sikl kutib qolmaydi)."""
    label = bell.get("label", "")
    rings = int(bell.get("rings", 1) or 1)
    volume = bell_volume(bell)
    filename = bell.get("sound", "")
    filepath = os.path.join(AUDIO_DIR, filename)
    if not os.path.isfile(filepath):
        log(f"OGOHLANTIRISH: ovoz fayli topilmadi: {filepath}")
        log(f"Signal: {label} ({time_str}, {rings} marta) - XATO - chalinmadi")
        return
    priority = KIND_TO_PRIORITY.get(sound_kind(filename), PRI_BELL)

    def done(item, ok):
        status = "chalindi" if ok else "XATO - chalinmadi"
        if ok and item.stop_flag.is_set():
            status = "to'xtatildi"
        vol_text = f", ovoz {volume}%" if volume < 100 else ""
        kind_text = {PRI_MUSIC: ", musiqa", PRI_ANNOUNCE: ", e'lon"}.get(priority, "")
        log(f"Signal: {label} ({time_str}, {rings} marta{vol_text}{kind_text}) - {status}")

    engine().submit(Item(filepath, priority, volume, rings, label, on_done=done))


# ---------- Boshqaruv porti (faqat shu kompyuter ichida: 127.0.0.1) ----------

def _safe_audio_path(rel):
    """audios/ ichidagi mavjud faylning to'liq yo'li; tashqariga chiqishga urinish bo'lsa None."""
    rel = str(rel or "").replace("\\", "/").lstrip("/")
    root = os.path.normpath(AUDIO_DIR)
    full = os.path.normpath(os.path.join(root, rel))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        return None
    return full


class _ControlHandler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/status":
            return self._json(200, engine().status())
        return self._json(404, {"error": "noma'lum yo'l"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except Exception:
            return self._json(400, {"error": "JSON noto'g'ri"})
        if self.path == "/play":
            rel = str(body.get("file") or "")
            full = _safe_audio_path(rel)
            if not full:
                return self._json(400, {"error": "fayl topilmadi"})
            priority = body.get("priority") if body.get("priority") in LAYERS else PRI_ANNOUNCE
            label = str(body.get("label") or "E'lon")[:200]
            try:
                volume = int(body.get("volume", 100))
                times = int(body.get("times", 1))
            except (TypeError, ValueError):
                return self._json(400, {"error": "volume/times butun son bo'lishi kerak"})
            item = Item(full, priority, volume, times, label,
                        on_done=lambda it, ok: log(f"{it.label} - " + ("to'xtatildi" if ok and it.stop_flag.is_set() else "chalindi" if ok else "XATO - chalinmadi")),
                        delete_after=rel.replace("\\", "/").startswith("_live/"))
            return self._json(200, {"ok": True, "id": engine().submit(item)})
        if self.path == "/stop":
            engine().stop(body.get("priority"))
            return self._json(200, engine().status())
        if self.path == "/mic":
            engine().set_mic(body.get("on"))
            return self._json(200, engine().status())
        return self._json(404, {"error": "noma'lum yo'l"})

    def log_message(self, *args):  # har bir so'rovni konsolga yozmaslik
        pass


_control_started = False


def start_control_server():
    global _control_started
    if _control_started:
        return
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", ENGINE_PORT), _ControlHandler)
    except OSError as e:
        # Qo'ng'iroqlar baribir chalinaveradi - faqat panelning "hozir chalish"i dispetcherdan o'tmaydi
        log(f"OGOHLANTIRISH: boshqaruv porti {ENGINE_PORT} band ({e}) - panel bilan aloqa yo'q")
        return
    threading.Thread(target=srv.serve_forever, name="control", daemon=True).start()
    _control_started = True


def cleanup_live_dir():
    """Oldingi ishdan qolgan vaqtinchalik "hozir chalish" fayllarini tozalaydi."""
    try:
        for f in os.listdir(LIVE_DIR):
            try:
                os.remove(os.path.join(LIVE_DIR, f))
            except OSError:
                pass
    except OSError:
        pass


def main():
    log("Bell scheduler ishga tushdi.")
    cleanup_live_dir()
    engine()
    start_control_server()
    last_config_mtime = None
    config = None
    fired = set()        # (sana, vaqt, id) - bir xil qo'ng'iroqni ikki marta chalmaslik uchun
    fired_date = None
    holiday_logged = None  # (sana, yozuv id) - "bugun dam olish kuni" ni kuniga bir marta yozish uchun

    while True:
        try:
            try:
                mtime = os.path.getmtime(CONFIG_PATH)
            except OSError:
                mtime = None

            if mtime != last_config_mtime:
                new_config = load_config()
                if new_config is not None:
                    config = new_config
                    last_config_mtime = mtime
                    log("Jadval (config) qayta yuklandi.")

            if config is not None:
                now = datetime.now()
                today = now.date()
                current_time_str = now.strftime("%H:%M")
                if fired_date != today:
                    fired.clear()
                    fired_date = today

                holiday = holiday_on(config, today)
                if holiday and holiday_logged != (today, holiday.get("id")):
                    holiday_logged = (today, holiday.get("id"))
                    log(f"Bugun dam olish kuni: {holiday.get('label') or '-'} - jadvaldagi qo'ng'iroqlar chalinmaydi")

                # Haftalik (jadvaldagi) qo'ng'iroqlar - dam olish kunlari chalinmaydi
                for idx, bell in enumerate([] if holiday else config.get("bells", [])):
                    try:
                        if not isinstance(bell, dict):
                            continue
                        if bell.get("time") != current_time_str or not is_active_on(bell, today):
                            continue
                        key = (bell.get("id") or idx, current_time_str)
                        if key in fired:
                            continue
                        fired.add(key)
                        fire_bell(bell, current_time_str)
                    except Exception as e:
                        # Bitta qo'ng'iroqda muammo bo'lsa ham, qolganlari o'z vaqtida chalinishda davom etadi
                        log(f"XATOLIK: qo'ng'iroq #{idx} bilan muammo (o'tkazib yuborildi): {e}")

                # Bir martalik qo'ng'iroqlar (aniq sanaga) - dam olish kunida ham chalinadi
                today_str = today.isoformat()
                for idx, ev in enumerate(config.get("events", []) or []):
                    try:
                        if not isinstance(ev, dict) or ev.get("date") != today_str or ev.get("time") != current_time_str:
                            continue
                        key = ("ev:" + str(ev.get("id") or idx), current_time_str)
                        if key in fired:
                            continue
                        fired.add(key)
                        fire_bell(ev, current_time_str)
                    except Exception as e:
                        log(f"XATOLIK: bir martalik qo'ng'iroq #{idx} bilan muammo (o'tkazib yuborildi): {e}")
        except Exception as e:
            # Asosiy sikl HECH QACHON to'liq to'xtamasligi kerak - kutilmagan xato bo'lsa ham davom etadi
            log(f"XATOLIK: asosiy siklda kutilmagan muammo (davom etmoqda): {e}")

        time.sleep(1)


if __name__ == "__main__":
    # main() biror sababdan (kutilmagan xato) yiqilib ketsa ham, dastur butunlay o'lmaydi -
    # bir necha soniyadan keyin o'zini qayta ishga tushiradi. Ctrl+C bilangina to'xtaydi.
    while True:
        try:
            main()
            break  # main() faqat KeyboardInterrupt orqali shu yerga normal yetib keladi
        except KeyboardInterrupt:
            log("Bell scheduler to'xtatildi (Ctrl+C).")
            sys.exit(0)
        except Exception as e:
            log(f"XATOLIK: dastur kutilmagan tarzda yiqildi, 5 soniyadan keyin o'zi qayta ishga tushadi: {e}")
            time.sleep(5)
