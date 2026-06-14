# Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless, UI-agnostic editor engine — buffer, documents, workspace, file watcher, event bus, plugin host, contribution registries, view composer — plus a headless adapter, so the whole stack is programmatically drivable and snapshot-testable with no terminal.

**Architecture:** A bare-metal core providing *only* mechanism. State lives in `Document`/`Workspace`; mutations go through imperative functions that emit past-tense events on a synchronous `EventBus`. Plugins receive a `PluginContext` facade and contribute commands, keybindings, and view providers through registries. A `ViewComposer` collects per-slot `ViewModel`s and hands them to an `Adapter`; the `HeadlessAdapter` captures them as data for tests.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥20, `node:test` + `node:assert` test runner via `tsx`. No runtime dependencies.

---

## File Structure

```
src/
  core/
    event-bus.ts       EventBus: synchronous pub/sub
    buffer.ts          EditOp, TextBuffer interface, StringBuffer impl
    document.ts        Selection, Document (buffer + path + selection + dirty)
    document-set.ts    DocumentSet: open documents + active id
    file-system.ts     FileSystem: async read/write
    watcher.ts         Watcher: wraps fs.watch, emits fs:changed
    registries.ts      CommandRegistry, KeybindingRegistry, ServiceRegistry
    view.ts            ViewModel types, Slot, ViewRegistry, ViewComposer
    workspace.ts       Workspace: editing facade over DocumentSet + EventBus
    adapter.ts         Adapter interface
    plugin-host.ts     Plugin, PluginContext, PluginHost, resolvePlugins
    app.ts             createApp(): wires everything
  adapters/
    headless.ts        HeadlessAdapter: records rendered frames
  index.ts             public exports
tests/
  core/*.test.ts
```

**Key shared types (defined in the tasks that own them; referenced everywhere):**

```ts
// buffer.ts
interface EditOp { start: number; end: number; text: string } // offsets; insert => start===end
interface TextBuffer { getText(): string; length(): number; apply(op: EditOp): EditOp } // apply returns inverse

// document.ts
interface Selection { anchor: number; head: number } // caret => anchor===head

// view.ts
type Slot = 'tree' | 'main' | 'status' | 'overlay';
interface ListItem { label: string; style?: string }
interface StyleSpan { line: number; start: number; end: number; style: string }
type Widget =
  | { kind: 'list'; items: ListItem[]; selected: number }
  | { kind: 'text'; lines: string[]; spans?: StyleSpan[]; cursors?: number[]; scroll?: number }
  | { kind: 'status'; segments: string[] }
  | { kind: 'overlay'; title?: string; body: Widget };
type ViewModel = Widget;
type Frame = Partial<Record<Slot, ViewModel>>;

// plugin-host.ts
interface Plugin { name: string; activate(ctx: PluginContext): void | Promise<void>; deactivate?(): void | Promise<void> }
```

---

## Task 0: Reset scaffold

**Files:**
- Delete: `src/cursor.ts`, `src/commands.ts`, `src/workspace.ts`, `src/text-buffer.ts`, `src/app.ts`, `src/document.ts`, `src/cli.ts`, `src/keymap.ts`, `src/renderer.ts`, `src/config.ts`
- Delete: `tests/*.test.ts` (all current tests)
- Create: `src/index.ts` (placeholder)

- [ ] **Step 1: Remove old source and tests**

```bash
git rm src/cursor.ts src/commands.ts src/workspace.ts src/text-buffer.ts src/app.ts src/document.ts src/cli.ts src/keymap.ts src/renderer.ts src/config.ts
git rm tests/hotkeys.test.ts tests/document.test.ts tests/app-renderer.test.ts tests/commands.test.ts tests/editing.test.ts tests/buffer.test.ts tests/cursor.test.ts tests/cli.test.ts
mkdir -p src/core src/adapters tests/core
```

- [ ] **Step 2: Create placeholder entrypoint**

Create `src/index.ts`:

```ts
export const VERSION = '0.0.0';
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run build`
Expected: exits 0, emits `dist/index.js`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: reset scaffold for pluggable core rebuild"
```

---

## Task 1: EventBus

**Files:**
- Create: `src/core/event-bus.ts`
- Test: `tests/core/event-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/event-bus.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/core/event-bus.ts';

test('emit invokes registered listeners synchronously with payload', () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.on('document:changed', (p: { id: string }) => seen.push(p.id));
  bus.emit('document:changed', { id: 'doc1' });
  assert.deepEqual(seen, ['doc1']);
});

