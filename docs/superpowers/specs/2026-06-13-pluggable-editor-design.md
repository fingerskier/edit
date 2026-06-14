# Pluggable Minimalist Editor — Design Spec

**Date:** 2026-06-13
**Status:** Approved (design); ready for implementation planning

## 1. Vision

Rebuild `edit` from scratch as a **deliberately minimalist, fully pluggable text editor**. A
headless **core** provides only mechanism; **adapters** render; **plugins** provide every visible
feature. Single active pane, a directory listing, and live file-watching are the baseline
experience — but even those are plugins, not core.

Distributed as the `edit` npm package, runnable via `npx`. Language: **TypeScript / Node ≥20, ESM**.

### Goals
- Minimal, non-negotiable core surface; everything else is opt-in.
- Pluggable enough that the directory tree, the editor pane, and the keymap are themselves plugins.
- UI-agnostic core so adapters (TUI now, web/GUI later) are swappable.
- Fast startup, keyboard-driven, `npx`-friendly.

### Non-goals (v1)
- Multi-pane editing (exactly one active file editor at a time).
- Sandboxed/untrusted plugin execution.
- Multi-package monorepo.
- Rich WYSIWYG, heavy IDE project modeling.

## 2. Architecture Overview

Headless **core (mechanism only)** + **adapters (rendering)** + **plugins (all features)**.

```
 raw keys ──▶ TUI adapter ──▶ core event bus ──▶ keymap plugin ──▶ command registry
                  ▲                                                      │
                  │                                              commands mutate
            paints widgets                                      buffer / selection /
                  │                                              active document
            view composer ◀── view plugins emit ViewModels ◀── state-change events
```

The core knows nothing about trees, search, syntax, or themes. It provides plumbing; every visible
feature is a plugin authored against the public plugin API.

**Input/render flow:**
1. Adapter captures raw key events and forwards them to the core event bus.
2. The keymap plugin maps keys → command IDs and dispatches via the command registry.
3. Commands mutate state (buffer, selection, active document) through core APIs.
4. State changes emit events.
5. View plugins recompute their `ViewModel`s and contribute them to their slots.
6. The view composer collects ViewModels per slot and hands them to the active adapter.
7. The adapter paints the primitive widget vocabulary.

## 3. The Core (bare metal)

The core provides *only* mechanism:

- **Text buffer** — an interface plus a simple default implementation. Edits are expressed as
  **reversible operations** (apply/invert) so a history plugin can stack and undo them. A
  piece-table implementation is deferred behind the same interface.
- **Cursor/selection** model.
- **Document** — buffer + path + dirty flag — and the set of open documents with one *active*
  document.
- **File I/O** — load/save.
- **File watcher** — emits change events for workspace paths.
- **Event bus** — pub/sub for core and plugin events.
- **Plugin host** — discovers and loads plugins, ordered and enabled via config, with an
  `activate(ctx)` / `deactivate()` lifecycle.
- **Contribution registries** — generic registration for `commands`, `keybindings`, `view slots`,
  and `services`, letting plugins compose without referencing each other.
- **View composer** — collects ViewModels per slot and hands them to the active adapter.

### Plugin loading & config
- Plugins are **npm packages** (e.g. `edit-plugin-tree`) listed in config, **plus** loose
  `.mjs`/`.js` files dropped into `~/.edit/plugins/`.
- Config (`~/.edit/config.json`, overridable via `edit --config <path>`) controls which plugins are
  enabled, their order, and per-plugin settings (including keybinding overrides).
- Plugins run **in-process and trusted** (no sandbox) — the right tradeoff for a personal editor.

## 4. Plugin Contract

`activate(ctx)` receives:

- `ctx.commands` — register/run command IDs.
- `ctx.keys` — bind key specs → command IDs.
- `ctx.view.contribute(slot, () => ViewModel)` and `ctx.view.invalidate()`.
- `ctx.events` — `on` / `emit`.
- `ctx.workspace` — roots, active document, document set.
- `ctx.fs` — file operations and watcher subscriptions.
- `ctx.config` — this plugin's config slice.
- `ctx.services` — get/register shared services.

### Slots
- `tree` — left
- `main` — center
- `status` — bottom
- `overlay` — floating (modals, palettes)

### Widget vocabulary (every adapter implements)
Plugins emit these as **plain data** — never raw drawing calls:
- `List` — items (label + optional style), selected index.
- `TextRegion` — lines + style spans + cursor positions + scroll offset.
- `StatusLine` — ordered segments.
- `Overlay` — a floating panel containing a `List` or `TextRegion`.

### Communication model: functions vs events

