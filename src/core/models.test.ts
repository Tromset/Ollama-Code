import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { applyModel, FLY_CLOUD_NUM_CTX, isFlyModel, parseFlyModel, pickFlyDefault } from './models';
import { systemPrompt } from './prompts';
import type { Capabilities, Config, ModelInfo } from './types';

const QWEN: Capabilities = { completion: true, vision: true, tools: true, thinking: true };
const FLYCODER_SYSTEM =
  'You are FlyCoder 0.3.\n- Never claim that you ran code or tests. When useful, give a short command.';

function freshConfig(patch: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, sampling: { ...DEFAULT_CONFIG.sampling }, ...patch };
}

function installed(name: string): ModelInfo {
  return { name, sizeBytes: 1, parameterSize: '', quantization: '', modifiedAt: '' };
}

describe('parseFlyModel', () => {
  it.each([
    ['flycoder', 'coder'],
    ['flycoder0.3', 'coder'],
    ['flycoder0.3fast:latest', 'coder'],
    ['Tromset/flycoder0.3:lite', 'coder'],
    ['Tromset/flycoder0.3pro', 'agent'],
    ['Tromset/fly1.0:ultra', 'agent'],
    ['tromset/fly1.1:lite', 'coder'],
    ['registry.example.com/Tromset/FlyCoder0.3', 'coder'],
    ['flymotion0.2lite', 'motion'],
    ['Tromset/flycoder0.3:router', 'router'],
  ])('recognises %s as a Fly %s model', (name, role) => {
    expect(parseFlyModel(name)?.role).toBe(role);
    expect(isFlyModel(name)).toBe(true);
  });

  it.each(['qwen3.5:latest', 'llama3.2', 'butterfly:7b', 'someone/qwen-fly', ''])(
    'leaves %s alone',
    (name) => {
      expect(parseFlyModel(name)).toBeUndefined();
    },
  );

  it('splits namespace, base and tag', () => {
    expect(parseFlyModel('Tromset/flycoder0.3:lite')).toMatchObject({
      base: 'flycoder0.3',
      tag: 'lite',
    });
    expect(parseFlyModel('flycoder')?.tag).toBe('latest');
  });
});

describe('pickFlyDefault', () => {
  it('takes the most recent Fly model that writes code', () => {
    const models = ['qwen3.5:latest', 'flymotion0.2', 'flycoder0.3:router', 'flycoder0.3fast', 'flycoder0.3pro'];
    expect(pickFlyDefault(models.map(installed))).toBe('flycoder0.3fast');
  });

  it('finds nothing without a Fly coding model', () => {
    expect(pickFlyDefault(['qwen3.5:latest', 'flymotion0.2'].map(installed))).toBeUndefined();
  });
});

