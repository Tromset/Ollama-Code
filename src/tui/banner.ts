// src/tui/banner.ts — the startup banner, rendered to a plain ANSI string.
//
// The banner is printed directly to stdout *before* Ink takes over the terminal. Keeping it
// out of Ink's `<Static>` region means Ink can never reposition, race, or re-print it: the
// first frame Ink draws starts on a fresh line below the banner, and the banner scrolls away
// naturally as the conversation grows.

import chalk from 'chalk';
import type { PixelArt, PixelSegment } from './pixels';
import {
  PALETTE,
  SUBTITLE,
  WORDMARK,
  WORDMARK_SPLIT,
  WORDMARK_SPLIT_WIDTH,
  WORDMARK_WIDTH,
} from './theme';

function pixelRowToAnsi(row: PixelSegment[]): string {
  return row
    .map((seg) => {
      if (seg.fg && seg.bg) return chalk.hex(seg.fg).bgHex(seg.bg)(seg.ch);
      if (seg.fg) return chalk.hex(seg.fg)(seg.ch);
      if (seg.bg) return chalk.bgHex(seg.bg)(seg.ch);
      return seg.ch;
    })
    .join('');
}

/**
 * Render the mascot + wordmark banner as one ANSI string, mirroring the layout rules the
 * old `<Banner>` component used: full wordmark → two-line wordmark → plain text, side by
 * side with the logo when both fit, stacked otherwise.
 *
 * The string starts with a newline guard (so a partial line left on the terminal can't
 * bleed into the first pixel row) and ends with a blank line separating it from Ink's UI.
 */
export function renderBannerAnsi(
  logo: PixelArt | null,
  version: string,
  columns: number,
): string {
  const subtitle = `${SUBTITLE}   ·   v${version}`;
  const logoWidth = logo ? logo.width + 2 : 0;

  const wordmark =
    columns >= logoWidth + WORDMARK_WIDTH
      ? WORDMARK
      : columns >= logoWidth + WORDMARK_SPLIT_WIDTH
        ? WORDMARK_SPLIT
        : null;

  const textWidth = Math.max(1, columns - logoWidth);
  const fit = (line: string) =>
    line.length > textWidth ? line.slice(0, Math.max(0, textWidth - 1)) + '…' : line;

  const textLines = [
    ...(wordmark ?? ['ollama-code']).map((line) => chalk.bold.hex(PALETTE.pink)(fit(line))),
    '',
    chalk.hex(PALETTE.dim)(fit(subtitle)),
  ];

  const logoLines = logo ? logo.rows.map(pixelRowToAnsi) : [];
  const logoPad = ' '.repeat(logo ? logo.width : 0);
  const sideBySide = !logo || columns >= logoWidth + WORDMARK_SPLIT_WIDTH;

  const out: string[] = [];
  if (sideBySide) {
    const rows = Math.max(logoLines.length, textLines.length);
    for (let i = 0; i < rows; i++) {
      const left = logo ? (logoLines[i] ?? logoPad) + '  ' : '';
      const right = textLines[i] ?? '';
      out.push((left + right).trimEnd() === '' ? '' : left + right);
    }
  } else {
    out.push(...logoLines);
    out.push(...textLines.map((line) => (line ? '  ' + line : '')));
  }

  return '\n' + out.join('\n') + '\n\n';
}
