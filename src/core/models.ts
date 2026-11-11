// src/core/models.ts — recognition and integration of the Fly model family.
//
// The Fly models (FlyCoder `flycoder0.3`, `flycoder0.3fast`, `flycoder0.3pro`, the short local
// alias `flycoder`, Fly `fly1.0:ultra` / `fly1.1:lite`, FlyMotion `flymotion0.2`, ...) are
// Ollama Modelfiles: a base model plus a context size, sampling and a system prompt tuned
// with a benchmark. The harness defaults are tuned for a bare Qwen 3.5 and would override
// all three. So when the active model is a Fly model, the harness:
//   - reads the Modelfile through /api/show (context size, system prompt, capabilities),
//   - stops sending its own sampling, so the Modelfile's applies,
//   - keeps the Modelfile system prompt and adds the short mode prompt after it,
//   - only asks for thinking / tools when the model has them.
// Nothing is hard-coded per version: any model whose name starts with `fly` is handled, with
// or without a namespace (`Tromset/flycoder0.3`) or a tag (`flycoder0.3:lite`).

import { DEFAULT_CONFIG, defaultThinkFor } from './config';
import type { Capabilities, Config, ModelInfo } from './types';

/** What a Fly model is for. Only `coder` and `agent` drive the coding tools by default. */
export type FlyRole = 'coder' | 'agent' | 'motion' | 'router';

export interface FlyModel {
  name: string; // as given, e.g. "Tromset/flycoder0.3pro:latest"
  base: string; // lower-case name without namespace or tag, e.g. "flycoder0.3pro"
  tag: string; // lower-case tag, "latest" when absent
  role: FlyRole;
}

/** What /api/show says about a model (OllamaClient.describeModel). */
export interface ModelDescription {
  capabilities: Capabilities;
  numCtx?: number; // PARAMETER num_ctx of the Modelfile, when it sets one
  system?: string; // SYSTEM of the Modelfile, when it has one
}

// Context budget when a Fly Modelfile sets no num_ctx (cloud models such as fly1.0:ultra,
// whose real window is far larger: this only bounds what the harness keeps in a conversation).
export const FLY_CLOUD_NUM_CTX = 131072;

/** Recognise a Fly model from its name alone. Returns undefined for any other model. */
export function parseFlyModel(name: string): FlyModel | undefined {
  const trimmed = name.trim();
  const last = trimmed.slice(trimmed.lastIndexOf('/') + 1).toLowerCase();
  const colon = last.indexOf(':');
  const base = colon === -1 ? last : last.slice(0, colon);
  const tag = colon === -1 || colon === last.length - 1 ? 'latest' : last.slice(colon + 1);
  if (!/^fly[a-z0-9._-]*$/.test(base)) return undefined;

  let role: FlyRole = 'coder';
  if (base.startsWith('flymotion')) role = 'motion';
  else if (tag === 'router' || base.endsWith('router')) role = 'router';
  else if (tag === 'pro' || tag === 'ultra' || /(pro|ultra)$/.test(base)) role = 'agent';
  return { name: trimmed, base, tag, role };
}

export function isFlyModel(name: string): boolean {
  return parseFlyModel(name) !== undefined;
}

/**
 * The Fly model to start on when the user chose none: the most recently installed one that
 * writes code (`models` is recent first, as OllamaClient.listModels returns it).
 */
export function pickFlyDefault(models: ModelInfo[]): string | undefined {
  return models.find((m) => {
    const fly = parseFlyModel(m.name);
    return fly !== undefined && (fly.role === 'coder' || fly.role === 'agent');
  })?.name;
}

/**
 * Point `config` at `name` and apply that model's profile, in place. `description` is the
 * /api/show result when the model could be read (undefined otherwise); `explicit` holds the
 * settings the user set themselves (config files and CLI flags), which always win.
 * Returns the lines to show the user. Switching back to a non-Fly model restores the defaults.
 */
export function applyModel(
  config: Config,
  name: string,
  description: ModelDescription | undefined,
  explicit: Partial<Config> = {},
): string[] {
  config.model = name;
  const fly = parseFlyModel(name);

  if (!fly) {
    config.numCtx = explicit.numCtx ?? DEFAULT_CONFIG.numCtx;
    config.sampling = { ...DEFAULT_CONFIG.sampling, ...(explicit.sampling ?? {}) };
    config.capabilities = undefined;
    config.modelPrompt = undefined;
    config.think = explicit.think ?? defaultThinkFor(config.mode);
    return [];
  }

  const notes: string[] = [];
  const caps = description?.capabilities;
  const drivesTools = fly.role === 'coder' || fly.role === 'agent';

  config.numCtx =
    explicit.numCtx ?? description?.numCtx ?? (description ? FLY_CLOUD_NUM_CTX : DEFAULT_CONFIG.numCtx);
  // Only what the user set: every other sampling value comes from the Modelfile.
  config.sampling = { ...(explicit.sampling ?? {}) };
  config.capabilities = caps;
  config.modelPrompt = description?.system
    ? { system: description.system, standalone: !drivesTools }
    : undefined;

  if (explicit.mode === undefined) {
    if (!drivesTools && config.mode !== 'chat') {
      config.mode = 'chat';
      notes.push(`${name} is not a coding model (${fly.role}): switched to chat mode, no tools.`);
    } else if (caps && !caps.tools && (config.mode === 'code' || config.mode === 'plan')) {
      config.mode = 'chat';
      notes.push(`${name} cannot call tools: switched to chat mode.`);
    }
  }
  config.think = explicit.think ?? defaultThinkFor(config.mode, caps);

  if (description) {
    const parts = [
      `context ${config.numCtx.toLocaleString('en-US')}`,
      'Modelfile sampling',
      description.system ? 'its own system prompt' : undefined,
      caps && !caps.thinking ? 'no thinking' : undefined,
    ].filter(Boolean);
    notes.unshift(`Fly model ${name}: ${parts.join(', ')}.`);
  } else {
    notes.unshift(
      `Fly model ${name} could not be read from Ollama. Is it installed? Try: ollama pull ${name}`,
    );
  }
  return notes;
}
