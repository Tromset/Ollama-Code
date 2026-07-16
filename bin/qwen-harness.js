#!/usr/bin/env node
// Global CLI wrapper — resolves tsx from this package's node_modules so `npm link` works
// without requiring tsx to be installed globally.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxLocal = join(root, 'node_modules', '.bin', 'tsx');
const tsx = existsSync(tsxLocal) ? tsxLocal : 'tsx';
const entry = join(root, 'src', 'index.ts');

const result = spawnSync(tsx, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

process.exit(result.status ?? (result.error ? 1 : 0));
