# Default Plugins (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the six default plugins (keymap, editor-view, directory-list, command-palette, history, save) on top of the Phase 1 core, plus the small core extensions they require, so `createApp` with the default plugin set is a usable single-pane editor driven entirely through the public plugin API.

**Architecture:** All features are plugins authored against `PluginContext`. The keymap plugin owns a focus-stack service and is the sole `key` listener, dispatching context-namespaced keybindings to commands. Editing flows through `ctx.workspace`; views are abstract `ViewModel`s composed into slots. Core extensions add command metadata, keybinding enumeration/removal, and a `Disposable`/`ctx.subscriptions` cleanup contract.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥20, `node:test` + `node:assert` via `tsx`. No runtime dependencies.

**Shared contracts:** This plan implements the contracts in `docs/superpowers/plans/phase2-contracts.md` — command ids, keySpecs, event names, the dispatch protocol, the focus service, view shapes, load order, and the universal plugin rules. Read that file before implementing. (One deviation: `Disposable` lives in `src/core/disposable.ts`, not `plugin-host.ts`, to avoid an import cycle.)

---

## File Structure

```
src/core/
  disposable.ts        NEW: Disposable interface
  event-bus.ts         MOD: on() returns Disposable
  view.ts              MOD: ViewRegistry.contribute() returns Disposable
  registries.ts        MOD: CommandRegistry meta/list/disposer; KeybindingRegistry unbind/entries/disposer; ServiceRegistry disposer
  plugin-host.ts       MOD: PluginContext.subscriptions; PluginHost stores ctx and drains subscriptions on deactivate
  app.ts               MOD: ctxFor adds subscriptions; forward view disposer
  index.ts             MOD: export Disposable, CommandMeta; export defaultPlugins
src/plugins/
  keymap.ts            NEW: focus service + sole key dispatcher
  editor-view.ts       NEW: main-slot text editor
  directory-list.ts    NEW: tree-slot directory navigator
  command-palette.ts   NEW: overlay-slot command runner
  history.ts           NEW: per-document undo/redo
  save.ts              NEW: save + optional autosave
  index.ts             NEW: defaultPlugins() in load order
tests/core/            MOD: extend registries/event-bus/view/app tests
tests/plugins/         NEW: one test file per plugin + an end-to-end integration test
```

---

## Task 1: Disposable + disposable EventBus/ViewRegistry

**Files:**
- Create: `src/core/disposable.ts`
- Modify: `src/core/event-bus.ts`
- Modify: `src/core/view.ts`
- Test: `tests/core/disposable.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/disposable.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/core/event-bus.ts';
import { ViewRegistry, ViewComposer, type ViewModel } from '../../src/core/view.ts';

test('EventBus.on returns a disposer that removes the listener', () => {
  const bus = new EventBus();
  let count = 0;
  const sub = bus.on('e', () => { count++; });
  bus.emit('e', undefined);
  sub.dispose();
  bus.emit('e', undefined);
  assert.equal(count, 1);
});

test('ViewRegistry.contribute returns an identity-guarded disposer', () => {
  const reg = new ViewRegistry();
  const a: ViewModel = { kind: 'status', segments: ['a'] };
  const b: ViewModel = { kind: 'status', segments: ['b'] };
  const subA = reg.contribute('status', () => a);
  const subB = reg.contribute('status', () => b); // overwrites slot (last-writer-wins)
  subA.dispose(); // must NOT remove b's provider
  assert.deepEqual(new ViewComposer(reg).compose().status, b);
  subB.dispose(); // removes b
  assert.equal('status' in new ViewComposer(reg).compose(), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/disposable.test.ts`
Expected: FAIL — `sub.dispose is not a function` / `contribute` returns void.

- [ ] **Step 3: Create the Disposable interface**

Create `src/core/disposable.ts`:

```ts
export interface Disposable {
  dispose(): void;
}
```

- [ ] **Step 4: Make EventBus.on return a Disposable**

In `src/core/event-bus.ts`, add the import at the top and change `on` to return a disposer:

```ts
import type { Disposable } from './disposable.js';

export type Listener = (payload: any) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): Disposable {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
    return { dispose: () => this.off(event, fn) };
  }
  // off() and emit() are unchanged.
```

(Leave the existing `off` and `emit` methods exactly as they are.)

- [ ] **Step 5: Make ViewRegistry.contribute return an identity-guarded Disposable**

In `src/core/view.ts`, add the import and change `contribute`:

```ts
import type { Disposable } from './disposable.js';
```

```ts
  contribute(slot: Slot, provider: ViewProvider): Disposable {
    this.providers.set(slot, provider);
    return {
      dispose: () => {
        if (this.providers.get(slot) === provider) this.providers.delete(slot);
      },
    };
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --import tsx --test tests/core/disposable.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the existing view/event-bus tests (backward compat)**

Run: `node --import tsx --test tests/core/view.test.ts tests/core/event-bus.test.ts`
Expected: PASS (all existing tests still green — returning a value from `on`/`contribute` does not break callers that ignore it).

- [ ] **Step 8: Commit**

```bash
git add src/core/disposable.ts src/core/event-bus.ts src/core/view.ts tests/core/disposable.test.ts
git commit -m "feat(core): Disposable interface; disposable EventBus.on and ViewRegistry.contribute"
```

---

## Task 2: CommandRegistry metadata, list, and disposer

**Files:**
- Modify: `src/core/registries.ts`
- Test: `tests/core/registries.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/core/registries.test.ts`:

```ts
import { CommandRegistry as CR2 } from '../../src/core/registries.ts';

test('register accepts optional metadata and list() returns id + title', () => {
  const reg = new CR2();
  reg.register('editor.save', () => {}, { title: 'Save File' });
  reg.register('editor.quit', () => {}); // no meta
  const list = reg.list().sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(list, [
    { id: 'editor.quit' },
    { id: 'editor.save', title: 'Save File' },
  ]);
});

test('register returns an identity-guarded disposer', async () => {
  const reg = new CR2();
  const sub = reg.register('a', () => 1);
  reg.register('a', () => 2); // overwrites
  sub.dispose(); // must NOT remove the newer handler
  assert.equal(await reg.run('a', undefined), 2);
});

