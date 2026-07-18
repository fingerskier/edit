import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import keymap, { type FocusService } from '../../src/plugins/keymap.ts';
import directoryList, {
  buildTreeRows, formatTreeLabel,
} from '../../src/plugins/directory-list.ts';
import type { Plugin } from '../../src/core/plugin-host.ts';
import type { Widget } from '../../src/core/view.ts';
import type { DirEntry } from '../../src/core/file-system.ts';

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dirlist-'));
}

function treeWidget(adapter: HeadlessAdapter): Extract<Widget, { kind: 'list' }> {
  const w = adapter.lastFrame()?.tree;
  assert.ok(w, 'expected a tree widget in the last frame');
  assert.equal(w.kind, 'list');
  return w as Extract<Widget, { kind: 'list' }>;
}

function labels(adapter: HeadlessAdapter): string[] {
  return treeWidget(adapter).items.map((it) => it.label);
}

async function until(fn: () => boolean, label: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`condition never became true: ${label}`);
}

// --- pure helpers ---

test('buildTreeRows: roots only when nothing expanded', () => {
  const rows = buildTreeRows(['/work/a', '/work/b'], new Set(), new Map());
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b']);
  assert.ok(rows.every((r) => r.isDir && r.depth === 0));
});

test('buildTreeRows: expanded root includes sorted children at depth 1', () => {
  const kids: DirEntry[] = [
    { name: 'z.txt', isDir: false },
    { name: 'sub', isDir: true },
  ];
  const rows = buildTreeRows(
    ['/work'],
    new Set(['/work']),
    new Map([['/work', kids]]),
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.depth, r.isDir]),
    [
      ['work', 0, true],
      ['z.txt', 1, false],
      ['sub', 1, true],
    ],
  );
});

test('formatTreeLabel: chevrons and indentation', () => {
  const expanded = new Set(['/r']);
  assert.equal(
    formatTreeLabel({ path: '/r', name: 'r', isDir: true, depth: 0 }, expanded),
    '▾ r/',
  );
  assert.equal(
    formatTreeLabel({ path: '/r/s', name: 's', isDir: true, depth: 1 }, new Set()),
    '  ▸ s/',
  );
  assert.equal(
    formatTreeLabel({ path: '/r/f.txt', name: 'f.txt', isDir: false, depth: 1 }, expanded),
    '    f.txt', // depth pad + two spaces to align under chevron
  );
});

// --- plugin behaviour ---

test('directory-list shows the root folder expanded with its children', async () => {
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

    const rootName = basename(dir);
    assert.deepEqual(labels(adapter), [
      `▾ ${rootName}/`,
      '    alpha.txt',
      '    beta.txt',
      '  ▸ subdir/',
    ]);
    assert.equal(treeWidget(adapter).selected, 0);

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

test('multi-root: each root appears as a top-level expanded folder', async () => {
  const a = await makeTempDir();
  const b = await makeTempDir();
  try {
    await writeFile(join(a, 'a.txt'), 'a');
    await writeFile(join(b, 'b.txt'), 'b');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [a, b],
    });

    const labs = labels(adapter);
    assert.ok(labs.includes(`▾ ${basename(a)}/`));
    assert.ok(labs.includes(`▾ ${basename(b)}/`));
    assert.ok(labs.some((l) => l.includes('a.txt')));
    assert.ok(labs.some((l) => l.includes('b.txt')));

    await app.dispose();
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test('tree.down / tree.up move selection and clamp', async () => {
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

    // rows: root, a.txt, b.txt  (3)
    assert.equal(treeWidget(adapter).selected, 0);
    await app.commands.run('tree.down');
    assert.equal(treeWidget(adapter).selected, 1);
    await app.commands.run('tree.down');
    assert.equal(treeWidget(adapter).selected, 2);
    await app.commands.run('tree.down');
    assert.equal(treeWidget(adapter).selected, 2); // clamp
    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 1);
    await app.commands.run('tree.up');
    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.up / tree.down are no-ops when the listing is empty', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({
    adapter,
    plugins: [keymap, directoryList],
    roots: [],
  });

  assert.deepEqual(treeWidget(adapter).items, []);
  await app.commands.run('tree.down');
  await app.commands.run('tree.up');
  assert.equal(treeWidget(adapter).selected, 0);

  await app.dispose();
});

