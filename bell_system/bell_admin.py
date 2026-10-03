#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bell_admin.py
Qo'ng'iroq jadvalini boshqarish uchun oddiy buyruq qatori (CLI) vositasi.
Web paneldagi bilan bir xil config/schedule.json faylini o'zgartiradi.
bell_scheduler.py ishlab turgan bo'lsa ham, o'zgarish avtomatik ko'rinadi.

Buyruqlar:
    python bell_admin.py royxat
        - Barcha qo'ng'iroqlarni ko'rsatadi

    python bell_admin.py qosh <VAQT> <KUNLAR> <OVOZ> [NOM] [--marta N] [--hafta N]
        - Yangi qo'ng'iroq qo'shadi
        - VAQT:   HH:MM (masalan 08:25)
        - KUNLAR: hammasi | ish (dush-juma) | vergul bilan: dush,sesh,chor,pay,jum,shan,yak
        - OVOZ:   audios/ papkasidagi fayl nomi
        - --marta N: ovoz necha marta ketma-ket chalinadi (standart 1)
        - --hafta N: necha hafta takrorlanadi (berilmasa doimiy)
        - Misol: python bell_admin.py qosh 08:25 ish dars.mp3 "1-dars" --marta 2 --hafta 4

    python bell_admin.py ochir <ID>
        - ID bo'yicha qo'ng'iroqni o'chiradi (ID 'royxat' da ko'rinadi)
"""

import argparse
import json
import os
import re
import secrets
import sys
from datetime import date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "schedule.json")

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAY_SHORT_UZ = ["Dush", "Sesh", "Chor", "Pay", "Jum", "Shan", "Yak"]
DAY_ALIASES = {
    "dush": "monday", "sesh": "tuesday", "chor": "wednesday", "pay": "thursday",
    "jum": "friday", "shan": "saturday", "yak": "sunday",
}
TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
        f.write("\n")


def parse_days(text):
    text = text.strip().lower()
    if text == "hammasi":
        return list(WEEKDAY_NAMES)
    if text == "ish":
        return WEEKDAY_NAMES[:5]
    days = []
    for part in text.split(","):
        part = part.strip()
        key = DAY_ALIASES.get(part) or DAY_ALIASES.get(part[:3]) or DAY_ALIASES.get(part[:4]) or part
        if key not in WEEKDAY_NAMES:
            raise ValueError(f"noma'lum hafta kuni: '{part}'")
        if key not in days:
            days.append(key)
    if not days:
        raise ValueError("kamida bitta hafta kuni kerak")
    return sorted(days, key=WEEKDAY_NAMES.index)


def cmd_royxat(config):
    bells = sorted(config.get("bells", []), key=lambda b: b.get("time", ""))
    if not bells:
        print("Hali qo'ng'iroq qo'shilmagan.")
        return
    for b in bells:
        days = ",".join(WEEKDAY_SHORT_UZ[WEEKDAY_NAMES.index(d)] for d in b.get("days", []) if d in WEEKDAY_NAMES)
        weeks = f"{b['weeks']} hafta ({b.get('start_date')} dan)" if b.get("weeks") else "doimiy"
        print(f"{b.get('id')}  {b.get('time')}  {b.get('label')}  [{days}]  "
              f"{b.get('rings', 1)} marta  {weeks}  ({b.get('sound')})")


def cmd_qosh(config, args):
    if not TIME_RE.match(args.vaqt):
        print("XATO: vaqt HH:MM formatida bo'lishi kerak (masalan 08:25).")
        return False
    try:
        days = parse_days(args.kunlar)
    except ValueError as e:
        print(f"XATO: {e}")
        return False
    if args.marta < 1:
        print("XATO: --marta kamida 1 bo'lishi kerak.")
        return False
    if args.hafta is not None and args.hafta < 1:
        print("XATO: --hafta kamida 1 bo'lishi kerak.")
        return False
    bell = {
        "id": secrets.token_hex(4),
        "time": args.vaqt,
        "label": args.nom or "Qo'ng'iroq",
        "sound": args.ovoz,
        "days": days,
        "rings": args.marta,
        "weeks": args.hafta,
        "start_date": date.today().isoformat(),
    }
    config.setdefault("bells", []).append(bell)
    config["bells"].sort(key=lambda b: b.get("time", ""))
    print(f"OK: qo'ng'iroq qo'shildi (ID: {bell['id']}).")
    return True


def cmd_ochir(config, bell_id):
    bells = config.get("bells", [])
    remaining = [b for b in bells if b.get("id") != bell_id]
    if len(remaining) == len(bells):
        print(f"XATO: '{bell_id}' ID li qo'ng'iroq topilmadi.")
        return False
    config["bells"] = remaining
    print("OK: qo'ng'iroq o'chirildi.")
    return True


def main():
    parser = argparse.ArgumentParser(description="OIS School Bell - jadval boshqaruvi")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("royxat")
    p = sub.add_parser("qosh")
    p.add_argument("vaqt")
    p.add_argument("kunlar")
    p.add_argument("ovoz")
    p.add_argument("nom", nargs="?", default="")
    p.add_argument("--marta", type=int, default=1)
    p.add_argument("--hafta", type=int, default=None)
    p = sub.add_parser("ochir")
    p.add_argument("id")
    args = parser.parse_args()

    if not args.command:
        print(__doc__)
        return

    config = load_config()
    changed = False
    if args.command == "royxat":
        cmd_royxat(config)
    elif args.command == "qosh":
        changed = cmd_qosh(config, args)
    elif args.command == "ochir":
        changed = cmd_ochir(config, args.id)
    if changed:
        save_config(config)


if __name__ == "__main__":
    main()
