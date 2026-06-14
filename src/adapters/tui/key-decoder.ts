// Pure, stateless terminal input decoder: raw stdin (UTF-8 decoded to a string)
// -> the key tokens the keymap plugin expects (phase2-contracts §C).
//
// Token contract:
//   - Printable characters -> the literal single code point (incl. shift, e.g. 'A').
//     The SPACE bar decodes to the literal ' ' (NOT 'space') so it flows through the
//     `<printable>` binding path: isPrintable(' ') === true, and the editor/palette
//     insert/filter spaces via `<context>:<printable>`. ('space' stays a valid keyspec
//     name for explicit bindings, but the key itself arrives as ' '.)
//   - Named keys -> 'enter', 'tab', 'backspace', 'escape', 'up', 'down', 'left',
//     'right', 'home', 'end', 'delete'.
//   - Chords -> 'ctrl+<letter>' (from C0 control bytes), 'alt+<char>', and modified
//     arrows/home/end like 'alt+left', 'ctrl+right'.
//
// Statelessness: each call decodes one chunk independently. On a local TTY a single
// keypress (incl. an escape sequence) arrives whole, so this is sufficient for M1.
// A sequence split across chunks is decoded best-effort (a truncated CSI is dropped).

const ESC = 0x1b;
const C0_MIN = 0x01;
const C0_MAX = 0x1a;

interface Decoded {
  /** null means "consumed but emit nothing" (e.g. a truncated/unknown sequence). */
  token: string | null;
  length: number;
}

/** Decode one input chunk into zero or more key tokens. */
export function decodeKeys(chunk: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    const d = decodeOne(chunk, i);
    if (d.token !== null && d.token !== '') out.push(d.token);
    i += Math.max(1, d.length);
  }
  return out;
}

function decodeOne(s: string, i: number): Decoded {
  const code = s.charCodeAt(i);

  if (code === ESC) return decodeEscape(s, i);

  // Named C0 controls take precedence over the generic ctrl+<letter> mapping.
  if (code === 0x0d || code === 0x0a) return { token: 'enter', length: 1 };      // CR / LF
  if (code === 0x09) return { token: 'tab', length: 1 };                          // HT
  if (code === 0x7f || code === 0x08) return { token: 'backspace', length: 1 };   // DEL / BS

  // Remaining C0 controls -> ctrl+<letter> (0x01->ctrl+a … 0x1a->ctrl+z).
  if (code >= C0_MIN && code <= C0_MAX) {
    return { token: 'ctrl+' + String.fromCharCode(0x60 + code), length: 1 };
  }
  // Other unprintable controls (NUL, 0x1c-0x1f) -> swallow.
  if (code < 0x20) return { token: null, length: 1 };

  // Printable: emit the full code point (handles astral chars / surrogate pairs).
  const cp = s.codePointAt(i)!;
  const ch = String.fromCodePoint(cp);
  return { token: ch, length: ch.length };
}

function decodeEscape(s: string, i: number): Decoded {
  const next = s[i + 1];
  if (next === undefined) return { token: 'escape', length: 1 }; // lone ESC = Escape key

  if (next === '[' || next === 'O') return decodeCsi(s, i);

  // ESC <byte> = Alt/Meta chord (xterm "meta sends escape" model).
  const c = s.charCodeAt(i + 1);
  if (c === 0x7f || c === 0x08) return { token: 'alt+backspace', length: 2 };
  if (c === ESC) return { token: 'escape', length: 1 }; // ESC ESC: emit one, re-read the next
  if (c >= 0x20) {
    const cp = s.codePointAt(i + 1)!;
    const ch = String.fromCodePoint(cp);
    return { token: 'alt+' + ch, length: 1 + ch.length };
  }
  return { token: 'escape', length: 1 };
}

// CSI/SS3 sequences: ESC '[' params final  |  ESC 'O' final.
function decodeCsi(s: string, i: number): Decoded {
  const intro = s[i + 1];

  // SS3 (application keypad): ESC O <final>, no parameters.
  if (intro === 'O') {
    const final = s[i + 2];
    if (final === undefined) return { token: null, length: s.length - i }; // truncated
    const base = finalToBase(final);
    return { token: base ?? null, length: 3 };
  }

  // CSI: ESC [ <0-9;>* <final>
  let j = i + 2;
  let params = '';
  while (j < s.length) {
    const ch = s[j];
    if ((ch >= '0' && ch <= '9') || ch === ';') { params += ch; j++; } else break;
  }
  const final = s[j];
  if (final === undefined) return { token: null, length: s.length - i }; // truncated CSI: drop
  const length = j - i + 1;

  const parts = params.split(';');
  const mod = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
  const prefix = Number.isFinite(mod) ? modifierPrefix(mod) : '';

  if (final === '~') {
    const base = tildeToBase(parts[0]);
    return { token: base ? prefix + base : null, length };
  }

  const base = finalToBase(final);
  return { token: base ? prefix + base : null, length };
}

// Letter finals shared by CSI (ESC [ A) and SS3 (ESC O A).
function finalToBase(final: string): string | undefined {
  switch (final) {
    case 'A': return 'up';
    case 'B': return 'down';
    case 'C': return 'right';
    case 'D': return 'left';
    case 'H': return 'home';
    case 'F': return 'end';
    default: return undefined;
  }
}

// Tilde-terminated keypad codes: ESC [ <n> ~.
function tildeToBase(n: string): string | undefined {
  switch (n) {
    case '1':
    case '7': return 'home';
    case '4':
    case '8': return 'end';
    case '3': return 'delete';
    default: return undefined; // 2=insert, 5/6=pgup/pgdn: unused in M1
  }
}

// xterm modifier param: 1 + (shift?1) + (alt?2) + (ctrl?4) + (meta?8). Meta is
// folded into alt so Option/Alt arrows decode identically across terminals.
function modifierPrefix(mod: number): string {
  const flags = mod - 1;
  let p = '';
  if (flags & 4) p += 'ctrl+';
  if (flags & 2 || flags & 8) p += 'alt+';
  if (flags & 1) p += 'shift+';
  return p;
}
