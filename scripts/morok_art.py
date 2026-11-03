"""Три иллюстрации для «Дела четырёх блокировок» (1-sad-bot, 2-morok, 3-tribunal), нарисованные кодом.
Запуск: python3 scripts/morok_art.py assets/morok  (нужен Pillow). Нейросетевые картинки можно просто положить поверх под теми же именами."""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter

W = H = 1080
OUT = sys.argv[1]
VIOLET = (157, 78, 221); GLOW = (214, 160, 255); BORDO = (120, 18, 44); BG = (16, 5, 26)
random.seed(7)

def base():
    im = Image.new('RGB', (W, H), BG).convert('RGBA')
    g = Image.new('L', (W, H), 0)
    ImageDraw.Draw(g).ellipse((120, 160, 960, 1000), fill=150)
    g = g.filter(ImageFilter.GaussianBlur(170))
    im = Image.composite(Image.new('RGBA', (W, H), (70, 18, 84, 255)), im, g)
    d = ImageDraw.Draw(im)
    for _ in range(140):  # цифровые «пиксели» и искры
        x, y = random.randrange(W), random.randrange(H); s = random.choice([3, 4, 6])
        d.rectangle((x, y, x + s, y + s), fill=(*random.choice([VIOLET, GLOW, BORDO]), random.randrange(40, 150)))
    return im

def glow(im, draw_fn, blur=22, times=2):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_fn(ImageDraw.Draw(layer))
    soft = layer.filter(ImageFilter.GaussianBlur(blur))
    for _ in range(times): im.alpha_composite(soft)
    im.alpha_composite(layer)

def vignette(im):
    v = Image.new('L', (W, H), 0)
    ImageDraw.Draw(v).ellipse((-180, -180, W + 180, H + 180), fill=255)
    v = v.filter(ImageFilter.GaussianBlur(160))
    dark = Image.new('RGBA', (W, H), (6, 2, 12, 255))
    return Image.composite(im, dark, v)

def lightning(d, x0, y0, x1, y1, seed, width=6, col=GLOW):
    r = random.Random(seed); pts = [(x0, y0)]
    for i in range(1, 9):
        f = i / 9; pts.append((x0 + (x1 - x0) * f + r.uniform(-34, 34), y0 + (y1 - y0) * f + r.uniform(-34, 34)))
    pts.append((x1, y1)); d.line(pts, fill=(*col, 255), width=width, joint='curve')

