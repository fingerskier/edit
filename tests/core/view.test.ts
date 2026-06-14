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

test('a provider returning null omits its slot from the frame', () => {
  const reg = new ViewRegistry();
  reg.contribute('overlay', () => null);
  const frame = new ViewComposer(reg).compose();
  assert.equal('overlay' in frame, false);
});

test('the last provider registered for a slot wins', () => {
  const reg = new ViewRegistry();
  reg.contribute('status', () => ({ kind: 'status', segments: ['first'] }));
  reg.contribute('status', () => ({ kind: 'status', segments: ['second'] }));
  const frame = new ViewComposer(reg).compose();
  assert.deepEqual(frame.status, { kind: 'status', segments: ['second'] });
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
