// Default keybindings. Keys and command ids follow VS Code, so entries from a
// VS Code keybindings.json mostly carry over. Where a command has several
// keys, the last one listed is the one shown in the palette.

import type { KeybindingRule } from './keybindings.ts';

const E = 'editorTextFocus';
const X = 'filesExplorerFocus';

export const DEFAULT_KEYBINDINGS: KeybindingRule[] = [
  // Files
  { key: 'ctrl+n', command: 'workbench.action.files.newUntitledFile' },
  { key: 'ctrl+o', command: 'workbench.action.files.openFile' },
  { key: 'ctrl+k ctrl+o', command: 'workbench.action.files.openFolder' },
  { key: 'ctrl+r', command: 'workbench.action.openRecent' },
  { key: 'ctrl+s', command: 'workbench.action.files.save' },
  { key: 'ctrl+shift+s', command: 'workbench.action.files.saveAs' },
  { key: 'ctrl+k s', command: 'workbench.action.files.saveAll' },
  { key: 'ctrl+f4', command: 'workbench.action.closeActiveEditor' },
  { key: 'ctrl+w', command: 'workbench.action.closeActiveEditor' },
  { key: 'ctrl+k ctrl+w', command: 'workbench.action.closeAllEditors' },
  { key: 'ctrl+k f', command: 'workbench.action.closeFolder' },
  { key: 'ctrl+shift+t', command: 'workbench.action.reopenClosedEditor' },
  { key: 'ctrl+k r', command: 'revealFileInOS' },
  { key: 'shift+alt+c', command: 'copyFilePath' },
  { key: 'ctrl+shift+n', command: 'workbench.action.newWindow' },
  { key: 'ctrl+shift+w', command: 'workbench.action.closeWindow' },
  { key: 'ctrl+q', command: 'workbench.action.quit' },

  // Navigation
  { key: 'ctrl+p', command: 'workbench.action.quickOpen' },
  { key: 'f1', command: 'workbench.action.showCommands' },
  { key: 'ctrl+shift+p', command: 'workbench.action.showCommands' },
  { key: 'ctrl+g', command: 'workbench.action.gotoLine' },
  { key: 'ctrl+pagedown', command: 'workbench.action.nextEditor' },
  { key: 'ctrl+tab', command: 'workbench.action.nextEditor' },
  { key: 'ctrl+pageup', command: 'workbench.action.previousEditor' },
  { key: 'ctrl+shift+tab', command: 'workbench.action.previousEditor' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ key: `alt+${n}`, command: `workbench.action.openEditorAtIndex${n}` })),

  // Layout
  { key: 'ctrl+b', command: 'workbench.action.toggleSidebarVisibility' },
  { key: 'ctrl+shift+e', command: 'workbench.view.explorer' },
  { key: 'ctrl+1', command: 'workbench.action.focusFirstEditorGroup' },
  { key: 'ctrl+numpad_add', command: 'workbench.action.zoomIn' },
  { key: 'ctrl+shift+=', command: 'workbench.action.zoomIn' },
  { key: 'ctrl+=', command: 'workbench.action.zoomIn' },
  { key: 'ctrl+numpad_subtract', command: 'workbench.action.zoomOut' },
  { key: 'ctrl+-', command: 'workbench.action.zoomOut' },
  { key: 'ctrl+0', command: 'workbench.action.zoomReset' },
  { key: 'ctrl+numpad0', command: 'workbench.action.zoomReset' },
  { key: 'alt+z', command: 'editor.action.toggleWordWrap' },

  // Preferences
  { key: 'ctrl+,', command: 'workbench.action.openSettingsJson' },
  { key: 'ctrl+k ctrl+s', command: 'workbench.action.openGlobalKeybindingsFile' },
  { key: 'ctrl+k m', command: 'workbench.action.editor.changeLanguageMode' },

  // Editing
  { key: 'ctrl+z', command: 'undo', when: E },
  { key: 'ctrl+shift+z', command: 'redo', when: E },
  { key: 'ctrl+y', command: 'redo', when: E },
  { key: 'ctrl+a', command: 'editor.action.selectAll', when: E },
  { key: 'ctrl+x', command: 'editor.action.clipboardCutAction', when: E },
  { key: 'ctrl+c', command: 'editor.action.clipboardCopyAction', when: E },
  { key: 'ctrl+f', command: 'actions.find' },
  { key: 'ctrl+h', command: 'editor.action.startFindReplaceAction' },
  { key: 'f3', command: 'editor.action.nextMatchFindAction' },
  { key: 'shift+f3', command: 'editor.action.previousMatchFindAction' },
  { key: 'ctrl+/', command: 'editor.action.commentLine', when: E },
  { key: 'shift+alt+a', command: 'editor.action.blockComment', when: E },
  { key: 'alt+up', command: 'editor.action.moveLinesUpAction', when: E },
  { key: 'alt+down', command: 'editor.action.moveLinesDownAction', when: E },
  { key: 'shift+alt+up', command: 'editor.action.copyLinesUpAction', when: E },
  { key: 'shift+alt+down', command: 'editor.action.copyLinesDownAction', when: E },
  { key: 'ctrl+shift+k', command: 'editor.action.deleteLines', when: E },
  { key: 'ctrl+enter', command: 'editor.action.insertLineAfter', when: E },
  { key: 'ctrl+shift+enter', command: 'editor.action.insertLineBefore', when: E },
  { key: 'ctrl+]', command: 'editor.action.indentLines', when: E },
  { key: 'ctrl+[', command: 'editor.action.outdentLines', when: E },
  { key: 'ctrl+d', command: 'editor.action.addSelectionToNextFindMatch', when: E },
  { key: 'ctrl+shift+l', command: 'editor.action.selectHighlights', when: E },
  { key: 'ctrl+l', command: 'expandLineSelection', when: E },
  { key: 'ctrl+alt+up', command: 'editor.action.insertCursorAbove', when: E },
  { key: 'ctrl+alt+down', command: 'editor.action.insertCursorBelow', when: E },
  { key: 'ctrl+u', command: 'cursorUndo', when: E },
  { key: 'ctrl+shift+\\', command: 'editor.action.jumpToBracket', when: E },
  { key: 'ctrl+shift+[', command: 'editor.fold', when: E },
  { key: 'ctrl+shift+]', command: 'editor.unfold', when: E },
  { key: 'ctrl+k ctrl+0', command: 'editor.foldAll', when: E },
  { key: 'ctrl+k ctrl+j', command: 'editor.unfoldAll', when: E },
  { key: 'escape', command: 'removeSecondaryCursors', when: `${E} && editorHasMultipleSelections` },

  // Explorer
  { key: 'enter', command: 'explorer.openSelected', when: X },
  { key: 'space', command: 'explorer.openSelected', when: X },
  { key: 'f2', command: 'renameFile', when: X },
  { key: 'delete', command: 'deleteFile', when: X },
  { key: 'escape', command: 'workbench.action.focusFirstEditorGroup', when: X },
];
