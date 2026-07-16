// src/tools/search.ts — list_files (glob) and search (ripgrep if available, else JS fallback).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolContext, ToolDef, ToolResult } from '../core/types';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const MAX_FILES = 500;
const MAX_MATCHES = 200;
const SEARCH_TIMEOUT_MS = 30_000;
const MAX_LINE_CHARS = 300;

// ---- shared helpers ----

// Resolve `rel` against `cwd`, refusing to escape the project root.
function resolveWithinCwd(cwd: string, rel?: string): string | null {
  const cwdAbs = path.resolve(cwd);
  const target = path.resolve(cwdAbs, rel || '.');
  if (target !== cwdAbs && !target.startsWith(cwdAbs + path.sep)) return null;
  return target;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

// Minimal glob -> RegExp: supports `**` (any depth incl. none), `*` (no slash), `?` (one char).
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++; // consume second '*'
        if (glob[i + 1] === '/') {
          re += '(?:.*/)?';
          i++; // consume the following '/'
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$(){}|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

// ---- list_files ----

const listFilesArgsSchema = z.object({
  glob: z.string().optional().describe("Glob pattern, e.g. '**/*.ts' (default '**/*')"),
  path: z.string().optional().describe('Subdirectory to list from (default project root)'),
});

async function listFiles(
  args: { glob?: string; path?: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const root = resolveWithinCwd(ctx.cwd, args.path);
  if (!root) return { ok: false, content: `Path "${args.path}" is outside the project directory.` };

  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    return { ok: false, content: `Path not found: ${args.path ?? '.'}` };
  }
  if (!stat.isDirectory()) return { ok: false, content: `Not a directory: ${args.path ?? '.'}` };

  const rootDir = root; // re-bind so the narrowed (non-null) type is visible inside walk()
  const matcher = globToRegExp(args.glob || '**/*');
  const results: string[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated || ctx.signal?.aborted) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated || ctx.signal?.aborted) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const abs = path.join(dir, entry.name);
        const relToRoot = toPosix(path.relative(rootDir, abs));
        if (!matcher.test(relToRoot)) continue;
        results.push(toPosix(path.relative(ctx.cwd, abs)));
        if (results.length >= MAX_FILES) {
          truncated = true;
          return;
        }
      }
    }
  }

  await walk(rootDir);

  if (ctx.signal?.aborted) return { ok: false, content: 'list_files cancelled.' };
  if (results.length === 0) return { ok: true, content: 'No files matched.', meta: { count: 0 } };

  const content = results.join('\n') + (truncated ? `\n[...truncated at ${MAX_FILES} files...]` : '');
  return { ok: true, content, meta: { count: results.length, truncated } };
}

export const listFilesTool: ToolDef = {
  name: 'list_files',
  description: 'Recursively list project files matching a glob.',
  zodSchema: listFilesArgsSchema,
  parameters: z.toJSONSchema(listFilesArgsSchema),
  handler: listFiles as ToolDef['handler'],
};

// ---- search ----

const searchArgsSchema = z.object({
  query: z.string().describe('Text (or regex, if regex:true) to search for'),
  path: z.string().optional().describe('Subdirectory to search (default project root)'),
  glob: z.string().optional().describe('Only search files matching this glob'),
  regex: z.boolean().optional().describe('Treat query as a regex (default: literal string)'),
});

function isRipgrepAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn('rg', ['--version']);
    child.on('error', () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve(code === 0);
    });
  });
}

