import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalWhen } from '../ui/src/context.ts';
import {
  formatKey, isTypingPress, keyForCommand, mergeRules, normalizeKey, pressFromEvent, resolveKey, toMacKey,
} from '../ui/src/keybindings.ts';
import { parseJsonc } from '../ui/src/jsonc.ts';
import { detectIndentation, parseSettings, SETTINGS_TEMPLATE, KEYBINDINGS_TEMPLATE } from '../ui/src/settings.ts';
import { basename, dirname, isWithin, join, relative, tildify } from '../ui/src/paths.ts';
import { fuzzyRank } from '../ui/src/fuzzy.ts';

const ev = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
  key, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
});

test('key strings normalize to one canonical form', () => {
  assert.equal(normalizeKey('Shift+Ctrl+P'), 'ctrl+shift+p');
  assert.equal(normalizeKey('cmd+k  cmd+s'), 'meta+k meta+s');
  assert.equal(normalizeKey('ctrl+pgdn'), 'ctrl+pagedown');
  assert.equal(normalizeKey('Escape'), 'escape');
  assert.equal(normalizeKey('ctrl++'), 'ctrl+=');
  assert.equal(normalizeKey('ctrl+oem_2'), 'ctrl+/');
});

test('keyboard events map to the same form, by physical key', () => {
  assert.equal(pressFromEvent(ev('P', 'KeyP', { ctrlKey: true, shiftKey: true })), 'ctrl+shift+p');
  assert.equal(pressFromEvent(ev('?', 'Slash', { ctrlKey: true, shiftKey: true })), 'ctrl+shift+/');
  assert.equal(pressFromEvent(ev('ArrowUp', 'ArrowUp', { altKey: true })), 'alt+up');
  assert.equal(pressFromEvent(ev('+', 'Equal', { ctrlKey: true, shiftKey: true })), 'ctrl+shift+=');
  assert.equal(pressFromEvent(ev('F2', 'F2')), 'f2');
  assert.equal(pressFromEvent(ev('Control', 'ControlLeft', { ctrlKey: true })), null);
  assert.equal(pressFromEvent(ev('Tab', 'Tab', { ctrlKey: true })), 'ctrl+tab');
});

test('typing presses are told apart from shortcuts', () => {
  assert.equal(isTypingPress('a'), true);
  assert.equal(isTypingPress('shift+a'), true);
  assert.equal(isTypingPress('enter'), true);
  assert.equal(isTypingPress('ctrl+a'), false);
  assert.equal(isTypingPress('f2'), false);
  assert.equal(isTypingPress('escape'), false);
});

test('mac translation swaps ctrl for cmd except tab switching', () => {
  assert.equal(toMacKey('ctrl+shift+p'), 'shift+meta+p');
  assert.equal(toMacKey('ctrl+k ctrl+o'), 'meta+k meta+o');
  assert.equal(toMacKey('ctrl+tab'), 'ctrl+tab');
  assert.equal(toMacKey('ctrl+pagedown'), 'ctrl+pagedown');
  assert.equal(toMacKey('alt+up'), 'alt+up');
});

test('when clauses', () => {
  const ctx = (k: string) => ({ editorTextFocus: true, lang: 'json', n: 0 } as Record<string, unknown>)[k] as never;
  assert.equal(evalWhen(undefined, ctx), true);
  assert.equal(evalWhen('editorTextFocus', ctx), true);
  assert.equal(evalWhen('!editorTextFocus', ctx), false);
  assert.equal(evalWhen('editorTextFocus && !missing', ctx), true);
  assert.equal(evalWhen('missing || lang == json', ctx), true);
  assert.equal(evalWhen("lang != 'json'", ctx), false);
  assert.equal(evalWhen('missing && editorTextFocus || editorTextFocus', ctx), true);
  assert.equal(evalWhen('!(missing || editorTextFocus)', ctx), false);
  assert.equal(evalWhen('editorTextFocus &&& x', ctx), false);
  assert.equal(evalWhen('a ~ b', ctx), false);
});

test('user rules override and remove defaults', () => {
  const defaults = [
    { key: 'ctrl+s', command: 'save' },
    { key: 'ctrl+b', command: 'sidebar' },
    { key: 'ctrl+d', command: 'next', when: 'editorTextFocus' },
  ];
  const rules = mergeRules(defaults, [
    { key: 'Ctrl+S', command: 'mySave' },
    { key: 'ctrl+b', command: '-sidebar' },
    { key: 'ctrl+d', command: '-next', when: 'somethingElse' },
    { key: 5 as never, command: 'bad' },
  ]);
  const none = () => true as const;
  assert.deepEqual(resolveKey(rules, ['ctrl+s'], none), { type: 'command', command: 'mySave', args: undefined });
  assert.deepEqual(resolveKey(rules, ['ctrl+b'], none), { type: 'none' });
  assert.equal(resolveKey(rules, ['ctrl+d'], none).type, 'command', 'removal with a different when leaves the rule');
  assert.equal(keyForCommand(rules, 'save'), 'ctrl+s');
});

