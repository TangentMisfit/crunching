"""Generate docs/icons/icon-192.png and icon-512.png: a "C" monogram on a dark background.
Pure Python stdlib (no Pillow). Run from the repo root: python tools/make_icons.py
"""
import math
import os
import struct
import zlib

BG = (0x0B, 0x0D, 0x10)
FG = (0x4C, 0xC2, 0xFF)


def render(size, ss=4):
    rows = []
    c = size / 2
    r_out, r_in = size * 0.30, size * 0.20  # inside the maskable safe zone (40% radius)
    gap = math.radians(42)  # opening of the C on the right side
    for y in range(size):
        row = bytearray([0])  # filter type 0
        for x in range(size):
            cov = 0
            for sy in range(ss):
                for sx in range(ss):
                    px = x + (sx + 0.5) / ss - c
                    py = y + (sy + 0.5) / ss - c
                    d = math.hypot(px, py)
                    ang = abs(math.atan2(py, px))
                    if r_in <= d <= r_out and ang >= gap:
                        cov += 1
                    elif ang < gap:
                        # rounded stroke ends
                        for sign in (1, -1):
                            ex = math.cos(gap) * (r_in + r_out) / 2
                            ey = sign * math.sin(gap) * (r_in + r_out) / 2
                            if math.hypot(px - ex, py - ey) <= (r_out - r_in) / 2:
                                cov += 1
                                break
            a = cov / (ss * ss)
            row += bytes(round(BG[i] + (FG[i] - BG[i]) * a) for i in range(3))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t, data):
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "icons")
    os.makedirs(out, exist_ok=True)
    for s in (192, 512):
        with open(os.path.join(out, f"icon-{s}.png"), "wb") as f:
            f.write(render(s))
        print(f"icon-{s}.png")