function runRipgrep(
  query: string,
  searchRel: string,
  glob: string | undefined,
  regex: boolean,
  ctx: ToolContext,
): Promise<ToolResult> {
  const rgArgs = [
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    '--glob',
    '!node_modules/**',
    '--glob',
    '!.git/**',
    '--glob',
    '!dist/**',
  ];
  if (!regex) rgArgs.push('-F');
  if (glob) rgArgs.push('--glob', glob);
  rgArgs.push('--', query, searchRel);

  return new Promise<ToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn('rg', rgArgs, { cwd: ctx.cwd });

    const timer = setTimeout(() => child.kill('SIGKILL'), SEARCH_TIMEOUT_MS);
    const onAbort = () => child.kill('SIGKILL');
    ctx.signal?.addEventListener('abort', onAbort);

    child.stdout?.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d) => (stderr += d.toString('utf8')));

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);

      // rg exit code 0 = matches, 1 = no matches (not an error), 2+ = real error.
      if (code === 0 || code === 1) {
        const lines = stdout.split('\n').filter(Boolean);
        if (lines.length === 0) {
          resolve({ ok: true, content: 'No matches found.', meta: { count: 0 } });
          return;
        }
        const truncated = lines.length > MAX_MATCHES;
        const shown = lines.slice(0, MAX_MATCHES);
        const content =
          shown.join('\n') + (truncated ? `\n[...truncated at ${MAX_MATCHES} matches...]` : '');
        resolve({ ok: true, content, meta: { count: shown.length, truncated } });
      } else {
        resolve({ ok: false, content: `ripgrep failed: ${stderr.trim() || `exit code ${code}`}` });
      }
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
      resolve({ ok: false, content: `Failed to run ripgrep: ${err.message}` });
    });
    child.on('close', finish);
  });
}

async function runJsFallback(
  query: string,
  matchRe: RegExp | null,
  root: string,
  glob: string | undefined,
  ctx: ToolContext,
): Promise<ToolResult> {
  const pathMatcher = glob ? globToRegExp(glob) : null;
  const results: string[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated || ctx.signal?.aborted) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated || ctx.signal?.aborted) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      const relToRoot = toPosix(path.relative(root, abs));
      if (pathMatcher && !pathMatcher.test(relToRoot)) continue;

      let buf: Buffer;
      try {
        buf = await fs.readFile(abs);
      } catch {
        continue;
      }
      if (isBinary(buf)) continue;

      const outRel = toPosix(path.relative(ctx.cwd, abs));
      const lines = buf.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hit = matchRe ? matchRe.test(line) : line.includes(query);
        if (!hit) continue;
        results.push(`${outRel}:${i + 1}: ${line.trim().slice(0, MAX_LINE_CHARS)}`);
        if (results.length >= MAX_MATCHES) {
          truncated = true;
          break;
        }
      }
    }
  }

  await walk(root);

  if (ctx.signal?.aborted) return { ok: false, content: 'search cancelled.' };
  if (results.length === 0) return { ok: true, content: 'No matches found.', meta: { count: 0 } };

  const content =
    results.join('\n') + (truncated ? `\n[...truncated at ${MAX_MATCHES} matches...]` : '');
  return { ok: true, content, meta: { count: results.length, truncated } };
}

async function search(
  args: { query: string; path?: string; glob?: string; regex?: boolean },
  ctx: ToolContext,
): Promise<ToolResult> {
  const root = resolveWithinCwd(ctx.cwd, args.path);
  if (!root) return { ok: false, content: `Path "${args.path}" is outside the project directory.` };

  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    return { ok: false, content: `Path not found: ${args.path ?? '.'}` };
  }
  if (!stat.isDirectory()) return { ok: false, content: `Not a directory: ${args.path ?? '.'}` };

  let matchRe: RegExp | null = null;
  if (args.regex) {
    try {
      matchRe = new RegExp(args.query);
    } catch (err: any) {
      return { ok: false, content: `Invalid regex "${args.query}": ${err.message}` };
    }
  }

  const rgAvailable = await isRipgrepAvailable();
  if (rgAvailable) {
    const searchRel = toPosix(path.relative(ctx.cwd, root)) || '.';
    return runRipgrep(args.query, searchRel, args.glob, !!args.regex, ctx);
  }
  return runJsFallback(args.query, matchRe, root, args.glob, ctx);
}

export const searchTool: ToolDef = {
  name: 'search',
  description: 'Search file contents (ripgrep if available, else a JS fallback).',
  zodSchema: searchArgsSchema,
  parameters: z.toJSONSchema(searchArgsSchema),
  handler: search as ToolDef['handler'],
};

export const searchTools: ToolDef[] = [listFilesTool, searchTool];
