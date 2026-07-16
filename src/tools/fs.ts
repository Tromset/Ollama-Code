// src/tools/fs.ts — filesystem tools: read_file, write_file, edit_file, move_file.
//
// All handlers resolve paths against ctx.cwd and refuse to touch anything outside it,
// and hard-refuse any path whose basename mentions '.env' (defense-in-depth on top of
// core/permissions.ts). edit_file uses applyStrReplace's progressive matching
// (exact -> whitespace-normalized -> fuzzy) so a 8-9B model can retry on actionable errors.

import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { z } from 'zod';
import type { ToolDef, ToolContext, ToolResult } from '../core/types';

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

interface ResolvedOk {
  ok: true;
  resolved: string;
}
interface ResolvedErr {
  ok: false;
  error: string;
}

// Resolve `p` against ctx.cwd, rejecting escapes and any '.env'-ish basename.
function resolveSafe(ctx: ToolContext, p: string): ResolvedOk | ResolvedErr {
  const resolved = path.resolve(ctx.cwd, p);
  const rel = path.relative(ctx.cwd, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: `Refused: '${p}' resolves outside the project directory (${ctx.cwd}).` };
  }
  if (path.basename(resolved).includes('.env')) {
    return { ok: false, error: `Refused: '${p}' looks like an .env file; reading/writing env files is not allowed.` };
  }
  return { ok: true, resolved };
}

// ---------------------------------------------------------------------------
// applyStrReplace — pure, deterministic progressive string-replace matcher.
// exact -> whitespace-normalized -> fuzzy (line-trimmed). Unit-tested.
// ---------------------------------------------------------------------------

export interface StrReplaceResult {
  ok: boolean;
  result?: string;
  matched?: 'exact' | 'whitespace' | 'fuzzy';
  error?: string;
}

// All non-overlapping start indices of `needle` in `hay`.
function findAllOccurrences(hay: string, needle: string): number[] {
  const idxs: number[] = [];
  if (needle.length === 0) return idxs;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    idxs.push(idx);
    from = idx + needle.length;
  }
  return idxs;
}

// Collapse runs of whitespace to a single space, keeping a map back to the
// original string's [start,end) span for every character of the normalized string.
function normalizeWithMap(str: string): { normalized: string; mapStart: number[]; mapEnd: number[] } {
  let normalized = '';
  const mapStart: number[] = [];
  const mapEnd: number[] = [];
  let i = 0;
  const isWs = (ch: string) => /\s/.test(ch);
  while (i < str.length) {
    if (isWs(str[i])) {
      const start = i;
      while (i < str.length && isWs(str[i])) i++;
      normalized += ' ';
      mapStart.push(start);
      mapEnd.push(i);
    } else {
      normalized += str[i];
      mapStart.push(i);
      mapEnd.push(i + 1);
      i++;
    }
  }
  return { normalized, mapStart, mapEnd };
}

// Longest common substring length (DP) — used only to find a near-miss line for
// actionable "not found" errors, not on any hot path.
function longestCommonSubstringLength(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  let max = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > max) max = cur[j];
      }
    }
    prev = cur;
  }
  return max;
}