# ---------------- 1. грустный праздничный бот ----------------
def sad_bot():
    im = base()
    d = ImageDraw.Draw(im)
    d.polygon([(0, 930), (W, 900), (W, H), (0, H)], fill=(24, 10, 34, 255))          # каменная ступень
    d.rectangle((0, 930, W, 944), fill=(46, 20, 62, 255))
    cx, cy = 540, 640
    # тело-тыква
    body = Image.new('RGBA', (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(body)
    bd.ellipse((cx - 250, cy - 200, cx + 250, cy + 200), fill=(226, 104, 18, 255))
    for k in (-170, -90, 0, 90, 170):
        bd.arc((cx + k * 0.0 - 150 + k * 0.55, cy - 200, cx + 150 + k * 0.55, cy + 200), 100, 260, fill=(150, 62, 10, 255), width=7)
    bd.ellipse((cx - 250, cy - 200, cx + 250, cy + 200), outline=(255, 170, 70, 255), width=6)
    shade = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(shade).ellipse((cx - 250, cy - 120, cx + 250, cy + 230), fill=(80, 20, 70, 110))
    body.alpha_composite(shade.filter(ImageFilter.GaussianBlur(30)))
    im.alpha_composite(body)
    d = ImageDraw.Draw(im)
    # латунные заклёпки и «шов» робота
    for ax in (cx - 215, cx + 215):
        d.ellipse((ax - 14, cy - 14, ax + 14, cy + 14), fill=(196, 150, 60, 255), outline=(120, 80, 20, 255), width=3)
    d.rectangle((cx - 40, cy - 210, cx + 40, cy - 170), fill=(70, 100, 40, 255))      # стебель
    # шляпа волшебника
    d.polygon([(cx - 150, cy - 200), (cx + 40, cy - 520), (cx + 170, cy - 200)], fill=(58, 22, 98, 255), outline=(150, 90, 220, 255))
    d.ellipse((cx - 230, cy - 240, cx + 250, cy - 160), fill=(44, 16, 78, 255), outline=(150, 90, 220, 255), width=4)
    glow(im, lambda g: g.polygon([(cx + 50, cy - 350), (cx + 62, cy - 322), (cx + 92, cy - 320), (cx + 68, cy - 300), (cx + 76, cy - 270), (cx + 50, cy - 288), (cx + 24, cy - 270), (cx + 32, cy - 300), (cx + 8, cy - 320), (cx + 38, cy - 322)], fill=(255, 224, 130, 255)), blur=10)
    d = ImageDraw.Draw(im)
    # печальное лицо: светящиеся глаза, брови домиком, опущенный рот
    def face(g):
        for ex in (cx - 100, cx + 100):
            g.ellipse((ex - 52, cy - 70, ex + 52, cy + 34), fill=(255, 226, 140, 255))
            g.ellipse((ex - 18, cy - 22, ex + 18, cy + 28), fill=(120, 60, 10, 255))
        g.line((cx - 160, cy - 72, cx - 60, cy - 104), fill=(60, 20, 8, 255), width=14)
        g.line((cx + 160, cy - 72, cx + 60, cy - 104), fill=(60, 20, 8, 255), width=14)
        g.arc((cx - 90, cy + 70, cx + 90, cy + 190), 200, 340, fill=(60, 20, 8, 255), width=16)
    glow(im, face, blur=14, times=1)
    d = ImageDraw.Draw(im)
    # пиксельная слеза
    for i, (tx, ty) in enumerate([(cx - 120, cy + 60), (cx - 120, cy + 90), (cx - 120, cy + 120)]):
        d.rectangle((tx, ty, tx + 14 - i * 2, ty + 22), fill=(140, 220, 255, 255 - i * 50))
    # руки и открытка с тыквой
    d.line((cx - 235, cy + 40, cx - 150, cy + 190), fill=(196, 150, 60, 255), width=16)
    d.line((cx + 235, cy + 40, cx + 150, cy + 190), fill=(196, 150, 60, 255), width=16)
    d.rounded_rectangle((cx - 120, cy + 140, cx + 120, cy + 300), 12, fill=(250, 238, 214, 255), outline=(196, 150, 60, 255), width=5)
    d.ellipse((cx - 46, cy + 170, cx + 46, cy + 262), fill=(226, 104, 18, 255))
    d.rectangle((cx - 6, cy + 160, cx + 8, cy + 178), fill=(70, 100, 40, 255))
    # четыре красных «заблокировано»
    def blocked(g):
        for bx, by in [(150, 190), (330, 120), (760, 140), (930, 230)]:
            g.ellipse((bx - 58, by - 58, bx + 58, by + 58), outline=(236, 50, 70, 255), width=14)
            g.line((bx - 40, by + 40, bx + 40, by - 40), fill=(236, 50, 70, 255), width=14)
    glow(im, blocked, blur=18, times=1)
    return vignette(im)

# ---------------- Морок: общий рисунок ----------------
def draw_morok(im, cx, foot, s=1.0):
    h = lambda v: int(v * s)
    d = ImageDraw.Draw(im)
    top = foot - h(640)
    # плащ
    d.polygon([(cx - h(110), top + h(120)), (cx + h(110), top + h(120)), (cx + h(250), foot), (cx - h(250), foot)], fill=(14, 5, 22, 255))
    d.polygon([(cx - h(30), top + h(130)), (cx + h(30), top + h(130)), (cx + h(120), foot), (cx - h(120), foot)], fill=(*BORDO, 255))
    d.line([(cx - h(110), top + h(120)), (cx - h(250), foot)], fill=(*VIOLET, 255), width=max(2, h(4)))
    d.line([(cx + h(110), top + h(120)), (cx + h(250), foot)], fill=(*VIOLET, 255), width=max(2, h(4)))
    # высокий рваный воротник
    d.polygon([(cx - h(190), top + h(30)), (cx - h(120), top + h(110)), (cx - h(100), top + h(190)), (cx - h(60), top + h(160)), (cx - h(120), top + h(60))], fill=(24, 8, 36, 255))
    d.polygon([(cx + h(190), top + h(30)), (cx + h(120), top + h(110)), (cx + h(100), top + h(190)), (cx + h(60), top + h(160)), (cx + h(120), top + h(60))], fill=(24, 8, 36, 255))
    for sx in (-1, 1):
        d.polygon([(cx + sx * h(200), top + h(10)), (cx + sx * h(150), top + h(80)), (cx + sx * h(176), top + h(86))], fill=(*BORDO, 255))
    # капюшон и лицо в тени
    d.polygon([(cx - h(95), top + h(170)), (cx, top - h(10)), (cx + h(95), top + h(170))], fill=(10, 3, 16, 255))
    d.ellipse((cx - h(78), top + h(40), cx + h(78), top + h(190)), fill=(6, 2, 10, 255))
    def eyes(g):
        for ex in (cx - h(30), cx + h(30)):
            g.ellipse((ex - h(14), top + h(98), ex + h(14), top + h(114)), fill=(*GLOW, 255))
    glow(im, eyes, blur=max(4, h(8)), times=3)
    # посох с кристаллом
    px = cx + h(300)
    d = ImageDraw.Draw(im)
    d.line((px, foot + h(10), px - h(30), top + h(30)), fill=(30, 12, 26, 255), width=max(4, h(18)))
    d.line((px, foot + h(10), px - h(30), top + h(30)), fill=(*BORDO, 255), width=max(2, h(7)))
    cxs, cys = px - h(30), top + h(10)
    def crystal(g):
        g.polygon([(cxs, cys - h(70)), (cxs + h(34), cys), (cxs, cys + h(70)), (cxs - h(34), cys)], fill=(*GLOW, 255))
    glow(im, crystal, blur=max(6, h(26)), times=3)
    return cxs, cys

# ---------------- 2. появление Морока ----------------
def morok():
    im = base()
    # круг рун у ног
    def ring(g):
        g.ellipse((140, 800, 940, 1000), outline=(*VIOLET, 200), width=5)
        g.ellipse((200, 830, 880, 975), outline=(*VIOLET, 130), width=3)
        for i in range(18):
            a = 2 * math.pi * i / 18; x, y = 540 + 400 * math.cos(a), 900 + 100 * math.sin(a)
            g.rectangle((x - 5, y - 5, x + 5, y + 5), fill=(*GLOW, 220))
    glow(im, ring, blur=10, times=1)
    cxs, cys = draw_morok(im, 480, 930, 1.05)
    glow(im, lambda g: [lightning(g, cxs, cys, 120 + i * 170, 110 + (i % 2) * 120, 11 + i) for i in range(4)] + [lightning(g, cxs, cys, 1020, 360, 3, 5)], blur=14, times=2)
    # гаснущие свечи
    d = ImageDraw.Draw(im)
    for x, y in [(90, 840), (990, 880), (60, 640)]:
        d.rectangle((x, y, x + 26, y + 90), fill=(210, 190, 160, 255)); d.line((x + 13, y, x + 13, y - 12), fill=(60, 50, 40, 255), width=3)
        d.line((x + 13, y - 14, x + 20, y - 60), fill=(130, 130, 150, 90), width=5)       # дымок
    return vignette(im)

# ---------------- 3. магический трибунал ----------------
def tribunal():
    im = base()
    d = ImageDraw.Draw(im)
    for x in (70, 250, 830, 1010):     # колонны готического зала
        d.rectangle((x - 34, 120, x + 34, 980), fill=(26, 10, 40, 255), outline=(*VIOLET, 255), width=3)
        d.line((x, 140, x, 960), fill=(*VIOLET, 120), width=2)
    d.arc((60, -160, 1020, 360), 180, 360, fill=(*VIOLET, 255), width=6)
    def circuits(g):
        for y in (230, 300):
            g.line((250, y, 830, y), fill=(*VIOLET, 200), width=4)
    glow(im, circuits, blur=8, times=1)
    # Морок за судейской трибуной
    draw_morok(im, 540, 560, 0.62)
    d = ImageDraw.Draw(im)
    d.polygon([(220, 480), (860, 480), (900, 600), (180, 600)], fill=(36, 14, 20, 255), outline=(*BORDO, 255))
    d.rectangle((180, 600, 900, 640), fill=(26, 8, 16, 255))
    def circuit_bench(g):
        for x in range(260, 840, 90):
            g.line((x, 500, x + 30, 584), fill=(*VIOLET, 230), width=4)
    glow(im, circuit_bench, blur=8, times=1)
    # молоточек с руной
    d = ImageDraw.Draw(im)
    d.line((760, 470, 800, 430), fill=(110, 60, 30, 255), width=12)
    glow(im, lambda g: g.rounded_rectangle((780, 395, 850, 440), 8, fill=(*GLOW, 255)), blur=14, times=2)
    # прожектор и обвиняемый
    cone = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(cone).polygon([(470, 640), (610, 640), (760, 990), (320, 990)], fill=(*GLOW, 70))
    im.alpha_composite(cone.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(im)
    d.ellipse((330, 905, 750, 1000), outline=(*VIOLET, 255), width=5)
    d.polygon([(500, 840), (540, 770), (580, 840), (610, 960), (470, 960)], fill=(8, 3, 14, 255))
    d.ellipse((502, 770, 578, 850), fill=(8, 3, 14, 255))
    glow(im, lambda g: [g.ellipse((x - 8, 806, x + 8, 822), fill=(*GLOW, 255)) for x in (524, 556)], blur=8, times=3)
    # парящие свитки, грустный тыквенный бот в углу
    d = ImageDraw.Draw(im)
    for x, y, a in [(130, 400, -12), (900, 360, 10), (150, 760, 8)]:
        d.rounded_rectangle((x, y, x + 70, y + 100), 8, fill=(236, 220, 190, 230), outline=(*VIOLET, 255), width=3)
        for k in range(4): d.line((x + 10, y + 20 + k * 20, x + 58, y + 20 + k * 20), fill=(120, 80, 140, 255), width=3)
    d.ellipse((880, 840, 1010, 960), fill=(226, 104, 18, 255), outline=(255, 170, 70, 255), width=4)
    d.polygon([(900, 850), (950, 760), (1000, 850)], fill=(58, 22, 98, 255))
    glow(im, lambda g: [g.ellipse((x - 11, 890, x + 11, 914), fill=(255, 226, 140, 255)) for x in (925, 968)], blur=8, times=1)
    return vignette(im)

for name, fn in (('1-sad-bot.jpg', sad_bot), ('2-morok.jpg', morok), ('3-tribunal.jpg', tribunal)):
    fn().convert('RGB').save(f'{OUT}/{name}', quality=90)
    print('saved', name)
