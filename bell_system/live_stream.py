#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_stream.py
Onlayn paneldan kelayotgan jonli ovozni (internet orqali, bo'laklab) speakerlarga chiqaradi -
"jonli efir" rejimi.

Ovozni bell_web/server.js beradi: standart kirishga (stdin) 16 kHz, mono, 16-bit PCM yoziladi.
Bo'laklar internetdan notekis keladi, shuning uchun bu yerda kichik bufer bor: chalish ~0.3 s
to'plangandan keyin boshlanadi; bufer tugab qolsa (internet sekinlashsa) - jim turib qayta to'playdi;
bufer 1.5 s dan oshib ketsa - eski qismi tashlanadi (kechikish o'sib ketmasligi uchun).
stdin yopilsa - qolganini chalib, chiqadi.

Ishga tushirish: python live_stream.py [ovoz_balandligi_foiz]
"""

import sys
import threading

import numpy as np
import sounddevice as sd

RATE = 16000
BLOCK = 320                       # 20 ms
START_SAMPLES = int(RATE * 0.30)  # chalishni boshlashdan oldin shuncha to'planadi
MAX_SAMPLES = int(RATE * 1.5)     # bundan ko'p yig'ilsa - eskisi tashlanadi

buf = np.zeros(0, dtype=np.int16)
lock = threading.Lock()
playing = False
eof = threading.Event()
done = threading.Event()


def reader():
    global buf
    pending = b""
    stdin = sys.stdin.buffer
    while True:
        chunk = stdin.read1(65536) if hasattr(stdin, "read1") else stdin.read(6400)
        if not chunk:
            break
        pending += chunk
        usable = len(pending) - (len(pending) % 2)
        if not usable:
            continue
        samples = np.frombuffer(pending[:usable], dtype="<i2")
        pending = pending[usable:]
        with lock:
            buf = np.concatenate((buf, samples))
            if len(buf) > MAX_SAMPLES:
                buf = buf[-START_SAMPLES:]
    eof.set()


def main():
    volume = 100
    if len(sys.argv) > 1:
        try:
            volume = max(1, min(100, int(sys.argv[1])))
        except ValueError:
            pass
    gain = volume / 100.0 / 32768.0

    def callback(outdata, frames, time_info, status):
        global buf, playing
        with lock:
            if not playing and (len(buf) >= START_SAMPLES or (eof.is_set() and len(buf))):
                playing = True
            if playing and len(buf):
                n = min(frames, len(buf))
                outdata[:n, 0] = buf[:n].astype(np.float32) * gain
                outdata[n:, 0] = 0
                buf = buf[n:]
                if not len(buf):
                    playing = False   # bufer tugadi - qayta to'playmiz
            else:
                outdata[:, 0] = 0
            if eof.is_set() and not len(buf):
                done.set()

    threading.Thread(target=reader, daemon=True).start()
    print("Jonli efir boshlandi.", flush=True)
    try:
        with sd.OutputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=BLOCK, callback=callback):
            while not done.wait(0.2):
                pass
            sd.sleep(150)
    except Exception as e:
        print(f"XATOLIK: {e}", file=sys.stderr, flush=True)
        sys.exit(1)
    print("Jonli efir tugadi.", flush=True)


if __name__ == "__main__":
    main()
