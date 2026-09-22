#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_announce.py
Mikrofondan kelayotgan ovozni real vaqtda tizim audio chiqishiga (speakerlarga)
o'zgarishsiz uzatib turadi - "jonli e'lon" rejimi.

bell_scheduler.py dan alohida, faqat shu jarayon ishlab turgan vaqtda ishlaydi.
bell_web/server.js buni tugma bosilganda ishga tushiradi va to'xtatadi.

Ishga tushirish: python live_announce.py
To'xtatish: Ctrl+C (yoki jarayonni tashqaridan to'xtatish - server.js shunday qiladi)
"""

import sys
import sounddevice as sd

SAMPLE_RATE = 44100
BLOCK_SIZE = 1024
CHANNELS = 1


def callback(indata, outdata, frames, time_info, status):
    if status:
        print(f"OGOHLANTIRISH: {status}", file=sys.stderr, flush=True)
    outdata[:] = indata


def main():
    print("Jonli e'lon boshlandi - mikrofon speakerlarga ulandi.", flush=True)
    try:
        with sd.Stream(
            samplerate=SAMPLE_RATE,
            blocksize=BLOCK_SIZE,
            channels=CHANNELS,
            dtype="float32",
            callback=callback,
        ):
            while True:
                sd.sleep(200)
    except KeyboardInterrupt:
        print("Jonli e'lon to'xtatildi.", flush=True)
    except Exception as e:
        print(f"XATOLIK: {e}", file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