test('run reads the stored handler and still throws on unknown id', async () => {
  const reg = new CR2();
  reg.register('x', (n: number) => n + 1);
  assert.equal(await reg.run('x', 41), 42);
  await assert.rejects(() => reg.run('nope', undefined), /unknown command: nope/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/registries.test.ts`
Expected: FAIL — `list` is not a function / meta not stored.

- [ ] **Step 3: Rewrite CommandRegistry**

In `src/core/registries.ts`, add the import at the top:

```ts
import type { Disposable } from './disposable.js';
```

Replace the entire `CommandRegistry` class (and its `CommandHandler` type) with:

```ts
export type CommandHandler = (args: any) => any | Promise<any>;

export interface CommandMeta {
  title?: string;
}

interface CommandEntry {
  handler: CommandHandler;
  meta: CommandMeta;
}

export class CommandRegistry {
  private commands = new Map<string, CommandEntry>();

  register(id: string, handler: CommandHandler, meta: CommandMeta = {}): Disposable {
    const entry: CommandEntry = { handler, meta };
    this.commands.set(id, entry);
    return {
      dispose: () => {
        if (this.commands.get(id) === entry) this.commands.delete(id);
      },
    };
  }

  ids(): string[] {
    return [...this.commands.keys()];
  }

  list(): Array<{ id: string } & CommandMeta> {
    return [...this.commands.entries()].map(([id, entry]) => ({ id, ...entry.meta }));
  }

  async run(id: string, args?: any): Promise<any> {
    const entry = this.commands.get(id);
    if (!entry) throw new Error(`unknown command: ${id}`);
    return await entry.handler(args);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/core/registries.test.ts`
Expected: PASS (existing CommandRegistry tests + 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/core/registries.ts tests/core/registries.test.ts
git commit -m "feat(core): command metadata, list(), and identity-guarded register disposer"
```

---

## Task 3: Keybinding & Service registry — disposers, unbind, entries

**Files:**
- Modify: `src/core/registries.ts`
- Test: `tests/core/registries.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/core/registries.test.ts`:

```ts
import { KeybindingRegistry as KR2, ServiceRegistry as SR2 } from '../../src/core/registries.ts';

test('keybindings: unbind removes a binding and entries lists all pairs', () => {
  const keys = new KR2();
  keys.bind('ctrl+s', 'file.save');
  keys.bind('ctrl+p', 'palette.open');
  assert.deepEqual(keys.entries().sort(), [['ctrl+p', 'palette.open'], ['ctrl+s', 'file.save']]);
  keys.unbind('ctrl+s');
  assert.equal(keys.resolve('ctrl+s'), undefined);
});

test('keybindings: bind returns an identity-guarded disposer', () => {
  const keys = new KR2();
  const sub = keys.bind('ctrl+s', 'file.save');
  keys.bind('ctrl+s', 'file.saveAll'); // override
  sub.dispose(); // must NOT remove the override
  assert.equal(keys.resolve('ctrl+s'), 'file.saveAll');
});

test('services: register returns an identity-guarded disposer', () => {
  const services = new SR2();
  const sub = services.register('focus', { v: 1 });
  services.register('focus', { v: 2 }); // overwrite
  sub.dispose(); // must NOT remove the newer service
  assert.deepEqual(services.get('focus'), { v: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/registries.test.ts`
Expected: FAIL — `unbind`/`entries` not functions; `bind`/`register` return void.

- [ ] **Step 3: Update KeybindingRegistry and ServiceRegistry**

In `src/core/registries.ts`, replace the entire `KeybindingRegistry` class with:

```ts
export class KeybindingRegistry {
  private bindings = new Map<string, string>();

  bind(keySpec: string, commandId: string): Disposable {
    this.bindings.set(keySpec, commandId);
    return {
      dispose: () => {
        if (this.bindings.get(keySpec) === commandId) this.bindings.delete(keySpec);
      },
    };
  }

  resolve(keySpec: string): string | undefined {
    return this.bindings.get(keySpec);
  }

  unbind(keySpec: string): void {
    this.bindings.delete(keySpec);
  }

  entries(): Array<[string, string]> {
    return [...this.bindings.entries()];
  }
}
```

Replace the entire `ServiceRegistry` class with:

```ts
export class ServiceRegistry {
  private services = new Map<string, unknown>();

  register(name: string, impl: unknown): Disposable {
    this.services.set(name, impl);
    return {
      dispose: () => {
        if (this.services.get(name) === impl) this.services.delete(name);
      },
    };
  }

  get<T>(name: string): T {
    if (!this.services.has(name)) throw new Error(`unknown service: ${name}`);
    return this.services.get(name) as T;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/core/registries.test.ts`
Expected: PASS (existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/registries.ts tests/core/registries.test.ts
git commit -m "feat(core): keybinding unbind/entries and identity-guarded bind/service disposers"
```

---

## Task 4: PluginContext.subscriptions + host draining + wiring

**Files:**
- Modify: `src/core/plugin-host.ts`
- Modify: `src/core/app.ts`
- Modify: `src/core/index.ts` (i.e. `src/index.ts`)
- Test: `tests/core/app.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/core/app.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/app.test.ts`
Expected: FAIL — `ctx.subscriptions` is undefined.

- [ ] **Step 3: Add subscriptions to PluginContext and drain in the host**

In `src/core/plugin-host.ts`, add the import and the `subscriptions` field, and rewrite `PluginHost`:

```ts
import type { Disposable } from './disposable.js';
```

Add to the `PluginContext` interface (after `services`):

```ts
  services: ServiceRegistry;
  subscriptions: Disposable[];
```

Replace the entire `PluginHost` class with:

```ts
export class PluginHost {
  private active: { plugin: Plugin; ctx: PluginContext }[] = [];

  constructor(private ctxFor: (plugin: Plugin) => PluginContext) {}

  async activateAll(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      const ctx = this.ctxFor(plugin);
      await plugin.activate(ctx);
      this.active.push({ plugin, ctx });
    }
  }

  async deactivateAll(): Promise<void> {
    for (const { plugin, ctx } of [...this.active].reverse()) {
      try {
        await plugin.deactivate?.();
      } catch (err) {
        console.error(`[PluginHost] ${plugin.name} deactivate threw:`, err);
      }
      for (const sub of [...ctx.subscriptions].reverse()) {
        try {
          sub.dispose();
        } catch (err) {
          console.error(`[PluginHost] ${plugin.name} subscription dispose threw:`, err);
        }
      }
    }
    this.active = [];
  }
}
```

- [ ] **Step 4: Add a fresh subscriptions array in app.ts ctxFor**

In `src/core/app.ts`, inside the object returned by `ctxFor`, add `subscriptions: []` (the `view.contribute` already forwards the `ViewRegistry` disposer, so no other change is needed there):

```ts
  const ctxFor = (plugin: Plugin): PluginContext => ({
    commands,
    keys,
    view: {
      contribute: (slot, provider) => views.contribute(slot, provider),
      invalidate: render,
    },
    events: bus,
    workspace,
    fs,
    config: config[plugin.name] ?? {},
    services,
    subscriptions: [],
  });
```

- [ ] **Step 5: Export Disposable and CommandMeta from the public surface**

In `src/index.ts`, add:

```ts
export { type Disposable } from './core/disposable.js';
```

and add `CommandMeta` to the existing registries export so the line reads:

```ts
export {
  CommandRegistry, KeybindingRegistry, ServiceRegistry, type CommandHandler, type CommandMeta,
} from './core/registries.js';
```

- [ ] **Step 6: Run tests + full build**

Run: `node --import tsx --test tests/core/app.test.ts`
Expected: PASS (existing app tests + 2 new ones).

Run: `npm test && npm run build`
Expected: all suites pass; `tsc` exits 0 and emits `dist/`.

- [ ] **Step 7: Commit**

```bash
git add src/core/plugin-host.ts src/core/app.ts src/index.ts tests/core/app.test.ts
git commit -m "feat(core): ctx.subscriptions with host-drained disposal; export Disposable/CommandMeta"
```

---

## Task 5: keymap plugin
**Files:**
- Create: `src/plugins/keymap.ts`
- Test: `tests/plugins/keymap.test.ts`

The keymap plugin loads FIRST (per contract §F). It provides the `focus` service (§B), emits `focus:changed` after any focus change, and registers the SOLE `key` listener that implements the dispatch protocol (§C). It exports the `FocusService` TS interface and the `isPrintable` helper for other plugins/tests. It does not touch `ctx.workspace`, so the "no-op when no active document" rule (§G) does not apply here.

- [ ] **Step 1: Write the failing test** (complete test file, real assertions, drives behavior through createApp + HeadlessAdapter)
```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node --import tsx --test tests/plugins/keymap.test.ts` — Expected: FAIL (module not found: `src/plugins/keymap.ts` does not exist)

- [ ] **Step 3: Write the implementation** (complete src file)
```ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';

// The contract for input ownership: a stack of contexts, base first. The top of
// the stack owns keyboard input. `replace` swaps the BASE context (panel focus);
// `push`/`pop` manage transient overlays (e.g. the command palette).
export interface FocusService {
  push(context: string): void;        // overlays push on top
  pop(expected?: string): void;       // warn+no-op if top() !== expected; never pops the base (index 0)
  replace(context: string): void;     // sets the BASE context (index 0); NO-OP while an overlay is on top
  top(): string;                      // current context that owns input
  stack(): string[];                  // copy of the stack, base first
}

// A key token is "printable" when it is a single Unicode code point at or above
// the space character. Named keys/chords arrive as multi-char tokens ('enter',
// 'ctrl+s', ...) and are therefore not printable. Control chars (e.g. '\n') are
// single code points but below ' ', so they are not printable either.
export function isPrintable(key: string): boolean {
  return [...key].length === 1 && key >= ' ';
}

const keymap: Plugin = {
  name: 'keymap',

  activate(ctx: PluginContext): void {
    const { commands, keys, events, services, subscriptions } = ctx;

    // Seed synchronously so the very first key sees top() === 'editor'.
    const stack: string[] = ['editor'];

    const emitChanged = (): void => {
      events.emit('focus:changed', { context: stack[stack.length - 1] });
    };

    const focus: FocusService = {
      push(context: string): void {
        stack.push(context);
        emitChanged();
      },
      pop(expected?: string): void {
        if (stack.length <= 1) return; // never pop the base
        if (expected !== undefined && stack[stack.length - 1] !== expected) {
          console.warn(
            `[keymap] focus.pop expected "${expected}" but top is "${stack[stack.length - 1]}"; ignoring`,
          );
          return;
        }
        stack.pop();
        emitChanged();
      },
      replace(context: string): void {
        if (stack.length > 1) return; // overlay on top: replacing the base is a no-op
        stack[0] = context;
        emitChanged();
      },
      top(): string {
        return stack[stack.length - 1];
      },
      stack(): string[] {
        return [...stack];
      },
    };

    subscriptions.push(services.register('focus', focus));

    // The ONE key listener. Resolution order: context:key, then global:key, then
    // (printables only) context:<printable>. The command receives { key }. A
    // failing command (sync throw or async rejection) is caught here and logged
    // so it never escapes the synchronous sendKey/emit path.
    subscriptions.push(
      events.on('key', (e: { key: string }) => {
        const key = e.key;
        const context = focus.top();
        const id =
          keys.resolve(`${context}:${key}`) ??
          keys.resolve(`global:${key}`) ??
          (isPrintable(key) ? keys.resolve(`${context}:<printable>`) : undefined);
        if (id) {
          commands
            .run(id, { key })
            .catch((err) => console.error('[keymap] command failed:', id, err));
        }
      }),
    );
  },
};

export default keymap;
```

- [ ] **Step 4: Run test to verify it passes** — Run: `node --import tsx --test tests/plugins/keymap.test.ts` — Expected: PASS (18 tests)

- [ ] **Step 5: Commit** — `git add src/plugins/keymap.ts tests/plugins/keymap.test.ts && git commit -m "feat(plugins): keymap"`

---

## Task 6: editor-view plugin
**Files:**
- Create: `src/plugins/editor-view.ts`
- Test: `tests/plugins/editor-view.test.ts`

- [ ] **Step 1: Write the failing test** (complete test file)
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp, type App } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import keymap, { type FocusService } from '../../src/plugins/keymap.ts';
import editorView, {
  lineStarts,
  offsetToLineCol,
  lineColToOffset,
} from '../../src/plugins/editor-view.ts';
import type { Plugin, PluginContext } from '../../src/core/plugin-host.ts';

// A tiny inspector plugin so the test can reach the live FocusService instance
// (the App surface does not expose ctx.services). Activated AFTER keymap, so the
// 'focus' service is already registered.
function focusProbe(): { plugin: Plugin; focus: () => FocusService } {
  let svc: FocusService | null = null;
  const plugin: Plugin = {
    name: 'test-focus-probe',
    activate(ctx: PluginContext): void {
      svc = ctx.services.get<FocusService>('focus');
    },
  };
  return {
    plugin,
    focus: () => {
      if (!svc) throw new Error('focus service not captured');
      return svc;
    },
  };
}

interface Setup {
  adapter: HeadlessAdapter;
  app: App;
  focus: () => FocusService;
}

async function setup(initial = '', opts: { open?: boolean } = {}): Promise<Setup> {
  const adapter = new HeadlessAdapter();
  const probe = focusProbe();
  const app = await createApp({
    adapter,
    // keymap MUST be first (seeds 'focus' service + sole 'key' listener).
    plugins: [keymap, editorView, probe.plugin],
    roots: [],
  });
  if (opts.open !== false) app.workspace.openScratch(initial);
  app.render();
  return { adapter, app, focus: probe.focus };
}

function main(adapter: HeadlessAdapter): { kind: 'text'; lines: string[]; cursors: number[] } {
  const frame = adapter.lastFrame();
  assert.ok(frame, 'expected a rendered frame');
  const w = frame!.main;
  assert.ok(w && w.kind === 'text', 'expected a text widget in slot "main"');
  const tw = w as { kind: 'text'; lines: string[]; cursors?: number[] };
  return { kind: 'text', lines: tw.lines, cursors: tw.cursors ?? [] };
}

// --- pure line-index helpers ---

test('lineStarts handles empty buffer, trailing newline, and agrees with split', () => {
  assert.deepEqual(lineStarts(''), [0]);
  assert.deepEqual(''.split('\n'), ['']);
  assert.equal(lineStarts('').length, ''.split('\n').length);

  assert.deepEqual(lineStarts('abc'), [0]);
  assert.deepEqual(lineStarts('a\nb'), [0, 2]);
  assert.deepEqual(lineStarts('a\n'), [0, 2]);
  assert.deepEqual('a\n'.split('\n'), ['a', '']);
  assert.equal(lineStarts('a\n').length, 'a\n'.split('\n').length);

  const text = 'abcd\nx\nefgh';
  const starts = lineStarts(text);
  assert.equal(starts.length, text.split('\n').length);
  assert.deepEqual(starts, [0, 5, 7]);
});

test('offsetToLineCol and lineColToOffset round-trip (UTF-16 columns)', () => {
  const text = 'abcd\nx\nefgh';
  assert.deepEqual(offsetToLineCol(text, 0), { line: 0, col: 0 });
  assert.deepEqual(offsetToLineCol(text, 3), { line: 0, col: 3 });
  assert.deepEqual(offsetToLineCol(text, 5), { line: 1, col: 0 });
  assert.deepEqual(offsetToLineCol(text, 6), { line: 1, col: 1 });
  assert.deepEqual(offsetToLineCol(text, 10), { line: 2, col: 3 });
  // clamps an out-of-range offset
  assert.deepEqual(offsetToLineCol(text, 999), { line: 2, col: 4 });

  assert.equal(lineColToOffset(text, 0, 3), 3);
  assert.equal(lineColToOffset(text, 1, 1), 6);
  assert.equal(lineColToOffset(text, 2, 3), 10);
  // clamps a too-large column to the line length
  assert.equal(lineColToOffset(text, 1, 9), 6);
  // clamps an out-of-range line
  assert.equal(lineColToOffset(text, 99, 0), 7);
});

// --- view provider ---

test('main slot renders empty buffer as one blank line with caret at 0', async () => {
  const { adapter } = await setup('');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['']);
  assert.deepEqual(w.cursors, [0]);
});

test('main slot renders [""] / [0] when there is no active document', async () => {
  const { adapter } = await setup('', { open: false });
  const w = main(adapter);
  assert.deepEqual(w.lines, ['']);
  assert.deepEqual(w.cursors, [0]);
});

test('main slot splits multi-line text and reports the caret offset', async () => {
  const { adapter, app } = await setup('ab\ncd');
  app.workspace.setSelection({ anchor: 4, head: 4 });
  const w = main(adapter);
  assert.deepEqual(w.lines, ['ab', 'cd']);
  assert.deepEqual(w.cursors, [4]);
});

// --- typing ---

test('typing printable chars inserts text and advances the caret', async () => {
  const { adapter, app } = await setup('');
  adapter.sendKey('h');
  adapter.sendKey('i');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['hi']);
  assert.deepEqual(w.cursors, [2]);
  assert.equal(app.workspace.activeDocument!.text(), 'hi');
  assert.equal(app.workspace.activeDocument!.selection.head, 2);
});

// --- backspace / delete ---

test('backspace removes the char before the caret', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 2, head: 2 });
  adapter.sendKey('backspace');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['a']);
  assert.deepEqual(w.cursors, [1]);
  assert.equal(app.workspace.activeDocument!.text(), 'a');
});

test('backspace at offset 0 is a no-op', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 0, head: 0 });
  adapter.sendKey('backspace');
  assert.equal(app.workspace.activeDocument!.text(), 'ab');
  assert.equal(app.workspace.activeDocument!.selection.head, 0);
});

test('delete removes the char at the caret', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 0, head: 0 });
  adapter.sendKey('delete');
  const w = main(adapter);
  assert.deepEqual(w.lines, ['b']);
  assert.deepEqual(w.cursors, [0]);
  assert.equal(app.workspace.activeDocument!.text(), 'b');
});

test('delete at end of buffer is a no-op', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 2, head: 2 });
  adapter.sendKey('delete');
  assert.equal(app.workspace.activeDocument!.text(), 'ab');
  assert.equal(app.workspace.activeDocument!.selection.head, 2);
});

// --- horizontal movement ---

test('left / right move the caret one offset and clamp at the ends', async () => {
  const { adapter, app } = await setup('ab');
  app.workspace.setSelection({ anchor: 1, head: 1 });

  adapter.sendKey('left');
  assert.equal(main(adapter).cursors[0], 0);
  adapter.sendKey('left'); // clamp at start
  assert.equal(main(adapter).cursors[0], 0);

  adapter.sendKey('right');
  assert.equal(main(adapter).cursors[0], 1);
  adapter.sendKey('right');
  assert.equal(main(adapter).cursors[0], 2);
  adapter.sendKey('right'); // clamp at end
  assert.equal(main(adapter).cursors[0], 2);
  void app;
});

// --- vertical movement with a sticky goal column ---

test('up / down preserve the goal column across a short line', async () => {
  const { adapter, app } = await setup('abcd\nx\nefgh');
  // line 0, col 3 -> offset 3
  app.workspace.setSelection({ anchor: 3, head: 3 });

  adapter.sendKey('down'); // line 1 is "x" (len 1) -> clamp to col 1 -> offset 6
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('down'); // line 2 "efgh" -> goal col 3 restored -> offset 10
  assert.equal(main(adapter).cursors[0], 10);

  adapter.sendKey('up'); // back to line 1 short -> offset 6
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('up'); // back to line 0 -> goal col 3 -> offset 3
  assert.equal(main(adapter).cursors[0], 3);
  void app;
});

test('a horizontal move resets the goal column', async () => {
  const { adapter, app } = await setup('abcd\nx\nefgh');
  app.workspace.setSelection({ anchor: 3, head: 3 });

  adapter.sendKey('down'); // -> offset 6 (col clamped to 1), goal col was 3
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('left'); // resets goal col; now caret at offset 5 (col 0)
  assert.equal(main(adapter).cursors[0], 5);

  adapter.sendKey('down'); // new goal col = 0 -> line 2 col 0 -> offset 7
  assert.equal(main(adapter).cursors[0], 7);
  void app;
});

test('typing resets the goal column', async () => {
  const { adapter, app } = await setup('abcd\nx\nefgh');
  app.workspace.setSelection({ anchor: 3, head: 3 });

  adapter.sendKey('down'); // offset 6, goal col 3 captured
  assert.equal(main(adapter).cursors[0], 6);

  adapter.sendKey('z'); // insert at offset 6 -> "x" line becomes "xz"; caret 7; goal reset
  assert.equal(app.workspace.activeDocument!.text(), 'abcd\nxz\nefgh');
  assert.equal(main(adapter).cursors[0], 7); // line 1 col 2

  adapter.sendKey('down'); // new goal col = 2 -> line 2 "efgh" col 2 -> offset 10
  assert.equal(main(adapter).cursors[0], 10);
  void app;
});

test('up at the first line and down at the last line clamp within the line', async () => {
  const { adapter, app } = await setup('abcd\nefgh');
  app.workspace.setSelection({ anchor: 2, head: 2 }); // line 0 col 2

  adapter.sendKey('up'); // already first line -> goal col 2 -> stays offset 2
  assert.equal(main(adapter).cursors[0], 2);

  // collapse goal with an explicit horizontal move before the next vertical test
  adapter.sendKey('right'); // resets goal, caret offset 3
  app.workspace.setSelection({ anchor: 7, head: 7 }); // line 1 col 2 (goal still reset/null)
  adapter.sendKey('down'); // already last line -> goal col 2 -> stays offset 7
  assert.equal(main(adapter).cursors[0], 7);
});

// --- home / end ---

test('home / end move to the start and end of the current line', async () => {
  const { adapter, app } = await setup('abcd\nefgh');
  app.workspace.setSelection({ anchor: 7, head: 7 }); // line 1 col 2

  adapter.sendKey('home');
  assert.equal(main(adapter).cursors[0], 5); // start of line 1

  adapter.sendKey('end');
  assert.equal(main(adapter).cursors[0], 9); // end of "efgh"
  void app;
});

// --- focus ---

test('editor.focus command and global:alt+right binding are registered', async () => {
  const { app } = await setup('hi');
  assert.ok(app.commands.ids().includes('editor.focus'));
  assert.equal(app.keys.resolve('global:alt+right'), 'editor.focus');
});

test('alt+right (and editor.focus) set the base focus context to editor', async () => {
  const { adapter, app, focus } = await setup('hi');
  const svc = focus();

  // Drive an overlay on top, then confirm replace() is a no-op while overlaid,
  // and becomes the base once popped -> deterministic, observable behavior.
  svc.push('palette');
  assert.equal(svc.top(), 'palette');

  adapter.sendKey('alt+right'); // editor.focus -> replace('editor'); NO-OP under overlay
  assert.equal(svc.top(), 'palette');
  assert.deepEqual(svc.stack(), ['editor', 'palette']);

  svc.pop('palette');
  assert.equal(svc.top(), 'editor');

  // run the command directly to exercise the handler path too
  await app.commands.run('editor.focus', {});
  assert.equal(svc.top(), 'editor');
  assert.deepEqual(svc.stack(), ['editor']);
});

// --- commands no-op without an active document ---

test('editor commands no-op (do not throw) when there is no active document', async () => {
  const { adapter, app } = await setup('', { open: false });
  // none of these should throw, and the rendered frame stays the empty default
  for (const key of ['x', 'backspace', 'delete', 'left', 'right', 'up', 'down', 'home', 'end']) {
    adapter.sendKey(key);
  }
  const w = main(adapter);
  assert.deepEqual(w.lines, ['']);
  assert.deepEqual(w.cursors, [0]);
  assert.equal(app.workspace.activeDocument, null);

  // direct invocation must also be a no-op (not throw) with no active doc
  await app.commands.run('editor.insertChar', { key: 'q' });
  await app.commands.run('editor.moveDown', {});
  assert.equal(app.workspace.activeDocument, null);
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node --import tsx --test tests/plugins/editor-view.test.ts` — Expected: FAIL (module not found: `../../src/plugins/editor-view.ts`)

- [ ] **Step 3: Write the implementation** (complete src file)
```ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { Disposable } from '../core/disposable.js';
import type { ViewModel } from '../core/view.js';
import type { FocusService } from './keymap.js';

// --- plugin-local line index (UTF-16 columns) ---

/**
 * Offsets at which each rendered line begins. Always has exactly one entry per
 * element of `text.split('\n')`: `[0]` for the empty buffer, and the index just
 * after every '\n' (so a trailing newline yields a final empty line). This keeps
 * the index in lock-step with the `lines` array used for rendering.
 */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  const starts = lineStarts(text);
  const o = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  // last line whose start is <= o
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= o) line = i;
    else break;
  }
  return { line, col: o - starts[line] };
}

export function lineColToOffset(text: string, line: number, col: number): number {
  const starts = lineStarts(text);
  const lines = text.split('\n');
  const l = Math.max(0, Math.min(starts.length - 1, line));
  const lineLen = lines[l].length;
  const c = Math.max(0, Math.min(lineLen, col));
  return starts[l] + c;
}

const editorView: Plugin = {
  name: 'editor-view',

  activate(ctx: PluginContext): void {
    const { commands, keys, view, events, workspace, subscriptions } = ctx;

    // The sticky goal column for vertical movement. Only moveUp/moveDown read or
    // write it; every other caret-moving command (and document:activated) resets
    // it to null. We do NOT reset it on 'selection:moved' (that fires during our
    // own vertical moves and would erase the goal we just set).
    let goalCol: number | null = null;

    // --- view provider for slot 'main' ---
    const viewDisposable: Disposable = view.contribute('main', (): ViewModel => {
      const doc = workspace.activeDocument;
      if (!doc) return { kind: 'text', lines: [''], cursors: [0] };
      const text = doc.text();
      return { kind: 'text', lines: text.split('\n'), cursors: [doc.selection.head] };
    });

    // --- command handlers (all no-op when there is no active document) ---

    const insertChar = (args: { key?: string }): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const key = args?.key ?? '';
      if (key === '') return;
      const head = doc.selection.head;
      // document.apply maps the selection through the edit, so the caret advances.
      workspace.applyEdit({ start: head, end: head, text: key });
    };

    const backspace = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const head = doc.selection.head;
      if (head <= 0) return;
      workspace.applyEdit({ start: head - 1, end: head, text: '' });
    };

    const del = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const head = doc.selection.head;
      if (head >= doc.text().length) return;
      workspace.applyEdit({ start: head, end: head + 1, text: '' });
    };

    const moveTo = (offset: number): void => {
      workspace.setSelection({ anchor: offset, head: offset });
    };

    const moveLeft = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      moveTo(Math.max(0, doc.selection.head - 1));
    };

    const moveRight = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      moveTo(Math.min(doc.text().length, doc.selection.head + 1));
    };

    const verticalMove = (dir: -1 | 1): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      const text = doc.text();
      const { line, col } = offsetToLineCol(text, doc.selection.head);
      // Capture the goal column on the first vertical move, then keep consuming it.
      if (goalCol === null) goalCol = col;
      const lineCount = lineStarts(text).length;
      const target = Math.max(0, Math.min(lineCount - 1, line + dir));
      moveTo(lineColToOffset(text, target, goalCol));
    };

    const moveUp = (): void => verticalMove(-1);
    const moveDown = (): void => verticalMove(1);

    const moveHome = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const text = doc.text();
      const { line } = offsetToLineCol(text, doc.selection.head);
      moveTo(lineColToOffset(text, line, 0));
    };

    const moveEnd = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const text = doc.text();
      const lines = text.split('\n');
      const { line } = offsetToLineCol(text, doc.selection.head);
      moveTo(lineColToOffset(text, line, lines[line].length));
    };

    const focusEditor = (): void => {
      ctx.services.get<FocusService>('focus').replace('editor');
    };

    // --- register commands ---
    subscriptions.push(
      commands.register('editor.insertChar', insertChar, { title: 'Editor: Insert Character' }),
      commands.register('editor.backspace', backspace, { title: 'Editor: Backspace' }),
      commands.register('editor.delete', del, { title: 'Editor: Delete' }),
      commands.register('editor.moveLeft', moveLeft, { title: 'Editor: Move Left' }),
      commands.register('editor.moveRight', moveRight, { title: 'Editor: Move Right' }),
      commands.register('editor.moveUp', moveUp, { title: 'Editor: Move Up' }),
      commands.register('editor.moveDown', moveDown, { title: 'Editor: Move Down' }),
      commands.register('editor.moveHome', moveHome, { title: 'Editor: Move to Line Start' }),
      commands.register('editor.moveEnd', moveEnd, { title: 'Editor: Move to Line End' }),
      commands.register('editor.focus', focusEditor, { title: 'Focus Editor' }),
    );

    // --- key bindings ---
    subscriptions.push(
      keys.bind('editor:<printable>', 'editor.insertChar'),
      keys.bind('editor:backspace', 'editor.backspace'),
      keys.bind('editor:delete', 'editor.delete'),
      keys.bind('editor:left', 'editor.moveLeft'),
      keys.bind('editor:right', 'editor.moveRight'),
      keys.bind('editor:up', 'editor.moveUp'),
      keys.bind('editor:down', 'editor.moveDown'),
      keys.bind('editor:home', 'editor.moveHome'),
      keys.bind('editor:end', 'editor.moveEnd'),
      keys.bind('global:alt+right', 'editor.focus'),
    );

    // --- view registration + re-render / goal-column reset ---
    subscriptions.push(
      viewDisposable,
      events.on('document:changed', () => view.invalidate()),
      events.on('selection:moved', () => view.invalidate()),
      events.on('document:activated', () => {
        goalCol = null;
        view.invalidate();
      }),
    );
  },
};

export default editorView;
```

- [ ] **Step 4: Run test to verify it passes** — Run: `node --import tsx --test tests/plugins/editor-view.test.ts` — Expected: PASS (19 tests)

- [ ] **Step 5: Commit** — `git add src/plugins/editor-view.ts tests/plugins/editor-view.test.ts && git commit -m "feat(plugins): editor-view"`

---

## Task 7: directory-list plugin

**Files:**
- Create: `src/plugins/directory-list.ts`
- Test: `tests/plugins/directory-list.test.ts`

This plugin owns slot `tree`. It lists the first workspace root (`ctx.workspace.roots[0]`) on activate via `await ctx.fs.list(root)`, keeps `{ entries, selected }` in closure state, contributes a `{ kind: 'list' }` view, registers `tree.up` / `tree.down` / `tree.open` / `tree.focus`, binds `tree:up` / `tree:down` / `tree:enter` / `global:alt+left`, and re-lists on `fs:changed`. Every disposer goes into `ctx.subscriptions`.

Notes baked into the design (per contract):
- Command ids + titles + keySpecs match contract §D exactly: `tree.up`/"Tree: Up"/`tree:up`, `tree.down`/"Tree: Down"/`tree:down`, `tree.open`/"Tree: Open Selection"/`tree:enter`, `tree.focus`/"Focus Directory Tree"/`global:alt+left`.
- View shape matches contract §E for slot `tree`: `{ kind: 'list', items: ListItem[], selected: number }`.
- `tree.open` no-ops when the selected entry is a directory (M1), when there are no entries, and when there is no root. It only calls `ctx.workspace.openFile(...)` for files, then reads the focus service **lazily inside the handler** (`ctx.services.get('focus')`, contract §F) and calls `.replace('editor')`. This satisfies the "no-op when there is no active document" rule (§G) because the command never touches `requireActive()`.
- `tree.up` / `tree.down` clamp at the ends and call `ctx.view.invalidate()`.
- Re-list ordering: `fs:changed` triggers an async re-list. We guard staleness with a monotonic in-flight token: only the newest re-list commits its result + invalidates; older in-flight re-lists are discarded so a stale snapshot can't clobber a fresher one (M1 staleness guard).
- **`relist()` is fully error-isolated.** `ctx.fs.list` can reject (e.g., a late OS-watcher `fs:changed` arrives after the test's `rm()` has removed the temp dir). The handler does `void relist()`, so an unguarded rejection would become an unhandled promise rejection and fail the test run. `relist()` therefore wraps `ctx.fs.list` in `try/catch` and discards errors (and never invalidates on failure). This is the single most important correctness fix vs. a naive implementation.
- The `selected` index is clamped into the new entries length after every re-list so it never points past the end.
- If there are no roots, `entries` stays `[]` and the view renders an empty list (`{ kind: 'list', items: [], selected: 0 }`); the `tree` provider is still contributed.
- `fs.list` already returns entries sorted by name (`localeCompare`), so the rendered listing is sorted without extra work; a test asserts this explicitly.

Test wiring: a real keymap (assumed already implemented in `src/plugins/keymap.ts`, providing the `focus` service + the sole `key` listener) plus directory-list go through `createApp` + `HeadlessAdapter`, against a **real temp dir** created with `node:fs/promises`. The test reads frames off the local `adapter` variable (the `App` type does not expose the adapter) and reads the focus service via a probe plugin appended after directory-list (the `App` type does not expose `services`). For the refresh test we drive `fs:changed` by **emitting it manually on `app.bus`** and poll the view until it reflects the new entry; this removes any dependence on OS-watcher timing. Note: `createApp` always wires the real `Watcher` for every root, so the OS watcher is *also* live and may emit its own `fs:changed`; our token guard + error-isolated `relist()` make that harmless, and the manual emit guarantees the test is deterministic regardless of OS-watcher timing.

- [ ] **Step 1: Write the failing test** (complete test file)
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import keymap, { type FocusService } from '../../src/plugins/keymap.ts';
import directoryList from '../../src/plugins/directory-list.ts';
import type { Plugin } from '../../src/core/plugin-host.ts';
import type { Widget } from '../../src/core/view.ts';

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dirlist-'));
}

function treeWidget(adapter: HeadlessAdapter): Extract<Widget, { kind: 'list' }> {
  const w = adapter.lastFrame()?.tree;
  assert.ok(w, 'expected a tree widget in the last frame');
  assert.equal(w.kind, 'list');
  return w as Extract<Widget, { kind: 'list' }>;
}

async function until(fn: () => boolean, label: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`condition never became true: ${label}`);
}

test('directory-list renders the root listing sorted', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'beta.txt'), 'b');
    await writeFile(join(dir, 'alpha.txt'), 'a');
    await mkdir(join(dir, 'subdir'));

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    const w = treeWidget(adapter);
    assert.deepEqual(
      w.items.map((it) => it.label),
      ['alpha.txt', 'beta.txt', 'subdir/'],
    );
    assert.equal(w.selected, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('directory-list renders an empty list when there are no roots', async () => {
  const adapter = new HeadlessAdapter();
  const app = await createApp({
    adapter,
    plugins: [keymap, directoryList],
    roots: [],
  });

  const w = treeWidget(adapter);
  assert.deepEqual(w.items, []);
  assert.equal(w.selected, 0);

  await app.dispose();
});

test('tree.down moves selection and clamps at the end; tree.up clamps at the top', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.txt'), 'a');
    await writeFile(join(dir, 'b.txt'), 'b');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.equal(treeWidget(adapter).selected, 0);

    await app.commands.run('tree.down');
    assert.equal(treeWidget(adapter).selected, 1);

    // clamp at the bottom (2 entries -> max index 1)
    await app.commands.run('tree.down');
    assert.equal(treeWidget(adapter).selected, 1);

    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 0);

    // clamp at the top
    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.up / tree.down are no-ops when the listing is empty', async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.deepEqual(treeWidget(adapter).items, []);
    await app.commands.run('tree.down');
    await app.commands.run('tree.up');
    assert.equal(treeWidget(adapter).selected, 0);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on a file opens it as the active document', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'note.txt'), 'hello');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.equal(app.workspace.activeDocument, null);

    await app.commands.run('tree.open');

    const doc = app.workspace.activeDocument;
    assert.ok(doc, 'expected an active document after tree.open');
    assert.equal(doc.path, join(dir, 'note.txt'));
    assert.equal(doc.text(), 'hello');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on a file moves the focus context to "editor"', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'note.txt'), 'hi');

    const adapter = new HeadlessAdapter();
    // Probe plugin AFTER directory-list reads the focus service (App type does
    // not expose ctx.services).
    let focus!: FocusService;
    const probe: Plugin = {
      name: 'probe',
      activate(ctx) { focus = ctx.services.get<FocusService>('focus'); },
    };
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList, probe],
      roots: [dir],
    });

    // tree.focus first so the base context is 'tree', proving open flips it.
    await app.commands.run('tree.focus');
    assert.equal(focus.top(), 'tree');

    await app.commands.run('tree.open');
    assert.equal(focus.top(), 'editor');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open on a directory is a no-op for M1 (no document opened)', async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, 'subdir'));

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    const w = treeWidget(adapter);
    assert.deepEqual(w.items.map((it) => it.label), ['subdir/']);

    await app.commands.run('tree.open');
    assert.equal(app.workspace.activeDocument, null);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.open is a no-op (does not throw) when there are no entries', async () => {
  const dir = await makeTempDir();
  try {
    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.deepEqual(treeWidget(adapter).items, []);
    await app.commands.run('tree.open');
    assert.equal(app.workspace.activeDocument, null);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tree.focus sets the focus context to "tree"', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.txt'), 'a');

    const adapter = new HeadlessAdapter();
    let focus!: FocusService;
    const probe: Plugin = {
      name: 'probe',
      activate(ctx) { focus = ctx.services.get<FocusService>('focus'); },
    };
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList, probe],
      roots: [dir],
    });

    assert.equal(focus.top(), 'editor');
    await app.commands.run('tree.focus');
    assert.equal(focus.top(), 'tree');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('directory-list contributes the documented keybindings', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'a.txt'), 'a');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.equal(app.keys.resolve('global:alt+left'), 'tree.focus');
    assert.equal(app.keys.resolve('tree:up'), 'tree.up');
    assert.equal(app.keys.resolve('tree:down'), 'tree.down');
    assert.equal(app.keys.resolve('tree:enter'), 'tree.open');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fs:changed triggers a re-list so the listing grows', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'one.txt'), '1');

    const adapter = new HeadlessAdapter();
    const app = await createApp({
      adapter,
      plugins: [keymap, directoryList],
      roots: [dir],
    });

    assert.deepEqual(
      treeWidget(adapter).items.map((it) => it.label),
      ['one.txt'],
    );

    // Add a file on disk, then emit fs:changed manually for deterministic timing.
    // (The real Watcher is also live and may fire its own fs:changed; the token
    //  guard + error-isolated relist make that harmless. The manual emit is what
    //  makes this test deterministic.)
    await writeFile(join(dir, 'two.txt'), '2');
    app.bus.emit('fs:changed', { dir, filename: 'two.txt', eventType: 'rename' });

    // The re-list is async; await until the view reflects the new entry.
    await until(
      () => treeWidget(adapter).items.length === 2,
      'tree list should grow to 2 after fs:changed',
    );

    assert.deepEqual(
      treeWidget(adapter).items.map((it) => it.label),
      ['one.txt', 'two.txt'],
    );

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node --import tsx --test tests/plugins/directory-list.test.ts` — Expected: FAIL (module not found: `../../src/plugins/directory-list.ts`)

- [ ] **Step 3: Write the implementation** (complete src file)
```ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { DirEntry } from '../core/file-system.js';
import type { ViewModel } from '../core/view.js';
import type { FocusService } from './keymap.js';
import { join } from 'node:path';

