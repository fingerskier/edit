import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin, PluginContext } from '../../src/core/plugin-host.ts';
import keymap, { isPrintable, type FocusService } from '../../src/plugins/keymap.ts';

// A tiny inline test plugin that captures ctx and the focus service, and lets
// each test register commands + bindings on demand. It records every command
// invocation as `{ id, args }` so assertions can inspect dispatch routing.
interface Probe {
  ctx: PluginContext;
  focus: FocusService;
  calls: Array<{ id: string; args: any }>;
  reg(id: string, handler?: (args: any) => any): void;
  bind(keySpec: string, id: string): void;
}

function probePlugin(): { plugin: Plugin; probe: Probe } {
  const probe: Probe = {
    ctx: null as unknown as PluginContext,
    focus: null as unknown as FocusService,
    calls: [],
    reg(id: string, handler?: (args: any) => any) {
      probe.ctx.subscriptions.push(
        probe.ctx.commands.register(id, (args: any) => {
          probe.calls.push({ id, args });
          return handler ? handler(args) : undefined;
        }),
      );
    },
    bind(keySpec: string, id: string) {
      probe.ctx.subscriptions.push(probe.ctx.keys.bind(keySpec, id));
    },
  };
  const plugin: Plugin = {
    name: 'probe',
    // keymap is loaded first, so the 'focus' service exists by the time probe
    // activates. Reading it here (rather than lazily) is safe given that order.
    activate(ctx) {
      probe.ctx = ctx;
      probe.focus = ctx.services.get<FocusService>('focus');
    },
  };
  return { plugin, probe };
}

async function makeApp() {
  const adapter = new HeadlessAdapter();
  const { plugin, probe } = probePlugin();
  // keymap MUST be first so its service + key listener exist before probe activates.
  const app = await createApp({ adapter, plugins: [keymap, plugin], roots: [] });
  return { app, adapter, probe };
}

// Helper: settle any microtasks/macrotasks so a command's (possibly async)
// rejection reaches keymap's `.catch`. Deterministic — no wall-clock timers.
const settle = () => new Promise<void>((r) => setImmediate(r));

test('isPrintable: single code points >= space are printable; named/empty tokens are not', () => {
  assert.equal(isPrintable('a'), true);
  assert.equal(isPrintable('A'), true);
  assert.equal(isPrintable(' '), true);
  assert.equal(isPrintable('1'), true);
  assert.equal(isPrintable('enter'), false);
  assert.equal(isPrintable('ctrl+s'), false);
  assert.equal(isPrintable('backspace'), false);
  assert.equal(isPrintable(''), false);
  assert.equal(isPrintable('\n'), false); // single code point but below ' '
});

test('focus service is seeded to ["editor"] on activate so the first key sees top()==="editor"', async () => {
  const { probe } = await makeApp();
  assert.deepEqual(probe.focus.stack(), ['editor']);
  assert.equal(probe.focus.top(), 'editor');
});

test('push overlays on top; top() reflects the overlay; stack() is a base-first copy', async () => {
  const { probe } = await makeApp();
  probe.focus.push('palette');
  assert.equal(probe.focus.top(), 'palette');
  assert.deepEqual(probe.focus.stack(), ['editor', 'palette']);
  // stack() returns a copy: mutating it does not corrupt internal state.
  probe.focus.stack().push('hacked');
  assert.deepEqual(probe.focus.stack(), ['editor', 'palette']);
});

test('pop removes the top overlay but NEVER pops the base', async () => {
  const { probe } = await makeApp();
  probe.focus.push('palette');
  probe.focus.pop();
  assert.deepEqual(probe.focus.stack(), ['editor']);
  // popping again must not remove the base
  probe.focus.pop();
  assert.deepEqual(probe.focus.stack(), ['editor']);
  assert.equal(probe.focus.top(), 'editor');
});

test('pop(expected) warns + no-ops on mismatch, pops on match', async () => {
  const { probe } = await makeApp();
  probe.focus.push('palette');
  const warns: any[][] = [];
  const orig = console.warn;
  console.warn = (...a: any[]) => { warns.push(a); };
  try {
    probe.focus.pop('tree'); // mismatch -> warn + no-op
  } finally {
    console.warn = orig;
  }
  assert.equal(warns.length, 1);
  assert.deepEqual(probe.focus.stack(), ['editor', 'palette']);
  // matching expected pops
  probe.focus.pop('palette');
  assert.deepEqual(probe.focus.stack(), ['editor']);
});

test('replace sets the BASE context when no overlay is on top', async () => {
  const { probe } = await makeApp();
  probe.focus.replace('tree');
  assert.deepEqual(probe.focus.stack(), ['tree']);
  assert.equal(probe.focus.top(), 'tree');
});

