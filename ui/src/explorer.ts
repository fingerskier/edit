// The sidebar directory tree: lazy-loaded, keyboard navigable, with create,
// rename, delete, reveal and open-externally actions.

import type { App } from './app.ts';
import type { DirEntry } from './backend.ts';
import { basename, dirname, isWithin, join, tildify } from './paths.ts';
import { errorText, escapeHtml, showMenu, toast } from './ui.ts';

interface Row {
  entry: DirEntry;
  depth: number;
}

interface Editing {
  mode: 'create-file' | 'create-dir' | 'rename';
  /** Directory the new entry goes in, or the path being renamed. */
  target: string;
  depth: number;
}

export class Explorer {
  root: string | null = null;
  selected: string | null = null;
  readonly expanded = new Set<string>();

  private children = new Map<string, DirEntry[]>();
  private rows: Row[] = [];
  private editing: Editing | null = null;
  private refreshTimer: number | undefined;
  private pendingDirs = new Set<string>();
  private el = document.getElementById('tree')!;
  private titleEl = document.getElementById('sidebar-title')!;

  constructor(private app: App) {
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('focus', () => {
      if (!this.selected && this.rows[0]) this.select(this.rows[0].entry.path);
    });
    app.events.on('editor:activated', ({ path }) => {
      if (path && app.settings['explorer.autoReveal']) void this.reveal(path, false);
      else this.render();
    });
    this.render();
  }

  get visible(): boolean {
    return !document.body.classList.contains('sidebar-hidden');
  }

  setVisible(visible: boolean): void {
    document.body.classList.toggle('sidebar-hidden', !visible);
    this.app.state.sidebar.visible = visible;
    this.app.context.set('sideBarVisible', visible);
    this.app.saveState();
    if (!visible && this.el.contains(document.activeElement)) this.app.workbench.view.focus();
    this.app.workbench.view.requestMeasure();
  }

  focus(): void {
    if (!this.visible) this.setVisible(true);
    this.el.focus();
  }

  /** Directories whose listing is on screen, for the file watcher. */
  loadedDirs(): string[] {
    return this.root ? [this.root, ...[...this.expanded].filter((d) => this.children.has(d))] : [];
  }

  async setRoot(path: string | null, expanded: string[] = []): Promise<void> {
    this.root = path;
    this.children.clear();
    this.expanded.clear();
    this.selected = null;
    this.editing = null;
    if (path) {
      for (const dir of expanded) if (isWithin(dir, path)) this.expanded.add(dir);
      await this.load(path);
      await Promise.all([...this.expanded].map((dir) => this.load(dir)));
    }
    this.app.context.set('workspaceFolderCount', path ? 1 : 0);
    this.render();
    this.app.events.emit('folder:changed', { path });
    this.app.saveState();
    this.app.syncWatches();
    this.app.workbench.refreshChrome();
  }

  private async load(dir: string): Promise<boolean> {
    try {
      const exclude = new Set(this.app.settings['files.exclude']);
      this.children.set(dir, (await this.app.backend.readDir(dir)).filter((e) => !exclude.has(e.name)));
      return true;
    } catch {
      this.children.delete(dir);
      this.expanded.delete(dir);
      return false;
    }
  }

  /** Reload every loaded directory (after a settings change, or on demand). */
  async refresh(): Promise<void> {
    if (!this.root) return;
    if (!(await this.load(this.root))) {
      toast(`${this.root} is no longer available.`, 'warn');
      await this.setRoot(null);
      return;
    }
    await Promise.all([...this.expanded].map((dir) => this.load(dir)));
    this.render();
    this.app.syncWatches();
  }

  /** Something changed on disk: reload the affected, loaded directories. */
  handleFsChange(paths: string[]): void {
    if (!this.root) return;
    for (const path of paths) {
      for (const dir of [path, dirname(path)]) if (this.children.has(dir)) this.pendingDirs.add(dir);
    }
    if (this.pendingDirs.size === 0) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(async () => {
      const dirs = [...this.pendingDirs];
      this.pendingDirs.clear();
      await Promise.all(dirs.map((dir) => this.load(dir)));
      if (this.root && !this.children.has(this.root)) return void this.refresh();
      if (!this.editing) this.render();
      this.app.syncWatches();
    }, 120);
  }

  async toggle(dir: string, open?: boolean): Promise<void> {
    const want = open ?? !this.expanded.has(dir);
    if (want) {
      if (!(await this.load(dir))) toast(`Cannot read ${basename(dir)}.`, 'error');
      else this.expanded.add(dir);
    } else {
      this.expanded.delete(dir);
    }
    this.render();
    this.app.saveState();
    this.app.syncWatches();
  }

