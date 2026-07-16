// src/core/session.ts — session persistence + fine-tuning JSONL log.
//
// Sessions are persisted as one pretty-printed JSON file per session under `dir`.
// A parallel append-only `finetune.jsonl` collects fine-tuning records (system prompt,
// tool schemas, messages with tool_calls as objects, success/failure flag) from day one.

import { mkdir, readdir, readFile, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AgentMode, Message } from './types';

export interface Session {
  id: string;
  createdAt: string;
  mode: AgentMode;
  messages: Message[];
}

export interface SessionStore {
  create(mode: AgentMode): Session;
  save(s: Session): Promise<void>;
  list(): Promise<{ id: string; createdAt: string; title?: string }[]>;
  load(id: string): Promise<Session>;
  appendFtRecord(rec: unknown): Promise<void>; // -> JSONL
}

export function createSessionStore(dir: string): SessionStore {
  // Ensure the storage directory exists; safe to call repeatedly, never throws
  // if it already exists (recursive mkdir).
  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  function sessionPath(id: string): string {
    return join(dir, `${id}.json`);
  }

  return {
    create(mode: AgentMode): Session {
      return {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        mode,
        messages: [],
      };
    },

    async save(s: Session): Promise<void> {
      await ensureDir();
      await writeFile(sessionPath(s.id), JSON.stringify(s, null, 2), 'utf8');
    },

    async list(): Promise<{ id: string; createdAt: string; title?: string }[]> {
      await ensureDir();
      const entries = await readdir(dir);
      const jsonFiles = entries.filter((f) => f.endsWith('.json'));
      const results: { id: string; createdAt: string; title?: string }[] = [];
      for (const file of jsonFiles) {
        try {
          const raw = await readFile(join(dir, file), 'utf8');
          const parsed = JSON.parse(raw) as { id: string; createdAt: string; title?: string };
          results.push({ id: parsed.id, createdAt: parsed.createdAt, title: parsed.title });
        } catch {
          // Skip unreadable/corrupt session files rather than failing the whole list.
          continue;
        }
      }
      return results;
    },

    async load(id: string): Promise<Session> {
      await ensureDir();
      const raw = await readFile(sessionPath(id), 'utf8');
      return JSON.parse(raw) as Session;
    },

    async appendFtRecord(rec: unknown): Promise<void> {
      await ensureDir();
      await appendFile(join(dir, 'finetune.jsonl'), JSON.stringify(rec) + '\n', 'utf8');
    },
  };
}
