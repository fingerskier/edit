import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/core/event-bus.ts';

test('emit invokes registered listeners synchronously with payload', () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.on('document:changed', (p: { id: string }) => seen.push(p.id));
  bus.emit('document:changed', { id: 'doc1' });
  assert.deepEqual(seen, ['doc1']);
});

test('listeners run in registration order before emit returns', () => {
  const bus = new EventBus();
  const order: number[] = [];
  bus.on('e', () => order.push(1));
  bus.on('e', () => order.push(2));
  bus.emit('e', undefined);
  assert.deepEqual(order, [1, 2]);
});

test('off removes a listener', () => {
  const bus = new EventBus();
  let count = 0;
  const fn = () => { count++; };
  bus.on('e', fn);
  bus.off('e', fn);
  bus.emit('e', undefined);
  assert.equal(count, 0);
});
