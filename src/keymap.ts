export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  "alt+up": "tree.navigate.up",
  "alt+down": "tree.navigate.down",
  "alt+left": "tree.collapse",
  "alt+right": "tree.expand",
  "ctrl+o": "quickOpen.open",
  "ctrl+p": "palette.open",
  q: "app.quit",
  "ctrl+c": "app.quit",
  p: "palette.open",
  t: "tree.focus",
  e: "editor.focus"
};

export function normalizeKeypress(data: string): string | undefined {
  const keyMap = new Map<string, string>([
    ["\u001b[1;3A", "alt+up"],
    ["\u001b\u001b[A", "alt+up"],
    ["\u001b[1;3B", "alt+down"],
    ["\u001b\u001b[B", "alt+down"],
    ["\u001b[1;3D", "alt+left"],
    ["\u001b\u001b[D", "alt+left"],
    ["\u001b[1;3C", "alt+right"],
    ["\u001b\u001b[C", "alt+right"],
    ["\u000f", "ctrl+o"],
    ["\u0010", "ctrl+p"],
    ["\u0003", "ctrl+c"],
    ["\r", "enter"],
    ["\n", "enter"],
    ["\u007f", "backspace"]
  ]);

  const mapped = keyMap.get(data);
  if (mapped) {
    return mapped;
  }

  if (data.length === 1 && data >= " " && data <= "~") {
    return data;
  }

  return undefined;
}

export class Keymap {
  private readonly bindings: Record<string, string>;

  constructor(bindings: Record<string, string> = {}) {
    this.bindings = { ...DEFAULT_KEYBINDINGS, ...bindings };
  }

  commandForInput(data: string): string | undefined {
    const key = normalizeKeypress(data);
    return key ? this.bindings[key] : undefined;
  }

  commandForKey(key: string): string | undefined {
    return this.bindings[key];
  }

  entries(): Record<string, string> {
    return { ...this.bindings };
  }
}
