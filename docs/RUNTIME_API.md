# RUNTIME_API.md — verified library surface + per-file export contracts

> Written *before* the implementation, after installing the dependencies and inspecting a live Ollama
> server and the installed type definitions. **These are facts, not guesses — build against them.**
> Read this together with `docs/CONTRACTS.md`. Shared types live in `src/core/types.ts`
> (import from `./types`, extensionless). Stack: TypeScript ESM via `tsx`, no build step.

---

## 0. Reference environment

- Node.js ≥ 22 with npm. A recent Ollama server at `http://localhost:11434` (reachable).
- Model `qwen3.5:latest`: `capabilities: ["completion","vision","tools","thinking"]`,
  `qwen35.context_length = 262144`. Modelfile params: `presence_penalty 1.5, temperature 1, top_k 20, top_p 0.95`.
- Dependencies: `ollama@0.6.x`, `zod@4.x`, `ink@6.x`, `react@19.2.x`, `typescript@5.x`,
  `tsx@4.x`, `vitest@2.x`, `@types/node@22`, `@types/react@19.2`, `sharp@0.33.x` (optional).

## 1. ollama-js 0.6.x — VERIFIED usage

```ts
import { Ollama } from 'ollama';            // named export (class). There is also a default singleton.
const ollama = new Ollama({ host });        // ONE instance per cancellable task (abort cuts ALL its streams)

// Streaming chat. Returns an AbortableAsyncIterator<ChatResponse> — for-await it.
const it = await ollama.chat({
  model,
  messages,                                 // Message[] — our core Message[] is structurally compatible
  tools,                                    // Tool[]: { type:'function', function:{ name, description, parameters } }
  think,                                    // boolean | 'low' | 'medium' | 'high'
  stream: true,
  options: { num_ctx: numCtx, temperature, top_p, top_k, presence_penalty }, // Partial<Options>
});
for await (const chunk of it) { /* chunk is a ChatResponse (see below) */ }

ollama.abort();                             // cancels all in-flight streams of THIS instance
const show = await ollama.show({ model });  // ShowResponse
```

**Verified interface shapes (from `node_modules/ollama/dist/shared/*.d.ts`):**

```ts
interface Message { role: string; content: string; thinking?: string;
  images?: Uint8Array[] | string[]; tool_calls?: ToolCall[]; tool_name?: string; }
interface ToolCall { function: { name: string; arguments: { [k: string]: any } }; }   // args ALREADY parsed
interface Tool { type: string; function: { name?; description?; parameters?: <JSON Schema> }; }
interface Options { num_ctx: number; temperature; top_p; top_k; presence_penalty; /* ...many more */ }
// Each streamed chunk:
interface ChatResponse { model; created_at; message: Message; done: boolean; done_reason;
  prompt_eval_count: number; eval_count: number; /* + durations */ }
interface ShowResponse { capabilities: string[]; model_info: Map<string,any>; parameters; template; /* ... */ }
```

**Streaming semantics:** each chunk's `message.content` / `message.thinking` is the **delta** for that chunk
(thinking streams BEFORE content). `message.tool_calls` appears on the assistant chunk when tools are called.
The final chunk has `done: true` and carries `prompt_eval_count` (context/prompt tokens) + `eval_count` (generated).
Our core `Message[]` (role union, images: string[], tool_calls, tool_name) passes directly as `messages`.

## 2. zod 4.x

`import { z } from 'zod';` — build schemas with `z.object({...})`, convert with **`z.toJSONSchema(schema)`**
(top-level function, verified present). Use the result as `ToolDef.parameters` (the JSON Schema sent to Ollama).

## 3. ink 6.x + React 19.2

`import { Box, Text, Static, render, useApp, useInput, useStdin, useStdout, useFocus } from 'ink';`
TSX compiles via `tsconfig` `"jsx": "react-jsx"` (no `import React` needed). `render(<App/>)` with alternate
screen. Use `useInput` for keypresses (approval prompts, slash commands).

---

## 4. Per-file export contracts (so independently written files link up)

Every file below imports shared types from `./types` (or `../core/types`). Extensionless imports.
**Do not change these export names** — sibling files import them by these exact names.

### `src/core/config.ts`
- `export const DEFAULT_CONFIG: Config` — model `'qwen3.5:latest'`, host `'http://localhost:11434'`,
  numCtx `32768`, mode `'code'`, maxTurns `25`, sampling `{temperature:1, top_p:0.95, top_k:20, presence_penalty:1.5}`,
  think `true`, permissions `{ mode:'normal', rules:[] }`.
- `export function defaultThinkFor(mode: AgentMode): Config['think']` — `true` for code, else `false`.
- `export function loadConfig(overrides?: Partial<Config>): Config` — merge order
  DEFAULT_CONFIG ← `~/.ollama-code/config.json` ← `./.ollama-code.json` ← overrides. Never throws on missing files.

### `src/core/client.ts` (imports `./types`)
- `export interface ChatParams { model: string; messages: Message[]; tools?: Record<string,unknown>[];
  think?: boolean|'low'|'medium'|'high'; numCtx: number; sampling?: Partial<Sampling>; signal?: AbortSignal }`
- `export interface ChatChunk { thinking?: string; content?: string; tool_calls?: ToolCall[]; done: boolean;
  promptEvalCount?: number; evalCount?: number }`
- `export interface OllamaClient { chat(p: ChatParams): AsyncGenerator<ChatChunk>;
  detectCapabilities(model: string): Promise<Capabilities>; listModels(): Promise<ModelInfo[]>; abort(): void }`
