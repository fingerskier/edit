import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatusBarRegistry } from '../../src/core/status-bar.ts';

test('segments are ordered by priority (desc), then creation order', () => {
  const bar = new StatusBarRegistry();
  bar.createItem({ text: 'mid', priority: 50 });
  bar.createItem({ text: 'high', priority: 100 });
  bar.createItem({ text: 'low', priority: 10 });
  assert.deepEqual(bar.segments(), ['high', 'mid', 'low']);
});

test('equal-priority items keep creation order', () => {
  const bar = new StatusBarRegistry();
  bar.createItem({ text: 'first' });
  bar.createItem({ text: 'second' });
  assert.deepEqual(bar.segments(), ['first', 'second']);
});

test('empty-text and hidden items are dropped from segments', () => {
  const bar = new StatusBarRegistry();
  bar.createItem({ text: 'shown', priority: 10 });
  bar.createItem({ text: '', priority: 5 });          // empty -> not rendered
  const hidden = bar.createItem({ text: 'gone', priority: 1 });
  hidden.hide();
  assert.deepEqual(bar.segments(), ['shown']);
});

test('mutating item.text updates segments', () => {
  const bar = new StatusBarRegistry();
  const item = bar.createItem({ text: 'before' });
  item.text = 'after';
  assert.deepEqual(bar.segments(), ['after']);
});

test('changing priority re-sorts the bar', () => {
  const bar = new StatusBarRegistry();
  const a = bar.createItem({ text: 'a', priority: 1 });
  bar.createItem({ text: 'b', priority: 2 });
  assert.deepEqual(bar.segments(), ['b', 'a']);
  a.priority = 10;
  assert.deepEqual(bar.segments(), ['a', 'b']);
});

test('show() restores a hidden item', () => {
  const bar = new StatusBarRegistry();
  const item = bar.createItem({ text: 'x' });
  item.hide();
  assert.deepEqual(bar.segments(), []);
  item.show();
  assert.deepEqual(bar.segments(), ['x']);
});

test('dispose() removes the item from the bar', () => {
  const bar = new StatusBarRegistry();
  const item = bar.createItem({ text: 'temp' });
  assert.deepEqual(bar.segments(), ['temp']);
  item.dispose();
  assert.deepEqual(bar.segments(), []);
});

test('onDidChange fires on create, mutate, hide, and dispose', () => {
  const bar = new StatusBarRegistry();
  let changes = 0;
  const sub = bar.onDidChange(() => { changes++; });
  const item = bar.createItem({ text: 'a' }); // +1
  item.text = 'b';                            // +1
  item.text = 'b';                            // no-op, same value -> no change
  item.hide();                                // +1
  item.dispose();                             // +1
  assert.equal(changes, 4);
  sub.dispose();
  bar.createItem({ text: 'c' });              // listener removed -> not counted
  assert.equal(changes, 4);
});
