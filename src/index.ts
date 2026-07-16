#!/usr/bin/env tsx
// src/index.ts — CLI entry point. Parses args, loads config, launches the Ink TUI.

import { render } from 'ink';
import type { AgentMode, Config } from './core/types';
import { createApp } from './tui/App';

const VALID_MODES: readonly AgentMode[] = ['code', 'chat', 'vision', 'plan'];

function printHelp(): void {
  console.log(`qwen-harness — local agentic coding harness for Qwen 3.5 via Ollama

Usage:
  npm start                          Launch the TUI (interactive)
  npm start -- [options]

Options:
  --model <name>       Ollama model (default: qwen3.5:latest)
  --mode <mode>        Agent mode: code | chat | vision | plan (default: code)
  --num-ctx <n>        Context window size (default: 32768)
  --host <url>         Ollama host (default: http://localhost:11434)
  --yolo               Enable yolo permission mode (allow all except hard denies)
  --plan-perms         Enable plan permission mode (read-only)
  --help, -h           Show this help

Examples:
  npm start
  npm start -- --mode plan --model qwen3.5:latest
  npm run smoke                        Quick streaming smoke test (no TUI)
`);
}

function parseArgs(argv: string[]): Partial<Config> | 'help' | undefined {
  const overrides: Partial<Config> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        return 'help';
      case '--model':
        overrides.model = argv[++i];
        break;
      case '--mode': {
        const mode = argv[++i] as AgentMode;
        if (!VALID_MODES.includes(mode)) {
          console.error(`Unknown mode "${mode}". Valid: ${VALID_MODES.join(', ')}`);
          process.exit(1);
        }
        overrides.mode = mode;
        break;
      }
      case '--num-ctx':
        overrides.numCtx = Number(argv[++i]);
        break;
      case '--host':
        overrides.host = argv[++i];
        break;
      case '--yolo':
        overrides.permissions = { mode: 'yolo', rules: [] };
        break;
      case '--plan-perms':
        overrides.permissions = { mode: 'plan', rules: [] };
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return overrides;
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    printHelp();
    return;
  }

  const app = createApp(parsed);
  render(app);
}

main();
