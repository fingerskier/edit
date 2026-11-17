// In-memory backend for running the UI in a plain browser: `npm run dev:ui`
// and the Playwright tests. The file system lives in localStorage so it
// survives a reload, which lets tests cover session restore.
//
// Tests may seed it before load through `window.__FEDIT_SEED__`, and inspect
// what the UI asked the host to do through `window.__mock`.

import type { AppInfo, Backend, DirEntry, FileData, PluginSource, Stat } from './backend.ts';

interface Seed {
  /** path → text content; a value starting with `binary:` is a binary file. */
  files?: Record<string, string>;
  dirs?: string[];
  paths?: string[];
  plugins?: PluginSource[];
}

const DEFAULT_SEED: Seed = {
  files: {
    '/work/demo/README.md': '# Demo\n\nA sample folder for the browser preview of **Fedit**.\n',
    '/work/demo/src/main.js': "import { greet } from './util.js';\n\nconsole.log(greet('world'));\n",
    '/work/demo/src/util.js': 'export function greet(name) {\n  return `hello, ${name}`;\n}\n',
    '/work/demo/src/app.py': 'def main():\n    print("hi")\n\n\nif __name__ == "__main__":\n    main()\n',
    '/work/demo/data/config.json': '{\n  "name": "demo",\n  "debug": true\n}\n',
    '/work/demo/data/logo.png': 'binary:PNG',
  },
  paths: ['/work/demo'],
};

const STORE_KEY = 'fedit-mock-fs';

