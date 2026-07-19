import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  charGridToPixels,
  cropTransparent,
  parseSvgPixelGrid,
  rgbaToPixels,
  toHalfBlocks,
  type Pixel,
} from './pixels';

const RED = '#ff0000';
const BLUE = '#0000ff';

describe('toHalfBlocks', () => {
  it('encodes all four transparency combinations', () => {
    // One row of cells: both set, top only, bottom only, neither.
    const px: Pixel[] = [RED, RED, null, null, BLUE, null, BLUE, null];
    const { rows } = toHalfBlocks(px, 4, 2);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      { ch: '▀', fg: RED, bg: BLUE },
      { ch: '▀', fg: RED },
      { ch: '▄', fg: BLUE },
      { ch: ' ' },
    ]);
  });

  it('leaves a fully transparent cell with no background', () => {
    const { rows } = toHalfBlocks([null, null], 1, 2);
    // A `bg` key here would paint a black box over the terminal background.
    expect(rows[0]?.[0]).not.toHaveProperty('bg');
    expect(rows[0]?.[0]).not.toHaveProperty('fg');
  });

  it('pads an odd height instead of reading past the buffer', () => {
    const { rows, height } = toHalfBlocks([RED, RED, RED], 1, 3);

    expect(height).toBe(2);
    // The final row has no bottom pixel, so it must be an upper half-block only.
    expect(rows[1]).toEqual([{ ch: '▀', fg: RED }]);
  });

  it('merges adjacent cells with the same colour pair', () => {
    const px: Pixel[] = [RED, RED, RED, BLUE, BLUE, BLUE];
    const { rows } = toHalfBlocks(px, 3, 2);

    expect(rows[0]).toEqual([{ ch: '▀▀▀', fg: RED, bg: BLUE }]);
  });

  it('does not merge cells that differ only in background', () => {
    const px: Pixel[] = [RED, RED, BLUE, RED];
    const { rows } = toHalfBlocks(px, 2, 2);

    expect(rows[0]).toEqual([
      { ch: '▀', fg: RED, bg: BLUE },
      { ch: '▀', fg: RED, bg: RED },
    ]);
  });

  it('preserves total width across run-length merging', () => {
    const px: Pixel[] = [RED, RED, null, BLUE, BLUE, BLUE, null, RED];
    const { rows, width } = toHalfBlocks(px, 4, 2);
    const emitted = rows[0]?.reduce((sum, seg) => sum + seg.ch.length, 0);

    expect(width).toBe(4);
    expect(emitted).toBe(4);
  });
});

describe('rgbaToPixels', () => {
  it('treats alpha below the threshold as transparent', () => {
    const data = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]);
    expect(rgbaToPixels(data, 2, 1)).toEqual([RED, null]);
  });

  it('honours a custom alpha threshold', () => {
    const data = new Uint8Array([255, 0, 0, 100]);
    expect(rgbaToPixels(data, 1, 1, 50)).toEqual([RED]);
    expect(rgbaToPixels(data, 1, 1, 200)).toEqual([null]);
  });

  it('zero-pads single-digit hex components', () => {
    const data = new Uint8Array([11, 0, 5, 255]);
    expect(rgbaToPixels(data, 1, 1)).toEqual(['#0b0005']);
  });
});

describe('charGridToPixels', () => {
  it('maps palette characters and treats unknown ones as transparent', () => {
    const { px, w, h } = charGridToPixels(['.R', 'R.'], { R: RED });

    expect([w, h]).toEqual([2, 2]);
    expect(px).toEqual([null, RED, RED, null]);
  });
});

describe('parseSvgPixelGrid', () => {
  it('expands multi-cell rect runs', () => {
    const svg = '<svg viewBox="0 0 10 1"><rect x="0" y="0" width="10" height="1" fill="#FF0000"/></svg>';
    const grid = parseSvgPixelGrid(svg);

    expect(grid?.px).toEqual(new Array(10).fill(RED));
  });

  it('lets later rects overpaint earlier ones', () => {
    const svg =
      '<svg viewBox="0 0 2 1">' +
      '<rect x="0" y="0" width="2" height="1" fill="#FF0000"/>' +
      '<rect x="1" y="0" width="1" height="1" fill="#0000FF"/>' +
      '</svg>';

    expect(parseSvgPixelGrid(svg)?.px).toEqual([RED, BLUE]);
  });

  it('lowercases fills so PNG and SVG sources agree', () => {
    const svg = '<svg viewBox="0 0 1 1"><rect fill="#FF87C3"/></svg>';
    expect(parseSvgPixelGrid(svg)?.px).toEqual(['#ff87c3']);
  });

  it('ignores fill="none" and clips out-of-bounds rects', () => {
    const svg =
      '<svg viewBox="0 0 2 1">' +
      '<rect x="0" y="0" width="1" height="1" fill="none"/>' +
      '<rect x="1" y="0" width="99" height="99" fill="#0000FF"/>' +
      '</svg>';

    expect(parseSvgPixelGrid(svg)?.px).toEqual([null, BLUE]);
  });

  it('returns null when there is no usable viewBox', () => {
    expect(parseSvgPixelGrid('<svg><rect fill="#FF0000"/></svg>')).toBeNull();
    expect(parseSvgPixelGrid('not svg at all')).toBeNull();
  });
});

describe('cropTransparent', () => {
  it('trims transparent margins on every edge', () => {
    // 4x3 with a single opaque pixel at (1,1).
    const px: Pixel[] = [null, null, null, null, null, RED, null, null, null, null, null, null];
    expect(cropTransparent(px, 4, 3)).toEqual({ px: [RED], w: 1, h: 1 });
  });

  it('returns an empty grid for fully transparent input', () => {
    expect(cropTransparent([null, null, null, null], 2, 2)).toEqual({ px: [], w: 0, h: 0 });
  });

  it('leaves art that already touches every edge untouched', () => {
    const px: Pixel[] = [RED, RED, RED, RED];
    expect(cropTransparent(px, 2, 2)).toEqual({ px, w: 2, h: 2 });
  });
});

describe('assets/logo.svg', () => {
  // Golden test: the banner silently degrades if the asset changes shape, so pin it.
  const svg = readFileSync(fileURLToPath(new URL('../../assets/logo.svg', import.meta.url)), 'utf8');
  const grid = parseSvgPixelGrid(svg);

  it('parses as a 16x16 grid', () => {
    expect(grid).not.toBeNull();
    expect([grid?.w, grid?.h]).toEqual([16, 16]);
  });

  it('has the expected eye pixels', () => {
    const at = (x: number, y: number) => grid?.px[y * 16 + x];
    expect(at(4, 7)).toBe('#ffffff');
    expect(at(5, 7)).toBe('#2b1b2e');
  });

  it('crops to 12 columns wide — the logo has transparent side margins', () => {
    const cropped = cropTransparent(grid!.px, grid!.w, grid!.h);
    expect(cropped.w).toBe(12);
    expect(cropped.h).toBe(16);
  });
});
