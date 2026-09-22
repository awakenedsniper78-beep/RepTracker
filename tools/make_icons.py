"""Generate RepTracker PNG icons with no dependencies (pure-Python PNG writer).

Run: python tools/make_icons.py
"""
import os
import struct
import zlib

BG_TOP = (30, 41, 59)      # slate-800
BG_BOT = (15, 23, 42)      # slate-900
ACCENT = (249, 115, 22)    # orange-500
ACCENT2 = (251, 191, 36)   # amber-400

# Three ascending rounded bars, in unit coordinates (0..1), kept inside the
# maskable-icon safe zone (central 80%).
BARS = [
    (0.25, 0.58, 0.37, 0.74),
    (0.44, 0.44, 0.56, 0.74),
    (0.63, 0.28, 0.75, 0.74),
]
RADIUS = 0.035
SS = 3  # supersampling per axis


def in_round_rect(x, y, r):
    x0, y0, x1, y1 = r
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + RADIUS), x1 - RADIUS)
    cy = min(max(y, y0 + RADIUS), y1 - RADIUS)
    return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter type 0
        bg = lerp(BG_TOP, BG_BOT, py / (size - 1))
        for px in range(size):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    if any(in_round_rect(x, y, b) for b in BARS):
                        hits += 1
            cov = hits / (SS * SS)
            fg = lerp(ACCENT2, ACCENT, py / (size - 1))
            row += bytes(lerp(bg, fg, cov))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "icons")
    # File names carry a version so iOS can't reuse a stale cached icon.
    for name, size in [("icon-192-v2.png", 192), ("icon-512-v2.png", 512),
                       ("icon-1024-v2.png", 1024), ("apple-touch-icon-v2.png", 180),
                       ("apple-touch-icon-167-v2.png", 167), ("apple-touch-icon-152-v2.png", 152),
                       ("favicon-32.png", 32)]:
        with open(os.path.join(out, name), "wb") as f:
            f.write(render(size))
        print("wrote", name)
