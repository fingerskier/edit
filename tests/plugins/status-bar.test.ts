import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
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
