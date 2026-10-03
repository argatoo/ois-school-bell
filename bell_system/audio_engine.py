#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audio_engine.py
OIS School Bell - yagona "ovoz dispetcheri".

Karnayga chiqadigan hamma tovush shu yerdan o'tadi va darajasi bo'yicha boshqariladi:
    1) e'lon      - AI e'lon ("hozir chalish"), kutubxonadagi "E'lon" turidagi fayllar; jonli mikrofon ham shu daraja
    2) qo'ng'iroq - jadvaldagi oddiy qo'ng'iroqlar
    3) musiqa     - kutubxonadagi "Musiqa" turidagi fayllar

Qoidalar:
    - Qo'ng'iroq yoki e'lon chalinayotganda (yoki mikrofon yoqiq bo'lsa) musiqa ~15% gacha asta pasayadi,
      ular tugagach yana asta qaytadi (radiodagi "ducking"). Musiqa to'xtamaydi.
    - Har bir daraja ichida tovushlar navbat bilan, birin-ketin chalinadi - hech qachon ustma-ust emas.
    - Qo'ng'iroq e'lon (yoki mikrofon) tugashini kutadi, lekin ko'pi bilan MAX_WAIT_SEC - qo'ng'iroq yo'qolmaydi.
    - E'lon hozir chalinayotgan qo'ng'iroq tugashini kutadi (qo'ng'iroqlar qisqa).

