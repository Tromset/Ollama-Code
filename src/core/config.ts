// src/core/config.ts — default config + layered config loading.
//
// Merge order (lowest → highest precedence):
//   DEFAULT_CONFIG ← ~/.ollama-code/config.json ← ./.ollama-code.json ← overrides
// Missing or invalid JSON files are silently ignored (never throw).

import { homedir } from 'os';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentMode, Capabilities, Config } from './types';

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
// When the model's capabilities are known and it cannot think, it is never asked to
// (Ollama rejects `think: true` on such a model).
export function defaultThinkFor(mode: AgentMode, caps?: Capabilities): Config['think'] {
  if (caps && !caps.thinking) return false;
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

// The config layers, lowest precedence first: user file, project file, overrides (CLI flags).
function userLayers(overrides?: Partial<Config>): (Partial<Config> | undefined)[] {
  return [
    readJsonSafe(join(homedir(), '.ollama-code', 'config.json')),
    readJsonSafe(join(process.cwd(), '.ollama-code.json')),
    overrides,
  ];
}

export function loadConfig(overrides?: Partial<Config>): Config {
  let cfg = DEFAULT_CONFIG;
  for (const layer of userLayers(overrides)) cfg = mergeConfig(cfg, layer);
  // A fresh top level and `sampling`: the active model's profile rewrites them in place
  // (core/models.ts), which must never reach DEFAULT_CONFIG.
  return { ...cfg, sampling: { ...cfg.sampling } };
}

/**
 * Only what the user set themselves (config files and CLI flags), without the defaults.
 * A model profile (core/models.ts) fills in the rest, so these values always win over it.
 */
export function loadExplicitConfig(overrides?: Partial<Config>): Partial<Config> {
  let explicit: Partial<Config> = {};
  for (const layer of userLayers(overrides)) {
    if (!layer) continue;
    explicit = {
      ...explicit,
      ...layer,
      ...(explicit.sampling || layer.sampling
        ? { sampling: { ...explicit.sampling, ...layer.sampling } }
        : {}),
    };
  }
  return explicit;
}