test('listeners run in registration order before emit returns', () => {
  const bus = new EventBus();
  const order: number[] = [];
  bus.on('e', () => order.push(1));
  bus.on('e', () => order.push(2));
  bus.emit('e', undefined);
  assert.deepEqual(order, [1, 2]);
});

test('off removes a listener', () => {
  const bus = new EventBus();
  let count = 0;
  const fn = () => { count++; };
  bus.on('e', fn);
  bus.off('e', fn);
  bus.emit('e', undefined);
  assert.equal(count, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/event-bus.test.ts`
Expected: FAIL — cannot find module `event-bus.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/event-bus.ts`:

```ts
export type Listener = (payload: any) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, payload: any): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/event-bus.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/event-bus.ts tests/core/event-bus.test.ts
git commit -m "feat(core): synchronous event bus"
```

---

## Task 2: Text buffer with reversible ops

**Files:**
- Create: `src/core/buffer.ts`
- Test: `tests/core/buffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/buffer.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StringBuffer } from '../../src/core/buffer.ts';

test('insert at offset and read text back', () => {
  const b = new StringBuffer('Hello');
  b.apply({ start: 5, end: 5, text: ' world' });
  assert.equal(b.getText(), 'Hello world');
  assert.equal(b.length(), 11);
});

test('apply returns the inverse op that undoes the edit', () => {
  const b = new StringBuffer('Hello world');
  const inverse = b.apply({ start: 0, end: 5, text: 'Howdy' }); // replace "Hello"
  assert.equal(b.getText(), 'Howdy world');
  assert.deepEqual(inverse, { start: 0, end: 5, text: 'Hello' });
  b.apply(inverse);
  assert.equal(b.getText(), 'Hello world');
});

test('pure delete inverse re-inserts removed text', () => {
  const b = new StringBuffer('abcdef');
  const inverse = b.apply({ start: 2, end: 4, text: '' }); // delete "cd"
  assert.equal(b.getText(), 'abef');
  assert.deepEqual(inverse, { start: 2, end: 2, text: 'cd' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/buffer.test.ts`
Expected: FAIL — cannot find module `buffer.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/buffer.ts`:

```ts
export interface EditOp {
  start: number; // offset, inclusive
  end: number;   // offset, exclusive; for a pure insert start === end
  text: string;  // replacement text
}

export interface TextBuffer {
  getText(): string;
  length(): number;
  /** Applies the op and returns the inverse op that would undo it. */
  apply(op: EditOp): EditOp;
}

export class StringBuffer implements TextBuffer {
  private text: string;
  constructor(initial = '') { this.text = initial; }

  getText(): string { return this.text; }
  length(): number { return this.text.length; }

  apply(op: EditOp): EditOp {
    const removed = this.text.slice(op.start, op.end);
    this.text = this.text.slice(0, op.start) + op.text + this.text.slice(op.end);
    return { start: op.start, end: op.start + op.text.length, text: removed };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/buffer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/buffer.ts tests/core/buffer.test.ts
git commit -m "feat(core): string buffer with reversible edit ops"
```

---

## Task 3: Document and Selection

**Files:**
- Create: `src/core/document.ts`
- Test: `tests/core/document.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/document.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '../../src/core/document.ts';

test('new document is not dirty and has a caret at 0', () => {
  const d = new Document('doc1', '/tmp/a.txt', 'hello');
  assert.equal(d.dirty, false);
  assert.deepEqual(d.selection, { anchor: 0, head: 0 });
  assert.equal(d.text(), 'hello');
});

test('apply edits the buffer, marks dirty, returns inverse', () => {
  const d = new Document('doc1', '/tmp/a.txt', 'hello');
  const inverse = d.apply({ start: 5, end: 5, text: '!' });
  assert.equal(d.text(), 'hello!');
  assert.equal(d.dirty, true);
  assert.deepEqual(inverse, { start: 5, end: 6, text: '' });
});

test('setSelection clamps head/anchor into buffer bounds', () => {
  const d = new Document('doc1', null, 'abc');
  d.setSelection({ anchor: -2, head: 99 });
  assert.deepEqual(d.selection, { anchor: 0, head: 3 });
});

test('markClean resets the dirty flag', () => {
  const d = new Document('doc1', '/tmp/a.txt', 'x');
  d.apply({ start: 1, end: 1, text: 'y' });
  d.markClean();
  assert.equal(d.dirty, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/document.test.ts`
Expected: FAIL — cannot find module `document.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/document.ts`:

```ts
import { StringBuffer, type TextBuffer, type EditOp } from './buffer.ts';

export interface Selection { anchor: number; head: number }

export class Document {
  readonly id: string;
  path: string | null;
  buffer: TextBuffer;
  selection: Selection = { anchor: 0, head: 0 };
  dirty = false;

  constructor(id: string, path: string | null, initial = '') {
    this.id = id;
    this.path = path;
    this.buffer = new StringBuffer(initial);
  }

  text(): string { return this.buffer.getText(); }

  apply(op: EditOp): EditOp {
    const inverse = this.buffer.apply(op);
    this.dirty = true;
    this.clampSelection();
    return inverse;
  }

  setSelection(sel: Selection): void {
    this.selection = sel;
    this.clampSelection();
  }

  markClean(): void { this.dirty = false; }

  private clampSelection(): void {
    const max = this.buffer.length();
    const clamp = (n: number) => Math.max(0, Math.min(max, n));
    this.selection = { anchor: clamp(this.selection.anchor), head: clamp(this.selection.head) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/document.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/document.ts tests/core/document.test.ts
git commit -m "feat(core): document with selection and dirty tracking"
```

---

## Task 4: DocumentSet

**Files:**
- Create: `src/core/document-set.ts`
- Test: `tests/core/document-set.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/document-set.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSet } from '../../src/core/document-set.ts';

test('add creates a document, returns it, and makes it active when first', () => {
  const set = new DocumentSet();
  const d = set.add('/tmp/a.txt', 'hi');
  assert.equal(d.path, '/tmp/a.txt');
  assert.equal(set.active?.id, d.id);
});

test('ids are unique across adds', () => {
  const set = new DocumentSet();
  const a = set.add('/tmp/a.txt', '');
  const b = set.add('/tmp/b.txt', '');
  assert.notEqual(a.id, b.id);
});

test('setActive switches the active document', () => {
  const set = new DocumentSet();
  set.add('/tmp/a.txt', '');
  const b = set.add('/tmp/b.txt', '');
  set.setActive(b.id);
  assert.equal(set.active?.id, b.id);
});

test('get returns a document by id, undefined if missing', () => {
  const set = new DocumentSet();
  const a = set.add('/tmp/a.txt', '');
  assert.equal(set.get(a.id), a);
  assert.equal(set.get('nope'), undefined);
});

test('close removes a document and reassigns active', () => {
  const set = new DocumentSet();
  const a = set.add('/tmp/a.txt', '');
  const b = set.add('/tmp/b.txt', '');
  set.setActive(b.id);
  set.close(b.id);
  assert.equal(set.get(b.id), undefined);
  assert.equal(set.active?.id, a.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/document-set.test.ts`
Expected: FAIL — cannot find module `document-set.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/document-set.ts`:

```ts
import { Document } from './document.ts';

export class DocumentSet {
  private docs = new Map<string, Document>();
  private activeId: string | null = null;
  private seq = 0;

  get active(): Document | null {
    return this.activeId ? this.docs.get(this.activeId) ?? null : null;
  }

  list(): Document[] { return [...this.docs.values()]; }

  add(path: string | null, initial = ''): Document {
    const id = `doc${++this.seq}`;
    const doc = new Document(id, path, initial);
    this.docs.set(id, doc);
    if (this.activeId === null) this.activeId = id;
    return doc;
  }

  get(id: string): Document | undefined { return this.docs.get(id); }

  setActive(id: string): void {
    if (this.docs.has(id)) this.activeId = id;
  }

  close(id: string): void {
    this.docs.delete(id);
    if (this.activeId === id) {
      const next = this.docs.keys().next();
      this.activeId = next.done ? null : next.value;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/document-set.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/document-set.ts tests/core/document-set.test.ts
git commit -m "feat(core): document set with active tracking"
```

---

## Task 5: FileSystem

**Files:**
- Create: `src/core/file-system.ts`
- Test: `tests/core/file-system.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/file-system.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/file-system.test.ts`
Expected: FAIL — cannot find module `file-system.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/file-system.ts`:

```ts
import { readFile, writeFile, readdir } from 'node:fs/promises';

export interface DirEntry { name: string; isDir: boolean }

export class FileSystem {
  read(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async write(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf8');
  }

  async list(dir: string): Promise<DirEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/file-system.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/file-system.ts tests/core/file-system.test.ts
git commit -m "feat(core): async file system read/write/list"
```

---

## Task 6: Watcher

**Files:**
- Create: `src/core/watcher.ts`
- Test: `tests/core/watcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/watcher.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/watcher.test.ts`
Expected: FAIL — cannot find module `watcher.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/watcher.ts`:

```ts
import { watch, type FSWatcher } from 'node:fs';
import type { EventBus } from './event-bus.ts';

export class Watcher {
  private watchers = new Map<string, FSWatcher>();
  constructor(private bus: EventBus) {}

  watch(dir: string): void {
    if (this.watchers.has(dir)) return;
    const w = watch(dir, () => this.bus.emit('fs:changed', { dir }));
    this.watchers.set(dir, w);
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/watcher.test.ts`
Expected: PASS (1 test). Note: `fs.watch` is debounced by the OS; the test awaits a single event, which is sufficient.

- [ ] **Step 5: Commit**

```bash
git add src/core/watcher.ts tests/core/watcher.test.ts
git commit -m "feat(core): file watcher emitting fs:changed"
```

---

## Task 7: Registries (commands, keybindings, services)

**Files:**
- Create: `src/core/registries.ts`
- Test: `tests/core/registries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/registries.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry, KeybindingRegistry, ServiceRegistry } from '../../src/core/registries.ts';

test('command run invokes the registered handler and returns its result', async () => {
  const reg = new CommandRegistry();
  reg.register('math.add', (args: { a: number; b: number }) => args.a + args.b);
  assert.equal(await reg.run('math.add', { a: 2, b: 3 }), 5);
});

test('running an unknown command throws', async () => {
  const reg = new CommandRegistry();
  await assert.rejects(() => reg.run('nope', undefined), /unknown command: nope/);
});

test('command ids list every registered id', () => {
  const reg = new CommandRegistry();
  reg.register('a', () => {});
  reg.register('b', () => {});
  assert.deepEqual(reg.ids().sort(), ['a', 'b']);
});

test('keybindings bind and resolve a key spec to a command id', () => {
  const keys = new KeybindingRegistry();
  keys.bind('ctrl+s', 'file.save');
  assert.equal(keys.resolve('ctrl+s'), 'file.save');
  assert.equal(keys.resolve('ctrl+x'), undefined);
});

test('services register and get a shared implementation', () => {
  const services = new ServiceRegistry();
  services.register('greeter', { hi: () => 'hello' });
  assert.equal(services.get<{ hi: () => string }>('greeter').hi(), 'hello');
});

test('getting an unknown service throws', () => {
  const services = new ServiceRegistry();
  assert.throws(() => services.get('nope'), /unknown service: nope/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/registries.test.ts`
Expected: FAIL — cannot find module `registries.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/registries.ts`:

```ts
export type CommandHandler = (args: any) => any | Promise<any>;

export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();

  register(id: string, handler: CommandHandler): void {
    this.handlers.set(id, handler);
  }

  ids(): string[] { return [...this.handlers.keys()]; }

  async run(id: string, args?: any): Promise<any> {
    const handler = this.handlers.get(id);
    if (!handler) throw new Error(`unknown command: ${id}`);
    return await handler(args);
  }
}

export class KeybindingRegistry {
  private bindings = new Map<string, string>();

  bind(keySpec: string, commandId: string): void {
    this.bindings.set(keySpec, commandId);
  }

  resolve(keySpec: string): string | undefined {
    return this.bindings.get(keySpec);
  }
}

export class ServiceRegistry {
  private services = new Map<string, unknown>();

  register(name: string, impl: unknown): void {
    this.services.set(name, impl);
  }

  get<T>(name: string): T {
    if (!this.services.has(name)) throw new Error(`unknown service: ${name}`);
    return this.services.get(name) as T;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/registries.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/registries.ts tests/core/registries.test.ts
git commit -m "feat(core): command, keybinding, and service registries"
```

---

## Task 8: ViewModel types, ViewRegistry, ViewComposer

**Files:**
- Create: `src/core/view.ts`
- Test: `tests/core/view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/view.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewRegistry, ViewComposer, type ViewModel } from '../../src/core/view.ts';

test('composer collects the latest view model per slot', () => {
  const reg = new ViewRegistry();
  const list: ViewModel = { kind: 'list', items: [{ label: 'a.txt' }], selected: 0 };
  const text: ViewModel = { kind: 'text', lines: ['hello'] };
  reg.contribute('tree', () => list);
  reg.contribute('main', () => text);
  const frame = new ViewComposer(reg).compose();
  assert.deepEqual(frame, { tree: list, main: text });
});

test('a provider returning null omits its slot from the frame', () => {
  const reg = new ViewRegistry();
  reg.contribute('overlay', () => null);
  const frame = new ViewComposer(reg).compose();
  assert.equal('overlay' in frame, false);
});

test('the last provider registered for a slot wins', () => {
  const reg = new ViewRegistry();
  reg.contribute('status', () => ({ kind: 'status', segments: ['first'] }));
  reg.contribute('status', () => ({ kind: 'status', segments: ['second'] }));
  const frame = new ViewComposer(reg).compose();
  assert.deepEqual(frame.status, { kind: 'status', segments: ['second'] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/view.test.ts`
Expected: FAIL — cannot find module `view.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/view.ts`:

```ts
export type Slot = 'tree' | 'main' | 'status' | 'overlay';

export interface ListItem { label: string; style?: string }
export interface StyleSpan { line: number; start: number; end: number; style: string }

export type Widget =
  | { kind: 'list'; items: ListItem[]; selected: number }
  | { kind: 'text'; lines: string[]; spans?: StyleSpan[]; cursors?: number[]; scroll?: number }
  | { kind: 'status'; segments: string[] }
  | { kind: 'overlay'; title?: string; body: Widget };

export type ViewModel = Widget;
export type Frame = Partial<Record<Slot, ViewModel>>;
export type ViewProvider = () => ViewModel | null;

export class ViewRegistry {
  private providers = new Map<Slot, ViewProvider>();

  contribute(slot: Slot, provider: ViewProvider): void {
    this.providers.set(slot, provider);
  }

  entries(): [Slot, ViewProvider][] { return [...this.providers.entries()]; }
}

export class ViewComposer {
  constructor(private registry: ViewRegistry) {}

  compose(): Frame {
    const frame: Frame = {};
    for (const [slot, provider] of this.registry.entries()) {
      const vm = provider();
      if (vm !== null) frame[slot] = vm;
    }
    return frame;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/view.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/view.ts tests/core/view.test.ts
git commit -m "feat(core): view model vocabulary, registry, and composer"
```

---

## Task 9: Workspace (editing facade)

**Files:**
- Create: `src/core/workspace.ts`
- Test: `tests/core/workspace.test.ts`

The Workspace is the imperative editing API. Mutations emit past-tense events: `document:opened`,
`document:activated`, `document:changed` (payload includes the inverse op for history),
`selection:moved`, `document:saved`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/workspace.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/core/event-bus.ts';
import { FileSystem } from '../../src/core/file-system.ts';
import { Workspace } from '../../src/core/workspace.ts';

function makeWorkspace(roots: string[] = []) {
  const bus = new EventBus();
  return { bus, ws: new Workspace(bus, new FileSystem(), roots) };
}

test('roots are exposed as given', () => {
  const { ws } = makeWorkspace(['/a', '/b']);
  assert.deepEqual(ws.roots, ['/a', '/b']);
});

test('openFile reads the file, adds a document, activates it, emits events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-ws-'));
  try {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const { bus, ws } = makeWorkspace([dir]);
    const events: string[] = [];
    bus.on('document:opened', () => events.push('opened'));
    bus.on('document:activated', () => events.push('activated'));
    const doc = await ws.openFile(join(dir, 'a.txt'));
    assert.equal(doc.text(), 'hello');
    assert.equal(ws.activeDocument?.id, doc.id);
    assert.deepEqual(events, ['opened', 'activated']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyEdit mutates the active doc and emits document:changed with inverse', () => {
  const { bus, ws } = makeWorkspace();
  ws.openScratch('hello');
  let payload: any;
  bus.on('document:changed', (p) => { payload = p; });
  const inverse = ws.applyEdit({ start: 5, end: 5, text: '!' });
  assert.equal(ws.activeDocument?.text(), 'hello!');
  assert.deepEqual(inverse, { start: 5, end: 6, text: '' });
  assert.equal(payload.docId, ws.activeDocument?.id);
  assert.deepEqual(payload.inverse, { start: 5, end: 6, text: '' });
});

test('applyEdit with no active document throws', () => {
  const { ws } = makeWorkspace();
  assert.throws(() => ws.applyEdit({ start: 0, end: 0, text: 'x' }), /no active document/);
});

test('setSelection updates the active doc and emits selection:moved', () => {
  const { bus, ws } = makeWorkspace();
  ws.openScratch('hello');
  let moved = false;
  bus.on('selection:moved', () => { moved = true; });
  ws.setSelection({ anchor: 1, head: 3 });
  assert.deepEqual(ws.activeDocument?.selection, { anchor: 1, head: 3 });
  assert.equal(moved, true);
});

test('save writes the active doc to disk, clears dirty, emits document:saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-ws-'));
  try {
    const path = join(dir, 'out.txt');
    await writeFile(path, 'old');
    const { bus, ws } = makeWorkspace([dir]);
    await ws.openFile(path);
    ws.applyEdit({ start: 0, end: 3, text: 'new' });
    let saved = false;
    bus.on('document:saved', () => { saved = true; });
    await ws.save();
    const fs = new FileSystem();
    assert.equal(await fs.read(path), 'new');
    assert.equal(ws.activeDocument?.dirty, false);
    assert.equal(saved, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/workspace.test.ts`
Expected: FAIL — cannot find module `workspace.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/workspace.ts`:

```ts
import type { EventBus } from './event-bus.ts';
import type { FileSystem } from './file-system.ts';
import type { EditOp } from './buffer.ts';
import type { Selection, Document } from './document.ts';
import { DocumentSet } from './document-set.ts';

export class Workspace {
  readonly roots: string[];
  private docs = new DocumentSet();

  constructor(private bus: EventBus, private fs: FileSystem, roots: string[] = []) {
    this.roots = roots;
  }

  get activeDocument(): Document | null { return this.docs.active; }
  list(): Document[] { return this.docs.list(); }
  getDocument(id: string): Document | undefined { return this.docs.get(id); }

  async openFile(path: string): Promise<Document> {
    const content = await this.fs.read(path);
    const doc = this.docs.add(path, content);
    this.bus.emit('document:opened', { docId: doc.id, path });
    this.docs.setActive(doc.id);
    this.bus.emit('document:activated', { docId: doc.id });
    return doc;
  }

  openScratch(initial = ''): Document {
    const doc = this.docs.add(null, initial);
    this.bus.emit('document:opened', { docId: doc.id, path: null });
    this.docs.setActive(doc.id);
    this.bus.emit('document:activated', { docId: doc.id });
    return doc;
  }

  setActive(id: string): void {
    this.docs.setActive(id);
    this.bus.emit('document:activated', { docId: id });
  }

  applyEdit(op: EditOp): EditOp {
    const doc = this.requireActive();
    const inverse = doc.apply(op);
    this.bus.emit('document:changed', { docId: doc.id, op, inverse });
    return inverse;
  }

  setSelection(sel: Selection): void {
    const doc = this.requireActive();
    doc.setSelection(sel);
    this.bus.emit('selection:moved', { docId: doc.id, selection: doc.selection });
  }

  async save(): Promise<void> {
    const doc = this.requireActive();
    if (doc.path === null) throw new Error('cannot save scratch document without a path');
    await this.fs.write(doc.path, doc.text());
    doc.markClean();
    this.bus.emit('document:saved', { docId: doc.id, path: doc.path });
  }

  private requireActive(): Document {
    const doc = this.docs.active;
    if (!doc) throw new Error('no active document');
    return doc;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/workspace.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/workspace.ts tests/core/workspace.test.ts
git commit -m "feat(core): workspace editing facade with events"
```

---

## Task 10: Adapter interface and HeadlessAdapter

**Files:**
- Create: `src/core/adapter.ts`
- Create: `src/adapters/headless.ts`
- Test: `tests/core/headless-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/headless-adapter.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessAdapter } from '../../src/adapters/headless.ts';
import type { Frame } from '../../src/core/view.ts';

test('render records each frame; lastFrame returns the most recent', () => {
  const a = new HeadlessAdapter();
  const f1: Frame = { status: { kind: 'status', segments: ['a'] } };
  const f2: Frame = { status: { kind: 'status', segments: ['b'] } };
  a.render(f1);
  a.render(f2);
  assert.equal(a.frames.length, 2);
  assert.deepEqual(a.lastFrame(), f2);
});

test('sendKey forwards key strings to the registered handler', () => {
  const a = new HeadlessAdapter();
  const got: string[] = [];
  a.onKey((k) => got.push(k));
  a.sendKey('ctrl+s');
  assert.deepEqual(got, ['ctrl+s']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/headless-adapter.test.ts`
Expected: FAIL — cannot find module `headless.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/adapter.ts`:

```ts
import type { Frame } from './view.ts';

export type KeyHandler = (key: string) => void;

export interface Adapter {
  /** Paint a composed frame. */
  render(frame: Frame): void;
  /** Register the handler the adapter calls for each captured key. */
  onKey(handler: KeyHandler): void;
  /** Release resources (terminal raw mode, etc.). */
  dispose(): void;
}
```

Create `src/adapters/headless.ts`:

```ts
import type { Adapter, KeyHandler } from '../core/adapter.ts';
import type { Frame } from '../core/view.ts';

export class HeadlessAdapter implements Adapter {
  readonly frames: Frame[] = [];
  private keyHandler: KeyHandler | null = null;

  render(frame: Frame): void { this.frames.push(frame); }
  lastFrame(): Frame | undefined { return this.frames.at(-1); }

  onKey(handler: KeyHandler): void { this.keyHandler = handler; }
  sendKey(key: string): void { this.keyHandler?.(key); }

  dispose(): void { this.keyHandler = null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/headless-adapter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/adapter.ts src/adapters/headless.ts tests/core/headless-adapter.test.ts
git commit -m "feat(core): adapter interface and headless test adapter"
```

---

## Task 11: PluginHost, PluginContext, and createApp wiring

This task ties everything together: a `PluginContext` facade, a `PluginHost` that activates a list
of plugins, and `createApp()` which constructs the core, wires key dispatch (adapter key →
keybinding → command) and re-render-on-invalidate (view.invalidate → composer → adapter.render).

**Files:**
- Create: `src/core/plugin-host.ts`
- Create: `src/core/app.ts`
- Test: `tests/core/app.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/app.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/app.test.ts`
Expected: FAIL — cannot find module `app.ts`.

- [ ] **Step 3: Write the PluginHost and PluginContext**

Create `src/core/plugin-host.ts`:

```ts
import type { EventBus } from './event-bus.ts';
import type { FileSystem } from './file-system.ts';
import type { Workspace } from './workspace.ts';
import type { CommandRegistry, KeybindingRegistry, ServiceRegistry } from './registries.ts';
import type { Slot, ViewProvider } from './view.ts';

export interface PluginContext {
  commands: CommandRegistry;
  keys: KeybindingRegistry;
  view: { contribute(slot: Slot, provider: ViewProvider): void; invalidate(): void };
  events: EventBus;
  workspace: Workspace;
  fs: FileSystem;
  config: Record<string, any>;
  services: ServiceRegistry;
}

export interface Plugin {
  name: string;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export class PluginHost {
  private active: Plugin[] = [];

  constructor(private ctxFor: (plugin: Plugin) => PluginContext) {}

  async activateAll(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      await plugin.activate(this.ctxFor(plugin));
      this.active.push(plugin);
    }
  }

  async deactivateAll(): Promise<void> {
    for (const plugin of [...this.active].reverse()) {
      await plugin.deactivate?.();
    }
    this.active = [];
  }
}
```

- [ ] **Step 4: Write createApp**

Create `src/core/app.ts`:

```ts
import { EventBus } from './event-bus.ts';
import { FileSystem } from './file-system.ts';
import { Watcher } from './watcher.ts';
import { Workspace } from './workspace.ts';
import { CommandRegistry, KeybindingRegistry, ServiceRegistry } from './registries.ts';
import { ViewRegistry, ViewComposer } from './view.ts';
import { PluginHost, type Plugin, type PluginContext } from './plugin-host.ts';
import type { Adapter } from './adapter.ts';

export interface AppOptions {
  adapter: Adapter;
  plugins: Plugin[];
  roots: string[];
  config?: Record<string, Record<string, any>>;
}

export interface App {
  bus: EventBus;
  workspace: Workspace;
  commands: CommandRegistry;
  keys: KeybindingRegistry;
  render(): void;
  dispose(): Promise<void>;
}

export async function createApp(options: AppOptions): Promise<App> {
  const { adapter, plugins, roots, config = {} } = options;

  const bus = new EventBus();
  const fs = new FileSystem();
  const watcher = new Watcher(bus);
  const workspace = new Workspace(bus, fs, roots);
  const commands = new CommandRegistry();
  const keys = new KeybindingRegistry();
  const services = new ServiceRegistry();
  const views = new ViewRegistry();
  const composer = new ViewComposer(views);

  for (const root of roots) watcher.watch(root);

  const render = () => adapter.render(composer.compose());

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
  });

  const host = new PluginHost(ctxFor);

  adapter.onKey((key) => {
    const commandId = keys.resolve(key);
    if (commandId) void commands.run(commandId);
  });

  await host.activateAll(plugins);
  render();

  return {
    bus,
    workspace,
    commands,
    keys,
    render,
    async dispose() {
      await host.deactivateAll();
      watcher.close();
      adapter.dispose();
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/core/app.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/plugin-host.ts src/core/app.ts tests/core/app.test.ts
git commit -m "feat(core): plugin host, context, and app wiring"
```

---

## Task 12: resolvePlugins (npm + local dir loading)

Loads `Plugin` objects from config-listed module specifiers and from `.mjs`/`.js` files in a
plugins directory, via dynamic `import()`. Each module must `export default` a `Plugin`.

**Files:**
- Create: `src/core/plugin-loader.ts`
- Test: `tests/core/plugin-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/plugin-loader.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/core/plugin-loader.test.ts`
Expected: FAIL — cannot find module `plugin-loader.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/plugin-loader.ts`:

```ts
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from './plugin-host.ts';

export interface ResolveOptions {
  /** npm package names or absolute module paths, in load order. */
  specifiers: string[];
  /** Directory scanned for loose .mjs/.js plugin files. */
  localDir: string;
}

function asPlugin(mod: any, source: string): Plugin {
  const plugin = mod?.default;
  if (!plugin || typeof plugin.activate !== 'function' || typeof plugin.name !== 'string') {
    throw new Error(`${source}: missing default-exported plugin`);
  }
  return plugin as Plugin;
}

export async function resolvePlugins(options: ResolveOptions): Promise<Plugin[]> {
  const plugins: Plugin[] = [];

  for (const spec of options.specifiers) {
    const mod = await import(spec);
    plugins.push(asPlugin(mod, spec));
  }

  let files: string[] = [];
  try {
    files = (await readdir(options.localDir))
      .filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))
      .sort((a, b) => a.localeCompare(b));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  for (const file of files) {
    const full = resolve(join(options.localDir, file));
    const mod = await import(pathToFileURL(full).href);
    plugins.push(asPlugin(mod, file));
  }

  return plugins;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/core/plugin-loader.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin-loader.ts tests/core/plugin-loader.test.ts
git commit -m "feat(core): resolve plugins from specifiers and local dir"
```

---

## Task 13: Public exports and full build/test gate

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Write the public surface**

Replace `src/index.ts` with:

```ts
export { createApp, type App, type AppOptions } from './core/app.ts';
export { EventBus } from './core/event-bus.ts';
export { StringBuffer, type TextBuffer, type EditOp } from './core/buffer.ts';
export { Document, type Selection } from './core/document.ts';
export { DocumentSet } from './core/document-set.ts';
export { Workspace } from './core/workspace.ts';
export { FileSystem, type DirEntry } from './core/file-system.ts';
export { Watcher } from './core/watcher.ts';
export {
  CommandRegistry, KeybindingRegistry, ServiceRegistry, type CommandHandler,
} from './core/registries.ts';
export {
  ViewRegistry, ViewComposer,
  type Slot, type Widget, type ViewModel, type Frame, type ViewProvider,
  type ListItem, type StyleSpan,
} from './core/view.ts';
export { type Adapter, type KeyHandler } from './core/adapter.ts';
export { HeadlessAdapter } from './adapters/headless.ts';
export { PluginHost, type Plugin, type PluginContext } from './core/plugin-host.ts';
export { resolvePlugins, type ResolveOptions } from './core/plugin-loader.ts';
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files green (event-bus, buffer, document, document-set, file-system, watcher, registries, view, workspace, headless-adapter, app, plugin-loader).

- [ ] **Step 3: Verify the type-checked build**

Run: `npm run build`
Expected: exits 0; `dist/index.js` and `dist/core/*.js` emitted with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(core): public API surface for adapters and plugins"
```

---

## Self-Review Notes

- **Spec coverage (Plan 1 scope = core mechanism + headless adapter):** text buffer w/ reversible
  ops (Task 2), cursor/selection (Task 3), document + document set (Tasks 3–4), file I/O (Task 5),
  file watcher (Task 6), event bus (Task 1), plugin host + context (Task 11), contribution
  registries — commands/keybindings/view/services (Tasks 7–8), view composer + widget vocabulary +
  slots (Task 8), plugin loading from npm + local dir (Task 12), adapter interface + headless
  adapter for snapshot testing (Task 10), functions-vs-events model — imperative mutators emit
  past-tense events, async commands, sync bus (Tasks 1, 7, 9, 11). Default plugins, the TUI
  adapter, and the CLI are **out of scope** for Plan 1 (Plans 2 and 3).
- **Type consistency:** `EditOp`, `Selection`, `Slot`, `Widget`/`ViewModel`, `Frame`, `Plugin`,
  `PluginContext` are defined once and imported everywhere; `Workspace` methods (`openFile`,
  `openScratch`, `applyEdit`, `setSelection`, `save`, `activeDocument`) match their test usage and
  the `ctx.workspace` usage in Task 11.
- **Event names** are consistent across emitters and the spec: `document:opened`,
  `document:activated`, `document:changed` (carries `inverse`), `selection:moved`,
  `document:saved`, `fs:changed`, plus plugin lifecycle handled by the host.
