// Plugin host. A plugin is an ES module whose default export is
// `{ name?, activate(ctx) }`. See docs/plugins.md.

import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmLanguage from '@codemirror/language';
import * as cmCommands from '@codemirror/commands';
import * as cmSearch from '@codemirror/search';
import * as cmAutocomplete from '@codemirror/autocomplete';
import type { App } from './app.ts';
import type { PluginSource } from './backend.ts';
import type { Disposer } from './events.ts';
import type { KeybindingRule } from './keybindings.ts';
import { errorText, toast } from './ui.ts';

interface PluginModule {
  name?: string;
  activate?: (ctx: unknown) => unknown;
}

export interface LoadedPlugin {
  name: string;
  path: string;
  error?: string;
}

export class PluginHost {
  readonly loaded: LoadedPlugin[] = [];
  /** Keybinding rules contributed by plugins; they sit between defaults and user rules. */
  readonly rules: KeybindingRule[] = [];

  constructor(private app: App, private onRulesChanged: () => void) {}

  private createContext(name: string, subscriptions: Disposer[]) {
    const { app } = this;
    const track = <T extends Disposer>(dispose: T): T => {
      subscriptions.push(dispose);
      return dispose;
    };
    const wb = app.workbench;
    return {
      name,
      /** Disposers for everything this plugin registered through `ctx`. */
      subscriptions,
      commands: {
        register: (id: string, run: (args?: unknown) => unknown, title?: string) => track(app.commands.register(id, run, title)),
        execute: (id: string, args?: unknown) => app.commands.execute(id, args),
      },
      keybindings: {
        add: (rule: KeybindingRule) => {
          this.rules.push(rule);
          this.onRulesChanged();
          return track(() => {
            const i = this.rules.indexOf(rule);
            if (i >= 0) this.rules.splice(i, 1);
            this.onRulesChanged();
          });
        },
      },
      editor: {
        /** The CodeMirror EditorView shared by all tabs. */
        get view() { return wb.view; },
        get activePath() { return wb.active?.path ?? null; },
        get language() { return wb.active?.language ?? null; },
        getText: () => (wb.active ? wb.view.state.doc.toString() : ''),
        getSelection: () => wb.view.state.sliceDoc(wb.view.state.selection.main.from, wb.view.state.selection.main.to),
        replaceSelection: (text: string) => wb.view.dispatch(wb.view.state.replaceSelection(text)),
        addExtension: (extension: cmState.Extension) => track(wb.addExtension(extension)),
      },
      workspace: {
        get folder() { return app.explorer.root; },
        get openFiles() { return wb.tabs.map((t) => t.path).filter((p): p is string => p !== null); },
        open: (path: string) => app.openPath(path),
      },
      languages: {
        /** Register a language: `{ name, extensions: ['foo'], load: async () => LanguageSupport }`. */
        register: (spec: { name: string; alias?: string[]; extensions?: string[]; filename?: RegExp; load: () => Promise<cmLanguage.LanguageSupport> }) => {
          const desc = cmLanguage.LanguageDescription.of(spec);
          wb.extraLanguages.unshift(desc);
          return track(() => {
            const i = wb.extraLanguages.indexOf(desc);
            if (i >= 0) wb.extraLanguages.splice(i, 1);
          });
        },
      },
      events: {
        /** file:opened, file:saved, file:closed, editor:activated, folder:changed, settings:changed */
        on: (event: string, handler: (payload: unknown) => void) => track(app.events.on(event, handler)),
      },
      statusBar: {
        createItem: (opts: Parameters<typeof app.status.createItem>[0]) => {
          const item = app.status.createItem(opts);
          track(item.dispose);
          return item;
        },
      },
      ui: {
        pick: app.palette.pick.bind(app.palette),
        prompt: app.palette.prompt.bind(app.palette),
        notify: toast,
      },
      fs: {
        readFile: (path: string) => app.backend.readFile(path),
        writeFile: (path: string, content: string) => app.backend.writeFile(path, content),
        readDir: (path: string) => app.backend.readDir(path),
        stat: (path: string) => app.backend.stat(path),
        openExternal: (path: string) => app.backend.openExternal(path),
      },
      config: {
        /** Read any key of settings.json. */
        get: <T>(key: string, fallback?: T): T => (key in app.settings ? (app.settings[key] as T) : (fallback as T)),
      },
      /** The editor's own CodeMirror modules. Use these rather than bundling your own copies. */
      codemirror: { state: cmState, view: cmView, language: cmLanguage, commands: cmCommands, search: cmSearch, autocomplete: cmAutocomplete },
    };
  }

  async loadAll(): Promise<void> {
    const settings = this.app.settings;
    let sources: PluginSource[];
    try {
      sources = await this.app.backend.readPlugins(settings['plugins.load']);
    } catch (e) {
      toast(`Cannot read plugins: ${errorText(e)}`, 'error');
      return;
    }
    const disabled = new Set(settings['plugins.disable']);
    for (const source of sources) {
      if (disabled.has(source.name)) continue;
      const entry: LoadedPlugin = { name: source.name, path: source.path };
      this.loaded.push(entry);
      const subscriptions: Disposer[] = [];
      try {
        if (source.source == null) throw new Error(source.error ?? 'not found');
        const url = URL.createObjectURL(new Blob([source.source], { type: 'text/javascript' }));
        let mod: { default?: PluginModule } & PluginModule;
        try {
          mod = await import(/* @vite-ignore */ url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const plugin = mod.default ?? mod;
        if (typeof plugin.activate !== 'function') throw new Error('no activate(ctx) export');
        await plugin.activate(this.createContext(plugin.name ?? source.name, subscriptions));
      } catch (e) {
        // A plugin that failed half-way must not leave commands or keys behind.
        for (const dispose of subscriptions.reverse()) {
          try {
            dispose();
          } catch {
            // Keep rolling back the rest.
          }
        }
        entry.error = errorText(e);
        toast(`Plugin "${source.name}" failed to load: ${entry.error}`, 'error');
      }
    }
  }
}
