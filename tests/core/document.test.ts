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

test('an insert before the caret shifts the caret forward', () => {
  const d = new Document('doc1', null, 'hello');
  d.setSelection({ anchor: 5, head: 5 });
  d.apply({ start: 0, end: 0, text: 'XX' }); // -> 'XXhello'
  assert.deepEqual(d.selection, { anchor: 7, head: 7 });
});

test('inserting at the caret advances past the inserted text', () => {
  const d = new Document('doc1', null, 'hello');
  d.setSelection({ anchor: 2, head: 2 });
  d.apply({ start: 2, end: 2, text: 'AB' }); // -> 'heABllo'
  assert.deepEqual(d.selection, { anchor: 4, head: 4 });
});

test('a delete before the caret pulls the caret back', () => {
  const d = new Document('doc1', null, 'hello');
  d.setSelection({ anchor: 4, head: 4 });
  d.apply({ start: 0, end: 2, text: '' }); // delete 'he' -> 'llo'
  assert.deepEqual(d.selection, { anchor: 2, head: 2 });
});

test('a caret inside a deleted range collapses to the edit point', () => {
  const d = new Document('doc1', null, 'hello');
  d.setSelection({ anchor: 3, head: 3 });
  d.apply({ start: 2, end: 4, text: '' }); // delete 'll' -> 'heo'
  assert.deepEqual(d.selection, { anchor: 2, head: 2 });
});
