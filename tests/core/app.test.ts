import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin } from '../../src/core/plugin-host.ts';

test('activating a plugin lets it contribute a view that renders on start', async () => {
  const adapter = new HeadlessAdapter();
  const plugin: Plugin = {
    name: 'banner',
    activate(ctx) {
      ctx.view.contribute('status', () => ({ kind: 'status', segments: ['ready'] }));
    },
  };
  await createApp({ adapter, plugins: [plugin], roots: [] });
  assert.deepEqual(adapter.lastFrame()?.status, { kind: 'status', segments: ['ready'] });
});

test('adapter keys are forwarded to the bus as "key" events for plugins to route', async () => {
  const adapter = new HeadlessAdapter();
  const seen: string[] = [];
  const plugin: Plugin = {
    name: 'observer',
    activate(ctx) {
      ctx.events.on('key', (p: { key: string }) => seen.push(p.key));
    },
  };
  await createApp({ adapter, plugins: [plugin], roots: [] });
  adapter.sendKey('ctrl+p');
  adapter.sendKey('a');
  assert.deepEqual(seen, ['ctrl+p', 'a']);
});

test('a plugin can implement keymap dispatch on top of raw key events', async () => {
  const adapter = new HeadlessAdapter();
  const runs: Array<{ key: string }> = [];
  const plugin: Plugin = {
    name: 'keymap-like',
    activate(ctx) {
      ctx.commands.register('demo.ping', (args: { key: string }) => { runs.push(args); });
      ctx.keys.bind('ctrl+p', 'demo.ping');
      ctx.events.on('key', (p: { key: string }) => {
        const id = ctx.keys.resolve(p.key);
        if (id) void ctx.commands.run(id, { key: p.key });
      });
    },
  };
  await createApp({ adapter, plugins: [plugin], roots: [] });
  adapter.sendKey('ctrl+p');
  adapter.sendKey('ctrl+q'); // unbound -> no dispatch
  assert.deepEqual(runs, [{ key: 'ctrl+p' }]);
});

test('sending a key with no listeners does not throw', async () => {
  const adapter = new HeadlessAdapter();
  await createApp({ adapter, plugins: [], roots: [] });
  assert.doesNotThrow(() => adapter.sendKey('ctrl+q'));
});

test('view.invalidate re-renders the current frame', async () => {
  const adapter = new HeadlessAdapter();
  let label = 'first';
  let invalidate!: () => void;
  const plugin: Plugin = {
    name: 'dyn',
    activate(ctx) {
      ctx.view.contribute('status', () => ({ kind: 'status', segments: [label] }));
      invalidate = ctx.view.invalidate;
    },
  };
  await createApp({ adapter, plugins: [plugin], roots: [] });
  label = 'second';
  invalidate();
  assert.deepEqual(adapter.lastFrame()?.status, { kind: 'status', segments: ['second'] });
});

test('plugins can drive the workspace through ctx.workspace', async () => {
  const adapter = new HeadlessAdapter();
  const plugin: Plugin = {
    name: 'scratch',
    activate(ctx) {
      ctx.workspace.openScratch('hi');
      ctx.view.contribute('main', () => ({
        kind: 'text',
        lines: [ctx.workspace.activeDocument?.text() ?? ''],
      }));
    },
  };
  await createApp({ adapter, plugins: [plugin], roots: [] });
  assert.deepEqual(adapter.lastFrame()?.main, { kind: 'text', lines: ['hi'] });
});

test('host disposes ctx.subscriptions (reverse order) on app.dispose', async () => {
  const adapter = new HeadlessAdapter();
  const disposed: string[] = [];
  const plugin: Plugin = {
    name: 'sub',
    activate(ctx) {
      ctx.subscriptions.push({ dispose: () => disposed.push('first') });
      ctx.subscriptions.push({ dispose: () => disposed.push('second') });
    },
  };
  const app = await createApp({ adapter, plugins: [plugin], roots: [] });
  await app.dispose();
  assert.deepEqual(disposed, ['second', 'first']); // LIFO
});

test('a disposed view contribution stops appearing in frames', async () => {
  const adapter = new HeadlessAdapter();
  const plugin: Plugin = {
    name: 'temp',
    activate(ctx) {
      const sub = ctx.view.contribute('status', () => ({ kind: 'status', segments: ['x'] }));
      ctx.subscriptions.push(sub);
    },
  };
  const app = await createApp({ adapter, plugins: [plugin], roots: [] });
  assert.deepEqual(adapter.lastFrame()?.status, { kind: 'status', segments: ['x'] });
  await app.dispose();
  app.render();
  assert.equal('status' in (adapter.lastFrame() ?? {}), false);
});
