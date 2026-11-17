# Writing Fedit plugins

A plugin is an ES module whose default export has an `activate(ctx)` function.

```js
export default {
  name: 'my-plugin',          // optional; defaults to the file or package name
  activate(ctx) { /* register things */ },
};
```

## Where plugins come from

Fedit loads, in this order:

1. every `.js` / `.mjs` file in `<config>/plugins/`
   (**Plugins: Open Plugins Folder** opens it);
2. every package installed with `fedit plugin add <pkg>`, which runs
   `npm install` inside `<config>/plugins/`;
3. every entry of the `plugins.load` setting: an absolute path to a file or a
   package folder, or the name of a package in `<config>/plugins/node_modules`.

Names listed in the `plugins.disable` setting are skipped. **Plugins: Show
Loaded Plugins** lists what was loaded and any load errors. After changing
plugins, run **Developer: Reload Window**.

For a package, the entry file is `fedit.main` in its `package.json`, then
`module`, then `main`, then `index.js`.

A plugin file is loaded on its own, in the app's webview, so:

- it must be a **single self-contained ES module**. Relative and bare imports
  will not resolve; bundle dependencies into one file if you have any;
- it has browser APIs, not Node APIs. Use `ctx.fs` for files;
- do not bundle your own copy of CodeMirror. Use `ctx.codemirror`, which is the
  editor's own instance; a second copy will not interoperate with it.

Plugins are trusted code: they can read and write any file you can.

## The context

Each `register`/`add`/`on` call returns a function that removes that
registration again.

### `ctx.commands`

```js
ctx.commands.register(id, run, title?)   // title makes it appear in the palette
ctx.commands.execute(id, args?)          // run any command, including built-ins
```

A command that returns `false` reports "not handled": the key that triggered it
is passed on to the editor.

### `ctx.keybindings`

```js
ctx.keybindings.add({ key: 'ctrl+alt+u', command: 'my.command', when: 'editorTextFocus' })
```

Same format as `keybindings.json`. Plugin bindings sit above the defaults and
below the user's own rules, so users can always rebind or remove them.

### `ctx.editor`

```js
ctx.editor.view                 // the CodeMirror EditorView (shared by all tabs)
ctx.editor.activePath           // path of the active file, or null
ctx.editor.language             // e.g. "JavaScript"
ctx.editor.getText()
ctx.editor.getSelection()
ctx.editor.replaceSelection(text)
ctx.editor.addExtension(ext)    // a CodeMirror extension, applied to every tab
```

### `ctx.workspace`

```js
ctx.workspace.folder            // the open folder, or null
ctx.workspace.openFiles         // paths of the open tabs
ctx.workspace.open(path)        // open a file, or switch to a folder
```

### `ctx.events`

```js
ctx.events.on('file:saved', ({ path }) => { … })
```

| Event | Payload |
| --- | --- |
| `file:opened`, `file:saved`, `file:closed` | `{ path }` |
| `editor:activated` | `{ path }` — another tab became active |
| `folder:changed` | `{ path }` — `null` when the folder is closed |
| `settings:changed` | none |

### `ctx.statusBar`

```js
const item = ctx.statusBar.createItem({ align: 'right', priority: 10, tooltip: '…', onClick() {} });
item.text = '42 words';         // an empty text hides the item
item.dispose();
```

### `ctx.ui`

```js
const choice = await ctx.ui.pick([{ label: 'One', description: '…', value: 1 }], { placeholder: 'Pick' });
const name = await ctx.ui.prompt({ placeholder: 'Name', value: 'x', validate: (v) => (v ? undefined : 'Required') });
ctx.ui.notify('Done');          // second argument: 'info' | 'warn' | 'error'
```

`pick` and `prompt` resolve `undefined` when dismissed.

### `ctx.languages`

Add highlighting for a file type with any CodeMirror language package you have
bundled:

```js
ctx.languages.register({
  name: 'Foo',
  extensions: ['foo'],
  load: async () => fooLanguageSupport,
});
```

### `ctx.fs`

```js
await ctx.fs.readFile(path)     // { kind: 'text' | 'binary' | 'large', content, mtime, size }
await ctx.fs.writeFile(path, text)
await ctx.fs.readDir(path)      // [{ name, path, isDir }]
await ctx.fs.stat(path)         // { kind: 'file' | 'dir' | 'none', mtime, size }
await ctx.fs.openExternal(path) // open in the system default app
```

### `ctx.config`

```js
ctx.config.get('myPlugin.enabled', true)   // any key of settings.json
```

### `ctx.codemirror`

The editor's CodeMirror modules: `state`, `view`, `language`, `commands`,
`search`, `autocomplete` (`@codemirror/state`, `@codemirror/view`, and so on).

```js
const { EditorView } = ctx.codemirror.view;
ctx.editor.addExtension(EditorView.theme({ '.cm-content': { caretColor: 'orange' } }));
```

## Built-in command ids

Command ids follow VS Code where an equivalent exists, for example
`workbench.action.files.save`, `workbench.action.quickOpen`,
`workbench.action.showCommands`, `workbench.action.toggleSidebarVisibility`,
`editor.action.commentLine`, `actions.find`. **Preferences: Open Default
Keyboard Shortcuts** lists every default binding with its command id.

A complete example is in [`examples/word-count.js`](../examples/word-count.js).