// Build an actionable "not found" error, including a nearby-lines hint when possible.
function buildNotFoundError(source: string, oldStr: string): string {
  const sourceLines = source.split('\n');
  const oldTrimmedLines = oldStr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const anchor = oldTrimmedLines[0] ?? oldStr.trim();
  if (!anchor) {
    return 'old string not found in file (it is empty/whitespace-only). Provide the exact text to replace.';
  }
  let bestIdx = -1;
  let bestScore = 0;
  const cap = Math.min(sourceLines.length, 5000); // guard against pathological file sizes
  for (let i = 0; i < cap; i++) {
    const score = longestCommonSubstringLength(sourceLines[i].trim(), anchor);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  const threshold = Math.min(6, anchor.length);
  if (bestIdx >= 0 && bestScore >= threshold && threshold > 0) {
    const from = Math.max(0, bestIdx - 1);
    const to = Math.min(sourceLines.length, bestIdx + 2);
    const context = sourceLines
      .slice(from, to)
      .map((l, i) => `${from + i + 1}: ${l}`)
      .join('\n');
    return `old string not found in file. Closest match near line ${bestIdx + 1}:\n${context}\nCheck exact whitespace/text and retry with more context.`;
  }
  return 'old string not found in file. Verify the exact text (including whitespace) and retry.';
}

export function applyStrReplace(source: string, oldStr: string, newStr: string): StrReplaceResult {
  if (oldStr.length === 0) {
    return { ok: false, error: 'old string must not be empty.' };
  }

  // 1) EXACT
  const exact = findAllOccurrences(source, oldStr);
  if (exact.length === 1) {
    const idx = exact[0];
    const result = source.slice(0, idx) + newStr + source.slice(idx + oldStr.length);
    return { ok: true, result, matched: 'exact' };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      error: `old string is not unique (${exact.length} matches); add more surrounding context to disambiguate.`,
    };
  }

  // 2) WHITESPACE-NORMALIZED
  // Collapsing all whitespace (incl. newlines) to single spaces can occasionally make two
  // genuinely distinct source spans look identical (over-collapsing). When that happens we
  // don't give up immediately — fuzzy (tier 3) applies a stricter, line-count-aware match
  // that can disambiguate — so a non-unique whitespace result is remembered and only
  // surfaced if tier 3 can't resolve it either.
  let wsNonUniqueError: string | undefined;
  const normalizedOld = oldStr.trim().replace(/\s+/g, ' ');
  if (normalizedOld.length > 0) {
    const { normalized: normSource, mapStart, mapEnd } = normalizeWithMap(source);
    const wsMatches = findAllOccurrences(normSource, normalizedOld);
    if (wsMatches.length === 1) {
      const start = wsMatches[0];
      const end = start + normalizedOld.length; // exclusive, in normalized space
      const origStart = mapStart[start];
      const origEnd = mapEnd[end - 1];
      const result = source.slice(0, origStart) + newStr + source.slice(origEnd);
      return { ok: true, result, matched: 'whitespace' };
    }
    if (wsMatches.length > 1) {
      wsNonUniqueError = `old string is not unique after whitespace normalization (${wsMatches.length} matches); add more surrounding context to disambiguate.`;
    }
  }

  // 3) FUZZY (line-by-line, each line trimmed)
  const oldLinesTrimmed = oldStr
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map((l) => l.trim());
  const hasContent = oldLinesTrimmed.some((l) => l.length > 0);
  if (hasContent) {
    const sourceLines = source.split('\n');
    const len = oldLinesTrimmed.length;
    const matchesAt: number[] = [];
    for (let s = 0; s + len <= sourceLines.length; s++) {
      let matchAll = true;
      for (let k = 0; k < len; k++) {
        if (sourceLines[s + k].trim() !== oldLinesTrimmed[k]) {
          matchAll = false;
          break;
        }
      }
      if (matchAll) matchesAt.push(s);
    }
    if (matchesAt.length === 1) {
      const s = matchesAt[0];
      const lineOffsets: number[] = [];
      let offset = 0;
      for (const line of sourceLines) {
        lineOffsets.push(offset);
        offset += line.length + 1; // +1 for the '\n' joining this line to the next
      }
      // End of the matched block = end of the LAST matched line's own content, excluding its
      // trailing '\n' — this leaves that newline (the separator to whatever follows) untouched,
      // consistent with how the exact/whitespace tiers only ever consume the matched span itself.
      const startOffset = lineOffsets[s];
      const lastLine = sourceLines[s + len - 1];
      const endOffset = lineOffsets[s + len - 1] + lastLine.length;
      const result = source.slice(0, startOffset) + newStr + source.slice(endOffset);
      return { ok: true, result, matched: 'fuzzy' };
    }
    if (matchesAt.length > 1) {
      return {
        ok: false,
        error:
          wsNonUniqueError ??
          `old string is not unique (${matchesAt.length} fuzzy line matches); add more surrounding context to disambiguate.`,
      };
    }
  }

  // Whitespace tier was ambiguous and fuzzy couldn't disambiguate either (0 line-block matches).
  if (wsNonUniqueError) {
    return { ok: false, error: wsNonUniqueError };
  }

  // 4) NONE — actionable error, with a near-miss hint if we can find one.
  return { ok: false, error: buildNotFoundError(source, oldStr) };
}

// ---------------------------------------------------------------------------
// Tool defs
// ---------------------------------------------------------------------------

