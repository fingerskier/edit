import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../../../src/adapters/tui/layout.ts';

test('status bar is the full-width bottom row; content sits above it', () => {
  const l = computeLayout(80, 24);
  assert.deepEqual(l.status, { x: 0, y: 23, width: 80, height: 1 });
  assert.equal(l.tree.height, 23);
  assert.equal(l.main.height, 23);
  assert.equal(l.tabs.height, 0);
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

test('panel is hidden by default (height 0) and content fills above the status bar', () => {
  const l = computeLayout(80, 24);
  assert.equal(l.panel.height, 0);
  assert.equal(l.tree.height, 23);
  assert.equal(l.main.height, 23);
});

test('a requested panel reserves rows above the status bar; content shrinks to fit', () => {
  const l = computeLayout(80, 24, { panelHeight: 6 });
  assert.deepEqual(l.panel, { x: 0, y: 17, width: 80, height: 6 }); // rows 17..22
  assert.equal(l.tree.height, 17); // rows 0..16
  assert.equal(l.main.height, 17);
  assert.equal(l.status.y, 23); // status row unmoved
});

test('panel height is clamped to the space above the status bar', () => {
  const l = computeLayout(80, 5, { panelHeight: 100 });
  assert.equal(l.panel.height, 4); // rows above status = 4
  assert.equal(l.tree.height, 0);
  assert.equal(l.main.height, 0);
});

test('overlay is centered within the content area', () => {
  const l = computeLayout(80, 24);
  assert.ok(l.overlay.width <= 80 && l.overlay.height <= 23);
  assert.equal(l.overlay.x, Math.floor((80 - l.overlay.width) / 2));
  assert.equal(l.overlay.y, Math.floor((23 - l.overlay.height) / 2));
});

test('tabs strip sits in the main column only; tree keeps full content height', () => {
  const l = computeLayout(80, 24, { tabsHeight: 1 });
  assert.equal(l.tabs.height, 1);
  assert.equal(l.tabs.y, 0);
  assert.equal(l.tabs.x, l.main.x);
  assert.equal(l.tabs.width, l.main.width);
  assert.equal(l.main.y, 1);
  assert.equal(l.main.height, 22); // content 23 minus 1 tab row
  assert.equal(l.tree.height, 23); // tree not shortened by tabs
});

test('tabs + panel both reserve space without overlapping', () => {
  const l = computeLayout(80, 24, { tabsHeight: 1, panelHeight: 5 });
  assert.equal(l.panel.height, 5);
  assert.equal(l.tabs.height, 1);
  assert.equal(l.main.y, 1);
  assert.equal(l.main.height, 17); // 23 content - 5 panel - 1 tabs, wait: contentH = 23-5=18, main = 18-1=17
  assert.equal(l.tree.height, 18);
});