The system is a **hybrid**, not pure pub/sub. A pure event design makes control flow untraceable,
leaves inter-listener ordering ambiguous, and prevents return values and error propagation. The
seam is explicit:

**Imperative functions — "tell": directed, return values, errors propagate to the caller.**
- Buffer/document mutation: `buffer.applyOp(op)`, `doc.save()`.
- Workspace queries/actions: `workspace.openDocument(path)`, `workspace.activeDocument`.
- Command dispatch: `commands.run(id, args)` runs exactly *one* registered handler and may return a
  result.
- File I/O: `fs.read(path)`, `fs.write(...)`.
- Registration (all contribution registries): `commands.register()`, `keys.bind()`,
  `view.contribute()`, `services.register()` / `services.get()`.

**Events — "announce": broadcast, past-tense facts, fire-and-forget, no return value, no
inter-listener ordering guarantees.** Listeners are isolated — one throwing reactor is logged and
skipped, never aborting the rest of an emit.
- `document:opened`, `document:activated`, `document:changed` (payload carries `inverse` for undo),
  `document:saved`, `document:closed`.
- `selection:moved`.
- `fs:changed` (from the watcher; payload `{ dir, filename, eventType }`).
- `key` (raw key forwarded by the adapter — see input model below).
- `plugin:activated` / lifecycle events.

**Input model:** the core does **not** dispatch keys. The adapter captures a raw key and the core
forwards it onto the bus as a `key` fact (`{ key }`). The **keymap plugin** owns everything
downstream: resolving the key against the keybinding registry, honoring focus/mode (so an open
overlay captures keystrokes instead of the editor), passing the key to the command
(`commands.run(id, { key })` — this is how typed characters reach `editor.insertChar`), and handling
command errors. This keeps the core bare-metal and makes modal routing a plugin concern.

A typical flow mixes both: the adapter forwards a key → the bus emits `key` → the keymap plugin
resolves it and calls `commands.run('editor.insertChar', { key })` (function, directed) → the command
calls `workspace.applyEdit()` (function) → the workspace *emits* `document:changed` (event) → view
plugins react and call `view.invalidate()` (function). The event layer exists for the unknown-many
reactors; anything with a definite caller-callee relationship stays a function.

**Sync/async rules:**
- `commands.run()` is **async** (returns a `Promise`) so commands may perform file I/O.
- The **event bus is synchronous** — `emit` blocks until all listeners have run — so state-change
  ordering is predictable.

## 5. Default Plugins (shipped enabled)

All authored against the public plugin API — dogfooding that proves the contract:

- **editor-view** — `main` slot. Renders the active document; insert/delete/cursor-movement
  commands.
- **directory-list** — `tree` slot. Lists the workspace root, opens files, reacts to watcher
  events.
- **keymap + command-palette** — default keybindings plus an `overlay` palette to find and run any
  registered command.
- **history + save** — undo/redo over reversible buffer ops; save / save-all with optional
  autosave.

## 6. Future / Optional Plugins (exist but off by default, or later)

Shipped disabled or built after v1. Each is a normal plugin using the same public API:

- **fuzzy-open** — fuzzy quick-open by path/name across workspace roots (`overlay`).
- **syntax-highlighting** — tokenize the active document; contribute style spans to the editor's
  `TextRegion`.
- **themes** — palette/style definitions; theme editing and switching.
- **lsp** — Language Server Protocol client: diagnostics, symbol navigation, introspection.
- **git** — status decorations in the directory list, basic diff/blame surfacing.
- **clipboard-history** — ring of recent yanks/cuts with a picker (`overlay`).
- **multiple-cursors** — multi-cursor/selection editing.
- **multi-root-workspace** — manage and switch between multiple workspace roots.

This list is open-ended by design: anything beyond the bare-metal core is a plugin.

## 7. Adapters & Testing

- **TUI adapter** ships first: captures keys, paints the widget vocabulary, handles terminal
  resize. It is a separate concern from the core.
- Because the core is headless, a tiny **headless adapter** captures emitted ViewModels as data,
  enabling **snapshot tests of the entire stack with no real TTY**. Core logic is unit-testable
  without a terminal.

## 8. Rebuild & Milestones

- Genuine from-scratch rebuild: the current TUI-coupled, maximalist `src/` is replaced. Git history
  is preserved.
- **Single npm package** ships the core + TUI adapter + bundled default plugins (loaded through the
  public plugin path), rather than a multi-package monorepo.
- **Milestone 1 (usable editor):** core + TUI adapter + the four default plugins → single-pane
  editing with a directory list, command palette, undo/redo, save, and live file-watching.
- Subsequent milestones pull from the future-plugins list (§6) as independent plugin work.
