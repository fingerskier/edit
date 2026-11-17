import type { AppInfo, Backend } from './backend.ts';
import type { CommandRegistry } from './commands.ts';
import type { ContextKeys } from './context.ts';
import type { Emitter } from './events.ts';
import type { KeybindingRule } from './keybindings.ts';
import type { Settings } from './settings.ts';
import type { Palette } from './palette.ts';
import type { StatusBar } from './statusbar.ts';
import type { Workbench } from './workbench.ts';
import type { Explorer } from './explorer.ts';

/** What is remembered between runs, stored in `<config>/state.json`. */
export interface PersistedState {
  recentFiles: string[];
  recentFolders: string[];
  session: { folder: string | null; files: string[]; active: string | null; expanded: string[] };
  sidebar: { visible: boolean; width: number };
  zoom: number;
}

export const DEFAULT_STATE: PersistedState = {
  recentFiles: [],
  recentFolders: [],
  session: { folder: null, files: [], active: null, expanded: [] },
  sidebar: { visible: true, width: 240 },
  zoom: 0,
};

/** The shared hub every part of the workbench is built around. */
export interface App {
  backend: Backend;
  info: AppInfo;
  isMac: boolean;
  commands: CommandRegistry;
  context: ContextKeys;
  events: Emitter;
  settings: Settings;
  state: PersistedState;
  /** Effective keybinding rules (defaults, plugins, then the user's). */
  rules: KeybindingRule[];
  palette: Palette;
  status: StatusBar;
  workbench: Workbench;
  explorer: Explorer;
  /** Persist `state` soon (debounced). */
  saveState(): void;
  addRecent(kind: 'file' | 'folder', path: string): void;
  removeRecent(path: string): void;
  /** Open a file, or make a directory the workspace folder. */
  openPath(path: string): Promise<void>;
  /** Re-send the watched directory set to the backend (debounced). */
  syncWatches(): void;
}
