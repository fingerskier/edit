// Changes to the remembered recent files and folders. They are sent to the
// host as data, so it can apply them to the state file every window shares.

export type RecentList = 'recentFiles' | 'recentFolders';
export type RecentOp =
  | { op: 'add'; list: RecentList; path: string; max: number }
  | { op: 'remove'; path: string }
  | { op: 'clear' };

export interface Recents {
  recentFiles: string[];
  recentFolders: string[];
}

export function applyRecentOps(state: Recents, ops: RecentOp[]): void {
  for (const op of ops) {
    if (op.op === 'add') state[op.list] = [op.path, ...state[op.list].filter((p) => p !== op.path)].slice(0, op.max);
    else if (op.op === 'remove') {
      state.recentFiles = state.recentFiles.filter((p) => p !== op.path);
      state.recentFolders = state.recentFolders.filter((p) => p !== op.path);
    } else {
      state.recentFiles = [];
      state.recentFolders = [];
    }
  }
}
