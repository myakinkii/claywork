import type { Sprite } from "@claywork/clay";

/**
 * Art renderers. One sprite format, three surfaces:
 *  - SVG for the browser: horizontal runs of one color, crisp at any size;
 *  - ANSI truecolor half-blocks for terminals: "▀" shows two pixels stacked in one
 *    character cell, and since cells are about twice as tall as wide the pixels come
 *    out roughly square, matching the browser;
 *  - the raw character grid, for terminals without color.
 */

export interface Run {
  x: number;
  y: number;
  width: number;
  fill: string;
}

export function width(sprite: Sprite): number {
  return Math.max(0, ...sprite.rows.map((r) => r.length));
}

/** Horizontal runs of one color, so a big sprite is a few hundred rects, not thousands. */
export function runs(sprite: Sprite): Run[] {
  const out: Run[] = [];
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const char = row[x]!;
      let end = x + 1;
      while (row[end] === char) end++;
      const fill = sprite.palette[char];
      if (fill) out.push({ x, y, width: end - x, fill });
      x = end;
    }
  });
  return out;
}

export function toSvg(sprite: Sprite, options: { scale?: number; title?: string } = {}): string {
  const w = width(sprite);
  const h = sprite.rows.length;
  const scale = options.scale ?? 1;
  const rects = runs(sprite).map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="1" fill="${r.fill}"/>`).join("");
  const label = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" role="img">${label}${rects}</svg>`;
}

/** Truecolor half-block rendering: two pixel rows per text line. */
export function toAnsi(sprite: Sprite): string {
  const w = width(sprite);
  const color = (char: string | undefined) => (char ? sprite.palette[char] : undefined);
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
  };
  const lines: string[] = [];
  for (let y = 0; y < sprite.rows.length; y += 2) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const top = color(sprite.rows[y]?.[x]);
      const bottom = color(sprite.rows[y + 1]?.[x]);
      if (top && bottom) line += `\x1b[38;2;${rgb(top)}m\x1b[48;2;${rgb(bottom)}m▀`;
      else if (top) line += `\x1b[49m\x1b[38;2;${rgb(top)}m▀`;
      else if (bottom) line += `\x1b[49m\x1b[38;2;${rgb(bottom)}m▄`;
      else line += "\x1b[0m ";
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join("\n");
}

/** No color at all: the grid itself, transparent pixels as spaces. */
export function toPlain(sprite: Sprite): string {
  return sprite.rows.map((r) => r.replace(/\./g, " ").trimEnd()).join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
