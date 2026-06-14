import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp, type App } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import keymap, { type FocusService } from '../../src/plugins/keymap.ts';
import editorView, {
  lineStarts,
  offsetToLineCol,
  lineColToOffset,
} from '../../src/plugins/editor-view.ts';
import type { Plugin, PluginContext } from '../../src/core/plugin-host.ts';

// A tiny inspector plugin so the test can reach the live FocusService instance
// (the App surface does not expose ctx.services). Activated AFTER keymap, so the
// 'focus' service is already registered.
function focusProbe(): { plugin: Plugin; focus: () => FocusService } {
  let svc: FocusService | null = null;
  const plugin: Plugin = {
    name: 'test-focus-probe',
    activate(ctx: PluginContext): void {
      svc = ctx.services.get<FocusService>('focus');
    },
  };
  return {
    plugin,
    focus: () => {
      if (!svc) throw new Error('focus service not captured');
      return svc;
    },
  };
}

interface Setup {
  adapter: HeadlessAdapter;
  app: App;
  focus: () => FocusService;
}

async function setup(initial = '', opts: { open?: boolean } = {}): Promise<Setup> {
  const adapter = new HeadlessAdapter();
  const probe = focusProbe();
  const app = await createApp({
    adapter,
    // keymap MUST be first (seeds 'focus' service + sole 'key' listener).
    plugins: [keymap, editorView, probe.plugin],
    roots: [],
  });
  if (opts.open !== false) app.workspace.openScratch(initial);
  app.render();
  return { adapter, app, focus: probe.focus };
}

function main(adapter: HeadlessAdapter): { kind: 'text'; lines: string[]; cursors: number[] } {
  const frame = adapter.lastFrame();
  assert.ok(frame, 'expected a rendered frame');
  const w = frame!.main;
  assert.ok(w && w.kind === 'text', 'expected a text widget in slot "main"');
  const tw = w as { kind: 'text'; lines: string[]; cursors?: number[] };
  return { kind: 'text', lines: tw.lines, cursors: tw.cursors ?? [] };
}

// --- pure line-index helpers ---

test('lineStarts handles empty buffer, trailing newline, and agrees with split', () => {
  assert.deepEqual(lineStarts(''), [0]);
  assert.deepEqual(''.split('\n'), ['']);
  assert.equal(lineStarts('').length, ''.split('\n').length);

  assert.deepEqual(lineStarts('abc'), [0]);
  assert.deepEqual(lineStarts('a\nb'), [0, 2]);
  assert.deepEqual(lineStarts('a\n'), [0, 2]);
  assert.deepEqual('a\n'.split('\n'), ['a', '']);
  assert.equal(lineStarts('a\n').length, 'a\n'.split('\n').length);

  const text = 'abcd\nx\nefgh';
  const starts = lineStarts(text);
  assert.equal(starts.length, text.split('\n').length);
  assert.deepEqual(starts, [0, 5, 7]);
});

test('offsetToLineCol and lineColToOffset round-trip (UTF-16 columns)', () => {
  const text = 'abcd\nx\nefgh';
  assert.deepEqual(offsetToLineCol(text, 0), { line: 0, col: 0 });
  assert.deepEqual(offsetToLineCol(text, 3), { line: 0, col: 3 });
  assert.deepEqual(offsetToLineCol(text, 5), { line: 1, col: 0 });
  assert.deepEqual(offsetToLineCol(text, 6), { line: 1, col: 1 });
  assert.deepEqual(offsetToLineCol(text, 10), { line: 2, col: 3 });
  // clamps an out-of-range offset
  assert.deepEqual(offsetToLineCol(text, 999), { line: 2, col: 4 });

  assert.equal(lineColToOffset(text, 0, 3), 3);
  assert.equal(lineColToOffset(text, 1, 1), 6);
  assert.equal(lineColToOffset(text, 2, 3), 10);
  // clamps a too-large column to the line length
  assert.equal(lineColToOffset(text, 1, 9), 6);
  // clamps an out-of-range line
  assert.equal(lineColToOffset(text, 99, 0), 7);
});

// --- view provider ---

test('main slot renders empty buffer as one blank line with caret at 0', async () => {
  const { adapter } = await setup('');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['']);
  assert.deepEqual(w.cursors, [0]);
});

test('main slot renders [""] / [0] when there is no active document', async () => {
  const { adapter } = await setup('', { open: false });
  const w = main(adapter);
  assert.deepEqual(w.lines, ['']);
  assert.deepEqual(w.cursors, [0]);
});

