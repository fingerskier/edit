// Example Fedit plugin: a word count in the status bar, plus a command that
// uppercases the selection.
//
// Install: copy this file into your Fedit plugins folder
// ("Plugins: Open Plugins Folder" in the command palette), then run
// "Developer: Reload Window".

export default {
  name: 'word-count',

  activate(ctx) {
    const { EditorView } = ctx.codemirror.view;
    const item = ctx.statusBar.createItem({ align: 'right', priority: 10, tooltip: 'Words in this file' });

    const update = () => {
      const words = ctx.editor.getText().split(/\s+/).filter(Boolean).length;
      item.text = ctx.editor.activePath || words ? `${words} words` : '';
    };

    // Recount when another tab is shown and whenever the document changes.
    ctx.events.on('editor:activated', update);
    ctx.editor.addExtension(EditorView.updateListener.of((u) => u.docChanged && update()));

    ctx.commands.register(
      'wordCount.uppercaseSelection',
      () => ctx.editor.replaceSelection(ctx.editor.getSelection().toUpperCase()),
      'Word Count: Uppercase Selection',
    );
    ctx.keybindings.add({ key: 'ctrl+alt+u', command: 'wordCount.uppercaseSelection', when: 'editorTextFocus' });

    update();
  },
};
