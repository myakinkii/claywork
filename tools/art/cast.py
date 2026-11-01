import sys, os; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
from canvas import Canvas, sheet
import json, random

GOB = {
 'K': '#0b0e0f', 'G': '#4f6b2e', 'g': '#6f8f3c', 'h': '#8fb05a', 'D': '#33461f',
 'Y': '#f2d24a', 'e': '#1a1205', 'T': '#e8e2c8', 'm': '#2a1a10',
 'R': '#5a3a26', 'r': '#7a5236', 'b': '#3e281a',
 'I': '#6d757e', 'i': '#a7afb8', 'W': '#4a3020',
}
def goblin():
    c = Canvas(32, 32)
    # ears: long, swept out
    # ears: wide leathery wedges from the head out to a drooping tip
    for x in range(1, 12):
        t = (x - 1) / 10            # 0 at the tip, 1 at the head
        top = round(5 + (1 - t) * -1 + t * 2)
        bot = round(6 + t * 7)
        for y in range(top, bot + 1):
            c.px(x, y, 'h' if y == top else 'g')
            c.px(31 - x, y, 'G' if y > top else 'g')
        c.px(x, bot, 'D'); c.px(31 - x, bot, 'D')
    for x in range(4, 10): c.px(x, 8 + (x - 4) // 2, 'D'); c.px(31 - x, 8 + (x - 4) // 2, 'D')
    # head
    c.ellipse(16, 11, 6.5, 6, 'g')
    c.ellipse(13.5, 9, 3, 3, 'h', only=('g',))
    c.ellipse(19.5, 13, 3, 3.5, 'G', only=('g', 'h'))
    # brow, eyes: yellow, slit pupils
    for x in range(11, 21): c.px(x, 9, 'D')
    for ex in (13, 18):
        c.rect(ex, 10, ex + 1, 11, 'Y'); c.px(ex + (1 if ex == 13 else 0), 10, 'e'); c.px(ex + (1 if ex == 13 else 0), 11, 'e')
    # nose and grin
    c.px(16, 12, 'D'); c.px(15, 13, 'D')
    c.rect(12, 15, 20, 15, 'm'); c.px(13, 15, 'T'); c.px(15, 15, 'T'); c.px(18, 15, 'T'); c.px(11, 14, 'D'); c.px(21, 14, 'D')
    # ragged tunic body, hunched
    for y in range(17, 30):
        half = 5 + (y - 17) // 3
        for x in range(16 - half, 16 + half + 1):
            c.px(x, y, 'r' if x < 16 - half // 2 else 'R' if x < 16 + half // 2 else 'b')
    for x in range(10, 23, 2): c.px(x, 30, 'R'); c.px(x + 1, 29, 'b')
    c.rect(11, 22, 21, 22, 'W')
    # arms: one raised with dagger
    c.line(10, 19, 6, 23, 'g'); c.line(10, 20, 6, 24, 'G'); c.rect(5, 23, 6, 25, 'g')
    c.line(22, 19, 26, 16, 'g'); c.line(22, 20, 26, 17, 'G'); c.rect(26, 14, 27, 16, 'g')
    c.line(27, 13, 27, 5, 'i'); c.line(28, 13, 28, 6, 'I'); c.px(27, 4, 'i'); c.rect(25, 13, 29, 13, 'W')
    # feet
    c.rect(11, 31, 14, 31, 'G'); c.rect(18, 31, 21, 31, 'G')
    return c.rows()

CH = {
 'K': '#0b0e0f', 'I': '#3b3f44', 'i': '#5d636b', 'j': '#868e98', 'R': '#7a3e22', 'r': '#a0562e',
 'd': '#16191c', 'Y': '#d6a23c', 'y': '#ffe08a', 'W': '#163a45', 'w': '#2f6874',
}
def chest(open_, key=True):
    c = Canvas(32, 22)
    base_top = 10
    c.rect(4, base_top, 27, 19, 'I')
    for x in range(4, 28): c.px(x, base_top, 'i')
    for y in range(base_top, 20): c.px(8, y, 'i'); c.px(23, y, 'i'); c.px(4, y, 'j' if y < 14 else 'i')
    random.seed(3)
    for _ in range(18): c.px(random.randint(5, 26), random.randint(base_top + 2, 19), random.choice('Rr'))
    if open_:
        # lid thrown back, inside dark, the key glinting
        c.rect(5, base_top - 7, 26, base_top - 1, 'I')
        for x in range(5, 27): c.px(x, base_top - 7, 'j'); c.px(x, base_top - 1, 'd')
        c.rect(6, base_top - 6, 25, base_top - 2, 'i'); c.rect(7, base_top - 5, 24, base_top - 3, 'I')
        c.rect(5, base_top + 1, 26, base_top + 3, 'd')
        key_pixels = [(13, base_top + 2, 'Y'), (14, base_top + 2, 'Y'), (15, base_top + 2, 'Y'), (16, base_top + 2, 'y'),
                           (17, base_top + 2, 'Y'), (17, base_top + 3, 'Y'), (19, base_top + 2, 'Y'), (19, base_top + 3, 'Y'),
                           (12, base_top + 1, 'Y'), (12, base_top + 3, 'Y'), (11, base_top + 2, 'Y'), (16, base_top + 1, 'y')]
        for (x, y, ch) in (key_pixels if key else []):
            c.px(x, y, ch)
    else:
        c.rect(4, base_top - 4, 27, base_top - 1, 'I')
        c.ellipse(15.5, base_top - 3, 12, 2.5, 'I')
        for x in range(5, 27): c.px(x, base_top - 5, 'j')
        for x in range(4, 28): c.px(x, base_top - 1, 'd')
        c.rect(15, base_top + 1, 16, base_top + 3, 'j'); c.px(15, base_top + 3, 'd')
    # water line
    rnd = random.Random(9)
    for x in range(0, 32):
        for y in range(18, 22): c.px(x, y, 'w' if rnd.random() < .14 else 'W')
    for x in range(2, 9): c.px(x, 19, 'w')
    for x in range(20, 25): c.px(x, 21, 'w')
    return c.rows()

HE = {
 'K': '#0a0706', 'H': '#6e2016', 'h': '#a83c28', 'c': '#c95a3c', 'y': '#ee7a52', 'z': '#ffc49a', 'x': '#3a1810', 'g': '#3a1e14',
}
def heart():
    c = Canvas(24, 20)
    # warm glow halo
    for y in range(20):
        for x in range(24):
            d = ((x - 11.5) ** 2 + ((y - 10) * 1.2) ** 2) ** .5
            if d < 11 and random.random() < (11 - d) / 11 * .55: c.px(x, y, 'g')
    c.ellipse(8, 7, 4.5, 4, 'h'); c.ellipse(15, 7, 4.5, 4, 'h')
    for y in range(8, 18):
        half = (17 - y) * 0.95
        for x in range(round(11.5 - half), round(11.5 + half) + 1): c.px(x, y, 'h')
    c.ellipse(7, 6, 2.2, 1.8, 'y', only=('h',)); c.px(6, 5, 'z'); c.px(7, 5, 'z')
    c.ellipse(16.5, 9.5, 3, 4, 'H', only=('h', 'y'))
    for y in range(9, 16): c.px(11 + (y % 2), y, 'c') if c.get(11, y) == 'h' else None
    # thumbprints and a crack
    c.px(9, 10, 'c'); c.px(10, 11, 'c'); c.px(14, 6, 'x'); c.px(14, 7, 'x'); c.px(13, 8, 'x')
    return c.rows()

out = {'goblin': (goblin(), GOB), 'chest_closed': (chest(False), CH), 'chest_open': (chest(True), CH), 'chest_empty': (chest(True, key=False), CH), 'heart': (heart(), HE)}
for k, (rows, pal) in out.items():
    json.dump({'palette': {a: b for a, b in pal.items() if any(a in r for r in rows)}, 'rows': rows}, open(os.path.join(HERE, 'out', f'{k}.json'), 'w'))
sheet([v for v in out.values()], os.path.join(HERE, 'out', 'cast.png'), scale=8)
print({k: (len(v[0][0]), len(v[0])) for k, v in out.items()})
