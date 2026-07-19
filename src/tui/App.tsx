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
import { createClient } from '../core/client';
import { loadConfig, defaultThinkFor } from '../core/config';
import { createContext } from '../core/context';
import { createPermissions } from '../core/permissions';
import { createSessionStore } from '../core/session';
import { createRegistry } from '../tools/registry';
import { imageToBase64 } from '../media/images';
import type { Config, PermissionRequest, ToolCall } from '../core/types';
import { COMMANDS, runCommand, type CommandActions } from './commands';
import {
  Banner,
  InputLine,
  LogLine,
  PermissionPrompt,
  Pixels,
  StatusBar,
  ThinkingBlock,
  buildToolPreview,
  type LogKind,
  type UsageStats,
} from './components';
import type { PixelArt } from './pixels';
import { FLOWER_ART, PALETTE, ROLES, ROLE_WIDTH } from './theme';
import { VERSION } from '../version';

type LogItem = {
  id: number;
  kind: LogKind;
  text: string;
  meta?: string;
  ok?: boolean;
};

/**
 * The startup banner shares the log's `<Static>` — Ink supports only one `<Static>` per
 * tree (it keeps a single `staticNode` slot), so a second one would silently suppress the
 * other. Seeding it as `items[0]` also means it paints in the very first frame.
 */
type BannerEntry = { id: number; kind: 'banner' };
type StaticEntry = LogItem | BannerEntry;

type PermissionDecision = { decision: 'allow' | 'deny'; always?: boolean };

export interface AppProps {
  config: Config;
  logo?: PixelArt | null;
}

let logIdCounter = 0;
function nextLogId(): number {
  return ++logIdCounter;
}

export default function App({ config, logo = null }: AppProps): React.JSX.Element {
  const { exit } = useApp();

  const [log, setLog] = useState<StaticEntry[]>(() => [{ id: nextLogId(), kind: 'banner' }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageStats>({ used: 0, max: config.numCtx, pct: 0 });
  // The live thinking block is always collapsed (the toggle shortcut was removed);
  // the full thinking text is flushed into the log at the end of each turn.
  const [thinkingCollapsed] = useState(true);
  const [liveThinking, setLiveThinking] = useState('');
  const [liveContent, setLiveContent] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingPermission, setPendingPermission] = useState<{
    req: PermissionRequest;
    preview?: string;
  } | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const permissionResolveRef = useRef<((d: PermissionDecision) => void) | null>(null);
  const lastToolPreviewRef = useRef<string | undefined>(undefined);
  const liveThinkingRef = useRef('');
  const liveContentRef = useRef('');
  const agentRef = useRef<Agent | null>(null);
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

    // Abort the current turn: Ctrl+C or Cmd+J.
    if ((key.ctrl && inputChar === 'c') || (key.meta && inputChar === 'j')) {
      agentRef.current?.abort();
      setBusy(false);
      notice('Aborted.');
      return;
    }

    // Cmd+L is reserved for thinking toggle (no-op — thinking is always collapsed).
    if (key.meta && inputChar === 'l') return;

    if (key.ctrl && inputChar === 'd') {
      exit();
      return;
    }

    if (busy) return;

    // Clear the input line: Cmd+R (Escape also works, below).
    if (key.meta && inputChar === 'r') {
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

    if (inputChar && !key.ctrl && !key.meta && inputChar >= ' ') {
      setInput((v) => v + inputChar);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <StatusBar mode={configRef.current.mode} model={configRef.current.model} usage={usage} busy={busy} />

      <Box flexDirection="column" marginY={1} flexGrow={1}>
        <Static items={log}>
          {(item) =>
            item.kind === 'banner' ? (
              <Box key="banner">
                <Banner
                  logo={logo}
                  version={VERSION}
                  columns={process.stdout.columns ?? 80}
                />
              </Box>
            ) : (
              <Box key={String(item.id)}>
                <LogLine kind={item.kind} text={item.text} meta={item.meta} ok={item.ok} />
              </Box>
            )
          }
        </Static>

        {liveThinking ? (
          <Box marginBottom={1}>
            <ThinkingBlock text={liveThinking} collapsed={thinkingCollapsed} />
          </Box>
        ) : null}

        {liveContent ? (
          <Box marginBottom={1}>
            <Box width={ROLE_WIDTH} marginRight={2} flexShrink={0}>
              <Text bold color={ROLES.assistant.color}>
                {ROLES.assistant.label}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={PALETTE.text}>{liveContent}</Text>
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
      </Box>

      <Box>
        <Pixels art={FLOWER_ART} />
      </Box>

      <InputLine value={input} disabled={busy || pendingPermission != null} />

      <Text color={PALETTE.dim}>
        Enter send · Ctrl+C / Cmd+J abort · Cmd+R clear input · Ctrl+D quit · /help
      </Text>
    </Box>
  );
}

/** Bootstrap helper used by index.ts — loads config and returns the root element. */
export function createApp(
  configOverrides?: Partial<Config>,
  logo?: PixelArt | null,
): React.JSX.Element {
  const config = loadConfig(configOverrides);
  return <App config={config} logo={logo} />;
}
