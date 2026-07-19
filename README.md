<p align="center">
  <img src="assets/logo.svg" alt="ollama-code logo — pixel llama" width="160" height="160">
</p>

# ollama-code

> 100 % local agentic coding harness for **Qwen 3.5 9B** via **Ollama** — no cloud API, no per-token billing, fully owned source code.

This README covers installation and everyday usage. For the project's motivation, architecture choices, and small-model reliability engineering, see the full reference document: [DOCUMENTATION.md](DOCUMENTATION.md). For a complete list of commands and keyboard shortcuts, see [HELP.md](HELP.md).

## Prerequisites

- Node.js ≥ 22
- [Ollama](https://ollama.com) installed and running (see below)
- The target model pulled: `ollama pull qwen3.5`

## Step 1 — Install Ollama

Ollama is the local model server that runs Qwen 3.5 on your machine.

**macOS**

```bash
# Option A: download the app from https://ollama.com/download and drag it to Applications
# Option B: Homebrew
brew install ollama
```

**Linux**

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows**

Download and run the installer from [ollama.com/download](https://ollama.com/download).

## Step 2 — Connect Ollama to your terminal

1. **Start the server** (the macOS/Windows desktop app starts it automatically; otherwise run it yourself):

   ```bash
   ollama serve
   ```

2. **Verify it is reachable** — the harness talks to Ollama over HTTP on `http://localhost:11434` by default:

   ```bash
   curl -s http://localhost:11434/api/version
   # → {"version":"..."}  means the server is up
   ```

3. **Pull the model**:

   ```bash
   ollama pull qwen3.5
   ```

4. **Check it is available**:

   ```bash
   ollama list          # models on disk
   ollama ps            # models currently loaded in memory
   ```

If Ollama runs on another machine or port, point the harness at it with `--host <url>` (or the `host` key in the config file). A quick reference of useful Ollama commands lives in [HELP.md](HELP.md).

## Step 3 — Install ollama-code on your PC

Clone the repo and install its dependencies (there is no build step — the project runs directly from the TypeScript sources via `tsx`):

```bash
git clone https://github.com/Tromset/Ollama-Code.git ollama-code
cd ollama-code
npm install
```

Then make `ollama-code` available as a global terminal command:

```bash
npm link
```

`npm link` creates a symlink to `ollama-code` in your active Node's global `bin` directory (already on your `PATH`, no `sudo` needed). From now on, typing `ollama-code` in **any** directory launches the tool against that directory:

```bash
ollama-code
```

Verify it resolved:

```bash
which ollama-code       # prints the path to the linked command
ollama-code --help      # prints usage
```

> **Alternatives.** `npm install -g .` installs a copy instead of a live symlink (rerun it after pulling updates). Or skip the global command entirely and run `npm start` from inside the repository.

Under the hood, `bin/ollama-code.js` resolves `tsx` from the package's own `node_modules` and points explicitly at its own `tsconfig.json` (rather than letting `tsx` resolve one from the current directory) — so the command works correctly even when invoked from outside the repository.

## Quick start

Once linked, from anywhere:

```bash
ollama-code
```

Or, without linking, from inside the repository:

```bash
npm start
```

## Usage (CLI)

```
ollama-code                       Launch the TUI (interactive)
ollama-code [options]

Options:
  --model <name>        Ollama model (default: qwen3.5:latest)
  --mode <mode>         Agent mode: code | chat | vision | plan (default: code)
  --num-ctx <n>         Context window size (default: 32768)
  --host <url>          Ollama host (default: http://localhost:11434)
  --permission <mode>   Permission mode: plan | normal | yolo (default: normal)
  --yolo                Shorthand for --permission yolo (allow all except hard denies)
  --plan-perms          Shorthand for --permission plan (read-only)
  --help, -h            Show help

Examples:
  ollama-code
  ollama-code --mode plan --model qwen3.5:latest
  npm run smoke                        Quick streaming smoke test, no TUI
```

⚠️ `--mode plan` (the agent mode) and `--plan-perms` (the permission engine) are two **independent** settings: `--mode plan` changes the system prompt and restricts the exposed tools, while `--plan-perms` forces the permission engine into read-only regardless of the agent mode. Nothing synchronizes them automatically — combine both for the strongest guarantee during investigation.

## Agent modes

| Mode | Exposed tools | Purpose |
|---|---|---|
| `code` | all 7 | full agentic coding |
| `vision` | 3 read-only (`read_file`, `list_files`, `search`) | describe/analyze images + project context |
| `plan` | 3 read-only | investigate and propose a plan, never write |
| `chat` | none | plain conversation |

`think` (visible reasoning) is **not** automatically derived from the mode chosen at launch: it defaults to `true` for all four modes as long as no explicit value is provided (CLI/config). Only a mode change **during a session** via `/mode` forces it to `false` for `chat`/`vision`/`plan` (`true` only for `code`).

Details, guardrails, and diagrams: see [DOCUMENTATION.md](DOCUMENTATION.md), "Agent modes" section.

## TUI commands

| Command | Purpose |
|---|---|
| `/mode [code\|chat\|vision\|plan]` | show or change the agent mode |
| `/model [name]` | show or change the Ollama model |
| `/image <path>` | attach an image to the next message |
| `/clear` | clear the displayed conversation history |
| `/sessions` | list saved sessions (first 20) |
| `/permissions` | show the current permission configuration |
| `/help` | list commands |

Keyboard shortcuts: `Enter` send · `Ctrl+C` or `Cmd+L` abort the current turn (without quitting) · `Ctrl+D` quit · `Cmd+R` or `Esc` clear the input line · `y`/`n`/`a` answer a permission prompt (`a` = always allow this exact action). The full list lives in [HELP.md](HELP.md).

## The 7 tools

| Tool | Purpose | Guardrails |
|---|---|---|
| `read_file` | read a file | confined to the `cwd`, refuses `.env` |
| `write_file` | create/overwrite | same + creates parent directories |
| `edit_file` | `{path, old, new}` replacement with progressive matching (exact → whitespace → fuzzy) | actionable error if no unique match |
| `move_file` | move/rename | both paths validated |
| `list_files` | list by glob | skips `node_modules`/`.git`/`dist`, capped at 500 files |
| `search` | grep contents | ripgrep if available (30 s timeout), JS fallback otherwise; capped at 200 results |
| `bash` | shell command | 120 s default timeout, project `cwd`, output (stdout+stderr) truncated at 20,000 characters |

⚠️ `search` and `list_files` are **not** protected against exposing `.env` files as reliably as the four file tools — see the permissions section of [DOCUMENTATION.md](DOCUMENTATION.md) before using this on a repository containing real secrets.

## Configuration

Merged with increasing precedence (no error if a file is missing):

```
built-in defaults  ←  ~/.ollama-code/config.json  ←  ./.ollama-code.json  ←  CLI options
```

Defaults: model `qwen3.5:latest`, host `http://localhost:11434`, `numCtx` 32768, `maxTurns` 25, sampling `{temperature:1, top_p:0.95, top_k:20, presence_penalty:1.5}`, `think: true` in `code` mode, permissions `{mode:'normal', rules:[]}`.

Sessions and the training log (`finetune.jsonl`) are stored in `~/.ollama-code/sessions/`.

## npm scripts

| Script | Command | Purpose |
|---|---|---|
| `npm start` | `tsx src/index.ts` | launch the TUI |
| `npm run dev` | `tsx watch src/index.ts` | dev with reload |
| `npm run typecheck` | `tsc --noEmit` | type checking |
| `npm test` | `vitest run` | unit tests |
| `npm run test:watch` | `vitest` | tests in watch mode |
| `npm run smoke` | `tsx scripts/smoke.ts` | streaming smoke test (no TUI) |

## Project structure

```
bin/ollama-code.js      global CLI entry point (tsx wrapper)
src/index.ts              argument parsing, TUI launch
src/core/                 headless core: agent, Ollama client, config, context, permissions, prompts, sessions, types
src/tools/                the 7 tools + registry (validation/dispatch)
src/tui/                  Ink TUI (App, slash commands, components)
src/media/                image utilities (base64, resize)
assets/                   logo
scripts/smoke.ts          quick streaming smoke test
docs/CONTRACTS.md         TypeScript interfaces between modules (build specification)
docs/RUNTIME_API.md       verified library surface (build specification)
```

## Tests

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run smoke     # checks the Ollama connection + one streaming round-trip
```

To date, only the `edit_file` logic (progressive matching, `src/tools/fs.ts`) has unit tests (`src/tools/fs.test.ts`, 7 cases). The other tools, the registry, and the whole TUI/CLI layer have no automated coverage yet.

## Project status

The core (client, config, permissions, context, sessions, 7 tools), the agent loop (`src/core/agent.ts`), and the TUI (`src/tui/*` + `src/index.ts` + `bin/ollama-code.js`) are implemented — the project is usable end to end. Full details, known limitations, and roadmap (test coverage, LoRA fine-tuning, web UI, video/audio multimodal): see [DOCUMENTATION.md](DOCUMENTATION.md).

## Further reading

- [HELP.md](HELP.md) — every command and keyboard shortcut in one place.
- [DOCUMENTATION.md](DOCUMENTATION.md) — full reference document: motivation, architecture, small-model reliability engineering, risks and limitations.
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — TypeScript interfaces between modules (specification written before implementation).
- [docs/RUNTIME_API.md](docs/RUNTIME_API.md) — verified library surface (ollama-js, zod, ink) and per-file export contracts.
