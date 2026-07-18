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
npx @fingerskier/edit                 # open in the current directory
npx @fingerskier/edit path/to/file    # open a file
npx @fingerskier/edit some/dir        # open a directory
```

The `edit` binary is also available after install (`npm i -g @fingerskier/edit`).

```
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit
  --config <path>  Use the given config file
  --theme <path>   Reserved for the upcoming themes plugin
  --no-lsp         Reserved for the upcoming LSP plugin
```

Quit with `Ctrl+Q`.

## What works today

- **Terminal UI**: nested multi-root **directory tree** (left), single editor
  pane (center) with an **editor tab strip** when multiple files are open,
  status bar (bottom), command-palette overlay, and a bottom **panel** region
  for plugins.
- **Editing**: insert/delete, caret movement (arrows, Home/End, vertical with a
  sticky goal column), and full **undo/redo** over reversible operations.
- **Files**: open from the tree (Enter expands folders / opens files), **save**
  (`Ctrl+S`) with optional autosave, and live **file-watching** that refreshes
  expanded branches.
- **Command palette** (`Ctrl+P`) with **fuzzy** matching over every registered
  command.
- **Quick open** (`Ctrl+O`) fuzzy-picks any file under the workspace roots.
- **Dirty guards**: closing a tab or quitting prompts before discarding unsaved
  buffers.
- **Multi-contributor status bar**: independent plugins each own status items.
- **Customizable keybindings** via JSON config.
- **Plugin model**: `activate(ctx)` lifecycle, disposable subscriptions, and
  contribution registries for commands, keybindings, views, and services — with
  multi-contributor view slots and a reusable fuzzy `quickInput` service.
  Drop `.js`/`.mjs` plugins into `~/.edit/plugins/` or list packages under
  `plugins.load` in config.

## On the roadmap (each a plugin or a small core API)

Multiple cursors · clipboard history · syntax highlighting · themes · LSP
(diagnostics, definition, hover, symbols) · git/SCM decorations · global search ·
diff view · integrated terminal & problems/output panels · settings UI · a plugin
manifest with lazy activation · an install/enable/disable manager ·
`TreeDataProvider` abstraction. See [`TODO.md`](./TODO.md) for the phased plan.

## Hotkeys and config

Default keys (all rebindable):

| Key | Action |
| --- | --- |
| Arrow keys | Move the caret in the editor |
| Home / End | Line start / end |
| `Alt+Left` / `Alt+Right` | Focus the tree / the editor |
| Up / Down (in tree) | Move selection |
| Enter (in tree) | Open file, or expand/collapse folder |
| Left / Right (in tree) | Collapse / expand folder |
| `Ctrl+S` | Save the file |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+P` | Command palette |
| `Ctrl+O` | Quick open file |
| `Ctrl+PageDown` / `Ctrl+PageUp` | Next / previous editor tab |
| `Ctrl+W` | Close the active tab |
| `Ctrl+Q` | Quit |

Keys resolve as `<context>:<key>` → command id, where context is the focused
region (`editor`, `tree`, `quickInput`, …). Override bindings in
`~/.edit/config.json` (or `edit --config <path>`):

```json
{
  "keymap": {
    "keybindings": { "global:ctrl+shift+p": "palette.open" }
  },
  "plugins": {
    "load": [],
    "disable": []
  },
  "save": { "autosaveMs": 0 }
}
```

- Per-plugin settings live under the plugin name key; each plugin receives its
  slice as `ctx.config`.
- `plugins.load` — npm package names or absolute module URLs to activate after
  the built-ins.
- `plugins.disable` — built-in plugin names to skip (e.g. `"status-bar"`).
- Loose plugins: any default-exporting `.js` / `.mjs` file in `~/.edit/plugins/`.

## Develop

```bash
npm install
npm run build     # tsc -> dist/
npm test          # node --test (headless; no real TTY needed)
npm run dev        # run from source via tsx
```

CI runs `npm test` + `npm run build` on Node 20/22 (Ubuntu, macOS) and Node 22
(Windows). Publishing is via GitHub Release / workflow_dispatch once the
`NPM_TOKEN` repository secret is set, or locally:

```bash
npm login
npm publish --access public
```

The core is UI-agnostic, so the whole stack (core + plugins + a headless adapter
that captures rendered frames as data) is testable without a terminal. To write
a plugin, export a `default` object with a `name` and `activate(ctx)`; register
commands/keybindings/views/services and push their disposers onto
`ctx.subscriptions`.
