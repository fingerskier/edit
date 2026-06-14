import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { DirEntry } from '../core/file-system.js';
import type { ViewModel } from '../core/view.js';
import type { FocusService } from './keymap.js';
import { join } from 'node:path';

const directoryList: Plugin = {
  name: 'directory-list',
  async activate(ctx: PluginContext): Promise<void> {
    const root: string | undefined = ctx.workspace.roots[0];

    let entries: DirEntry[] = [];
    let selected = 0;

    // Monotonic token: only the newest re-list may commit its result. Older
    // in-flight re-lists (started before a newer fs:changed) are discarded so a
    // stale snapshot can't clobber a fresher one (M1 staleness guard).
    let listToken = 0;

    const clampSelected = (): void => {
      const max = Math.max(0, entries.length - 1);
      selected = Math.min(Math.max(0, selected), max);
    };

    async function relist(): Promise<void> {
      if (!root) {
        entries = [];
        clampSelected();
        ctx.view.invalidate();
        return;
      }
      const token = ++listToken;
      let next: DirEntry[];
      try {
        next = await ctx.fs.list(root);
      } catch {
        // Error-isolated: a late fs:changed may fire after the directory is gone
        // (e.g. removed by a test's cleanup). Never throw out of `void relist()`
        // and never commit a partial/failed snapshot.
        return;
      }
      if (token !== listToken) return; // a newer re-list superseded us
      entries = next;
      clampSelected();
      ctx.view.invalidate();
    }

    // Initial listing (await so the first frame already reflects the root).
    await relist();

    // View provider for the 'tree' slot (contributed even when there are no roots).
    ctx.subscriptions.push(
      ctx.view.contribute('tree', (): ViewModel => ({
        kind: 'list',
        items: entries.map((e) => ({ label: e.isDir ? e.name + '/' : e.name })),
        selected,
      })),
    );

    // tree.up / tree.down: move selection, clamp, invalidate. No-op when empty.
    ctx.subscriptions.push(
      ctx.commands.register('tree.up', () => {
        if (entries.length === 0) return;
        selected = Math.max(0, selected - 1);
        ctx.view.invalidate();
      }, { title: 'Tree: Up' }),
    );
    ctx.subscriptions.push(
      ctx.commands.register('tree.down', () => {
        if (entries.length === 0) return;
        selected = Math.min(entries.length - 1, selected + 1);
        ctx.view.invalidate();
      }, { title: 'Tree: Down' }),
    );

    // tree.open: open the selected file (dirs / empty are no-ops in M1), then
    // focus the editor. Focus service is read lazily inside the handler (§F).
    ctx.subscriptions.push(
      ctx.commands.register('tree.open', async () => {
        if (!root) return;
        const entry = entries[selected];
        if (!entry || entry.isDir) return; // dir / empty -> ignore for M1
        await ctx.workspace.openFile(join(root, entry.name));
        ctx.services.get<FocusService>('focus').replace('editor');
      }, { title: 'Tree: Open Selection' }),
    );

    // tree.focus: make the tree own input.
    ctx.subscriptions.push(
      ctx.commands.register('tree.focus', () => {
        ctx.services.get<FocusService>('focus').replace('tree');
      }, { title: 'Focus Directory Tree' }),
    );

    // Keybindings (contract §D).
    ctx.subscriptions.push(ctx.keys.bind('tree:up', 'tree.up'));
    ctx.subscriptions.push(ctx.keys.bind('tree:down', 'tree.down'));
    ctx.subscriptions.push(ctx.keys.bind('tree:enter', 'tree.open'));
    ctx.subscriptions.push(ctx.keys.bind('global:alt+left', 'tree.focus'));

    // Re-list on any fs change. M1: re-list the root regardless of which dir
    // changed; relist()'s token guard handles concurrent/stale re-lists and its
    // try/catch keeps the `void` call from producing an unhandled rejection.
    ctx.subscriptions.push(
      ctx.events.on('fs:changed', () => { void relist(); }),
    );
  },
};

export default directoryList;
