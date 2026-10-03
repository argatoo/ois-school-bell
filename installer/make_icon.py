"""make_icon.py - panel logotipiga mos (to'q sariq fon + oq qo'ng'iroq) installer/files/bell.ico yasaydi."""
import math
import pathlib
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent / "files" / "bell.ico"
S = 1024            # katta o'lchamda chizib, keyin kichraytiramiz (silliq chiziqlar uchun)
U = S / 24 * 0.62   # 24 birlikli SVG koordinatalarini piksellarga
OFF = (S - 24 * U) / 2


def p(x, y):
    return (OFF + x * U, OFF + y * U)


def cubic(a, b, c, d, n=40):
    return [(
        (1-t)**3*a[0] + 3*(1-t)**2*t*b[0] + 3*(1-t)*t**2*c[0] + t**3*d[0],
        (1-t)**3*a[1] + 3*(1-t)**2*t*b[1] + 3*(1-t)*t**2*c[1] + t**3*d[1],
    ) for t in (i / n for i in range(n + 1))]


def arc(cx, cy, r, a0, a1, n=60):
    return [(cx + r*math.cos(math.radians(a0 + (a1-a0)*i/n)), cy + r*math.sin(math.radians(a0 + (a1-a0)*i/n))) for i in range(n + 1)]


# Fon: 155 gradusli gradient (#e3a458 -> #8a4c13), yumaloq burchakli kvadrat
grad = Image.new("RGB", (S, S))
c0, c1 = (0xe3, 0xa4, 0x58), (0x8a, 0x4c, 0x13)
dx, dy = math.sin(math.radians(155)), -math.cos(math.radians(155))
px = grad.load()
for y in range(S):
    for x in range(S):
        t = min(1, max(0, ((x - S/2) * dx + (y - S/2) * dy) / (S * 0.75) + 0.5))
        px[x, y] = tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S-1, S-1), radius=int(S*0.24), fill=255)
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

# Qo'ng'iroq (paneldagi SVG: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" + "M13.73 21a2 2 0 0 1-3.46 0")
body = arc(12, 8, 6, 0, -180)                       # tepa gumbaz (18,8) -> (6,8)
body += cubic((6, 8), (6, 15), (3, 17), (3, 17))    # chap yon
body += [(21, 17)]                                  # past chiziq
body += cubic((21, 17), (21, 17), (18, 15), (18, 8))  # o'ng yon
clapper = arc(12, 20, 2, 30, 150)                   # pastdagi til
d = ImageDraw.Draw(img)
r = 2.2 * U / 2


def stroke(points):
    # Chiziq bo'ylab har ~1.5 pikselda yumaloq "cho'tka" bosamiz - chetlari silliq chiqadi
    pts = [p(*q) for q in points]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        steps = max(1, int(math.hypot(x1 - x0, y1 - y0) / 1.5))
        for i in range(steps + 1):
            x, y = x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps
            d.ellipse((x - r, y - r, x + r, y + r), fill="white")


stroke(body)
stroke(clapper)

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((256, 256), Image.LANCZOS).save(OUT.with_suffix(".png"))
print("Tayyor:", OUT)
