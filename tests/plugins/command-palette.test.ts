// tests/plugins/command-palette.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin, PluginContext } from '../../src/core/plugin-host.ts';
import type { Frame, Widget } from '../../src/core/view.ts';
import keymap from '../../src/plugins/keymap.ts';
import quickInput from '../../src/plugins/quick-input.ts';
import commandPalette, { humanizeId } from '../../src/plugins/command-palette.ts';

// A tiny plugin that registers titled commands the palette can list/run.
function fixturePlugin(ran: string[]): Plugin {
  return {
    name: 'fixture',
    activate(ctx: PluginContext) {
      ctx.subscriptions.push(
        ctx.commands.register('fixture.alpha', () => { ran.push('fixture.alpha'); }, { title: 'Fixture: Alpha' }),
        ctx.commands.register('fixture.beta', () => { ran.push('fixture.beta'); }, { title: 'Fixture: Beta' }),
        // An untitled command to prove humanizeId is the fallback label.
        ctx.commands.register('zeta.gamma', () => { ran.push('zeta.gamma'); }),
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
  const ran: string[] = [];
  const app = await createApp({
    adapter,
    plugins: [keymap, quickInput, fixturePlugin(ran), commandPalette],
    roots: [],
  });
  return { adapter, app, ran };
}

test('humanizeId Title-cases dotted segments and joins with ": "', () => {
  assert.equal(humanizeId('editor.insertChar'), 'Editor: Insert Char');
  assert.equal(humanizeId('palette.open'), 'Palette: Open');
  assert.equal(humanizeId('tree.up'), 'Tree: Up');
  assert.equal(humanizeId('save'), 'Save');
  assert.equal(humanizeId('a.b.c'), 'A: B: C');
});

test('ctrl+p opens the command picker (overlay "Commands", focus -> quickInput)', async () => {
  const { adapter, app } = await makeApp();
  const tops: string[] = [];
  app.bus.on('focus:changed', (p: { context: string }) => tops.push(p.context));

  assert.equal(overlayOf(adapter.lastFrame()), null);
  adapter.sendKey('ctrl+p');

  const o = overlayOf(adapter.lastFrame());
  assert.ok(o, 'overlay present after ctrl+p');
  assert.equal(o!.title, 'Commands');
  assert.equal(tops.at(-1), 'quickInput');
  assert.ok(listBody(o!).items.length >= 3, 'lists the registered commands');
  await app.dispose();
});

test('the palette hides internal commands and its own opener', async () => {
  const { adapter, app } = await makeApp();
  adapter.sendKey('ctrl+p');
  const labels = listBody(overlayOf(adapter.lastFrame())!).items.map((i) => i.label);
  // quickInput.* are registered internal; palette.open is filtered by id.
  assert.ok(!labels.some((l) => l.startsWith('Quick Input')), 'no internal quickInput commands');
  assert.ok(!labels.includes('Command Palette'), 'palette does not list itself');
  await app.dispose();
});

test('typing fuzzy-filters the command list', async () => {
  const { adapter, app } = await makeApp();
  adapter.sendKey('ctrl+p');
  for (const ch of 'beta') adapter.sendKey(ch);
  assert.deepEqual(
    listBody(overlayOf(adapter.lastFrame())!).items.map((i) => i.label),
    ['Fixture: Beta'],
  );
  await app.dispose();
});

test('enter runs the selected command and closes the palette', async () => {
  const { adapter, app, ran } = await makeApp();
  // Drive palette.open directly so we can await the full open->pick->run chain.
  const open = app.commands.run('palette.open');
  for (const ch of 'alpha') adapter.sendKey(ch); // filters to 'Fixture: Alpha'
  adapter.sendKey('enter');
  await open;
  assert.deepEqual(ran, ['fixture.alpha'], 'runs exactly the selected command');
  assert.equal(overlayOf(adapter.lastFrame()), null, 'palette closes after accept');
  await app.dispose();
});

test('escape closes the palette without running anything', async () => {
  const { adapter, app, ran } = await makeApp();
  const tops: string[] = [];
  app.bus.on('focus:changed', (p: { context: string }) => tops.push(p.context));
  const open = app.commands.run('palette.open');
  adapter.sendKey('escape');
  await open;
  assert.deepEqual(ran, []);
  assert.equal(overlayOf(adapter.lastFrame()), null);
  assert.equal(tops.at(-1), 'editor', 'focus returns to the base context');
  await app.dispose();
});
