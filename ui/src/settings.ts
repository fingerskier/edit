// Settings: flat dotted keys as in VS Code's settings.json.

import { parseJsonc } from './jsonc.ts';

export const DEFAULT_SETTINGS = {
  'workbench.colorTheme': 'system' as 'system' | 'dark' | 'light',
  'editor.fontSize': 14,
  'editor.fontFamily': '"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  'editor.tabSize': 4,
  'editor.insertSpaces': true,
  'editor.detectIndentation': true,
  'editor.wordWrap': 'off' as 'off' | 'on',
  'editor.lineNumbers': 'on' as 'on' | 'off',
  'files.autoSave': 'off' as 'off' | 'afterDelay',
  'files.autoSaveDelay': 1000,
  'files.trimTrailingWhitespace': false,
  'files.insertFinalNewline': false,
  'files.exclude': ['.git', '.DS_Store'] as string[],
  'explorer.autoReveal': true,
  'window.restoreSession': true,
  'plugins.load': [] as string[],
  'plugins.disable': [] as string[],
};

export type Settings = typeof DEFAULT_SETTINGS & Record<string, unknown>;

/** Parse settings text over the defaults. Wrongly-typed known keys keep their default. */
export function parseSettings(text: string | undefined): { settings: Settings; error?: string } {
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  if (!text || text.trim() === '') return { settings };
  let user: unknown;
  try {
    user = parseJsonc(text);
  } catch (e) {
    return { settings, error: (e as Error).message };
  }
  if (user === undefined) return { settings };
  if (typeof user !== 'object' || user === null || Array.isArray(user)) {
    return { settings, error: 'settings.json must contain a JSON object' };
  }
  const defaults = DEFAULT_SETTINGS as Record<string, unknown>;
  for (const [key, value] of Object.entries(user)) {
    if (key in defaults) {
      const d = defaults[key];
      const sameType = Array.isArray(d) ? Array.isArray(value) : typeof d === typeof value;
      if (!sameType) continue;
    }
    settings[key] = value;
  }
  return { settings };
}

export const SETTINGS_TEMPLATE = `// Fedit settings. Uncomment a line to change it; saving applies it immediately.
{
${Object.entries(DEFAULT_SETTINGS)
  .map(([k, v]) => `  // ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join('\n')}
}
`;

export const KEYBINDINGS_TEMPLATE = `// Fedit keybindings, in the same format as VS Code's keybindings.json.
// Rules here are applied after the defaults, so they win. To remove a default,
// repeat its key with the command prefixed by "-".
// Run "Preferences: Open Default Keyboard Shortcuts" to see every default.
[
  // { "key": "ctrl+shift+d", "command": "editor.action.copyLinesDownAction", "when": "editorTextFocus" },
  // { "key": "ctrl+b", "command": "-workbench.action.toggleSidebarVisibility" }
]
`;

/** Guess indentation from the first indented lines of a document. */
export function detectIndentation(text: string): { insertSpaces: boolean; tabSize: number } | null {
  let tabs = 0;
  let spaces = 0;
  const widths = new Map<number, number>();
  let prevIndent = 0;
  let seen = 0;
  for (const line of text.split('\n', 2000)) {
    if (line.trim() === '') continue;
    if (++seen > 400) break;
    if (line[0] === '\t') {
      tabs++;
      prevIndent = 0;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent > 0 && line[0] === ' ') {
      spaces++;
      const delta = indent - prevIndent;
      if (delta > 0 && delta <= 8) widths.set(delta, (widths.get(delta) ?? 0) + 1);
    }
    prevIndent = indent;
  }
  if (tabs === 0 && spaces === 0) return null;
  if (tabs > spaces) return { insertSpaces: false, tabSize: 4 };
  let best = 4;
  let bestCount = 0;
  for (const [width, count] of widths) {
    if (count > bestCount || (count === bestCount && width < best)) {
      best = width;
      bestCount = count;
    }
  }
  return { insertSpaces: true, tabSize: best };
}
