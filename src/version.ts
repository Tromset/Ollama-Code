// src/version.ts — the package version, read from package.json so it can't drift.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

function readVersion(): string {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const version = (pkg as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();
