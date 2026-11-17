// Keybinding rules in VS Code's keybindings.json shape, normalization of key
// strings and keyboard events to one canonical form, and resolution of a
// pressed key sequence (with two-key chords) to a command.

import { evalWhen, type ContextReader } from './context.ts';

export interface KeybindingRule {
  key: string;
  /** A command id, or `-commandId` to remove an earlier rule for this key. */
  command: string;
  when?: string;
  args?: unknown;
}

const MODIFIER_ORDER = ['ctrl', 'shift', 'alt', 'meta'] as const;
const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt',
  meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta', super: 'meta',
};
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape', return: 'enter', del: 'delete', ins: 'insert', spacebar: 'space',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  pgup: 'pageup', pgdn: 'pagedown', plus: '=', ' ': 'space',
  oem_comma: ',', oem_period: '.', oem_minus: '-', oem_plus: '=', oem_1: ';', oem_2: '/',
  oem_3: '`', oem_4: '[', oem_5: '\\', oem_6: ']', oem_7: "'",
};

/** Canonicalize one key press like `Shift+Ctrl+P` to `ctrl+shift+p`. */
export function normalizePress(press: string): string {
  const raw = press.trim().toLowerCase();
  // A trailing `+` is the plus key itself: `ctrl++`.
  const parts = raw.endsWith('++') ? [...raw.slice(0, -2).split('+'), '+'] : raw === '+' ? ['+'] : raw.split('+');
  const mods = new Set<string>();
  let key = '';
  for (const part of parts) {
    const p = part.trim();
    if (p in MODIFIER_ALIASES && part !== parts[parts.length - 1]) mods.add(MODIFIER_ALIASES[p]);
    else if (p in MODIFIER_ALIASES && parts.length > 1 && key === '' && part === parts[parts.length - 1]) key = p;
    else key = KEY_ALIASES[p] ?? p;
  }
  if (key === '+') key = '=';
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+');
}

/** Canonicalize a full binding, which may be a chord: `Ctrl+K Ctrl+O`. */
export function normalizeKey(key: string): string {
  return key.trim().split(/\s+/).map(normalizePress).join(' ');
}

const CODE_KEYS: Record<string, string> = {
  Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-',
  Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`', Space: 'space',
  NumpadAdd: 'numpad_add', NumpadSubtract: 'numpad_subtract', NumpadEnter: 'enter',
};
const NAMED_KEYS: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Escape: 'escape', Enter: 'enter', Tab: 'tab', Backspace: 'backspace', Delete: 'delete',
  Insert: 'insert', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space',
};

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * The canonical press for a keyboard event, or null for a bare modifier.
 * Letters, digits and punctuation come from the physical key (`code`), so a
 * binding like `ctrl+/` works whatever Shift or AltGr would make the key type.
 */
export function pressFromEvent(e: KeyEventLike): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null;
  let key: string;
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = 'numpad' + code.slice(6);
  else if (code in CODE_KEYS) key = CODE_KEYS[code];
  else if (e.key in NAMED_KEYS) key = NAMED_KEYS[e.key];
  else key = e.key.toLowerCase();
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.shiftKey) mods.push('shift');
  if (e.altKey) mods.push('alt');
  if (e.metaKey) mods.push('meta');
  return [...mods, key].join('+');
}

/** True when a press is plain typing: no Ctrl/Alt/Meta and not a function or Escape key. */
export function isTypingPress(press: string): boolean {
  const parts = press.split('+');
  const key = parts[parts.length - 1];
  if (parts.some((p) => p === 'ctrl' || p === 'alt' || p === 'meta')) return false;
  return !/^f\d{1,2}$/.test(key) && key !== 'escape';
}

/**
 * Translate a default binding for macOS: Ctrl becomes Cmd, except for tab
 * switching, which stays on Ctrl as in VS Code.
 */
export function toMacKey(key: string): string {
  return normalizeKey(key)
    .split(' ')
    .map((press) => (/(^|\+)(tab|pageup|pagedown)$/.test(press) ? press : press.replace(/(^|\+)ctrl(\+|$)/, '$1meta$2')))
    .map(normalizePress)
    .join(' ');
}

/**
 * Merge default and user rules into the effective list. Later rules win. A
 * user rule whose command starts with `-` removes earlier rules for that key
 * and command (and `when`, if the removal names one).
 */
export function mergeRules(defaults: KeybindingRule[], user: KeybindingRule[]): KeybindingRule[] {
  const out: KeybindingRule[] = [];
  for (const rule of [...defaults, ...user]) {
    if (!rule || typeof rule.key !== 'string' || typeof rule.command !== 'string') continue;
    const key = normalizeKey(rule.key);
    if (rule.command.startsWith('-')) {
      const target = rule.command.slice(1);
      for (let i = out.length - 1; i >= 0; i--) {
        const r = out[i];
        if (r.key === key && r.command === target && (rule.when === undefined || rule.when === r.when)) out.splice(i, 1);
      }
    } else {
      out.push({ ...rule, key });
    }
  }
  return out;
}

export type Resolution =
  | { type: 'command'; command: string; args?: unknown }
  | { type: 'chord' }
  | { type: 'none' };

/**
 * Resolve the presses so far (one, or two when completing a chord) against
 * normalized rules. A chord prefix wins over a single-key binding, so
 * `ctrl+k` waits for a second key whenever any `ctrl+k …` rule applies.
 */
export function resolveKey(rules: KeybindingRule[], presses: string[], ctx: ContextReader): Resolution {
  const typed = presses.join(' ');
  let prefix = false;
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (rule.key === typed) {
      if (!prefix && evalWhen(rule.when, ctx)) return { type: 'command', command: rule.command, args: rule.args };
    } else if (presses.length === 1 && rule.key.startsWith(typed + ' ') && evalWhen(rule.when, ctx)) {
      prefix = true;
    }
  }
  if (prefix) return { type: 'chord' };
  return { type: 'none' };
}

/** Human-readable label for a normalized key: `ctrl+k ctrl+o` → `Ctrl+K Ctrl+O`. */
export function formatKey(key: string, mac = false): string {
  const names: Record<string, string> = mac
    ? { ctrl: '⌃', shift: '⇧', alt: '⌥', meta: '⌘' }
    : { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Super' };
  return key
    .split(' ')
    .map((press) =>
      press
        .split('+')
        .map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
        .join(mac ? '' : '+'),
    )
    .join(' ');
}

/** The last effective key bound to `command`, for showing next to palette entries. */
export function keyForCommand(rules: KeybindingRule[], command: string): string | undefined {
  for (let i = rules.length - 1; i >= 0; i--) if (rules[i].command === command) return rules[i].key;
  return undefined;
}
