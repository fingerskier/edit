import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '../../src/core/document.ts';

test('new document is not dirty and has a caret at 0', () => {
  const d = new Document('doc1', '/tmp/a.txt', 'hello');
  assert.equal(d.dirty, false);
  assert.deepEqual(d.selection, { anchor: 0, head: 0 });
  assert.equal(d.text(), 'hello');
});

test('apply edits the buffer, marks dirty, returns inverse', () => {
  const d = new Document('doc1', '/tmp/a.txt', 'hello');
  const inverse = d.apply({ start: 5, end: 5, text: '!' });
  assert.equal(d.text(), 'hello!');
  assert.equal(d.dirty, true);
  assert.deepEqual(inverse, { start: 5, end: 6, text: '' });
});

test('setSelection clamps head/anchor into buffer bounds', () => {
  const d = new Document('doc1', null, 'abc');
  d.setSelection({ anchor: -2, head: 99 });
  assert.deepEqual(d.selection, { anchor: 0, head: 3 });
});

test('markClean resets the dirty flag', () => {
  const d = new Document('doc1', '/tmp/a.txt', 'x');
  d.apply({ start: 1, end: 1, text: 'y' });
  d.markClean();
  assert.equal(d.dirty, false);
});
