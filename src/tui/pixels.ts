// src/tui/pixels.ts — pixel-art → terminal half-block conversion.
//
// Terminal cells are roughly twice as tall as they are wide, so we pack two vertical
// pixels into one cell using the upper/lower half-block glyphs (▀/▄): the foreground
// colour paints one half, the background colour the other. A transparent pixel simply
// gets no colour on its half, which lets the terminal background show through.
//
// Everything here is pure and free of JSX so `vitest`'s `src/**/*.test.ts` glob can
// reach it. The rendering component lives in `pixels.tsx`.

/** A single pixel: a `#rrggbb` colour, or `null` for transparent. */
export type Pixel = string | null;

/** A run of identical cells on one terminal row. `ch` is the glyph repeated `ch.length` times. */
export interface PixelSegment {
  ch: string;
  fg?: string;
  bg?: string;
}

export interface PixelArt {
  rows: PixelSegment[][];
  /** Width in terminal columns. */
  width: number;
  /** Height in terminal rows (half the source pixel height, rounded up). */
  height: number;
}

/** A pixel buffer in row-major order, plus its dimensions. */
export interface PixelGrid {
  px: Pixel[];
  w: number;
  h: number;
}

const UPPER = '▀';
const LOWER = '▄';

/**
 * Convert a pixel buffer into half-block rows, merging horizontally adjacent cells that
 * share the same colour pair into a single run.
 *
 * An odd `h` is padded with a transparent final row rather than reading past the buffer.
 */
export function toHalfBlocks(px: Pixel[], w: number, h: number): PixelArt {
  const rows: PixelSegment[][] = [];

  for (let y = 0; y < h; y += 2) {
    const segs: PixelSegment[] = [];

    for (let x = 0; x < w; x++) {
      const top = px[y * w + x] ?? null;
      // The bottom half is transparent when `h` is odd and we're on the last row.
      const bottom = y + 1 < h ? (px[(y + 1) * w + x] ?? null) : null;

      let seg: PixelSegment;
      if (top && bottom) seg = { ch: UPPER, fg: top, bg: bottom };
      else if (top) seg = { ch: UPPER, fg: top };
      else if (bottom) seg = { ch: LOWER, fg: bottom };
      // Fully transparent: a plain space with no background, so the terminal shows through.
      else seg = { ch: ' ' };

      const prev = segs[segs.length - 1];
      if (prev && prev.fg === seg.fg && prev.bg === seg.bg) prev.ch += seg.ch;
      else segs.push(seg);
    }

    rows.push(segs);
  }

  return { rows, width: w, height: rows.length };
}

/**
 * Convert a raw RGBA buffer (4 bytes per pixel, as produced by `sharp().raw()`) into a
 * pixel buffer. Pixels with alpha below `alphaThreshold` become transparent.
 */
export function rgbaToPixels(
  data: Uint8Array,
  w: number,
  h: number,
  alphaThreshold = 128,
): Pixel[] {
  const px: Pixel[] = new Array(w * h).fill(null);

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if ((data[o + 3] ?? 0) < alphaThreshold) continue;
    px[i] = toHex(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
  }

  return px;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Convert a character grid + palette into a pixel buffer. Characters absent from the
 * palette (conventionally `.`) are transparent. Rows shorter than the widest are padded.
 */
export function charGridToPixels(grid: string[], pal: Record<string, string>): PixelGrid {
  const w = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const h = grid.length;
  const px: Pixel[] = new Array(w * h).fill(null);

  for (let y = 0; y < h; y++) {
    const row = grid[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      px[y * w + x] = pal[row[x] as string] ?? null;
    }
  }

  return { px, w, h };
}

const VIEWBOX_RE = /viewBox\s*=\s*"([^"]*)"/;
const RECT_RE = /<rect\b([^>]*)\/?>/g;

/**
 * Parse a `shape-rendering="crispEdges"` pixel-grid SVG (as produced for `assets/logo.svg`)
 * into a pixel buffer. Rects are not necessarily 1×1 — `width`/`height` runs are expanded,
 * and later rects overpaint earlier ones, matching SVG document order.
 *
 * Returns `null` if the input has no usable viewBox.
 */
export function parseSvgPixelGrid(svg: string): PixelGrid | null {
  const viewBox = VIEWBOX_RE.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length < 4) return null;

  const w = Math.round(viewBox[2] as number);
  const h = Math.round(viewBox[3] as number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  const px: Pixel[] = new Array(w * h).fill(null);

  for (const match of svg.matchAll(RECT_RE)) {
    const attrs = match[1] as string;
    const fill = attr(attrs, 'fill');
    if (!fill || fill === 'none') continue;

    const x0 = num(attrs, 'x', 0);
    const y0 = num(attrs, 'y', 0);
    const rw = num(attrs, 'width', 1);
    const rh = num(attrs, 'height', 1);
    const colour = fill.toLowerCase();

    for (let y = y0; y < y0 + rh; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = x0; x < x0 + rw; x++) {
        if (x < 0 || x >= w) continue;
        px[y * w + x] = colour;
      }
    }
  }

  return { px, w, h };
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];
}

function num(attrs: string, name: string, fallback: number): number {
  const raw = attr(attrs, name);
  if (raw === undefined) return fallback;
  const parsed = Math.round(Number(raw));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Trim fully transparent rows and columns from the edges of a pixel buffer, so art with
 * built-in margins doesn't render as a box of blank cells.
 *
 * A fully transparent buffer is returned as a 0×0 grid.
 */
export function cropTransparent(px: Pixel[], w: number, h: number): PixelGrid {
  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  const rowEmpty = (y: number) => {
    for (let x = 0; x < w; x++) if (px[y * w + x]) return false;
    return true;
  };
  const colEmpty = (x: number) => {
    for (let y = 0; y < h; y++) if (px[y * w + x]) return false;
    return true;
  };

  while (top <= bottom && rowEmpty(top)) top++;
  if (top > bottom) return { px: [], w: 0, h: 0 };
  while (bottom > top && rowEmpty(bottom)) bottom--;
  while (left <= right && colEmpty(left)) left++;
  while (right > left && colEmpty(right)) right--;

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  const out: Pixel[] = new Array(cw * ch).fill(null);

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      out[y * cw + x] = px[(y + top) * w + (x + left)] ?? null;
    }
  }

  return { px: out, w: cw, h: ch };
}

/** Convenience: char grid → half-block art, for compile-time art like the flower. */
export function artFromCharGrid(grid: string[], pal: Record<string, string>): PixelArt {
  const { px, w, h } = charGridToPixels(grid, pal);
  return toHalfBlocks(px, w, h);
}
