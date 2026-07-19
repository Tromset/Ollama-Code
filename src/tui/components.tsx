// src/tui/components.tsx — presentational Ink components for the TUI.

import { Box, Text } from 'ink';
import type { AgentMode, PermissionRequest } from '../core/types';
import type { PixelArt } from './pixels';
import {
  PALETTE,
  ROLES,
  ROLE_WIDTH,
  SUBTITLE,
  WORDMARK,
  WORDMARK_SPLIT,
  WORDMARK_SPLIT_WIDTH,
  WORDMARK_WIDTH,
} from './theme';

export interface UsageStats {
  used: number;
  max: number;
  pct: number;
}

export type LogKind = keyof typeof ROLES;

/**
 * Render half-block pixel art as one `<Text>` per terminal row.
 *
 * `wrap="truncate"` matters: Ink's default wrapping would reflow the art into garbage on a
 * terminal narrower than the art, whereas truncating degrades to a clean vertical cut.
 */
export function Pixels({ art }: { art: PixelArt }): React.JSX.Element {
  return (
    // flexShrink={0}: inside a row, Ink would otherwise shrink the art and `truncate` would
    // silently eat columns off the right edge.
    <Box flexDirection="column" flexShrink={0} width={art.width}>
      {art.rows.map((row, y) => (
        <Text key={y} wrap="truncate">
          {row.map((seg, x) => (
            <Text key={x} color={seg.fg} backgroundColor={seg.bg}>
              {seg.ch}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Startup banner: mascot plus wordmark. Rendered once into `<Static>`, so it scrolls away
 * as the conversation grows rather than occupying the viewport forever.
 *
 * The block wordmark is ~90 columns wide, so the layout steps down through progressively
 * more compact variants rather than letting Ink wrap it into garbage.
 */
export function Banner(props: {
  logo: PixelArt | null;
  version: string;
  columns: number;
}): React.JSX.Element {
  const { logo, version, columns } = props;
  const subtitle = `${SUBTITLE}   ·   v${version}`;
  const logoWidth = logo ? logo.width + 2 : 0;

  const wordmark =
    columns >= logoWidth + WORDMARK_WIDTH
      ? WORDMARK
      : columns >= logoWidth + WORDMARK_SPLIT_WIDTH
        ? WORDMARK_SPLIT
        : null;

  const text = (
    <Box flexDirection="column" marginLeft={logo ? 2 : 0}>
      {wordmark ? (
        wordmark.map((line, i) => (
          <Text key={i} bold color={PALETTE.pink} wrap="truncate">
            {line}
          </Text>
        ))
      ) : (
        <Text bold color={PALETTE.pink} wrap="truncate">
          ollama-code
        </Text>
      )}
      <Box marginTop={1}>
        <Text color={PALETTE.dim} wrap="truncate">
          {subtitle}
        </Text>
      </Box>
    </Box>
  );

  // Side by side when both fit; otherwise stack the wordmark under the mascot.
  const sideBySide = !logo || columns >= logoWidth + WORDMARK_SPLIT_WIDTH;

  return (
    <Box flexDirection={sideBySide ? 'row' : 'column'} marginBottom={1}>
      {logo ? <Pixels art={logo} /> : null}
      {text}
    </Box>
  );
}

export function StatusBar(props: {
  mode: AgentMode;
  model: string;
  usage: UsageStats;
  busy: boolean;
}): React.JSX.Element {
  const { mode, model, usage, busy } = props;
  const ctxColor =
    usage.pct >= 75 ? PALETTE.err : usage.pct >= 50 ? PALETTE.yellow : PALETTE.green;
  return (
    <Box
      borderStyle="round"
      borderColor={PALETTE.pink}
      paddingX={1}
      justifyContent="space-between"
    >
      <Text wrap="truncate">
        <Text bold color={PALETTE.pink}>
          ollama-code
        </Text>
        <Text color={PALETTE.faint}> · </Text>
        <Text color={PALETTE.pinkLight}>{mode}</Text>
        <Text color={PALETTE.faint}> · </Text>
        <Text color={PALETTE.text}>{model}</Text>
        {busy ? <Text color={PALETTE.yellow}> · thinking…</Text> : null}
      </Text>
      <Text wrap="truncate">
        <Text color={PALETTE.dim}>ctx </Text>
        <Text color={ctxColor}>{usage.used.toLocaleString()}</Text>
        <Text color={PALETTE.faint}>/{usage.max.toLocaleString()}</Text>
        <Text color={PALETTE.faint}> ({usage.pct}%)</Text>
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
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={PALETTE.yellow}
      paddingX={1}
      marginY={1}
    >
      <Text bold color={PALETTE.yellow}>
        Permission required: {req.tool}
      </Text>
      <Text color={PALETTE.dim}>{req.detail}</Text>
      {preview ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={PALETTE.text}>
            Preview:
          </Text>
          <Text color={PALETTE.text}>{preview}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={PALETTE.dim}>
          <Text color={PALETTE.green}>y</Text> allow · <Text color={PALETTE.err}>n</Text> deny ·{' '}
          <Text color={PALETTE.pinkLight}>a</Text> always allow
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
      <Text color={PALETTE.faint} italic>
        [thinking · {lines} line{lines === 1 ? '' : 's'}]
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color={PALETTE.faint} italic>
        ─ thinking ─
      </Text>
      <Text color={PALETTE.faint}>{text}</Text>
    </Box>
  );
}

/**
 * One log entry: a fixed-width role column, then the body. The rigid column is what makes
 * a stream of mixed `you`/`ai`/`run` lines scan as a single conversation.
 */
export function LogLine(props: {
  kind: LogKind;
  text: string;
  meta?: string;
  ok?: boolean;
}): React.JSX.Element {
  const { kind, text, meta, ok } = props;
  const role = ROLES[kind];
  const failed = ok === false;

  const bodyColor =
    failed || kind === 'error'
      ? PALETTE.err
      : kind === 'notice'
        ? PALETTE.dim
        : PALETTE.text;

  return (
    <Box marginBottom={1}>
      <Box width={ROLE_WIDTH} marginRight={2} flexShrink={0}>
        <Text bold color={role.color}>
          {role.label}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {meta ? (
          <Text color={PALETTE.faint} italic>
            {meta}
          </Text>
        ) : null}
        <Text color={bodyColor} italic={kind === 'notice'}>
          {text}
        </Text>
      </Box>
    </Box>
  );
}

export function InputLine(props: { value: string; disabled: boolean }): React.JSX.Element {
  const { value, disabled } = props;
  return (
    <Box borderStyle="round" borderColor={PALETTE.pink} paddingX={1}>
      <Text>
        <Text bold color={PALETTE.pink}>
          {'> '}
        </Text>
        <Text color={PALETTE.text}>{value}</Text>
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
