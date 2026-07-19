import { describe, expect, it } from 'vitest';
import { formatBytes, tailLines } from './text';

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes and megabytes as integers', () => {
    expect(formatBytes(2_500)).toBe('3 KB');
    expect(formatBytes(850_000_000)).toBe('850 MB');
  });

  it('formats gigabytes with one decimal', () => {
    expect(formatBytes(4_700_000_000)).toBe('4.7 GB');
  });

  it('returns ? for invalid input', () => {
    expect(formatBytes(Number.NaN)).toBe('?');
    expect(formatBytes(-1)).toBe('?');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('?');
  });
});

describe('tailLines', () => {
  it('returns short text untouched', () => {
    expect(tailLines('a\nb\nc', 5, 80)).toEqual({ text: 'a\nb\nc', hidden: 0 });
  });

  it('returns empty text untouched', () => {
    expect(tailLines('', 5, 80)).toEqual({ text: '', hidden: 0 });
  });

  it('keeps the last lines and reports how many were hidden', () => {
    const text = ['1', '2', '3', '4', '5'].join('\n');
    expect(tailLines(text, 2, 80)).toEqual({ text: '4\n5', hidden: 3 });
  });

  it('counts soft-wrapped rows against the budget', () => {
    // 200 chars at 80 columns = 3 rows, so with maxRows 4 only one more line fits.
    const long = 'x'.repeat(200);
    const text = ['a', 'b', long].join('\n');
    expect(tailLines(text, 4, 80)).toEqual({ text: `b\n${long}`, hidden: 1 });
  });

  it('hard-trims a single line wider than the whole budget', () => {
    const line = 'abcdefghij'; // 10 chars, 5 columns → 2 rows
    const res = tailLines(`first\n${line}`, 1, 5);
    expect(res.text).toBe('fghij');
    expect(res.hidden).toBe(1);
  });

  it('treats empty lines as one row each', () => {
    const text = ['a', '', '', 'b'].join('\n');
    expect(tailLines(text, 3, 80)).toEqual({ text: '\n\nb', hidden: 1 });
  });
});