describe('applyModel', () => {
  it('runs a Fly model with its Modelfile: context, sampling, system prompt', () => {
    const cfg = freshConfig();
    const notes = applyModel(cfg, 'Tromset/flycoder0.3', {
      capabilities: QWEN,
      numCtx: 65536,
      system: FLYCODER_SYSTEM,
    });
    expect(cfg.model).toBe('Tromset/flycoder0.3');
    expect(cfg.numCtx).toBe(65536);
    expect(cfg.sampling).toEqual({}); // nothing sent: the Modelfile's values apply
    expect(cfg.modelPrompt).toEqual({ system: FLYCODER_SYSTEM, standalone: false });
    expect(cfg.mode).toBe('code');
    expect(cfg.think).toBe(true);
    expect(notes[0]).toContain('context 65,536');
  });

  it('lets what the user set win over the profile', () => {
    const cfg = freshConfig({ numCtx: 16384 });
    applyModel(
      cfg,
      'flycoder0.3',
      { capabilities: QWEN, numCtx: 65536 },
      { numCtx: 16384, think: false, sampling: { temperature: 0.2 } },
    );
    expect(cfg.numCtx).toBe(16384);
    expect(cfg.think).toBe(false);
    expect(cfg.sampling).toEqual({ temperature: 0.2 });
  });

  it('never asks a model without thinking to think', () => {
    const cfg = freshConfig();
    const notes = applyModel(cfg, 'Tromset/fly1.1:lite', {
      capabilities: { ...QWEN, thinking: false, vision: false },
      numCtx: 8192,
    });
    expect(cfg.think).toBe(false);
    expect(cfg.mode).toBe('code');
    expect(notes[0]).toContain('no thinking');
  });

  it('falls back to chat mode when the model cannot call tools', () => {
    const cfg = freshConfig();
    applyModel(cfg, 'flycoder0.3', { capabilities: { ...QWEN, tools: false } });
    expect(cfg.mode).toBe('chat');
    expect(cfg.think).toBe(false);
  });

  it('keeps a non-coding Fly model on its own prompt, in chat mode', () => {
    const cfg = freshConfig();
    const notes = applyModel(cfg, 'flymotion0.2', {
      capabilities: QWEN,
      numCtx: 2048,
      system: 'You plan robot motion.',
    });
    expect(cfg.mode).toBe('chat');
    expect(cfg.numCtx).toBe(2048);
    expect(systemPrompt(cfg.mode, cfg.modelPrompt)).toBe('You plan robot motion.');
    expect(notes.join('\n')).toContain('not a coding model');
  });

  it('respects a mode the user asked for', () => {
    const cfg = freshConfig({ mode: 'plan' });
    applyModel(cfg, 'flymotion0.2', { capabilities: QWEN }, { mode: 'plan' });
    expect(cfg.mode).toBe('plan');
  });

  it('gives a cloud Fly model without num_ctx a bounded budget', () => {
    const cfg = freshConfig();
    applyModel(cfg, 'Tromset/fly1.0:ultra', { capabilities: QWEN });
    expect(cfg.numCtx).toBe(FLY_CLOUD_NUM_CTX);
  });

  it('says how to install a Fly model Ollama does not have', () => {
    const cfg = freshConfig();
    const notes = applyModel(cfg, 'Tromset/flycoder0.3pro', undefined);
    expect(notes[0]).toContain('ollama pull Tromset/flycoder0.3pro');
    expect(cfg.numCtx).toBe(DEFAULT_CONFIG.numCtx);
  });

  it('restores the defaults when switching back to another model', () => {
    const cfg = freshConfig();
    applyModel(cfg, 'flycoder0.3', { capabilities: { ...QWEN, thinking: false }, numCtx: 65536, system: 'x' });
    expect(applyModel(cfg, 'qwen3.5:latest', undefined)).toEqual([]);
    expect(cfg.numCtx).toBe(DEFAULT_CONFIG.numCtx);
    expect(cfg.sampling).toEqual(DEFAULT_CONFIG.sampling);
    expect(cfg.modelPrompt).toBeUndefined();
    expect(cfg.capabilities).toBeUndefined();
    expect(cfg.think).toBe(true);
  });

  it('never touches DEFAULT_CONFIG', () => {
    const before = JSON.stringify(DEFAULT_CONFIG);
    applyModel(freshConfig(), 'flycoder0.3', { capabilities: QWEN, numCtx: 1 });
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(before);
  });
});

describe('systemPrompt with a Fly Modelfile prompt', () => {
  const model = { system: FLYCODER_SYSTEM, standalone: false };

  it('is unchanged for other models', () => {
    expect(systemPrompt('code')).toMatch(/^You are an agentic coding assistant/);
  });

  it('keeps the Modelfile prompt and adds the mode prompt after it', () => {
    const sys = systemPrompt('chat', model);
    expect(sys.startsWith(FLYCODER_SYSTEM)).toBe(true);
    expect(sys).toContain('You have no tools available.');
  });

  it('rewords the "never ran code" rule in code mode, where tools do run it', () => {
    const sys = systemPrompt('code', model);
    expect(sys).toContain('Never claim that you ran code or tests unless a tool actually ran them.');
    expect(sys).toContain('You are an agentic coding assistant');
  });
});
