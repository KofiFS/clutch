"""Turn a square logo with a solid black background into app icons with real transparency.

Usage: python scripts/import-icon.py <source image> [resources dir]

Inside the rounded tile everything is kept as-is (the tile's own dark navy stays opaque).
Outside the tile, black becomes transparent and the blue glow fades out using its brightness,
so the icon looks right on light and dark taskbars.
Writes icon.png (512), icon-256.png, icon-32.png, icon.ico (16-256) and the renderer copy.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

src = Path(sys.argv[1])
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'resources')
out.mkdir(parents=True, exist_ok=True)

im = Image.open(src).convert('RGB')
w, h = im.size
px = im.load()


def edge(points):
    """First index along a scan line where the tile's blue rim starts."""
    for i, p in points:
        if p[2] > 60:
            return i
    return None


mid_y, mid_x = h // 2, w // 2
left = edge((x, px[x, mid_y]) for x in range(w))
right = edge((x, px[x, mid_y]) for x in range(w - 1, -1, -1))
top = edge((y, px[mid_x, y]) for y in range(h))
bottom = edge((y, px[mid_x, y]) for y in range(h - 1, -1, -1))
print('tile edges', left, top, right, bottom)

# Rounded-rect mask for the tile, supersampled for smooth corners.
radius = int((right - left) * 0.17)
ss = 4
mask = Image.new('L', (w * ss, h * ss), 0)
ImageDraw.Draw(mask).rounded_rectangle([(left - 2) * ss, (top - 2) * ss, (right + 2) * ss, (bottom + 2) * ss], radius=radius * ss, fill=255)
mask = mask.resize((w, h), Image.LANCZOS)

# Glow alpha outside the tile from brightness (the glow is blue, so weigh the blue channel too).
bright = im.convert('L').point(lambda v: min(255, v * 4))
blue = im.getchannel('B').point(lambda v: min(255, v * 3))
glow_alpha = ImageChops.lighter(bright, blue)
# Inside the tile: fully opaque. Outside: glow alpha.
alpha = ImageChops.lighter(mask, glow_alpha)

rgba = im.copy()
rgba.putalpha(alpha)

# Un-premultiply the glow so edges don't look dark/dirty on light backgrounds.
data = rgba.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = data[x, y]
        if 0 < a < 255:
            k = 255 / a
            data[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), a)

# Trim to content with a little padding, keep it square.
bbox = rgba.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
x0, y0, x1, y1 = bbox
size = max(x1 - x0, y1 - y0) + 16
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
square = Image.new('RGBA', (size, size), (0, 0, 0, 0))
square.paste(rgba.crop((cx - size // 2, cy - size // 2, cx + size - size // 2, cy + size - size // 2)), (0, 0))

master = square.resize((512, 512), Image.LANCZOS)
master.save(out / 'icon.png')
master.resize((256, 256), Image.LANCZOS).save(out / 'icon-256.png')
# Small sizes get a touch of sharpening so the play triangle stays readable in the tray.
small = master.resize((32, 32), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
small.save(out / 'icon-32.png')
# Tray variant while recording: red dot with a dark ring in the bottom-right corner.
rec = small.copy()
d = ImageDraw.Draw(rec)
d.ellipse([18, 18, 31, 31], fill=(10, 12, 20, 255))
d.ellipse([20, 20, 29, 29], fill=(255, 59, 92, 255))
rec.save(out / 'icon-32-rec.png')
master.save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

renderer = Path('src/renderer/public')
if renderer.exists():
    master.resize((128, 128), Image.LANCZOS).save(renderer / 'icon.png')
print('wrote', ', '.join(p.name for p in out.iterdir() if p.name.startswith('icon')))