test('chords: prefix waits, second key completes, when is honoured', () => {
  const rules = mergeRules([
    { key: 'ctrl+k', command: 'single' },
    { key: 'ctrl+k ctrl+o', command: 'openFolder' },
    { key: 'ctrl+k s', command: 'saveAll', when: 'never' },
    { key: 'ctrl+g', command: 'goto', when: 'editorFocus' },
  ], []);
  const ctx = (k: string) => k === 'editorFocus';
  assert.deepEqual(resolveKey(rules, ['ctrl+k'], ctx), { type: 'chord' });
  assert.equal((resolveKey(rules, ['ctrl+k', 'ctrl+o'], ctx) as { command: string }).command, 'openFolder');
  assert.deepEqual(resolveKey(rules, ['ctrl+k', 's'], ctx), { type: 'none' });
  assert.equal(resolveKey(rules, ['ctrl+g'], ctx).type, 'command');
  assert.equal(resolveKey(rules, ['ctrl+g'], () => false).type, 'none');
  // With every chord rule inactive, the single-key binding applies.
  assert.equal((resolveKey(mergeRules([{ key: 'ctrl+k', command: 'single' }, { key: 'ctrl+k s', command: 'x', when: 'never' }], []), ['ctrl+k'], ctx) as { command: string }).command, 'single');
});

test('key labels', () => {
  assert.equal(formatKey('ctrl+k ctrl+o'), 'Ctrl+K Ctrl+O');
  assert.equal(formatKey('ctrl+shift+pagedown'), 'Ctrl+Shift+Pagedown');
  assert.equal(formatKey('shift+meta+p', true), '⇧⌘P');
});

test('jsonc: comments and trailing commas, strings untouched', () => {
  assert.deepEqual(parseJsonc('{ // c\n "a": "x // y", /* b */ "b": [1, 2,], }'), { a: 'x // y', b: [1, 2] });
  assert.deepEqual(parseJsonc('{"a": ",}"}'), { a: ',}' });
  assert.deepEqual(parseJsonc('{"a": "q\\"//"}'), { a: 'q"//' });
  assert.equal(parseJsonc('  // only a comment\n'), undefined);
  assert.throws(() => parseJsonc('{ nope }'));
});

test('settings parse over defaults and ignore wrong types', () => {
  const { settings, error } = parseSettings('{ "editor.tabSize": 2, "editor.wordWrap": 5, "my.plugin": {"x": 1}, }');
  assert.equal(error, undefined);
  assert.equal(settings['editor.tabSize'], 2);
  assert.equal(settings['editor.wordWrap'], 'off');
  assert.deepEqual(settings['my.plugin'], { x: 1 });
  assert.ok(parseSettings('{ broken').error);
  assert.ok(parseSettings('[1]').error);
  assert.equal(parseSettings('').settings['editor.fontSize'], 14);
  // The shipped templates must themselves be valid.
  assert.equal(parseSettings(SETTINGS_TEMPLATE).error, undefined);
  assert.deepEqual(parseJsonc(KEYBINDINGS_TEMPLATE), []);
});

test('indentation detection', () => {
  assert.deepEqual(detectIndentation('a\n  b\n    c\n  d\n'), { insertSpaces: true, tabSize: 2 });
  assert.deepEqual(detectIndentation('a\n    b\n        c\n'), { insertSpaces: true, tabSize: 4 });
  assert.deepEqual(detectIndentation('a\n\tb\n\t\tc\n'), { insertSpaces: false, tabSize: 4 });
  assert.equal(detectIndentation('a\nb\n'), null);
});

test('paths', () => {
  assert.equal(basename('/a/b/c.txt'), 'c.txt');
  assert.equal(basename('C:\\a\\b.txt'), 'b.txt');
  assert.equal(dirname('/a/b/c.txt'), '/a/b');
  assert.equal(dirname('/a'), '/');
  assert.equal(dirname('C:\\a.txt'), 'C:\\');
  assert.equal(join('/a/b/', 'c'), '/a/b/c');
  assert.equal(join('C:\\a', 'b'), 'C:\\a\\b');
  assert.equal(isWithin('/a/bc', '/a/b'), false);
  assert.equal(isWithin('/a/b/c', '/a/b'), true);
  assert.equal(relative('/a/b/c/d.txt', '/a/b'), 'c/d.txt');
  assert.equal(relative('/x/d.txt', '/a/b'), '/x/d.txt');
  assert.equal(tildify('/home/u/x', '/home/u'), '~/x');
});

test('fuzzy ranking prefers boundaries', () => {
  assert.deepEqual(fuzzyRank('mt', ['src/main.ts', 'docs/empty.md', 'x'], (s) => s), ['src/main.ts', 'docs/empty.md']);
});
