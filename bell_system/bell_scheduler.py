#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bell_scheduler.py
Maktab qo'ng'iroq tizimi - jadval asosida avtomatik ishlaydigan asosiy dastur.

Bu dastur SIP / jonli e'lon tizimidan BUTUNLAY ALOHIDA ishlaydi.
Faqat config/schedule.json faylini o'qiydi va shu jadval bo'yicha
belgilangan vaqtda belgilangan ovoz faylini chaladi.

Ishga tushirish:
    python bell_scheduler.py

To'xtatish: Ctrl+C

Config faylini o'zgartirsangiz (masalan bell_admin.py orqali), dastur
uni har daqiqada avtomatik qayta o'qiydi - qayta ishga tushirish shart emas.
"""

import json
import os
import sys
import time
import platform
import subprocess
import csv
from datetime import datetime, date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "schedule.json")
AUDIO_DIR = os.path.join(BASE_DIR, "audios")
LOG_PATH = os.path.join(BASE_DIR, "logs", "bell_log.csv")

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def log(message, to_console=True):
    """Har bir voqeani logs/bell_log.csv fayliga va konsolga yozadi."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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


def get_today_day_type(config, today: date):
    """
    Bugungi kun uchun qaysi day_type ishlatilishini aniqlaydi.
    Avval date_overrides tekshiriladi, keyin week_schedule.
    """
    date_str = today.strftime("%Y-%m-%d")
    overrides = config.get("date_overrides", {})
    if date_str in overrides:
        return overrides[date_str]

    weekday_name = WEEKDAY_NAMES[today.weekday()]
    week_schedule = config.get("week_schedule", {})
    return week_schedule.get(weekday_name)


def play_sound(filename):
    """
    Ovoz faylini operatsion tizimga qarab chaladi.
    Windows, macOS va Linux uchun mos usul tanlanadi.
    """
    filepath = os.path.join(AUDIO_DIR, filename)
    if not os.path.isfile(filepath):
        log(f"OGOHLANTIRISH: ovoz fayli topilmadi: {filepath}")
        return False

    system = platform.system()
    try:
        if system == "Windows":
            os.startfile(filepath)  # type: ignore[attr-defined]
        elif system == "Darwin":  # macOS
            subprocess.Popen(["afplay", filepath])
        else:  # Linux
            # Mavjud pleyerlardan birini sinab ko'radi
            players = [
                ["mpg123", filepath],
                ["mpg321", filepath],
                ["ffplay", "-nodisp", "-autoexit", filepath],
                ["aplay", filepath],
                ["paplay", filepath],
            ]
            played = False
            for cmd in players:
                try:
                    subprocess.Popen(
                        cmd,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    played = True
                    break
                except FileNotFoundError:
                    continue
            if not played:
                log("XATOLIK: hech qanday audio pleyer topilmadi "
                    "(mpg123/ffplay/aplay/paplay o'rnatilmagan)")
                return False
        return True
    except Exception as e:
        log(f"XATOLIK: ovoz chalishda muammo ({filename}): {e}")
        return False


def main():
    log("Bell scheduler ishga tushdi.")
    last_config_mtime = None
    config = None
    last_fired_key = None  # (sana, vaqt) - bir xil signalni ikki marta chalmaslik uchun

    while True:
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
            day_type = get_today_day_type(config, today)

            if day_type:
                day_events = config.get("day_types", {}).get(day_type, [])
                for event in day_events:
                    if event.get("time") == current_time_str:
                        fire_key = (today.isoformat(), current_time_str, event.get("sound"))
                        if fire_key != last_fired_key:
                            label = event.get("label", "")
                            sound = event.get("sound", "")
                            ok = play_sound(sound)
                            status = "chalindi" if ok else "XATO - chalinmadi"
                            log(f"Signal: {label} ({current_time_str}, kun turi: {day_type}) - {status}")
                            last_fired_key = fire_key

        time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Bell scheduler to'xtatildi (Ctrl+C).")
        sys.exit(0)