test('main slot splits multi-line text and reports the caret offset', async () => {
  const { adapter, app } = await setup('ab\ncd');
  app.workspace.setSelection({ anchor: 4, head: 4 });
  const w = main(adapter);
  assert.deepEqual(w.lines, ['ab', 'cd']);
  assert.deepEqual(w.cursors, [4]);
});

// --- typing ---

test('typing printable chars inserts text and advances the caret', async () => {
  const { adapter, app } = await setup('');
  adapter.sendKey('h');
  adapter.sendKey('i');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['hi']);
  assert.deepEqual(w.cursors, [2]);
  assert.equal(app.workspace.activeDocument!.text(), 'hi');
  assert.equal(app.workspace.activeDocument!.selection.head, 2);
});

// --- backspace / delete ---

test('backspace removes the char before the caret', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 2, head: 2 });
  adapter.sendKey('backspace');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['a']);
  assert.deepEqual(w.cursors, [1]);
  assert.equal(app.workspace.activeDocument!.text(), 'a');
});

test('backspace at offset 0 is a no-op', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 0, head: 0 });
  adapter.sendKey('backspace');
  assert.equal(app.workspace.activeDocument!.text(), 'ab');
  assert.equal(app.workspace.activeDocument!.selection.head, 0);
});

test('delete removes the char at the caret', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 0, head: 0 });
  adapter.sendKey('delete');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['b']);
  assert.deepEqual(w.cursors, [0]);
  assert.equal(app.workspace.activeDocument!.text(), 'b');
});

test('delete at end of buffer is a no-op', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 2, head: 2 });
  adapter.sendKey('delete');
  assert.equal(app.workspace.activeDocument!.text(), 'ab');
  assert.equal(app.workspace.activeDocument!.selection.head, 2);
});

// --- horizontal movement ---

test('left / right move the caret one offset and clamp at the ends', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 1, head: 1 });

  adapter.sendKey('left');
  assert.equal(main(adapter).cursors[0], 0);
  adapter.sendKey('left'); // clamp at start
  assert.equal(main(adapter).cursors[0], 0);

  adapter.sendKey('right');
  assert.equal(main(adapter).cursors[0], 1);
  adapter.sendKey('right');
  assert.equal(main(adapter).cursors[0], 2);
  adapter.sendKey('right'); // clamp at end
  assert.equal(main(adapter).cursors[0], 2);
  void app;
});

// --- vertical movement with a sticky goal column ---

test('up / down preserve the goal column across a short line', async () => {
  const { adapter, app } = await setup('abcd\nx\nefgh');
  // line 0, col 3 -> offset 3
  app.workspace.setSelection({ anchor: 3, head: 3 });

  adapter.sendKey('down'); // line 1 is "x" (len 1) -> clamp to col 1 -> offset 6
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('down'); // line 2 "efgh" -> goal col 3 restored -> offset 10
  assert.equal(main(adapter).cursors[0], 10);

  adapter.sendKey('up'); // back to line 1 short -> offset 6
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('up'); // back to line 0 -> goal col 3 -> offset 3
  assert.equal(main(adapter).cursors[0], 3);
  void app;
});

test('a horizontal move resets the goal column', async () => {
  const { adapter, app } = await setup('abcd\nx\nefgh');
  app.workspace.setSelection({ anchor: 3, head: 3 });

  adapter.sendKey('down'); // -> offset 6 (col clamped to 1), goal col was 3
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('left'); // resets goal col; now caret at offset 5 (col 0)
  assert.equal(main(adapter).cursors[0], 5);

  adapter.sendKey('down'); // new goal col = 0 -> line 2 col 0 -> offset 7
  assert.equal(main(adapter).cursors[0], 7);
  void app;
});

test('typing resets the goal column', async () => {
  const { adapter, app } = await setup('abcd\nx\nefgh');
  app.workspace.setSelection({ anchor: 3, head: 3 });

  adapter.sendKey('down'); // offset 6, goal col 3 captured
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('z'); // insert at offset 6 -> "x" line becomes "xz"; caret 7; goal reset
  assert.equal(app.workspace.activeDocument!.text(), 'abcd\nxz\nefgh');
  assert.equal(main(adapter).cursors[0], 7); // line 1 col 2

  adapter.sendKey('down'); // new goal col = 2 -> line 2 "efgh" col 2 -> offset 10
  assert.equal(main(adapter).cursors[0], 10);
  void app;
});

