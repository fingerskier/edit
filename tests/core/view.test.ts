import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewRegistry, ViewComposer, type ViewModel } from '../../src/core/view.ts';

test('composer collects the latest view model per slot', () => {
  const reg = new ViewRegistry();
  const list: ViewModel = { kind: 'list', items: [{ label: 'a.txt' }], selected: 0 };
  const text: ViewModel = { kind: 'text', lines: ['hello'] };
  reg.contribute('tree', () => list);
  reg.contribute('main', () => text);
  const frame = new ViewComposer(reg).compose();
  assert.deepEqual(frame, { tree: list, main: text });
});

test('the panel slot composes like any other slot', () => {
  const reg = new ViewRegistry();
  reg.contribute('panel', () => ({ kind: 'panel', title: 'Output', body: { kind: 'text', lines: ['ready'] } }));
  const frame = new ViewComposer(reg).compose();
  assert.equal(frame.panel?.kind, 'panel');
});

test('a provider returning null omits its slot from the frame', () => {
  const reg = new ViewRegistry();
  reg.contribute('overlay', () => null);
  const frame = new ViewComposer(reg).compose();
  assert.equal('overlay' in frame, false);
});

test('with equal priority, the last provider registered for a slot wins', () => {
  const reg = new ViewRegistry();
  reg.contribute('status', () => ({ kind: 'status', segments: ['first'] }));
  reg.contribute('status', () => ({ kind: 'status', segments: ['second'] }));
  const frame = new ViewComposer(reg).compose();
  assert.deepEqual(frame.status, { kind: 'status', segments: ['second'] });
});

test('a higher-priority provider wins regardless of registration order', () => {
  const reg = new ViewRegistry();
  // Register the low-priority provider LAST: priority must beat registration order.
  reg.contribute('main', () => ({ kind: 'text', lines: ['high'] }), { priority: 10 });
  reg.contribute('main', () => ({ kind: 'text', lines: ['low'] }), { priority: 1 });
  const frame = new ViewComposer(reg).compose();
  assert.deepEqual(frame.main, { kind: 'text', lines: ['high'] });
});

test('compose falls through to a lower-priority provider when the winner returns null', () => {
  const reg = new ViewRegistry();
  reg.contribute('overlay', () => null, { priority: 10 });            // active but currently empty
  reg.contribute('overlay', () => ({ kind: 'text', lines: ['fallback'] }), { priority: 1 });
  const frame = new ViewComposer(reg).compose();
  assert.deepEqual(frame.overlay, { kind: 'text', lines: ['fallback'] });
});

test('a throwing winner falls through to the next contender for the slot', () => {
  const reg = new ViewRegistry();
  const originalError = console.error;
  console.error = () => {};
  try {
    reg.contribute('tree', () => { throw new Error('bad winner'); }, { priority: 10 });
    reg.contribute('tree', () => ({ kind: 'list', items: [{ label: 'ok' }], selected: 0 }), { priority: 1 });
    const frame = new ViewComposer(reg).compose();
    assert.deepEqual(frame.tree, { kind: 'list', items: [{ label: 'ok' }], selected: 0 });
  } finally {
    console.error = originalError;
  }
});

test('disposing one of several providers leaves the others intact', () => {
  const reg = new ViewRegistry();
  const a = reg.contribute('status', () => ({ kind: 'status', segments: ['a'] }), { priority: 5 });
  reg.contribute('status', () => ({ kind: 'status', segments: ['b'] }), { priority: 1 });
  a.dispose(); // removes the higher-priority 'a' -> 'b' now wins
  assert.deepEqual(new ViewComposer(reg).compose().status, { kind: 'status', segments: ['b'] });
});

test('a throwing provider degrades only its slot; other slots still compose', () => {
  const reg = new ViewRegistry();
  const originalError = console.error;
  console.error = () => {}; // silence the isolation log for clean test output
  try {
    reg.contribute('tree', () => { throw new Error('bad provider'); });
    reg.contribute('main', () => ({ kind: 'text', lines: ['ok'] }));
    const composer = new ViewComposer(reg);
    let frame!: ReturnType<typeof composer.compose>;
    assert.doesNotThrow(() => { frame = composer.compose(); });
    assert.equal('tree' in frame, false);
    assert.deepEqual(frame.main, { kind: 'text', lines: ['ok'] });
  } finally {
    console.error = originalError;
  }
});
