# edit

**A VS Code for the CLI** — a fast, keyboard-driven terminal text editor whose
power comes from a VS Code-style plugin model. Run it with `npx`, no install.

> **Positioning.** "VS Code for the CLI" here means VS Code's *extensibility
> model*, not its full feature set: a deliberately minimal **headless core**
> provides only mechanism, **adapters** render (a terminal UI today), and
> **plugins** provide every visible feature — the editor pane, the directory
> list, the keymap, and the command palette are all plugins. See
> [`SPECIFICATION.md`](./SPECIFICATION.md) for the vision and roadmap and
> [`docs/superpowers/specs/2026-06-13-pluggable-editor-design.md`](./docs/superpowers/specs/2026-06-13-pluggable-editor-design.md)
> for the architecture.

## Try it

```bash
npx edit                 # open in the current directory
npx edit path/to/file    # open a file
npx edit some/dir        # open a directory
```

```
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit
  --config <path>  Use the given config file
  --theme <path>   Reserved for the upcoming themes plugin
  --no-lsp         Reserved for the upcoming LSP plugin
```

Quit with `Ctrl+Q`.

## What works today

- **Terminal UI**: directory list (left), single editor pane (center), status
  bar (bottom), command-palette overlay, and a bottom **panel** region for
  plugins.
- **Editing**: insert/delete, caret movement (arrows, Home/End, vertical with a
  sticky goal column), and full **undo/redo** over reversible operations.
- **Files**: open from the tree, **save** (`Ctrl+S`) with optional autosave, and
  live **file-watching** that re-lists on change.
- **Command palette** (`Ctrl+P`) with **fuzzy** matching over every registered
  command.
- **Multi-contributor status bar**: independent plugins each own status items.
- **Customizable keybindings** via JSON config.
- **Plugin model**: `activate(ctx)` lifecycle, disposable subscriptions, and
  contribution registries for commands, keybindings, views, and services — with
  multi-contributor view slots and a reusable fuzzy `quickInput` service.

## On the roadmap (each a plugin or a small core API)

Nested/collapsible & multi-root tree · fuzzy file quick-open · multiple cursors ·
clipboard history · syntax highlighting · themes · LSP (diagnostics, definition,
hover, symbols) · git/SCM decorations · global search · diff view · integrated
terminal & problems/output panels · editor tabs · settings UI · a plugin
manifest with lazy activation · an install/enable/disable manager. See
[`TODO.md`](./TODO.md) for the phased plan.

## Hotkeys and config

Default keys (all rebindable):

| Key | Action |
| --- | --- |
| Arrow keys | Move the caret in the editor |
| Home / End | Line start / end |
| `Alt+Left` / `Alt+Right` | Focus the tree / the editor |
| Up / Down / Enter (in tree) | Navigate / open the selection |
| `Ctrl+S` | Save the file |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+P` | Command palette |
| `Ctrl+Q` | Quit |

Keys resolve as `<context>:<key>` → command id, where context is the focused
region (`editor`, `tree`, `quickInput`, …). Override bindings in
`~/.edit/config.json` (or `edit --config <path>`):

```json
{
  "keymap": {
    "keybindings": { "global:ctrl+o": "palette.open" }
  }
}
```

Config is keyed by plugin name; each plugin receives its own slice as `ctx.config`.

## Develop

```bash
npm install
npm run build     # tsc -> dist/
npm test          # node --test (headless; no real TTY needed)
npm run dev        # run from source via tsx
```

The core is UI-agnostic, so the whole stack (core + plugins + a headless adapter
that captures rendered frames as data) is testable without a terminal. To write
a plugin, export a `default` object with a `name` and `activate(ctx)`; register
commands/keybindings/views/services and push their disposers onto
`ctx.subscriptions`.
