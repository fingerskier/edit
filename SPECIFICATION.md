# SPECIFICATION

> **Status.** This is the canonical product spec. It supersedes the original
> "ultra-simple monolithic editor" spec and its `M0–M5` milestones. The
> authoritative **architecture** lives in
> [`docs/superpowers/specs/2026-06-13-pluggable-editor-design.md`](./docs/superpowers/specs/2026-06-13-pluggable-editor-design.md);
> the **API contracts** in
> [`docs/superpowers/plans/phase2-contracts.md`](./docs/superpowers/plans/phase2-contracts.md).

## 1. Vision

Build **`edit`**: **a VS Code for the CLI** — a fast, keyboard-driven terminal
editor distributed as an `npx` binary, whose power comes from a VS Code-style
**plugin ecosystem**.

"VS Code for the CLI" means VS Code's **extensibility model**, not its full
feature set:

- A deliberately **minimal headless core** provides only *mechanism* (text
  buffer, documents, events, file I/O, watcher, plugin host, contribution
  registries).
- **Adapters** render — a Terminal UI today; a web/GUI adapter is possible later
  because the core is UI-agnostic.
- **Plugins** provide *every visible feature*. The editor pane, the directory
  list, the keymap, and the command palette are themselves plugins, authored
  against the same public API third-party plugins use.

Primary goals: open instantly, stay responsive on large files, keyboard-first
with fully customizable keys, and an extension surface rich enough that the
interesting work happens in plugins.

### Non-goals (v1)

- **Feature parity with VS Code.** We adopt its *architecture* and the
  highest-leverage workbench concepts (command palette, multi-contributor
  regions, a bottom panel, eventually editor tabs), not its full feature list.
- **Multi-pane *splits*** (one active editor at a time; tabs come before splits).
- **Sandboxed/untrusted plugin execution** (plugins run in-process and trusted —
  the right trade-off for a personal editor).
- Rich WYSIWYG.

## 2. Architecture (summary)

```
 raw keys ─▶ adapter ─▶ core event bus ─▶ keymap plugin ─▶ command registry
                ▲                                                │
                │                                        commands mutate
          paints widgets                                buffer / selection /
                │                                        active document
         view composer ◀── view plugins emit ViewModels ◀── state-change events
```

The core is bare-metal: it knows nothing about trees, search, syntax, or themes.
Plugins receive `activate(ctx)` with contribution registries and push every
registration's disposer onto `ctx.subscriptions` (drained on deactivate). The
**view composer** resolves multiple contributors per slot by priority and hands
the composed frame to the active adapter. Full details in the design spec above.

### Contribution surface (current)

- `ctx.commands` — register/run command ids (with `internal` to hide UI commands).
- `ctx.keys` — bind `"<context>:<key>"` → command id.
- `ctx.view.contribute(slot, provider, { priority })` — multi-contributor slots
  (`tree`, `main`, `status`, `panel`, `overlay`).
- `ctx.statusBar.createItem(...)` — independent, composited status-bar items.
- `ctx.events` — pub/sub of past-tense facts.
- `ctx.workspace` / `ctx.fs` — documents, edits, file I/O, watcher.
- `ctx.services` — register/get shared services (e.g. `focus`, `quickInput`).

## 3. Distribution and runtime

- Published to npm as `edit`; `bin` exposes the `edit` command; runs under `npx`.
- **Node ≥20, TypeScript, ESM.** A Terminal UI adapter ships first.
- Plugins are npm packages listed in config **plus** loose `.mjs`/`.js` files in
  `~/.edit/plugins/`. (A declarative manifest + lazy activation + an
  install/manage CLI are planned — see §7.)

## 4. UX and interaction

- **Layout**: directory list (left), one active editor (center), status bar
  (bottom), an optional bottom **panel** (output/problems/terminal), and a
  centered **overlay** (command palette / quick input).
- **Keyboard model**: every action is a command id; keys resolve as
  `"<context>:<key>"` against the focused context (`editor`, `tree`,
  `quickInput`, …), then `global:`. Chorded keys and `when`-style predicates are
  planned.
