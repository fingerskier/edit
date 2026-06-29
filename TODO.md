# Roadmap

Phased plan for **`edit` — a VS Code for the CLI** (extensibility model). This
supersedes the original `M0–M5` checklist, which tracked the abandoned
monolithic design. See [`SPECIFICATION.md`](./SPECIFICATION.md) for context.

Legend: `[x]` shipped · `[~]` partial · `[ ]` not started.

## Status & handoff

- **Shipped (PR #6):** all of **P1** except editor tabs — multi-contributor view
  slots, the status-bar item API, and the bottom panel slot — plus the first
  **P2** slice: the reusable fuzzy `quickInput` service + `CommandMeta.internal`.
  Reconciled the vision/roadmap docs. 261 tests green.
- **Next up (separate PR):** **editor tabs** (closes out P1; `DocumentSet`
  already holds the docs — needs a tab-strip in `main` + a close-document
  command), then **`TreeDataProvider`** (re-bases the flat directory-list into a
  nested, multi-root tree and unblocks SCM/diagnostics trees).
- Pick up from this checklist; mark items `[x]` as they land and keep
  `SPECIFICATION.md` §7 / `README.md` in sync.

## P0 — Core foundation ✅
- [x] Headless core: event bus, document/document-set, reversible-op buffer, file I/O, watcher.
- [x] Plugin host: `activate(ctx)`/`deactivate`, `ctx.subscriptions` disposal.
- [x] Contribution registries: commands, keybindings, views, services.
- [x] UI-agnostic adapter interface + headless adapter for tests.

## M1 — Usable editor ✅
- [x] TUI adapter (key decoder, layout, renderer, terminal) + `edit` CLI entrypoint.
- [x] Default plugins: keymap (focus stack + sole key listener), editor-view,
      directory-list, history (undo/redo), save (+ autosave), command-palette, status-bar.
- [x] Single-pane edit, open from tree, save, undo/redo, live file-watch, quit.

## P1 — Workbench foundations
- [x] Multi-contributor view slots resolved by priority (no more last-writer-wins).
- [x] Status-bar **item** API (`ctx.statusBar.createItem`) — many plugins compose the bar.
- [x] Bottom **panel** slot (output/problems/terminal region) + renderer/layout.
- [ ] Editor **tabs** over the existing multi-document `DocumentSet` (one active doc;
      tab-strip widget in `main`).

## P2 — Extension platform
- [x] Reusable fuzzy **`quickInput`** service + subsequence fuzzy scorer (`core/fuzzy.ts`).
- [x] `CommandMeta.internal` to hide transient UI commands from the palette.
- [ ] **`TreeDataProvider`** abstraction (re-base directory-list on it; let other plugins contribute trees).
- [ ] **Decorations** API (gutter/inline) for diagnostics, git, search highlights.
- [ ] **Settings/config schema** contribution (defaults + validation; a settings quick-pick).
- [ ] Plugin **manifest** (`contributes`/`activationEvents`/`engines`) + **lazy activation**.
- [ ] **Menu / context-menu** contribution points; chorded keys + `when`-clause predicates.

## P3 — Distribution
- [ ] `edit plugin add/remove/list/enable/disable` CLI.
- [ ] Manifest-based install; version/engine compatibility checks.
- [ ] Per-workspace plugin recommendations.

## P4 — Flagship plugins (each validates a P2 API)
- [ ] `fuzzy-open` — workspace file quick-open (recursive index + `quickInput`).
- [ ] Nested, collapsible, **multi-root** tree (current directory-list is flat, single-root).
- [ ] `multiple-cursors`, `clipboard-history`.
- [ ] `syntax-highlighting` (tree-sitter) via the decorations API.
- [ ] `lsp` — diagnostics (panel + decorations), definition, hover, document symbols.
- [ ] `themes` (the `StyleSpan`/`style` fields finally drive color).
- [ ] `git` (gutter + status), `search` (panel + decorations), `terminal` (panel).

## P5 — Hardening
- [ ] Piece-table buffer behind the existing `TextBuffer` interface; large-file perf.
- [ ] Fix the async key-dispatch race (serialize dispatch behind the in-flight command).
- [ ] Cross-platform key normalization; CI matrix (unit + integration + smoke on macOS/Linux/Windows).
- [ ] Atomic-write autosave + dirty-buffer recovery journal.
- [ ] Publish a stable `edit` API types package for third-party plugin authors.
