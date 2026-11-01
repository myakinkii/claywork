import sys, os; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
from canvas import Canvas, preview, sheet
import random, json

P = {
 'K': '#0a0706', 'b': '#1c1410', 'B': '#2a1f19', 'v': '#352720',
 'p': '#3e2b1e', 'P': '#5c412c', 'n': '#7a583b',
 'd': '#3c261b', 'c': '#6b4430', 'C': '#8f5c3e', 'L': '#b07650', 'l': '#c99068',
 'e': '#050303', 'x': '#2a1912',
 'H': '#7a2418', 'h': '#b8452e', 'y': '#ee7a52', 'z': '#ffc49a',
 'S': '#3b3532', 's': '#55504b', 'u': '#6e6964',
 'g': '#4a2c1c',
}

def wall(c, seed=1):
    random.seed(seed)
    for y in range(c.h):
        for x in range(c.w):
            r = random.random()
            c.px(x, y, 'B' if r < .5 else 'b' if r < .85 else 'v')

SMALL_AWAY = [
    "..cCc..",
    ".cLCCc.",
    ".cLCCc.",
    "..cCc..",
    "...c...",
    ".cLCCc.",
    "cLLCCCc",
    "cLCCCCc",
    ".LCCCc.",
    ".LCCCc.",
    ".ccccc.",
]
SMALL_FACING = [
    "..cCc..",
    ".cLCCc.",
    ".ceCec.",
    "..cCc..",
    "...c...",
    ".cLCCc.",
    "cLLCCCc",
    "cLCCCCc",
    ".LCCCc.",
    ".LCCCc.",
    ".ccccc.",
]

def small(c, x, y, facing, tall=0):
    """7 wide figure, (x, y) bottom centre; tall adds body height."""
    rows = SMALL_FACING if facing else SMALL_AWAY
    rows = rows[:9] + [rows[8]] * tall + rows[9:]
    c.stamp(x - 3, y - len(rows) + 1, [r.replace('.', '.') for r in rows])
    for k, ch in enumerate(rows[2]):
        if ch == 'e':
            c.px(x - 3 + k, y - len(rows) + 3, 'e')
    c.rect(x - 2, y + 1, x + 2, y + 1, 'K')

def humanoid(c, x, y, hr, facing, rnd, crack=False, tilt=0):
    """A larger figure: head radius hr, (x, y) bottom centre."""
    neck_h = max(1, round(hr * .45)); neck_w = max(1, round(hr * .45))
    head_cy = y - 1
    # body from shoulders down, a robe that widens a little
    shoulders = round(hr * 1.25)
    body_top = None
    head_cy = None
    total = y - 0
    # place head so the figure is hr*6.5 tall
    height = round(hr * 6.2)
    top = y - height
    head_cy = top + hr
    neck_top = round(head_cy + hr * .85)
    body_top = neck_top + neck_h
    for yy in range(body_top, y + 1):
        t = (yy - body_top) / max(1, y - body_top)
        half = shoulders * (1.0 - .12 * min(1, t * 3) + .18 * t)
        if yy - body_top < 2: half = shoulders * (.75 + .12 * (yy - body_top))
        for xx in range(round(x - half), round(x + half) + 1):
            side = (xx - x) / max(.5, half)
            c.px(xx, yy, 'L' if side < -.45 else 'C' if side < .35 else 'c')
    c.rect(x - neck_w, neck_top, x + neck_w, body_top, 'c')
    c.rect(x - neck_w, neck_top, x - neck_w, body_top, 'C')
    hx = x + tilt
    c.ellipse(hx, head_cy, hr, hr * 1.12, 'C')
    c.ellipse(hx - hr * .4, head_cy - hr * .35, hr * .5, hr * .55, 'L', only=('C',))
    c.ellipse(hx + hr * .6, head_cy + hr * .25, hr * .45, hr * .75, 'c', only=('C', 'L'))
    if facing:
        ex = hr * .42; ey = head_cy - hr * .05
        ew, eh = max(.9, hr * .2), max(1.2, hr * .32)
        for cx_ in (hx - ex, hx + ex):
            c.ellipse(cx_, ey, ew, eh, 'e')
        if crack:
            cx_ = round(hx + ex); yy = round(ey + eh) + 1
            for k in range(round(hr * 1.6)):
                c.px(cx_ + (1 if k % 3 == 2 else 0), yy + k, 'x')
    for xx in range(round(x - shoulders), round(x + shoulders) + 1): c.px(xx, y + 1, 'K')

