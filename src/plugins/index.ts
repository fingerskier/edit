import type { Plugin } from '../core/plugin-host.js';
import keymap from './keymap.js';
import editorView from './editor-view.js';
import directoryList from './directory-list.js';
import history from './history.js';
import save from './save.js';
import commandPalette from './command-palette.js';

// Load order matters: keymap MUST be first so its `focus` service and the sole
// `key` listener exist before any other plugin activates (contract §F).
export function defaultPlugins(): Plugin[] {
  return [keymap, editorView, directoryList, history, save, commandPalette];
}
