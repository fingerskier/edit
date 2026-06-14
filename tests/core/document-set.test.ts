import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSet } from '../../src/core/document-set.ts';

test('add creates a document, returns it, and makes it active when first', () => {
  const set = new DocumentSet();
  const d = set.add('/tmp/a.txt', 'hi');
  assert.equal(d.path, '/tmp/a.txt');
  assert.equal(set.active?.id, d.id);
});

test('ids are unique across adds', () => {
  const set = new DocumentSet();
  const a = set.add('/tmp/a.txt', '');
  const b = set.add('/tmp/b.txt', '');
  assert.notEqual(a.id, b.id);
});

test('setActive switches the active document', () => {
  const set = new DocumentSet();
  set.add('/tmp/a.txt', '');
  const b = set.add('/tmp/b.txt', '');
  set.setActive(b.id);
  assert.equal(set.active?.id, b.id);
});

test('get returns a document by id, undefined if missing', () => {
  const set = new DocumentSet();
  const a = set.add('/tmp/a.txt', '');
  assert.equal(set.get(a.id), a);
  assert.equal(set.get('nope'), undefined);
});

test('close removes a document and reassigns active', () => {
  const set = new DocumentSet();
  const a = set.add('/tmp/a.txt', '');
  const b = set.add('/tmp/b.txt', '');
  set.setActive(b.id);
  set.close(b.id);
  assert.equal(set.get(b.id), undefined);
  assert.equal(set.active?.id, a.id);
});
