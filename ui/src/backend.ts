// The boundary between the web UI and the host. The Tauri implementation
// calls the Rust commands; `mock.ts` implements the same interface in memory
// for the browser (development and end-to-end tests).

export interface AppInfo {
  configDir: string;
  version: string;
  platform: string;
  sep: string;
  home: string;
  /** Paths given on the command line. */
  paths: string[];
}

export interface FileData {
  kind: 'text' | 'binary' | 'large';
  content?: string | null;
  lossy: boolean;
  mtime: number;
  size: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface Stat {
  kind: 'file' | 'dir' | 'none';
  mtime: number;
  size: number;
}

export interface PluginSource {
  name: string;
  path: string;
  source?: string | null;
  error?: string | null;
}

export type BackendEvent = 'fs-changed' | 'open-paths' | 'close-requested';

export interface Backend {
  info(): Promise<AppInfo>;
  readFile(path: string): Promise<FileData>;
  /** Returns the new modification time. */
  writeFile(path: string, content: string): Promise<number>;
  readDir(path: string): Promise<DirEntry[]>;
  listFiles(root: string, limit: number): Promise<string[]>;
  stat(path: string): Promise<Stat>;
  createFile(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  trash(path: string): Promise<void>;
  openExternal(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  readPlugins(load: string[]): Promise<PluginSource[]>;
  watch(paths: string[]): Promise<void>;
  pickFiles(dir?: string): Promise<string[]>;
  pickFolder(dir?: string): Promise<string | null>;
  pickSave(dir?: string, name?: string): Promise<string | null>;
  setTitle(title: string): void;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
  /** Tell the host the UI now handles window-close requests itself. */
  ready(): void;
  quit(): void;
  on(event: BackendEvent, handler: (payload: any) => void): void;
  /** Files dropped onto the window. */
  onDrop(handler: (paths: string[]) => void): void;
}

async function createTauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return {
    info: () => invoke('app_info'),
    readFile: (path) => invoke('read_file', { path }),
    writeFile: (path, content) => invoke('write_file', { path, content }),
    readDir: (path) => invoke('read_dir', { path }),
    listFiles: (root, limit) => invoke('list_files', { root, limit }),
    stat: (path) => invoke('stat', { path }),
    createFile: (path) => invoke('create_file', { path }),
    createDir: (path) => invoke('create_dir', { path }),
    rename: (from, to) => invoke('rename_path', { from, to }),
    trash: (path) => invoke('trash_path', { path }),
    openExternal: (path) => invoke('open_external', { path }),
    reveal: (path) => invoke('reveal_path', { path }),
    readPlugins: (load) => invoke('read_plugins', { load }),
    watch: (paths) => invoke('watch_paths', { paths }),
    pickFiles: (dir) => invoke('pick_files', { dir }),
    pickFolder: (dir) => invoke('pick_folder', { dir }),
    pickSave: (dir, name) => invoke('pick_save', { dir, name }),
    setTitle: (title) => void invoke('set_title', { title }),
    clipboardRead: () => invoke('clipboard_read'),
    clipboardWrite: (text) => invoke('clipboard_write', { text }),
    ready: () => void invoke('frontend_ready'),
    quit: () => void invoke('quit'),
    on: (event, handler) => void listen(event, (e) => handler(e.payload)),
    onDrop: (handler) =>
      void getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === 'drop') handler(e.payload.paths);
      }),
  };
}

export async function createBackend(): Promise<Backend> {
  if ('__TAURI_INTERNALS__' in window) return createTauriBackend();
  return (await import('./mock.ts')).createMockBackend();
}
