// src/core/config.ts — default config + layered config loading.
//
// Merge order (lowest → highest precedence):
//   DEFAULT_CONFIG ← ~/.ollama-code/config.json ← ./.ollama-code.json ← overrides
// Missing or invalid JSON files are silently ignored (never throw).

import { homedir } from 'os';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentMode, Config } from './types';

// Defaults per docs/RUNTIME_API.md §4 — Modelfile sampling, 32K context.
export const DEFAULT_CONFIG: Config = {
  model: 'qwen3.5:latest',
  host: 'http://localhost:11434',
  numCtx: 32768,
  mode: 'code',
  maxTurns: 25,
  sampling: {
    temperature: 1,
    top_p: 0.95,
    top_k: 20,
    presence_penalty: 1.5,
  },
  think: true,
  permissions: {
    mode: 'normal',
    rules: [],
  },
};

// Thinking defaults to on for code mode (needs reasoning for edits/tools), off otherwise.
export function defaultThinkFor(mode: AgentMode): Config['think'] {
  return mode === 'code' ? true : false;
}

// Read + JSON.parse a file, returning undefined on any error (missing file, bad JSON, etc.).
function readJsonSafe(path: string): Partial<Config> | undefined {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return undefined;
  }
}

// Deep-merge one layer of Partial<Config> onto a base Config, merging nested
// `sampling` and `permissions` objects rather than replacing them wholesale.
function mergeConfig(base: Config, layer?: Partial<Config>): Config {
  if (!layer) return base;
  return {
    ...base,
    ...layer,
    sampling: {
      ...base.sampling,
      ...(layer.sampling ?? {}),
    },
    permissions: {
      ...base.permissions,
      ...(layer.permissions ?? {}),
      rules: layer.permissions?.rules ?? base.permissions.rules,
    },
  };
}

export function loadConfig(overrides?: Partial<Config>): Config {
  let cfg = DEFAULT_CONFIG;

  const userConfigPath = join(homedir(), '.ollama-code', 'config.json');
  cfg = mergeConfig(cfg, readJsonSafe(userConfigPath));

  const projectConfigPath = join(process.cwd(), '.ollama-code.json');
  cfg = mergeConfig(cfg, readJsonSafe(projectConfigPath));

  cfg = mergeConfig(cfg, overrides);

  return cfg;
}
