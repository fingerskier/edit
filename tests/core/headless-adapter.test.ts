import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Frame } from '../../src/core/view.ts';

test('render records each frame; lastFrame returns the most recent', () => {
  const a = new HeadlessAdapter();
  const f1: Frame = { status: { kind: 'status', segments: ['a'] } };
  const f2: Frame = { status: { kind: 'status', segments: ['b'] } };
  a.render(f1);
  a.render(f2);
  assert.equal(a.frames.length, 2);
  assert.deepEqual(a.lastFrame(), f2);
});

test('sendKey forwards key strings to the registered handler', () => {
  const a = new HeadlessAdapter();
  const got: string[] = [];
  a.onKey((k) => got.push(k));
  a.sendKey('ctrl+s');
  assert.deepEqual(got, ['ctrl+s']);
});
