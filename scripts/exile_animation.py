"""Анимация «Теневой странник изгнан в Пустоту» → assets/morok/4-exile.mp4.
Запуск: python3 scripts/exile_animation.py assets/morok/4-exile.mp4 /tmp/exile-frames  (нужны Pillow, ffmpeg и шрифты DejaVu)."""
import math, os, random, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W = H = 720
FPS = 24
DUR = 6.5
OUT = sys.argv[1]
TMP = sys.argv[2]
os.makedirs(TMP, exist_ok=True)
random.seed(47)

BG = (18, 6, 28)
VIOLET = (157, 78, 221)
BORDO = (110, 16, 40)
GLOW = (214, 160, 255)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
FONT_S = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

def ease(t): return 0 if t <= 0 else 1 if t >= 1 else t * t * (3 - 2 * t)
def seg(t, a, b): return ease((t - a) / (b - a))

# ---- фон: виньетка + круг рун ----
def background():
    im = Image.new('RGB', (W, H), BG)
    g = Image.new('L', (W, H), 0)
    ImageDraw.Draw(g).ellipse((90, 120, 630, 660), fill=120)
    g = g.filter(ImageFilter.GaussianBlur(120))
    tint = Image.new('RGB', (W, H), (60, 14, 70))
    return Image.composite(tint, im, g)
BASE = background()

RUNES = '☽✦☿✧☉♃✶♀☾♂✦♄✧♆☉✶☿♃'
try:
    rune_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 26)
except OSError:
    rune_font = ImageFont.load_default()

def rune_ring(im, t, alpha):
    if alpha <= 0: return
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    cx, cy, r = W // 2, 400, 250
    dr.ellipse((cx - r - 18, cy - r - 18, cx + r + 18, cy + r + 18), outline=(*VIOLET, int(70 * alpha)), width=2)
    dr.ellipse((cx - r + 18, cy - r + 18, cx + r - 18, cy + r - 18), outline=(*VIOLET, int(50 * alpha)), width=1)
    n = len(RUNES)
    for i, ch in enumerate(RUNES):
        a = 2 * math.pi * i / n + t * 0.35
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        dr.text((x, y), ch, font=rune_font, fill=(*GLOW, int(150 * alpha)), anchor='mm')
    glow = layer.filter(ImageFilter.GaussianBlur(3))
    im.alpha_composite(glow); im.alpha_composite(layer)

# ---- силуэт странника (капюшон + плащ) ----
def wanderer_mask():
    m = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(m)
    cx = W // 2
    dr.polygon([(cx - 48, 300), (cx, 238), (cx + 48, 300), (cx + 58, 360), (cx - 58, 360)], fill=255)  # капюшон
    dr.ellipse((cx - 50, 250, cx + 50, 350), fill=255)
    dr.polygon([(cx - 58, 340), (cx + 58, 340), (cx + 120, 590), (cx + 70, 600), (cx, 585), (cx - 70, 600), (cx - 120, 590)], fill=255)  # плащ
    return m
