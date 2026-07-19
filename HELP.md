# HELP — commands & keyboard shortcuts

Everything you can type or press in `ollama-code`, in one place. For installation see [README.md](README.md); for design details see [DOCUMENTATION.md](DOCUMENTATION.md).

## Launching

| Command | Effect |
|---|---|
| `npm start` | launch the TUI from the repository |
| `ollama-code` | launch the TUI from anywhere (after `npm link`) |
| `npm run dev` | launch with auto-reload on file changes |
| `npm run smoke` | quick streaming smoke test — no TUI, verifies the Ollama connection |

## CLI options

| Option | Values | Default | Effect |
|---|---|---|---|
| `--model <name>` | any Ollama model | `qwen3.5:latest` | model to drive |
| `--mode <mode>` | `code` \| `chat` \| `vision` \| `plan` | `code` | agent mode (system prompt + exposed tools) |
| `--num-ctx <n>` | integer | `32768` | context window size in tokens |
| `--host <url>` | URL | `http://localhost:11434` | Ollama server address |
| `--permission <mode>` | `plan` \| `normal` \| `yolo` | `normal` | permission engine mode |
| `--yolo` | — | — | shorthand for `--permission yolo` (allow everything except hard denies) |
| `--plan-perms` | — | — | shorthand for `--permission plan` (read-only) |
| `--help`, `-h` | — | — | show help |

⚠️ `--mode plan` and `--plan-perms` are independent settings. Combine both for a guaranteed read-only investigation session.

## Keyboard shortcuts (TUI)

| Shortcut | Effect |
|---|---|
| `Enter` | send the current input line |
| `Ctrl+C` | abort the current turn (does **not** quit) |
| `Cmd+J` / `Option+J` | abort the current turn (same as `Ctrl+C`) |
| `Cmd+R` / `Option+R` | clear the input line |
| `Esc` | clear the input line (same as `Cmd+R`) |
| `Cmd+L` / `Option+L` | expand/collapse the live thinking block |
| `Ctrl+D` | quit the TUI |
| `Backspace` / `Delete` | delete the last character of the input line |

About the `Cmd` combos: macOS terminals normally never forward the `Cmd` key to terminal apps. `Cmd+J/R/L` work in terminals speaking the [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) — kitty, Ghostty, WezTerm — which `ollama-code` auto-detects and enables. Everywhere else (Terminal.app, iTerm2, VS Code), use `Option+J/R/L` instead, with the terminal's "Use Option as Meta key" / "Option as Esc+" setting enabled. `Ctrl+C` and `Esc` always work regardless.

The live thinking block renders collapsed (`[thinking · N lines]`) until toggled with `Cmd+L` / `Option+L`; the full thinking text is printed into the log at the end of each turn either way.

## Permission prompt keys

When a tool call needs approval, the TUI shows a prompt. Answer with a single key:

| Key | Effect |
|---|---|
| `y` | allow this action once |
| `n` | deny this action |
| `a` | always allow this **exact** action (adds a session rule matching the exact command/path — it does not generalize to a class of actions) |

## Model picker keys

`/model` with no argument opens an interactive list of every model installed locally (from `GET /api/tags`), with parameter size, quantization and disk size per row, and the active model marked `● current`. Navigate with:

| Key | Effect |
|---|---|
| `↑` / `k` | move up (wraps around) |
| `↓` / `j` | move down (wraps around) |
| `Enter` | switch to the selected model (takes effect on the next message) |
| `Esc` / `Ctrl+C` | close the picker without changing anything |

## Slash commands

Lines starting with `/` are handled by the TUI and never sent to the model.

| Command | Effect |
|---|---|
| `/mode` | show the current agent mode |
| `/mode <code\|chat\|vision\|plan>` | switch agent mode (also resets `think`: `true` for `code`, `false` otherwise) |
| `/model` | open an interactive picker of all installed models (see "Model picker keys" above) |
| `/model <name>` | switch to another Ollama model directly |
| `/image <path>` | attach an image file to the next message (vision) |
| `/clear` | clear the displayed conversation log (the model's context/history is not reset) |
| `/sessions` | list saved sessions (first 20) |
| `/permissions` | show the current permission mode and rules (display only — the mode is fixed at launch) |
| `/help` | list the available commands |

## npm scripts

| Script | Command | Purpose |
|---|---|---|
| `npm start` | `tsx src/index.ts` | launch the TUI |
| `npm run dev` | `tsx watch src/index.ts` | dev with reload |
| `npm run typecheck` | `tsc --noEmit` | type checking |
| `npm test` | `vitest run` | unit tests |
| `npm run test:watch` | `vitest` | tests in watch mode |
| `npm run smoke` | `tsx scripts/smoke.ts` | streaming smoke test (no TUI) |

## Ollama quick reference

| Command | Effect |
|---|---|
| `ollama serve` | start the Ollama server (the desktop app does this automatically) |
| `ollama pull qwen3.5` | download the model |
| `ollama list` | models available on disk |
| `ollama ps` | models currently loaded (check the context size shown here — it should match `--num-ctx`, never 4096) |
| `ollama rm <model>` | delete a model from disk |
| `ollama show <model>` | model details (capabilities, parameters) |
| `curl -s http://localhost:11434/api/version` | check that the server is reachable |

Useful environment variables:

| Variable | Effect |
|---|---|
| `OLLAMA_HOST` | address the Ollama server binds to / clients connect to |
| `OLLAMA_KV_CACHE_TYPE=q8_0` | quantize the KV cache — reduces memory pressure at large context sizes |

## Configuration files

Merged with increasing precedence (missing files are fine):

```
built-in defaults  ←  ~/.ollama-code/config.json  ←  ./.ollama-code.json  ←  CLI options
```

Data locations:

| Path | Contents |
|---|---|
| `~/.ollama-code/config.json` | user-level config |
| `./.ollama-code.json` | project-level config |
| `~/.ollama-code/sessions/` | saved sessions (one JSON per session) |
| `~/.ollama-code/sessions/finetune.jsonl` | append-only fine-tuning log |

## Troubleshooting

- **The model feels amnesic / loses track immediately** — check `ollama ps`: if the context shows 4096, the harness's `num_ctx` is not being applied. Launch with an explicit `--num-ctx 32768`.
- **`connection refused` on startup** — Ollama is not running: start `ollama serve` (or the desktop app) and verify with `curl -s http://localhost:11434/api/version`.
- **Memory pressure / swapping at 32K context** — reduce to `--num-ctx 24576`, or set `OLLAMA_KV_CACHE_TYPE=q8_0` before starting Ollama.
- **`ollama-code: command not found`** — run `npm link` from the repository once, or use `npm start` from inside it.
