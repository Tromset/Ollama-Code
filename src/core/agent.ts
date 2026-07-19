// src/core/agent.ts — the agentic loop.
//
// Wires together the client, tool registry, permission checker, context manager, and session
// store into the single interactive loop described in docs/CONTRACTS.md §7.
//
// Key behaviors (see docs/CONTRACTS.md §7 and RUNTIME_API.md §4 for the full spec):
//   - Config fields are read LIVE at call time (never cached) since the TUI mutates the same
//     Config object via /mode, /model, etc.
//   - `messages` is exposed as a getter so it always reflects the latest array, including after
//     context compaction and turn-by-turn assistant/tool message pushes.
//   - Tool permission checks happen per tool_call, sequentially, with onToolStart firing BEFORE
//     the permission check/prompt so the TUI can render a preview (e.g. a diff) while asking.
//   - Persistence (session save + FT record append) is best-effort and never throws out of send().

import type { Config, Message, PermissionChecker, PermissionRequest, ToolCall, ToolResult } from './types';
import type { OllamaClient } from './client';
import type { ToolRegistry } from '../tools/registry';
import type { ContextManager } from './context';
import type { Session, SessionStore } from './session';
import { systemPrompt } from './prompts';

export interface AgentEvents {
  onThinking?(delta: string): void;
  onContent?(delta: string): void;
  onToolStart?(call: ToolCall): void;
  onToolResult?(call: ToolCall, res: ToolResult): void;
  onUsage?(u: { used: number; max: number; pct: number }): void;
  // Called when a tool needs approval; TUI resolves. Returns final decision + optional "always".
  onAskPermission?(req: PermissionRequest): Promise<{ decision: 'allow' | 'deny'; always?: boolean }>;
}

export interface Agent {
  send(userText: string, images?: string[]): Promise<void>; // runs the loop to completion (max turns)
  abort(): void;
  messages: Message[];
}

