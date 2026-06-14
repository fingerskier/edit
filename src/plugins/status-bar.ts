import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { ViewModel } from '../core/view.js';
import { basename } from 'node:path';

// Populates the reserved `status` slot (contract §E) with the M1 status line:
// file name, cursor row/col (1-based), and a dirty marker. Purely additive — it
// only contributes a view and re-renders on the document/selection events the
// core already emits.

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
    const provider = (): ViewModel => {
      const doc = ctx.workspace.activeDocument;
      if (!doc) return { kind: 'status', segments: ['edit', 'no file open'] };
      const name = doc.path ? basename(doc.path) : '[scratch]';
      const { line, col } = rowCol(doc.text(), doc.selection.head);
      const segments = [doc.dirty ? `● ${name}` : name, `Ln ${line}, Col ${col}`];
      return { kind: 'status', segments };
    };

    ctx.subscriptions.push(
      ctx.view.contribute('status', provider),
      ctx.events.on('document:changed', () => ctx.view.invalidate()),
      ctx.events.on('selection:moved', () => ctx.view.invalidate()),
      ctx.events.on('document:activated', () => ctx.view.invalidate()),
      ctx.events.on('document:saved', () => ctx.view.invalidate()),
    );
  },
};

export default statusBar;
