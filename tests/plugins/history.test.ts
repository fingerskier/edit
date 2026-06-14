import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import keymap from '../../src/plugins/keymap.ts';
import editorView from '../../src/plugins/editor-view.ts';
import history from '../../src/plugins/history.ts';

async function makeApp() {
  const adapter = new HeadlessAdapter();
  const app = await createApp({
    adapter,
    plugins: [keymap, editorView, history],
    roots: [],
  });
  return { app, adapter };
}

// Drives an edit through the SAME real path editor-view uses: workspace.applyEdit
// emits 'document:changed' { docId, op, inverse }, which history records. We insert
// at the current caret so the inserted-at offset matches a real "type at caret".
function typeChar(app: Awaited<ReturnType<typeof makeApp>>['app'], ch: string) {
  const doc = app.workspace.activeDocument!;
  const at = doc.selection.head;
  app.workspace.applyEdit({ start: at, end: at, text: ch });
}

test('undo removes the last edit, redo re-applies it', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b');
  assert.equal(doc.text(), 'ab');

  await app.commands.run('history.undo');
  assert.equal(doc.text(), 'a');

  await app.commands.run('history.undo');
  assert.equal(doc.text(), '');

  await app.commands.run('history.redo');
  assert.equal(doc.text(), 'a');

  await app.commands.run('history.redo');
  assert.equal(doc.text(), 'ab');

  await app.dispose();
});

test('undo with empty stack / no active doc is a no-op (does not throw)', async () => {
  const { app } = await makeApp();
  // No active document yet.
  assert.equal(app.workspace.activeDocument, null);
  await app.commands.run('history.undo'); // must not throw
  await app.commands.run('history.redo'); // must not throw

  const doc = app.workspace.openScratch('');
  // Active doc, but nothing recorded -> still a no-op.
  await app.commands.run('history.undo');
  await app.commands.run('history.redo');
  assert.equal(doc.text(), '');

  await app.dispose();
});

test('a fresh edit after undo clears the redo stack', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b');
  assert.equal(doc.text(), 'ab');

  await app.commands.run('history.undo'); // -> 'a', redo now holds the 'b' entry
  assert.equal(doc.text(), 'a');

  typeChar(app, 'c'); // fresh edit must clear redo
  assert.equal(doc.text(), 'ac');

  await app.commands.run('history.redo'); // redo was cleared -> no-op
  assert.equal(doc.text(), 'ac');

  await app.dispose();
});

test('re-entrancy: undo replay does not grow the undo stack', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b'); // undo stack depth = 2

  // First undo pops one entry (depth 1) and replays the inverse via applyEdit.
  // If the replay were recorded, the stack would grow back to >=2 and the second
  // undo would NOT empty the document.
  await app.commands.run('history.undo');
  assert.equal(doc.text(), 'a');

  await app.commands.run('history.undo');
  assert.equal(doc.text(), '', 'second undo emptied the doc -> replay was not recorded');

  // A third undo must be a clean no-op (stack truly empty).
  await app.commands.run('history.undo');
  assert.equal(doc.text(), '');

  await app.dispose();
});

test('redo replay does not corrupt the stacks (round-trips repeatedly)', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b');

  for (let i = 0; i < 3; i++) {
    await app.commands.run('history.undo');
    await app.commands.run('history.undo');
    assert.equal(doc.text(), '');
    await app.commands.run('history.redo');
    await app.commands.run('history.redo');
    assert.equal(doc.text(), 'ab');
  }

  await app.dispose();
});

test('multi-doc: edits in doc A do not affect doc B undo stack', async () => {
  const { app } = await makeApp();

  const a = app.workspace.openScratch(''); // A active
  typeChar(app, 'a'); // recorded on A

  const b = app.workspace.openScratch(''); // B now active
  typeChar(app, 'b'); // recorded on B

  // Undo with B active only touches B.
  await app.commands.run('history.undo');
  assert.equal(b.text(), '');
  assert.equal(a.text(), 'a', "A untouched by B's undo");

  // A further undo with B active is a no-op (B's stack empty); A keeps its edit.
  await app.commands.run('history.undo');
  assert.equal(b.text(), '');
  assert.equal(a.text(), 'a');

  // Switch to A and undo -> only A is affected.
  app.workspace.setActive(a.id);
  await app.commands.run('history.undo');
  assert.equal(a.text(), '');
  assert.equal(b.text(), '');

  await app.dispose();
});

test('document:closed drops that doc stacks (no leak / no cross-talk after reuse)', async () => {
  const { app } = await makeApp();

  const a = app.workspace.openScratch('');
  typeChar(app, 'a'); // A has one undo entry
  app.workspace.closeDocument(a.id); // drops A's stacks; no docs left -> activeDocument null
  assert.equal(app.workspace.activeDocument, null);

  // A fresh doc, fresh stack. Undo before any edit is a clean no-op.
  const c = app.workspace.openScratch('');
  await app.commands.run('history.undo');
  assert.equal(c.text(), '');

  typeChar(app, 'z');
  await app.commands.run('history.undo');
  assert.equal(c.text(), '');

  await app.dispose();
});

test('binds editor:ctrl+z -> history.undo and editor:ctrl+y -> history.redo', async () => {
  const { app } = await makeApp();
  assert.equal(app.keys.resolve('editor:ctrl+z'), 'history.undo');
  assert.equal(app.keys.resolve('editor:ctrl+y'), 'history.redo');
  await app.dispose();
});

test('subscriptions are drained on dispose (commands unregistered)', async () => {
  const { app } = await makeApp();
  assert.ok(app.commands.list().some((c) => c.id === 'history.undo'));
  assert.ok(app.commands.list().some((c) => c.id === 'history.redo'));
  await app.dispose();
  assert.ok(!app.commands.list().some((c) => c.id === 'history.undo'));
  assert.ok(!app.commands.list().some((c) => c.id === 'history.redo'));
});
