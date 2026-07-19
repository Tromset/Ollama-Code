import { describe, expect, it } from 'vitest';
import { renderBannerAnsi } from './banner';
import { artFromCharGrid } from './pixels';
import { WORDMARK, WORDMARK_SPLIT } from './theme';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

const logo = artFromCharGrid(['PP', 'PP', 'PP', 'PP'], { P: '#ff7ab8' }); // 2 cols × 2 rows

describe('renderBannerAnsi', () => {
  it('starts with a newline guard and ends with a blank separator line', () => {
    const out = renderBannerAnsi(logo, '0.1.0', 120);
    expect(out.startsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(true);
  });

  it('uses the full wordmark side by side on wide terminals', () => {
    const plain = stripAnsi(renderBannerAnsi(logo, '0.1.0', 120));
    expect(plain).toContain(stripAnsi(WORDMARK[0] as string));
    // logo (2 rows) beside text (5 wordmark + blank + subtitle = 7 rows) → 6 non-blank lines.
    expect(plain.split('\n').filter((l) => l.length > 0)).toHaveLength(6);
    expect(plain).toContain('▀'); // half-block pixels present
    expect(plain).toContain('v0.1.0');
  });

  it('falls back to the split wordmark on an 80-column terminal', () => {
    const plain = stripAnsi(renderBannerAnsi(logo, '0.1.0', 80));
    expect(plain).toContain(WORDMARK_SPLIT[0] as string);
    expect(plain).not.toContain(WORDMARK[0] as string);
  });

  it('stacks logo above plain text on very narrow terminals', () => {
    const plain = stripAnsi(renderBannerAnsi(logo, '0.1.0', 30));
    expect(plain).toContain('ollama-code');
    const lines = plain.split('\n');
    const logoLine = lines.findIndex((l) => l.includes('▀'));
    const textLine = lines.findIndex((l) => l.includes('ollama-code'));
    expect(logoLine).toBeGreaterThanOrEqual(0);
    expect(textLine).toBeGreaterThan(logoLine);
  });

  it('renders text only when there is no logo', () => {
    const plain = stripAnsi(renderBannerAnsi(null, '0.1.0', 120));
    expect(plain).not.toContain('▀');
    expect(plain).toContain(stripAnsi(WORDMARK[0] as string));
  });
});
