// tests/plugins/save.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin, PluginContext } from '../../src/core/plugin-host.ts';
import keymap from '../../src/plugins/keymap.ts';
import save from '../../src/plugins/save.ts';

// Tiny setup plugin: opens a real temp file as the active document so that
// ctx.workspace.activeDocument is a doc with a non-null path.
function openFilePlugin(path: string): Plugin {
  return {
    name: 'test-open-file',
    async activate(ctx: PluginContext) {
      await ctx.workspace.openFile(path);
    },
  };
}

// Tiny setup plugin: opens a scratch (path === null) active document.
const openScratchPlugin: Plugin = {
  name: 'test-open-scratch',
  activate(ctx: PluginContext) {
    ctx.workspace.openScratch('scratch body');
  },
};

async function makeTempFile(initial: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'save-plugin-'));
  const path = join(dir, 'note.txt');
  await writeFile(path, initial, 'utf8');
  return { dir, path };
}

test('file.save writes the active document to disk and clears dirty', async () => {
  const { dir, path } = await makeTempFile('hello');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
    });

    const doc = app.workspace.activeDocument!;
    assert.equal(doc.path, path);
    assert.equal(doc.dirty, false);

    // Edit through the workspace, then save via the command.
    app.workspace.applyEdit({ start: 5, end: 5, text: ' world' });
    assert.equal(doc.dirty, true);
    assert.equal(doc.text(), 'hello world');

    await app.commands.run('file.save');

    assert.equal(await readFile(path, 'utf8'), 'hello world');
    assert.equal(doc.dirty, false);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('editor:ctrl+s is bound to file.save', async () => {
  const { dir, path } = await makeTempFile('x');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
    });

    assert.equal(app.keys.resolve('editor:ctrl+s'), 'file.save');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file.save is a no-op when the active document is a scratch (path === null)', async () => {
  const app = await createApp({
    adapter: new HeadlessAdapter(),
    plugins: [keymap, save, openScratchPlugin],
    roots: [],
  });

  const doc = app.workspace.activeDocument!;
  assert.equal(doc.path, null);

  // Make it dirty; save must NOT throw and must NOT clear dirty (no path to write).
  app.workspace.applyEdit({ start: 0, end: 0, text: '!' });
  assert.equal(doc.dirty, true);

  await assert.doesNotReject(app.commands.run('file.save'));
  assert.equal(doc.dirty, true);

  await app.dispose();
});

test('file.save is a no-op when there is no active document', async () => {
  const app = await createApp({
    adapter: new HeadlessAdapter(),
    plugins: [keymap, save],
    roots: [],
  });

  assert.equal(app.workspace.activeDocument, null);
  await assert.doesNotReject(app.commands.run('file.save'));

  await app.dispose();
});

test('autosave (config.autosaveMs > 0) writes to disk on a timer tick', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { dir, path } = await makeTempFile('start');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
      config: { save: { autosaveMs: 1000 } },
    });

    // Arm a deterministic barrier: resolve once Workspace.save() has emitted
    // 'document:saved' (it does so AFTER fs.write + markClean), so we never race
    // a real disk write against a guessed number of microtask flushes.
    const saved = new Promise<void>((resolve) => {
      const sub = app.bus.on('document:saved', () => {
        sub.dispose();
        resolve();
      });
    });

    // Dirty the doc, then advance the fake clock past one interval.
    app.workspace.applyEdit({ start: 5, end: 5, text: '-edited' });
    assert.equal(await readFile(path, 'utf8'), 'start');

    t.mock.timers.tick(1000);
    await saved;

    assert.equal(await readFile(path, 'utf8'), 'start-edited');
    assert.equal(app.workspace.activeDocument!.dirty, false);

    await app.dispose();
  } finally {
    t.mock.timers.reset();
    await rm(dir, { recursive: true, force: true });
  }
});

test('no autosave timer when autosaveMs is unset/0 (a tick writes nothing)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { dir, path } = await makeTempFile('untouched');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
      // no config.save.autosaveMs
    });

    app.workspace.applyEdit({ start: 0, end: 0, text: 'X' });

    // No interval was registered, so ticking schedules no save callback.
    t.mock.timers.tick(1_000_000);
    await new Promise((resolve) => setImmediate(resolve));

    // File on disk is unchanged because no autosave fired.
    assert.equal(await readFile(path, 'utf8'), 'untouched');

    await app.dispose();
  } finally {
    t.mock.timers.reset();
    await rm(dir, { recursive: true, force: true });
  }
});
