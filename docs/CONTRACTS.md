# CONTRACTS.md — cross-module seams (source of truth for all build agents)

> Read this **and** `PLAN.md` before writing any code. These TypeScript interfaces are the
> seams between build waves. Do not change a signature here without a very good reason; if you
> must, note it clearly in your final report so downstream waves adapt.
>
> Stack: TypeScript ESM, run via `tsx` (no build step). `tsconfig` uses
> `"moduleResolution": "Bundler"` so imports are **extensionless** (`from './client'`, not `./client.js`).
> Ollama access: native `POST /api/chat` (NOT the OpenAI `/v1` endpoint), via the official `ollama` npm lib.

---

## 1. Shared types — `src/core/types.ts` (Wave 1 owns this file)

```ts
// ---- Chat / message model (mirrors Ollama /api/chat native shape) ----
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  thinking?: string;        // assistant reasoning, streamed BEFORE content
  images?: string[];        // base64 (no data: prefix), for user messages in vision
  tool_calls?: ToolCall[];  // assistant tool calls (native shape below)
  tool_name?: string;       // set on role:'tool' result messages
}

// Ollama native tool call: arguments are ALREADY a parsed object (not a JSON string).
// There is NO tool_call_id in the native API.
export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

// ---- Tools ----
export interface ToolContext {
  cwd: string;                          // project root the tools operate within
  signal?: AbortSignal;                 // cancellation
  permissions: PermissionChecker;       // see §4
}

export interface ToolResult {
  ok: boolean;
  content: string;                      // text fed back to the model as role:'tool' content
  display?: string;                     // optional richer text for the TUI (defaults to content)
  meta?: Record<string, unknown>;       // e.g. { path, bytes, matched: 'exact'|'whitespace'|'fuzzy' }
}

// A registered tool. `parameters` is JSON Schema derived from `zodSchema` via z.toJSONSchema (Zod 4).
export interface ToolDef {
  name: string;
  description: string;                  // KEEP SHORT (small-model reliability)
  zodSchema: import('zod').ZodType;     // validates args before handler runs
  parameters: Record<string, unknown>;  // JSON Schema sent to Ollama in `tools`
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

export interface Config {
  model: string;                 // default 'qwen3.5:latest'
  host: string;                  // default 'http://localhost:11434'
  numCtx: number;                // default 32768 — MUST be sent on every request
  mode: AgentMode;               // default 'code'
  maxTurns: number;              // default 25
  sampling: {                    // Modelfile defaults, overridable
    temperature: number;         // 1
    top_p: number;               // 0.95
    top_k: number;               // 20
    presence_penalty: number;    // 1.5
  };
  think: boolean | 'low' | 'medium' | 'high'; // default true in code mode
  permissions: PermissionConfig; // see §4
  kvCacheType?: 'f16' | 'q8_0';  // maps to OLLAMA_KV_CACHE_TYPE hint
}
```

## 2. Client — `src/core/client.ts` (Wave 1)

Wrapper over the `ollama` npm lib. **One client instance per cancellable task** (abort() cuts all streams
of an instance). Always send `options.num_ctx`.

```ts
export interface ChatParams {
  model: string;
  messages: Message[];
  tools?: Record<string, unknown>[];       // JSON Schema tool defs (OpenAI-format array)
  think?: boolean | 'low' | 'medium' | 'high';
  numCtx: number;                          // -> options.num_ctx
  sampling?: Partial<Config['sampling']>;
  signal?: AbortSignal;
}

// One streamed step. Yields deltas; the final chunk carries usage + done.
export interface ChatChunk {
  thinking?: string;      // delta
  content?: string;       // delta
  tool_calls?: ToolCall[];// present on the final assistant chunk when tools are called
  done: boolean;
  promptEvalCount?: number; // final chunk: prompt tokens (context usage)
  evalCount?: number;       // final chunk: generated tokens
}

export interface OllamaClient {
  chat(p: ChatParams): AsyncGenerator<ChatChunk>;
  detectCapabilities(model: string): Promise<Capabilities>; // via /api/show
  abort(): void;
}

export function createClient(cfg: Pick<Config, 'host'>): OllamaClient;
```

