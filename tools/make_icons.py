"""Generate RepTracker PNG icons with no dependencies (pure-Python PNG writer).

Design: solid blue square with three ascending rounded bars in light blue,
pale blue and white. Run: python tools/make_icons.py
"""
import os
import struct
import zlib

BG = (0, 102, 203)  # #0066CB

# (x0, y0, x1, y1, color) in unit coordinates, measured from the design.
# All inside the maskable-icon safe zone (circle of radius 0.4 around center).
BARS = [
    (0.2656, 0.5391, 0.3906, 0.7344, (152, 194, 234)),  # #98C2EA
    (0.4375, 0.4219, 0.5625, 0.7344, (203, 224, 245)),  # #CBE0F5
    (0.6094, 0.2847, 0.7344, 0.7344, (255, 255, 255)),
]
RADIUS = 0.028
SS = 3  # supersampling per axis


def in_round_rect(x, y, r):
    x0, y0, x1, y1 = r[:4]
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + RADIUS), x1 - RADIUS)
    cy = min(max(y, y0 + RADIUS), y1 - RADIUS)
    return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2


def render(size):
    rows = []
    n = SS * SS
    for py in range(size):
        row = bytearray([0])  # filter type 0
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    color = BG
                    for bar in BARS:
                        if in_round_rect(x, y, bar):
                            color = bar[4]
                            break
                    acc[0] += color[0]; acc[1] += color[1]; acc[2] += color[2]
            row += bytes(round(c / n) for c in acc)
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
    for name, size in [("icon-192-v3.png", 192), ("icon-512-v3.png", 512),
                       ("icon-1024-v3.png", 1024), ("apple-touch-icon-v3.png", 180),
                       ("apple-touch-icon-167-v3.png", 167), ("apple-touch-icon-152-v3.png", 152),
                       ("favicon-32-v3.png", 32)]:
        with open(os.path.join(out, name), "wb") as f:
            f.write(render(size))
        print("wrote", name)
