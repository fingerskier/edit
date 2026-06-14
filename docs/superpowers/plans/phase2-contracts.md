# Phase 2 Shared Contracts (authoritative)

Every Phase 2 task MUST use these exact names, signatures, ids, and event names. Source files import
internal modules with `.js` extensions; test files import from `src/.../*.ts`. Test runner:
`node --import tsx --test <file>`. Plugins live in `src/plugins/<name>.ts` and export `default` a `Plugin`.

## A. Core extensions (built first, Task group A)

### Disposable (src/core/plugin-host.ts)
```ts
export interface Disposable { dispose(): void }
```

### EventBus.on returns a Disposable (src/core/event-bus.ts)
```ts
on(event: string, fn: Listener): Disposable {
  let set = this.listeners.get(event);
  if (!set) { set = new Set(); this.listeners.set(event, set); }
  set.add(fn);
  return { dispose: () => this.off(event, fn) };
}
```
(`off`/`emit` unchanged. Backward compatible: callers ignoring the return value still work.)

### CommandRegistry (src/core/registries.ts)
```ts
export interface CommandMeta { title?: string }
export type CommandHandler = (args: any) => any | Promise<any>;
// storage: Map<string, { handler: CommandHandler; meta: CommandMeta }>
register(id: string, handler: CommandHandler, meta: CommandMeta = {}): Disposable
  // identity-guarded disposer: deletes only if the stored handler is still this one
ids(): string[]
list(): Array<{ id: string } & CommandMeta>   // [{ id, title? }, ...]
run(id: string, args?: any): Promise<any>      // reads stored .handler; throws 'unknown command: <id>'
```

### KeybindingRegistry (src/core/registries.ts)
```ts
bind(keySpec: string, commandId: string): Disposable   // identity-guarded on commandId
resolve(keySpec: string): string | undefined
unbind(keySpec: string): void
entries(): Array<[string, string]>                     // [ [keySpec, commandId], ... ]
```

### ServiceRegistry (src/core/registries.ts)
```ts
register(name: string, impl: unknown): Disposable      // identity-guarded
get<T>(name: string): T                                 // throws 'unknown service: <name>'
```

### ViewRegistry (src/core/view.ts)
```ts
contribute(slot: Slot, provider: ViewProvider): Disposable  // identity-guarded (last-writer-wins safe)
```

### PluginContext (src/core/plugin-host.ts) — add subscriptions
```ts
export interface PluginContext {
  commands: CommandRegistry;
  keys: KeybindingRegistry;
  view: { contribute(slot: Slot, provider: ViewProvider): Disposable; invalidate(): void };
  events: EventBus;
  workspace: Workspace;
  fs: FileSystem;
  config: Record<string, any>;
  services: ServiceRegistry;
  subscriptions: Disposable[];   // host drains these (reverse order) on deactivate
}
```

### PluginHost (src/core/plugin-host.ts)
- Store `private active: { plugin: Plugin; ctx: PluginContext }[]`.
- `activateAll`: build ctx ONCE per plugin (via ctxFor), store `{ plugin, ctx }`, pass that SAME ctx to `activate`.
- `deactivateAll`: iterate `active` in reverse; for each, `try { await plugin.deactivate?.() } catch (e) { console.error }`, then dispose `ctx.subscriptions` in REVERSE order, each in its own `try/catch`.
- `ctxFor` signature becomes `(plugin) => PluginContext` still, but app.ts must put a fresh `subscriptions: []` in each ctx and forward the ViewRegistry disposer through `view.contribute`.

### app.ts ctxFor
```ts
view: {
  contribute: (slot, provider) => views.contribute(slot, provider),  // returns Disposable
  invalidate: render,
},
...
subscriptions: [],
```

### index.ts — export `Disposable`, `CommandMeta`.

## B. Focus service (provided by the keymap plugin via `ctx.services.register('focus', ...)`)
```ts
export interface FocusService {
  push(context: string): void;        // overlays push on top
  pop(expected?: string): void;       // warn+no-op if top() !== expected; never pops the base (index 0)
  replace(context: string): void;     // sets the BASE context (index 0); NO-OP while an overlay is on top (stack.length > 1)
  top(): string;                      // current context that owns input
  stack(): string[];                  // copy of the stack, base first
}
```
- Stack seeded synchronously to `['editor']` in keymap.activate.
- After ANY change, keymap emits `focus:changed` with `{ context: top() }`.
- A `FocusService` TYPE is exported from `src/plugins/keymap.ts` for other plugins/tests to import.

