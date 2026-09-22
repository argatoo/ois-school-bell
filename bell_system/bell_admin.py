#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bell_admin.py
Qo'ng'iroq jadvalini boshqarish uchun oddiy buyruq qatori (CLI) vositasi.

Bu - kelajakda quriladigan web panel/Telegram tugmasining o'rnini
vaqtincha bosib turadi: shu orqali "bugun qisqartirilgan kun" kabi
o'zgarishlarni kiritish mumkin. bell_scheduler.py ishlab turgan
bo'lsa ham, bu yerda kiritilgan o'zgarish avtomatik ko'rinadi -
qayta ishga tushirish shart emas.

Buyruqlar:
    python bell_admin.py holat
        - Bugungi kun turi va qolgan signallar ro'yxatini ko'rsatadi

    python bell_admin.py turlar
        - Mavjud barcha kun turlarini (day_type) ro'yxatlaydi

    python bell_admin.py belgila <SANA> <KUN_TURI>
        - Ma'lum bir sanaga kun turini belgilaydi (date_override sifatida)
        - SANA formati: YYYY-MM-DD (masalan 2026-09-25)
        - Misol: python bell_admin.py belgila 2026-09-25 qisqartirilgan

    python bell_admin.py bekor <SANA>
        - Shu sanaga qo'yilgan override'ni bekor qiladi (oddiy haftalik
          jadvalga qaytaradi)

    python bell_admin.py hafta <HAFTA_KUNI> <KUN_TURI>
        - Doimiy haftalik jadvalni o'zgartiradi
        - HAFTA_KUNI: monday, tuesday, wednesday, thursday, friday,
          saturday, sunday
        - Misol: python bell_admin.py hafta sunday oddiy
"""

import json
import os
import sys
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "schedule.json")

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAY_UZ = {
    "monday": "Dushanba", "tuesday": "Seshanba", "wednesday": "Chorshanba",
    "thursday": "Payshanba", "friday": "Juma", "saturday": "Shanba", "sunday": "Yakshanba",
}


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
        f.write("\n")
    # bell_scheduler.py fayl o'zgarish vaqtini (mtime) tekshirib turadi,
    # shuning uchun yozish bilanoq o'zgarish avtomatik qo'llanadi.


def cmd_turlar(config):
    print("Mavjud kun turlari (day_type):")
    for name, events in config.get("day_types", {}).items():
        print(f"  - {name}  ({len(events)} ta signal)")


def cmd_holat(config):
    today = datetime.now().date()
    date_str = today.strftime("%Y-%m-%d")
    weekday_name = WEEKDAY_NAMES[today.weekday()]

    overrides = config.get("date_overrides", {})
    if date_str in overrides:
        day_type = overrides[date_str]
        source = "maxsus belgilangan (date_override)"
    else:
        day_type = config.get("week_schedule", {}).get(weekday_name)
        source = "haftalik jadval bo'yicha"

    print(f"Bugun: {date_str} ({WEEKDAY_UZ.get(weekday_name, weekday_name)})")
    if not day_type:
        print(f"Kun turi: belgilanmagan - bugun qo'ng'iroq CHALINMAYDI ({source})")
        return

    print(f"Kun turi: {day_type}  [{source}]")
    events = config.get("day_types", {}).get(day_type, [])
    if not events:
        print("Bu kun turi uchun signal jadvali topilmadi.")
        return
    print("Bugungi signallar:")
    for e in events:
        print(f"  {e.get('time')}  -  {e.get('label')}  ({e.get('sound')})")


def cmd_belgila(config, date_str, day_type):
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        print(f"XATO: sana formati noto'g'ri. YYYY-MM-DD formatida yozing (masalan 2026-09-25). Siz: {date_str}")
        return config, False

    if day_type not in config.get("day_types", {}):
        print(f"XATO: '{day_type}' nomli kun turi topilmadi. Mavjudlari:")
        cmd_turlar(config)
        return config, False

    config.setdefault("date_overrides", {})[date_str] = day_type
    print(f"OK: {date_str} sanasi endi '{day_type}' kun turi bo'yicha ishlaydi.")
    return config, True


def cmd_bekor(config, date_str):
    overrides = config.get("date_overrides", {})
    if date_str in overrides:
        del overrides[date_str]
        print(f"OK: {date_str} uchun maxsus belgilash bekor qilindi. Endi haftalik jadval bo'yicha ishlaydi.")
        return config, True
    else:
        print(f"'{date_str}' uchun maxsus belgilash topilmadi (o'zgartirish shart emas).")
        return config, False


def cmd_hafta(config, weekday_name, day_type):
    weekday_name = weekday_name.lower()
    if weekday_name not in WEEKDAY_NAMES:
        print(f"XATO: '{weekday_name}' hafta kuni emas. Quyidagilardan birini yozing: {', '.join(WEEKDAY_NAMES)}")
        return config, False

    if day_type.lower() != "bosh" and day_type not in config.get("day_types", {}):
        print(f"XATO: '{day_type}' nomli kun turi topilmadi. Mavjudlari:")
        cmd_turlar(config)
        return config, False

    value = None if day_type.lower() == "bosh" else day_type
    config.setdefault("week_schedule", {})[weekday_name] = value
    uz = WEEKDAY_UZ.get(weekday_name, weekday_name)
    if value is None:
        print(f"OK: {uz} kuni endi qo'ng'iroq chalinmaydigan kun sifatida belgilandi.")
    else:
        print(f"OK: {uz} kuni endi doimiy '{value}' kun turi bo'yicha ishlaydi.")
    return config, True


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return

    config = load_config()
    command = args[0]
    changed = False

    if command == "holat":
        cmd_holat(config)
    elif command == "turlar":
        cmd_turlar(config)
    elif command == "belgila":
        if len(args) != 3:
            print("Foydalanish: python bell_admin.py belgila <SANA:YYYY-MM-DD> <KUN_TURI>")
            return
        config, changed = cmd_belgila(config, args[1], args[2])
    elif command == "bekor":
        if len(args) != 2:
            print("Foydalanish: python bell_admin.py bekor <SANA:YYYY-MM-DD>")
            return
        config, changed = cmd_bekor(config, args[1])
    elif command == "hafta":
        if len(args) != 3:
            print("Foydalanish: python bell_admin.py hafta <HAFTA_KUNI> <KUN_TURI|bosh>")
            return
        config, changed = cmd_hafta(config, args[1], args[2])
    else:
        print(f"Noma'lum buyruq: {command}\n")
        print(__doc__)
        return

    if changed:
        save_config(config)


if __name__ == "__main__":
    main()
