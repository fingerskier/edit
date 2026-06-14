import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/core/event-bus.ts';
import { FileSystem } from '../../src/core/file-system.ts';
import { Workspace } from '../../src/core/workspace.ts';

function makeWorkspace(roots: string[] = []) {
  const bus = new EventBus();
  return { bus, ws: new Workspace(bus, new FileSystem(), roots) };
}

test('roots are exposed as given', () => {
  const { ws } = makeWorkspace(['/a', '/b']);
  assert.deepEqual(ws.roots, ['/a', '/b']);
});

test('openFile reads the file, adds a document, activates it, emits events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-ws-'));
  try {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const { bus, ws } = makeWorkspace([dir]);
    const events: string[] = [];
    bus.on('document:opened', () => events.push('opened'));
    bus.on('document:activated', () => events.push('activated'));
    const doc = await ws.openFile(join(dir, 'a.txt'));
    assert.equal(doc.text(), 'hello');
    assert.equal(ws.activeDocument?.id, doc.id);
    assert.deepEqual(events, ['opened', 'activated']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyEdit mutates the active doc and emits document:changed with inverse', () => {
  const { bus, ws } = makeWorkspace();
  ws.openScratch('hello');
  let payload: any;
  bus.on('document:changed', (p) => { payload = p; });
  const inverse = ws.applyEdit({ start: 5, end: 5, text: '!' });
  assert.equal(ws.activeDocument?.text(), 'hello!');
  assert.deepEqual(inverse, { start: 5, end: 6, text: '' });
  assert.equal(payload.docId, ws.activeDocument?.id);
  assert.deepEqual(payload.inverse, { start: 5, end: 6, text: '' });
});

test('applyEdit with no active document throws', () => {
  const { ws } = makeWorkspace();
  assert.throws(() => ws.applyEdit({ start: 0, end: 0, text: 'x' }), /no active document/);
});

test('setSelection updates the active doc and emits selection:moved', () => {
  const { bus, ws } = makeWorkspace();
  ws.openScratch('hello');
  let moved = false;
  bus.on('selection:moved', () => { moved = true; });
  ws.setSelection({ anchor: 1, head: 3 });
  assert.deepEqual(ws.activeDocument?.selection, { anchor: 1, head: 3 });
  assert.equal(moved, true);
});

test('save writes the active doc to disk, clears dirty, emits document:saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-ws-'));
  try {
    const path = join(dir, 'out.txt');
    await writeFile(path, 'old');
    const { bus, ws } = makeWorkspace([dir]);
    await ws.openFile(path);
    ws.applyEdit({ start: 0, end: 3, text: 'new' });
    let saved = false;
    bus.on('document:saved', () => { saved = true; });
    await ws.save();
    const fs = new FileSystem();
    assert.equal(await fs.read(path), 'new');
    assert.equal(ws.activeDocument?.dirty, false);
    assert.equal(saved, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setActive on an unknown id is a no-op and emits nothing', () => {
  const { bus, ws } = makeWorkspace();
  ws.openScratch('a');
  let activations = 0;
  bus.on('document:activated', () => { activations++; });
  ws.setActive('does-not-exist');
  assert.equal(activations, 0);
});

test('setActive on a known id switches active and emits document:activated', () => {
  const { bus, ws } = makeWorkspace();
  const first = ws.openScratch('first');
  const second = ws.openScratch('second');
  let activatedId: string | undefined;
  bus.on('document:activated', (p: { docId: string }) => { activatedId = p.docId; });
  ws.setActive(first.id);
  assert.equal(ws.activeDocument?.id, first.id);
  assert.equal(activatedId, first.id);
  assert.notEqual(first.id, second.id);
});

test('closeDocument removes the doc, emits document:closed, and re-activates the survivor', () => {
  const { bus, ws } = makeWorkspace();
  const first = ws.openScratch('first');
  const second = ws.openScratch('second'); // second is active
  const events: Array<{ type: string; docId: string }> = [];
  bus.on('document:closed', (p: { docId: string }) => events.push({ type: 'closed', docId: p.docId }));
  bus.on('document:activated', (p: { docId: string }) => events.push({ type: 'activated', docId: p.docId }));
  ws.closeDocument(second.id);
  assert.equal(ws.getDocument(second.id), undefined);
  assert.equal(ws.activeDocument?.id, first.id);
  assert.deepEqual(events, [
    { type: 'closed', docId: second.id },
    { type: 'activated', docId: first.id },
  ]);
});

test('closeDocument on an unknown id is a no-op and emits nothing', () => {
  const { bus, ws } = makeWorkspace();
  ws.openScratch('a');
  let events = 0;
  bus.on('document:closed', () => { events++; });
  bus.on('document:activated', () => { events++; });
  ws.closeDocument('nope');
  assert.equal(events, 0);
});

test('openFile deduplicates: reopening the same path returns the existing document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-ws-'));
  try {
    await writeFile(join(dir, 'dup.txt'), 'content');
    const { bus, ws } = makeWorkspace([dir]);
    const path = join(dir, 'dup.txt');

    const openedEvents: string[] = [];
    const activatedEvents: string[] = [];
    bus.on('document:opened', () => openedEvents.push('opened'));
    bus.on('document:activated', () => activatedEvents.push('activated'));

    const first = await ws.openFile(path);
    assert.deepEqual(openedEvents, ['opened'], 'first open emits document:opened');
    assert.deepEqual(activatedEvents, ['activated'], 'first open emits document:activated');

    // Mutate to confirm re-open does not discard edits
    first.buffer.apply({ start: 0, end: 0, text: 'EDIT:' });

    const second = await ws.openFile(path);
    assert.equal(second.id, first.id, 'same document id returned on second open');
    assert.deepEqual(openedEvents, ['opened'], 'second open does NOT emit another document:opened');
    assert.deepEqual(activatedEvents, ['activated', 'activated'], 'second open emits document:activated');
    assert.equal(second.text(), 'EDIT:content', 'unsaved edits are preserved on re-open');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
