import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystem } from '../../src/core/file-system.ts';

test('write then read round-trips file contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-fs-'));
  try {
    const fs = new FileSystem();
    const path = join(dir, 'a.txt');
    await fs.write(path, 'hello');
    assert.equal(await fs.read(path), 'hello');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('list returns directory entries with type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-fs-'));
  try {
    const fs = new FileSystem();
    await fs.write(join(dir, 'a.txt'), '');
    const entries = await fs.list(dir);
    assert.deepEqual(entries, [{ name: 'a.txt', isDir: false }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
