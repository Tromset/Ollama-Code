// src/media/logo.ts — load the ollama-code mascot as terminal half-block art.
//
// Resolution order: assets/logo.png via sharp → assets/logo.svg via a plain text parse →
// nothing. The SVG path is what keeps the banner alive when `sharp` (an optionalDependency)
// isn't installed — musl/Alpine, `npm i --no-optional` — and needs no native code.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import {
  cropTransparent,
  parseSvgPixelGrid,
  rgbaToPixels,
  toHalfBlocks,
  type PixelArt,
} from '../tui/pixels';

export type LogoSource = 'png' | 'svg' | 'none';

export interface LoadedLogo {
  art: PixelArt | null;
  source: LogoSource;
}

/** Resolve a path inside `assets/` relative to this module, not the user's cwd. */
export function assetPath(name: string): string {
  return fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));
}

/**
 * Load the logo, converted to half-blocks.
 *
 * Never rejects: a missing or corrupt asset degrades to `{ art: null }` rather than
 * blocking CLI startup.
 *
 * SVG is tried first — it is the pixel-art source of truth and requires no native deps.
 * PNG via sharp is a fallback for environments where the SVG asset is unavailable.
 */
export async function loadLogo(size = 16): Promise<LoadedLogo> {
  // Without colour the art is an unreadable blob of ▀ and ▄, so don't draw it at all.
  if (process.env.NO_COLOR || process.env.TERM === 'dumb') {
    return { art: null, source: 'none' };
  }

  const fromSvg = await loadSvg();
  if (fromSvg) return { art: fromSvg, source: 'svg' };

  const fromPng = await loadPng(size);
  if (fromPng) return { art: fromPng, source: 'png' };

  return { art: null, source: 'none' };
}

async function loadPng(size: number): Promise<PixelArt | null> {
  try {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(assetPath('logo.png'))
      // `nearest` and `fill` are both non-default: the default Lanczos kernel blurs pixel
      // art into mush, and the default `cover` fit would crop it.
      .resize(size, size, { kernel: 'nearest', fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return artFrom(rgbaToPixels(data, info.width, info.height), info.width, info.height);
  } catch {
    return null;
  }
}

async function loadSvg(): Promise<PixelArt | null> {
  try {
    const svg = await readFile(assetPath('logo.svg'), 'utf8');
    const grid = parseSvgPixelGrid(svg);
    return grid ? artFrom(grid.px, grid.w, grid.h) : null;
  } catch {
    return null;
  }
}

function artFrom(px: (string | null)[], w: number, h: number): PixelArt | null {
  const cropped = cropTransparent(px, w, h);
  if (cropped.w === 0 || cropped.h === 0) return null;
  return toHalfBlocks(cropped.px, cropped.w, cropped.h);
}
