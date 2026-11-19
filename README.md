# Fedit

A lightweight, pluggable desktop text editor. It opens fast, uses the keys you
already know from VS Code, and stays out of the way: a file tree, tabs, an
editor, a status bar, and a command palette.

```bash
npx @fingerskier/edit            # install, then open the editor
fedit notes.md                   # afterwards: open a file…
fedit ~/Projects/site            # …or a folder
```

## What it does

- **VS Code keybindings**, all rebindable in a `keybindings.json` that uses VS
  Code's format (key syntax, command ids, chords like `Ctrl+K Ctrl+O`, `when`
  clauses).
- **Syntax highlighting** for 100+ formats, loaded on demand: JavaScript,
  TypeScript, Python, Rust, Go, C/C++, Java, HTML, CSS, JSON, YAML, TOML,
  Markdown, SQL, shell, Dockerfile, and more.
- **Directory tree** you can hide (`Ctrl+B`): open, create, rename, move to
  trash, reveal in the file manager, copy path. It follows changes made by
  other programs.
- **Remembers** recent files and folders (`Ctrl+R`) and restores the last
  session: folder, open tabs, expanded folders, sidebar, zoom.
- **Non-text files** (images, PDFs, archives…) open in the system default app
  instead of showing garbage. So do files over 20 MB.
- **Command palette** (`Ctrl+Shift+P`), quick open (`Ctrl+P`, `name:42` jumps to
  a line), go to line (`Ctrl+G`).
- **Plugins**: plain JavaScript files with access to commands, keybindings, the
  status bar, the editor, and CodeMirror itself. See [docs/plugins.md](docs/plugins.md).
- Multiple cursors, find and replace with regex, code folding, bracket
  matching, auto-indent, indentation detection, LF/CRLF preserved, optional
  autosave, light and dark themes that follow the system.

