// The editor area: one CodeMirror view shared by all tabs, each tab keeping
// its own EditorState (so undo history, selection and folds survive switching).

import { Compartment, EditorSelection, EditorState, Text, countColumn, type Extension, type TransactionSpec } from '@codemirror/state';
import {
  EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection, type Command,
} from '@codemirror/view';
import { history, indentLess, indentMore, standardKeymap } from '@codemirror/commands';
import {
  LanguageDescription, bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, indentUnit, syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import type { App } from './app.ts';
import { basename, dirname } from './paths.ts';
import { detectIndentation } from './settings.ts';
import { errorText, escapeHtml, toast } from './ui.ts';
import { formatKey, keyForCommand } from './keybindings.ts';

export interface Tab {
  id: number;
  /** Absolute path, or null for an untitled buffer. */
  path: string | null;
  title: string;
  state: EditorState;
  /** The document as last saved or loaded; the tab is dirty when it differs. */
  saved: Text;
  eol: '\n' | '\r\n';
  mtime: number;
  readOnly: boolean;
  /** The file changed on disk while this tab had unsaved edits. */
  conflict: boolean;
  scrollTop: number;
  language: string;
  indent: { insertSpaces: boolean; tabSize: number };
}

const languageC = new Compartment();
const themeC = new Compartment();
const indentC = new Compartment();
const wrapC = new Compartment();
const lineNumbersC = new Compartment();
const readOnlyC = new Compartment();
const pluginC = new Compartment();

const lightTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff', color: '#24292f' },
  '.cm-gutters': { backgroundColor: '#ffffff', color: '#8c959f', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#f6f8fa' },
  '.cm-activeLineGutter': { backgroundColor: '#f6f8fa' },
});

/** Tab inserts indentation at the cursor; with a selection it indents the lines. */
const insertTab: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
  const unit = state.facet(indentUnit);
  view.dispatch(
    state.changeByRange((range) => {
      let text = unit;
      if (unit !== '\t') {
        const line = state.doc.lineAt(range.from);
        const column = countColumn(line.text.slice(0, range.from - line.from), state.tabSize);
        text = ' '.repeat(unit.length - (column % unit.length));
      }
      return { changes: { from: range.from, insert: text }, range: EditorSelection.cursor(range.from + text.length) };
    }),
    { userEvent: 'input', scrollIntoView: true },
  );
  return true;
};

export class Workbench {
  tabs: Tab[] = [];
  active: Tab | null = null;
  readonly view: EditorView;
  /** Extra language descriptions contributed by plugins, checked first. */
  readonly extraLanguages: LanguageDescription[] = [];

  private nextId = 1;
  private untitledCount = 0;
  private closed: string[] = [];
  private pluginExtensions: Extension[] = [];
  private autosaveTimer: number | undefined;
  private tabsEl = document.getElementById('tabs')!;
  private editorEl = document.getElementById('editor')!;
  private welcomeEl = document.getElementById('welcome')!;
  private cursorItem;
  private indentItem;
  private eolItem;
  private languageItem;
  private noticeItem;

  constructor(private app: App) {
    this.view = new EditorView({ parent: this.editorEl, state: EditorState.create({ doc: '' }) });
    this.editorEl.hidden = true;

    const status = app.status;
    this.noticeItem = status.createItem({ align: 'left', priority: 100 });
    this.cursorItem = status.createItem({ align: 'right', priority: 1, tooltip: 'Go to Line', onClick: () => void app.commands.execute('workbench.action.gotoLine') });
    this.indentItem = status.createItem({ align: 'right', priority: 2, tooltip: 'Change Indentation', onClick: () => void app.commands.execute('editor.action.changeIndentation') });
    this.eolItem = status.createItem({ align: 'right', priority: 3, tooltip: 'Change End of Line Sequence', onClick: () => void app.commands.execute('workbench.action.editor.changeEOL') });
    this.languageItem = status.createItem({ align: 'right', priority: 4, tooltip: 'Change Language Mode', onClick: () => void app.commands.execute('workbench.action.editor.changeLanguageMode') });

    this.tabsEl.addEventListener('mousedown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
      const tab = el && this.tabs.find((t) => t.id === Number(el.dataset.id));
      if (!tab) return;
      if (e.button === 1 || (e.target as HTMLElement).classList.contains('tab-close')) {
        e.preventDefault();
        void this.close(tab);
      } else if (e.button === 0) {
        this.activate(tab);
      }
    });
    this.tabsEl.addEventListener('wheel', (e) => {
      this.tabsEl.scrollLeft += e.deltaY || e.deltaX;
    }, { passive: true });

