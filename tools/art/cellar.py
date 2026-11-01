import sys, os; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
from canvas import Canvas, preview
import random
random.seed(7)

P = {
 'K': '#0b0e0f', 'm': '#161b1c', 'S': '#2b3233', 's': '#3a4344', 't': '#4a5455',
 'g': '#5b4532', 'h': '#7a5432',
 'W': '#0c2027', 'w': '#163a45', 'r': '#2f6874', 'q': '#5aa0aa',
 'I': '#2e3237', 'i': '#4f565e', 'j': '#6d757e', 'R': '#6b3820',
 'F': '#e8892c', 'f': '#ffcf6a', 'y': '#fff3c4',
}
W_, H_ = 64, 34
c = Canvas(W_, H_, 'K')
WATER = 24
# back wall: bricks with dark mortar
for y in range(0, WATER):
    row = y // 3
    off = 0 if row % 2 == 0 else 4
    for x in range(W_):
        if y % 3 == 2: c.px(x, y, 'm'); continue
        if (x + off) % 8 == 7: c.px(x, y, 'm'); continue
        shade = random.random()
        c.px(x, y, 'S' if shade < .55 else 's')
# darker top (ceiling vault in shadow)
for y in range(0, 5):
    for x in range(W_):
        if random.random() < (5-y)/5*0.85: c.px(x, y, 'K' if random.random() < .6 else 'm')
# iron door (east wall), arched
dx0, dx1, dy0 = 42, 55, 6
for y in range(dy0, WATER+1):
    for x in range(dx0, dx1+1):
        top = dy0 + (abs(x - (dx0+dx1)/2) > 4) * 0  # placeholder
        c.px(x, y, 'I')
c.ellipse((dx0+dx1)/2, dy0+1, (dx1-dx0)/2+0.5, 4, 'I')
for x in range(dx0, dx1+1):
    for y in range(dy0-4, dy0+2):
        inside = ((x-(dx0+dx1)/2)/((dx1-dx0)/2+0.5))**2 + ((y-(dy0+1))/4)**2 <= 1
        if not inside and y < dy0+1: c.px(x, y, 'm' if y % 3 == 2 else 's')
# arch outline
for x in range(dx0-1, dx1+2):
    for y in range(dy0-4, dy0+2):
        if c.get(x, y) != 'I' and any(c.get(x+a, y+b) == 'I' for a, b in ((1,0),(-1,0),(0,1),(0,-1))): c.px(x, y, 'K')
for y in range(dy0-3, WATER+1):  # frame
    for x in (dx0-1, dx1+1):
        if c.get(x, y) != None and y >= dy0: c.px(x, y, 'K')
for x in range(dx0, dx1+1):  # rivet bands
    c.px(x, 10, 'i'); c.px(x, 17, 'i')
for x in range(dx0+1, dx1, 3): c.px(x, 10, 'j'); c.px(x, 17, 'j')
for y in range(dy0, WATER): c.px(dx0+2, y, 'i')
c.px(dx1-3, 13, 'j'); c.px(dx1-3, 14, 'K')   # keyhole
for y in range(18, WATER):
    if random.random() < .5: c.px(dx0+random.randint(1, 12), y, 'R')
# torch bracket left of door
tx, ty = 38, 9
c.rect(tx, ty+3, tx, ty+6, 'R'); c.px(tx-1, ty+6, 'I'); c.px(tx+1, ty+6, 'I')
# glow on wall
for y in range(0, WATER):
    for x in range(18, 52):
        d = ((x-tx)**2 + ((y-ty)*1.25)**2) ** .5
        cur = c.get(x, y)
        n = random.random()
        if cur in ('S', 's'):
            if d < 3.5 or (d < 5.5 and n < (5.5-d)/2): c.px(x, y, 'h')
            elif d < 8 or (d < 11 and n < (11-d)/3): c.px(x, y, 'g')
        elif cur == 'm' and (d < 5 or (d < 7.5 and n < .4)): c.px(x, y, 'g')
# flame
for (x, y, ch) in [(tx, ty+2, 'F'), (tx-1, ty+2, 'F'), (tx+1, ty+2, 'F'), (tx, ty+1, 'f'), (tx-1, ty+1, 'F'),
                   (tx, ty, 'f'), (tx+1, ty, 'F'), (tx, ty-1, 'y'), (tx, ty-2, 'F'), (tx+1, ty-3, 'F')]:
    c.px(x, y, ch)
# iron chest, half sunk, on the left
cx0, cx1, cy0 = 6, 21, 15
c.rect(cx0, cy0+2, cx1, WATER+1, 'I')
c.ellipse((cx0+cx1)/2, cy0+2.5, (cx1-cx0)/2+0.5, 2.6, 'I')
for x in range(cx0, cx1+1): c.px(x, cy0+4, 'K'); c.px(x, cy0+5, 'i')
for y in range(cy0+1, WATER+1): c.px(cx0+3, y, 'i'); c.px(cx1-3, y, 'i')
for x in range(cx0+2, cx1-1): c.px(x, cy0, 'j') if c.get(x, cy0) == 'I' else None
c.px((cx0+cx1)//2, cy0+6, 'j'); c.px((cx0+cx1)//2, cy0+7, 'K')
for y in range(cy0+6, WATER+1):
    if random.random() < .6: c.px(cx0+random.randint(1, 14), y, 'R')
# water
for y in range(WATER, H_):
    for x in range(W_): c.px(x, y, 'W')
for y in range(WATER, H_):
    for x in range(W_):
        if random.random() < .06 + (y-WATER)*0.008: c.px(x, y, 'w')
# reflections: torch and door
for y in range(WATER, H_):
    k = y - WATER
    if k % 2 == 0 and k < 10:
        wob = (k // 2) % 2
        col = 'f' if k < 2 else 'F' if k < 6 else 'h'
        c.px(tx + wob, y, col)
        if k < 4: c.px(tx + wob - 1, y, 'F')
    for x in range(dx0, dx1+1):
        if random.random() < .35 - k*.03: c.px(x, y, 'I')
    for x in range(cx0, cx1+1):
        if random.random() < .25 - k*.03: c.px(x, y, 'I')
# ripple lines
for (x0, y, ln) in [(5, 27, 6), (27, 28, 4), (49, 26, 7), (15, 31, 5), (56, 30, 4)]:
    for x in range(x0, x0+ln): c.px(x, y, 'r')
    c.px(x0 + ln//2, y, 'q')
# waterline
for x in range(W_):
    if c.get(x, WATER) == 'W': c.px(x, WATER, 'w')
rows = c.rows()
preview(rows, P, os.path.join(HERE, 'out', 'cellar.png'), scale=10)
import json; json.dump({'palette': {k: v for k, v in P.items() if any(k in r for r in rows)}, 'rows': rows}, open(os.path.join(HERE, 'out', 'cellar.json'), 'w'))
print(len(rows[0]), len(rows))
