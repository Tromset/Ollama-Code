// src/tui/components.tsx — presentational Ink components for the TUI.

import { Box, Text } from 'ink';
import type { AgentMode, PermissionRequest } from '../core/types';

export interface UsageStats {
  used: number;
  max: number;
  pct: number;
}

export function StatusBar(props: {
  mode: AgentMode;
  model: string;
  usage: UsageStats;
  busy: boolean;
}): React.JSX.Element {
  const { mode, model, usage, busy } = props;
  const ctxColor = usage.pct >= 75 ? 'red' : usage.pct >= 50 ? 'yellow' : 'green';
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text>
        <Text bold>ollama-code</Text>
        <Text dimColor> · </Text>
        <Text color="cyan">{mode}</Text>
        <Text dimColor> · </Text>
        <Text>{model}</Text>
        {busy ? <Text color="yellow"> · thinking…</Text> : null}
      </Text>
      <Text>
        ctx <Text color={ctxColor}>{usage.used.toLocaleString()}</Text>
        <Text dimColor>/{usage.max.toLocaleString()}</Text>
        <Text dimColor> ({usage.pct}%)</Text>
      </Text>
    </Box>
  );
}

export function PermissionPrompt(props: {
  req: PermissionRequest;
  preview?: string;
}): React.JSX.Element {
  const { req, preview } = props;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text bold color="yellow">
        Permission required: {req.tool}
      </Text>
      <Text dimColor>{req.detail}</Text>
      {preview ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Preview:</Text>
          <Text>{preview}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text>
          <Text color="green">y</Text> allow · <Text color="red">n</Text> deny ·{' '}
          <Text color="cyan">a</Text> always allow
        </Text>
      </Box>
    </Box>
  );
}

export function ThinkingBlock(props: { text: string; collapsed: boolean }): React.JSX.Element {
  const { text, collapsed } = props;
  if (!text) return <></>;
  if (collapsed) {
    const lines = text.split('\n').length;
    return (
      <Text dimColor italic>
        [thinking · {lines} line{lines === 1 ? '' : 's'}]
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      <Text dimColor italic>
        ─ thinking ─
      </Text>
      <Text dimColor>{text}</Text>
    </Box>
  );
}

export function LogLine(props: {
  kind: 'user' | 'assistant' | 'tool' | 'notice' | 'error';
  text: string;
  meta?: string;
  ok?: boolean;
}): React.JSX.Element {
  const { kind, text, meta, ok } = props;
  switch (kind) {
    case 'user':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="blue">
            you
          </Text>
          <Text>{text}</Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">
            assistant
          </Text>
          <Text>{text}</Text>
        </Box>
      );
    case 'tool':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="magenta">
            tool {meta}
          </Text>
          <Text color={ok === false ? 'red' : undefined}>{text}</Text>
        </Box>
      );
    case 'notice':
      return (
        <Text dimColor italic>
          {text}
        </Text>
      );
    case 'error':
      return (
        <Text color="red" bold>
          {text}
        </Text>
      );
    default:
      return <Text>{text}</Text>;
  }
}

export function InputLine(props: { value: string; disabled: boolean }): React.JSX.Element {
  const { value, disabled } = props;
  return (
    <Box borderStyle="single" borderColor="blue" paddingX={1}>
      <Text>
        <Text bold color="blue">
          {'> '}
        </Text>
        <Text>{value}</Text>
        {!disabled ? <Text inverse> </Text> : null}
      </Text>
    </Box>
  );
}

/** Build a simple unified-style preview for write/edit tool calls. */
export function buildToolPreview(
  tool: string,
  args: Record<string, unknown>,
): string | undefined {
  if (tool === 'write_file') {
    const path = String(args.path ?? '');
    const content = String(args.content ?? '');
    const preview = content.length > 600 ? content.slice(0, 600) + '\n…' : content;
    return `write ${path}:\n${preview}`;
  }
  if (tool === 'edit_file') {
    const path = String(args.path ?? '');
    const oldStr = String(args.old ?? '');
    const newStr = String(args.new ?? '');
    const oldPreview = oldStr.length > 200 ? oldStr.slice(0, 200) + '…' : oldStr;
    const newPreview = newStr.length > 200 ? newStr.slice(0, 200) + '…' : newStr;
    return `edit ${path}:\n- ${oldPreview.replace(/\n/g, '\n- ')}\n+ ${newPreview.replace(/\n/g, '\n+ ')}`;
  }
  if (tool === 'bash') {
    return `$ ${String(args.command ?? '')}`;
  }
  return undefined;
}
