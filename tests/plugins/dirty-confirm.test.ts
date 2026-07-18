import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import { defaultPlugins } from '../../src/plugins/index.ts';
import { confirmDiscardDirty } from '../../src/plugins/dirty-confirm.ts';
import type { QuickPickItem } from '../../src/plugins/quick-input.ts';
import { Document } from '../../src/core/document.ts';

const settle = () => new Promise<void>((r) => setImmediate(r));

test('confirmDiscardDirty: no dirty docs → true without picking', async () => {
  let called = false;
  const pick = async () => { called = true; return undefined; };
  assert.equal(await confirmDiscardDirty(pick as any, []), true);
  assert.equal(called, false);
});

test('confirmDiscardDirty: discard choice returns true; cancel returns false', async () => {
  const dirty = [new Document('d1', '/tmp/a.txt', 'x')];
  dirty[0].dirty = true;

  const discard = async (items: QuickPickItem[]) => items.find((i) => (i as any).value === true);
  assert.equal(await confirmDiscardDirty(discard as any, dirty), true);

  const cancel = async (items: QuickPickItem[]) => items.find((i) => (i as any).value === false);
  assert.equal(await confirmDiscardDirty(cancel as any, dirty), false);

  const closed = async () => undefined;
  assert.equal(await confirmDiscardDirty(closed as any, dirty), false);
});

test('tabs.close on a dirty doc prompts; cancel keeps the document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-dirty-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');
    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });
    await app.workspace.openFile(file);
    app.workspace.applyEdit({ start: 5, end: 5, text: '!' });
    assert.equal(app.workspace.activeDocument?.dirty, true);

    // Start close → picker opens; choose Cancel (second item, down + enter).
    const closing = app.commands.run('tabs.close');
    await settle();
    assert.ok(adapter.lastFrame()?.overlay);
    adapter.sendKey('down');
    await settle();
    adapter.sendKey('enter');
    await closing;
    await settle();

    assert.equal(app.workspace.list().length, 1);
    assert.equal(app.workspace.activeDocument?.dirty, true);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tabs.close on a dirty doc: discard closes the document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-dirty-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');
    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });
    await app.workspace.openFile(file);
    app.workspace.applyEdit({ start: 5, end: 5, text: '!' });

    const closing = app.commands.run('tabs.close');
    await settle();
    adapter.sendKey('enter'); // first item = Discard
    await closing;
    await settle();

    assert.equal(app.workspace.list().length, 0);
    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tabs.close on a clean doc closes without a prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-dirty-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');
    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });
    await app.workspace.openFile(file);
    assert.equal(app.workspace.activeDocument?.dirty, false);

    await app.commands.run('tabs.close');
    assert.equal(app.workspace.list().length, 0);
    assert.equal(adapter.lastFrame()?.overlay, undefined);
    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
