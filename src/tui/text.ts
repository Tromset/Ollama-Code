// src/tui/text.ts — pure text helpers for the TUI.

export interface TailResult {
  /** The kept tail of the text. */
  text: string;
  /** Number of full lines trimmed off the top. */
  hidden: number;
}

/**
 * Keep only the last lines of `text` that fit within `maxRows` *terminal* rows, counting
 * soft wrapping: a line wider than `columns` occupies multiple rows.
 *
 * This exists to keep the live streaming region shorter than the terminal. When Ink's
 * dynamic frame grows taller than the window, Ink falls back to clearing the entire
 * terminal (including scrollback) and re-printing everything on every render — the source
 * of the banner flicker. Capping the tail keeps the frame small so that path never runs.
 */
export function tailLines(text: string, maxRows: number, columns: number): TailResult {
  if (!text) return { text, hidden: 0 };

  const width = Math.max(1, columns);
  const max = Math.max(1, maxRows);
  const lines = text.split('\n');
  const rowsOf = (line: string) => Math.max(1, Math.ceil(line.length / width));

  let rows = 0;
  let start = lines.length;
  while (start > 0 && rows + rowsOf(lines[start - 1] as string) <= max) {
    rows += rowsOf(lines[start - 1] as string);
    start--;
  }

  if (start === 0) return { text, hidden: 0 };

  const kept = lines.slice(start);
  if (kept.length === 0) {
    // The final line alone is wider than the whole budget: keep its last `max` visual rows.
    const last = lines[lines.length - 1] as string;
    return { text: last.slice(last.length - max * width), hidden: lines.length - 1 };
  }

  return { text: kept.join('\n'), hidden: start };
}
