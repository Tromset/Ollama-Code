// `ollama-code update` — bring this installation up to date with one command.
//
// ollama-code is installed as a git clone linked with `npm link` (README, Step 3), so an
// update is a fast-forward `git pull` in that clone followed by `npm install`. This file is
// plain JavaScript run by node, with no dependency: it still works when the TypeScript
// sources or node_modules are broken, which is when an update is needed most.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'https://github.com/Tromset/Ollama-Code.git';

function run(cmd, args, cwd, capture = false) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32', // npm is npm.cmd on Windows
  });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim() };
}

function version(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '?';
  } catch {
    return '?';
  }
}

/** Update the installation at `root`. Returns the process exit code. */
export function update(root) {
  if (!existsSync(join(root, '.git'))) {
    console.error(
      `ollama-code is installed at ${root} as a copy, not as a git clone, so it cannot update itself.\n` +
        'Reinstall it from a clone:\n' +
        `  git clone ${REPO} ollama-code\n` +
        '  cd ollama-code && npm install && npm link',
    );
    return 1;
  }

  const head = () => run('git', ['rev-parse', '--short', 'HEAD'], root, true).out;
  const before = head();
  const beforeVersion = version(root);
  console.log(`Updating ollama-code ${beforeVersion} (${before}) in ${root}`);

  // --ff-only: never merge or rewrite. Local changes that conflict stop the update here,
  // with git's own message, and nothing is modified.
  if (!run('git', ['pull', '--ff-only'], root).ok) {
    console.error(
      '\nUpdate stopped: git could not fast-forward. Nothing was changed.\n' +
        `Check the clone with: git -C "${root}" status`,
    );
    return 1;
  }

  const after = head();
  if (after === before && existsSync(join(root, 'node_modules'))) {
    console.log(`Already up to date: ollama-code ${beforeVersion} (${before}).`);
    return 0;
  }

  console.log('Installing dependencies...');
  if (!run('npm', ['install', '--no-audit', '--no-fund'], root).ok) {
    console.error(`\nThe sources are updated but npm install failed. Run it again in ${root}.`);
    return 1;
  }

  console.log(`ollama-code updated: ${beforeVersion} (${before}) -> ${version(root)} (${after}).`);
  return 0;
}