const directoryList: Plugin = {
  name: 'directory-list',
  async activate(ctx: PluginContext): Promise<void> {
    const root: string | undefined = ctx.workspace.roots[0];

    let entries: DirEntry[] = [];
    let selected = 0;

    // Monotonic token: only the newest re-list may commit its result. Older
    // in-flight re-lists (started before a newer fs:changed) are discarded so a
    // stale snapshot can't clobber a fresher one (M1 staleness guard).
    let listToken = 0;

    const clampSelected = (): void => {
      const max = Math.max(0, entries.length - 1);
      selected = Math.min(Math.max(0, selected), max);
    };

    async function relist(): Promise<void> {
      if (!root) {
        entries = [];
        clampSelected();
        ctx.view.invalidate();
        return;
      }
      const token = ++listToken;
      let next: DirEntry[];
      try {
        next = await ctx.fs.list(root);
      } catch {
        // Error-isolated: a late fs:changed may fire after the directory is gone
        // (e.g. removed by a test's cleanup). Never throw out of `void relist()`
        // and never commit a partial/failed snapshot.
        return;
      }
      if (token !== listToken) return; // a newer re-list superseded us
      entries = next;
      clampSelected();
      ctx.view.invalidate();
    }

    // Initial listing (await so the first frame already reflects the root).
    await relist();

    // View provider for the 'tree' slot (contributed even when there are no roots).
    ctx.subscriptions.push(
      ctx.view.contribute('tree', (): ViewModel => ({
        kind: 'list',
        items: entries.map((e) => ({ label: e.isDir ? e.name + '/' : e.name })),
        selected,
      })),
    );

    // tree.up / tree.down: move selection, clamp, invalidate. No-op when empty.
    ctx.subscriptions.push(
      ctx.commands.register('tree.up', () => {
        if (entries.length === 0) return;
        selected = Math.max(0, selected - 1);
        ctx.view.invalidate();
      }, { title: 'Tree: Up' }),
    );
    ctx.subscriptions.push(
      ctx.commands.register('tree.down', () => {
        if (entries.length === 0) return;
        selected = Math.min(entries.length - 1, selected + 1);
        ctx.view.invalidate();
      }, { title: 'Tree: Down' }),
    );

    // tree.open: open the selected file (dirs / empty are no-ops in M1), then
    // focus the editor. Focus service is read lazily inside the handler (§F).
    ctx.subscriptions.push(
      ctx.commands.register('tree.open', async () => {
        if (!root) return;
        const entry = entries[selected];
        if (!entry || entry.isDir) return; // dir / empty -> ignore for M1
        await ctx.workspace.openFile(join(root, entry.name));
        ctx.services.get<FocusService>('focus').replace('editor');
      }, { title: 'Tree: Open Selection' }),
    );

    // tree.focus: make the tree own input.
    ctx.subscriptions.push(
      ctx.commands.register('tree.focus', () => {
        ctx.services.get<FocusService>('focus').replace('tree');
      }, { title: 'Focus Directory Tree' }),
    );

    // Keybindings (contract §D).
    ctx.subscriptions.push(ctx.keys.bind('tree:up', 'tree.up'));
    ctx.subscriptions.push(ctx.keys.bind('tree:down', 'tree.down'));
    ctx.subscriptions.push(ctx.keys.bind('tree:enter', 'tree.open'));
    ctx.subscriptions.push(ctx.keys.bind('global:alt+left', 'tree.focus'));

    // Re-list on any fs change. M1: re-list the root regardless of which dir
    // changed; relist()'s token guard handles concurrent/stale re-lists and its
    // try/catch keeps the `void` call from producing an unhandled rejection.
    ctx.subscriptions.push(
      ctx.events.on('fs:changed', () => { void relist(); }),
    );
  },
};

