import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TuiAdapter } from '../../../src/adapters/tui/tui-adapter.ts';
import type { Frame } from '../../../src/core/view.ts';
import { FakeTerminal } from './fake-terminal.ts';

test('constructor starts the terminal', () => {
  const term = new FakeTerminal();
  new TuiAdapter(term);
  assert.equal(term.started, true);
});

test('render paints the frame to the terminal (content appears in the ANSI write)', () => {
  const term = new FakeTerminal(80, 24);
  const adapter = new TuiAdapter(term);
  const frame: Frame = {
    tree: { kind: 'list', items: [{ label: 'a.txt' }], selected: 0 },
    main: { kind: 'text', lines: ['hello world'], cursors: [0] },
    status: { kind: 'status', segments: ['a.txt'] },
  };
  adapter.render(frame);
  const out = term.lastWrite();
  assert.ok(out.includes('a.txt'), 'tree/status content painted');
  assert.ok(out.includes('hello world'), 'editor content painted');
  assert.match(out, /\x1b\[\?25h/, 'shows the caret when the editor has focus');
});

test('forwards decoded keys from the terminal to the registered handler', () => {
  const term = new FakeTerminal();
  const adapter = new TuiAdapter(term);
  const got: string[] = [];
  adapter.onKey((k) => got.push(k));
  term.feedRaw('x\x1b[D'); // 'x' then left-arrow
  assert.deepEqual(got, ['x', 'left']);
});

test('keys arriving before onKey is registered are dropped (no throw)', () => {
  const term = new FakeTerminal();
  new TuiAdapter(term);
  assert.doesNotThrow(() => term.sendKey('a'));
});

test('repaints the last frame on resize against the new geometry', () => {
  const term = new FakeTerminal(80, 24);
  const adapter = new TuiAdapter(term);
  adapter.render({ status: { kind: 'status', segments: ['hi'] } });
  const before = term.writes.length;
  term.resize(100, 30);
  assert.ok(term.writes.length > before, 'a resize triggers a repaint');
  assert.ok(term.lastWrite().includes('hi'), 'last frame is repainted');
});

test('dispose stops the terminal and clears the key handler', () => {
  const term = new FakeTerminal();
  const adapter = new TuiAdapter(term);
  const got: string[] = [];
  adapter.onKey((k) => got.push(k));
  adapter.dispose();
  assert.equal(term.stopped, true);
  term.sendKey('a');
  assert.deepEqual(got, [], 'no keys delivered after dispose');
});
