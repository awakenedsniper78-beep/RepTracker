"""Generate RepTracker PNG icons with no dependencies (pure-Python PNG writer).

Design: solid blue square with three ascending rounded bars in light blue,
pale blue and white. Run: python tools/make_icons.py

Also writes desktop/assets/icon.ico for the Windows app: the same design on a
rounded square with transparent corners, at every size Windows asks for.
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

# Windows icon: the whole tile is a rounded square with this corner radius.
TILE = (0.0, 0.0, 1.0, 1.0)
TILE_RADIUS = 0.2
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def in_round_rect(x, y, r, radius=RADIUS):
    x0, y0, x1, y1 = r[:4]
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + radius), x1 - radius)
    cy = min(max(y, y0 + radius), y1 - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def render_pixels(size, rounded=False):
    """Rows of (r, g, b, a) tuples. With `rounded`, corners outside the tile are transparent."""
    ss = 4 if rounded and size < 64 else SS  # a little more smoothing for the tiny Windows sizes
    n = ss * ss
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0]
            hits = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if rounded and not in_round_rect(x, y, TILE, TILE_RADIUS):
                        continue
                    color = BG
                    for bar in BARS:
                        if in_round_rect(x, y, bar):
                            color = bar[4]
                            break
                    acc[0] += color[0]; acc[1] += color[1]; acc[2] += color[2]
                    hits += 1
            if hits:
                row.append((round(acc[0] / hits), round(acc[1] / hits), round(acc[2] / hits), round(255 * hits / n)))
            else:
                row.append((0, 0, 0, 0))
        rows.append(row)
    return rows


def png(size, rounded=False):
    pixels = render_pixels(size, rounded)
    channels = 4 if rounded else 3
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p[:channels]) for row in pixels)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6 if rounded else 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def render(size):
    return png(size)


def dib(size):
    """A 32-bit BMP icon image (BITMAPINFOHEADER, bottom-up BGRA, then the 1-bit AND mask)."""
    pixels = render_pixels(size, rounded=True)
    mask_stride = (size + 31) // 32 * 4
    xor = b"".join(bytes(c for (r, g, b, a) in row for c in (b, g, r, a)) for row in reversed(pixels))
    mask = bytearray()
    for row in reversed(pixels):
        bits = bytearray(mask_stride)
        for x, p in enumerate(row):
            if p[3] == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        mask += bits
    header = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(xor) + len(mask), 0, 0, 0, 0)
    return header + xor + bytes(mask)


def ico(sizes):
    # BMP images for the small sizes (what every Windows version reads), PNG for 256.
    images = [png(s, rounded=True) if s >= 256 else dib(s) for s in sizes]
    out = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    for s, data in zip(sizes, images):
        out += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return out + b"".join(images)


if __name__ == "__main__":
    root = os.path.join(os.path.dirname(__file__), "..")
    out = os.path.join(root, "icons")
    # File names carry a version so iOS can't reuse a stale cached icon.
    for name, size in [("icon-192-v3.png", 192), ("icon-512-v3.png", 512),
                       ("icon-1024-v3.png", 1024), ("apple-touch-icon-v3.png", 180),
                       ("apple-touch-icon-167-v3.png", 167), ("apple-touch-icon-152-v3.png", 152),
                       ("favicon-32-v3.png", 32)]:
        with open(os.path.join(out, name), "wb") as f:
            f.write(render(size))
        print("wrote", name)

    assets = os.path.join(root, "desktop", "assets")
    os.makedirs(assets, exist_ok=True)
    with open(os.path.join(assets, "icon.ico"), "wb") as f:
        f.write(ico(ICO_SIZES))
    print("wrote desktop/assets/icon.ico")
