import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin } from '../../src/core/plugin-host.ts';
import statusBar from '../../src/plugins/status-bar.ts';
import editorView from '../../src/plugins/editor-view.ts';
import keymap from '../../src/plugins/keymap.ts';

function statusOf(adapter: HeadlessAdapter): string[] {
  const s = adapter.lastFrame()?.status;
  assert.ok(s && s.kind === 'status', 'status slot should be a status widget');
  return (s as { kind: 'status'; segments: string[] }).segments;
}

test('status shows a placeholder when no document is open', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({ adapter, plugins: [statusBar], roots: [] });
  assert.deepEqual(statusOf(adapter), ['edit', 'no file open']);
  await app.dispose();
});

test('status shows scratch name + 1-based Ln/Col, and a dirty marker after editing', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({ adapter, plugins: [keymap, editorView, statusBar], roots: [] });

  app.workspace.openScratch('hello\nworld');
  app.workspace.setSelection({ anchor: 8, head: 8 }); // line 2 ("world"), col 3 -> 'r'
  let seg = statusOf(adapter);
  assert.equal(seg[0], '[scratch]');
  assert.equal(seg[1], 'Ln 2, Col 3');

  // An edit marks the document dirty -> the name gains a ● marker.
  app.workspace.applyEdit({ start: 0, end: 0, text: 'X' });
  seg = statusOf(adapter);
  assert.match(seg[0], /^●\s\[scratch\]$/);

  await app.dispose();
});

test('status returns to the no-file placeholder after the last document closes', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({ adapter, plugins: [keymap, editorView, statusBar], roots: [] });

  const doc = app.workspace.openScratch('hello');
  assert.equal(statusOf(adapter)[0], '[scratch]');

  app.workspace.closeDocument(doc.id); // last doc: emits only 'document:closed'
  app.render(); // a later render must not show the stale closed file
  assert.deepEqual(statusOf(adapter), ['edit', 'no file open']);

  await app.dispose();
});

test('multiple plugins compose into one status bar, ordered by item priority', async () => {
  // Two independent plugins each add a status-bar item via ctx.statusBar; both
  // appear in the single status slot — the multi-contributor model the status
  // bar is built to demonstrate.
  const branch: Plugin = {
    name: 'fake-git',
    activate(ctx) {
      ctx.subscriptions.push(ctx.statusBar.createItem({ text: ' main', priority: 50 }));
    },
  };
  const diagnostics: Plugin = {
    name: 'fake-lsp',
    activate(ctx) {
      ctx.subscriptions.push(ctx.statusBar.createItem({ text: '0 errors', priority: 40 }));
    },
  };

  const adapter = new HeadlessAdapter();
  // status-bar (file=priority 100, pos=90) + git (50) + lsp (40).
  const app = await createApp({ adapter, plugins: [statusBar, branch, diagnostics], roots: [] });
  assert.deepEqual(statusOf(adapter), ['edit', 'no file open', ' main', '0 errors']);

  // Disposing a contributor removes only its segment.
  await app.dispose();
});

test('status shows the file basename for a file-backed document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-status-'));
  try {
    const file = join(dir, 'notes.md');
    await writeFile(file, 'content');
    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: [keymap, editorView, statusBar], roots: [dir] });
    await app.workspace.openFile(file);
    assert.equal(statusOf(adapter)[0], 'notes.md');
    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