test('tree.open on a file opens it as the active document and focuses editor', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'note.txt'), 'hello');

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

    await app.commands.run('tree.focus');
    assert.equal(focus.top(), 'tree');

    // Select note.txt (index 1 under expanded root)
    await app.commands.run('tree.down');
    await app.commands.run('tree.open');

    const doc = app.workspace.activeDocument;
    assert.ok(doc);
    assert.equal(doc.path, join(dir, 'note.txt'));
    assert.equal(doc.text(), 'hello');
    assert.equal(focus.top(), 'editor');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on a collapsed directory expands and reveals children', async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, 'subdir'));
    await writeFile(join(dir, 'subdir', 'inner.txt'), 'i');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    // Select subdir (last row under root)
    await app.commands.run('tree.down'); // alpha-like: only subdir
    // rows: root, subdir/  — select subdir
    assert.ok(labels(adapter).some((l) => l.includes('▸ subdir/')));
    // Move selection onto subdir
    while (!labels(adapter)[treeWidget(adapter).selected]?.includes('subdir')) {
      await app.commands.run('tree.down');
    }

    await app.commands.run('tree.open'); // expand
    await until(
      () => labels(adapter).some((l) => l.includes('inner.txt')),
      'inner.txt should appear after expand',
    );
    assert.ok(labels(adapter).some((l) => l.includes('▾ subdir/')));

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on an expanded directory collapses it', async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, 'subdir'));
    await writeFile(join(dir, 'subdir', 'inner.txt'), 'i');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    // Expand subdir first
    while (!labels(adapter)[treeWidget(adapter).selected]?.includes('subdir')) {
      await app.commands.run('tree.down');
    }
    await app.commands.run('tree.open');
    await until(
      () => labels(adapter).some((l) => l.includes('inner.txt')),
      'expanded',
    );

    // Collapse via enter again
    while (!labels(adapter)[treeWidget(adapter).selected]?.includes('subdir')) {
      await app.commands.run('tree.up');
    }
    await app.commands.run('tree.open');
    assert.ok(!labels(adapter).some((l) => l.includes('inner.txt')));
    assert.ok(labels(adapter).some((l) => l.includes('▸ subdir/')));

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.expand / tree.collapse via right/left bindings', async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, 'subdir'));
    await writeFile(join(dir, 'subdir', 'x.txt'), 'x');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.equal(app.keys.resolve('tree:right'), 'tree.expand');
    assert.equal(app.keys.resolve('tree:left'), 'tree.collapse');

    while (!labels(adapter)[treeWidget(adapter).selected]?.includes('subdir')) {
      await app.commands.run('tree.down');
    }
    await app.commands.run('tree.expand');
    await until(
      () => labels(adapter).some((l) => l.includes('x.txt')),
      'expand via tree.expand',
    );

    while (!labels(adapter)[treeWidget(adapter).selected]?.includes('subdir')) {
      await app.commands.run('tree.up');
    }
    await app.commands.run('tree.collapse');
    assert.ok(!labels(adapter).some((l) => l.includes('x.txt')));

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
    assert.equal(app.keys.resolve('tree:left'), 'tree.collapse');
    assert.equal(app.keys.resolve('tree:right'), 'tree.expand');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fs:changed refreshes expanded listings', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'one.txt'), '1');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.ok(labels(adapter).some((l) => l.includes('one.txt')));
    assert.ok(!labels(adapter).some((l) => l.includes('two.txt')));

    await writeFile(join(dir, 'two.txt'), '2');
    app.bus.emit('fs:changed', { dir, filename: 'two.txt', eventType: 'rename' });

    await until(
      () => labels(adapter).some((l) => l.includes('two.txt')),
      'tree list should include two.txt after fs:changed',
    );

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collapsing the root hides its children', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.txt'), 'a');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.ok(labels(adapter).some((l) => l.includes('a.txt')));
    // selection starts on root
    await app.commands.run('tree.open'); // collapse root
    assert.deepEqual(labels(adapter), [`▸ ${basename(dir)}/`]);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