def shelves(c, ys, x0, x1):
    for y in ys:
        c.rect(x0, y, x1, y + 1, 'P'); c.rect(x0, y, x1, y, 'n'); c.rect(x0, y + 2, x1, y + 2, 'K')

def altar(c, x0, x1, y0, y1):
    c.rect(x0, y0, x1, y1, 'S'); c.rect(x0, y0, x1, y0, 'u'); c.rect(x0, y0 + 1, x1, y0 + 1, 's')
    c.rect(x0 + 2, y0 + 3, x0 + 2, y1, 'K'); c.rect(x1 - 2, y0 + 3, x1 - 2, y1, 'K')

def heart(c, x, y, glow=True):
    if glow:
        for yy in range(y - 8, y + 4):
            for xx in range(x - 10, x + 11):
                d = ((xx - x) ** 2 + ((yy - y) * 1.4) ** 2) ** .5
                if c.get(xx, yy) in ('B', 'b', 'v') and (d < 6 or (d < 9 and random.random() < .35)): c.px(xx, yy, 'g')
    for (dx, dy, ch) in [(-2,-2,'h'),(-1,-3,'h'),(1,-3,'h'),(2,-2,'h'),(0,-2,'H'),(-1,-2,'y'),(1,-2,'h'),
                         (-2,-1,'h'),(-1,-1,'y'),(0,-1,'h'),(1,-1,'h'),(2,-1,'H'),(-1,0,'h'),(0,0,'h'),(1,0,'H'),(0,1,'H'),(-1,-3,'z')]:
        c.px(x + dx, y + dy, ch)

def crypt(turned):
    W, H = 64, 34
    c = Canvas(W, H)
    wall(c, 3)
    rnd = random.Random(11)
    ys = [11, 23]
    shelves(c, ys, 0, W - 1)
    for i, y in enumerate(ys):
        for n, x in enumerate(range(5 + (i % 2) * 4, W - 3, 8)):
            if not turned and i == 1 and 22 < x < 42: continue  # the altar stands in front
            if turned and i == 1 and 22 < x < 42: continue
            small(c, x, y - 1, turned, tall=(n + i) % 3 == 0)
    # floor
    c.rect(0, 30, W - 1, H - 1, 'b')
    for x in range(0, W, 5): c.px(x + (x // 5) % 2, 31 + (x // 5) % 3, 'B')
    altar(c, 24, 39, 24, 31)
    if not turned: heart(c, 31, 22)
    # dark vignette edges
    for y in range(H):
        for x in range(W):
            d = min(x, W - 1 - x)
            if d < 3 and random.random() < (3 - d) / 3.5: c.px(x, y, 'K')
    return c.rows()

def closer():
    W, H = 64, 40
    c = Canvas(W, H)
    wall(c, 5)
    rnd = random.Random(23)
    shelves(c, [12], 0, W - 1)
    for n, x in enumerate(range(4, W - 2, 8)): small(c, x, 11, True, tall=n % 2)
    # middle row, closer
    for x, hr, t in [(8, 2.6, 0), (24, 2.8, -1), (40, 2.8, 1), (56, 2.6, 0)]:
        humanoid(c, x, 30, hr, True, rnd, tilt=t)
    # front row: right in front of you
    for x, hr, t, cr in [(14, 4.6, 1, False), (50, 4.6, -1, True)]:
        humanoid(c, x, H + 6, hr, True, rnd, crack=cr, tilt=t)
    humanoid(c, 32, H + 9, 5.6, True, rnd, crack=False, tilt=0)
    for y in range(H):
        for x in range(W):
            d = min(x, W - 1 - x, y * 1.4)
            if d < 5 and random.random() < (5 - d) / 5.5: c.px(x, y, 'K')
    return c.rows()

out = {'crypt': crypt(False), 'figures_turn': crypt(True), 'figures_closer': closer()}
for k, rows in out.items():
    json.dump({'palette': {a: b for a, b in P.items() if any(a in r for r in rows)}, 'rows': rows}, open(os.path.join(HERE, 'out', f'{k}.json'), 'w'))
sheet([(out['crypt'], P), (out['figures_turn'], P), (out['figures_closer'], P)], os.path.join(HERE, 'out', 'crypt_sheet.png'), scale=8)
print({k: (len(v[0]), len(v)) for k, v in out.items()})
