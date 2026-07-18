// Workspace file quick-open: recursive index of roots + shared quickInput picker.

import { join } from 'node:path';
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { FileSystem } from '../core/file-system.js';
import type { QuickInputService, QuickPickItem } from './quick-input.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage']);

interface FilePick extends QuickPickItem {
  value: string; // absolute path
}

/** Recursively collect relative file paths under `root`, skipping noise dirs. */
export async function listWorkspaceFiles(
  fs: FileSystem,
  root: string,
  rel = '',
): Promise<string[]> {
  const dir = rel ? join(root, rel) : root;
  let entries;
  try {
    entries = await fs.list(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === '.' || e.name === '..') continue;
    // Skip VCS / package noise and other hidden top-level-ish dirs.
    if (e.isDir && (SKIP_DIRS.has(e.name) || e.name.startsWith('.'))) continue;
    if (!e.isDir && e.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDir) {
      out.push(...(await listWorkspaceFiles(fs, root, childRel)));
    } else {
      out.push(childRel);
    }
  }
  return out;
}

const fuzzyOpen: Plugin = {
  name: 'fuzzy-open',

  activate(ctx: PluginContext): void {
    ctx.subscriptions.push(
      ctx.commands.register('file.quickOpen', async () => {
        const roots = ctx.workspace.roots;
        if (roots.length === 0) return;

        const items: FilePick[] = [];
        for (const root of roots) {
          const rels = await listWorkspaceFiles(ctx.fs, root);
          for (const rel of rels) {
            items.push({
              label: roots.length > 1 ? `${rel}  (${root})` : rel,
              value: join(root, rel),
            });
          }
        }
        if (items.length === 0) return;

        const qi = ctx.services.get<QuickInputService>('quickInput');
        const chosen = await qi.pick(items, { title: 'Open File' });
        if (!chosen) return;
        await ctx.workspace.openFile(chosen.value);
        ctx.view.invalidate();
      }, { title: 'Quick Open File' }),
      ctx.keys.bind('global:ctrl+o', 'file.quickOpen'),
    );
  },
};

export default fuzzyOpen;