const readFileSchema = z.object({ path: z.string() });
export const readFileTool: ToolDef = {
  name: 'read_file',
  description: "Read a file's contents.",
  zodSchema: readFileSchema,
  parameters: z.toJSONSchema(readFileSchema),
  handler: async (args: z.infer<typeof readFileSchema>, ctx: ToolContext): Promise<ToolResult> => {
    const resolved = resolveSafe(ctx, args.path);
    if (!resolved.ok) return { ok: false, content: resolved.error };
    try {
      const content = await fsp.readFile(resolved.resolved, 'utf8');
      return { ok: true, content, meta: { path: resolved.resolved, bytes: Buffer.byteLength(content, 'utf8') } };
    } catch (err) {
      return { ok: false, content: `Could not read '${args.path}': ${(err as Error).message}` };
    }
  },
};

const writeFileSchema = z.object({ path: z.string(), content: z.string() });
export const writeFileTool: ToolDef = {
  name: 'write_file',
  description: 'Write content to a file (creates or overwrites).',
  zodSchema: writeFileSchema,
  parameters: z.toJSONSchema(writeFileSchema),
  handler: async (args: z.infer<typeof writeFileSchema>, ctx: ToolContext): Promise<ToolResult> => {
    const resolved = resolveSafe(ctx, args.path);
    if (!resolved.ok) return { ok: false, content: resolved.error };
    try {
      await fsp.mkdir(path.dirname(resolved.resolved), { recursive: true });
      await fsp.writeFile(resolved.resolved, args.content, 'utf8');
      const bytes = Buffer.byteLength(args.content, 'utf8');
      return { ok: true, content: `Wrote ${bytes} bytes to ${args.path}`, meta: { path: resolved.resolved, bytes } };
    } catch (err) {
      return { ok: false, content: `Could not write '${args.path}': ${(err as Error).message}` };
    }
  },
};

const editFileSchema = z.object({ path: z.string(), old: z.string(), new: z.string() });
export const editFileTool: ToolDef = {
  name: 'edit_file',
  description: 'Edit a file by replacing an exact old string with a new string.',
  zodSchema: editFileSchema,
  parameters: z.toJSONSchema(editFileSchema),
  handler: async (args: z.infer<typeof editFileSchema>, ctx: ToolContext): Promise<ToolResult> => {
    const resolved = resolveSafe(ctx, args.path);
    if (!resolved.ok) return { ok: false, content: resolved.error };
    let source: string;
    try {
      source = await fsp.readFile(resolved.resolved, 'utf8');
    } catch (err) {
      return { ok: false, content: `Could not read '${args.path}': ${(err as Error).message}` };
    }
    const applied = applyStrReplace(source, args.old, args.new);
    if (!applied.ok) {
      return { ok: false, content: applied.error ?? 'edit failed: old string not found or not unique.' };
    }
    try {
      await fsp.writeFile(resolved.resolved, applied.result!, 'utf8');
    } catch (err) {
      return { ok: false, content: `Could not write '${args.path}': ${(err as Error).message}` };
    }
    return { ok: true, content: `Edited ${args.path}`, meta: { matched: applied.matched } };
  },
};

const moveFileSchema = z.object({ from: z.string(), to: z.string() });
export const moveFileTool: ToolDef = {
  name: 'move_file',
  description: 'Move or rename a file.',
  zodSchema: moveFileSchema,
  parameters: z.toJSONSchema(moveFileSchema),
  handler: async (args: z.infer<typeof moveFileSchema>, ctx: ToolContext): Promise<ToolResult> => {
    const from = resolveSafe(ctx, args.from);
    if (!from.ok) return { ok: false, content: from.error };
    const to = resolveSafe(ctx, args.to);
    if (!to.ok) return { ok: false, content: to.error };
    try {
      await fsp.mkdir(path.dirname(to.resolved), { recursive: true });
      await fsp.rename(from.resolved, to.resolved);
      return { ok: true, content: `Moved ${args.from} to ${args.to}`, meta: { from: from.resolved, to: to.resolved } };
    } catch (err) {
      return { ok: false, content: `Could not move '${args.from}' to '${args.to}': ${(err as Error).message}` };
    }
  },
};

export const fsTools: ToolDef[] = [readFileTool, writeFileTool, editFileTool, moveFileTool];
