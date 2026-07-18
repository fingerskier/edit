# Roadmap

Phased plan for **`edit` — a VS Code for the CLI** (extensibility model). This
supersedes the original `M0–M5` checklist, which tracked the abandoned
monolithic design. See [`SPECIFICATION.md`](./SPECIFICATION.md) for context.

Legend: `[x]` shipped · `[~]` partial · `[ ]` not started.

## Status & handoff

- **Shipped (PR #6):** multi-contributor view slots, status-bar item API, bottom
  panel, fuzzy `quickInput` + `CommandMeta.internal`.
- **Shipped (editor tabs):** P1 complete — `tabs` slot + widget, TUI strip above
  the editor, `tabs.next` / `tabs.prev` / `tabs.close` (`Ctrl+PageDown` /
  `Ctrl+PageUp` / `Ctrl+W`). Dirty marker on tab labels.
- **Shipped (MVP slice):** CLI loads `config.plugins.load` + `~/.edit/plugins/*`,
  `plugins.disable` filters defaults; dirty-close + dirty-quit prompts; fuzzy
  file quick-open (`Ctrl+O` / `file.quickOpen`).
- **Shipped (nested tree + package name):** collapsible multi-root directory
  tree; package renamed to **`@fingerskier/edit`**.
- **Shipped (CI):** GitHub Actions CI + publish workflows. First npm publish
  still needs an authenticated `npm publish` (or a GitHub Release with
  `NPM_TOKEN` secret). `npm pack --dry-run` OK (~31 kB, 39 files).
- **Next up:** first registry publish (blocked on `npm login`), then
  `TreeDataProvider` / key-dispatch race as desired.
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

## P1 — Workbench foundations ✅
- [x] Multi-contributor view slots resolved by priority (no more last-writer-wins).
- [x] Status-bar **item** API (`ctx.statusBar.createItem`) — many plugins compose the bar.
- [x] Bottom **panel** slot (output/problems/terminal region) + renderer/layout.
- [x] Editor **tabs** over the existing multi-document `DocumentSet` (`tabs` slot +
      strip above main; next/prev/close commands).

## P2 — Extension platform
- [x] Reusable fuzzy **`quickInput`** service + subsequence fuzzy scorer (`core/fuzzy.ts`).
- [x] `CommandMeta.internal` to hide transient UI commands from the palette.
- [x] CLI loads external plugins (`config.plugins.load` + `~/.edit/plugins/*.js|mjs`)
      and can `disable` default plugins by name.
- [ ] **`TreeDataProvider`** abstraction (re-base directory-list on it; let other plugins contribute trees).
- [ ] **Decorations** API (gutter/inline) for diagnostics, git, search highlights.
- [ ] **Settings/config schema** contribution (defaults + validation; a settings quick-pick).
- [ ] Plugin **manifest** (`contributes`/`activationEvents`/`engines`) + **lazy activation**.
- [ ] **Menu / context-menu** contribution points; chorded keys + `when`-clause predicates.

## P3 — Distribution
- [ ] `edit plugin add/remove/list/enable/disable` CLI.
- [ ] Manifest-based install; version/engine compatibility checks.
- [ ] Per-workspace plugin recommendations.
- [x] npm package rename → `@fingerskier/edit`.
- [x] CI workflow (`.github/workflows/ci.yml` — Node 20/22 × ubuntu/macos + win22).
- [x] Publish workflow (`.github/workflows/publish.yml` — release / manual; needs `NPM_TOKEN`).
- [ ] First registry publish of `@fingerskier/edit` (requires `npm login` + push).

## P4 — Flagship plugins (each validates a P2 API)
- [x] `fuzzy-open` — workspace file quick-open (recursive index + `quickInput`).
- [x] Dirty-close / dirty-quit confirm via `quickInput`.
- [x] Nested, collapsible, **multi-root** tree (`directory-list` expand/collapse).
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
