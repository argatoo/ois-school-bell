"""
stage_runtime.py - o'rnatuvchi (setup.exe) ichiga kiradigan ish muhitini yig'adi:
  installer/build/runtime/python/  - Python 3.14 embeddable + jonli e'lon paketlari
  installer/build/runtime/node/    - node.exe (web panel serveri uchun)

Paketlar internetdan emas, SHU kompyuterdagi Python'dan (pip o'rnatgan fayllar ro'yxati
bo'yicha) aynan nusxalanadi. Qayta ishga tushirish xavfsiz - har safar noldan yig'adi.

Ishga tushirish:  python installer/stage_runtime.py
"""
import importlib.metadata as md
import pathlib
import shutil
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"
EMBED_ZIP = BUILD / "downloads" / "python-3.14.0-embed-amd64.zip"
PY_DIR = BUILD / "runtime" / "python"
NODE_DIR = BUILD / "runtime" / "node"
SITE = PY_DIR / "Lib" / "site-packages"
PACKAGES = ["sounddevice", "numpy", "cffi", "pycparser"]


def main():
    if sys.version_info[:2] != (3, 14):
        sys.exit("Bu skriptni Python 3.14 bilan ishga tushiring (paketlar embeddable versiyaga mos bo'lishi kerak).")
    if not EMBED_ZIP.exists():
        sys.exit(f"Topilmadi: {EMBED_ZIP}")

    shutil.rmtree(BUILD / "runtime", ignore_errors=True)
    PY_DIR.mkdir(parents=True)
    with zipfile.ZipFile(EMBED_ZIP) as z:
        z.extractall(PY_DIR)

    # Embeddable Python faqat ._pth faylida yozilgan yo'llarni ko'radi - site-packages ni qo'shamiz
    pth = next(PY_DIR.glob("python3*._pth"))
    lines = pth.read_text(encoding="utf-8").splitlines()
    if "Lib\\site-packages" not in lines:
        lines.insert(1, "Lib\\site-packages")
    pth.write_text("\n".join(lines) + "\n", encoding="utf-8")

    SITE.mkdir(parents=True)
    for name in PACKAGES:
        dist = md.distribution(name)
        root = pathlib.Path(dist.locate_file(""))
        count = 0
        for f in dist.files or []:
            src = pathlib.Path(dist.locate_file(f))
            parts = pathlib.PurePath(f).parts
            # pip skriptlari (..\Scripts\...) va kesh fayllari kerak emas
            if parts and parts[0] == ".." or "__pycache__" in parts or not src.is_file():
                continue
            dst = SITE / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            count += 1
        print(f"{name} {dist.version}: {count} ta fayl ({root})")

    node = shutil.which("node")
    if not node:
        sys.exit("node.exe topilmadi")
    NODE_DIR.mkdir(parents=True)
    shutil.copy2(node, NODE_DIR / "node.exe")
    print(f"node.exe: {node}")
    print("Tayyor:", BUILD / "runtime")


if __name__ == "__main__":
    main()
