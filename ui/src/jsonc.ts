// JSON with `//` and `/* */` comments and trailing commas, as VS Code allows
// in settings.json and keybindings.json.

export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  // Trailing commas: a comma followed only by whitespace before `}` or `]`.
  // Strings are skipped so a "," inside one is never touched.
  let result = '';
  i = 0;
  while (i < out.length) {
    const ch = out[i];
    if (ch === '"') {
      const start = i++;
      while (i < out.length && out[i] !== '"') i += out[i] === '\\' ? 2 : 1;
      result += out.slice(start, ++i);
    } else if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] !== '}' && out[j] !== ']') result += ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

export function parseJsonc<T = unknown>(text: string): T {
  const stripped = stripJsonc(text);
  if (stripped.trim() === '') return undefined as T;
  return JSON.parse(stripped) as T;
}
