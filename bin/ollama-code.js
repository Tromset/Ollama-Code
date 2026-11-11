#!/usr/bin/env node
// Global CLI wrapper — resolves tsx from this package's node_modules so `npm link` works
// without requiring tsx to be installed globally.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// `ollama-code update` is handled here, before tsx: it must work even when the sources or
// node_modules it is about to replace are broken.
if (process.argv[2] === 'update') {
  const { update } = await import('./update.js');
  process.exit(update(root));
}
const tsxLocal = join(root, 'node_modules', '.bin', 'tsx');
const tsx = existsSync(tsxLocal) ? tsxLocal : 'tsx';
const entry = join(root, 'src', 'index.ts');

// tsx resolves tsconfig.json from the cwd, so when launched from another directory it
// would miss this project's "jsx": "react-jsx" setting — pin it explicitly.
const tsconfig = join(root, 'tsconfig.json');

const result = spawnSync(tsx, ['--tsconfig', tsconfig, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

process.exit(result.status ?? (result.error ? 1 : 0));