## C. Keymap dispatch protocol (keymap is the ONLY `ctx.events.on('key')` listener)
On a `key` event `{ key }`:
```
const ctx = focus.top();
const id =
  keys.resolve(`${ctx}:${key}`) ??
  keys.resolve(`global:${key}`) ??
  (isPrintable(key) ? keys.resolve(`${ctx}:<printable>`) : undefined);
if (id) commands.run(id, { key }).catch((err) => console.error('[keymap] command failed:', id, err));
```
- `isPrintable(key)` = `[...key].length === 1 && key >= ' '` (single code point, not a named token).
- **Adapter key-naming contract:** printable characters arrive as the literal single character (incl. shift → `'A'`); named keys/chords arrive as multi-char tokens: `'enter'`, `'tab'`, `'space'`, `'backspace'`, `'escape'`, `'up'`, `'down'`, `'left'`, `'right'`, `'home'`, `'end'`, and modifier chords like `'ctrl+s'`, `'alt+left'`.
- `<printable>` is a reserved keySpec token: a plugin binds `'<context>:<printable>'` → commandId to receive any unhandled printable in that context (the command gets `{ key }`).
- No other plugin may call `ctx.events.on('key')`.

## D. Command ids, default bindings, and contexts

| Command id | title | bound keySpec(s) | owner plugin |
|---|---|---|---|
| `editor.insertChar` | Editor: Insert Character | `editor:<printable>` | editor-view |
| `editor.backspace` | Editor: Backspace | `editor:backspace` | editor-view |
| `editor.delete` | Editor: Delete | `editor:delete` | editor-view |
| `editor.moveLeft` | Editor: Move Left | `editor:left` | editor-view |
| `editor.moveRight` | Editor: Move Right | `editor:right` | editor-view |
| `editor.moveUp` | Editor: Move Up | `editor:up` | editor-view |
| `editor.moveDown` | Editor: Move Down | `editor:down` | editor-view |
| `editor.moveHome` | Editor: Move to Line Start | `editor:home` | editor-view |
| `editor.moveEnd` | Editor: Move to Line End | `editor:end` | editor-view |
| `editor.focus` | Focus Editor | `global:alt+right` | editor-view (registers + binds) |
| `tree.up` | Tree: Up | `tree:up` | directory-list |
| `tree.down` | Tree: Down | `tree:down` | directory-list |
| `tree.open` | Tree: Open Selection | `tree:enter` | directory-list |
| `tree.focus` | Focus Directory Tree | `global:alt+left` | directory-list (registers + binds) |
| `palette.open` | Command Palette | `global:ctrl+p` | command-palette |
| `palette.close` | Palette: Close | `palette:escape` | command-palette |
| `palette.accept` | Palette: Run Selected | `palette:enter` | command-palette |
| `palette.up` | Palette: Previous | `palette:up` | command-palette |
| `palette.down` | Palette: Next | `palette:down` | command-palette |
| `palette.filterChar` | Palette: Filter | `palette:<printable>` | command-palette |
| `palette.backspace` | Palette: Delete Filter Char | `palette:backspace` | command-palette |
| `history.undo` | Undo | `editor:ctrl+z` | history |
| `history.redo` | Redo | `editor:ctrl+y` | history |
| `file.save` | Save File | `editor:ctrl+s` | save |

**Focus-toggle bindings (resolve the ambiguity explicitly):**
- `global:alt+left` → `tree.focus` (focus.replace('tree'))
- `global:alt+right` → `editor.focus` (focus.replace('editor'))
- `editor.focus` command is registered by editor-view; `tree.focus` by directory-list. Both call `ctx.services.get('focus').replace(...)`. Use `global:` so they work from either panel.

## E. View widget shapes (from src/core/view.ts — already exist)
- editor-view → slot `main`: `{ kind: 'text', lines: string[], cursors: number[] }` where `cursors` are FLAT offsets into the document text (e.g. `[doc.selection.head]`).
- directory-list → slot `tree`: `{ kind: 'list', items: ListItem[], selected: number }`.
- command-palette → slot `overlay`: `{ kind: 'overlay', title: 'Commands', body: { kind: 'list', items, selected } }`; returns `null` when closed.
- A status segment (optional) → slot `status`: `{ kind: 'status', segments: string[] }`.

## F. Plugin load order (config / defaultPlugins())
`keymap` MUST be first (registers the `focus` service + the sole key listener before others activate).
Order: `keymap, editor-view, directory-list, history, save, command-palette`.
Other plugins read the focus service lazily inside command handlers (NOT at activate time) OR after
confirming keymap is first — prefer lazy `ctx.services.get('focus')` inside handlers to avoid
activation-order coupling.

## G. Universal plugin rules
- Every `register/bind/contribute/on` call's returned `Disposable` is pushed into `ctx.subscriptions`
  (so deactivate cleans up). Ad-hoc resources (e.g. save's autosave `setInterval`) are pushed as
  `{ dispose: () => clearInterval(t) }`.
- Editing goes through `ctx.workspace` (applyEdit/setSelection/save/openFile/closeDocument); never mutate Document directly.
- A command that needs the active document must no-op gracefully when `ctx.workspace.activeDocument`
  is null (do not let `requireActive()` throw into the keymap's `.catch`).
- Call `ctx.view.invalidate()` after any state change that affects what a slot renders.