export function createAgent(deps: {
  client: OllamaClient;
  registry: ToolRegistry;
  permissions: PermissionChecker;
  context: ContextManager;
  session: SessionStore;
  config: Config;
  events: AgentEvents;
}): Agent {
  const { client, registry, permissions, context, session, config, events } = deps;

  const cwd = process.cwd();
  const sessionObj: Session = session.create(config.mode);

  let messages: Message[] = [];
  let aborted = false;

  // Per-tool-name detail extraction for permission requests (CONTRACTS §7 / build spec).
  function detailFor(call: ToolCall): string {
    const args = (call.function.arguments ?? {}) as Record<string, unknown>;
    switch (call.function.name) {
      case 'bash':
        return String(args.command);
      case 'read_file':
      case 'write_file':
      case 'edit_file':
        return String(args.path);
      case 'move_file':
        return `${args.from} -> ${args.to}`;
      case 'list_files':
        return String(args.path ?? args.glob ?? '.');
      case 'search':
        return String(args.query ?? '');
      default:
        return JSON.stringify(args);
    }
  }

  function abort(): void {
    aborted = true;
    client.abort();
  }

  async function send(userText: string, images?: string[]): Promise<void> {
    // (1) Upsert the leading system message for the CURRENT mode.
    const sys = systemPrompt(config.mode);
    if (messages.length === 0 || messages[0].role !== 'system') {
      messages = [{ role: 'system', content: sys }, ...messages];
    } else if (messages[0].content !== sys) {
      messages = [{ role: 'system', content: sys }, ...messages.slice(1)];
    }

    // (2) Push the user message.
    const userMsg: Message = {
      role: 'user',
      content: userText,
      ...(images?.length ? { images } : {}),
    };
    messages = [...messages, userMsg];

    // (3) Reset abort state; fresh AbortController for this send().
    aborted = false;
    const ctl = new AbortController();

    let success = false;
    let internalError: string | undefined;

    try {
      // (4) Loop up to config.maxTurns turns. Read maxTurns live each iteration.
      for (let turn = 0; turn < config.maxTurns; turn++) {
        // (a) Compact if needed; keep `messages` in sync with the compacted result.
        messages = await context.maybeCompact(messages);

        // (b) Tool schemas for the current mode.
        const schemas = registry.toolSchemas(config.mode);

        // (c) Call the model.
        const stream = client.chat({
          model: config.model,
          messages,
          numCtx: config.numCtx,
          think: config.think,
          sampling: config.sampling,
          tools: schemas.length ? schemas : undefined,
          signal: ctl.signal,
        });

        // (d) Accumulate across chunks.
        let thinking = '';
        let content = '';
        let toolCalls: ToolCall[] = [];
        let promptEvalCount: number | undefined;
        let evalCount: number | undefined;

        for await (const chunk of stream) {
          if (aborted) break;
          if (chunk.thinking) {
            thinking += chunk.thinking;
            events.onThinking?.(chunk.thinking);
          }
          if (chunk.content) {
            content += chunk.content;
            events.onContent?.(chunk.content);
          }
          if (chunk.tool_calls?.length) {
            toolCalls = toolCalls.concat(chunk.tool_calls);
          }
          if (chunk.done) {
            promptEvalCount = chunk.promptEvalCount;
            evalCount = chunk.evalCount;
          }
        }
        void evalCount; // captured per spec; not otherwise consumed here

        // (e) Emit usage: prefer real counts from the final chunk.
        if (promptEvalCount != null) {
          events.onUsage?.({
            used: promptEvalCount,
            max: config.numCtx,
            pct: Math.round((promptEvalCount / config.numCtx) * 100),
          });
        } else {
          events.onUsage?.(context.usage(messages));
        }

        // (f) Build & push the assistant message.
        const assistantMsg: Message = {
          role: 'assistant',
          content,
          ...(thinking ? { thinking } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        };
        messages = [...messages, assistantMsg];

        // (g) Aborted mid-stream -> stop the turn loop.
        if (aborted) break;

        // (h) Natural completion: no tool calls requested.
        if (toolCalls.length === 0) {
          success = true;
          break;
        }

        // (i) Otherwise, dispatch each tool call sequentially.
        for (const call of toolCalls) {
          events.onToolStart?.(call);

          const req: PermissionRequest = { tool: call.function.name, detail: detailFor(call) };
          let decision = permissions.check(req);

          if (decision === 'ask') {
            if (events.onAskPermission) {
              const r = await events.onAskPermission(req);
              decision = r.decision;
              if (r.always && r.decision === 'allow') {
                permissions.addRule?.({ pattern: req.detail, decision: 'allow' });
              }
            } else {
              decision = 'deny'; // no interactive handler: safe default
            }
          }

          let res: ToolResult;
          if (decision === 'deny') {
            res = {
              ok: false,
              content: `Permission denied by user/policy: ${req.tool} (${req.detail})`,
            };
          } else {
            res = await registry.dispatch(call, { cwd, signal: ctl.signal, permissions });
          }

          res = { ...res, content: context.capToolOutput(res.content) };
          events.onToolResult?.(call, res);

          messages = [...messages, { role: 'tool', tool_name: call.function.name, content: res.content }];
        }
        // (j) continue the loop (next turn).
      }
    } catch (err) {
      // An abort cuts the stream, which surfaces as a thrown AbortError — that's a clean
      // user cancellation, not an internal error, so only record genuine failures.
      if (!aborted) internalError = err instanceof Error ? err.message : String(err);
    }

    // (5) Surface either an internal error or a max-turns notice (never both, never silent).
    if (internalError) {
      messages = [...messages, { role: 'assistant', content: `[Internal error: ${internalError}]` }];
    } else if (!success && !aborted) {
      messages = [
        ...messages,
        { role: 'assistant', content: `[Reached max turns (${config.maxTurns}). Stopping.]` },
      ];
    }

    // (6) Persist: session save + FT record. Best-effort — never throw out of send().
    try {
      sessionObj.messages = messages;
      await session.save(sessionObj);
      await session.appendFtRecord({
        system: messages[0]?.content,
        tools: registry.toolSchemas(config.mode),
        messages,
        mode: config.mode,
        model: config.model,
        success: success && !internalError,
      });
    } catch {
      // Persistence failures must not throw out of send().
    }
  }

  return {
    send,
    abort,
    get messages(): Message[] {
      return messages;
    },
  };
}
