import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import { defaultPlugins } from '../../src/plugins/index.ts';

const settle = () => new Promise<void>((r) => setImmediate(r));

function tabsVm(adapter: HeadlessAdapter) {
  const t = adapter.lastFrame()?.tabs;
  assert.ok(t && t.kind === 'tabs', 'tabs slot should be a tabs widget');
  return t as {
    kind: 'tabs';
    items: { id: string; label: string; dirty?: boolean }[];
    activeIndex: number;
  };
}

test('tabs: hidden when no documents are open', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-tabs-'));
  try {
    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });
    assert.equal(adapter.lastFrame()?.tabs, undefined);
    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tabs: lists open documents with basename labels and active index', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-tabs-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'aaa');
    await writeFile(b, 'bbb');

    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });

    await app.workspace.openFile(a);
    await app.workspace.openFile(b);
    app.render();

    const tabs = tabsVm(adapter);
    assert.equal(tabs.items.length, 2);
    assert.equal(tabs.items[0].label, 'a.txt');
    assert.equal(tabs.items[1].label, 'b.txt');
    assert.equal(tabs.activeIndex, 1); // last opened is active
    assert.equal(app.workspace.activeDocument?.path, b);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tabs.next / tabs.prev cycle the active document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-tabs-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    const c = join(dir, 'c.txt');
    await writeFile(a, 'a');
    await writeFile(b, 'b');
    await writeFile(c, 'c');

    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });

    await app.workspace.openFile(a);
    await app.workspace.openFile(b);
    await app.workspace.openFile(c);
    // active = c (index 2)
    await app.commands.run('tabs.next');
    app.render();
    assert.equal(app.workspace.activeDocument?.path, a);
    assert.equal(tabsVm(adapter).activeIndex, 0);

    await app.commands.run('tabs.prev');
    app.render();
    assert.equal(app.workspace.activeDocument?.path, c);
    assert.equal(tabsVm(adapter).activeIndex, 2);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tabs.close closes the active document and activates a survivor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-tabs-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'a');
    await writeFile(b, 'b');

    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });

    await app.workspace.openFile(a);
    await app.workspace.openFile(b);
    await app.commands.run('tabs.close');
    app.render();

    assert.equal(app.workspace.list().length, 1);
    assert.equal(app.workspace.activeDocument?.path, a);
    const tabs = tabsVm(adapter);
    assert.equal(tabs.items.length, 1);
    assert.equal(tabs.items[0].label, 'a.txt');
    assert.equal(tabs.activeIndex, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tabs: dirty marker appears after an edit and clears on save', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-tabs-'));
  try {
    const a = join(dir, 'a.txt');
    await writeFile(a, 'hello');

    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });
    await app.workspace.openFile(a);
    app.render();
    assert.equal(tabsVm(adapter).items[0].dirty, false);
    assert.equal(tabsVm(adapter).items[0].label, 'a.txt');

    app.workspace.applyEdit({ start: 5, end: 5, text: '!' });
    app.render();
    assert.equal(tabsVm(adapter).items[0].dirty, true);
    assert.equal(tabsVm(adapter).items[0].label, '● a.txt');

    await app.workspace.save();
    app.render();
    assert.equal(tabsVm(adapter).items[0].dirty, false);
    assert.equal(tabsVm(adapter).items[0].label, 'a.txt');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keybindings: global ctrl+w / ctrl+pagedown / ctrl+pageup drive tabs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-tabs-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    await writeFile(a, 'a');
    await writeFile(b, 'b');

    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });
    await app.workspace.openFile(a);
    await app.workspace.openFile(b);

    adapter.sendKey('ctrl+pageup'); // prev -> a
    await settle();
    assert.equal(app.workspace.activeDocument?.path, a);

    adapter.sendKey('ctrl+pagedown'); // next -> b
    await settle();
    assert.equal(app.workspace.activeDocument?.path, b);

    adapter.sendKey('ctrl+w'); // close b
    await settle();
    assert.equal(app.workspace.list().length, 1);
    assert.equal(app.workspace.activeDocument?.path, a);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scratch documents show as Untitled', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [] });
  app.workspace.openScratch('x');
  app.render();
  const tabs = tabsVm(adapter);
  assert.equal(tabs.items.length, 1);
  assert.equal(tabs.items[0].label, 'Untitled');
  await app.dispose();
});
