import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StringBuffer } from '../../src/core/buffer.ts';

test('insert at offset and read text back', () => {
  const b = new StringBuffer('Hello');
  b.apply({ start: 5, end: 5, text: ' world' });
  assert.equal(b.getText(), 'Hello world');
  assert.equal(b.length(), 11);
});

test('apply returns the inverse op that undoes the edit', () => {
  const b = new StringBuffer('Hello world');
  const inverse = b.apply({ start: 0, end: 5, text: 'Howdy' }); // replace "Hello"
  assert.equal(b.getText(), 'Howdy world');
  assert.deepEqual(inverse, { start: 0, end: 5, text: 'Hello' });
  b.apply(inverse);
  assert.equal(b.getText(), 'Hello world');
});

test('pure delete inverse re-inserts removed text', () => {
  const b = new StringBuffer('abcdef');
  const inverse = b.apply({ start: 2, end: 4, text: '' }); // delete "cd"
  assert.equal(b.getText(), 'abef');
  assert.deepEqual(inverse, { start: 2, end: 2, text: 'cd' });
});
