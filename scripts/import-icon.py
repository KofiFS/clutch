"""Turn a logo into app icons with real transparency.

Handles three kinds of source image automatically:
  - already transparent PNG: used as-is
  - logo on a white background: the white is removed, soft edges and glow are kept
  - rounded tile on solid black: the tile stays opaque, the black outside becomes transparent

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

raw = Image.open(src)
corners = [(0, 0), (raw.width - 1, 0), (0, raw.height - 1), (raw.width - 1, raw.height - 1)]


def from_transparent(img):
    """The logo already has real transparency: use it as-is."""
    return img.convert('RGBA')


def from_white(img):
    """Logo on a white background.

    Only light pixels connected to the image border count as background (the white page and the soft
    outer glow). White highlights *inside* the logo are enclosed by its coloured outline, so they stay
    solid instead of turning grey on dark backgrounds.
    """
    im = img.convert('RGB')
    w, h = im.size
    r, g, b = im.split()
    lightest = ImageChops.darker(ImageChops.darker(r, g), b)  # min(r, g, b) per pixel
    light = lightest.point(lambda v: 255 if v > 120 else 0)
    # Flood-fill the light region from every border pixel that is light.
    region = light.copy()
    for x in range(0, w, 8):
        for y in (0, h - 1):
            if region.getpixel((x, y)) == 255:
                ImageDraw.floodfill(region, (x, y), 128)
    for y in range(0, h, 8):
        for x in (0, w - 1):
            if region.getpixel((x, y)) == 255:
                ImageDraw.floodfill(region, (x, y), 128)
    outside = region.point(lambda v: 255 if v == 128 else 0)
    # Enclosed gaps (e.g. white space between swirls) are background too when they are large and
    # pure white; small specular highlights are below the size limit and stay solid.
    pure = lightest.point(lambda v: 255 if v > 248 else 0)
    pure = ImageChops.subtract(pure, outside)
    min_area = int(w * h * 0.001)
    for y in range(0, h, 6):
        for x in range(0, w, 6):
            if pure.getpixel((x, y)) != 255:
                continue
            ImageDraw.floodfill(pure, (x, y), 100)
            count = pure.histogram()[100]
            ImageDraw.floodfill(pure, (x, y), 50 if count >= min_area else 200)
    holes = pure.point(lambda v: 255 if v == 50 else 0)
    outside = ImageChops.lighter(outside, holes)
    # Soften the boundary by a pixel so edges stay anti-aliased.
    outside = outside.filter(ImageFilter.GaussianBlur(0.8))
    src_px, out_px, light_px = im.load(), outside.load(), lightest.load()
    rgba = Image.new('RGBA', (w, h))
    dst = rgba.load()
    for y in range(h):
        for x in range(w):
            o = out_px[x, y] / 255  # 1 = background side
            cr, cg, cb = src_px[x, y]
            if o <= 0:
                dst[x, y] = (cr, cg, cb, 255)
                continue
            # Background side: alpha from how far the pixel is from white, then un-mix the white.
            a_bg = 255 - light_px[x, y]
            a_bg = 0 if a_bg < 6 else min(255, int(a_bg * 1.08))
            a = int(round(a_bg * o + 255 * (1 - o)))
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            k = a / 255
            un = lambda c: max(0, min(255, int((c - 255 * (1 - k)) / k)))
            dst[x, y] = (un(cr), un(cg), un(cb), a)
    return rgba


def from_black_tile(img):
    """Rounded tile on solid black: keep the tile opaque, turn the black outside into transparency."""
    im = img.convert('RGB')
    w, h = im.size
    px = im.load()

    def edge(points):
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
    radius = int((right - left) * 0.17)
    ss = 4
    mask = Image.new('L', (w * ss, h * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle([(left - 2) * ss, (top - 2) * ss, (right + 2) * ss, (bottom + 2) * ss], radius=radius * ss, fill=255)
    mask = mask.resize((w, h), Image.LANCZOS)
    bright = im.convert('L').point(lambda v: min(255, v * 4))
    blue = im.getchannel('B').point(lambda v: min(255, v * 3))
    alpha = ImageChops.lighter(mask, ImageChops.lighter(bright, blue))
    rgba = im.copy()
    rgba.putalpha(alpha)
    data = rgba.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = data[x, y]
            if 0 < a < 255:
                k = 255 / a
                data[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), a)
    return rgba


if raw.mode in ('RGBA', 'LA', 'PA') and all(raw.convert('RGBA').getpixel(c)[3] < 16 for c in corners):
    mode, rgba = 'transparent', from_transparent(raw)
elif sum(sum(raw.convert('RGB').getpixel(c)) for c in corners) / (len(corners) * 3) > 200:
    mode, rgba = 'white background', from_white(raw)
else:
    mode, rgba = 'black tile', from_black_tile(raw)
print('source:', mode)

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