Windows'da har bir tovush MCI orqali alohida oqimda chalinadi va balandligi chalinish davomida
o'zgartiriladi. Boshqa tizimlarda balandlik faqat boshida qo'yiladi (pasaytirish ishlamaydi).
"""

import itertools
import os
import platform
import subprocess
import threading
import time

PRI_ANNOUNCE = "announcement"
PRI_BELL = "bell"
PRI_MUSIC = "music"
LAYERS = (PRI_ANNOUNCE, PRI_BELL, PRI_MUSIC)

DUCK_LEVEL = 0.15     # pasaytirilgan musiqa balandligi (asl balandlikning ulushi)
FADE_SEC = 0.6        # pasayish / qaytish davomiyligi
MAX_WAIT_SEC = 120    # qo'ng'iroq yoki e'lon ko'pi bilan shuncha kutadi
TICK = 0.05

IS_WINDOWS = platform.system() == "Windows"
_ids = itertools.count(1)


class Item:
    """Navbatdagi bitta tovush."""

    def __init__(self, path, priority, volume=100, times=1, label="", on_done=None, delete_after=False):
        self.id = next(_ids)
        self.path = path
        self.priority = priority if priority in LAYERS else PRI_BELL
        self.volume = max(1, min(100, int(volume)))
        self.times = max(1, int(times))
        self.label = label
        self.on_done = on_done          # on_done(item, ok) - tugaganda (yoki bekor qilinganda) chaqiriladi
        self.delete_after = delete_after
        self.queued_at = time.monotonic()
        self.started_at = None
        self.played = 0
        self.stop_flag = threading.Event()
        self.volume_trace = []          # (soniya, balandlik 0..1000) - tekshiruv uchun

    def info(self):
        level = self.volume_trace[-1][1] if self.volume_trace else None   # hozirgi haqiqiy balandlik (0..1000)
        return {"id": self.id, "label": self.label, "file": os.path.basename(self.path),
                "volume": self.volume, "times": self.times, "played": self.played, "level": level}


# ---------- Bitta faylni chalish ----------

def _mci(cmd, buf=None):
    import ctypes
    winmm = ctypes.windll.winmm  # type: ignore[attr-defined]
    if buf is None:
        return winmm.mciSendStringW(cmd, None, 0, None)
    return winmm.mciSendStringW(cmd, buf, len(buf), None)


def _play_once_windows(item, gain_fn):
    """Bir marta chaladi; har TICK da to'xtatish so'rovini va kerakli balandlikni tekshiradi."""
    import ctypes
    alias = f"eng{item.id}x{threading.get_ident()}"
    path = item.path.replace('"', "")
    if _mci(f'open "{path}" type mpegvideo alias {alias}') != 0:
        return False
    try:
        cur = gain_fn()
        last = int(round(item.volume * 10 * cur))
        _mci(f"setaudio {alias} volume to {last}")
        item.volume_trace.append((time.monotonic(), last))
        if _mci(f"play {alias}") != 0:
            return False
        buf = ctypes.create_unicode_buffer(64)
        while True:
            if item.stop_flag.is_set():
                _mci(f"stop {alias}")
                return True
            time.sleep(TICK)
            target = gain_fn()
            step = TICK / FADE_SEC
            cur = min(target, cur + step) if target > cur else max(target, cur - step)
            vol = int(round(item.volume * 10 * cur))
            if vol != last:
                _mci(f"setaudio {alias} volume to {vol}")
                item.volume_trace.append((time.monotonic(), vol))
                last = vol
            buf.value = ""
            _mci(f"status {alias} mode", buf)
            if buf.value == "stopped":
                return True
    finally:
        _mci(f"close {alias}")


def _player_cmd(path, volume):
    if platform.system() == "Darwin":
        return [["afplay", "-v", str(volume / 100), path]]
    return [
        ["mpg123", "-q", "-f", str(int(32768 * volume / 100)), path],
        ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", str(volume), path],
        ["paplay", f"--volume={int(65536 * volume / 100)}", path],
        ["aplay", "-q", path],
    ]


def _play_once_other(item, gain_fn):
    """Windows'dan boshqa tizimlar: tashqi pleyer bilan, to'xtatish mumkin (pasaytirish yo'q)."""
    vol = int(item.volume * gain_fn())
    for cmd in _player_cmd(item.path, vol):
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            continue
        while proc.poll() is None:
            if item.stop_flag.is_set():
                proc.terminate()
                return True
            time.sleep(TICK)
        return proc.returncode == 0
    return False


def play_once(item, gain_fn):
    return _play_once_windows(item, gain_fn) if IS_WINDOWS else _play_once_other(item, gain_fn)


# ---------- Dispetcher ----------

class AudioEngine:
    def __init__(self, log=print, player=None):
        self.log = log
        self.player = player or play_once      # sinov uchun almashtirish mumkin
        self.cv = threading.Condition()
        self.queues = {p: [] for p in LAYERS}
        self.current = {p: None for p in LAYERS}
        self.mic_on = False
        self.mic_since = None
        threading.Thread(target=self._dispatch_loop, name="audio-dispatch", daemon=True).start()

    # --- tashqi buyruqlar ---
    def submit(self, item):
        with self.cv:
            self.queues[item.priority].append(item)
            self.cv.notify_all()
        return item.id

    def stop(self, priority=None):
        """Berilgan darajadagi (yoki hammasining) navbatini tozalaydi va chalinayotganini to'xtatadi."""
        dropped = []
        with self.cv:
            for p in ([priority] if priority in LAYERS else LAYERS):
                dropped += self.queues[p]
                self.queues[p] = []
                if self.current[p]:
                    self.current[p].stop_flag.set()
            self.cv.notify_all()
        for item in dropped:
            self._finish_callbacks(item, False)

    def set_mic(self, on):
        with self.cv:
            on = bool(on)
            if on != self.mic_on:
                self.mic_on = on
                self.mic_since = time.monotonic() if on else None
                self.log("Jonli e'lon (mikrofon) " + ("yoqildi - musiqa pasaytirildi, qo'ng'iroqlar kutadi" if on else "o'chirildi"))
            self.cv.notify_all()

    def status(self):
        with self.cv:
            return {
                "mic": self.mic_on,
                "ducking": self._duck_active(),
                "current": {p: (self.current[p].info() if self.current[p] else None) for p in LAYERS},
                "queued": {p: [i.info() for i in self.queues[p]] for p in LAYERS},
            }

    # --- ichki qoidalar ---
    def _duck_active(self):
        return self.mic_on or self.current[PRI_ANNOUNCE] is not None or self.current[PRI_BELL] is not None

    def _waited_too_long(self, item):
        return time.monotonic() - item.queued_at >= MAX_WAIT_SEC

    def _can_start(self, priority, item):
        if priority == PRI_ANNOUNCE:
            # E'lon: chalinayotgan qisqa qo'ng'iroq va jonli mikrofon tugashini kutadi
            return (self.current[PRI_BELL] is None and not self.mic_on) or self._waited_too_long(item)
        if priority == PRI_BELL:
            # Qo'ng'iroq: e'lon / mikrofon tugashini kutadi (ko'pi bilan MAX_WAIT_SEC)
            return (self.current[PRI_ANNOUNCE] is None and not self.mic_on) or self._waited_too_long(item)
        return True  # musiqa: o'z navbatida darrov (kerak bo'lsa pasaytirilgan holda)

    def _dispatch_loop(self):
        while True:
            try:
                with self.cv:
                    for p in LAYERS:
                        if self.current[p] is None and self.queues[p] and self._can_start(p, self.queues[p][0]):
                            item = self.queues[p].pop(0)
                            if p != PRI_MUSIC and time.monotonic() - item.queued_at > 1.5:
                                self.log(f"Navbat: \"{item.label}\" {int(time.monotonic() - item.queued_at)} soniya kutib chalindi")
                            item.started_at = time.monotonic()
                            self.current[p] = item
                            threading.Thread(target=self._run, args=(item,), name=f"play-{p}", daemon=True).start()
                    self.cv.wait(timeout=0.5)
            except Exception as e:  # dispetcher hech qachon to'xtamasligi kerak
                self.log(f"XATOLIK: ovoz dispetcherida muammo (davom etmoqda): {e}")
                time.sleep(1)

    def _gain_fn(self, item):
        if item.priority == PRI_MUSIC:
            return lambda: DUCK_LEVEL if self._duck_active() else 1.0
        return lambda: 1.0

    def _run(self, item):
        gain = self._gain_fn(item)
        try:
            for _ in range(item.times):
                if item.stop_flag.is_set():
                    break
                if self.player(item, gain):
                    item.played += 1
        except Exception as e:
            self.log(f"XATOLIK: ovoz chalishda muammo ({os.path.basename(item.path)}): {e}")
        finally:
            with self.cv:
                if self.current[item.priority] is item:
                    self.current[item.priority] = None
                self.cv.notify_all()
            self._finish_callbacks(item, item.played > 0)

    def _finish_callbacks(self, item, ok):
        if item.delete_after:
            try:
                os.remove(item.path)
            except OSError:
                pass
        if item.on_done:
            try:
                item.on_done(item, ok)
            except Exception as e:
                self.log(f"XATOLIK: tugash xabarida muammo: {e}")
