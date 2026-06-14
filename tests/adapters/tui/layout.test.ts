import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../../../src/adapters/tui/layout.ts';

test('status bar is the full-width bottom row; content sits above it', () => {
  const l = computeLayout(80, 24);
  assert.deepEqual(l.status, { x: 0, y: 23, width: 80, height: 1 });
  assert.equal(l.tree.height, 23);
  assert.equal(l.main.height, 23);
});

test('tree is a left column, divider after it, main fills the rest', () => {
  const l = computeLayout(80, 24);
  assert.equal(l.tree.x, 0);
  assert.equal(l.tree.y, 0);
  assert.ok(l.tree.width >= 16 && l.tree.width <= 40, 'tree width clamped');
  assert.equal(l.dividerX, l.tree.width);
  assert.equal(l.main.x, l.tree.width + 1);
  assert.equal(l.main.width, 80 - l.tree.width - 1);
});

test('tree width is clamped to a minimum on wider-but-thin ratios', () => {
  // 0.25 * 80 = 20, within [16,40]
  assert.equal(computeLayout(80, 24).tree.width, 20);
  // 0.25 * 200 = 50 -> clamped to 40
  assert.equal(computeLayout(200, 24).tree.width, 40);
  // 0.25 * 40 = 10 -> clamped up to 16
  assert.equal(computeLayout(40, 24).tree.width, 16);
});

test('degrades gracefully on a tiny terminal (main keeps >=1 col)', () => {
  const l = computeLayout(10, 3);
  assert.ok(l.main.width >= 1, 'main has at least one column');
  assert.ok(l.tree.width >= 0);
  assert.equal(l.status.y, 2);
});

test('overlay is centered within the content area', () => {
  const l = computeLayout(80, 24);
  assert.ok(l.overlay.width <= 80 && l.overlay.height <= 23);
  assert.equal(l.overlay.x, Math.floor((80 - l.overlay.width) / 2));
  assert.equal(l.overlay.y, Math.floor((23 - l.overlay.height) / 2));
});
