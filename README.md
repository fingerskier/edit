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
