// src/core/types.ts — shared domain types (the seam between all modules).
//
// This file holds ONLY type/interface declarations (no runtime code) so every factory
// module can import from it without creating a cycle. Factory functions (createClient,
// createRegistry, createPermissions, createContext, createSessionStore, createAgent) live
// in their own files and import their types from here.
//
// Shapes mirror Ollama's native POST /api/chat. See docs/CONTRACTS.md.

// ---- Chat / message model (mirrors Ollama /api/chat native shape) ----
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  thinking?: string; // assistant reasoning, streamed BEFORE content
  images?: string[]; // base64 (no data: prefix), for user messages in vision
  tool_calls?: ToolCall[]; // assistant tool calls (native shape below)
  tool_name?: string; // set on role:'tool' result messages
}

// Ollama native tool call: arguments are ALREADY a parsed object (not a JSON string).
// There is NO tool_call_id in the native API.
export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

// ---- Tools ----
export interface ToolContext {
  cwd: string; // project root the tools operate within
  signal?: AbortSignal; // cancellation
  permissions: PermissionChecker; // see permission types below
}

export interface ToolResult {
  ok: boolean;
  content: string; // text fed back to the model as role:'tool' content
  display?: string; // optional richer text for the TUI (defaults to content)
  meta?: Record<string, unknown>; // e.g. { path, bytes, matched: 'exact'|'whitespace'|'fuzzy' }
}

// A registered tool. `parameters` is JSON Schema derived from `zodSchema` via z.toJSONSchema (Zod 4).
export interface ToolDef {
  name: string;
  description: string; // KEEP SHORT (small-model reliability)
  zodSchema: import('zod').ZodType; // validates args before handler runs
  parameters: Record<string, unknown>; // JSON Schema sent to Ollama in `tools`
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

// ---- Modes / config ----
export type AgentMode = 'code' | 'chat' | 'vision' | 'plan';

export interface Capabilities {
  completion: boolean;
  vision: boolean;
  tools: boolean;
  thinking: boolean;
}

// One locally installed model, as reported by GET /api/tags (OllamaClient.listModels).
export interface ModelInfo {
  name: string; // e.g. "qwen3.5:latest"
  sizeBytes: number; // on-disk blob size
  parameterSize: string; // details.parameter_size, e.g. "8.2B"
  quantization: string; // details.quantization_level, e.g. "Q4_K_M"
  modifiedAt: string;
}

export interface Sampling {
  temperature: number; // 1
  top_p: number; // 0.95
  top_k: number; // 20
  presence_penalty: number; // 1.5
}

export interface Config {
  model: string; // default 'qwen3.5:latest'
  host: string; // default 'http://localhost:11434'
  numCtx: number; // default 32768 — MUST be sent on every request
  mode: AgentMode; // default 'code'
  maxTurns: number; // default 25
  sampling: Sampling; // Modelfile defaults, overridable
  think: boolean | 'low' | 'medium' | 'high'; // default true in code mode
  permissions: PermissionConfig; // see permission types below
  kvCacheType?: 'f16' | 'q8_0'; // maps to OLLAMA_KV_CACHE_TYPE hint
}

// ---- Permissions (shared: Config + ToolContext reference these) ----
export type Decision = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  pattern: string;
  decision: Decision;
}

export interface PermissionConfig {
  mode: 'plan' | 'normal' | 'yolo';
  // per-tool-category or per-path/bash-glob rules
  rules?: PermissionRule[];
}

export interface PermissionRequest {
  tool: string; // e.g. 'bash', 'write_file', 'edit_file'
  detail: string; // e.g. the command, or the target path
}

export interface PermissionChecker {
  check(req: PermissionRequest): Decision; // pure policy decision
  // Persist an upgraded rule (e.g. from an interactive "always allow"). Optional so callers
  // that only need the pure decision are unaffected.
  addRule?(rule: PermissionRule): void;
}