- `export function createClient(cfg: Pick<Config,'host'>): OllamaClient`
- Holds ONE `new Ollama({host})`. `chat` maps ChatParams → `ollama.chat({..., stream:true, options:{num_ctx,...sampling}})`,
  yields deltas; final chunk sets `done, promptEvalCount, evalCount`. Wire `signal` → `abort()`.
  `detectCapabilities` → `ollama.show({model})`, map `capabilities[]` string list into the `Capabilities` booleans.
  `listModels` → `ollama.list()` (GET /api/tags): map each `models[]` entry (`name`, `size`,
  `details.parameter_size`, `details.quantization_level`, `modified_at`) into `ModelInfo`, sorted recent first.
  Note: `modified_at` is typed `Date` by ollama-js but is a plain string at runtime — normalize with `String()`.

### `src/core/prompts.ts` (imports `./types`)
- `export function systemPrompt(mode: AgentMode): string` — SHORT prompt per category (code/chat/vision/plan).

### `src/core/permissions.ts` (imports `./types`)
- `export function createPermissions(cfg: PermissionConfig): PermissionChecker`
- Hard rules (always win): deny any read/write touching `.env`; deny destructive bash (`rm -rf`, `mkfs`, `dd`,
  `:(){`, `> /dev/sd*`, etc.); **plan mode denies ALL writes + bash** (read-only); yolo allows all EXCEPT the
  hard `.env`/destructive denies. `normal`: use `rules[]` (glob match on `req.detail`), default `ask` for
  write/edit/move/bash, `allow` for reads. `addRule` appends to `rules`.

### `src/core/context.ts` (imports `./types` + `OllamaClient` from `./client`)
- `export interface ContextManager { capToolOutput(text: string): string;
  usage(messages: Message[]): { used: number; max: number; pct: number };
  maybeCompact(messages: Message[]): Promise<Message[]> }`
- `export function createContext(cfg: Config, client: OllamaClient): ContextManager`
- `capToolOutput`: truncate very large outputs (keep head+tail, note omitted bytes). `usage`: estimate tokens
  (~4 chars/token) vs `cfg.numCtx`. `maybeCompact`: at ≥75% usage, summarize older messages (keep system + last
  few turns) via a `client.chat` compaction call; else return messages unchanged.

### `src/core/session.ts` (imports `./types`)
- `export interface Session { id: string; createdAt: string; mode: AgentMode; messages: Message[] }`
- `export interface SessionStore { create(mode): Session; save(s): Promise<void>;
  list(): Promise<{id;createdAt;title?}[]>; load(id): Promise<Session>; appendFtRecord(rec: unknown): Promise<void> }`
- `export function createSessionStore(dir: string): SessionStore` — JSON per session under `dir`, plus an
  append-only `finetune.jsonl` for FT records (system prompt, tool schemas, messages w/ tool_calls objects, success flag).

### `src/media/images.ts`
- `export function imageToBase64(path: string, maxDim?: number): Promise<string>` — read file → base64 (NO `data:`
  prefix). If `sharp` importable, resize to `maxDim` (default 1024) longest side; else return raw base64 (degrade gracefully).

### `src/tools/fs.ts` (imports `../core/types`)
- `export const readFileTool: ToolDef` (`read_file`), `writeFileTool` (`write_file`), `editFileTool` (`edit_file`),
  `moveFileTool` (`move_file`); `export const fsTools: ToolDef[]` = all four.
- `export function applyStrReplace(source: string, oldStr: string, newStr: string):
  { ok: boolean; result?: string; matched?: 'exact'|'whitespace'|'fuzzy'; error?: string }` — PROGRESSIVE match
  (exact → whitespace-normalized → fuzzy), ACTIONABLE error messages when it fails (this is unit-tested).
- `edit_file` uses `applyStrReplace`. All handlers confine paths within `ctx.cwd` and HARD-refuse `.env` (defense-in-depth).

### `src/tools/search.ts` (imports `../core/types`)
- `export const listFilesTool: ToolDef` (`list_files`, glob), `searchTool` (`search`, ripgrep if on PATH else JS
  fallback); `export const searchTools: ToolDef[]` = both.

### `src/tools/bash.ts` (imports `../core/types`)
- `export const bashTool: ToolDef` (`bash`: timeout ~120s, cwd = `ctx.cwd`, truncated output);
  `export const bashTools: ToolDef[]` = [bashTool].

### `src/tools/registry.ts` (imports `../core/types`, `./fs`, `./search`, `./bash`)
- `export function createRegistry(): ToolRegistry` (interface `ToolRegistry` is in `types.ts`).
- Mode filter: **code** = all 7 tools; **chat** = none; **vision** = read-only set
  {`read_file`,`list_files`,`search`}; **plan** = read-only set {`read_file`,`list_files`,`search`}.
- `toolSchemas(mode)` returns OpenAI-format array: `{ type:'function', function:{ name, description, parameters } }`.
- `dispatch(call, ctx)`: find tool by `call.function.name`; zod-validate `call.function.arguments`; on failure
  return `{ok:false, content:<actionable msg>}` (do NOT throw); else run handler, catching thrown errors into `{ok:false}`.

### `src/core/agent.ts` (imports client, registry, permissions, context, session, prompts, types)
- `export function createAgent(deps): Agent` per CONTRACTS §7. Owns the interactive permission flow:
  before dispatching a tool, call `permissions.check`; on `'ask'` call `events.onAskPermission` (which may return
  `always` → `permissions.addRule`). Accumulate thinking/content/tool_calls per turn; push assistant + `role:'tool'`
  messages; `context.capToolOutput` on results; `context.maybeCompact` between turns; `events.onUsage`; loop ≤ maxTurns;
  persist via session + append FT record with success flag.
