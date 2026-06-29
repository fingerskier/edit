import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatch, fuzzyRank } from '../../src/core/fuzzy.ts';

test('an empty query matches everything with score 0', () => {
  assert.deepEqual(fuzzyMatch('', 'anything'), { score: 0, positions: [] });
});

test('a non-subsequence does not match', () => {
  assert.equal(fuzzyMatch('xyz', 'insertChar'), null);
  assert.equal(fuzzyMatch('abz', 'abc'), null);
});

test('a subsequence matches and reports its positions (case-insensitive)', () => {
  const m = fuzzyMatch('ic', 'insertChar');
  assert.ok(m);
  assert.deepEqual(m!.positions, [0, 6]); // 'i' at 0, 'C' at 6
});

test('camelCase humps score higher than plain interior matches', () => {
  const hump = fuzzyMatch('c', 'insertChar')!;     // matches the 'C' hump (boundary)
  const interior = fuzzyMatch('h', 'insertChar')!; // 'h' is a plain interior letter
  assert.ok(hump.score > 1);
  assert.ok(hump.score > interior.score);
});

test('consecutive runs score higher than scattered matches', () => {
  const consecutive = fuzzyMatch('ins', 'insertChar')!;
  const scattered = fuzzyMatch('itr', 'insertChar')!; // i(0), t(5), r(9) — not consecutive
  assert.ok(consecutive.score > scattered.score);
});

test('fuzzyRank drops non-matches and ranks by score', () => {
  const items = ['Fixture: Alpha', 'Fixture: Beta', 'Zeta: Gamma'];
  assert.deepEqual(fuzzyRank('beta', items, (s) => s), ['Fixture: Beta']);
});

test('fuzzyRank breaks score ties toward shorter labels, then original order', () => {
  assert.deepEqual(fuzzyRank('ab', ['abc', 'ab'], (s) => s), ['ab', 'abc']);
  // equal score + equal length -> stable (original order preserved)
  assert.deepEqual(fuzzyRank('a', ['ax', 'ay'], (s) => s), ['ax', 'ay']);
});

test('fuzzyRank with an empty query returns every item in original order', () => {
  const items = ['c', 'a', 'b'];
  assert.deepEqual(fuzzyRank('', items, (s) => s), ['c', 'a', 'b']);
});
