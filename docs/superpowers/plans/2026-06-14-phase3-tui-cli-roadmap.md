# Phase 3 — TUI Adapter + CLI (Roadmap, for later)

> **Status:** RECORDED FOR LATER — not yet executed. This is a design roadmap, not a finished
> bite-sized TDD plan. When Phase 3 is picked up: (1) do a short design pass on the **Open Decisions**
> below, then (2) run `superpowers:writing-plans` to expand the **Task Outline** into a full
> task-by-task TDD plan, then (3) execute with `superpowers:subagent-driven-development`.

**Goal:** Make `edit` a runnable terminal app — `npx edit [paths…]` opens the single-pane editor in
the terminal, driven by the existing headless core + default plugins. This is the final piece of
Milestone 1.

**Why it's cleanly scoped:** Phases 1–2 deliberately made the core UI-agnostic. Phase 3 implements
exactly one new thing behind a frozen interface (`Adapter`) plus a CLI entrypoint. No core or plugin
changes should be needed — if they are, that's a signal the abstraction leaked and should be
discussed, not patched around.

---

## What already exists to build on

- **`Adapter` interface** (`src/core/adapter.ts`):
  ```ts
  interface Adapter {
    render(frame: Frame): void;          // paint a composed frame
    onKey(handler: KeyHandler): void;    // KeyHandler = (key: string) => void
    dispose(): void;                     // restore terminal
  }
  ```
  `createApp({ adapter, plugins, roots })` already calls `adapter.render(...)` on every
  `view.invalidate()` and forwards `adapter`-reported keys to the bus as `key` events. The
  `HeadlessAdapter` is the reference implementation + test double.
- **Widget vocabulary** the adapter must paint (`src/core/view.ts`): `Frame = Partial<Record<Slot,
  ViewModel>>`, `Slot = 'tree' | 'main' | 'status' | 'overlay'`, and the four widgets:
  - `list` — `{ kind:'list', items: {label, style?}[], selected }`
  - `text` — `{ kind:'text', lines: string[], spans?: StyleSpan[], cursors?: number[], scroll? }` (cursors are FLAT offsets into the joined text)
  - `status` — `{ kind:'status', segments: string[] }`
  - `overlay` — `{ kind:'overlay', title?, body: Widget }` (a floating panel over the rest)
- **Key-naming contract** the adapter MUST satisfy (phase2-contracts §C) — the keymap plugin depends
  on these exact tokens:
  - Printable characters → the literal single character (incl. shift, e.g. `'A'`, and `' '` for space).
  - Named keys → `'enter'`, `'tab'`, `'space'`, `'backspace'`, `'escape'`, `'up'`, `'down'`,
    `'left'`, `'right'`, `'home'`, `'end'`.
  - Chords → `'ctrl+s'`, `'ctrl+z'`, `'ctrl+y'`, `'ctrl+p'`, `'alt+left'`, `'alt+right'`, etc.
  - If a real terminal can't produce a token a default binding needs, the binding (in the relevant
    plugin) is what moves — not the contract.
- **`defaultPlugins()`** (`src/plugins/index.ts`) — the plugin set to mount.
- **Known M1 limitations** (spec §9) the TUI inherits/owns: columns are UTF-16 offsets (the TUI owns
  visual-width mapping when it cares); async key-dispatch window.

---

## Proposed file structure

```
src/adapters/tui/
  tui-adapter.ts     TuiAdapter implements Adapter: wires input + render + lifecycle to a real TTY
  key-decoder.ts     pure: raw stdin bytes/string -> key token(s) per the §C contract
  renderer.ts        pure-ish: (Frame, {cols, rows}) -> a screen grid / ANSI string; layout + paint
  layout.ts          pure: slot geometry (tree width, main region, status row, overlay box) from {cols, rows}
  terminal.ts        thin TTY side effects: raw mode, alt screen, cursor show/hide, write, resize events
src/cli.ts           entrypoint: arg/flag parse, root + config resolution, construct app, run loop, signals, cleanup
tests/adapters/tui/  unit tests for key-decoder, layout, renderer (snapshot the grid — no real TTY)
tests/cli.test.ts    arg parsing + root/config resolution (pure parts)
```

Keep the **pure** parts (`key-decoder`, `layout`, `renderer`) separate from the **side-effecting**
part (`terminal`) so the bulk is unit-testable without a TTY — same testability principle as the
headless core. `package.json` `bin` already points at `dist/cli.js`.

---

## Open Decisions (resolve in a short design pass before writing the full plan)

1. **Key decoding: hand-rolled vs dependency.** The project is zero-runtime-dep so far. A from-scratch
   ANSI-escape decoder (arrows/home/end/alt/ctrl) is ~100 lines and keeps that property; alternatives
   pull in a TTY/keypress lib. Recommendation: hand-rolled `key-decoder.ts` (pure, fully testable),
   stay zero-dep. Decide.
