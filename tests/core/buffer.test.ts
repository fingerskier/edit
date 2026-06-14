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

test('a reversed op (end < start) is normalized to an insert and round-trips', () => {
  const b = new StringBuffer('hello world');
  const inverse = b.apply({ start: 5, end: 2, text: 'X' });
  assert.equal(b.getText(), 'helloX world'); // inserted at 5; empty range
  assert.deepEqual(inverse, { start: 5, end: 6, text: '' });
  b.apply(inverse);
  assert.equal(b.getText(), 'hello world');
});

test('out-of-range bounds are clamped and the inverse still round-trips', () => {
  const b = new StringBuffer('abc');
  const negInverse = b.apply({ start: -2, end: 1, text: 'Q' }); // start clamps to 0
  assert.equal(b.getText(), 'Qbc');
  assert.deepEqual(negInverse, { start: 0, end: 1, text: 'a' });
  b.apply(negInverse);
  assert.equal(b.getText(), 'abc');

  const overInverse = b.apply({ start: 1, end: 99, text: 'Z' }); // end clamps to length
  assert.equal(b.getText(), 'aZ');
  assert.deepEqual(overInverse, { start: 1, end: 2, text: 'bc' });
  b.apply(overInverse);
  assert.equal(b.getText(), 'abc');
});