export default directoryList;
```

- [ ] **Step 4: Run test to verify it passes** — Run: `node --import tsx --test tests/plugins/directory-list.test.ts` — Expected: PASS (11 tests)

- [ ] **Step 5: Commit** — `git add src/plugins/directory-list.ts tests/plugins/directory-list.test.ts && git commit -m "feat(plugins): directory-list"`

---

## Task 8: command-palette plugin
**Files:**
- Create: `src/plugins/command-palette.ts`
- Test: `tests/plugins/command-palette.test.ts`

This plugin contributes a searchable command palette in the `overlay` slot. It depends on the
`keymap` plugin being loaded first (per contract §F) so the `focus` service and the sole `key`
listener exist. The palette pushes the `'palette'` focus context while open, so keymap routes keys
against `palette:*` keySpecs; on close it pops back to the base context (`'editor'`). The focus
service is resolved lazily inside handlers via `ctx.services.get('focus')` to avoid activation-order
coupling. None of the palette commands touch the active document, so the "no-op when
`activeDocument` is null" rule does not apply here. Tests observe focus through the public
`app.bus.on('focus:changed', ...)` event (the `App` interface exposes `bus` and `commands` but not
`services`), which is the supported way to watch focus from outside a plugin.

- [ ] **Step 1: Write the failing test** (complete test file, real assertions, drives behavior through `createApp` + `HeadlessAdapter`)

```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node --import tsx --test tests/plugins/command-palette.test.ts` — Expected: FAIL (module not found: `src/plugins/command-palette.ts` does not exist yet)

- [ ] **Step 3: Write the implementation** (complete src file)

```ts
// src/plugins/command-palette.ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { Widget } from '../core/view.js';
import type { FocusService } from './keymap.js';

