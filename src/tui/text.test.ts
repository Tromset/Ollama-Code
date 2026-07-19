import { describe, expect, it } from 'vitest';
import { tailLines } from './text';

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
