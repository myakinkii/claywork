from PIL import Image
import math, json

class Canvas:
    def __init__(self, w, h, fill='.'):
        self.w, self.h = w, h
        self.g = [[fill]*w for _ in range(h)]
    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h: self.g[y][x] = c
    def get(self, x, y):
        return self.g[y][x] if 0 <= x < self.w and 0 <= y < self.h else None
    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1+1):
            for x in range(x0, x1+1): self.px(x, y, c)
    def line(self, x0, y0, x1, y1, c):
        dx, dy = abs(x1-x0), -abs(y1-y0); sx = 1 if x0 < x1 else -1; sy = 1 if y0 < y1 else -1; e = dx+dy
        while True:
            self.px(x0, y0, c)
            if x0 == x1 and y0 == y1: break
            e2 = 2*e
            if e2 >= dy: e += dy; x0 += sx
            if e2 <= dx: e += dx; y0 += sy
    def ellipse(self, cx, cy, rx, ry, c, only=None):
        for y in range(int(cy-ry)-1, int(cy+ry)+2):
            for x in range(int(cx-rx)-1, int(cx+rx)+2):
                if ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1.0:
                    if only is None or self.get(x, y) in only: self.px(x, y, c)
    def replace(self, a, b, region=None):
        x0, y0, x1, y1 = region or (0, 0, self.w-1, self.h-1)
        for y in range(y0, y1+1):
            for x in range(x0, x1+1):
                if self.get(x, y) == a: self.px(x, y, b)
    def stamp(self, ox, oy, rows):
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != '.': self.px(ox+x, oy+y, ch)
    def rows(self):
        return [''.join(r) for r in self.g]

def preview(rows, palette, path, scale=10, bg=(40, 40, 40)):
    w, h = len(rows[0]), len(rows)
    img = Image.new('RGB', (w*scale, h*scale), bg)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in palette:
                col = tuple(int(palette[ch][i:i+2], 16) for i in (1, 3, 5))
                for yy in range(scale):
                    for xx in range(scale): img.putpixel((x*scale+xx, y*scale+yy), col)
    img.save(path)

def sheet(items, path, scale=6, pad=12, bg=(30, 30, 30)):
    imgs = []
    for rows, pal in items:
        w, h = len(rows[0]), len(rows)
        img = Image.new('RGB', (w*scale, h*scale), bg)
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in pal:
                    col = tuple(int(pal[ch][i:i+2], 16) for i in (1, 3, 5))
                    img.paste(col, (x*scale, y*scale, x*scale+scale, y*scale+scale))
        imgs.append(img)
    W = max(i.width for i in imgs) + 2*pad
    H = sum(i.height for i in imgs) + pad*(len(imgs)+1)
    out = Image.new('RGB', (W, H), bg); y = pad
    for i in imgs: out.paste(i, (pad, y)); y += i.height + pad
    out.save(path)
