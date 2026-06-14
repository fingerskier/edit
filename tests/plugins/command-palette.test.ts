// tests/plugins/command-palette.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin, PluginContext } from '../../src/core/plugin-host.ts';
import type { Frame, Widget } from '../../src/core/view.ts';
import keymap from '../../src/plugins/keymap.ts';
import commandPalette, { humanizeId } from '../../src/plugins/command-palette.ts';

// A tiny plugin that registers a few titled commands so the palette has something
// to list/filter, plus a record of which command `accept` actually ran.
function fixturePlugin(ran: string[]): Plugin {
  return {
    name: 'fixture',
    activate(ctx: PluginContext) {
      ctx.subscriptions.push(
        ctx.commands.register('fixture.alpha', () => { ran.push('fixture.alpha'); }, { title: 'Fixture: Alpha' }),
      );
      ctx.subscriptions.push(
        ctx.commands.register('fixture.beta', () => { ran.push('fixture.beta'); }, { title: 'Fixture: Beta' }),
      );
      // An untitled command to prove humanizeId is the fallback label.
      ctx.subscriptions.push(
        ctx.commands.register('zeta.gamma', () => { ran.push('zeta.gamma'); }),
      );
    },
  };
}

function overlayOf(frame: Frame | undefined): Extract<Widget, { kind: 'overlay' }> | null {
  const o = frame?.overlay;
  if (!o) return null;
  assert.equal(o.kind, 'overlay');
  return o as Extract<Widget, { kind: 'overlay' }>;
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
    plugins: [keymap, fixturePlugin(ran), commandPalette],
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

test('ctrl+p opens the overlay and moves focus to "palette"', async () => {
  const { adapter, app } = await makeApp();
  const tops: string[] = [];
  app.bus.on('focus:changed', (p: { context: string }) => tops.push(p.context));

  assert.equal(overlayOf(adapter.lastFrame()), null); // closed initially

  adapter.sendKey('ctrl+p');

  const o = overlayOf(adapter.lastFrame());
  assert.ok(o, 'overlay should be present after ctrl+p');
  assert.equal(o!.title, 'Commands');
  assert.equal(tops.at(-1), 'palette'); // focus pushed to palette
  const body = listBody(o!);
  assert.ok(body.items.length >= 3, 'lists registered commands');
  assert.equal(body.selected, 0);
});

test('typing a printable filters the list (case-insensitive substring on label)', async () => {
  const { adapter } = await makeApp();
  adapter.sendKey('ctrl+p');

  // Type "beta" -> only "Fixture: Beta" remains.
  for (const ch of 'beta') adapter.sendKey(ch);

  const o = overlayOf(adapter.lastFrame())!;
  const body = listBody(o);
  assert.deepEqual(body.items.map((i) => i.label), ['Fixture: Beta']);
  assert.equal(body.selected, 0);
});

test('backspace drops the last filter char and widens the list again', async () => {
  const { adapter } = await makeApp();
  adapter.sendKey('ctrl+p');
  for (const ch of 'beta') adapter.sendKey(ch);
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).items.length, 1);

  adapter.sendKey('backspace'); // "bet"
  adapter.sendKey('backspace'); // "be"
  adapter.sendKey('backspace'); // "b"
  // "b": matches "Fixture: Beta" (has 'b'); "Fixture: Alpha" no; "Zeta: Gamma" no -> 1
  assert.deepEqual(
    listBody(overlayOf(adapter.lastFrame())!).items.map((i) => i.label),
    ['Fixture: Beta'],
  );
  adapter.sendKey('backspace'); // "" -> all commands
  assert.ok(listBody(overlayOf(adapter.lastFrame())!).items.length >= 3);
});

test('up/down move the selection within the filtered list and clamp at the ends', async () => {
  const { adapter } = await makeApp();
  adapter.sendKey('ctrl+p');

  // Filter to the two fixture commands ("fixture") so the list is deterministic.
  for (const ch of 'fixture') adapter.sendKey(ch);
  const body0 = listBody(overlayOf(adapter.lastFrame())!);
  assert.deepEqual(body0.items.map((i) => i.label), ['Fixture: Alpha', 'Fixture: Beta']);
  assert.equal(body0.selected, 0);

  adapter.sendKey('up'); // clamp at top
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).selected, 0);

  adapter.sendKey('down');
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).selected, 1);

  adapter.sendKey('down'); // clamp at bottom
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).selected, 1);

  adapter.sendKey('up');
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).selected, 0);
});

test('enter runs the selected filtered command and closes the palette', async () => {
  const { adapter, ran } = await makeApp();
  adapter.sendKey('ctrl+p');
  for (const ch of 'fixture') adapter.sendKey(ch); // 2 items
  adapter.sendKey('down'); // select "Fixture: Beta"

  adapter.sendKey('enter');

  assert.deepEqual(ran, ['fixture.beta'], 'runs exactly the selected command');
  assert.equal(overlayOf(adapter.lastFrame()), null, 'palette closes after accept');
});

test('enter on an empty filtered list just closes (runs nothing)', async () => {
  const { adapter, ran } = await makeApp();
  adapter.sendKey('ctrl+p');
  for (const ch of 'zzzznomatch') adapter.sendKey(ch);
  assert.equal(listBody(overlayOf(adapter.lastFrame())!).items.length, 0);

  adapter.sendKey('enter');

  assert.deepEqual(ran, [], 'no command run on empty list');
  assert.equal(overlayOf(adapter.lastFrame()), null, 'palette still closes');
});

test('escape closes the palette and returns focus to the base context', async () => {
  const { adapter, app } = await makeApp();
  const tops: string[] = [];
  app.bus.on('focus:changed', (p: { context: string }) => tops.push(p.context));

  adapter.sendKey('ctrl+p');
  assert.ok(overlayOf(adapter.lastFrame()));
  assert.equal(tops.at(-1), 'palette');

  adapter.sendKey('escape');

  assert.equal(overlayOf(adapter.lastFrame()), null, 'overlay null after escape');
  assert.equal(tops.at(-1), 'editor', 'focus popped back to base');
});

test('reopening after close keeps the palette context as the single top entry', async () => {
  const { adapter, app } = await makeApp();
  const tops: string[] = [];
  app.bus.on('focus:changed', (p: { context: string }) => tops.push(p.context));

  adapter.sendKey('ctrl+p'); // open -> push palette
  adapter.sendKey('escape'); // close -> pop to editor
  adapter.sendKey('ctrl+p'); // open again -> push palette

  assert.equal(tops.at(-1), 'palette');
  assert.ok(overlayOf(adapter.lastFrame()));

  // A single escape must fully close (proves we did not double-push the context).
  adapter.sendKey('escape');
  assert.equal(overlayOf(adapter.lastFrame()), null);
  assert.equal(tops.at(-1), 'editor');
});

test('ctrl+p while already open does not double-push the focus context', async () => {
  const { adapter, app } = await makeApp();
  const tops: string[] = [];
  app.bus.on('focus:changed', (p: { context: string }) => tops.push(p.context));

  adapter.sendKey('ctrl+p'); // open
  adapter.sendKey('ctrl+p'); // already open: must NOT push again
  assert.equal(tops.at(-1), 'palette');

  // One escape closes it; if open() had double-pushed, this would leave it open.
  adapter.sendKey('escape');
  assert.equal(overlayOf(adapter.lastFrame()), null);
  assert.equal(tops.at(-1), 'editor');
});