  /** Expand down to `path` and select it, if it is inside the folder. */
  async reveal(path: string, focus = true): Promise<void> {
    if (!this.root || !isWithin(path, this.root) || path === this.root) {
      this.render();
      return;
    }
    const chain: string[] = [];
    for (let dir = dirname(path); isWithin(dir, this.root) && dir !== this.root; dir = dirname(dir)) chain.unshift(dir);
    for (const dir of chain) {
      if (!this.expanded.has(dir)) {
        if (!(await this.load(dir))) break;
        this.expanded.add(dir);
      }
    }
    this.selected = path;
    this.render();
    this.el.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    if (focus) this.focus();
    this.app.syncWatches();
  }

  /** Move the selection without rebuilding the rows (a rebuild mid-click would swallow the click). */
  private select(path: string): void {
    this.selected = path;
    for (const row of this.el.querySelectorAll<HTMLElement>('.tree-row')) {
      row.classList.toggle('selected', row.dataset.path === path);
    }
    this.el.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private entryOf(path: string | null): DirEntry | undefined {
    return this.rows.find((r) => r.entry.path === path)?.entry;
  }

  /** The directory a new file should go in, given the current selection. */
  private targetDir(): string | null {
    const entry = this.entryOf(this.selected);
    if (!entry) return this.root;
    return entry.isDir ? entry.path : dirname(entry.path);
  }

  // ----- actions -----------------------------------------------------------

  async openSelected(): Promise<void> {
    const entry = this.entryOf(this.selected);
    if (!entry) return;
    if (entry.isDir) await this.toggle(entry.path);
    else await this.app.workbench.openFile(entry.path);
  }

  async startCreate(kind: 'file' | 'dir'): Promise<void> {
    const dir = this.targetDir();
    if (!dir || !this.root) {
      toast('Open a folder first.', 'warn');
      return;
    }
    if (!this.visible) this.setVisible(true);
    if (dir !== this.root && !this.expanded.has(dir)) await this.toggle(dir, true);
    const parentRow = this.rows.find((r) => r.entry.path === dir);
    this.editing = { mode: kind === 'file' ? 'create-file' : 'create-dir', target: dir, depth: parentRow ? parentRow.depth + 1 : 0 };
    this.render();
  }

  startRename(): void {
    const row = this.rows.find((r) => r.entry.path === this.selected);
    if (!row) return;
    this.editing = { mode: 'rename', target: row.entry.path, depth: row.depth };
    this.render();
  }

  private async commitEdit(value: string): Promise<void> {
    const editing = this.editing;
    this.editing = null;
    const name = value.trim();
    if (!editing || name === '' || name === '.' || name === '..') {
      this.render();
      this.el.focus();
      return;
    }
    const { backend } = this.app;
    try {
      if (editing.mode === 'rename') {
        const to = join(dirname(editing.target), name);
        if (to !== editing.target) {
          await backend.rename(editing.target, to);
          for (const dir of [...this.expanded]) {
            if (isWithin(dir, editing.target)) {
              this.expanded.delete(dir);
              this.expanded.add(to + dir.slice(editing.target.length));
            }
          }
          this.app.workbench.handleRename(editing.target, to);
          this.selected = to;
        }
      } else {
        const path = join(editing.target, name);
        if (editing.mode === 'create-file') {
          await backend.createFile(path);
          await this.app.workbench.openFile(path);
        } else {
          await backend.createDir(path);
        }
        this.selected = path;
      }
    } catch (e) {
      toast(errorText(e), 'error');
    }
    await this.refresh();
    if (editing.mode !== 'create-file') this.el.focus();
  }

  async deleteSelected(): Promise<void> {
    const entry = this.entryOf(this.selected);
    if (!entry) return;
    const choice = await this.app.palette.confirm(`Move ${entry.name} to the trash?`, [
      { label: 'Move to Trash', value: true },
      { label: 'Cancel', value: false },
    ]);
    if (!choice) return;
    try {
      await this.app.backend.trash(entry.path);
    } catch (e) {
      toast(`Cannot delete ${entry.name}: ${errorText(e)}`, 'error');
      return;
    }
    const index = this.rows.findIndex((r) => r.entry.path === entry.path);
    this.selected = (this.rows[index + 1] ?? this.rows[index - 1])?.entry.path ?? null;
    for (const dir of [...this.expanded]) if (isWithin(dir, entry.path)) this.expanded.delete(dir);
    await this.app.workbench.handleDelete(entry.path);
    await this.refresh();
    this.el.focus();
  }

  // ----- input -------------------------------------------------------------

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') return;
    const command = target.dataset.command;
    if (command) return void this.app.commands.execute(command, target.dataset.arg);
    const row = target.closest<HTMLElement>('.tree-row');
    if (!row?.dataset.path) return;
    this.selected = row.dataset.path;
    void this.openSelected();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (!this.root) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.tree-row');
    this.selected = row?.dataset.path ?? null;
    this.render();
    const selected = this.selected ?? undefined;
    const run = (id: string) => () => void this.app.commands.execute(id, selected);
    const onEntry = this.selected !== null;
    showMenu(e.clientX, e.clientY, [
      { label: 'New File…', run: run('explorer.newFile') },
      { label: 'New Folder…', run: run('explorer.newFolder') },
      ...(onEntry
        ? [
            { separator: true },
            { label: 'Open with Default App', run: run('explorer.openWithDefaultApp') },
            { label: 'Reveal in File Manager', run: run('revealFileInOS') },
            { separator: true },
            { label: 'Copy Path', run: run('copyFilePath') },
            { label: 'Copy Relative Path', run: run('copyRelativeFilePath') },
            { separator: true },
            { label: 'Rename…', run: run('renameFile') },
            { label: 'Delete', run: run('deleteFile') },
          ]
        : [{ separator: true }, { label: 'Refresh', run: run('workbench.files.action.refreshFilesExplorer') }]),
    ]);
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.ctrlKey || e.altKey || e.metaKey) return;
    const index = this.rows.findIndex((r) => r.entry.path === this.selected);
    const row = this.rows[index];
    const go = (i: number) => {
      const next = this.rows[Math.max(0, Math.min(this.rows.length - 1, i))];
      if (next) this.select(next.entry.path);
    };
    switch (e.key) {
      case 'ArrowDown': go(index + 1); break;
      case 'ArrowUp': go(index < 0 ? 0 : index - 1); break;
      case 'Home': go(0); break;
      case 'End': go(this.rows.length - 1); break;
      case 'PageDown': go(index + 15); break;
      case 'PageUp': go(index - 15); break;
      case 'ArrowRight':
        if (row?.entry.isDir) {
          if (!this.expanded.has(row.entry.path)) void this.toggle(row.entry.path, true);
          else go(index + 1);
        }
        break;
      case 'ArrowLeft':
        if (row?.entry.isDir && this.expanded.has(row.entry.path)) void this.toggle(row.entry.path, false);
        else if (row) {
          const parent = dirname(row.entry.path);
          if (parent !== this.root && this.rows.some((r) => r.entry.path === parent)) this.select(parent);
        }
        break;
      default: return;
    }
    e.preventDefault();
  }

  // ----- rendering ---------------------------------------------------------

  private buildRows(): void {
    const rows: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of this.children.get(dir) ?? []) {
        rows.push({ entry, depth });
        if (entry.isDir && this.expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    if (this.root) walk(this.root, 0);
    this.rows = rows;
  }

  render(): void {
    const { app } = this;
    if (!this.root) {
      this.rows = [];
      this.titleEl.textContent = 'No Folder Opened';
      const recent = app.state.recentFolders.slice(0, 8);
      this.el.innerHTML =
        `<div class="tree-empty"><button data-command="workbench.action.files.openFolder">Open Folder</button>` +
        (recent.length ? '<div>Recent</div>' : '') +
        recent
          .map((p) => `<a data-command="fedit.openPath" data-arg="${escapeHtml(p)}" title="${escapeHtml(p)}">${escapeHtml(tildify(p, app.info.home))}</a>`)
          .join('') +
        '</div>';
      return;
    }
    this.buildRows();
    this.titleEl.textContent = basename(this.root) || this.root;
    this.titleEl.title = this.root;
    const activePath = app.workbench?.active?.path;
    const editing = this.editing;
    const inputRow = (depth: number, value: string) =>
      `<div class="tree-row" style="padding-left:${8 + depth * 14}px"><span class="tree-twist"></span><input type="text" spellcheck="false" value="${escapeHtml(value)}"></div>`;
    let html = '';
    if (editing && editing.mode !== 'rename' && editing.target === this.root) html += inputRow(0, '');
    for (const { entry, depth } of this.rows) {
      if (editing?.mode === 'rename' && editing.target === entry.path) {
        html += inputRow(depth, entry.name);
        continue;
      }
      const cls = ['tree-row', entry.path === this.selected ? 'selected' : '', entry.path === activePath ? 'active-file' : ''].join(' ');
      const twist = entry.isDir ? (this.expanded.has(entry.path) ? ' open' : ' closed') : '';
      html += `<div class="${cls}" role="treeitem" data-path="${escapeHtml(entry.path)}" style="padding-left:${8 + depth * 14}px"><span class="tree-twist${twist}"></span><span class="tree-name">${escapeHtml(entry.name)}</span></div>`;
      if (editing && editing.mode !== 'rename' && editing.target === entry.path) html += inputRow(depth + 1, '');
    }
    const scroll = this.el.scrollTop;
    this.el.innerHTML = html;
    this.el.scrollTop = scroll;
    if (editing) this.wireInput();
  }

  private wireInput(): void {
    const input = this.el.querySelector<HTMLInputElement>('input');
    if (!input) {
      this.editing = null;
      return;
    }
    input.focus();
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit) void this.commitEdit(input.value);
      else {
        this.editing = null;
        this.render();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
        this.el.focus();
      }
    });
    input.addEventListener('blur', () => finish(false));
  }
}
