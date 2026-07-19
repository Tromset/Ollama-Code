import { afterEach, describe, expect, it, vi } from 'vitest';

// `sharp` is an optionalDependency, so the SVG fallback is the path that runs on any install
// without it. Nobody exercises that by hand — and a stray `sharp` in a parent node_modules
// makes it unreproducible from the shell — so mock the failure instead.
vi.mock('sharp', () => {
  throw new Error('sharp is not installed');
});

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
});

describe('loadLogo', () => {
  it('falls back to the SVG when sharp is unavailable', async () => {
    const { loadLogo } = await import('./logo');
    const { art, source } = await loadLogo();

    expect(source).toBe('svg');
    // The logo is a 16x16 grid with 2-column transparent margins, cropped to 12 wide,
    // then halved vertically into 8 terminal rows.
    expect(art?.width).toBe(12);
    expect(art?.height).toBe(8);
  });

  it('renders no logo when the terminal has no colour', async () => {
    const { loadLogo } = await import('./logo');

    vi.stubEnv('NO_COLOR', '1');
    await expect(loadLogo()).resolves.toEqual({ art: null, source: 'none' });

    vi.stubEnv('NO_COLOR', '');
    vi.stubEnv('TERM', 'dumb');
    await expect(loadLogo()).resolves.toEqual({ art: null, source: 'none' });
  });

  it('resolves assets relative to the package, not the cwd', async () => {
    const { assetPath } = await import('./logo');
    const previous = process.cwd();

    try {
      process.chdir('/');
      expect(assetPath('logo.png')).toMatch(/Ollama-Code\/assets\/logo\.png$/);
      // And it still loads from that path with a foreign cwd.
      const { loadLogo } = await import('./logo');
      expect((await loadLogo()).art).not.toBeNull();
    } finally {
      process.chdir(previous);
    }
  });
});
