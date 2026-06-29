import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../../../src/adapters/tui/layout.ts';
import { renderFrame, screenToText, screenToAnsi, type Screen } from '../../../src/adapters/tui/renderer.ts';
import type { Frame } from '../../../src/core/view.ts';

const row = (s: Screen, y: number): string => s.cells[y].map((c) => c.ch).join('');
const isRowInverse = (s: Screen, y: number): boolean => s.cells[y].every((c) => c.inverse);

test('main: renders editor lines and places the caret at the flat cursor offset', () => {
  const layout = computeLayout(80, 24);
  const frame: Frame = { main: { kind: 'text', lines: ['hello', 'world'], cursors: [7] } };
  const s = renderFrame(frame, layout);
  // line 0 "hello", line 1 "world" begin at main.x
  assert.ok(row(s, 0).includes('hello'));
  assert.ok(row(s, 1).includes('world'));
  // offset 7 in "hello\nworld" = line 1 ("world"), col 1 -> 'o'
  assert.deepEqual(s.cursor, { x: layout.main.x + 1, y: layout.main.y + 1 });
});

test('tree: highlights the selected row across the full column width', () => {
  const layout = computeLayout(80, 24);
  const frame: Frame = {
    tree: { kind: 'list', items: [{ label: 'a.txt' }, { label: 'b.txt' }], selected: 1 },
  };
  const s = renderFrame(frame, layout);
  assert.ok(row(s, 0).includes('a.txt'));
  assert.ok(row(s, 1).includes('b.txt'));
  // selected row (index 1) is inverse for every tree cell
  for (let x = layout.tree.x; x < layout.tree.x + layout.tree.width; x++) {
    assert.equal(s.cells[1][x].inverse, true);
  }
  assert.equal(s.cells[0][layout.tree.x].inverse, false);
});

test('status: fills the bottom row as an inverse bar with segment text', () => {
  const layout = computeLayout(80, 24);
  const frame: Frame = { status: { kind: 'status', segments: ['a.txt', 'Ln 1, Col 1'] } };
  const s = renderFrame(frame, layout);
  assert.equal(isRowInverse(s, 23), true);
  assert.ok(row(s, 23).includes('a.txt'));
  assert.ok(row(s, 23).includes('Ln 1, Col 1'));
});

test('overlay: draws a bordered box with title, and suppresses the editor caret', () => {
  const layout = computeLayout(80, 24);
  const frame: Frame = {
    main: { kind: 'text', lines: ['hello'], cursors: [3] },
    overlay: {
      kind: 'overlay',
      title: 'Commands',
      body: { kind: 'list', items: [{ label: 'Save File' }, { label: 'Undo' }], selected: 0 },
    },
  };
  const s = renderFrame(frame, layout);
  const o = layout.overlay;
  assert.equal(s.cells[o.y][o.x].ch, '┌');
  assert.equal(s.cells[o.y][o.x + o.width - 1].ch, '┐');
  assert.equal(s.cells[o.y + o.height - 1][o.x].ch, '└');
  assert.ok(row(s, o.y).includes('Commands'));
  assert.ok(row(s, o.y + 1).includes('Save File'));
  assert.equal(s.cursor, null, 'caret hidden while the overlay is open');
});

test('panel: draws a titled bar above the status row with its body below', () => {
  const layout = computeLayout(80, 24, { panelHeight: 5 });
  const frame: Frame = {
    main: { kind: 'text', lines: ['code'], cursors: [0] },
    panel: { kind: 'panel', title: 'Problems', body: { kind: 'list', items: [{ label: 'error: oops' }], selected: 0 } },
  };
  const s = renderFrame(frame, layout);
  // Title row is an inverse bar at the top of the panel region.
  assert.ok(row(s, layout.panel.y).includes('Problems'));
  assert.equal(isRowInverse(s, layout.panel.y), true);
  // Body renders below the title row.
  assert.ok(row(s, layout.panel.y + 1).includes('error: oops'));
  // The editor caret still renders (a panel does not suppress it like an overlay does).
  assert.ok(s.cursor, 'caret still placed with a panel open');
});

test('main: long line scrolls horizontally so the caret stays visible', () => {
  const layout = computeLayout(40, 10);
  const long = 'x'.repeat(200);
  const frame: Frame = { main: { kind: 'text', lines: [long], cursors: [199] } };
  const s = renderFrame(frame, layout);
  assert.ok(s.cursor, 'caret is placed');
  assert.ok(s.cursor!.x >= layout.main.x && s.cursor!.x < layout.main.x + layout.main.width);
});

test('main: many lines scroll vertically so the caret line is visible', () => {
  const layout = computeLayout(40, 6); // small content height
  const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
  // caret on the last line
  const offset = lines.join('\n').length;
  const frame: Frame = { main: { kind: 'text', lines, cursors: [offset] } };
  const s = renderFrame(frame, layout);
  assert.ok(s.cursor, 'caret placed');
  assert.ok(s.cursor!.y >= layout.main.y && s.cursor!.y < layout.main.y + layout.main.height);
});

test('screenToText trims trailing blanks per row', () => {
  const layout = computeLayout(80, 24);
  const frame: Frame = { main: { kind: 'text', lines: ['hi'], cursors: [0] } };
  const text = screenToText(renderFrame(frame, layout));
  const first = text.split('\n')[0];
  assert.ok(first.endsWith('hi'), `expected trimmed line to end with "hi", got: ${JSON.stringify(first)}`);
});

test('screenToAnsi emits reverse-video runs and absolute row moves', () => {
  const layout = computeLayout(20, 3);
  const frame: Frame = { status: { kind: 'status', segments: ['s'] } };
  const ansi = screenToAnsi(renderFrame(frame, layout));
  assert.match(ansi, /\x1b\[7m/, 'turns reverse on for the status bar');
  assert.match(ansi, /\x1b\[27m/, 'turns reverse off again');
  assert.match(ansi, /\x1b\[1;1H/, 'positions the first row absolutely');
});
