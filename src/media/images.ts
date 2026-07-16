// src/media/images.ts — image file -> base64 for Ollama vision messages.
//
// Ollama expects raw base64 (no `data:` prefix) in `messages[].images`. We downscale with
// `sharp` when available (keeps requests small / within context), and degrade gracefully to
// raw file bytes when `sharp` isn't installed or fails to load.

import { readFile } from 'fs/promises';

/**
 * Read an image file and return it as base64, resized so its longest side is at most
 * `maxDim` pixels (never enlarged). Falls back to the raw file bytes if `sharp` is
 * unavailable or fails.
 */
export async function imageToBase64(path: string, maxDim = 1024): Promise<string> {
  const buffer = await readFile(path);

  try {
    const sharp = (await import('sharp')).default;
    const resized = await sharp(buffer)
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    return resized.toString('base64');
  } catch {
    // sharp not installed, or failed to process (e.g. unsupported format) — degrade gracefully.
    return buffer.toString('base64');
  }
}
