import { EditorSelection } from '@codemirror/state';
import type { Command as CmCommand } from '@codemirror/view';
import {
  addCursorAbove, addCursorBelow, copyLineDown, copyLineUp, cursorMatchingBracket, deleteLine, indentLess, indentMore,
  insertBlankLine, moveLineDown, moveLineUp, redo, selectAll, selectLine, simplifySelection, toggleBlockComment,
  toggleComment, undo, undoSelection,
} from '@codemirror/commands';
import { foldAll, foldCode, unfoldAll, unfoldCode } from '@codemirror/language';
import { findNext, findPrevious, openSearchPanel, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { DEFAULT_STATE, type App, type PersistedState } from './app.ts';
import { createBackend } from './backend.ts';
import { CommandRegistry } from './commands.ts';
import { ContextKeys } from './context.ts';
import { DEFAULT_KEYBINDINGS } from './defaults.ts';
import { Emitter } from './events.ts';
import { Explorer } from './explorer.ts';
import {
  formatKey, isTypingPress, keyForCommand, mergeRules, pressFromEvent, resolveKey, toMacKey, type KeybindingRule,
} from './keybindings.ts';
import { parseJsonc } from './jsonc.ts';
import { Palette, filterItems, type PickItem } from './palette.ts';
import { basename, dirname, join, relative, tildify } from './paths.ts';
import { PluginHost } from './plugins.ts';
import { KEYBINDINGS_TEMPLATE, SETTINGS_TEMPLATE, parseSettings } from './settings.ts';
import { StatusBar } from './statusbar.ts';
import { errorText, showMenu, toast } from './ui.ts';
import { Workbench } from './workbench.ts';

const MAX_RECENT_FILES = 50;
const MAX_RECENT_FOLDERS = 20;
const QUICK_OPEN_LIMIT = 50_000;

async function boot(): Promise<void> {
  const backend = await createBackend();
  const info = await backend.info();
  const isMac = info.platform === 'macos';
  const settingsPath = join(info.configDir, 'settings.json');
  const keybindingsPath = join(info.configDir, 'keybindings.json');
  const statePath = join(info.configDir, 'state.json');

  const readText = async (path: string): Promise<string | undefined> => {
    try {
      const data = await backend.readFile(path);
      return data.kind === 'text' ? (data.content ?? '') : undefined;
    } catch {
      return undefined;
    }
  };

  // ----- persisted state ---------------------------------------------------

  const state: PersistedState = structuredClone(DEFAULT_STATE);
  try {
    const saved = JSON.parse((await readText(statePath)) ?? '{}');
    Object.assign(state, saved, {
      session: { ...DEFAULT_STATE.session, ...saved.session },
      sidebar: { ...DEFAULT_STATE.sidebar, ...saved.sidebar },
    });
  } catch {
    // A damaged state file only costs the remembered session.
  }
  // A reload reopens what this window itself had open, whichever window it is.
  const RELOAD_KEY = 'fedit.reloadSession';
  const reloaded = sessionStorage.getItem(RELOAD_KEY);
  sessionStorage.removeItem(RELOAD_KEY);
  let lastSession = structuredClone(state.session);
  try {
    if (reloaded) lastSession = { ...DEFAULT_STATE.session, ...JSON.parse(reloaded) };
  } catch {
    // Not worth failing a start over.
  }
  const currentSession = (): PersistedState['session'] => ({
    folder: app.explorer.root,
    files: app.workbench.tabs.map((t) => t.path).filter((p): p is string => p !== null),
    active: app.workbench.active?.path ?? null,
    expanded: [...app.explorer.expanded],
  });

  let booted = false;
  let stateTimer: number | undefined;
  // Every window shares state.json. Changes to the recent lists are kept as
  // operations and replayed over what is on disk, so one window's write does
  // not erase files another window opened since.
  const recentOps: ((s: PersistedState) => void)[] = [];
  const changeRecents = (op: (s: PersistedState) => void) => {
    op(state);
    recentOps.push(op);
    app.saveState();
  };
  const writeState = async () => {
    clearTimeout(stateTimer);
    stateTimer = undefined;
    if (!booted) return;
    const ops = recentOps.splice(0);
    let session = state.session;
    try {
      const disk = JSON.parse((await readText(statePath)) ?? 'null');
      // The session belongs to the first window, the one that restores it.
      if (!info.restore && disk?.session) session = disk.session;
      if (Array.isArray(disk?.recentFiles) && Array.isArray(disk?.recentFolders)) {
        state.recentFiles = disk.recentFiles;
        state.recentFolders = disk.recentFolders;
        for (const op of [...ops, ...recentOps]) op(state);
      }
    } catch {
      // Unreadable: what this window knows is written as it is.
    }
    state.session = info.restore ? currentSession() : session;
    try {
      await backend.writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (e) {
      console.error('[fedit] cannot save state', e);
    }
  };

  // ----- the app hub -------------------------------------------------------

  let watchTimer: number | undefined;
  const app = {
    backend,
    info,
    isMac,
    commands: new CommandRegistry(),
    context: new ContextKeys(),
    events: new Emitter(),
    settings: parseSettings(undefined).settings,
    state,
    rules: [] as KeybindingRule[],
    saveState() {
      if (stateTimer === undefined) stateTimer = window.setTimeout(writeState, 300);
    },
    addRecent(kind: 'file' | 'folder', path: string) {
      const key = kind === 'file' ? 'recentFiles' : 'recentFolders';
      changeRecents((s) => {
        s[key] = [path, ...s[key].filter((p) => p !== path)].slice(0, kind === 'file' ? MAX_RECENT_FILES : MAX_RECENT_FOLDERS);
      });
    },
    removeRecent(path: string) {
      changeRecents((s) => {
        s.recentFiles = s.recentFiles.filter((p) => p !== path);
        s.recentFolders = s.recentFolders.filter((p) => p !== path);
      });
    },
    async openPath(path: string) {
      const stat = await backend.stat(path);
      if (stat.kind === 'dir') await setFolder(path);
      else if (stat.kind === 'file') await app.workbench.openFile(path);
      else app.workbench.openNew(path);
    },
    syncWatches() {
      clearTimeout(watchTimer);
      watchTimer = window.setTimeout(() => {
        const dirs = new Set<string>([info.configDir, ...app.explorer.loadedDirs()]);
        for (const tab of app.workbench.tabs) if (tab.path) dirs.add(dirname(tab.path));
        void backend.watch([...dirs]).catch(() => {});
      }, 100);
    },
  } as App;

  const { commands, context } = app;
  app.palette = new Palette();
  app.status = new StatusBar();

  // ----- settings and theme ------------------------------------------------

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const applyAppearance = () => {
    const theme = app.settings['workbench.colorTheme'];
    const dark = theme === 'dark' || (theme !== 'light' && darkQuery.matches);
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.setProperty('--editor-font', app.settings['editor.fontFamily']);
    root.style.setProperty('--editor-font-size', `${Math.max(6, app.settings['editor.fontSize'] + state.zoom)}px`);
    root.style.setProperty('--sidebar-width', `${state.sidebar.width}px`);
  };
  const loadSettings = async (announce: boolean) => {
    const { settings, error } = parseSettings(await readText(settingsPath));
    app.settings = settings;
    if (error) toast(`settings.json: ${error}`, 'error');
    applyAppearance();
    if (announce) {
      app.workbench.applySettings();
      await app.explorer.refresh();
      app.events.emit('settings:changed');
    }
  };
  await loadSettings(false);
  darkQuery.addEventListener('change', () => {
    applyAppearance();
    app.workbench.applySettings();
  });

  app.workbench = new Workbench(app);
  app.explorer = new Explorer(app);
  const wb = app.workbench;
  const explorer = app.explorer;
  explorer.setVisible(state.sidebar.visible);

  // ----- keybindings -------------------------------------------------------

  let userRules: KeybindingRule[] = [];
  const defaultRules = DEFAULT_KEYBINDINGS.map((r) => (isMac ? { ...r, key: toMacKey(r.key) } : r));
  const plugins = new PluginHost(app, () => rebuildRules());
  function rebuildRules() {
    app.rules = mergeRules([...defaultRules, ...plugins.rules], userRules);
    if (!wb.active) wb.renderWelcome();
  }
  const loadKeybindings = async () => {
    userRules = [];
    try {
      const parsed = parseJsonc(await readText(keybindingsPath) ?? '');
      if (Array.isArray(parsed)) userRules = parsed;
      else if (parsed !== undefined) toast('keybindings.json must contain a JSON array', 'error');
    } catch (e) {
      toast(`keybindings.json: ${errorText(e)}`, 'error');
    }
    rebuildRules();
  };
  await loadKeybindings();

  const treeEl = document.getElementById('tree')!;
  context.set('editorTextFocus', () => wb.view.hasFocus);
  context.set('textInputFocus', () => wb.view.hasFocus);
  context.set('editorFocus', () => wb.view.dom.contains(document.activeElement));
  context.set('editorHasSelection', () => !wb.view.state.selection.main.empty);
  context.set('editorHasMultipleSelections', () => wb.view.state.selection.ranges.length > 1);
  context.set('editorReadonly', () => wb.active?.readOnly ?? false);
  context.set('editorLangId', () => wb.active?.language.toLowerCase() ?? '');
  context.set('editorIsOpen', () => wb.active !== null);
  context.set('filesExplorerFocus', () => document.activeElement === treeEl);
  context.set('explorerViewletFocus', () => document.activeElement === treeEl);
  context.set('inQuickOpen', () => app.palette.isOpen);
  context.set('isMac', isMac);
  context.set('isLinux', info.platform === 'linux');
  context.set('isWindows', info.platform === 'windows');

  const chordItem = app.status.createItem({ align: 'left', priority: 50 });
  let pendingChord: string | null = null;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing) return;
      const press = pressFromEvent(e);
      if (!press) return;
      const tag = (e.target as HTMLElement).tagName;
      // Plain typing in a text field (palette, rename box, search panel) is never a shortcut.
      if (pendingChord === null && (tag === 'INPUT' || tag === 'TEXTAREA') && isTypingPress(press)) return;
      const presses = pendingChord ? [pendingChord, press] : [press];
      const resolution = resolveKey(app.rules, presses, context.get);
      const wasChord = pendingChord !== null;
      pendingChord = null;
      chordItem.text = '';
      if (resolution.type === 'chord') {
        pendingChord = press;
        chordItem.text = `(${formatKey(press, isMac)}) was pressed. Waiting for second key of chord…`;
      } else if (resolution.type === 'none') {
        if (!wasChord) return;
        chordItem.text = `The key combination (${formatKey(presses.join(' '), isMac)}) is not a command.`;
        setTimeout(() => (chordItem.text = pendingChord ? chordItem.text : ''), 2500);
      } else {
        // An empty command is an explicit "do nothing": the key is consumed.
        if (resolution.command !== '' && !commands.has(resolution.command)) return;
        let result: unknown;
        try {
          result = resolution.command === '' ? undefined : commands.executeSync(resolution.command, resolution.args);
        } catch (err) {
          toast(`${resolution.command}: ${errorText(err)}`, 'error');
        }
        if (result === false) return; // not handled: let the key through
        if (result instanceof Promise) result.catch((err) => toast(`${resolution.command}: ${errorText(err)}`, 'error'));
      }
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // ----- workspace helpers -------------------------------------------------

  /** `restoring` keeps the sidebar as the user left it instead of showing it. */
  async function setFolder(path: string | null, expanded: string[] = [], restoring = false): Promise<void> {
    if (path === explorer.root) return;
    await explorer.setRoot(path, expanded);
    if (path) {
      app.addRecent('folder', path);
      if (!restoring && !explorer.visible) explorer.setVisible(true);
    }
    fileIndex = null;
  }

  /** Cached quick-open index: file paths relative to the folder. */
  let fileIndex: { root: string; items: PickItem[] } | null = null;
  const fileItem = (path: string, root: string | null): PickItem => ({
    label: basename(path),
    description: root ? dirname(relative(path, root)) : tildify(dirname(path), info.home),
    match: root ? relative(path, root) : path,
    value: { type: 'file', path },
  });

  function quickOpen(initial = ''): void {
    const root = explorer.root;
    if (root && fileIndex?.root !== root) fileIndex = null;
    if (root) {
      void backend.listFiles(root, QUICK_OPEN_LIMIT).then((files) => {
        fileIndex = { root, items: files.map((rel) => fileItem(join(root, rel), root)) };
        if (app.palette.isOpen) app.palette.refresh();
      });
    }
    const commandItems = (): PickItem[] =>
      commands
        .list()
        .filter((c) => c.title)
        .sort((a, b) => a.title!.localeCompare(b.title!))
        .map((c) => {
          const key = keyForCommand(app.rules, c.id);
          return { label: c.title!, key: key ? formatKey(key, isMac) : undefined, value: { type: 'command', id: c.id } };
        });

    app.palette.open({
      value: initial,
      placeholder: 'Search files by name (type > for commands, : to go to a line)',
      provider: (query) => {
        if (query.startsWith('>')) {
          return filterItems(commandItems(), query.slice(1)).map((s) => ({ ...s.item, positions: s.positions }) as PickItem);
        }
        if (query.startsWith(':')) {
          const n = parseInt(query.slice(1), 10);
          if (!wb.active) return [{ label: 'Open a file first to go to a line', value: null }];
          const lines = wb.view.state.doc.lines;
          return [{ label: Number.isFinite(n) ? `Go to line ${Math.max(1, Math.min(lines, n))}` : `Type a line number between 1 and ${lines}`, value: Number.isFinite(n) ? { type: 'line', line: n } : null }];
        }
        // `name:12` opens the file at a line.
        const lineMatch = /^(.*?):(\d+)$/.exec(query);
        const text = lineMatch ? lineMatch[1] : query;
        const line = lineMatch ? Number(lineMatch[2]) : undefined;
        const withLine = (item: PickItem): PickItem => (line ? { ...item, value: { ...(item.value as object), line } } : item);
        const openPaths = wb.tabs.filter((t) => t.path && t !== wb.active).map((t) => t.path!);
        const recents = [...new Set([...openPaths, ...state.recentFiles])].filter((p) => p !== wb.active?.path);
        if (text.trim() === '') return recents.slice(0, 30).map((p) => withLine(fileItem(p, root)));
        const indexed = fileIndex?.items ?? [];
        const known = new Set(indexed.map((i) => (i.value as { path: string }).path));
        const extra = recents.filter((p) => !known.has(p)).map((p) => fileItem(p, root));
        return filterItems([...indexed, ...extra], text).map((s) => withLine(s.item));
      },
      accept: (item) => {
        const value = item?.value as { type: string; id?: string; path?: string; line?: number } | null;
        if (!value) return;
        if (value.type === 'command') {
          void commands.execute(value.id!).catch((e) => toast(`${value.id}: ${errorText(e)}`, 'error'));
        } else if (value.type === 'line') {
          wb.gotoLine(value.line!);
        } else if (value.type === 'file') {
          void wb.openFile(value.path!).then((tab) => {
            if (tab && value.line) wb.gotoLine(value.line);
          });
        }
      },
    });
  }

  async function openConfigFile(path: string, template: string): Promise<void> {
    if ((await backend.stat(path)).kind === 'none') await backend.writeFile(path, template);
    await wb.openFile(path);
  }

  /**
   * Before quitting or reloading, which both drop every buffer: let the user
   * save or knowingly discard unsaved work. Returns false to abort.
   */
  async function settleUnsaved(action: 'Quit' | 'Reload', verb: string): Promise<boolean> {
    const dirty = wb.tabs.filter((t) => wb.isDirty(t));
    if (dirty.length === 0) return true;
    const what = dirty.length === 1 ? dirty[0].title : `${dirty.length} files`;
    const choice = await app.palette.confirm(`Save changes to ${what} before ${verb}?`, [
      { label: `Save All and ${action}`, value: 'save' },
      { label: `${action} Without Saving`, value: 'discard' },
      { label: 'Cancel', value: 'cancel' },
    ]);
    if (choice === undefined || choice === 'cancel') return false;
    if (choice === 'discard') return true;
    for (const tab of dirty) if (wb.tabs.includes(tab) && !(await wb.save(tab))) return false;
    // Anything typed while the saves were in flight is not on disk.
    if (wb.tabs.some((t) => wb.isDirty(t))) {
      toast(`Some files changed while saving. ${action} cancelled.`, 'warn');
      return false;
    }
    return true;
  }

  let leaving = false;
  async function leave(action: 'Quit' | 'Reload', verb: string, go: () => void): Promise<void> {
    if (leaving) return;
    leaving = true;
    try {
      if (!(await settleUnsaved(action, verb))) return;
      await writeState();
      go();
    } finally {
      leaving = false;
    }
  }
  /** Close this window, once its unsaved changes are settled. */
  const closeWindow = () => leave('Quit', 'quitting', () => backend.closeWindow());

  // ----- commands ----------------------------------------------------------

  const reg = (id: string, title: string | undefined, run: (args?: any) => unknown) => commands.register(id, run, title);
  /** Wrap a CodeMirror command; reports "not handled" when no editor is open. */
  const cm = (command: CmCommand) => () => (wb.active ? command(wb.view) : false);

  reg('workbench.action.files.newUntitledFile', 'File: New Untitled Text File', () => void wb.newUntitled());
  reg('workbench.action.files.openFile', 'File: Open File…', async () => {
    const dir = wb.active?.path ? dirname(wb.active.path) : (explorer.root ?? info.home);
    for (const path of await backend.pickFiles(dir)) await app.openPath(path);
  });
  reg('workbench.action.files.openFolder', 'File: Open Folder…', async () => {
    const path = await backend.pickFolder(explorer.root ?? info.home);
    if (path) await setFolder(path);
  });
  reg('workbench.action.closeFolder', 'File: Close Folder', () => setFolder(null));
  reg('workbench.action.openRecent', 'File: Open Recent…', async () => {
    const items: PickItem<string>[] = [
      ...state.recentFolders.map((p) => ({ label: tildify(p, info.home), description: 'folder', value: p })),
      ...state.recentFiles.map((p) => ({ label: tildify(p, info.home), value: p })),
    ];
    if (items.length === 0) return void toast('Nothing opened recently.');
    const path = await app.palette.pick(items, { placeholder: 'Select to open' });
    if (!path) return;
    if ((await backend.stat(path)).kind === 'none') {
      app.removeRecent(path);
      explorer.render();
      toast(`${tildify(path, info.home)} no longer exists.`, 'warn');
      return;
    }
    await app.openPath(path);
  });
  reg('workbench.action.clearRecentFiles', 'File: Clear Recently Opened', () => {
    changeRecents((s) => {
      s.recentFiles = [];
      s.recentFolders = [];
    });
    explorer.render();
  });
  reg('workbench.action.files.save', 'File: Save', () => wb.save());
  reg('workbench.action.files.saveAs', 'File: Save As…', () => wb.saveAs());
  reg('workbench.action.files.saveAll', 'File: Save All', () => wb.saveAll());
  reg('workbench.action.closeActiveEditor', 'View: Close Editor', () => (wb.active ? wb.close(wb.active) : closeWindow()));
  reg('workbench.action.closeAllEditors', 'View: Close All Editors', () => wb.closeAll());
  reg('workbench.action.reopenClosedEditor', 'View: Reopen Closed Editor', () => wb.reopenClosed());
  reg('workbench.action.nextEditor', 'View: Open Next Editor', () => wb.cycle(1));
  reg('workbench.action.previousEditor', 'View: Open Previous Editor', () => wb.cycle(-1));
  for (let n = 1; n <= 9; n++) reg(`workbench.action.openEditorAtIndex${n}`, undefined, () => wb.activateIndex(n - 1));
  reg('workbench.action.newWindow', 'File: New Window', () => backend.newWindow([]));
  reg('workbench.action.closeWindow', 'File: Close Window', () => closeWindow());
  // Quitting closes every window; the host asks each one, this one included.
  reg('workbench.action.quit', 'File: Quit', () => backend.quit());
  reg('workbench.action.reloadWindow', 'Developer: Reload Window', () => leave('Reload', 'reloading', () => {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify(currentSession()));
    location.reload();
  }));
  reg('fedit.openPath', undefined, (path: string) => app.openPath(path));

  reg('workbench.action.quickOpen', 'Go to File…', () => (app.palette.isOpen ? app.palette.close(true) : quickOpen()));
  reg('workbench.action.showCommands', 'Show All Commands', () => quickOpen('>'));
  reg('workbench.action.gotoLine', 'Go to Line/Column…', () => (wb.active ? quickOpen(':') : false));

  reg('workbench.action.toggleSidebarVisibility', 'View: Toggle Sidebar Visibility', () => explorer.setVisible(!explorer.visible));
  reg('workbench.view.explorer', 'View: Focus Explorer', () => explorer.focus());
  reg('workbench.action.focusFirstEditorGroup', 'View: Focus Editor', () => wb.view.focus());
  reg('workbench.files.action.refreshFilesExplorer', 'Explorer: Refresh', () => explorer.refresh());
  reg('workbench.files.action.showActiveFileInExplorer', 'Explorer: Reveal Active File', () => (wb.active?.path ? explorer.reveal(wb.active.path) : undefined));
  const zoom = (delta: number | null) => () => {
    state.zoom = delta === null ? 0 : Math.max(-8, Math.min(24, state.zoom + delta));
    applyAppearance();
    wb.view.requestMeasure();
    app.saveState();
  };
  reg('workbench.action.zoomIn', 'View: Zoom In', zoom(1));
  reg('workbench.action.zoomOut', 'View: Zoom Out', zoom(-1));
  reg('workbench.action.zoomReset', 'View: Reset Zoom', zoom(null));

  reg('explorer.newFile', 'Explorer: New File…', () => explorer.startCreate('file'));
  reg('explorer.newFolder', 'Explorer: New Folder…', () => explorer.startCreate('dir'));
  reg('explorer.openSelected', undefined, () => explorer.openSelected());
  reg('renameFile', 'Explorer: Rename…', () => explorer.startRename());
  reg('deleteFile', 'Explorer: Delete', () => explorer.deleteSelected());
  /** The path a file command acts on: an explicit one (context menu), else the focused side's. */
  const targetPath = (given?: unknown) =>
    typeof given === 'string' ? given : context.get('filesExplorerFocus') || !wb.active?.path ? explorer.selected : wb.active.path;
  reg('explorer.openWithDefaultApp', 'File: Open with Default App', async (given?: unknown) => {
    const path = targetPath(given);
    if (path) await backend.openExternal(path);
  });
  reg('revealFileInOS', 'File: Reveal in File Manager', async (given?: unknown) => {
    const path = targetPath(given) ?? explorer.root;
    if (path) await backend.reveal(path);
  });
  reg('copyFilePath', 'File: Copy Path', async (given?: unknown) => {
    const path = targetPath(given);
    if (path) await backend.clipboardWrite(path);
  });
  reg('copyRelativeFilePath', 'File: Copy Relative Path', async (given?: unknown) => {
    const path = targetPath(given);
    if (path) await backend.clipboardWrite(explorer.root ? relative(path, explorer.root) : path);
  });

  reg('workbench.action.openSettingsJson', 'Preferences: Open Settings (JSON)', () => openConfigFile(settingsPath, SETTINGS_TEMPLATE));
  reg('workbench.action.openGlobalKeybindingsFile', 'Preferences: Open Keyboard Shortcuts (JSON)', () => openConfigFile(keybindingsPath, KEYBINDINGS_TEMPLATE));
  reg('workbench.action.openDefaultKeybindingsFile', 'Preferences: Open Default Keyboard Shortcuts', () => {
    const body = mergeRules([...defaultRules, ...plugins.rules], []).map((r) => '  ' + JSON.stringify(r)).join(',\n');
    wb.newUntitled(`// Default keybindings (read-only). Override them in keybindings.json.\n[\n${body}\n]\n`, {
      title: 'Default Keybindings.json', readOnly: true, language: 'JSON',
    });
  });
  reg('fedit.openPluginsFolder', 'Plugins: Open Plugins Folder', async () => {
    const dir = join(info.configDir, 'plugins');
    if ((await backend.stat(dir)).kind === 'none') await backend.createDir(dir);
    await backend.openExternal(dir);
  });
  reg('fedit.showPlugins', 'Plugins: Show Loaded Plugins', async () => {
    if (plugins.loaded.length === 0) return void toast(`No plugins loaded. Put .js files in ${join(info.configDir, 'plugins')}.`);
    const path = await app.palette.pick(
      plugins.loaded.map((p) => ({ label: p.name, description: p.error ? `failed: ${p.error}` : p.path, value: p.path })),
      { placeholder: 'Loaded plugins (select to open the source)' },
    );
    if (path) await wb.openFile(path);
  });
  reg('fedit.about', 'Help: About Fedit', () => toast(`Fedit ${info.version}. Config: ${info.configDir}`));

  reg('workbench.action.editor.changeLanguageMode', 'Change Language Mode', async () => {
    const tab = wb.active;
    if (!tab) return;
    const name = await app.palette.pick(wb.languageNames().map((n) => ({ label: n, value: n })), { placeholder: 'Select language mode' });
    if (name) await wb.setLanguage(tab, name);
  });
  reg('workbench.action.editor.changeEOL', 'Change End of Line Sequence', async () => {
    const tab = wb.active;
    if (!tab) return;
    const eol = await app.palette.pick([{ label: 'LF', value: '\n' as const }, { label: 'CRLF', value: '\r\n' as const }], { placeholder: 'Select end of line sequence' });
    if (eol) wb.setEol(tab, eol);
  });
  reg('editor.action.changeIndentation', 'Change Indentation', async () => {
    const tab = wb.active;
    if (!tab) return;
    const spaces = await app.palette.pick([{ label: 'Indent Using Spaces', value: true }, { label: 'Indent Using Tabs', value: false }], { placeholder: 'Select indentation' });
    if (spaces === undefined) return;
    const size = await app.palette.pick([2, 3, 4, 8].map((n) => ({ label: String(n), value: n })), { placeholder: 'Select tab size' });
    if (size) wb.setIndent(tab, { insertSpaces: spaces, tabSize: size });
  });
  reg('editor.action.toggleWordWrap', 'View: Toggle Word Wrap', () => {
    app.settings['editor.wordWrap'] = app.settings['editor.wordWrap'] === 'on' ? 'off' : 'on';
    wb.applySettings();
  });

  const insertLineBefore: CmCommand = (view) => {
    const { state: s } = view;
    view.dispatch(
      s.changeByRange((range) => {
        const line = s.doc.lineAt(range.head);
        const indent = /^\s*/.exec(line.text)![0];
        return { changes: { from: line.from, insert: indent + s.lineBreak }, range: EditorSelection.cursor(line.from + indent.length) };
      }),
      { userEvent: 'input', scrollIntoView: true },
    );
    return true;
  };
  reg('undo', 'Undo', cm(undo));
  reg('redo', 'Redo', cm(redo));
  reg('cursorUndo', 'Cursor Undo', cm(undoSelection));
  reg('editor.action.selectAll', 'Select All', cm(selectAll));
  reg('actions.find', 'Find', cm(openSearchPanel));
  reg('editor.action.startFindReplaceAction', 'Replace', () => {
    if (!wb.active) return false;
    openSearchPanel(wb.view);
    wb.view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus();
    return true;
  });
  reg('editor.action.nextMatchFindAction', 'Find Next', cm(findNext));
  reg('editor.action.previousMatchFindAction', 'Find Previous', cm(findPrevious));
  reg('editor.action.commentLine', 'Toggle Line Comment', cm(toggleComment));
  reg('editor.action.blockComment', 'Toggle Block Comment', cm(toggleBlockComment));
  reg('editor.action.moveLinesUpAction', 'Move Line Up', cm(moveLineUp));
  reg('editor.action.moveLinesDownAction', 'Move Line Down', cm(moveLineDown));
  reg('editor.action.copyLinesUpAction', 'Copy Line Up', cm(copyLineUp));
  reg('editor.action.copyLinesDownAction', 'Copy Line Down', cm(copyLineDown));
  reg('editor.action.deleteLines', 'Delete Line', cm(deleteLine));
  reg('editor.action.insertLineAfter', 'Insert Line Below', cm(insertBlankLine));
  reg('editor.action.insertLineBefore', 'Insert Line Above', cm(insertLineBefore));
  reg('editor.action.indentLines', 'Indent Line', cm(indentMore));
  reg('editor.action.outdentLines', 'Outdent Line', cm(indentLess));
  reg('editor.action.addSelectionToNextFindMatch', 'Add Selection to Next Find Match', cm(selectNextOccurrence));
  reg('editor.action.selectHighlights', 'Select All Occurrences of Find Match', cm(selectSelectionMatches));
  reg('expandLineSelection', 'Expand Line Selection', cm(selectLine));
  reg('editor.action.insertCursorAbove', 'Add Cursor Above', cm(addCursorAbove));
  reg('editor.action.insertCursorBelow', 'Add Cursor Below', cm(addCursorBelow));
  reg('removeSecondaryCursors', undefined, cm(simplifySelection));
  reg('editor.action.jumpToBracket', 'Go to Bracket', cm(cursorMatchingBracket));
  reg('editor.fold', 'Fold', cm(foldCode));
  reg('editor.unfold', 'Unfold', cm(unfoldCode));
  reg('editor.foldAll', 'Fold All', cm(foldAll));
  reg('editor.unfoldAll', 'Unfold All', cm(unfoldAll));

  // ----- host events -------------------------------------------------------

  let configTimer: number | undefined;
  backend.on('fs-changed', (paths: string[]) => {
    void wb.handleFsChange(paths);
    explorer.handleFsChange(paths);
    if (paths.includes(settingsPath) || paths.includes(keybindingsPath)) {
      clearTimeout(configTimer);
      configTimer = window.setTimeout(() => {
        void loadSettings(true);
        void loadKeybindings();
      }, 150);
    }
  });
  const openMany = async (paths: string[]) => {
    for (const path of paths) await app.openPath(path).catch((e) => toast(errorText(e), 'error'));
  };
  backend.on('open-paths', (paths: string[]) => void openMany(paths));
  backend.on('close-requested', () => void closeWindow());
  backend.onDrop((paths) => void openMany(paths));

  // The webview's own context menu offers "Reload", which would discard
  // unsaved work, so the editor gets a menu of its own and the rest get none.
  // Cut and copy are commands of our own rather than the webview's: WebKitGTK
  // delivers the native cut twice, which took the following line as well.
  // As in VS Code, with nothing selected they act on the whole line.
  const clipboardTarget = () => {
    const s = wb.view.state;
    const ranges = s.selection.ranges.filter((r) => !r.empty).map((r) => ({ from: r.from, to: r.to }));
    if (ranges.length) return { ranges, text: ranges.map((r) => s.sliceDoc(r.from, r.to)).join(s.lineBreak) };
    const lines: string[] = [];
    let last = 0;
    for (const { head } of s.selection.ranges) {
      const line = s.doc.lineAt(head);
      if (line.number === last) continue;
      last = line.number;
      lines.push(line.text);
      ranges.push({ from: line.from, to: Math.min(s.doc.length, line.to + 1) });
    }
    return { ranges, text: lines.join(s.lineBreak) + s.lineBreak, linewise: true };
  };
  // The last whole-line copy. Pasting it back puts it on lines of its own,
  // above the cursor's line, instead of splitting that line.
  let linewiseCopy: string | null = null;
  const sameText = (a: string, b: string | null) => b !== null && a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');
  const copyTarget = async () => {
    const target = clipboardTarget();
    await backend.clipboardWrite(target.text);
    linewiseCopy = 'linewise' in target ? target.text : null;
    return target;
  };
  /** Insert whole copied lines above each cursor; false when `text` is not such a copy. */
  const pasteLinewise = (text: string): boolean => {
    const s = wb.view.state;
    if (!sameText(text, linewiseCopy) || !s.selection.ranges.every((r) => r.empty)) return false;
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    const each = lines.length === s.selection.ranges.length; // one copied line per cursor
    let i = 0;
    wb.view.dispatch(
      s.changeByRange((range) => {
        const line = s.doc.lineAt(range.from);
        const insert = s.toText((each ? lines[i++] : lines.join(s.lineBreak)) + s.lineBreak);
        return { changes: { from: line.from, insert }, range: EditorSelection.cursor(range.from + insert.length) };
      }),
      { userEvent: 'input.paste', scrollIntoView: true },
    );
    return true;
  };
  reg('editor.action.clipboardCopyAction', undefined, async () => {
    await copyTarget();
  });
  reg('editor.action.clipboardCutAction', undefined, async () => {
    const state = wb.view.state;
    const { ranges } = await copyTarget();
    // A read-only tab still copies. The clipboard write is asynchronous, so
    // never apply these ranges to a document that changed meanwhile.
    if (wb.active?.readOnly || wb.view.state !== state) return;
    wb.view.dispatch({ changes: ranges, scrollIntoView: true, userEvent: 'delete.cut' });
  });
  reg('editor.action.clipboardPasteAction', undefined, async () => {
    const text = await backend.clipboardRead();
    if (!text || wb.active?.readOnly || pasteLinewise(text)) return;
    wb.view.dispatch(wb.view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
  });
  // Ctrl+V stays the webview's own paste; only a whole-line copy is placed here.
  wb.view.dom.addEventListener(
    'paste',
    (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text || wb.active?.readOnly || !(e.target as HTMLElement).closest('.cm-content') || !pasteLinewise(text)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!(e.target as HTMLElement).closest('.cm-content') || !wb.active) return;
    const run = (id: string) => () => {
      wb.view.focus();
      void commands.execute(id).catch((err) => toast(errorText(err), 'error'));
    };
    showMenu(e.clientX, e.clientY, [
      { label: 'Cut', run: run('editor.action.clipboardCutAction') },
      { label: 'Copy', run: run('editor.action.clipboardCopyAction') },
      { label: 'Paste', run: run('editor.action.clipboardPasteAction') },
      { separator: true },
      { label: 'Select All', run: run('editor.action.selectAll') },
      { separator: true },
      { label: 'Command Palette…', run: run('workbench.action.showCommands') },
    ]);
  });

  const sash = document.getElementById('sash')!;
  sash.addEventListener('mousedown', (down) => {
    down.preventDefault();
    sash.classList.add('dragging');
    const move = (e: MouseEvent) => {
      state.sidebar.width = Math.max(120, Math.min(Math.round(e.clientX), Math.round(window.innerWidth * 0.7)));
      applyAppearance();
    };
    const up = () => {
      sash.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      wb.view.requestMeasure();
      app.saveState();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // ----- start -------------------------------------------------------------

  await plugins.loadAll();

  const cliStats = await Promise.all(info.paths.map(async (p) => ({ path: p, kind: (await backend.stat(p)).kind })));
  const cliFolder = cliStats.find((s) => s.kind === 'dir');
  if (cliFolder) {
    // An explicit folder starts a fresh workspace; its own session is not known.
    await setFolder(cliFolder.path, cliFolder.path === lastSession.folder ? lastSession.expanded : []);
  } else if (reloaded || (info.restore && app.settings['window.restoreSession'])) {
    if (lastSession.folder && (await backend.stat(lastSession.folder)).kind === 'dir') {
      await setFolder(lastSession.folder, lastSession.expanded, true);
    }
    for (const path of lastSession.files) await wb.openFile(path, { activate: false, quiet: true });
    const active = wb.tabs.find((t) => t.path === lastSession.active) ?? wb.tabs[0];
    if (active) wb.activate(active);
  }
  for (const s of cliStats) if (s.kind !== 'dir') await app.openPath(s.path);

  booted = true;
  void backend.ready().then(openMany);
  explorer.render();
  wb.refreshChrome();
  app.syncWatches();
  app.saveState();
  (window as any).fedit = app;
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="padding:16px;white-space:pre-wrap">Fedit failed to start:\n${String(e?.stack ?? e).replace(/</g, '&lt;')}</pre>`);
});
