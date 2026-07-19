// src/tui/App.tsx — Ink + React TUI for ollama-code.
//
// Wires the headless agent loop to an interactive terminal UI: streamed thinking/content,
// tool call display, diff previews before writes, permission prompts (y/n/a), slash commands,
// and a status bar with mode/model/context usage.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { homedir } from 'os';
import { join } from 'path';
import type { Agent } from '../core/agent';
import { createAgent } from '../core/agent';
import { createClient, type OllamaClient } from '../core/client';
import { loadConfig, defaultThinkFor } from '../core/config';
import { createContext } from '../core/context';
import { createPermissions } from '../core/permissions';
import { createSessionStore } from '../core/session';
import { createRegistry } from '../tools/registry';
import { imageToBase64 } from '../media/images';
import type { Config, ModelInfo, PermissionRequest, ToolCall } from '../core/types';
import { COMMANDS, runCommand, type CommandActions } from './commands';
import {
  InputLine,
  LogLine,
  ModelPicker,
  PermissionPrompt,
  Pixels,
  StatusBar,
  ThinkingBlock,
  buildToolPreview,
  type LogKind,
  type UsageStats,
} from './components';
import { tailLines } from './text';
import { FLOWER_ART, PALETTE, ROLES, ROLE_WIDTH } from './theme';

type LogItem = {
  id: number;
  kind: LogKind;
  text: string;
  meta?: string;
  ok?: boolean;
};

type PermissionDecision = { decision: 'allow' | 'deny'; always?: boolean };

export interface AppProps {
  config: Config;
}

let logIdCounter = 0;
function nextLogId(): number {
  return ++logIdCounter;
}

