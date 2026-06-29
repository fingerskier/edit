import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin } from '../../src/core/plugin-host.ts';
import type { Frame, Widget } from '../../src/core/view.ts';
import keymap from '../../src/plugins/keymap.ts';
import quickInput from '../../src/plugins/quick-input.ts';
import type { QuickInputService, QuickPickItem } from '../../src/plugins/quick-input.ts';

const FRUIT = [
  { label: 'apple', value: 'a' },
  { label: 'apricot', value: 'b' },
  { label: 'banana', value: 'c' },
];

// A consumer plugin: `demo.pick` opens the picker and records each resolved value.
function picker(results: Array<QuickPickItem | undefined>): Plugin {
  return {
    name: 'picker',
    activate(ctx) {
      ctx.subscriptions.push(
        ctx.commands.register('demo.pick', async () => {
          const qi = ctx.services.get<QuickInputService>('quickInput');
          results.push(await qi.pick(FRUIT, { title: 'Fruit' }));
        }),
      );
    },
  };
}

function overlayOf(frame: Frame | undefined): Extract<Widget, { kind: 'overlay' }> | null {
  const o = frame?.overlay;
  return o && o.kind === 'overlay' ? o : null;
}
function listBody(o: Extract<Widget, { kind: 'overlay' }>): Extract<Widget, { kind: 'list' }> {
  assert.equal(o.body.kind, 'list');
  return o.body as Extract<Widget, { kind: 'list' }>;
}

async function makeApp() {
  const adapter = new HeadlessAdapter();
  const results: Array<QuickPickItem | undefined> = [];
  const tops: string[] = [];
  const app = await createApp({ adapter, plugins: [keymap, quickInput, picker(results)], roots: [] });
  app.bus.on('focus:changed', (p: { context: string }) => tops.push(p.context));
  return { adapter, app, results, tops };
}

test('pick() opens an overlay and pushes the quickInput focus context', async () => {
  const { adapter, app, tops } = await makeApp();
  void app.commands.run('demo.pick'); // session opens synchronously inside pick()
  const o = overlayOf(adapter.lastFrame());
  assert.ok(o, 'overlay present after pick()');
  assert.equal(o!.title, 'Fruit');
  assert.deepEqual(listBody(o!).items.map((i) => i.label), ['apple', 'apricot', 'banana']);
  assert.equal(tops.at(-1), 'quickInput');
  adapter.sendKey('escape');
  await app.dispose();
});

test('typing fuzzy-filters items; ties prefer the shorter label', async () => {
  const { adapter, app } = await makeApp();
  void app.commands.run('demo.pick');
  for (const ch of 'ap') adapter.sendKey(ch); // matches apple + apricot (not banana)
  assert.deepEqual(listBody(overlayOf(adapter.lastFrame())!).items.map((i) => i.label), ['apple', 'apricot']);
  adapter.sendKey('escape');
  await app.dispose();
});

test('up/down move the selection and clamp at both ends', async () => {
  const { adapter, app } = await makeApp();
  void app.commands.run('demo.pick');
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).selected, 0);
  adapter.sendKey('up'); // clamp at top
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).selected, 0);
  adapter.sendKey('down');
  adapter.sendKey('down');
  adapter.sendKey('down'); // clamp at bottom (3 items)
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).selected, 2);
  adapter.sendKey('escape');
  await app.dispose();
});

test('enter resolves the picker with the selected item and closes', async () => {
  const { adapter, app, results, tops } = await makeApp();
  const run = app.commands.run('demo.pick');
  adapter.sendKey('down');  // select 'apricot'
  adapter.sendKey('enter');
  await run;
  assert.deepEqual(results, [{ label: 'apricot', value: 'b' }]);
  assert.equal(overlayOf(adapter.lastFrame()), null, 'overlay closes after accept');
  assert.equal(tops.at(-1), 'editor', 'focus restored to base');
  await app.dispose();
});

test('escape resolves the picker with undefined and closes', async () => {
  const { adapter, app, results } = await makeApp();
  const run = app.commands.run('demo.pick');
  adapter.sendKey('escape');
  await run;
  assert.deepEqual(results, [undefined]);
  assert.equal(overlayOf(adapter.lastFrame()), null);
  await app.dispose();
});

test('opening a second picker while one is active does not double-push focus', async () => {
  const { adapter, app, tops } = await makeApp();
  void app.commands.run('demo.pick'); // open #1
  void app.commands.run('demo.pick'); // replaces #1, reuses the focus frame
  assert.equal(tops.at(-1), 'quickInput');
  // A single escape must fully close it (proves the context was pushed once).
  adapter.sendKey('escape');
  assert.equal(overlayOf(adapter.lastFrame()), null);
  assert.equal(tops.at(-1), 'editor');
  await app.dispose();
});

test('a picker can be reopened after closing', async () => {
  const { adapter, app } = await makeApp();
  void app.commands.run('demo.pick');
  adapter.sendKey('escape');
  assert.equal(overlayOf(adapter.lastFrame()), null);
  void app.commands.run('demo.pick'); // reopen
  assert.ok(overlayOf(adapter.lastFrame()), 'overlay present again');
  adapter.sendKey('escape');
  await app.dispose();
});
