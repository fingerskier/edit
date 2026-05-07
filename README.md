# edit
npx cli text editor

## Features
- multiple cursors
- always-on collapsible file-tree
- keyboard-driven
- all hotkeys customizable
- clipboard history
- fuzzy search
- multi-directory workspaces
- file-watcher auto-updates
- auto-save
- full undo/redo across all ops
- LSP for syntax highlighting, linking, introspection
- theme editing
- command palette and chained hotkeys
- piece-table text buffering

## Trade-Offs
- directory tree always visible
- only one file editor at a time
- keyboard mostly - base mouse fx

## Milestone 0 status
- TypeScript + Node CLI bootstrap scaffolded
- `edit` binary declared in `package.json`
- Basic argument parsing for `--help` and `--version`
- Renderer skeleton draws tree/editor/status layout
- Command registry includes: `app.quit`, `palette.open`, `tree.focus`, `editor.focus`

## Milestone 1 status
- Added short flag aliases: `-h` and `-v`
- Added workspace root resolution with de-duplication
- Added startup validation for missing paths
- Renderer now displays initial workspace context in the tree pane

## Hotkeys and config
Default hotkeys include:
- `Arrow keys`: navigate the open file
- `Alt+Up` / `Alt+Down`: navigate the directory tree
- `Alt+Left`: collapse tree nodes
- `Alt+Right`: expand directories or open highlighted files
- `Ctrl+O`: fuzzy quick open by path/name
- `Ctrl+S`: save the open file
- `Ctrl+Z` / `Ctrl+Y`: undo / redo edits
- `Ctrl+P`: command palette

Hotkeys can be edited in the global JSON config at `~/.edit/config.json` or via `edit --config <path>`:

```json
{
  "keybindings": {
    "ctrl+x": "quickOpen.open",
    "ctrl+p": "palette.open"
  }
}
```
