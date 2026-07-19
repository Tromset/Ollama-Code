import { describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../core/types';
import { runCommand, type CommandActions } from './commands';

function mockActions(overrides: Partial<CommandActions> = {}): {
  actions: CommandActions;
  notices: string[];
} {
  const notices: string[] = [];
  const actions: CommandActions = {
    setMode: vi.fn(),
    setModel: vi.fn(),
    listModels: vi.fn(async () => []),
    openModelPicker: vi.fn(),
    addImage: vi.fn(async () => {}),
    clear: vi.fn(),
    listSessions: vi.fn(async () => []),
    showPermissions: vi.fn(),
    help: vi.fn(),
    notice: (text: string) => notices.push(text),
    getMode: () => 'code',
    getModel: () => 'qwen3.5:latest',
    ...overrides,
  };
  return { actions, notices };
}

function model(name: string): ModelInfo {
  return {
    name,
    sizeBytes: 4_700_000_000,
    parameterSize: '8.2B',
    quantization: 'Q4_K_M',
    modifiedAt: '2026-07-01T00:00:00Z',
  };
}

describe('runCommand /model', () => {
  it('sets the model directly when given an argument', async () => {
    const { actions, notices } = mockActions();
    expect(await runCommand('/model qwen3:8b', actions)).toBe(true);
    expect(actions.setModel).toHaveBeenCalledWith('qwen3:8b');
    expect(actions.listModels).not.toHaveBeenCalled();
    expect(notices).toEqual(['Model set to qwen3:8b']);
  });

  it('opens the picker with the installed models when given no argument', async () => {
    const models = [model('qwen3:8b'), model('llama3.2:latest')];
    const { actions } = mockActions({ listModels: vi.fn(async () => models) });
    expect(await runCommand('/model', actions)).toBe(true);
    expect(actions.openModelPicker).toHaveBeenCalledWith(models);
    expect(actions.setModel).not.toHaveBeenCalled();
  });

  it('suggests ollama pull when no models are installed', async () => {
    const { actions, notices } = mockActions();
    await runCommand('/model', actions);
    expect(actions.openModelPicker).not.toHaveBeenCalled();
    expect(notices[0]).toContain('ollama pull');
  });

  it('reports a notice when listing models fails', async () => {
    const { actions, notices } = mockActions({
      listModels: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });
    expect(await runCommand('/model', actions)).toBe(true);
    expect(actions.openModelPicker).not.toHaveBeenCalled();
    expect(notices[0]).toContain('Failed to list models');
    expect(notices[0]).toContain('fetch failed');
    expect(notices[0]).toContain('qwen3.5:latest');
  });
});

describe('runCommand dispatch', () => {
  it('notices on unknown commands and still claims the line', async () => {
    const { actions, notices } = mockActions();
    expect(await runCommand('/bogus', actions)).toBe(true);
    expect(notices[0]).toContain('Unknown command');
  });

  it('ignores lines that are not slash commands', async () => {
    const { actions, notices } = mockActions();
    expect(await runCommand('hello world', actions)).toBe(false);
    expect(notices).toEqual([]);
    expect(actions.setModel).not.toHaveBeenCalled();
  });

  it('sets a valid mode and rejects an invalid one', async () => {
    const { actions, notices } = mockActions();
    await runCommand('/mode chat', actions);
    expect(actions.setMode).toHaveBeenCalledWith('chat');
    await runCommand('/mode bogus', actions);
    expect(notices[1]).toContain('Valid modes');
  });
});