const FOCUS_CONTEXT = 'palette';

/**
 * Turn a dotted command id into a human label.
 *   humanizeId('editor.insertChar') === 'Editor: Insert Char'
 * Each dot-separated segment is split on camelCase / Pascal boundaries and on
 * whitespace/underscore/hyphen, each word is Title-cased, words join with ' ',
 * then segments join with ': '.
 */
export function humanizeId(id: string): string {
  return id
    .split('.')
    .map((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[\s_-]+/)
        .filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    )
    .join(': ');
}

interface PaletteItem { id: string; label: string }

const plugin: Plugin = {
  name: 'command-palette',
  activate(ctx: PluginContext) {
    const state = { open: false, filter: '', selected: 0 };

    // Resolve the focus service lazily inside handlers (keymap loads first, §F),
    // never at activate time, to avoid activation-order coupling.
    const focus = (): FocusService => ctx.services.get<FocusService>('focus');

    // Candidate commands, excluding the palette's own commands so the user can't
    // recursively open/close the palette from within it.
    const candidates = (): PaletteItem[] =>
      ctx.commands
        .list()
        .filter((c) => !c.id.startsWith('palette.'))
        .map((c) => ({ id: c.id, label: c.title || humanizeId(c.id) }));

    const filtered = (): PaletteItem[] => {
      const needle = state.filter.toLowerCase();
      if (needle === '') return candidates();
      return candidates().filter((c) => c.label.toLowerCase().includes(needle));
    };

    const clampSelected = () => {
      const len = filtered().length;
      if (len === 0) { state.selected = 0; return; }
      state.selected = Math.max(0, Math.min(len - 1, state.selected));
    };

    // --- view provider (slot 'overlay') -----------------------------------
    ctx.subscriptions.push(
      ctx.view.contribute('overlay', (): Widget | null => {
        if (!state.open) return null;
        const items = filtered().map((c) => ({ label: c.label }));
        return {
          kind: 'overlay',
          title: 'Commands',
          body: { kind: 'list', items, selected: state.selected },
        };
      }),
    );

    // --- commands ---------------------------------------------------------
    ctx.subscriptions.push(
      ctx.commands.register('palette.open', () => {
        // Reset the query/selection every time. Only push the focus context when
        // we are actually transitioning from closed -> open, so repeated ctrl+p
        // never stacks 'palette' on the focus stack (which would wedge close).
        const wasOpen = state.open;
        state.open = true;
        state.filter = '';
        state.selected = 0;
        if (!wasOpen) focus().push(FOCUS_CONTEXT);
        ctx.view.invalidate();
      }, { title: 'Command Palette' }),
    );

    // Idempotent close: never wedges the focus stack. Only pop when the palette
    // context is actually on top.
    const close = () => {
      const wasOpen = state.open;
      state.open = false;
      if (wasOpen) {
        const f = focus();
        if (f.top() === FOCUS_CONTEXT) f.pop(FOCUS_CONTEXT);
        ctx.view.invalidate();
      }
    };

    ctx.subscriptions.push(
      ctx.commands.register('palette.close', () => { close(); }, { title: 'Palette: Close' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.accept', async () => {
        if (!state.open) return;
        clampSelected();
        const chosen = filtered()[state.selected];
        close();
        if (chosen) {
          await ctx.commands.run(chosen.id, {});
        }
      }, { title: 'Palette: Run Selected' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.up', () => {
        if (!state.open) return;
        state.selected = Math.max(0, state.selected - 1);
        clampSelected();
        ctx.view.invalidate();
      }, { title: 'Palette: Previous' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.down', () => {
        if (!state.open) return;
        const len = filtered().length;
        state.selected = Math.min(Math.max(0, len - 1), state.selected + 1);
        clampSelected();
        ctx.view.invalidate();
      }, { title: 'Palette: Next' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.filterChar', (args: { key?: string }) => {
        if (!state.open) return;
        const key = args?.key ?? '';
        if (key === '') return;
        state.filter += key;
        state.selected = 0;
        ctx.view.invalidate();
      }, { title: 'Palette: Filter' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.backspace', () => {
        if (!state.open) return;
        if (state.filter.length > 0) {
          state.filter = state.filter.slice(0, -1);
          state.selected = 0;
          ctx.view.invalidate();
        }
      }, { title: 'Palette: Delete Filter Char' }),
    );

    // --- keybindings ------------------------------------------------------
    ctx.subscriptions.push(ctx.keys.bind('global:ctrl+p', 'palette.open'));
    ctx.subscriptions.push(ctx.keys.bind('palette:escape', 'palette.close'));
    ctx.subscriptions.push(ctx.keys.bind('palette:enter', 'palette.accept'));
    ctx.subscriptions.push(ctx.keys.bind('palette:up', 'palette.up'));
    ctx.subscriptions.push(ctx.keys.bind('palette:down', 'palette.down'));
    ctx.subscriptions.push(ctx.keys.bind('palette:<printable>', 'palette.filterChar'));
    ctx.subscriptions.push(ctx.keys.bind('palette:backspace', 'palette.backspace'));
  },
};

