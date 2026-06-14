import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import keymap, { type FocusService } from '../../src/plugins/keymap.ts';
import directoryList from '../../src/plugins/directory-list.ts';
import type { Plugin } from '../../src/core/plugin-host.ts';
import type { Widget } from '../../src/core/view.ts';

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dirlist-'));
}

function treeWidget(adapter: HeadlessAdapter): Extract<Widget, { kind: 'list' }> {
  const w = adapter.lastFrame()?.tree;
  assert.ok(w, 'expected a tree widget in the last frame');
  assert.equal(w.kind, 'list');
  return w as Extract<Widget, { kind: 'list' }>;
}

async function until(fn: () => boolean, label: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`condition never became true: ${label}`);
}

test('directory-list renders the root listing sorted', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'beta.txt'), 'b');
    await writeFile(join(dir, 'alpha.txt'), 'a');
    await mkdir(join(dir, 'subdir'));

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    const w = treeWidget(adapter);
    assert.deepEqual(
      w.items.map((it) => it.label),
      ['alpha.txt', 'beta.txt', 'subdir/'],
    );
    assert.equal(w.selected, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('directory-list renders an empty list when there are no roots', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({
    adapter,
    plugins: [keymap, directoryList],
    roots: [],
  });

  const w = treeWidget(adapter);
  assert.deepEqual(w.items, []);
  assert.equal(w.selected, 0);

  await app.dispose();
});

test('tree.down moves selection and clamps at the end; tree.up clamps at the top', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.txt'), 'a');
    await writeFile(join(dir, 'b.txt'), 'b');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.equal(treeWidget(adapter).selected, 0);

    await app.commands.run('tree.down');
    assert.equal(treeWidget(adapter).selected, 1);

    // clamp at the bottom (2 entries -> max index 1)
    await app.commands.run('tree.down');
    assert.equal(treeWidget(adapter).selected, 1);

    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 0);

    // clamp at the top
    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.up / tree.down are no-ops when the listing is empty', async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.deepEqual(treeWidget(adapter).items, []);
    await app.commands.run('tree.down');
    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on a file opens it as the active document', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'note.txt'), 'hello');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.equal(app.workspace.activeDocument, null);

    await app.commands.run('tree.open');

    const doc = app.workspace.activeDocument;
    assert.ok(doc, 'expected an active document after tree.open');
    assert.equal(doc.path, join(dir, 'note.txt'));
    assert.equal(doc.text(), 'hello');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on a file moves the focus context to "editor"', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'note.txt'), 'hi');

    const adapter = new HeadlessAdapter();
    // Probe plugin AFTER directory-list reads the focus service (App type does
    // not expose ctx.services).
    let focus!: FocusService;
    const probe: Plugin = {
      name: 'probe',
      activate(ctx) { focus = ctx.services.get<FocusService>('focus'); },
    };
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList, probe],
      roots: [dir],
    });

    // tree.focus first so the base context is 'tree', proving open flips it.
    await app.commands.run('tree.focus');
    assert.equal(focus.top(), 'tree');

    await app.commands.run('tree.open');
    assert.equal(focus.top(), 'editor');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on a directory is a no-op for M1 (no document opened)', async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, 'subdir'));

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    const w = treeWidget(adapter);
    assert.deepEqual(w.items.map((it) => it.label), ['subdir/']);

    await app.commands.run('tree.open');
    assert.equal(app.workspace.activeDocument, null);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open is a no-op (does not throw) when there are no entries', async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.deepEqual(treeWidget(adapter).items, []);
    await app.commands.run('tree.open');
    assert.equal(app.workspace.activeDocument, null);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.focus sets the focus context to "tree"', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.txt'), 'a');

    const adapter = new HeadlessAdapter();
    let focus!: FocusService;
    const probe: Plugin = {
      name: 'probe',
      activate(ctx) { focus = ctx.services.get<FocusService>('focus'); },
    };
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList, probe],
      roots: [dir],
    });

    assert.equal(focus.top(), 'editor');
    await app.commands.run('tree.focus');
    assert.equal(focus.top(), 'tree');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('directory-list contributes the documented keybindings', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.txt'), 'a');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.equal(app.keys.resolve('global:alt+left'), 'tree.focus');
    assert.equal(app.keys.resolve('tree:up'), 'tree.up');
    assert.equal(app.keys.resolve('tree:down'), 'tree.down');
    assert.equal(app.keys.resolve('tree:enter'), 'tree.open');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fs:changed triggers a re-list so the listing grows', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'one.txt'), '1');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.deepEqual(
      treeWidget(adapter).items.map((it) => it.label),
      ['one.txt'],
    );

    // Add a file on disk, then emit fs:changed manually for deterministic timing.
    // (The real Watcher is also live and may fire its own fs:changed; the token
    //  guard + error-isolated relist make that harmless. The manual emit is what
    //  makes this test deterministic.)
    await writeFile(join(dir, 'two.txt'), '2');
    app.bus.emit('fs:changed', { dir, filename: 'two.txt', eventType: 'rename' });

    // The re-list is async; await until the view reflects the new entry.
    await until(
      () => treeWidget(adapter).items.length === 2,
      'tree list should grow to 2 after fs:changed',
    );

    assert.deepEqual(
      treeWidget(adapter).items.map((it) => it.label),
      ['one.txt', 'two.txt'],
    );

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
