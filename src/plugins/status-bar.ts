import type { Plugin, PluginContext } from '../core/plugin-host.js';
import { basename } from 'node:path';

// Contributes the M1 status line — file name, cursor row/col (1-based), and a
// dirty marker — as two independent status-bar ITEMS via ctx.statusBar. It no
// longer owns the whole `status` slot, so other plugins (git, LSP diagnostics,
// editor mode) can add their own items beside these without conflict.

/** 1-based line/column for a flat UTF-16 offset (mirrors editor-view's mapping). */
function rowCol(text: string, offset: number): { line: number; col: number } {
  const o = Math.max(0, Math.min(text.length, offset));
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < o; i++) {
    if (text[i] === '\n') { line++; lastNl = i; }
  }
  return { line, col: o - lastNl };
}

const statusBar: Plugin = {
  name: 'status-bar',

  activate(ctx: PluginContext): void {
    // file/dirty sits left of the cursor position (higher priority = leftmost).
    const fileItem = ctx.statusBar.createItem({ priority: 100 });
    const posItem = ctx.statusBar.createItem({ priority: 90 });

    // Setting item.text re-renders the bar; no explicit view.invalidate() needed.
    const refresh = (): void => {
      const doc = ctx.workspace.activeDocument;
      if (!doc) {
        fileItem.text = 'edit';
        posItem.text = 'no file open';
        return;
      }
      const name = doc.path ? basename(doc.path) : '[scratch]';
      const { line, col } = rowCol(doc.text(), doc.selection.head);
      fileItem.text = doc.dirty ? `● ${name}` : name;
      posItem.text = `Ln ${line}, Col ${col}`;
    };

    refresh();

    ctx.subscriptions.push(
      fileItem,
      posItem,
      ctx.events.on('document:changed', refresh),
      ctx.events.on('selection:moved', refresh),
      ctx.events.on('document:activated', refresh),
      ctx.events.on('document:saved', refresh),
    );
  },
};

export default statusBar;