export function createMockBackend(): Backend {
  const w = window as any;
  const seed: Seed = w.__FEDIT_SEED__ ?? DEFAULT_SEED;
  const stored = localStorage.getItem(STORE_KEY);
  const fs: { files: Record<string, { content: string; mtime: number }>; dirs: string[] } = stored
    ? JSON.parse(stored)
    : { files: {}, dirs: ['/', '/config'] };
  const firstLoad = !stored;
  let clock = Date.now();

  const persist = () => localStorage.setItem(STORE_KEY, JSON.stringify(fs));
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
  const mkdirs = (dir: string) => {
    for (let d = dir; !fs.dirs.includes(d); d = parent(d)) fs.dirs.push(d);
  };
  const put = (path: string, content: string) => {
    mkdirs(parent(path));
    fs.files[path] = { content, mtime: ++clock };
    persist();
    return fs.files[path].mtime;
  };
  if (firstLoad) {
    for (const d of seed.dirs ?? []) mkdirs(d);
    for (const [p, c] of Object.entries(seed.files ?? {})) put(p, c);
    persist();
  }

  const handlers: Record<string, ((payload: any) => void)[]> = {};
  const emit = (event: string, payload?: unknown) => (handlers[event] ?? []).forEach((h) => h(payload));
  const changed = (...paths: string[]) => setTimeout(() => emit('fs-changed', paths), 0);

  const mock = {
    fs,
    opened: [] as string[],
    revealed: [] as string[],
    trashed: [] as string[],
    watched: [] as string[],
    title: '',
    clipboard: '',
    ready: false,
    quit: false,
    /** Queue of answers for the next native picker calls. */
    picks: [] as (string | string[] | null)[],
    emit,
    /** Simulate another program writing a file. */
    externalWrite(path: string, content: string) {
      put(path, content);
      changed(path);
    },
    read: (path: string) => fs.files[path]?.content,
  };
  w.__mock = mock;

  const info: AppInfo = {
    configDir: '/config',
    version: '0.0.0-mock',
    platform: 'linux',
    sep: '/',
    home: '/work',
    paths: firstLoad ? (seed.paths ?? []) : [],
  };

  const stat = (path: string): Stat => {
    if (fs.files[path]) return { kind: 'file', mtime: fs.files[path].mtime, size: fs.files[path].content.length };
    if (fs.dirs.includes(path)) return { kind: 'dir', mtime: 0, size: 0 };
    return { kind: 'none', mtime: 0, size: 0 };
  };
  const exists = (path: string) => stat(path).kind !== 'none';
  const fail = (message: string): never => {
    throw message; // Tauri rejects with the error string, not an Error.
  };

  return {
    info: async () => info,
    readFile: async (path): Promise<FileData> => {
      const f = fs.files[path];
      if (!f) return fail(`No such file: ${path}`);
      if (f.content.startsWith('binary:')) return { kind: 'binary', lossy: false, mtime: f.mtime, size: f.content.length };
      if (f.content.startsWith('large:')) return { kind: 'large', lossy: false, mtime: f.mtime, size: 30_000_000 };
      return { kind: 'text', content: f.content, lossy: false, mtime: f.mtime, size: f.content.length };
    },
    writeFile: async (path, content) => {
      const mtime = put(path, content);
      changed(path);
      return mtime;
    },
    readDir: async (path): Promise<DirEntry[]> => {
      if (!fs.dirs.includes(path)) return fail(`No such directory: ${path}`);
      const prefix = path === '/' ? '/' : path + '/';
      const direct = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/') && p !== path;
      const entries = [
        ...fs.dirs.filter(direct).map((p) => ({ name: p.slice(prefix.length), path: p, isDir: true })),
        ...Object.keys(fs.files).filter(direct).map((p) => ({ name: p.slice(prefix.length), path: p, isDir: false })),
      ];
      return entries.sort(
        (a, b) => Number(b.isDir) - Number(a.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      );
    },
    listFiles: async (root, limit) =>
      Object.keys(fs.files)
        .filter((p) => p.startsWith(root + '/'))
        .map((p) => p.slice(root.length + 1))
        .sort()
        .slice(0, limit),
    stat: async (path) => stat(path),
    createFile: async (path) => {
      if (exists(path)) fail(`${path} already exists`);
      put(path, '');
      changed(path);
    },
    createDir: async (path) => {
      if (exists(path)) fail(`${path} already exists`);
      mkdirs(path);
      persist();
      changed(path);
    },
    rename: async (from, to) => {
      if (exists(to)) fail(`${to} already exists`);
      if (!exists(from)) fail(`No such file: ${from}`);
      mkdirs(parent(to));
      const move = (p: string) => to + p.slice(from.length);
      const inside = (p: string) => p === from || p.startsWith(from + '/');
      fs.dirs = fs.dirs.map((d) => (inside(d) ? move(d) : d));
      for (const p of Object.keys(fs.files).filter(inside)) {
        fs.files[move(p)] = fs.files[p];
        delete fs.files[p];
      }
      persist();
      changed(from, to);
    },
    trash: async (path) => {
      const inside = (p: string) => p === path || p.startsWith(path + '/');
      fs.dirs = fs.dirs.filter((d) => !inside(d));
      for (const p of Object.keys(fs.files).filter(inside)) delete fs.files[p];
      mock.trashed.push(path);
      persist();
      changed(path);
    },
    openExternal: async (path) => void mock.opened.push(path),
    reveal: async (path) => void mock.revealed.push(path),
    readPlugins: async () => seed.plugins ?? [],
    watch: async (paths) => void (mock.watched = paths),
    pickFiles: async () => {
      const next = mock.picks.shift();
      return next == null ? [] : Array.isArray(next) ? next : [next];
    },
    pickFolder: async () => {
      const next = mock.picks.shift();
      return typeof next === 'string' ? next : null;
    },
    pickSave: async () => {
      const next = mock.picks.shift();
      return typeof next === 'string' ? next : null;
    },
    setTitle: (title) => {
      mock.title = title;
      document.title = title;
    },
    clipboardRead: async () => mock.clipboard,
    clipboardWrite: async (text) => void (mock.clipboard = text),
    ready: () => {
      mock.ready = true;
    },
    quit: () => {
      mock.quit = true;
    },
    on: (event, handler) => void (handlers[event] ??= []).push(handler),
    onDrop: (handler) => void (handlers['drop'] ??= []).push(handler),
  };
}