The agent loop is responsible for **accumulating** `thinking` + `content` + `tool_calls` across chunks
into one assistant `Message` and pushing it to history, then pushing `role:'tool'` results.

## 3. Registry — `src/tools/registry.ts` (Wave 2A)

```ts
export interface ToolRegistry {
  list(mode: AgentMode): ToolDef[];              // filters tools by mode (see §6 of PLAN)
  toolSchemas(mode: AgentMode): Record<string, unknown>[]; // JSON Schema array for ChatParams.tools
  dispatch(call: ToolCall, ctx: ToolContext): Promise<ToolResult>; // validates via zod, runs handler,
                                                                    // returns actionable error as {ok:false}
}
export function createRegistry(): ToolRegistry;
```
Validation failures and tool errors are returned as `ToolResult{ ok:false, content: <actionable message> }`
so the model can retry — they are NOT thrown.

## 4. Permissions — `src/core/permissions.ts` (Wave 2B)

```ts
export type Decision = 'allow' | 'ask' | 'deny';
export interface PermissionConfig {
  mode: 'plan' | 'normal' | 'yolo';
  // per-tool-category or per-path/bash-glob rules
  rules?: { pattern: string; decision: Decision }[];
}
export interface PermissionRequest {
  tool: string;                 // e.g. 'bash', 'write_file', 'edit_file'
  detail: string;               // e.g. the command, or the target path
}
export interface PermissionChecker {
  check(req: PermissionRequest): Decision;   // pure policy decision
}
export function createPermissions(cfg: PermissionConfig): PermissionChecker;
```
Hard rules: **`.env` reads/writes denied**; destructive bash (`rm -rf`, etc.) denied; **plan mode denies all
writes/bash** (read-only). `ask` decisions are resolved interactively by the TUI (Wave 4), which may upgrade
a rule to `allow` ("always"). The agent loop calls `check()`; on `ask` it invokes a callback the TUI provides.

## 5. Context budget — `src/core/context.ts` (Wave 2B)

```ts
export interface ContextManager {
  capToolOutput(text: string): string;               // truncate large tool outputs
  usage(messages: Message[]): { used: number; max: number; pct: number };
  maybeCompact(messages: Message[]): Promise<Message[]>; // compact at ~75% of numCtx
}
export function createContext(cfg: Config, client: OllamaClient): ContextManager;
```

## 6. Session + FT log — `src/core/session.ts` (Wave 2B)

Persist sessions AND append a JSONL fine-tuning log from day one: system prompt, tool schemas,
messages with `tool_calls` as objects, and a success/failure flag per session.

```ts
export interface Session { id: string; createdAt: string; mode: AgentMode; messages: Message[]; }
export interface SessionStore {
  create(mode: AgentMode): Session;
  save(s: Session): Promise<void>;
  list(): Promise<{ id: string; createdAt: string; title?: string }[]>;
  load(id: string): Promise<Session>;
  appendFtRecord(rec: unknown): Promise<void>;         // -> JSONL
}
export function createSessionStore(dir: string): SessionStore;
```

## 7. Agent loop — `src/core/agent.ts` (Wave 3)

```ts
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
  client: OllamaClient; registry: ToolRegistry; permissions: PermissionChecker;
  context: ContextManager; session: SessionStore; config: Config; events: AgentEvents;
}): Agent;
```

## 8. Media — `src/media/images.ts` (Wave 2B)

```ts
// Read image file -> base64 (no data: prefix), resized to a sane max dimension for the model.
export function imageToBase64(path: string, maxDim?: number): Promise<string>;
```

## 9. TUI — `src/tui/*` (Wave 4) + entry `src/index.ts`

Ink app (React 19.2, alternate screen). Renders streamed thinking (collapsible), content, tool calls,
a **diff preview before writes**, and an approval prompt (`y` / `n` / `a`=always). Status bar shows mode,
model, and **context usage** (used/max from the final chunk). Slash commands:
`/mode /model /image /clear /sessions /permissions /help`. `src/index.ts` parses args and launches the TUI.

---

### npm deps to expect
`ollama`, `zod` (v4, for `z.toJSONSchema`), `ink`, `react` (>=19.2), and `tsx` + `typescript` +
`vitest` + `@types/node` as dev. Use `sharp` for image resize if available; otherwise degrade gracefully.
