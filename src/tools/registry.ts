// src/tools/registry.ts — aggregates all tool defs, filters by mode, and dispatches calls.
//
// This is the seam between the model's tool_calls and the actual tool handlers: it validates
// arguments with each tool's zod schema (small models often emit malformed args) and NEVER
// throws — every failure path resolves to a ToolResult so the agent loop can keep going.

import type { AgentMode, ToolCall, ToolContext, ToolDef, ToolResult } from '../core/types';
import { fsTools } from './fs';
import { searchTools } from './search';
import { bashTools } from './bash';

export interface ToolRegistry {
  list(mode: AgentMode): ToolDef[];
  toolSchemas(mode: AgentMode): Record<string, unknown>[];
  dispatch(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}

// Read-only tool names allowed in vision/plan modes.
const READ_ONLY_NAMES = new Set(['read_file', 'list_files', 'search']);

export function createRegistry(): ToolRegistry {
  // All registered tools: fs (4) + search (2) + bash (1) = 7 total.
  const allTools: ToolDef[] = [...fsTools, ...searchTools, ...bashTools];
  const byName = new Map<string, ToolDef>(allTools.map((t) => [t.name, t]));

  function list(mode: AgentMode): ToolDef[] {
    switch (mode) {
      case 'code':
        return allTools;
      case 'chat':
        return [];
      case 'vision':
      case 'plan':
        return allTools.filter((t) => READ_ONLY_NAMES.has(t.name));
      default:
        return [];
    }
  }

  function toolSchemas(mode: AgentMode): Record<string, unknown>[] {
    return list(mode).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async function dispatch(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const name = call.function.name;
    const tool = byName.get(name);
    if (!tool) {
      return { ok: false, content: `Unknown tool: ${name}` };
    }

    const parsed = tool.zodSchema.safeParse(call.function.arguments);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      return {
        ok: false,
        content:
          `Invalid arguments for tool '${name}':\n${issues}\n` +
          `Expected fields per JSON Schema: ${JSON.stringify(tool.parameters)}`,
      };
    }

    try {
      return await tool.handler(parsed.data, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Tool ${name} failed: ${message}` };
    }
  }

  return { list, toolSchemas, dispatch };
}