MASK = wanderer_mask()
FACE = Image.new('L', (W, H), 0)
ImageDraw.Draw(FACE).ellipse((W // 2 - 30, 280, W // 2 + 30, 340), fill=255)
BBOX = MASK.getbbox()

def wanderer_layer(alpha):
    body = Image.new('RGBA', (W, H), (8, 2, 14, 0))
    body.putalpha(MASK.point(lambda v: int(v * alpha)))
    rim = MASK.filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(min(255, v * 0.9) * alpha))
    rim_l = Image.new('RGBA', (W, H), (*VIOLET, 0)); rim_l.putalpha(rim)
    face = Image.new('RGBA', (W, H), (0, 0, 0, 0)); face.putalpha(FACE.point(lambda v: int(v * alpha)))
    eyes = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    de = ImageDraw.Draw(eyes)
    for ex in (W // 2 - 13, W // 2 + 13):
        de.ellipse((ex - 4, 306, ex + 4, 312), fill=(*GLOW, int(255 * alpha)))
    eyes = Image.alpha_composite(eyes.filter(ImageFilter.GaussianBlur(3)), eyes)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for l in (rim_l, body, face, eyes): out.alpha_composite(l)
    return out

# ---- пиксели для растворения ----
CELL = 10
CELLS = []
x0, y0, x1, y1 = BBOX
for y in range(y0, y1, CELL):
    for x in range(x0, x1, CELL):
        if MASK.getpixel((min(x + CELL // 2, W - 1), min(y + CELL // 2, H - 1))) > 128:
            start = 2.55 + (y - y0) / (y1 - y0) * 0.9 + random.random() * 0.35
            vx, vy = random.uniform(-40, 120), random.uniform(-180, -60)
            col = random.choice([VIOLET, GLOW, (90, 30, 140), BORDO, (40, 10, 60)])
            CELLS.append((x, y, start, vx, vy, col))

def staff(im, t):
    """Посох Морока поднимается из правого нижнего угла."""
    p = seg(t, 1.1, 2.0)
    if p <= 0: return
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    bx, by = 690, 760 - 260 * p
    tx, ty = 600, 470 - 260 * p
    dr.line((bx, by + 200, tx, ty), fill=(30, 12, 26, 255), width=14)
    dr.line((bx, by + 200, tx, ty), fill=(*BORDO, 255), width=6)
    pulse = 1 + 0.15 * math.sin(t * 18)
    r = 18 * pulse
    orb = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(orb).ellipse((tx - r * 2.4, ty - r * 2.4, tx + r * 2.4, ty + r * 2.4), fill=(*VIOLET, 140))
    orb = orb.filter(ImageFilter.GaussianBlur(16))
    ImageDraw.Draw(orb).ellipse((tx - r, ty - r, tx + r, ty + r), fill=(*GLOW, 255))
    im.alpha_composite(layer); im.alpha_composite(orb)
    return tx, ty

def lightning(im, t, start):
    if not (2.1 <= t <= 2.7): return
    a = 1 - seg(t, 2.45, 2.7)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    rnd = random.Random(int(t * 40))
    for _ in range(2):
        pts = [start]
        tx, ty = W // 2 + 10, 400
        n = 9
        for i in range(1, n):
            f = i / n
            pts.append((start[0] + (tx - start[0]) * f + rnd.uniform(-22, 22), start[1] + (ty - start[1]) * f + rnd.uniform(-22, 22)))
        pts.append((tx, ty))
        dr.line(pts, fill=(*GLOW, int(255 * a)), width=4, joint='curve')
    glow = layer.filter(ImageFilter.GaussianBlur(8))
    im.alpha_composite(glow); im.alpha_composite(glow); im.alpha_composite(layer)

def title(im, t):
    p = seg(t, 4.3, 5.0)
    if p <= 0: return
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    f1 = ImageFont.truetype(FONT, 46)
    f2 = ImageFont.truetype(FONT_S, 22)
    yoff = (1 - p) * 20
    dr.text((W // 2, 300 + yoff), 'Теневой странник', font=f1, fill=(*GLOW, int(255 * p)), anchor='mm')
    dr.text((W // 2, 360 + yoff), 'изгнан в Пустоту!', font=f1, fill=(*GLOW, int(255 * p)), anchor='mm')
    dr.text((W // 2, 430 + yoff), 'МАГИЧЕСКИЙ ПРОТОКОЛ · ДЕЛО № 001', font=f2, fill=(200, 170, 230, int(200 * p)), anchor='mm')
    glow = layer.filter(ImageFilter.GaussianBlur(10))
    im.alpha_composite(glow); im.alpha_composite(layer)

def caption(im, t):
    """Метка сюжета внизу — чтобы никто не принял за системное уведомление."""
    f = ImageFont.truetype(FONT_S, 18)
    ImageDraw.Draw(im).text((W // 2, H - 28), '«Кристина строит миры» · сюжет', font=f, fill=(170, 140, 200, 170), anchor='mm')

frames = int(DUR * FPS)
for k in range(frames):
    t = k / FPS
    im = BASE.convert('RGBA')
    rune_ring(im, t, 0.35 + 0.65 * seg(t, 0, 1.0) - 0.5 * seg(t, 4.0, 5.0))
    # силуэт до растворения
    if t < 2.55:
        im.alpha_composite(wanderer_layer(seg(t, 0.1, 1.0)))
        if t < 1.6:
            f = ImageFont.truetype(FONT_S, 22)
            a = seg(t, 0.4, 0.9) * (1 - seg(t, 1.3, 1.6))
            ImageDraw.Draw(im).text((W // 2, 640), 'Теневой странник № 47', font=f, fill=(200, 170, 230, int(220 * a)), anchor='mm')
    else:
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(layer)
        for (x, y, st, vx, vy, col) in CELLS:
            if t < st:
                dr.rectangle((x, y, x + CELL - 1, y + CELL - 1), fill=(14, 4, 22, 255))
            else:
                dt = t - st
                a = max(0.0, 1 - dt / 1.1)
                if a <= 0: continue
                s = max(2, int(CELL * (1 - dt / 1.6)))
                px, py = x + vx * dt, y + vy * dt
                dr.rectangle((px, py, px + s, py + s), fill=(*col, int(255 * a)))
        im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(2))); im.alpha_composite(layer)
    orb = staff(im, t)
    if orb: lightning(im, t, orb)
    # вспышка
    fl = seg(t, 2.25, 2.4) * (1 - seg(t, 2.4, 2.9))
    if fl > 0:
        im.alpha_composite(Image.new('RGBA', (W, H), (190, 120, 255, int(200 * fl))))
    title(im, t)
    caption(im, t)
    im.convert('RGB').save(f'{TMP}/f{k:04d}.png')

subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{TMP}/f%04d.png',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', OUT], check=True)
print('ok', os.path.getsize(OUT))
