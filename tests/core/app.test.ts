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

test('a key bound to a command runs that command via the adapter', async () => {
  const adapter = new HeadlessAdapter();
  let ran = 0;
  const plugin: Plugin = {
    name: 'kb',
    activate(ctx) {
      ctx.commands.register('demo.ping', () => { ran++; });
      ctx.keys.bind('ctrl+p', 'demo.ping');
    },
  };
  await createApp({ adapter, plugins: [plugin], roots: [] });
  adapter.sendKey('ctrl+p');
  assert.equal(ran, 1);
});

test('an unbound key is ignored without throwing', async () => {
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
