// Nested, collapsible, multi-root directory tree for the `tree` slot.
// Each workspace root is a top-level expandable folder; Enter opens files or
// toggles directory expand/collapse. Children load lazily on first expand.

import { basename, join } from 'node:path';
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { DirEntry } from '../core/file-system.js';
import type { ViewModel } from '../core/view.js';
import type { FocusService } from './keymap.js';

export interface TreeRow {
  /** Absolute path of the file or directory. */
  path: string;
  /** Display basename. */
  name: string;
  isDir: boolean;
  depth: number;
}

/** Build the visible flattened rows for the given roots / expansion / cache. */
export function buildTreeRows(
  roots: string[],
  expanded: ReadonlySet<string>,
  children: ReadonlyMap<string, DirEntry[]>,
): TreeRow[] {
  const rows: TreeRow[] = [];

  const walk = (path: string, name: string, isDir: boolean, depth: number): void => {
    rows.push({ path, name, isDir, depth });
    if (!isDir || !expanded.has(path)) return;
    const kids = children.get(path) ?? [];
    for (const k of kids) {
      walk(join(path, k.name), k.name, k.isDir, depth + 1);
    }
  };

  for (const root of roots) {
    const name = basename(root) || root;
    walk(root, name, true, 0);
  }
  return rows;
}

/** Indent + chevron (dirs) or alignment spaces (files) + name. */
export function formatTreeLabel(row: TreeRow, expanded: ReadonlySet<string>): string {
  const pad = '  '.repeat(row.depth);
  if (row.isDir) {
    const chev = expanded.has(row.path) ? '▾ ' : '▸ ';
    return `${pad}${chev}${row.name}/`;
  }
  return `${pad}  ${row.name}`;
}

const directoryList: Plugin = {
  name: 'directory-list',
  async activate(ctx: PluginContext): Promise<void> {
    const roots = ctx.workspace.roots;

    /** Absolute paths of expanded directories (roots start expanded). */
    const expanded = new Set<string>(roots);
    /** Cached listings for paths we have loaded. */
    const children = new Map<string, DirEntry[]>();
    let selected = 0;

    // Monotonic token: only the newest load/refresh may commit (staleness guard).
    let listToken = 0;

    const rows = (): TreeRow[] => buildTreeRows(roots, expanded, children);

    const clampSelected = (): void => {
      const n = rows().length;
      selected = n === 0 ? 0 : Math.min(Math.max(0, selected), n - 1);
    };

    async function loadDir(dir: string): Promise<void> {
      const token = ++listToken;
      let next: DirEntry[];
      try {
        next = await ctx.fs.list(dir);
      } catch {
        // Gone or unreadable — treat as empty so the tree stays usable.
        next = [];
      }
      if (token !== listToken) return;
      children.set(dir, next);
    }

    /** Refresh every expanded directory so open branches stay current. */
    async function refreshExpanded(): Promise<void> {
      const dirs = [...expanded];
      // Load sequentially under one token so a mid-flight refresh is superseded cleanly.
      const token = ++listToken;
      for (const dir of dirs) {
        if (token !== listToken) return;
        let next: DirEntry[];
        try {
          next = await ctx.fs.list(dir);
        } catch {
          next = [];
        }
        if (token !== listToken) return;
        children.set(dir, next);
      }
      clampSelected();
      ctx.view.invalidate();
    }

    // Initial load: roots are expanded, so list each root's children.
    await refreshExpanded();

    ctx.subscriptions.push(
      ctx.view.contribute('tree', (): ViewModel => {
        const visible = rows();
        return {
          kind: 'list',
          items: visible.map((r) => ({ label: formatTreeLabel(r, expanded) })),
          selected,
        };
      }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('tree.up', () => {
        if (rows().length === 0) return;
        selected = Math.max(0, selected - 1);
        ctx.view.invalidate();
      }, { title: 'Tree: Up' }),
      ctx.commands.register('tree.down', () => {
        const n = rows().length;
        if (n === 0) return;
        selected = Math.min(n - 1, selected + 1);
        ctx.view.invalidate();
      }, { title: 'Tree: Down' }),
      ctx.commands.register('tree.open', async () => {
        const visible = rows();
        const row = visible[selected];
        if (!row) return;

        if (!row.isDir) {
          await ctx.workspace.openFile(row.path);
          ctx.services.get<FocusService>('focus').replace('editor');
          return;
        }

        // Toggle expand / collapse for directories.
        if (expanded.has(row.path)) {
          expanded.delete(row.path);
          clampSelected();
          ctx.view.invalidate();
          return;
        }

        expanded.add(row.path);
        await loadDir(row.path);
        clampSelected();
        ctx.view.invalidate();
      }, { title: 'Tree: Open / Expand' }),
      ctx.commands.register('tree.collapse', () => {
        const visible = rows();
        const row = visible[selected];
        if (!row?.isDir || !expanded.has(row.path)) return;
        expanded.delete(row.path);
        clampSelected();
        ctx.view.invalidate();
      }, { title: 'Tree: Collapse' }),
      ctx.commands.register('tree.expand', async () => {
        const visible = rows();
        const row = visible[selected];
        if (!row?.isDir || expanded.has(row.path)) return;
        expanded.add(row.path);
        await loadDir(row.path);
        clampSelected();
        ctx.view.invalidate();
      }, { title: 'Tree: Expand' }),
      ctx.commands.register('tree.focus', () => {
        ctx.services.get<FocusService>('focus').replace('tree');
      }, { title: 'Focus Directory Tree' }),
    );

    ctx.subscriptions.push(
      ctx.keys.bind('tree:up', 'tree.up'),
      ctx.keys.bind('tree:down', 'tree.down'),
      ctx.keys.bind('tree:enter', 'tree.open'),
      ctx.keys.bind('tree:left', 'tree.collapse'),
      ctx.keys.bind('tree:right', 'tree.expand'),
      ctx.keys.bind('global:alt+left', 'tree.focus'),
    );

    // Re-list expanded branches on any workspace fs change.
    ctx.subscriptions.push(
      ctx.events.on('fs:changed', () => { void refreshExpanded(); }),
    );
  },
};

export default directoryList;
