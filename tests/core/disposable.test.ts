import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/core/event-bus.ts';
import { ViewRegistry, ViewComposer, type ViewModel } from '../../src/core/view.ts';

test('EventBus.on returns a disposer that removes the listener', () => {
  const bus = new EventBus();
  let count = 0;
  const sub = bus.on('e', () => { count++; });
  bus.emit('e', undefined);
  sub.dispose();
  bus.emit('e', undefined);
  assert.equal(count, 1);
});

test('ViewRegistry.contribute returns an identity-guarded disposer', () => {
  const reg = new ViewRegistry();
  const a: ViewModel = { kind: 'status', segments: ['a'] };
  const b: ViewModel = { kind: 'status', segments: ['b'] };
  const subA = reg.contribute('status', () => a);
  const subB = reg.contribute('status', () => b); // overwrites slot (last-writer-wins)
  subA.dispose(); // must NOT remove b's provider
  assert.deepEqual(new ViewComposer(reg).compose().status, b);
  subB.dispose(); // removes b
  assert.equal('status' in new ViewComposer(reg).compose(), false);
});
