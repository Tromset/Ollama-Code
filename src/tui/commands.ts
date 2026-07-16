// src/tui/commands.ts — slash-command parsing + handling for the TUI.
//
// The TUI never sends a line starting with '/' to the model: App.tsx's submit flow checks the
// leading character and routes here instead. Each command mutates state through the
// `CommandActions` bridge that App.tsx implements (so this file stays framework-agnostic and
// easy to unit test independently of Ink/React).

import type { AgentMode } from '../core/types';

export interface SessionSummary {
  id: string;
  createdAt: string;
  title?: string;
}

export interface CommandActions {
  setMode(mode: AgentMode): void;
  setModel(name: string): void;
  addImage(path: string): Promise<void>;
  clear(): void;
  listSessions(): Promise<SessionSummary[]>;
  showPermissions(): void;
  help(): void;
  notice(text: string): void;
  // Not in the original suggested shape, but required for `/mode` and `/model` with no
  // argument to print the *current* value — see final report for this small deviation.
  getMode(): AgentMode;
  getModel(): string;
}

export interface CommandSpec {
  name: string;
  description: string;
}

export const COMMANDS: CommandSpec[] = [
  { name: '/mode', description: 'Show or set the agent mode (code | chat | vision | plan)' },
  { name: '/model', description: 'Show or set the Ollama model name' },
  { name: '/image', description: 'Attach an image file to the next message' },
  { name: '/clear', description: 'Clear the conversation and display log' },
  { name: '/sessions', description: 'List saved sessions' },
  { name: '/permissions', description: 'Show the current permission mode and rules' },
  { name: '/help', description: 'Show this list of commands' },
];

const VALID_MODES: readonly AgentMode[] = ['code', 'chat', 'vision', 'plan'];

function isAgentMode(s: string): s is AgentMode {
  return (VALID_MODES as readonly string[]).includes(s);
}

/**
 * Parse and run a slash command. Returns `true` if `input` was a recognized command line
 * (i.e. started with '/') so the caller knows NOT to forward it to the model. Unknown
 * `/whatever` commands still return `true` (they print a notice) so a typo never leaks
 * through to the LLM as a literal user message.
 */
export async function runCommand(input: string, actions: CommandActions): Promise<boolean> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return false;

  const spaceIdx = trimmed.indexOf(' ');
  const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case '/mode': {
      if (!arg) {
        actions.notice(`Current mode: ${actions.getMode()}`);
      } else if (isAgentMode(arg)) {
        actions.setMode(arg);
        actions.notice(`Mode set to ${arg}`);
      } else {
        actions.notice(`Unknown mode "${arg}". Valid modes: ${VALID_MODES.join(', ')}`);
      }
      return true;
    }

    case '/model': {
      if (!arg) {
        actions.notice(`Current model: ${actions.getModel()}`);
      } else {
        actions.setModel(arg);
        actions.notice(`Model set to ${arg}`);
      }
      return true;
    }

    case '/image': {
      if (!arg) {
        actions.notice('Usage: /image <path>');
      } else {
        try {
          await actions.addImage(arg);
          actions.notice(`Image queued for next message: ${arg}`);
        } catch (err) {
          actions.notice(`Failed to load image "${arg}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return true;
    }

    case '/clear': {
      actions.clear();
      actions.notice('Conversation cleared.');
      return true;
    }

    case '/sessions': {
      try {
        const sessions = await actions.listSessions();
        if (sessions.length === 0) {
          actions.notice('No saved sessions.');
        } else {
          const lines = sessions
            .slice(0, 20)
            .map((s) => `  ${s.id}  ${s.createdAt}${s.title ? '  ' + s.title : ''}`)
            .join('\n');
          actions.notice(`Sessions (${sessions.length}):\n${lines}`);
        }
      } catch (err) {
        actions.notice(`Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }

    case '/permissions': {
      actions.showPermissions();
      return true;
    }

    case '/help': {
      actions.help();
      return true;
    }

    default: {
      actions.notice(`Unknown command: ${cmd}. Type /help for the list of commands.`);
      return true;
    }
  }
}