2. **Render strategy: full repaint vs diff.** Frames are small (one screen). Start with full repaint
   each `render()` (simplest, correct); add line/cell diffing later only if flicker/perf demands.
   Decide whether to even bother with diffing for M1.
3. **Tree collapsibility & width.** Spec says the tree is always visible and collapsible. Decide
   fixed width vs ratio, and whether "collapse" (alt+left semantics already in directory-list) hides
   to a thin gutter or a fixed column. May need a small directory-list view tweak — discuss if so.
4. **Styling/color for M1.** `StyleSpan`/`style` fields exist but the themes plugin is future. Decide
   how much color M1 ships (plain + a selection highlight + a status bar is probably enough).
5. **Quit & lifecycle.** Need an `app.quit` path: a binding (e.g. `global:ctrl+q`) → tear down
   (`app.dispose()`), restore the terminal, exit. Decide whether quit is a tiny plugin or wired in the
   CLI, and the unsaved-changes prompt behavior (likely: a future concern; M1 may just warn or quit).
6. **Cross-platform raw input.** `process.stdin.setRawMode` + ANSI works on macOS/Linux and modern
   Windows terminals. Decide how much legacy-Windows effort M1 takes (likely: target modern terminals).

---

## Task Outline (to be expanded into bite-sized TDD tasks)

1. **`key-decoder.ts`** (pure, TDD): map input chunks → key tokens. Cases: printables (incl. UTF-8
   multibyte), `\r`/`\n`→`enter`, `\t`→`tab`, ` `→`space`, `0x7f`/`\b`→`backspace`, `\x1b`→`escape`,
   CSI arrows (`\x1b[A/B/C/D`→up/down/right/left), home/end (`\x1b[H`/`\x1b[F` and `\x1b[1~`/`\x1b[4~`),
   `alt+<x>` (`\x1b` prefix), `ctrl+<letter>` (0x01–0x1a → `ctrl+a`…`ctrl+z`). Snapshot-tested table.
2. **`layout.ts`** (pure, TDD): given `{cols, rows}`, compute regions for tree/main/status/overlay
   (incl. overlay centering + tree width/collapse). Pure geometry, fully tested.
3. **`renderer.ts`** (pure, TDD): given a `Frame` + layout, produce a screen grid (2D array of cells
   or an ANSI string). Paint each widget kind; place the editor cursor from the `text` widget's flat
   `cursors[0]` mapped to row/col; render the selected list row; draw the overlay box on top.
   Snapshot the grid as text — no TTY.
4. **`terminal.ts`** (thin side effects): enter/exit alt screen + raw mode, hide/show cursor, write
   frames, emit resize `{cols, rows}`, restore on exit. Minimal logic; tested with a fake stream where
   feasible, manually otherwise.
5. **`tui-adapter.ts`** (integration): implement `Adapter` — on construct, set up terminal + wire
   stdin through `key-decoder` to the `onKey` handler; `render(frame)` → `renderer` → `terminal.write`;
   handle resize → re-render last frame; `dispose()` → restore terminal. Test with a fake terminal +
   the existing plugins via `createApp` (assert decoded keys drive the app and frames paint).
6. **quit handling**: `app.quit` command + `global:ctrl+q` binding (tiny plugin or CLI-wired) that
   disposes the app and restores the terminal.
7. **`cli.ts`** (TDD the pure parts): parse `edit [paths…]`, `--help`/`-h`, `--version`/`-v`,
   `--config <path>`; resolve workspace roots (dedupe, validate existence) and load
   `~/.edit/config.json`; construct `createApp({ adapter: new TuiAdapter(), plugins: defaultPlugins(),
   roots, config })`; install signal handlers (SIGINT/SIGTERM → dispose + exit); run.
8. **End-to-end manual smoke + an automated `createApp`-with-fake-TTY test**: open a real temp dir,
   feed decoded key sequences, assert the rendered grid reflects open/type/save/undo/palette — the TUI
   analog of the Phase 2 integration test.

---

## Testing strategy

- **Pure modules** (`key-decoder`, `layout`, `renderer`) get the bulk of the coverage via `node:test`
  snapshot tests — no real terminal.
- **`tui-adapter`** is tested by injecting a fake terminal (in-memory stdin/stdout) so the whole
  core+plugins+adapter stack can be exercised headlessly, mirroring the headless-adapter approach.
- **`cli.ts`** arg/root/config parsing is unit-tested; the actual process wiring is thin and smoke-
  tested manually (`npx .` / `node dist/cli.js <dir>`).
- Gate: `npm test` green + `npm run build` emits a working `dist/cli.js` that launches.

---

## Definition of done (Milestone 1 complete)

`npx edit <dir>` opens a terminal editor: directory tree on the left, editor in the center, status
line, command palette overlay; arrow/printable/ctrl keys work per the bindings; open from the tree,
edit, save, undo/redo, and live file-watching all function; quitting restores the terminal cleanly.