test('replace is a NO-OP while an overlay is on top (stack.length > 1)', async () => {
  const { probe } = await makeApp();
  probe.focus.push('palette');
  probe.focus.replace('tree'); // overlay present -> no-op, base unchanged
  assert.deepEqual(probe.focus.stack(), ['editor', 'palette']);
  probe.focus.pop();
  // now base is reachable again
  probe.focus.replace('tree');
  assert.deepEqual(probe.focus.stack(), ['tree']);
});

test('focus:changed is emitted with { context: top() } after every change', async () => {
  const { app, probe } = await makeApp();
  const seen: string[] = [];
  app.bus.on('focus:changed', (e: any) => { seen.push(e.context); });
  probe.focus.push('palette');   // -> palette
  probe.focus.replace('x');      // overlay present -> NO-OP, no emit
  probe.focus.pop();             // -> editor
  probe.focus.replace('tree');   // -> tree
  assert.deepEqual(seen, ['palette', 'editor', 'tree']);
});

test('dispatch prefers context:key over global:key', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('ctx.cmd');
  probe.reg('global.cmd');
  probe.bind('editor:enter', 'ctx.cmd');
  probe.bind('global:enter', 'global.cmd');
  adapter.sendKey('enter');
  await settle();
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0].id, 'ctx.cmd');
  assert.deepEqual(probe.calls[0].args, { key: 'enter' });
});

test('dispatch falls back to global:key when no context binding exists', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('global.cmd');
  probe.bind('global:alt+left', 'global.cmd');
  adapter.sendKey('alt+left');
  await settle();
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0].id, 'global.cmd');
  assert.deepEqual(probe.calls[0].args, { key: 'alt+left' });
});

test('printable key with no exact binding falls back to context:<printable> with { key }', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('editor.insertChar');
  probe.bind('editor:<printable>', 'editor.insertChar');
  adapter.sendKey('q');
  await settle();
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0].id, 'editor.insertChar');
  assert.deepEqual(probe.calls[0].args, { key: 'q' });
});

test('an exact context binding for a printable wins over the <printable> fallback', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('exact');
  probe.reg('printable');
  probe.bind('editor:a', 'exact');
  probe.bind('editor:<printable>', 'printable');
  adapter.sendKey('a');
  await settle();
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0].id, 'exact');
});

test('<printable> fallback is NOT used for named (non-printable) keys', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('printable');
  probe.bind('editor:<printable>', 'printable');
  adapter.sendKey('backspace'); // not printable, no exact/global binding
  await settle();
  assert.equal(probe.calls.length, 0);
});

test('unknown key with no matching binding is a no-op (no command run, no throw)', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('editor.insertChar');
  probe.bind('editor:left', 'editor.insertChar');
  assert.doesNotThrow(() => adapter.sendKey('right'));
  await settle();
  assert.equal(probe.calls.length, 0);
});

test('a sync-throwing command does not propagate out of sendKey (.catch handles it)', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('boom', () => { throw new Error('kaboom'); });
  probe.bind('editor:enter', 'boom');
  const errs: any[][] = [];
  const orig = console.error;
  console.error = (...a: any[]) => { errs.push(a); };
  try {
    assert.doesNotThrow(() => adapter.sendKey('enter'));
    await settle(); // let the rejected command promise settle so .catch runs
  } finally {
    console.error = orig;
  }
  assert.equal(probe.calls.length, 1);
  assert.equal(errs.length, 1);
  assert.match(String(errs[0].join(' ')), /\[keymap\] command failed:/);
});

test('an async-rejecting command does not propagate out of sendKey (.catch handles it)', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('boom', async () => { throw new Error('async kaboom'); });
  probe.bind('editor:enter', 'boom');
  const errs: any[][] = [];
  const orig = console.error;
  console.error = (...a: any[]) => { errs.push(a); };
  try {
    assert.doesNotThrow(() => adapter.sendKey('enter'));
    await settle();
  } finally {
    console.error = orig;
  }
  assert.equal(probe.calls.length, 1);
  assert.equal(errs.length, 1);
  assert.match(String(errs[0].join(' ')), /\[keymap\] command failed:/);
});

test('dispatch reflects the live focus context (push then key routes to overlay)', async () => {
  const { adapter, probe } = await makeApp();
  probe.reg('palette.up');
  probe.reg('editor.up');
  probe.bind('palette:up', 'palette.up');
  probe.bind('editor:up', 'editor.up');
  probe.focus.push('palette');
  adapter.sendKey('up');
  await settle();
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0].id, 'palette.up');
});

test('after dispose, keymap key listener is removed from the bus (subscriptions drained)', async () => {
  const { app, probe } = await makeApp();
  probe.reg('editor.insertChar');
  probe.bind('editor:<printable>', 'editor.insertChar');
  await app.dispose();
  // Emit straight onto the bus (the adapter handler is also gone after dispose):
  // this proves the keymap's own 'key' listener was removed, not just the adapter.
  assert.doesNotThrow(() => app.bus.emit('key', { key: 'z' }));
  await settle();
  assert.equal(probe.calls.length, 0);
});
