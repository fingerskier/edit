import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import { defaultPlugins } from '../../src/plugins/index.ts';
import { listWorkspaceFiles } from '../../src/plugins/fuzzy-open.ts';
import { FileSystem } from '../../src/core/file-system.ts';

const settle = () => new Promise<void>((r) => setImmediate(r));

test('listWorkspaceFiles: recurses and skips node_modules / .git', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-fo-'));
  try {
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'a.ts'), 'a');
    await writeFile(join(dir, 'README.md'), 'r');
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'x');
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'config'), 'g');

    const files = await listWorkspaceFiles(new FileSystem(), dir);
    assert.ok(files.includes('src/a.ts'));
    assert.ok(files.includes('README.md'));
    assert.ok(!files.some((f) => f.includes('node_modules')));
    assert.ok(!files.some((f) => f.includes('.git')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file.quickOpen: pick opens the chosen file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-fo-'));
  try {
    await writeFile(join(dir, 'alpha.txt'), 'aaa');
    await writeFile(join(dir, 'beta.txt'), 'bbb');

    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });

    assert.ok(app.commands.ids().includes('file.quickOpen'));

    // Indexing is async — wait for the quickInput focus push before sending keys.
    const pickerOpen = new Promise<void>((resolve) => {
      const sub = app.bus.on('focus:changed', (e: { context: string }) => {
        if (e.context === 'quickInput') { sub.dispose(); resolve(); }
      });
    });
    const opened = app.commands.run('file.quickOpen');
    await pickerOpen;
    const overlay = adapter.lastFrame()?.overlay;
    assert.ok(overlay && overlay.kind === 'overlay');
    assert.match((overlay as { title?: string }).title ?? '', /Open File/);

    adapter.sendKey('enter');
    await opened;
    await settle();

    assert.equal(app.workspace.activeDocument?.path, join(dir, 'alpha.txt'));
    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('global:ctrl+o is bound to file.quickOpen', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [] });
  assert.equal(app.keys.resolve('global:ctrl+o'), 'file.quickOpen');
  await app.dispose();
});
