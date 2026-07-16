// src/tools/fs.test.ts — unit tests for applyStrReplace progressive matching.

import { describe, it, expect } from 'vitest';
import { applyStrReplace } from './fs';

describe('applyStrReplace', () => {
  it('rejects empty old string', () => {
    const r = applyStrReplace('hello', '', 'world');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });

  it('exact match replaces once', () => {
    const r = applyStrReplace('foo bar baz', 'bar', 'QUX');
    expect(r.ok).toBe(true);
    expect(r.result).toBe('foo QUX baz');
    expect(r.matched).toBe('exact');
  });

  it('exact match fails on duplicate occurrences', () => {
    const r = applyStrReplace('aaa aaa', 'aaa', 'b');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not unique/i);
  });

  it('whitespace-normalized match handles extra spaces', () => {
    const source = 'function   foo()  {\n  return 1;\n}';
    const oldStr = 'function foo() {\n  return 1;\n}';
    const r = applyStrReplace(source, oldStr, 'function foo() { return 2; }');
    expect(r.ok).toBe(true);
    expect(r.matched).toBe('whitespace');
    expect(r.result).toContain('return 2');
  });

  it('tolerates indentation differences across lines', () => {
    const source = '  line one\n    line two\n  line three  ';
    const oldStr = 'line one\nline two';
    const r = applyStrReplace(source, oldStr, 'replaced');
    expect(r.ok).toBe(true);
    expect(['whitespace', 'fuzzy']).toContain(r.matched);
    expect(r.result).toContain('replaced');
  });

  it('returns actionable error when not found', () => {
    const source = 'const x = 1;\nconst y = 2;';
    const r = applyStrReplace(source, 'const z = 3;', 'const z = 4;');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it('preserves surrounding content on exact replace', () => {
    const source = 'before\nTARGET\nafter';
    const r = applyStrReplace(source, 'TARGET', 'DONE');
    expect(r.ok).toBe(true);
    expect(r.result).toBe('before\nDONE\nafter');
  });
});