export default plugin;
```

- [ ] **Step 4: Run test to verify it passes** — Run: `node --import tsx --test tests/plugins/command-palette.test.ts` — Expected: PASS (10 tests)

- [ ] **Step 5: Commit** — `git add src/plugins/command-palette.ts tests/plugins/command-palette.test.ts && git commit -m "feat(plugins): command-palette"`

---

## Task 9: history plugin

The history plugin provides per-document undo/redo. It listens to `document:changed` and records inverse edits onto a per-`docId` undo stack (clearing redo on any fresh edit), guards re-entrant replay with an `isApplying` flag, drops a doc's stacks on `document:closed`, and registers `history.undo`/`history.redo` (bound to `editor:ctrl+z`/`editor:ctrl+y`). It operates only on the active document and pushes every disposer into `ctx.subscriptions`.

**Selection approximation (documented):** `document:changed` fires *after* the edit, so the true pre-edit selection is not in the payload. We approximate `selBefore` as a collapsed caret at `inverse.start` (the offset where the edit began — for a plain single-caret insert/delete this is exactly where the caret was) and `selAfter` as the changed document's current selection at event time (already mapped through the edit by `Document.apply`, see `mapSelectionThroughEdit`). We read the changed doc via `ctx.workspace.getDocument(docId)` (not `activeDocument`) so recording is keyed strictly to the document the event names. This round-trips correctly for common single-caret insert/delete cases: undo restores the caret to the edit site, redo restores it to the post-edit position. We store **clones** of the selection objects (not live references) so later edits to `doc.selection` cannot mutate recorded entries.

**Files:**
- Create: `src/plugins/history.ts`
- Test: `tests/plugins/history.test.ts`

- [ ] **Step 1: Write the failing test** (complete test file)
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import keymap from '../../src/plugins/keymap.ts';
import editorView from '../../src/plugins/editor-view.ts';
import history from '../../src/plugins/history.ts';

async function makeApp() {
  const adapter = new HeadlessAdapter();
  const app = await createApp({
    adapter,
    plugins: [keymap, editorView, history],
    roots: [],
  });
  return { app, adapter };
}

// Drives an edit through the SAME real path editor-view uses: workspace.applyEdit
// emits 'document:changed' { docId, op, inverse }, which history records. We insert
// at the current caret so the inserted-at offset matches a real "type at caret".
function typeChar(app: Awaited<ReturnType<typeof makeApp>>['app'], ch: string) {
  const doc = app.workspace.activeDocument!;
  const at = doc.selection.head;
  app.workspace.applyEdit({ start: at, end: at, text: ch });
}

test('undo removes the last edit, redo re-applies it', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b');
  assert.equal(doc.text(), 'ab');

  await app.commands.run('history.undo');
  assert.equal(doc.text(), 'a');

  await app.commands.run('history.undo');
  assert.equal(doc.text(), '');

  await app.commands.run('history.redo');
  assert.equal(doc.text(), 'a');

  await app.commands.run('history.redo');
  assert.equal(doc.text(), 'ab');

  await app.dispose();
});

test('undo with empty stack / no active doc is a no-op (does not throw)', async () => {
  const { app } = await makeApp();
  // No active document yet.
  assert.equal(app.workspace.activeDocument, null);
  await app.commands.run('history.undo'); // must not throw
  await app.commands.run('history.redo'); // must not throw

  const doc = app.workspace.openScratch('');
  // Active doc, but nothing recorded -> still a no-op.
  await app.commands.run('history.undo');
  await app.commands.run('history.redo');
  assert.equal(doc.text(), '');

  await app.dispose();
});

test('a fresh edit after undo clears the redo stack', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b');
  assert.equal(doc.text(), 'ab');

  await app.commands.run('history.undo'); // -> 'a', redo now holds the 'b' entry
  assert.equal(doc.text(), 'a');

  typeChar(app, 'c'); // fresh edit must clear redo
  assert.equal(doc.text(), 'ac');

  await app.commands.run('history.redo'); // redo was cleared -> no-op
  assert.equal(doc.text(), 'ac');

  await app.dispose();
});

test('re-entrancy: undo replay does not grow the undo stack', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b'); // undo stack depth = 2

  // First undo pops one entry (depth 1) and replays the inverse via applyEdit.
  // If the replay were recorded, the stack would grow back to >=2 and the second
  // undo would NOT empty the document.
  await app.commands.run('history.undo');
  assert.equal(doc.text(), 'a');

  await app.commands.run('history.undo');
  assert.equal(doc.text(), '', 'second undo emptied the doc -> replay was not recorded');

  // A third undo must be a clean no-op (stack truly empty).
  await app.commands.run('history.undo');
  assert.equal(doc.text(), '');

  await app.dispose();
});

test('redo replay does not corrupt the stacks (round-trips repeatedly)', async () => {
  const { app } = await makeApp();
  const doc = app.workspace.openScratch('');

  typeChar(app, 'a');
  typeChar(app, 'b');

  for (let i = 0; i < 3; i++) {
    await app.commands.run('history.undo');
    await app.commands.run('history.undo');
    assert.equal(doc.text(), '');
    await app.commands.run('history.redo');
    await app.commands.run('history.redo');
    assert.equal(doc.text(), 'ab');
  }

  await app.dispose();
});

test('multi-doc: edits in doc A do not affect doc B undo stack', async () => {
  const { app } = await makeApp();

  const a = app.workspace.openScratch(''); // A active
  typeChar(app, 'a'); // recorded on A

  const b = app.workspace.openScratch(''); // B now active
  typeChar(app, 'b'); // recorded on B

  // Undo with B active only touches B.
  await app.commands.run('history.undo');
  assert.equal(b.text(), '');
  assert.equal(a.text(), 'a', "A untouched by B's undo");

  // A further undo with B active is a no-op (B's stack empty); A keeps its edit.
  await app.commands.run('history.undo');
  assert.equal(b.text(), '');
  assert.equal(a.text(), 'a');

  // Switch to A and undo -> only A is affected.
  app.workspace.setActive(a.id);
  await app.commands.run('history.undo');
  assert.equal(a.text(), '');
  assert.equal(b.text(), '');

  await app.dispose();
});

test('document:closed drops that doc stacks (no leak / no cross-talk after reuse)', async () => {
  const { app } = await makeApp();

  const a = app.workspace.openScratch('');
  typeChar(app, 'a'); // A has one undo entry
  app.workspace.closeDocument(a.id); // drops A's stacks; no docs left -> activeDocument null
  assert.equal(app.workspace.activeDocument, null);

  // A fresh doc, fresh stack. Undo before any edit is a clean no-op.
  const c = app.workspace.openScratch('');
  await app.commands.run('history.undo');
  assert.equal(c.text(), '');

  typeChar(app, 'z');
  await app.commands.run('history.undo');
  assert.equal(c.text(), '');

  await app.dispose();
});

test('binds editor:ctrl+z -> history.undo and editor:ctrl+y -> history.redo', async () => {
  const { app } = await makeApp();
  assert.equal(app.keys.resolve('editor:ctrl+z'), 'history.undo');
  assert.equal(app.keys.resolve('editor:ctrl+y'), 'history.redo');
  await app.dispose();
});

test('subscriptions are drained on dispose (commands unregistered)', async () => {
  const { app } = await makeApp();
  assert.ok(app.commands.list().some((c) => c.id === 'history.undo'));
  assert.ok(app.commands.list().some((c) => c.id === 'history.redo'));
  await app.dispose();
  assert.ok(!app.commands.list().some((c) => c.id === 'history.undo'));
  assert.ok(!app.commands.list().some((c) => c.id === 'history.redo'));
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node --import tsx --test tests/plugins/history.test.ts` — Expected: FAIL (module not found: `../../src/plugins/history.ts`)

- [ ] **Step 3: Write the implementation** (complete src file)
```ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { EditOp } from '../core/buffer.js';
import type { Selection } from '../core/document.js';

interface HistoryEntry {
  op: EditOp;            // the original (forward) edit; re-applied on redo
  inverse: EditOp;       // undoes op; applied on undo
  selBefore: Selection;  // caret to restore after undo
  selAfter: Selection;   // caret to restore after redo
}

interface DocStacks {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

const history: Plugin = {
  name: 'history',

  activate(ctx: PluginContext): void {
    // docId -> { undo, redo }
    const stacks = new Map<string, DocStacks>();
    // Re-entrancy guard: true while WE are replaying an edit via applyEdit, so the
    // 'document:changed' that replay emits is ignored by the recording listener.
    let isApplying = false;

    const stacksFor = (docId: string): DocStacks => {
      let s = stacks.get(docId);
      if (!s) { s = { undo: [], redo: [] }; stacks.set(docId, s); }
      return s;
    };

    const clone = (sel: Selection): Selection => ({ anchor: sel.anchor, head: sel.head });
    const collapsed = (offset: number): Selection => ({ anchor: offset, head: offset });

    // Record real (user-driven) edits. Ignore our own replays via isApplying.
    const recDisp = ctx.events.on('document:changed', (payload: any) => {
      if (isApplying) return;
      try {
        const docId: string | undefined = payload?.docId;
        const op: EditOp | undefined = payload?.op;
        const inverse: EditOp | undefined = payload?.inverse;
        if (!docId || !op || !inverse) return;

        // selAfter: the changed doc's current selection (already mapped through the
        // edit by Document.apply). Keyed by docId, not activeDocument, so recording
        // tracks exactly the document named by the event.
        const doc = ctx.workspace.getDocument(docId);
        const selAfter: Selection = doc ? clone(doc.selection) : collapsed(inverse.end);
        // selBefore (approx): collapsed caret at the edit start (inverse.start).
        // Exact for single-caret insert/delete performed at the caret.
        const selBefore: Selection = collapsed(inverse.start);

        const s = stacksFor(docId);
        s.undo.push({ op, inverse, selBefore, selAfter });
        s.redo.length = 0; // any fresh edit invalidates redo
      } catch (err) {
        console.error('[history] failed to record edit:', err);
      }
    });
    ctx.subscriptions.push(recDisp);

    // Drop stacks for a closed document.
    const closeDisp = ctx.events.on('document:closed', (payload: any) => {
      const docId: string | undefined = payload?.docId;
      if (docId) stacks.delete(docId);
    });
    ctx.subscriptions.push(closeDisp);

    const undoDisp = ctx.commands.register('history.undo', () => {
      const doc = ctx.workspace.activeDocument;
      if (!doc) return; // no active document -> no-op
      const s = stacks.get(doc.id);
      if (!s || s.undo.length === 0) return; // nothing to undo -> no-op
      const entry = s.undo.pop()!;
      isApplying = true;
      try {
        ctx.workspace.applyEdit(entry.inverse);
        ctx.workspace.setSelection(clone(entry.selBefore));
      } finally {
        isApplying = false;
      }
      s.redo.push(entry);
      ctx.view.invalidate();
    }, { title: 'Undo' });
    ctx.subscriptions.push(undoDisp);

    const redoDisp = ctx.commands.register('history.redo', () => {
      const doc = ctx.workspace.activeDocument;
      if (!doc) return; // no active document -> no-op
      const s = stacks.get(doc.id);
      if (!s || s.redo.length === 0) return; // nothing to redo -> no-op
      const entry = s.redo.pop()!;
      isApplying = true;
      try {
        ctx.workspace.applyEdit(entry.op);
        ctx.workspace.setSelection(clone(entry.selAfter));
      } finally {
        isApplying = false;
      }
      s.undo.push(entry);
      ctx.view.invalidate();
    }, { title: 'Redo' });
    ctx.subscriptions.push(redoDisp);

    ctx.subscriptions.push(ctx.keys.bind('editor:ctrl+z', 'history.undo'));
    ctx.subscriptions.push(ctx.keys.bind('editor:ctrl+y', 'history.redo'));
  },
};

export default history;
```

- [ ] **Step 4: Run test to verify it passes** — Run: `node --import tsx --test tests/plugins/history.test.ts` — Expected: PASS (9 tests)

- [ ] **Step 5: Commit** — `git add src/plugins/history.ts tests/plugins/history.test.ts && git commit -m "feat(plugins): history"`

---

## Task 10: save plugin
**Files:**
- Create: `src/plugins/save.ts`
- Test: `tests/plugins/save.test.ts`

The `save` plugin owns the `file.save` command (bound to `editor:ctrl+s`) and an optional autosave timer driven by `ctx.config.autosaveMs`. `ctx.config` is the per-plugin slice (`config['save']` from `createApp`), so `autosaveMs` is supplied via `config: { save: { autosaveMs: N } }`. `file.save` must no-op when there is no active document or the active document's `path` is `null` (scratch) — note `ctx.workspace.save()` itself throws on a scratch doc, so the guard is mandatory — otherwise `await ctx.workspace.save()`. All disposers (command register, keybinding, autosave interval) are pushed into `ctx.subscriptions`; no `deactivate()` is needed (the host drains subscriptions in reverse, per contract §A/§G).

**Autosave test approach (chosen):** deterministic `node:test` mock timers (`t.mock.timers.enable({ apis: ['setInterval'] })`; the paired `clearInterval` is auto-mocked, so `app.dispose()` is safe). The interval callback runs `file.save`, an async chain that ends in a real `fs.writeFile`. A single `setImmediate` flush is NOT a reliable barrier for a real disk write, so instead of guessing at microtask timing we subscribe to the `document:saved` event (emitted by `Workspace.save()` AFTER `fs.write` + `markClean()`) and `await` that. This makes the timer-driven save fully deterministic. For the "no timer" case there is nothing to await, so we tick the fake clock and assert the file on disk is unchanged.

