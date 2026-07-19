// src/core/context.ts — context/token budget management.
//
// Small-model reliability: tool outputs are capped so a single noisy command can't blow the
// context window, and the conversation is compacted (summarized) once usage crosses ~75% of
// `cfg.numCtx`. Never throws — compaction degrades to a simple drop of older messages on failure.

import type { Config, Message } from './types';
import type { OllamaClient } from './client';

export interface ContextManager {
  capToolOutput(text: string): string;
  usage(messages: Message[]): { used: number; max: number; pct: number };
  maybeCompact(messages: Message[]): Promise<Message[]>;
}

const CAP_THRESHOLD = 8000;
const CAP_HEAD = 4000;
const CAP_TAIL = 2000;
const COMPACT_PCT_THRESHOLD = 75;
const KEEP_LAST = 6;
const CHARS_PER_TOKEN = 4;

// Render one message as a compact text line for the summarization prompt.
function serializeMessage(m: Message): string {
  const parts = [`role:${m.role}`];
  if (m.tool_name) parts.push(`tool:${m.tool_name}`);
  if (m.thinking) parts.push(`thinking:${m.thinking}`);
  if (m.content) parts.push(`content:${m.content}`);
  if (m.tool_calls && m.tool_calls.length > 0) {
    parts.push(`tool_calls:${JSON.stringify(m.tool_calls)}`);
  }
  return parts.join(' | ');
}

export function createContext(cfg: Config, client: OllamaClient): ContextManager {
  function capToolOutput(text: string): string {
    if (text.length <= CAP_THRESHOLD) return text;
    const head = text.slice(0, CAP_HEAD);
    const tail = text.slice(text.length - CAP_TAIL);
    const omitted = text.length - CAP_HEAD - CAP_TAIL;
    return `${head}\n…[truncated ${omitted} chars]…\n${tail}`;
  }

  function usage(messages: Message[]): { used: number; max: number; pct: number } {
    let chars = 0;
    for (const m of messages) {
      chars += (m.content?.length ?? 0) + (m.thinking?.length ?? 0);
    }
    const used = Math.ceil(chars / CHARS_PER_TOKEN);
    const max = cfg.numCtx;
    const pct = Math.round((used / max) * 100);
    return { used, max, pct };
  }

  async function maybeCompact(messages: Message[]): Promise<Message[]> {
    try {
      const { pct } = usage(messages);
      if (pct < COMPACT_PCT_THRESHOLD) return messages;

      // Split: leading system messages (kept verbatim) | middle (to summarize) | last N turns.
      let splitIdx = 0;
      while (splitIdx < messages.length && messages[splitIdx].role === 'system') splitIdx++;
      const systems = messages.slice(0, splitIdx);
      const rest = messages.slice(splitIdx);
      const keepCount = Math.min(KEEP_LAST, rest.length);
      const last = rest.slice(rest.length - keepCount);
      const middle = rest.slice(0, rest.length - keepCount);

      if (middle.length === 0) {
        // Nothing left to summarize — just drop nothing, return as split (no-op vs input).
        return [...systems, ...last];
      }

      try {
        const serialized = middle.map(serializeMessage).join('\n');
        const prompt =
          'Summarize the following conversation compactly, preserving key facts, file paths, and decisions:\n\n' +
          serialized;
        const stream = client.chat({
          model: cfg.model,
          numCtx: cfg.numCtx,
          think: false,
          messages: [{ role: 'user', content: prompt }],
        });
        let summary = '';
        for await (const chunk of stream) {
          if (chunk.content) summary += chunk.content;
        }
        const summaryMsg: Message = {
          role: 'assistant',
          content: '[Summary of the earlier conversation]\n' + summary,
        };
        return [...systems, summaryMsg, ...last];
      } catch {
        // Summarization failed — fall back to just dropping the oldest middle messages.
        return [...systems, ...last];
      }
    } catch {
      // Never throw: if anything unexpected happens, return messages unchanged.
      return messages;
    }
  }

  return { capToolOutput, usage, maybeCompact };
}
