import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeKeys } from '../../../src/adapters/tui/key-decoder.ts';

// One input chunk -> expected token list.
const cases: Array<[string, string, string[]]> = [
  // printables
  ['lowercase letter', 'a', ['a']],
  ['uppercase letter (shift)', 'A', ['A']],
  ['digit', '7', ['7']],
  ['symbol', '!', ['!']],
  ['space bar -> literal space (NOT "space")', ' ', [' ']],
  ['multibyte utf-8 char', 'é', ['é']],
  ['astral / surrogate pair', '😀', ['😀']],
  ['a typed word in one chunk', 'hi!', ['h', 'i', '!']],

  // named keys
  ['carriage return -> enter', '\r', ['enter']],
  ['line feed -> enter', '\n', ['enter']],
  ['tab', '\t', ['tab']],
  ['DEL -> backspace', '\x7f', ['backspace']],
  ['BS -> backspace', '\x08', ['backspace']],
  ['lone ESC -> escape', '\x1b', ['escape']],

  // ctrl chords from C0 controls
  ['ctrl+a', '\x01', ['ctrl+a']],
  ['ctrl+s', '\x13', ['ctrl+s']],
  ['ctrl+z', '\x1a', ['ctrl+z']],
  ['ctrl+p', '\x10', ['ctrl+p']],
  ['ctrl+y', '\x19', ['ctrl+y']],
  ['ctrl+q', '\x11', ['ctrl+q']],

  // CSI arrows
  ['up', '\x1b[A', ['up']],
  ['down', '\x1b[B', ['down']],
  ['right', '\x1b[C', ['right']],
  ['left', '\x1b[D', ['left']],
  ['home (H)', '\x1b[H', ['home']],
  ['end (F)', '\x1b[F', ['end']],

  // SS3 (application keypad) arrows
  ['ss3 up', '\x1bOA', ['up']],
  ['ss3 home', '\x1bOH', ['home']],

  // tilde keypad codes
  ['home (1~)', '\x1b[1~', ['home']],
  ['end (4~)', '\x1b[4~', ['end']],
  ['delete (3~)', '\x1b[3~', ['delete']],
  ['pageup (5~)', '\x1b[5~', ['pageup']],
  ['pagedown (6~)', '\x1b[6~', ['pagedown']],
  ['insert (2~) ignored', '\x1b[2~', []],

  // modified arrows (the contract needs alt+left / alt+right for focus toggle)
  ['alt+left', '\x1b[1;3D', ['alt+left']],
  ['alt+right', '\x1b[1;3C', ['alt+right']],
  ['ctrl+left', '\x1b[1;5D', ['ctrl+left']],
  ['meta+left folds to alt+left', '\x1b[1;9D', ['alt+left']],
  ['ctrl+delete', '\x1b[3;5~', ['ctrl+delete']],
  ['ctrl+pageup', '\x1b[5;5~', ['ctrl+pageup']],
  ['ctrl+pagedown', '\x1b[6;5~', ['ctrl+pagedown']],

  // alt + char via ESC-prefix
  ['alt+b', '\x1bb', ['alt+b']],
  ['alt+backspace', '\x1b\x7f', ['alt+backspace']],

  // multiple keys in one chunk
  ['arrow then char', '\x1b[Ax', ['up', 'x']],
  ['two arrows', '\x1b[A\x1b[B', ['up', 'down']],
];

for (const [name, input, expected] of cases) {
  test(`decodeKeys: ${name}`, () => {
    assert.deepEqual(decodeKeys(input), expected);
  });
}

test('decodeKeys: empty chunk yields nothing', () => {
  assert.deepEqual(decodeKeys(''), []);
});

test('decodeKeys: truncated CSI is dropped (stateless, best-effort)', () => {
  assert.deepEqual(decodeKeys('\x1b['), []);
});
