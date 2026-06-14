import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePlugins } from '../../src/core/plugin-loader.ts';

test('loads default-exported plugins from a local directory, sorted by filename', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-plugins-'));
  try {
    await writeFile(join(dir, 'b-second.mjs'),
      `export default { name: 'second', activate() {} };`);
    await writeFile(join(dir, 'a-first.mjs'),
      `export default { name: 'first', activate() {} };`);
    await writeFile(join(dir, 'ignore.txt'), 'not a plugin');
    const plugins = await resolvePlugins({ specifiers: [], localDir: dir });
    assert.deepEqual(plugins.map((p) => p.name), ['first', 'second']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('returns an empty list when the local dir does not exist and no specifiers given', async () => {
  const plugins = await resolvePlugins({ specifiers: [], localDir: '/no/such/dir/xyz' });
  assert.deepEqual(plugins, []);
});

test('throws a clear error when a module lacks a default-exported plugin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-plugins-'));
  try {
    await writeFile(join(dir, 'bad.mjs'), `export const nope = 1;`);
    await assert.rejects(
      () => resolvePlugins({ specifiers: [], localDir: dir }),
      /bad\.mjs: missing default-exported plugin/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
