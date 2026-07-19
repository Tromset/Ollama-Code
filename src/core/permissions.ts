// src/core/permissions.ts — allow/ask/deny policy engine.
//
// Pure decision function: createPermissions(cfg).check(req) never mutates cfg and never
// touches the filesystem/network. Hard denies (`.env`, destructive bash) win over everything,
// including yolo mode. See docs/CONTRACTS.md §4 and docs/RUNTIME_API.md §4.

import type {
  Decision,
  PermissionChecker,
  PermissionConfig,
  PermissionRequest,
  PermissionRule,
} from './types';

// ---- Hard denies (win over every mode, including yolo) ----------------------------------

// Matches a `.env` file reference: bare, path-qualified, or quoted — but not `.environment`
// or similar, since the boundary check after the optional `.<ext>` requires end/space/slash/quote.
const ENV_FILE_RE = /(^|[\s/\\'"])\.env(\.[\w-]+)?($|[\s/\\'"])/;

function referencesEnvFile(detail: string): boolean {
  return ENV_FILE_RE.test(detail);
}

// Destructive bash command patterns. Deliberately generous (both `rm -rf` and `rm -fr`, any
// flag ordering) since false negatives here are the dangerous failure mode, not false positives.
const DESTRUCTIVE_BASH_PATTERNS: RegExp[] = [
  /\brm\s+(?:\S+\s+)*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\b/i, // rm -rf, rm -Rf, rm -r -f...
  /\brm\s+(?:\S+\s+)*-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\b/i, // rm -fr, rm -Fr...
  /\bmkfs(?:\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?:?/, // fork bomb ":(){ :|:& };:"
  /\bshutdown\b/i,
  /\breboot\b/i,
  />\s*\/dev\/sd\w*/i,
  /\bchmod\s+(?:\S+\s+)*-R\s+777\s+\//i,
  /\bmv\b.*\s\/dev\/null\b/i, // mv <dir> /dev/null
];

function isDestructiveBash(command: string): boolean {
  return DESTRUCTIVE_BASH_PATTERNS.some((re) => re.test(command));
}

function isHardDenied(req: PermissionRequest): boolean {
  if (referencesEnvFile(req.detail)) return true;
  if (req.tool === 'bash' && isDestructiveBash(req.detail)) return true;
  return false;
}

// ---- Glob -> RegExp -----------------------------------------------------------------------
// Supports `*` (any run of chars except `/`), `**` (any run of chars, including `/`), and `?`
// (single char). Everything else is treated literally.
function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i++;
      } else {
        pattern += '[^/]*';
      }
    } else if (c === '?') {
      pattern += '.';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      pattern += '\\' + c;
    } else {
      pattern += c;
    }
  }
  return new RegExp('^' + pattern + '$');
}

// ---- Mode-specific defaults -------------------------------------------------------------

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'move_file', 'bash']);
const READ_TOOLS = new Set(['read_file', 'list_files', 'search']);

export function createPermissions(cfg: PermissionConfig): PermissionChecker {
  // Internal mutable rules array, seeded from cfg.rules; addRule() (used by interactive
  // "always allow") appends to this array, not to cfg itself.
  const rules: PermissionRule[] = [...(cfg.rules ?? [])];

  function matchRules(detail: string): Decision | undefined {
    for (const rule of rules) {
      if (globToRegExp(rule.pattern).test(detail)) return rule.decision;
    }
    return undefined;
  }

  function check(req: PermissionRequest): Decision {
    // (1) Hard denies win over every mode, including yolo.
    if (isHardDenied(req)) return 'deny';

    // (2) Plan mode: read-only, never writes/bash.
    if (cfg.mode === 'plan') {
      return WRITE_TOOLS.has(req.tool) ? 'deny' : 'allow';
    }

    // (3) Yolo: allow everything except the hard denies handled above.
    if (cfg.mode === 'yolo') {
      return 'allow';
    }

    // (4) Normal mode: rules[] glob-match req.detail first (first match wins), else defaults.
    const ruleDecision = matchRules(req.detail);
    if (ruleDecision) return ruleDecision;

    if (READ_TOOLS.has(req.tool)) return 'allow';
    if (WRITE_TOOLS.has(req.tool)) return 'ask';
    return 'ask'; // unknown tool: default to the safe, interactive path
  }

  function addRule(rule: PermissionRule): void {
    rules.push(rule);
  }

  return { check, addRule };
}