export default function App({ config }: AppProps): React.JSX.Element {
  const { exit } = useApp();

  const [log, setLog] = useState<LogItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageStats>({ used: 0, max: config.numCtx, pct: 0 });
  // Live thinking renders collapsed by default; Cmd+L (or Option+L) toggles it open.
  // The full thinking text is flushed into the log at the end of each turn regardless.
  const [thinkingCollapsed, setThinkingCollapsed] = useState(true);
  const [liveThinking, setLiveThinking] = useState('');
  const [liveContent, setLiveContent] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingPermission, setPendingPermission] = useState<{
    req: PermissionRequest;
    preview?: string;
  } | null>(null);
  const [modelPick, setModelPick] = useState<{ models: ModelInfo[]; index: number } | null>(
    null,
  );

  const configRef = useRef(config);
  configRef.current = config;

  const permissionResolveRef = useRef<((d: PermissionDecision) => void) | null>(null);
  const lastToolPreviewRef = useRef<string | undefined>(undefined);
  const liveThinkingRef = useRef('');
  const liveContentRef = useRef('');
  const agentRef = useRef<Agent | null>(null);
  const clientRef = useRef<OllamaClient | null>(null);
  const sendRef = useRef<((text: string, images?: string[]) => Promise<void>) | null>(null);

  const appendLog = useCallback((item: Omit<LogItem, 'id'>) => {
    setLog((prev) => [...prev, { ...item, id: nextLogId() }]);
  }, []);

  const notice = useCallback(
    (text: string) => appendLog({ kind: 'notice', text }),
    [appendLog],
  );

  const agent = useMemo(() => {
    const client = createClient({ host: config.host });
    clientRef.current = client;
    const registry = createRegistry();
    const permissions = createPermissions(config.permissions);
    const context = createContext(config, client);
    const session = createSessionStore(join(homedir(), '.ollama-code', 'sessions'));

    const a = createAgent({
      client,
      registry,
      permissions,
      context,
      session,
      config,
      events: {
        onThinking: (delta) => {
          liveThinkingRef.current += delta;
          setLiveThinking(liveThinkingRef.current);
        },
        onContent: (delta) => {
          liveContentRef.current += delta;
          setLiveContent(liveContentRef.current);
        },
        onToolStart: (call: ToolCall) => {
          const preview = buildToolPreview(call.function.name, call.function.arguments ?? {});
          lastToolPreviewRef.current = preview;
          if (preview) {
            appendLog({ kind: 'notice', text: preview });
          }
        },
        onToolResult: (call, res) => {
          appendLog({
            kind: 'tool',
            meta: call.function.name,
            text: res.display ?? res.content,
            ok: res.ok,
          });
        },
        onUsage: (u) => setUsage(u),
        onAskPermission: (req) =>
          new Promise<PermissionDecision>((resolve) => {
            permissionResolveRef.current = resolve;
            setPendingPermission({ req, preview: lastToolPreviewRef.current });
          }),
      },
    });

    agentRef.current = a;
    return a;
  }, [config, appendLog]);

  const flushLiveStream = useCallback(() => {
    if (liveThinkingRef.current) {
      appendLog({ kind: 'notice', text: `[thinking]\n${liveThinkingRef.current}` });
    }
    if (liveContentRef.current) {
      appendLog({ kind: 'assistant', text: liveContentRef.current });
    }
    liveThinkingRef.current = '';
    liveContentRef.current = '';
    setLiveThinking('');
    setLiveContent('');
  }, [appendLog]);

  sendRef.current = async (text: string, images?: string[]) => {
    setBusy(true);
    liveThinkingRef.current = '';
    liveContentRef.current = '';
    setLiveThinking('');
    setLiveContent('');
    lastToolPreviewRef.current = undefined;
    try {
      await agent.send(text, images);
      flushLiveStream();
    } catch (err) {
      appendLog({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
      setPendingPermission(null);
    }
  };

  const commandActions: CommandActions = useMemo(
    () => ({
      setMode: (mode) => {
        configRef.current.mode = mode;
        configRef.current.think = defaultThinkFor(mode);
      },
      setModel: (name) => {
        configRef.current.model = name;
      },
      listModels: () => {
        const client = clientRef.current;
        if (!client) return Promise.reject(new Error('Client not ready'));
        return client.listModels();
      },
      openModelPicker: (models) => {
        const idx = models.findIndex((m) => m.name === configRef.current.model);
        setModelPick({ models, index: idx === -1 ? 0 : idx });
      },
      addImage: async (path) => {
        const b64 = await imageToBase64(path);
        setPendingImages((imgs) => [...imgs, b64]);
      },
      clear: () => {
        setLog([]);
        setLiveThinking('');
        setLiveContent('');
        setPendingImages([]);
      },
      listSessions: () => createSessionStore(join(homedir(), '.ollama-code', 'sessions')).list(),
      showPermissions: () => {
        const p = configRef.current.permissions;
        const rules =
          p.rules && p.rules.length > 0
            ? p.rules.map((r) => `  ${r.pattern} → ${r.decision}`).join('\n')
            : '  (no custom rules)';
        notice(`Permission mode: ${p.mode}\nRules:\n${rules}`);
      },
      help: () => {
        const lines = COMMANDS.map((c) => `  ${c.name} — ${c.description}`).join('\n');
        notice(`Commands:\n${lines}`);
      },
      notice,
      getMode: () => configRef.current.mode,
      getModel: () => configRef.current.model,
    }),
    [notice],
  );

  const submit = useCallback(async () => {
    const line = input.trim();
    if (!line || busy) return;
    setInput('');

    if (line.startsWith('/')) {
      await runCommand(line, commandActions);
      return;
    }

    appendLog({ kind: 'user', text: line });
    const images = pendingImages.length ? [...pendingImages] : undefined;
    setPendingImages([]);
    await sendRef.current?.(line, images);
  }, [input, busy, commandActions, appendLog, pendingImages]);

  useInput((inputChar, key) => {
    // Permission prompt takes priority.
    if (pendingPermission && permissionResolveRef.current) {
      const resolve = permissionResolveRef.current;
      permissionResolveRef.current = null;
      if (inputChar === 'y') {
        setPendingPermission(null);
        resolve({ decision: 'allow' });
        return;
      }
      if (inputChar === 'n') {
        setPendingPermission(null);
        resolve({ decision: 'deny' });
        return;
      }
      if (inputChar === 'a') {
        setPendingPermission(null);
        resolve({ decision: 'allow', always: true });
        return;
      }
      return;
    }

    // Model picker overlay: swallows every key so typing can't leak into the input line.
    // Ctrl+C closes it (nothing is running to abort — the picker only opens while idle).
    if (modelPick) {
      if (key.escape || (key.ctrl && inputChar === 'c')) {
        setModelPick(null);
        return;
      }
      if (key.ctrl && inputChar === 'd') {
        exit();
        return;
      }
      if (key.return) {
        const chosen = modelPick.models[modelPick.index];
        setModelPick(null);
        if (chosen) {
          commandActions.setModel(chosen.name);
          notice(`Model set to ${chosen.name}`);
        }
        return;
      }
      if (key.upArrow || inputChar === 'k') {
        setModelPick((p) => p && { ...p, index: (p.index - 1 + p.models.length) % p.models.length });
        return;
      }
      if (key.downArrow || inputChar === 'j') {
        setModelPick((p) => p && { ...p, index: (p.index + 1) % p.models.length });
        return;
      }
      return;
    }

    // Abort the current turn: Ctrl+C, or Cmd+J (`key.super`, terminals speaking the kitty
    // keyboard protocol) / Option+J (`key.meta`, everywhere else).
    if ((key.ctrl && inputChar === 'c') || ((key.super || key.meta) && inputChar === 'j')) {
      agentRef.current?.abort();
      setBusy(false);
      notice('Aborted.');
      return;
    }

    // Toggle the live thinking block: Cmd+L / Option+L. Stays above the `busy` guard so it
    // works mid-stream, which is when there is thinking to look at.
    if ((key.super || key.meta) && inputChar === 'l') {
      setThinkingCollapsed((v) => !v);
      return;
    }

    if (key.ctrl && inputChar === 'd') {
      exit();
      return;
    }

    if (busy) return;

    // Clear the input line: Cmd+R / Option+R (Escape also works, below).
    if ((key.super || key.meta) && inputChar === 'r') {
      setInput('');
      return;
    }

    if (key.return) {
      void submit();
      return;
    }

    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }

    if (key.escape) {
      setInput('');
      return;
    }

    if (inputChar && !key.ctrl && !key.meta && !key.super && inputChar >= ' ') {
      setInput((v) => v + inputChar);
    }
  });

  // Cap the live streaming region well below the terminal height. If Ink's dynamic frame
  // ever outgrows the window, Ink falls back to clearing the entire terminal (including
  // scrollback) and re-printing everything on every stream chunk — the cause of the
  // banner flicker/tearing. The full text still reaches the log via `flushLiveStream`.
  // `||`, not `??`: a detached/odd pty can report 0 rows/columns.
  const termRows = process.stdout.rows || 24;
  const termCols = process.stdout.columns || 80;
  const liveBudget = Math.max(4, termRows - 14);
  const thinkingBudget = Math.min(8, liveBudget);
  const liveThinkingShown = thinkingCollapsed
    ? liveThinking
    : tailLines(liveThinking, thinkingBudget, Math.max(1, termCols - 4)).text;
  const contentBudget = Math.max(
    4,
    liveBudget - (liveThinking ? (thinkingCollapsed ? 2 : thinkingBudget + 3) : 0),
  );
  const liveContentTail = tailLines(liveContent, contentBudget, Math.max(1, termCols - 9));

  return (
    <Box flexDirection="column" padding={1}>
      <StatusBar mode={configRef.current.mode} model={configRef.current.model} usage={usage} busy={busy} />

      <Box flexDirection="column" marginY={1} flexGrow={1}>
        <Static items={log}>
          {(item) => (
            <Box key={String(item.id)}>
              <LogLine kind={item.kind} text={item.text} meta={item.meta} ok={item.ok} />
            </Box>
          )}
        </Static>

        {liveThinking ? (
          <Box marginBottom={1}>
            <ThinkingBlock text={liveThinkingShown} collapsed={thinkingCollapsed} />
          </Box>
        ) : null}

        {liveContent ? (
          <Box marginBottom={1}>
            <Box width={ROLE_WIDTH} marginRight={2} flexShrink={0}>
              <Text bold color={ROLES.assistant.color}>
                {ROLES.assistant.label}
              </Text>
            </Box>
            <Box flexGrow={1} flexDirection="column">
              {liveContentTail.hidden > 0 ? (
                <Text color={PALETTE.faint} italic>
                  … (+{liveContentTail.hidden} earlier lines)
                </Text>
              ) : null}
              <Text color={PALETTE.text}>{liveContentTail.text}</Text>
            </Box>
          </Box>
        ) : null}

        {pendingImages.length > 0 ? (
          <Text color={PALETTE.dim} italic>
            {pendingImages.length} image(s) queued for next message
          </Text>
        ) : null}

        {pendingPermission ? (
          <PermissionPrompt req={pendingPermission.req} preview={pendingPermission.preview} />
        ) : null}

        {modelPick ? (
          <ModelPicker
            models={modelPick.models}
            index={modelPick.index}
            currentModel={configRef.current.model}
            maxVisible={Math.max(3, Math.min(10, termRows - 14))}
          />
        ) : null}
      </Box>

      <Box>
        <Pixels art={FLOWER_ART} />
      </Box>

      <InputLine value={input} disabled={busy || pendingPermission != null || modelPick != null} />

      <Text color={PALETTE.dim}>
        Enter send · Ctrl+C / Cmd+J abort · Cmd+R clear input · Cmd+L thinking · Ctrl+D quit ·
        /help
      </Text>
    </Box>
  );
}

/** Bootstrap helper used by index.ts — loads config and returns the root element. */
export function createApp(configOverrides?: Partial<Config>): React.JSX.Element {
  const config = loadConfig(configOverrides);
  return <App config={config} />;
}
