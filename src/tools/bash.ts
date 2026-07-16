// src/tools/bash.ts — run a shell command with a timeout, truncated output.
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { ToolContext, ToolDef, ToolResult } from '../core/types';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 20_000;

const bashArgsSchema = z.object({
  command: z.string().describe('Shell command to run'),
  timeout: z.number().int().positive().optional().describe('Timeout in ms (default 120000)'),
});

// Keep head+tail when output exceeds the cap, noting what was omitted.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  const head = text.slice(0, half);
  const tail = text.slice(text.length - half);
  const omitted = text.length - head.length - tail.length;
  return `${head}\n[...${omitted} chars omitted...]\n${tail}`;
}

async function runBash(args: { command: string; timeout?: number }, ctx: ToolContext): Promise<ToolResult> {
  const timeoutMs = args.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ToolResult>((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(args.command, {
      shell: true,
      cwd: ctx.cwd,
    });

    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const onAbort = () => {
      child.kill('SIGKILL');
    };
    ctx.signal?.addEventListener('abort', onAbort);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
      const combined = truncate(output, MAX_OUTPUT_CHARS);
      const suffix = `\n[exit ${code}${timedOut ? ' — TIMED OUT' : ''}]`;
      resolve({
        ok: code === 0 && !timedOut,
        content: combined + suffix,
        meta: { exitCode: code, timedOut },
      });
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
      resolve({
        ok: false,
        content: `Failed to run command: ${err.message}`,
      });
    });

    child.on('close', (code) => finish(code));
  });
}

export const bashTool: ToolDef = {
  name: 'bash',
  description: 'Run a shell command in the project directory.',
  zodSchema: bashArgsSchema,
  parameters: z.toJSONSchema(bashArgsSchema),
  handler: runBash,
};

export const bashTools: ToolDef[] = [bashTool];