It is built on [Tauri](https://tauri.app) (the system webview, so the app is a
single binary of about 8 MB) and [CodeMirror 6](https://codemirror.net).

## Install

```bash
npx @fingerskier/edit
```

The first run:

1. installs the package globally, which puts the `fedit` command on your PATH;
2. downloads the app binary for your platform from this version's GitHub
   release (if there is none and you have Rust installed, it builds it);
3. adds a launcher to your application menu, so Fedit can be picked as the
   default text editor;
4. opens the editor.

Requirements: Node 20+ for the launcher. Linux needs WebKitGTK 4.1
(`webkit2gtk-4.1` on Arch/Fedora, `libwebkit2gtk-4.1-0` on Debian/Ubuntu).
Windows needs the WebView2 runtime, which Windows 10 and 11 already include.

```
fedit [path...]            Open files, or a folder, in the editor
fedit install              Install globally and add an application launcher
fedit uninstall            Remove the launcher and downloaded binaries
fedit plugin add <pkg>     Install a plugin package from npm
fedit plugin remove <pkg>  Remove an installed plugin package
fedit plugin list          List plugins

-n, --new-window Open the paths in a new window of the running app
--new-instance   Start a separate, independent copy of the app
--from-source    With install: build the app with cargo instead of downloading
--verbose        Keep the app attached to the terminal and show its output
```

`fedit <path>` while Fedit is running opens the path in the window you used
last; `fedit -n <path>` opens it in a new window instead. **File: New Window**
(`Ctrl+Shift+N`) opens an empty one. Each window has its own folder and tabs,
and closing the last window ends the app. The first window is the one
whose folder and tabs are remembered and reopened next time.
A path that does not exist opens as a new file, created when you save.

## Keys

The defaults follow VS Code on Linux and Windows; on macOS, `Ctrl` becomes `Cmd`.

| Key | Action |
| --- | --- |
| `Ctrl+Shift+P` / `F1` | Command palette |
| `Ctrl+P` | Go to file |
| `Ctrl+G` | Go to line |
| `Ctrl+O` / `Ctrl+K Ctrl+O` | Open file / open folder |
| `Ctrl+R` | Open recent |
| `Ctrl+N` | New file |
| `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+K S` | Save / save as / save all |
| `Ctrl+W` / `Ctrl+K Ctrl+W` | Close tab / close all |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab`, `Ctrl+PageDown` / `Ctrl+PageUp` | Next / previous tab |
| `Alt+1` … `Alt+9` | Go to tab |
| `Ctrl+B` | Show or hide the sidebar |
| `Ctrl+Shift+E` | Focus the file tree (`F2` rename, `Delete` trash, `Enter` open) |
| `Ctrl+F` / `Ctrl+H` | Find / replace |
| `Ctrl+/` / `Shift+Alt+A` | Toggle line / block comment |
| `Alt+Up` / `Alt+Down` | Move line |
| `Shift+Alt+Up` / `Shift+Alt+Down` | Copy line |
| `Ctrl+Shift+K` | Delete line |
| `Ctrl+Enter` / `Ctrl+Shift+Enter` | Insert line below / above |
| `Ctrl+D` / `Ctrl+Shift+L` | Add next occurrence / select all occurrences |
| `Ctrl+Alt+Up` / `Ctrl+Alt+Down` | Add cursor above / below |
| `Ctrl+]` / `Ctrl+[` | Indent / outdent |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | Fold / unfold |
| `Alt+Z` | Toggle word wrap |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Ctrl+,` | Settings |
| `Ctrl+K Ctrl+S` | Keyboard shortcuts |
| `Ctrl+Shift+N` | New window |
| `Ctrl+Shift+W` | Close window |
| `Ctrl+Q` | Quit (closes every window) |

Run **Preferences: Open Default Keyboard Shortcuts** for the complete list.

### Changing keys

`Ctrl+K Ctrl+S` opens `keybindings.json`. Rules there are applied after the
defaults, so they win. Saving applies them immediately.

```jsonc
[
  // Bind a key
  { "key": "ctrl+shift+d", "command": "editor.action.copyLinesDownAction", "when": "editorTextFocus" },
  // Remove a default: the same key, with "-" in front of the command
  { "key": "ctrl+b", "command": "-workbench.action.toggleSidebarVisibility" },
  // Chords work too
  { "key": "ctrl+m ctrl+b", "command": "workbench.action.toggleSidebarVisibility" }
]
```

`when` supports `&&`, `||`, `!`, `==`, `!=` and parentheses over these keys:
`editorTextFocus`, `editorFocus`, `editorHasSelection`,
`editorHasMultipleSelections`, `editorReadonly`, `editorLangId`, `editorIsOpen`,
`filesExplorerFocus`, `inQuickOpen`, `sideBarVisible`, `isMac`, `isLinux`,
`isWindows`.

## Settings

`Ctrl+,` opens `settings.json` (comments and trailing commas are allowed).
Saving applies it immediately.

| Setting | Default | |
| --- | --- | --- |
| `workbench.colorTheme` | `"system"` | `"system"`, `"dark"` or `"light"` |
| `editor.fontSize` | `14` | |
| `editor.fontFamily` | a monospace stack | CSS font-family |
| `editor.tabSize` | `4` | |
| `editor.insertSpaces` | `true` | |
| `editor.detectIndentation` | `true` | Guess tab size and spaces/tabs per file |
| `editor.wordWrap` | `"off"` | `"on"` or `"off"` |
| `editor.lineNumbers` | `"on"` | `"on"` or `"off"` |
| `files.autoSave` | `"off"` | `"afterDelay"` to save automatically |
| `files.autoSaveDelay` | `1000` | Milliseconds |
| `files.trimTrailingWhitespace` | `false` | On save |
| `files.insertFinalNewline` | `false` | On save |
| `files.exclude` | `[".git", ".DS_Store"]` | Names hidden from the tree |
| `explorer.autoReveal` | `true` | Select the active file in the tree |
| `window.restoreSession` | `true` | Reopen the last folder and tabs |
| `plugins.load` | `[]` | Extra plugins: absolute paths, or package names |
| `plugins.disable` | `[]` | Plugin names to skip |

Everything lives in one folder: `~/.config/fedit` on Linux and macOS
(`$XDG_CONFIG_HOME/fedit` if set), `%APPDATA%\fedit` on Windows, or `$FEDIT_HOME`.

```
settings.json      keybindings.json      state.json (recent files, session)
plugins/           bin/ (downloaded app binaries)
```

## Plugins

Drop a `.js` file into the `plugins` folder (**Plugins: Open Plugins Folder**),
or install a package with `fedit plugin add <pkg>`, then run **Developer:
Reload Window**.

```js
export default {
  activate(ctx) {
    ctx.commands.register('hello.world', () => ctx.ui.notify('Hello!'), 'Hello: Say Hello');
    ctx.keybindings.add({ key: 'ctrl+alt+h', command: 'hello.world' });
  },
};
```

The full API is in [docs/plugins.md](docs/plugins.md); a longer example is in
[examples/word-count.js](examples/word-count.js). Plugins run inside the app
with full access to your files, so install only ones you trust.

## Limits

- One folder per window, no split panes. Tabs cannot be moved between windows.
- Files are read and written as UTF-8. A file that is not valid UTF-8 opens
  read-only so it cannot be damaged.
- No language servers: no completion, diagnostics, or go-to-definition.
- `fedit` returns immediately, so it does not work as `$EDITOR` for tools that
  wait for the editor to close (such as `git commit`).

## Develop

```bash
npm install
npm run dev          # the desktop app with hot reload (needs Rust)
npm run dev:ui       # just the UI in a browser, on an in-memory file system
npm test             # unit tests (keybindings, settings, launcher)
npm run test:e2e     # UI tests in a headless browser (Playwright)
npm run test:rust    # backend tests
npm run build        # release binary at src-tauri/target/release/fedit
```

Layout:

```
bin/, lib/     the `fedit` launcher and installer (Node)
ui/            the web UI (TypeScript, CodeMirror 6, no framework)
src-tauri/     the desktop shell and file-system commands (Rust, Tauri 2)
e2e/, tests/   tests
```

Linux build dependencies are listed in the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

### Releasing

Publishing a GitHub release tagged `v<version>` (matching `package.json`) runs
`.github/workflows/release.yml`: it builds the binary for Linux, macOS and
Windows, attaches them to the release, and only then publishes the package to
npm, so `npx` never finds a version without binaries. It needs the `NPM_TOKEN`
repository secret.

## License

MIT