- [ ] **Step 1: Write the failing test** (complete test file)
```ts
// tests/plugins/save.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Plugin, PluginContext } from '../../src/core/plugin-host.ts';
import keymap from '../../src/plugins/keymap.ts';
import save from '../../src/plugins/save.ts';

// Tiny setup plugin: opens a real temp file as the active document so that
// ctx.workspace.activeDocument is a doc with a non-null path.
function openFilePlugin(path: string): Plugin {
  return {
    name: 'test-open-file',
    async activate(ctx: PluginContext) {
      await ctx.workspace.openFile(path);
    },
  };
}

// Tiny setup plugin: opens a scratch (path === null) active document.
const openScratchPlugin: Plugin = {
  name: 'test-open-scratch',
  activate(ctx: PluginContext) {
    ctx.workspace.openScratch('scratch body');
  },
};

async function makeTempFile(initial: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'save-plugin-'));
  const path = join(dir, 'note.txt');
  await writeFile(path, initial, 'utf8');
  return { dir, path };
}

test('file.save writes the active document to disk and clears dirty', async () => {
  const { dir, path } = await makeTempFile('hello');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
    });

    const doc = app.workspace.activeDocument!;
    assert.equal(doc.path, path);
    assert.equal(doc.dirty, false);

    // Edit through the workspace, then save via the command.
    app.workspace.applyEdit({ start: 5, end: 5, text: ' world' });
    assert.equal(doc.dirty, true);
    assert.equal(doc.text(), 'hello world');

    await app.commands.run('file.save');

    assert.equal(await readFile(path, 'utf8'), 'hello world');
    assert.equal(doc.dirty, false);

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('editor:ctrl+s is bound to file.save', async () => {
  const { dir, path } = await makeTempFile('x');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
    });

    assert.equal(app.keys.resolve('editor:ctrl+s'), 'file.save');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file.save is a no-op when the active document is a scratch (path === null)', async () => {
  const app = await createApp({
    adapter: new HeadlessAdapter(),
    plugins: [keymap, save, openScratchPlugin],
    roots: [],
  });

  const doc = app.workspace.activeDocument!;
  assert.equal(doc.path, null);

  // Make it dirty; save must NOT throw and must NOT clear dirty (no path to write).
  app.workspace.applyEdit({ start: 0, end: 0, text: '!' });
  assert.equal(doc.dirty, true);

  await assert.doesNotReject(app.commands.run('file.save'));
  assert.equal(doc.dirty, true);

  await app.dispose();
});

test('file.save is a no-op when there is no active document', async () => {
  const app = await createApp({
    adapter: new HeadlessAdapter(),
    plugins: [keymap, save],
    roots: [],
  });

  assert.equal(app.workspace.activeDocument, null);
  await assert.doesNotReject(app.commands.run('file.save'));

  await app.dispose();
});

test('autosave (config.autosaveMs > 0) writes to disk on a timer tick', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { dir, path } = await makeTempFile('start');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
      config: { save: { autosaveMs: 1000 } },
    });

    // Arm a deterministic barrier: resolve once Workspace.save() has emitted
    // 'document:saved' (it does so AFTER fs.write + markClean), so we never race
    // a real disk write against a guessed number of microtask flushes.
    const saved = new Promise<void>((resolve) => {
      const sub = app.bus.on('document:saved', () => {
        sub.dispose();
        resolve();
      });
    });

    // Dirty the doc, then advance the fake clock past one interval.
    app.workspace.applyEdit({ start: 5, end: 5, text: '-edited' });
    assert.equal(await readFile(path, 'utf8'), 'start');

    t.mock.timers.tick(1000);
    await saved;

    assert.equal(await readFile(path, 'utf8'), 'start-edited');
    assert.equal(app.workspace.activeDocument!.dirty, false);

    await app.dispose();
  } finally {
    t.mock.timers.reset();
    await rm(dir, { recursive: true, force: true });
  }
});

test('no autosave timer when autosaveMs is unset/0 (a tick writes nothing)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { dir, path } = await makeTempFile('untouched');
  try {
    const app = await createApp({
      adapter: new HeadlessAdapter(),
      plugins: [keymap, save, openFilePlugin(path)],
      roots: [dir],
      // no config.save.autosaveMs
    });

    app.workspace.applyEdit({ start: 0, end: 0, text: 'X' });

    // No interval was registered, so ticking schedules no save callback.
    t.mock.timers.tick(1_000_000);
    await new Promise((resolve) => setImmediate(resolve));

    // File on disk is unchanged because no autosave fired.
    assert.equal(await readFile(path, 'utf8'), 'untouched');

    await app.dispose();
  } finally {
    t.mock.timers.reset();
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node --import tsx --test tests/plugins/save.test.ts` — Expected: FAIL (module not found: `../../src/plugins/save.ts`)

- [ ] **Step 3: Write the implementation** (complete src file)
```ts
// src/plugins/save.ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';

const save: Plugin = {
  name: 'save',

  activate(ctx: PluginContext): void {
    // file.save: persist the active document. No-op (do NOT throw) when there is
    // no active document or it is a scratch buffer (path === null) with nowhere
    // to write — Workspace.save() itself throws on a path-less doc, so the guard
    // is required. Otherwise delegate to the workspace (writes + markClean()).
    ctx.subscriptions.push(
      ctx.commands.register(
        'file.save',
        async () => {
          const doc = ctx.workspace.activeDocument;
          if (!doc || doc.path === null) return;
          await ctx.workspace.save();
        },
        { title: 'Save File' },
      ),
    );

    ctx.subscriptions.push(ctx.keys.bind('editor:ctrl+s', 'file.save'));

    // Optional autosave. Only arm a timer when autosaveMs is a positive number;
    // each tick just runs the file.save command (which itself no-ops on scratch
    // / no active doc), so autosave is safe regardless of what is focused.
    const autosaveMs = ctx.config.autosaveMs;
    if (typeof autosaveMs === 'number' && autosaveMs > 0) {
      const timer = setInterval(() => {
        void ctx.commands.run('file.save').catch((err) => {
          console.error('[save] autosave failed:', err);
        });
      }, autosaveMs);
      ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
    }
  },
};

export default save;
```

- [ ] **Step 4: Run test to verify it passes** — Run: `node --import tsx --test tests/plugins/save.test.ts` — Expected: PASS (6 tests)

- [ ] **Step 5: Commit** — `git add src/plugins/save.ts tests/plugins/save.test.ts && git commit -m "feat(plugins): save"`

---

## Task 11: defaultPlugins() and end-to-end integration

**Files:**
- Create: `src/plugins/index.ts`
- Modify: `src/index.ts`
- Test: `tests/plugins/integration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/integration.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/core/app.ts';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import { defaultPlugins } from '../../src/plugins/index.ts';

// Settle async command handlers (openFile/save are async) deterministically.
const settle = () => new Promise<void>((r) => setImmediate(r));

function mainText(adapter: HeadlessAdapter): string[] {
  const m = adapter.lastFrame()?.main;
  assert.ok(m && m.kind === 'text', 'main slot should be a text widget');
  return (m as { kind: 'text'; lines: string[] }).lines;
}

test('end-to-end: open from tree, edit, save, undo, open palette', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-e2e-'));
  try {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');
    const adapter = new HeadlessAdapter();
    const app = await createApp({ adapter, plugins: defaultPlugins(), roots: [dir] });

    // The tree lists a.txt (selected index 0). Focus the tree, open the file.
    adapter.sendKey('alt+left'); // global -> tree.focus
    await settle();
    adapter.sendKey('enter');    // tree.open -> workspace.openFile, focus -> editor
    await settle();
    assert.deepEqual(mainText(adapter), ['hello']);

    // Move to end of line and type '!'.
    adapter.sendKey('end');      // editor.moveEnd
    await settle();
    adapter.sendKey('!');        // editor:<printable> -> editor.insertChar { key: '!' }
    await settle();
    assert.deepEqual(mainText(adapter), ['hello!']);

    // Save to disk.
    adapter.sendKey('ctrl+s');   // file.save
    await settle();
    assert.equal(await readFile(file, 'utf8'), 'hello!');
    assert.equal(app.workspace.activeDocument?.dirty, false);

    // Undo the insertion.
    adapter.sendKey('ctrl+z');   // history.undo
    await settle();
    assert.deepEqual(mainText(adapter), ['hello']);

    // Open the command palette.
    adapter.sendKey('ctrl+p');   // global -> palette.open
    await settle();
    const overlay = adapter.lastFrame()?.overlay;
    assert.ok(overlay && overlay.kind === 'overlay', 'palette overlay should be open');

    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/plugins/integration.test.ts`
Expected: FAIL — cannot find module `../../src/plugins/index.ts`.

- [ ] **Step 3: Write defaultPlugins()**

Create `src/plugins/index.ts`:

```ts
import type { Plugin } from '../core/plugin-host.js';
import keymap from './keymap.js';
import editorView from './editor-view.js';
import directoryList from './directory-list.js';
import history from './history.js';
import save from './save.js';
import commandPalette from './command-palette.js';

// Load order matters: keymap MUST be first so its `focus` service and the sole
// `key` listener exist before any other plugin activates (contract §F).
export function defaultPlugins(): Plugin[] {
  return [keymap, editorView, directoryList, history, save, commandPalette];
}
```

- [ ] **Step 4: Export defaultPlugins from the public surface**

In `src/index.ts`, add:

```ts
export { defaultPlugins } from './plugins/index.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test tests/plugins/integration.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Run the full suite and build**

Run: `npm test && npm run build`
Expected: every suite passes; `tsc` exits 0 and emits `dist/`.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/index.ts src/index.ts tests/plugins/integration.test.ts
git commit -m "feat(plugins): defaultPlugins() in load order + end-to-end integration test"
```


---

## Residual Risks (from adversarial drafting — for the executing engineer)