test('up at the first line and down at the last line clamp within the line', async () => {
  const { adapter, app } = await setup('abcd\nefgh');
  app.workspace.setSelection({ anchor: 2, head: 2 }); // line 0 col 2

  adapter.sendKey('up'); // already first line -> goal col 2 -> stays offset 2
  assert.equal(main(adapter).cursors[0], 2);

  // collapse goal with an explicit horizontal move before the next vertical test
  adapter.sendKey('right'); // resets goal, caret offset 3
  app.workspace.setSelection({ anchor: 7, head: 7 }); // line 1 col 2 (goal still reset/null)
  adapter.sendKey('down'); // already last line -> goal col 2 -> stays offset 7
  assert.equal(main(adapter).cursors[0], 7);
});

// --- home / end ---

test('home / end move to the start and end of the current line', async () => {
  const { adapter, app } = await setup('abcd\nefgh');
  app.workspace.setSelection({ anchor: 7, head: 7 }); // line 1 col 2

  adapter.sendKey('home');
  assert.equal(main(adapter).cursors[0], 5); // start of line 1

  adapter.sendKey('end');
  assert.equal(main(adapter).cursors[0], 9); // end of "efgh"
  void app;
});

// --- focus ---

test('editor.focus command and global:alt+right binding are registered', async () => {
  const { app } = await setup('hi');
  assert.ok(app.commands.ids().includes('editor.focus'));
  assert.equal(app.keys.resolve('global:alt+right'), 'editor.focus');
});

test('alt+right (and editor.focus) set the base focus context to editor', async () => {
  const { adapter, app, focus } = await setup('hi');
  const svc = focus();

  // Drive an overlay on top, then confirm replace() is a no-op while overlaid,
  // and becomes the base once popped -> deterministic, observable behavior.
  svc.push('palette');
  assert.equal(svc.top(), 'palette');

  adapter.sendKey('alt+right'); // editor.focus -> replace('editor'); NO-OP under overlay
  assert.equal(svc.top(), 'palette');
  assert.deepEqual(svc.stack(), ['editor', 'palette']);

  svc.pop('palette');
  assert.equal(svc.top(), 'editor');

  // run the command directly to exercise the handler path too
  await app.commands.run('editor.focus', {});
  assert.equal(svc.top(), 'editor');
  assert.deepEqual(svc.stack(), ['editor']);
});

// --- commands no-op without an active document ---

test('external caret move (setSelection) resets the goal column', async () => {
  // Set up a multi-line doc: line 0 = "abcd" (4 chars), line 1 = "xy" (2 chars), line 2 = "efgh" (4 chars)
  // Text: "abcd\nxy\nefgh"  offsets: line0=[0..4], \n=4, line1=[5..7], \n=7, line2=[8..12]
  const { adapter, app } = await setup('abcd\nxy\nefgh');

  // Place caret at line 0, col 3 (offset 3)
  app.workspace.setSelection({ anchor: 3, head: 3 });

  // Press 'down' — goalCol is captured as 3; line 1 "xy" is length 2, so caret clamps to offset 7 (col 2)
  adapter.sendKey('down');
  assert.equal(main(adapter).cursors[0], 7, 'after first down, caret at end of "xy"');

  // NOW externally move the caret to line 2, col 0 (offset 8) — bypassing editor-view's own handler
  // This simulates what undo/redo does via workspace.setSelection
  app.workspace.setSelection({ anchor: 8, head: 8 });

  // Press 'down' again — goalCol should have been reset to null by the external move.
  // The new goal column should be captured from the current position: col 0.
  // Line 2 is "efgh" — but this is the LAST line, so down on last line stays at current line.
  // Let's move up instead: from line 2 col 0 (offset 8), up to line 1 col 0 (offset 5).
  adapter.sendKey('up');
  // With stale goalCol=3, it would land at line 1 col 2 = offset 7 (clamped from col 3 in "xy").
  // With reset goalCol=null, it captures col 0 from offset 8, then moves to line 1 col 0 = offset 5.
  assert.equal(main(adapter).cursors[0], 5, 'goal col reset after external setSelection; up uses col 0');
  void app;
});

test('editor commands no-op (do not throw) when there is no active document', async () => {
  const { adapter, app } = await setup('', { open: false });
  // none of these should throw, and the rendered frame stays the empty default
  for (const key of ['x', 'backspace', 'delete', 'left', 'right', 'up', 'down', 'home', 'end']) {
    adapter.sendKey(key);
  }
  const w = main(adapter);
  assert.deepEqual(w.lines, ['']);
  assert.deepEqual(w.cursors, [0]);
  assert.equal(app.workspace.activeDocument, null);

  // direct invocation must also be a no-op (not throw) with no active doc
  await app.commands.run('editor.insertChar', { key: 'q' });
  await app.commands.run('editor.moveDown', {});
  assert.equal(app.workspace.activeDocument, null);
});