- **Mouse**: minimal (focus, cursor, scroll, expand/collapse) — later.

## 5. Data structures & algorithms

- **Text buffer**: an interface (`TextBuffer`) with edits expressed as
  **reversible operations** (apply/invert) so a history plugin can stack undo.
  A `StringBuffer` is the default; a **piece-table** implementation is deferred
  behind the same interface. Target typing latency < 5 ms median.
- **Undo/redo**: command log of inverse ops with typing coalescing; the
  `document:changed` event carries `inverse` and `selBefore` so history restores
  the caret exactly.
- **Multiple cursors** (planned): sorted non-overlapping selections, edits
  applied in reverse document order.
- **Fuzzy matching** (shipped): subsequence scoring with boundary/camelCase/
  consecutive bonuses (`core/fuzzy.ts`), used by the `quickInput` service.

## 6. Configuration & persistence

- Config precedence: CLI args → workspace `.edit/config.json` → user
  `~/.edit/config.json` → defaults. Config is keyed by plugin name; each plugin
  gets its slice as `ctx.config`.
- Keymaps: JSON keybinding overrides; conflict detection planned.
- Auto-save: debounced, dirty-only, atomic write (temp + rename) — planned
  hardening for the atomic path.
- Themes (planned): style-token schema; live reload; the `StyleSpan` widget
  field exists for syntax/theme styling.

## 7. Roadmap

The phased plan (supersedes `M0–M5`) lives in [`TODO.md`](./TODO.md). In short:

- **P0 Core foundation** — headless core, registries, plugin host. ✅
- **M1 Usable editor** — TUI + default plugins (single-pane edit, tree, palette,
  undo/redo, save, watch). ✅
- **P1 Workbench foundations** — multi-contributor slots ✅, status-bar items ✅,
  bottom panel ✅, editor tabs (next).
- **P2 Extension platform** — fuzzy `quickInput` ✅; then `TreeDataProvider`,
  decorations API, settings/config schema, plugin manifest + lazy activation,
  menu contributions.
- **P3 Distribution** — install/enable/disable/update UX; manifest-based;
  workspace recommendations.
- **P4 Flagship plugins** — fuzzy-open, nested multi-root tree, syntax
  highlighting, LSP, themes, git, search, integrated terminal, multi-cursor,
  clipboard-history.
- **P5 Hardening** — perf under decorations/large files, the async key-dispatch
  race, cross-platform keys, CI matrix, a public `edit` API types package.

## 8. Performance & reliability

- Cold start target: < 150 ms to first frame (without language servers).
- No dropped keypresses under sustained typing; responsive on files up to
  5–20 MB in v1.
- Lazy plugin activation (planned) keeps startup flat as the ecosystem grows.
- Crash safety: error-isolated event listeners and view providers already
  degrade only the offending listener/slot; a dirty-buffer recovery journal is a
  later addition.

## 9. Cross-platform

macOS, Linux, and modern Windows terminals. Platform-aware paths, a key
normalization layer, and a watcher backend per platform; CI matrix in P5.

## 10. Testing strategy

- **Unit**: buffer ops, selection mapping, keybinding/chord resolution, the
  fuzzy scorer, layout/renderer geometry.
- **Integration**: open/edit/save/undo flows, watcher-driven tree refresh, the
  quick-input/palette path — all driven through a **headless adapter** that
  captures rendered frames as data (no real TTY).
- **E2E smoke**: launch via the CLI; a TUI adapter test feeds decoded keys and
  snapshots the screen grid.

## 11. Acceptance criteria (v1)

`npx edit` works on macOS/Linux/Windows without manual build steps; single-pane
editing is smooth with undo/redo; the tree is always visible and navigable;
auto-save and file-watching are reliable; the command palette and customizable
keybindings work; and the plugin API is stable enough that a third party can
ship a feature (e.g. syntax highlighting or LSP) as an external plugin.