- **Task 5 (keymap):** Hard dependency on Task A (core extensions): the test and impl assume `commands.register`/`keys.bind`/`services.register`/`events.on` all return a `Disposable`, `ctx.subscriptions` exists on PluginContext, and `PluginHost.deactivateAll` drains `ctx.subscriptions` in reverse. The current real source (registries.ts, event-bus.ts, plugin-host.ts) does NOT yet do this. If Task A is not applied before running this task, Step 3 will compile-fail (`.register(...)` returns void, `ctx.subscriptions` is undefined) and the dispose test will fail. This is per the task's stated assumption, but flag it: run Task A first.
- **Task 5 (keymap):** Determinism of command execution timing: `CommandRegistry.run` is `async`, so the probe's synchronous `calls.push` runs synchronously inside `run` before the first await, meaning routing assertions would hold even without `settle()`. The `settle()` await is required only for the `.catch` (rejection) tests. If a future refactor makes `run` defer the handler call to a microtask, the routing tests would still pass because `settle()` (setImmediate) drains past microtasks.
- **Task 5 (keymap):** The `focus:changed` listener registered in the emit test is never removed and the app from `makeApp()` is not disposed in most tests. Each test builds a fresh app/bus, so stray listeners cannot leak across tests; but engineers extending this file should not share an app instance between tests.
- **Task 5 (keymap):** `isPrintable` treats any single code point >= U+0020 as printable, including U+007F (DEL) and other single-codepoint control-ish characters at/above space only if >= ' '. Per the contract this exact definition is mandated; do not 'improve' it to exclude DEL or non-printable Unicode, as the editor-view <printable> binding and palette filter depend on this exact predicate.
- **Task 5 (keymap):** The dispose test relies on `app.dispose()` having drained the keymap subscription BEFORE the direct `app.bus.emit`. If a future PluginHost change disposes subscriptions asynchronously without awaiting, the listener could still be present; the test awaits `app.dispose()` (which the contract specifies returns a Promise that completes deactivation), so this holds only as long as dispose remains await-complete.
- **Task 6 (editor-view):** This task assumes the prerequisite `src/plugins/keymap.ts` exists and exports a `default` Plugin plus a `FocusService` type, and that it registers the `focus` service synchronously during activate (seeded to ['editor']) and is the SOLE 'key' listener. If keymap is not yet implemented when this test runs, every test fails at import. This dependency is per the task's stated assumptions.
- **Task 6 (editor-view):** The focus test depends on keymap's FocusService `push`/`pop`/`replace`/`top`/`stack` semantics matching contract B exactly (replace is a no-op while an overlay is on top; pop never removes the base; pop warns+no-ops on mismatch). If keymap deviates, the `alt+right ... set the base focus context` test will fail -- that failure indicates a keymap contract bug, not an editor-view bug.
- **Task 6 (editor-view):** This task assumes Task A core extensions are applied: `CommandRegistry.register`/`KeybindingRegistry.bind`/`ViewRegistry.contribute`/`ServiceRegistry.register`/`EventBus.on` all return `Disposable`, `ctx.subscriptions` exists, and `app.ts` ctxFor forwards the ViewRegistry disposer through `view.contribute`. The current repo HEAD still has the pre-Task-A signatures (register returns void, no subscriptions, view.contribute returns void), so this file will NOT compile until Task A lands.
- **Task 6 (editor-view):** `editor.focus` uses `global:alt+right` and is symmetric with `directory-list`'s `global:alt+left` -> `tree.focus`. If a later directory-list task also binds `global:alt+right`, last-writer-wins in the KeybindingRegistry could clobber it; load order (editor-view before directory-list) and the contract table keep them distinct, but the executing engineer should not re-use `alt+right` elsewhere.
- **Task 6 (editor-view):** Vertical movement uses UTF-16 columns (string indexing), consistent with the document's offset model. Astral-plane characters (surrogate pairs) would let the caret land between surrogates; this matches the contract's 'column is a UTF-16 offset' definition but is a latent edge case if grapheme-correct movement is ever required.
- **Task 6 (editor-view):** The test relies on `app.workspace`, `app.commands`, `app.keys`, and `app.bus` from the App surface (all present in app.ts) and on `HeadlessAdapter.lastFrame()/sendKey()`; if the App interface changes in a parallel task, the typed imports (`App`) will surface the break at compile time rather than silently.
- **Task 7 (directory-list):** Hard dependency on Task A core extensions being applied first: this code calls ctx.subscriptions.push(...) and relies on ctx.commands.register/ctx.keys.bind/ctx.view.contribute/ctx.events.on each returning a Disposable, and on CommandRegistry.register accepting a 3rd meta arg. Against the UNMODIFIED core read here (registries.ts register returns void and takes no meta; event-bus on returns void; plugin-host PluginContext has no subscriptions), this will not compile/pass. The plan assumes Task A is done; if it is not, this task fails.
- **Task 7 (directory-list):** Hard dependency on the keymap plugin: tests import `keymap` (default) and the `FocusService` type from src/plugins/keymap.ts, and the impl imports the FocusService type from './keymap.js'. If keymap is not yet implemented, or does not default-export a Plugin / does not register the 'focus' service / does not export a FocusService type, every test here fails. keymap MUST be loaded first (it is, as plugins[0]).
- **Task 7 (directory-list):** The directory-list tree provider is contributed unconditionally, including the no-root case. If another future plugin also contributes to slot 'tree', last-writer-wins applies (contribute is identity-guarded per Task A); load order then matters. Not an issue for the M1 default set.
- **Task 7 (directory-list):** The fs:changed test depends on the temp filesystem reporting a directory listing of exactly ['one.txt','two.txt'] after writing two.txt. On exotic/case-insensitive or networked filesystems the localeCompare ordering is still deterministic, but if the host injects hidden sidecar files into a fresh mkdtemp dir, the length===2 poll could over- or under-shoot. Standard macOS/Linux tmpdir is clean; flagged for unusual CI sandboxes.
- **Task 7 (directory-list):** After app.dispose() the host drains subscriptions, removing the fs:changed listener and closing the Watcher, so post-dispose OS events are dropped before relist runs. The try/catch in relist is the safety net for the narrow window where an OS event is already queued at rm() time; it has been verified to swallow ENOENT. No further action needed, but engineers should keep the try/catch if they refactor relist.
- **Task 8 (command-palette):** The implementation and test assume the keymap plugin (Task) exports a `default` Plugin and a named `FocusService` type from `src/plugins/keymap.ts`, that it seeds the focus stack to `['editor']`, emits `focus:changed` with payload `{ context }`, and is the sole `key` listener dispatching via `focus.top()` (contract §B/§C). If keymap's actual export shape or event payload differs, the imports/observers in the test break. The `node:test` runner aborts a file on an unresolved import, so a keymap mismatch surfaces immediately.
- **Task 8 (command-palette):** The tests assume keymap (and any other plugin loaded) registers NO commands that contain the substrings 'beta'/'fixture' in their humanized label. Only `keymap`, `fixturePlugin`, and `commandPalette` are loaded, and palette's own commands are excluded from the list, so the filtered-list assertions are deterministic. If a future keymap implementation registers titled commands matching those needles, the exact-list `deepEqual` assertions would need `>=`/membership style relaxation.
- **Task 8 (command-palette):** `humanizeId` does not split on digit->letter boundaries (e.g. `step2name` stays `Step2name`) and treats only camelCase/Pascal/whitespace/_/- as word boundaries. This satisfies every contract example given (`editor.insertChar`, `palette.open`, `tree.up`, `save`, `a.b.c`); ids with embedded digits adjacent to letters would label slightly differently. No current command id triggers this.
- **Task 8 (command-palette):** `palette.accept` is `async` and the keymap dispatch does `commands.run(id, {key}).catch(...)` without awaiting. The fixture command handlers are synchronous so `ran` is populated before `sendKey` returns; if a real target command were async, its effects would land on a later microtask. Tests only drive synchronous fixture commands, so this is not a problem for this task, but the executing engineer should keep palette-invoked side effects out of the synchronous assertion path in any new tests.
- **Task 8 (command-palette):** `ctx.commands.list()`/`register(...meta)`/`bind`/`contribute` returning a Disposable, and `EventBus.on` returning a Disposable, all depend on Task A (core extensions, contract §A) being applied. The current on-disk `registries.ts`/`view.ts`/`plugin-host.ts` still show the pre-extension signatures (`register` returns void, no `list()`, no `meta`), so this task will not compile until Task A lands first.
- **Task 9 (history):** This task is written under the contract's Task-A assumptions, but the CURRENT repo (src/core/registries.ts, event-bus.ts, plugin-host.ts) is the PRE-Task-A version: EventBus.on returns void, CommandRegistry.register returns void and takes no meta, has no list(); KeybindingRegistry.bind returns void; PluginContext has no subscriptions; PluginHost.deactivateAll does not drain subscriptions; ServiceRegistry/ViewRegistry.contribute return void. If Task A has NOT actually landed before this task runs, BOTH the implementation (ctx.subscriptions.push(...), register(...,{title}) returning a Disposable) and the test (app.commands.list(), dispose-drains-subscriptions) will fail to compile/pass. The executing engineer must confirm Task A is merged first.
- **Task 9 (history):** The plugin imports keymap and editor-view as default exports from src/plugins/keymap.ts and src/plugins/editor-view.ts; those files do not yet exist in the repo (tests/ only has core/ and src/plugins/ is empty). They are assumed delivered by earlier Phase 2 tasks. If their default export shape or filename differs, the test's createApp({ plugins: [keymap, editorView, history] }) import will break. editor-view is only needed by the test to mirror the real edit path; history itself depends on neither at runtime.
- **Task 9 (history):** selBefore is the documented approximation (collapsed caret at inverse.start). It is exact for single-caret insert/delete at the caret (the cases the tests exercise) but is NOT faithful for multi-character replacements or non-collapsed selections: after undo the selection collapses to the edit start rather than restoring the original range. If a later editor feature performs range replacements, undo will restore the wrong selection (text is still correct). To make selBefore exact, capture a true pre-edit selection snapshot (e.g. via a 'before:document:changed' hook or by having editor-view pass selBefore in the op), which the current core does not provide.
- **Task 9 (history):** history.undo/redo call ctx.view.invalidate() which in createApp maps to render() -> composer.compose() -> adapter.render(). With HeadlessAdapter this just pushes a Frame and is side-effect-free, so it stays deterministic; but a misbehaving slot provider only logs and degrades that slot, so invalidate() will never throw into the command. No timer or wall-clock dependency anywhere, so the suite is deterministic.
- **Task 9 (history):** redo replays entry.op with its ORIGINAL absolute offsets. This is correct only because redo is always applied to a document state identical to the one right before the original edit (guaranteed by strict LIFO undo/redo with redo cleared on any fresh edit). The tests cover this invariant; do not add out-of-order redo without rebasing offsets.
- **Task 10 (save):** This task assumes the Task A core extensions are already applied: `CommandRegistry.register(id, handler, meta)` returning a Disposable, `KeybindingRegistry.bind` returning a Disposable, `EventBus.on` returning a Disposable, and `ctx.subscriptions: Disposable[]` on PluginContext. The real files read at draft time (registries.ts, plugin-host.ts) still show the PRE-Task-A signatures (register returns void, no meta, no subscriptions). If Task A is NOT merged first, both the impl (`.push(ctx.commands.register(...))`, `.push(ctx.keys.bind(...))`, `ctx.subscriptions`) and the test (`app.bus.on(...).dispose()`) will fail to compile/throw. Verify Task A is in before running.
- **Task 10 (save):** The autosave test depends on the keymap plugin existing and providing the sole `key` listener / focus service; it is imported as the first plugin. If the keymap plugin's module path or default export differs from `src/plugins/keymap.ts default`, the import line breaks. Adjust the import to match the actual keymap task output.
- **Task 10 (save):** `app.bus` must be exposed on the App object — the real app.ts returns `{ bus, workspace, commands, keys, render, dispose }`, so `app.bus.on('document:saved', ...)` is valid as written. If a later refactor renames/removes `bus` from the App surface, the deterministic barrier in the autosave test must be re-pointed (e.g. via a tiny listener plugin that captures `ctx.events`).
- **Task 10 (save):** The autosave success test mutates the doc and relies on it still being dirty when the timer fires. Since no other plugin saves in this minimal plugin set, that holds; but if a future setup plugin or autosave-on-activate behavior were added, the doc could already be clean and `Workspace.save()` would still write (it does not skip clean docs) — `document:saved` would still fire, so the barrier remains valid, but the 'unchanged before tick' assertion (`readFile === 'start'`) assumes nothing saved between openFile and the tick.
- **Task 10 (save):** Mock timers are scoped per-test via `t.mock.timers`; ensure the test runner is a recent enough Node (node:test mock timers require Node >= 20.4 / the `apis` option). If the project's Node is older, swap to the alternative documented approach (assert an extra disposable exists and invoke the captured interval callback manually).

- **All plugin tasks:** depend on Tasks 1-4 (core extensions). Run them first; the plugin code assumes `Disposable`, `ctx.subscriptions`, `CommandRegistry.list`, `KeybindingRegistry.entries/unbind`, and disposer-returning `register/bind/contribute/on` all exist.