    this.renderWelcome();
    this.refreshChrome();
  }

  // ----- state construction ------------------------------------------------

  private themeExtension(): Extension {
    return document.documentElement.dataset.theme === 'dark'
      ? oneDark
      : [lightTheme, syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
  }

  private indentExtension(indent: Tab['indent']): Extension {
    return [indentUnit.of(indent.insertSpaces ? ' '.repeat(indent.tabSize) : '\t'), EditorState.tabSize.of(indent.tabSize)];
  }

  private createState(doc: string, indent: Tab['indent'], readOnly: boolean): EditorState {
    const s = this.app.settings;
    return EditorState.create({
      doc,
      extensions: [
        lineNumbersC.of(s['editor.lineNumbers'] === 'off' ? [] : [lineNumbers(), highlightActiveLineGutter(), foldGutter()]),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        // Only the editing basics live in CodeMirror's keymap; every other
        // shortcut goes through the configurable keybinding rules.
        keymap.of([...closeBracketsKeymap, ...standardKeymap, ...searchKeymap, { key: 'Tab', run: insertTab, shift: indentLess }]),
        readOnlyC.of(EditorState.readOnly.of(readOnly)),
        indentC.of(this.indentExtension(indent)),
        wrapC.of(s['editor.wordWrap'] === 'on' ? EditorView.lineWrapping : []),
        languageC.of([]),
        themeC.of(this.themeExtension()),
        pluginC.of(this.pluginExtensions),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.onDocChanged();
          if (update.docChanged || update.selectionSet) this.refreshStatus();
          if (update.focusChanged) this.app.events.emit('editor:focus', this.view.hasFocus);
        }),
      ],
    });
  }

  /** Apply a transaction to a tab whether or not it is the visible one. */
  private update(tab: Tab, spec: TransactionSpec): void {
    if (tab === this.active) this.view.dispatch(spec);
    else tab.state = tab.state.update(spec).state;
  }

  private stateOf(tab: Tab): EditorState {
    return tab === this.active ? this.view.state : tab.state;
  }

  isDirty(tab: Tab): boolean {
    return !this.stateOf(tab).doc.eq(tab.saved);
  }

  textOf(tab: Tab): string {
    return this.stateOf(tab).doc.sliceString(0, undefined, tab.eol);
  }

  // ----- opening -----------------------------------------------------------

  private addTab(opts: { path: string | null; title: string; content: string; mtime?: number; readOnly?: boolean }): Tab {
    const s = this.app.settings;
    const detected = s['editor.detectIndentation'] ? detectIndentation(opts.content) : null;
    const indent = detected ?? { insertSpaces: s['editor.insertSpaces'], tabSize: s['editor.tabSize'] };
    const state = this.createState(opts.content, indent, opts.readOnly ?? false);
    const tab: Tab = {
      id: this.nextId++,
      path: opts.path,
      title: opts.title,
      state,
      saved: state.doc,
      eol: opts.content.includes('\r\n') ? '\r\n' : '\n',
      mtime: opts.mtime ?? 0,
      readOnly: opts.readOnly ?? false,
      conflict: false,
      scrollTop: 0,
      language: 'Plain Text',
      indent,
    };
    this.tabs.push(tab);
    this.detectLanguage(tab);
    return tab;
  }

  newUntitled(content = '', opts: { title?: string; readOnly?: boolean; language?: string } = {}): Tab {
    const tab = this.addTab({ path: null, title: opts.title ?? `Untitled-${++this.untitledCount}`, content, readOnly: opts.readOnly });
    if (opts.language) void this.setLanguage(tab, opts.language);
    this.activate(tab);
    return tab;
  }

  /** Open a tab for a path that does not exist yet; saving creates the file. */
  openNew(path: string): Tab {
    const tab = this.addTab({ path, title: basename(path), content: '' });
    this.activate(tab);
    this.app.syncWatches();
    return tab;
  }

  /** Open a file in a tab. Non-text files are handed to the system default app. */
  async openFile(path: string, opts: { activate?: boolean; quiet?: boolean } = {}): Promise<Tab | null> {
    const existing = this.tabs.find((t) => t.path === path);
    if (existing) {
      if (opts.activate !== false) this.activate(existing);
      return existing;
    }
    let data;
    try {
      data = await this.app.backend.readFile(path);
    } catch (e) {
      if (!opts.quiet) toast(`Cannot open ${basename(path)}: ${errorText(e)}`, 'error');
      this.app.removeRecent(path);
      return null;
    }
    // A second request for the same file may have finished while we waited.
    const raced = this.tabs.find((t) => t.path === path);
    if (raced) {
      if (opts.activate !== false) this.activate(raced);
      return raced;
    }
    if (data.kind !== 'text') {
      if (opts.quiet) return null;
      try {
        await this.app.backend.openExternal(path);
        toast(data.kind === 'binary'
          ? `${basename(path)} is not a text file. Opened it in the default app.`
          : `${basename(path)} is too large to edit here (${Math.round(data.size / 1048576)} MB). Opened it in the default app.`);
      } catch (e) {
        toast(`Cannot open ${basename(path)} in the default app: ${errorText(e)}`, 'error');
      }
      return null;
    }
    const tab = this.addTab({ path, title: basename(path), content: data.content ?? '', mtime: data.mtime, readOnly: data.lossy });
    if (data.lossy) toast(`${basename(path)} is not valid UTF-8. Opened read-only to avoid damaging it.`, 'warn');
    this.app.addRecent('file', path);
    if (opts.activate !== false || !this.active) this.activate(tab);
    else this.refreshChrome();
    this.app.events.emit('file:opened', { path });
    this.app.syncWatches();
    return tab;
  }

  activate(tab: Tab): void {
    if (this.active && this.active !== tab) {
      this.active.state = this.view.state;
      this.active.scrollTop = this.view.scrollDOM.scrollTop;
    }
    if (this.active !== tab) {
      this.active = tab;
      this.view.setState(tab.state);
      const top = tab.scrollTop;
      requestAnimationFrame(() => {
        if (this.active === tab) this.view.scrollDOM.scrollTop = top;
      });
    }
    this.editorEl.hidden = false;
    this.welcomeEl.hidden = true;
    this.view.focus();
    this.refreshChrome();
    this.app.events.emit('editor:activated', { path: tab.path });
    this.app.saveState();
  }

  activateIndex(index: number): void {
    const tab = this.tabs[Math.min(index, this.tabs.length - 1)];
    if (tab) this.activate(tab);
  }

  cycle(delta: number): void {
    if (this.tabs.length < 2 || !this.active) return;
    const i = this.tabs.indexOf(this.active);
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length]);
  }

  // ----- closing -----------------------------------------------------------

  /** Close a tab, asking first when it has unsaved changes. Returns false if cancelled. */
  async close(tab: Tab, force = false): Promise<boolean> {
    if (!force && this.isDirty(tab)) {
      this.activate(tab);
      const choice = await this.app.palette.confirm(`Save changes to ${tab.title}?`, [
        { label: 'Save', value: 'save' },
        { label: "Don't Save", value: 'discard' },
        { label: 'Cancel', value: 'cancel' },
      ]);
      if (choice === undefined || choice === 'cancel') return false;
      if (choice === 'save' && !(await this.save(tab))) return false;
    }
    const index = this.tabs.indexOf(tab);
    if (index < 0) return true;
    this.tabs.splice(index, 1);
    if (tab.path) this.closed.push(tab.path);
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      if (next) {
        this.activate(next);
      } else {
        this.view.setState(EditorState.create({ doc: '' }));
        this.editorEl.hidden = true;
        this.welcomeEl.hidden = false;
        this.renderWelcome();
      }
    }
    this.refreshChrome();
    this.app.events.emit('file:closed', { path: tab.path });
    this.app.saveState();
    this.app.syncWatches();
    return true;
  }

  async closeAll(): Promise<boolean> {
    for (const tab of [...this.tabs]) if (!(await this.close(tab))) return false;
    return true;
  }

  async reopenClosed(): Promise<void> {
    while (this.closed.length > 0) {
      const path = this.closed.pop()!;
      if (this.tabs.some((t) => t.path === path)) continue;
      if (await this.openFile(path)) return;
    }
  }

  // ----- saving ------------------------------------------------------------

  private applySaveTransforms(tab: Tab): void {
    const s = this.app.settings;
    const state = this.stateOf(tab);
    const changes: { from: number; to?: number; insert?: string }[] = [];
    if (s['files.trimTrailingWhitespace']) {
      for (let n = 1; n <= state.doc.lines; n++) {
        const line = state.doc.line(n);
        const trimmed = line.text.replace(/[ \t]+$/, '');
        if (trimmed.length < line.length) changes.push({ from: line.from + trimmed.length, to: line.to });
      }
    }
    if (s['files.insertFinalNewline'] && state.doc.length > 0 && state.doc.lineAt(state.doc.length).length > 0) {
      changes.push({ from: state.doc.length, insert: '\n' });
    }
    if (changes.length > 0) this.update(tab, { changes });
  }

  /** Save a tab, asking for a path when it has none. Returns false if not saved. */
  async save(tab: Tab | null = this.active, opts: { auto?: boolean } = {}): Promise<boolean> {
    if (!tab) return false;
    if (!tab.path) return opts.auto ? false : this.saveAs(tab);
    if (tab.readOnly) {
      if (!opts.auto) toast(`${tab.title} is read-only.`, 'warn');
      return false;
    }
    if (tab.conflict && !opts.auto) {
      const choice = await this.app.palette.confirm(`${tab.title} changed on disk since it was opened.`, [
        { label: 'Overwrite', value: 'overwrite' },
        { label: 'Cancel', value: 'cancel' },
      ]);
      if (choice !== 'overwrite') return false;
    } else if (tab.conflict) {
      return false;
    }
    if (!opts.auto) this.applySaveTransforms(tab);
    const doc = this.stateOf(tab).doc;
    try {
      tab.mtime = await this.app.backend.writeFile(tab.path, doc.sliceString(0, undefined, tab.eol));
    } catch (e) {
      toast(`Cannot save ${tab.title}: ${errorText(e)}`, 'error');
      return false;
    }
    tab.saved = doc;
    tab.conflict = false;
    this.refreshChrome();
    this.app.events.emit('file:saved', { path: tab.path });
    return true;
  }

  async saveAs(tab: Tab | null = this.active): Promise<boolean> {
    if (!tab) return false;
    const dir = tab.path ? dirname(tab.path) : this.app.explorer.root ?? this.app.info.home;
    const target = await this.app.backend.pickSave(dir, tab.path ? basename(tab.path) : tab.title);
    if (!target) return false;
    const other = this.tabs.find((t) => t !== tab && t.path === target);
    if (other) await this.close(other, true);
    const doc = this.stateOf(tab).doc;
    try {
      tab.mtime = await this.app.backend.writeFile(target, doc.sliceString(0, undefined, tab.eol));
    } catch (e) {
      toast(`Cannot save ${basename(target)}: ${errorText(e)}`, 'error');
      return false;
    }
    tab.path = target;
    tab.title = basename(target);
    tab.saved = doc;
    tab.conflict = false;
    if (tab.readOnly) {
      tab.readOnly = false;
      this.update(tab, { effects: readOnlyC.reconfigure(EditorState.readOnly.of(false)) });
    }
    this.detectLanguage(tab);
    this.app.addRecent('file', target);
    this.refreshChrome();
    this.app.events.emit('file:saved', { path: target });
    this.app.saveState();
    this.app.syncWatches();
    return true;
  }

  async saveAll(): Promise<boolean> {
    let ok = true;
    for (const tab of this.tabs) if (tab.path && this.isDirty(tab)) ok = (await this.save(tab)) && ok;
    return ok;
  }

  private onDocChanged(): void {
    this.refreshChrome();
    const s = this.app.settings;
    if (s['files.autoSave'] !== 'afterDelay') return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      for (const tab of this.tabs) if (tab.path && this.isDirty(tab)) void this.save(tab, { auto: true });
    }, Math.max(100, s['files.autoSaveDelay']));
  }

  // ----- reacting to the outside world ------------------------------------

  /** A file changed on disk: reload clean tabs, flag dirty ones. */
  async handleFsChange(paths: string[]): Promise<void> {
    for (const tab of this.tabs) {
      if (!tab.path || !paths.includes(tab.path)) continue;
      const path = tab.path;
      const stat = await this.app.backend.stat(path);
      if (stat.kind !== 'file' || stat.mtime === tab.mtime) continue;
      if (this.isDirty(tab)) {
        tab.conflict = true;
        tab.mtime = stat.mtime;
        this.refreshChrome();
        continue;
      }
      let data;
      try {
        data = await this.app.backend.readFile(path);
      } catch {
        continue;
      }
      if (data.kind !== 'text' || tab.path !== path || this.isDirty(tab)) continue;
      const state = this.stateOf(tab);
      const content = data.content ?? '';
      tab.mtime = data.mtime;
      if (state.doc.toString() === content.replace(/\r\n?/g, '\n')) continue;
      const head = Math.min(state.selection.main.head, content.length);
      this.update(tab, { changes: { from: 0, to: state.doc.length, insert: content }, selection: { anchor: head } });
      tab.saved = this.stateOf(tab).doc;
      tab.eol = content.includes('\r\n') ? '\r\n' : '\n';
      this.refreshChrome();
    }
  }

  /** A path was renamed in the explorer; keep open tabs pointing at it. */
  handleRename(from: string, to: string): void {
    for (const tab of this.tabs) {
      if (!tab.path) continue;
      if (tab.path === from) tab.path = to;
      else if (tab.path.startsWith(from + this.app.info.sep)) tab.path = to + tab.path.slice(from.length);
      else continue;
      tab.title = basename(tab.path);
      this.detectLanguage(tab);
    }
    this.refreshChrome();
    this.app.saveState();
    this.app.syncWatches();
  }

  /** A path was deleted in the explorer; close its unmodified tabs. */
  async handleDelete(path: string): Promise<void> {
    for (const tab of [...this.tabs]) {
      if (!tab.path) continue;
      if ((tab.path === path || tab.path.startsWith(path + this.app.info.sep)) && !this.isDirty(tab)) await this.close(tab, true);
    }
  }

  // ----- language, indentation, settings ----------------------------------

  private findLanguage(nameOrFile: string, byFile: boolean): LanguageDescription | null {
    const all = [...this.extraLanguages, ...languages];
    if (byFile) return LanguageDescription.matchFilename(all, nameOrFile);
    return LanguageDescription.matchLanguageName(all, nameOrFile, true);
  }

  languageNames(): string[] {
    return ['Plain Text', ...[...this.extraLanguages, ...languages].map((l) => l.name).sort((a, b) => a.localeCompare(b))];
  }

  private detectLanguage(tab: Tab): void {
    const desc = this.findLanguage(tab.path ? basename(tab.path) : tab.title, true);
    void this.applyLanguage(tab, desc);
  }

  async setLanguage(tab: Tab, name: string): Promise<void> {
    await this.applyLanguage(tab, name === 'Plain Text' ? null : this.findLanguage(name, false));
  }

  private async applyLanguage(tab: Tab, desc: LanguageDescription | null): Promise<void> {
    tab.language = desc?.name ?? 'Plain Text';
    if (tab === this.active) this.refreshStatus();
    let extension: Extension = [];
    if (desc) {
      try {
        extension = await desc.load();
      } catch (e) {
        console.error('[fedit] language load failed', e);
        tab.language = 'Plain Text';
      }
    }
    if (!this.tabs.includes(tab) || tab.language !== (desc?.name ?? 'Plain Text')) return;
    this.update(tab, { effects: languageC.reconfigure(extension) });
  }

  setIndent(tab: Tab, indent: Tab['indent']): void {
    tab.indent = indent;
    this.update(tab, { effects: indentC.reconfigure(this.indentExtension(indent)) });
    this.refreshStatus();
  }

  setEol(tab: Tab, eol: Tab['eol']): void {
    if (tab.eol === eol) return;
    tab.eol = eol;
    // A different line ending is a real change to what would be saved.
    tab.saved = Text.of(['\u0000eol-changed']);
    this.refreshChrome();
  }

  /** Re-apply settings-driven extensions to every tab. */
  applySettings(): void {
    const s = this.app.settings;
    const effects = [
      themeC.reconfigure(this.themeExtension()),
      wrapC.reconfigure(s['editor.wordWrap'] === 'on' ? EditorView.lineWrapping : []),
      lineNumbersC.reconfigure(s['editor.lineNumbers'] === 'off' ? [] : [lineNumbers(), highlightActiveLineGutter(), foldGutter()]),
      pluginC.reconfigure(this.pluginExtensions),
    ];
    for (const tab of this.tabs) this.update(tab, { effects });
    this.view.requestMeasure();
  }

  /** Add a CodeMirror extension to every tab, present and future. */
  addExtension(extension: Extension): () => void {
    this.pluginExtensions = [...this.pluginExtensions, extension];
    this.applySettings();
    return () => {
      this.pluginExtensions = this.pluginExtensions.filter((e) => e !== extension);
      this.applySettings();
    };
  }

  gotoLine(line: number, column = 1): void {
    if (!this.active) return;
    const doc = this.view.state.doc;
    const info = doc.line(Math.max(1, Math.min(doc.lines, Math.round(line) || 1)));
    const pos = Math.min(info.to, info.from + Math.max(0, column - 1));
    this.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    this.view.focus();
  }

  // ----- rendering ---------------------------------------------------------

  private refreshTimer = 0;

  /** Redraw tabs, title and status. Coalesced: typing triggers this per keystroke. */
  refreshChrome(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = requestAnimationFrame(() => {
      this.refreshTimer = 0;
      this.renderTabs();
      this.refreshStatus();
      this.app.context.set('activeEditorIsDirty', this.active ? this.isDirty(this.active) : false);
      const tab = this.active;
      const folder = this.app.explorer?.root;
      const parts = [tab ? (this.isDirty(tab) ? '● ' : '') + tab.title : '', folder ? basename(folder) : '', 'Fedit'];
      this.app.backend.setTitle(parts.filter(Boolean).join(' — '));
    });
  }

  private renderTabs(): void {
    this.tabsEl.innerHTML = this.tabs
      .map((tab) => {
        const cls = ['tab', tab === this.active ? 'active' : '', this.isDirty(tab) ? 'dirty' : ''].join(' ');
        return `<div class="${cls}" role="tab" data-id="${tab.id}" title="${escapeHtml(tab.path ?? tab.title)}"><span class="tab-title">${escapeHtml(tab.title)}</span><span class="tab-close" title="Close">×</span></div>`;
      })
      .join('');
    this.tabsEl.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  refreshStatus(): void {
    const tab = this.active;
    if (!tab) {
      for (const item of [this.cursorItem, this.indentItem, this.eolItem, this.languageItem, this.noticeItem]) item.text = '';
      return;
    }
    const state = this.view.state;
    const main = state.selection.main;
    const line = state.doc.lineAt(main.head);
    const column = countColumn(line.text.slice(0, main.head - line.from), state.tabSize) + 1;
    const selected = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
    const cursors = state.selection.ranges.length;
    this.cursorItem.text =
      cursors > 1 ? `${cursors} selections` + (selected ? ` (${selected} characters selected)` : '')
        : `Ln ${line.number}, Col ${column}` + (selected ? ` (${selected} selected)` : '');
    this.indentItem.text = tab.indent.insertSpaces ? `Spaces: ${tab.indent.tabSize}` : `Tab Size: ${tab.indent.tabSize}`;
    this.eolItem.text = tab.eol === '\n' ? 'LF' : 'CRLF';
    this.languageItem.text = tab.language;
    this.noticeItem.text = tab.conflict ? 'Changed on disk' : tab.readOnly ? 'Read-only' : '';
  }

  renderWelcome(): void {
    const app = this.app;
    const key = (command: string) => {
      const k = keyForCommand(app.rules ?? [], command);
      return k ? `<kbd>${escapeHtml(formatKey(k, app.isMac))}</kbd>` : '';
    };
    const rows: [string, string][] = [
      ['Show All Commands', 'workbench.action.showCommands'],
      ['Go to File', 'workbench.action.quickOpen'],
      ['Open File', 'workbench.action.files.openFile'],
      ['Open Folder', 'workbench.action.files.openFolder'],
      ['Open Recent', 'workbench.action.openRecent'],
      ['Toggle Sidebar', 'workbench.action.toggleSidebarVisibility'],
    ];
    this.welcomeEl.innerHTML =
      `<h1>Fedit</h1><table>${rows
        .map(([label, command]) => `<tr><td><a data-command="${command}">${label}</a></td><td>${key(command)}</td></tr>`)
        .join('')}</table>`;
    this.welcomeEl.onclick = (e) => {
      const command = (e.target as HTMLElement).dataset.command;
      if (command) void app.commands.execute(command);
    };
  }
}
