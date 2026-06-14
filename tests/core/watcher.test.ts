import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/core/event-bus.ts';
import { Watcher } from '../../src/core/watcher.ts';

test('emits fs:changed when a watched directory changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-watch-'));
  const bus = new EventBus();
  const watcher = new Watcher(bus);
  try {
    const got = new Promise<{ dir: string }>((resolve) => {
      bus.on('fs:changed', (p: { dir: string }) => resolve(p));
    });
    watcher.watch(dir);
    await writeFile(join(dir, 'new.txt'), 'x');
    const payload = await got;
    assert.equal(payload.dir, dir);
  } finally {
    watcher.close();
    await rm(dir, { recursive: true, force: true });
  }
});
