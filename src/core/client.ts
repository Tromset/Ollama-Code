// src/core/client.ts — thin wrapper over ollama-js 0.6.3.
//
// Uses the native POST /api/chat endpoint only (never the OpenAI /v1 shim — see DOCUMENTATION.md §2.1).
// Holds exactly ONE `Ollama` instance per client, because `ollama.abort()` cuts every
// in-flight stream on that instance (one client per cancellable task).

import { Ollama } from 'ollama';
import type { ChatResponse, Message as OllamaMessage, Tool as OllamaTool } from 'ollama';
import type { Capabilities, Config, Message, ModelInfo, ToolCall } from './types';

// ---- Public contract (docs/CONTRACTS.md §2 / RUNTIME_API.md §4) ----

export interface ChatParams {
  model: string;
  messages: Message[];
  tools?: Record<string, unknown>[]; // JSON Schema tool defs (OpenAI-format array), passed straight through
  think?: boolean | 'low' | 'medium' | 'high';
  numCtx: number; // -> options.num_ctx
  sampling?: Partial<Config['sampling']>;
  signal?: AbortSignal;
}

// One streamed step. Yields deltas; the final chunk carries usage + done.
export interface ChatChunk {
  thinking?: string; // delta
  content?: string; // delta
  tool_calls?: ToolCall[]; // present on the final assistant chunk when tools are called
  done: boolean;
  promptEvalCount?: number; // final chunk: prompt tokens (context usage)
  evalCount?: number; // final chunk: generated tokens
}

export interface OllamaClient {
  chat(p: ChatParams): AsyncGenerator<ChatChunk>;
  detectCapabilities(model: string): Promise<Capabilities>; // via /api/show
  listModels(): Promise<ModelInfo[]>; // via /api/tags, recent first
  abort(): void;
}

export function createClient(cfg: Pick<Config, 'host'>): OllamaClient {
  return new OllamaClientImpl(cfg.host);
}

// ---- Implementation ----

class OllamaClientImpl implements OllamaClient {
  private readonly ollama: Ollama;

  constructor(host: string) {
    this.ollama = new Ollama({ host });
  }

  async *chat(p: ChatParams): AsyncGenerator<ChatChunk> {
    // If already aborted, don't even start the request.
    if (p.signal?.aborted) return;

    // Wire external cancellation (AbortSignal) to this client's own abort(), which cuts
    // all of this Ollama instance's in-flight streams.
    const onAbort = () => this.abort();
    p.signal?.addEventListener('abort', onAbort);

    try {
      const it = await this.ollama.chat({
        model: p.model,
        messages: p.messages as unknown as OllamaMessage[],
        tools: p.tools as unknown as OllamaTool[] | undefined,
        think: p.think,
        stream: true,
        options: {
          num_ctx: p.numCtx,
          ...p.sampling,
        },
      });

      for await (const chunk of it as AsyncIterable<ChatResponse>) {
        yield {
          thinking: chunk.message.thinking,
          content: chunk.message.content,
          tool_calls: chunk.message.tool_calls as unknown as ToolCall[] | undefined,
          done: chunk.done,
          promptEvalCount: chunk.prompt_eval_count,
          evalCount: chunk.eval_count,
        };
      }
    } finally {
      p.signal?.removeEventListener('abort', onAbort);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.ollama.list();
    return res.models
      .map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        parameterSize: m.details?.parameter_size ?? '',
        quantization: m.details?.quantization_level ?? '',
        // Typed `Date` in ollama-js, but a plain JSON string at runtime (no date revival) —
        // String() covers both, and ISO strings sort correctly lexicographically.
        modifiedAt: String(m.modified_at ?? ''),
      }))
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  }

  async detectCapabilities(model: string): Promise<Capabilities> {
    const show = await this.ollama.show({ model });
    const caps: string[] = show.capabilities ?? [];
    return {
      completion: caps.includes('completion'),
      vision: caps.includes('vision'),
      tools: caps.includes('tools'),
      thinking: caps.includes('thinking'),
    };
  }

  abort(): void {
    this.ollama.abort();
  }
}
