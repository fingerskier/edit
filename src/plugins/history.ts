import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { EditOp } from '../core/buffer.js';
import type { Selection } from '../core/document.js';

interface HistoryEntry {
  op: EditOp;            // the original (forward) edit; re-applied on redo
  inverse: EditOp;       // undoes op; applied on undo
  selBefore: Selection;  // caret to restore after undo
  selAfter: Selection;   // caret to restore after redo
}

interface DocStacks {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

const history: Plugin = {
  name: 'history',

  activate(ctx: PluginContext): void {
    // docId -> { undo, redo }
    const stacks = new Map<string, DocStacks>();
    // Re-entrancy guard: true while WE are replaying an edit via applyEdit, so the
    // 'document:changed' that replay emits is ignored by the recording listener.
    let isApplying = false;

    const stacksFor = (docId: string): DocStacks => {
      let s = stacks.get(docId);
      if (!s) { s = { undo: [], redo: [] }; stacks.set(docId, s); }
      return s;
    };

    const clone = (sel: Selection): Selection => ({ anchor: sel.anchor, head: sel.head });
    const collapsed = (offset: number): Selection => ({ anchor: offset, head: offset });

    // Record real (user-driven) edits. Ignore our own replays via isApplying.
    const recDisp = ctx.events.on('document:changed', (payload: any) => {
      if (isApplying) return;
      try {
        const docId: string | undefined = payload?.docId;
        const op: EditOp | undefined = payload?.op;
        const inverse: EditOp | undefined = payload?.inverse;
        if (!docId || !op || !inverse) return;

        // selAfter: the changed doc's current selection (already mapped through the
        // edit by Document.apply). Keyed by docId, not activeDocument, so recording
        // tracks exactly the document named by the event.
        const doc = ctx.workspace.getDocument(docId);
        const selAfter: Selection = doc ? clone(doc.selection) : collapsed(inverse.end);
        // selBefore (approx): collapsed caret at the edit start (inverse.start).
        // Exact for single-caret insert/delete performed at the caret.
        const selBefore: Selection = collapsed(inverse.start);

        const s = stacksFor(docId);
        s.undo.push({ op, inverse, selBefore, selAfter });
        s.redo.length = 0; // any fresh edit invalidates redo
      } catch (err) {
        console.error('[history] failed to record edit:', err);
      }
    });
    ctx.subscriptions.push(recDisp);

    // Drop stacks for a closed document.
    const closeDisp = ctx.events.on('document:closed', (payload: any) => {
      const docId: string | undefined = payload?.docId;
      if (docId) stacks.delete(docId);
    });
    ctx.subscriptions.push(closeDisp);

    const undoDisp = ctx.commands.register('history.undo', () => {
      const doc = ctx.workspace.activeDocument;
      if (!doc) return; // no active document -> no-op
      const s = stacks.get(doc.id);
      if (!s || s.undo.length === 0) return; // nothing to undo -> no-op
      const entry = s.undo.pop()!;
      isApplying = true;
      try {
        ctx.workspace.applyEdit(entry.inverse);
        ctx.workspace.setSelection(clone(entry.selBefore));
      } finally {
        isApplying = false;
      }
      s.redo.push(entry);
      ctx.view.invalidate();
    }, { title: 'Undo' });
    ctx.subscriptions.push(undoDisp);

    const redoDisp = ctx.commands.register('history.redo', () => {
      const doc = ctx.workspace.activeDocument;
      if (!doc) return; // no active document -> no-op
      const s = stacks.get(doc.id);
      if (!s || s.redo.length === 0) return; // nothing to redo -> no-op
      const entry = s.redo.pop()!;
      isApplying = true;
      try {
        ctx.workspace.applyEdit(entry.op);
        ctx.workspace.setSelection(clone(entry.selAfter));
      } finally {
        isApplying = false;
      }
      s.undo.push(entry);
      ctx.view.invalidate();
    }, { title: 'Redo' });
    ctx.subscriptions.push(redoDisp);

    ctx.subscriptions.push(ctx.keys.bind('editor:ctrl+z', 'history.undo'));
    ctx.subscriptions.push(ctx.keys.bind('editor:ctrl+y', 'history.redo'));
  },
};

export default history;
