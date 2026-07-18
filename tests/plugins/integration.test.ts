import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import { defaultPlugins } from '../../src/plugins/index.ts';

// Settle async command handlers (openFile/save are async) deterministically.
// NOTE: a single setImmediate is sufficient for synchronous or microtask-only
// commands, but for key-dispatched async commands (tree.open, file.save) that
// perform real I/O, we use event-based barriers below instead of settle().
const settle = () => new Promise<void>((r) => setImmediate(r));

function mainText(adapter: HeadlessAdapter): string[] {
  const m = adapter.lastFrame()?.main;
  assert.ok(m && m.kind === 'text', 'main slot should be a text widget');
  return (m as { kind: 'text'; lines: string[] }).lines;
}

test('end-to-end: open from tree, edit, save, undo, open palette', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-e2e-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');
    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });

    // Nested tree: root folder is selected first; move onto a.txt, then open.
    adapter.sendKey('alt+left'); // global -> tree.focus
    await settle();
    adapter.sendKey('down');     // select a.txt under the expanded root
    await settle();
    // tree.open (bound to tree:enter) is async: it awaits openFile then calls
    // focus.replace('editor'). Wait for the focus:changed event that confirms
    // the whole async chain has completed before asserting the view.
    const editorFocused = new Promise<void>((resolve) => {
      const sub = app.bus.on('focus:changed', (e: { context: string }) => {
        if (e.context === 'editor') { sub.dispose(); resolve(); }
      });
    });
    adapter.sendKey('enter');    // tree.open -> workspace.openFile, focus -> editor
    await editorFocused;
    app.render();
    assert.deepEqual(mainText(adapter), ['hello']);

    // Move to end of line and type '!'.
    adapter.sendKey('end');      // editor.moveEnd
    await settle();
    adapter.sendKey('!');        // editor:<printable> -> editor.insertChar { key: '!' }
    await settle();
    assert.deepEqual(mainText(adapter), ['hello!']);

    // Save to disk. file.save is async (awaits workspace.save()); use the
    // document:saved event as the deterministic completion barrier.
    const fileSaved = new Promise<void>((resolve) => {
      const sub = app.bus.on('document:saved', () => { sub.dispose(); resolve(); });
    });
    adapter.sendKey('ctrl+s');   // file.save
    await fileSaved;
    assert.equal(await readFile(file, 'utf8'), 'hello!');
    assert.equal(app.workspace.activeDocument?.dirty, false);

    // Undo the insertion.
    adapter.sendKey('ctrl+z');   // history.undo
    await settle();
    assert.deepEqual(mainText(adapter), ['hello']);

    // Open the command palette.
    adapter.sendKey('ctrl+p');   // global -> palette.open
    await settle();
    const overlay = adapter.lastFrame()?.overlay;
    assert.ok(overlay && overlay.kind === 'overlay', 'palette overlay should be open');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
