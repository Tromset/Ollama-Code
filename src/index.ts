#!/usr/bin/env tsx
// src/index.ts — CLI entry point. Parses args, loads config, launches the Ink TUI.

import { render } from 'ink';
import type { AgentMode, Config } from './core/types';
import { createApp } from './tui/App';
import { renderBannerAnsi } from './tui/banner';
import { loadLogo } from './media/logo';
import { VERSION } from './version';

const VALID_MODES: readonly AgentMode[] = ['code', 'chat', 'vision', 'plan'];
const VALID_PERMISSION_MODES: readonly Config['permissions']['mode'][] = ['plan', 'normal', 'yolo'];

function printHelp(): void {
  console.log(`ollama-code — local agentic coding CLI for Qwen 3.5 via Ollama

Usage:
  ollama-code                        Launch the TUI (interactive)
  ollama-code [options]

Options:
  --model <name>        Ollama model (default: qwen3.5:latest)
  --mode <mode>         Agent mode: code | chat | vision | plan (default: code)
  --num-ctx <n>         Context window size (default: 32768)
  --host <url>          Ollama host (default: http://localhost:11434)
  --permission <mode>   Permission mode: plan | normal | yolo (default: normal)
                        yolo skips all authorization prompts except hard denies
  --yolo                Shorthand for --permission yolo
  --plan-perms          Shorthand for --permission plan
  --help, -h            Show this help

Examples:
  ollama-code
  ollama-code --mode plan --model qwen3.5:latest
  ollama-code --permission yolo        Skip permission prompts (allow all except hard denies)
  npm run smoke                        Quick streaming smoke test (no TUI, from the repo)
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
      case '--permission': {
        const permMode = argv[++i] as Config['permissions']['mode'];
        if (!VALID_PERMISSION_MODES.includes(permMode)) {
          console.error(
            `Unknown permission mode "${permMode}". Valid: ${VALID_PERMISSION_MODES.join(', ')}`
          );
          process.exit(1);
        }
        overrides.permissions = { mode: permMode, rules: [] };
        break;
      }
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

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    printHelp();
    return;
  }

  // The banner is printed straight to stdout before Ink starts, so Ink can never
  // reposition, race, or re-print it (it used to live in `<Static>`, where Ink's write
  // timing could smear the first pixel row over the shell prompt).
  const { art } = await loadLogo();
  // `|| 80`, not `?? 80`: a detached/odd pty can report 0 columns.
  process.stdout.write(renderBannerAnsi(art, VERSION, process.stdout.columns || 80));

  // kittyKeyboard: on terminals speaking the kitty keyboard protocol (kitty, Ghostty,
  // WezTerm — auto-detected), real Cmd+letter combos reach the app as `key.super`.
  render(createApp(parsed), { kittyKeyboard: { mode: 'auto' } });
}

void main();
