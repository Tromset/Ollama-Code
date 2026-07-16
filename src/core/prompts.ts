// src/core/prompts.ts — short system prompts per agent mode (small-model reliability:
// keep these concise; verbose prompts eat context and confuse a 9B model).

import type { AgentMode } from './types';

const CODE_PROMPT =
  'You are an agentic coding assistant. You use tools to read, edit, and run code in the ' +
  "project. Work step by step: investigate before changing anything, prefer edit_file " +
  '(str_replace) for changes over rewriting whole files, and verify your work with bash when ' +
  'useful (e.g. running tests or the changed code). Keep going until the task is fully done. ' +
  'Reply concisely.';

const CHAT_PROMPT =
  'You are a concise, helpful assistant. Answer directly. You have no tools available.';

const VISION_PROMPT =
  'You describe and analyze images the user attaches. You may read project files for context, ' +
  'but focus your answer on what is visible in the image(s). Be concise and specific.';

const PLAN_PROMPT =
  'You are in read-only planning mode. Investigate the project using your read-only tools ' +
  '(read_file, list_files, search) and produce a concrete, step-by-step plan. You must NEVER ' +
  'write files or run commands — only propose the plan.';

/** Short, mode-specific system prompt (small model — keep these brief). */
export function systemPrompt(mode: AgentMode): string {
  switch (mode) {
    case 'code':
      return CODE_PROMPT;
    case 'chat':
      return CHAT_PROMPT;
    case 'vision':
      return VISION_PROMPT;
    case 'plan':
      return PLAN_PROMPT;
    default: {
      // Exhaustiveness guard: if AgentMode grows, TS will flag the unreachable case here.
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
