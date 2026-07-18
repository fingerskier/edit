import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../src/core/app.ts';
import { defaultPlugins } from '../../../src/plugins/index.ts';
import { TuiAdapter } from '../../../src/adapters/tui/tui-adapter.ts';
import { FakeTerminal } from './fake-terminal.ts';

const settle = () => new Promise<void>((r) => setImmediate(r));

// End-to-end through the REAL stack: raw terminal bytes -> key-decoder -> TuiAdapter
// -> core bus -> default plugins -> renderer -> painted ANSI. Asserts on the painted
// output (FakeTerminal.lastWrite) the same way a user would read the screen.
test('TUI e2e: open from tree, type, save, undo, open palette, quit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-tui-e2e-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');

    const term = new FakeTerminal(80, 24);
    const adapter = new TuiAdapter(term);
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });

    // Initial paint shows the tree entry.
    assert.ok(term.lastWrite().includes('a.txt'), 'tree lists a.txt');

    // Focus the tree, move onto a.txt (root folder is selected first), then open.
    term.feedRaw('\x1b[1;3D'); // alt+left -> tree.focus
    await settle();
    term.feedRaw('\x1b[B'); // down -> select a.txt under the expanded root
    await settle();
    const editorFocused = new Promise<void>((resolve) => {
      const sub = app.bus.on('focus:changed', (e: { context: string }) => {
        if (e.context === 'editor') { sub.dispose(); resolve(); }
      });
    });
    term.feedRaw('\r'); // enter -> tree.open (async: openFile then focus editor)
    await editorFocused;
    app.render();
    assert.ok(term.lastWrite().includes('hello'), 'editor shows the opened file content');

    // Move to end of line and type '!'.
    term.feedRaw('\x1b[F'); // end
    await settle();
    term.feedRaw('!'); // editor:<printable> -> insertChar
    await settle();
    assert.ok(term.lastWrite().includes('hello!'), 'typed text is painted');

    // Save with ctrl+s (raw 0x13).
    const fileSaved = new Promise<void>((resolve) => {
      const sub = app.bus.on('document:saved', () => { sub.dispose(); resolve(); });
    });
    term.feedRaw('\x13');
    await fileSaved;
    assert.equal(await readFile(file, 'utf8'), 'hello!', 'file written to disk');

    // Undo with ctrl+z (raw 0x1a).
    term.feedRaw('\x1a');
    await settle();
    const afterUndo = term.lastWrite();
    assert.ok(afterUndo.includes('hello') && !afterUndo.includes('hello!'), 'undo reverted the insert');

    // Open the command palette with ctrl+p (raw 0x10).
    term.feedRaw('\x10');
    await settle();
    assert.ok(term.lastWrite().includes('Commands'), 'palette overlay painted');

    // Close the palette, then quit via a CLI-style app.quit binding.
    term.feedRaw('\x1b'); // escape -> palette.close
    await settle();

    let quit = false;
    app.commands.register('app.quit', async () => { await app.dispose(); quit = true; }, { title: 'Quit' });
    app.keys.bind('global:ctrl+q', 'app.quit');
    term.feedRaw('\x11'); // ctrl+q
    await settle();
    assert.equal(quit, true, 'ctrl+q ran app.quit');
    assert.equal(term.stopped, true, 'terminal restored on quit');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TUI e2e: typing a space inserts a literal space (printable path)', async () => {
  const term = new FakeTerminal(80, 24);
  const adapter = new TuiAdapter(term);
  const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [] });
  app.workspace.openScratch('ab');
  app.workspace.setSelection({ anchor: 1, head: 1 });
  app.render();

  term.feedRaw(' '); // space bar -> ' ' -> editor.insertChar
  await settle();
  assert.equal(app.workspace.activeDocument!.text(), 'a b', 'space inserted between a and b');

  await app.dispose();
});
