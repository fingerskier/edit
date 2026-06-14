import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { Disposable } from '../core/disposable.js';
import type { ViewModel } from '../core/view.js';
import type { FocusService } from './keymap.js';

// --- plugin-local line index (UTF-16 columns) ---

/**
 * Offsets at which each rendered line begins. Always has exactly one entry per
 * element of `text.split('\n')`: `[0]` for the empty buffer, and the index just
 * after every '\n' (so a trailing newline yields a final empty line). This keeps
 * the index in lock-step with the `lines` array used for rendering.
 */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  const starts = lineStarts(text);
  const o = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  // last line whose start is <= o
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= o) line = i;
    else break;
  }
  return { line, col: o - starts[line] };
}

export function lineColToOffset(text: string, line: number, col: number): number {
  const starts = lineStarts(text);
  const lines = text.split('\n');
  const l = Math.max(0, Math.min(starts.length - 1, line));
  const lineLen = lines[l].length;
  const c = Math.max(0, Math.min(lineLen, col));
  return starts[l] + c;
}

const editorView: Plugin = {
  name: 'editor-view',

  activate(ctx: PluginContext): void {
    const { commands, keys, view, events, workspace, subscriptions } = ctx;

    // The sticky goal column for vertical movement. Only moveUp/moveDown read or
    // write it; every other caret-moving command (and document:activated) resets
    // it to null. We reset it on 'selection:moved' UNLESS it was caused by our
    // own vertical move (inVerticalMove flag), so that external caret moves
    // (e.g. undo/redo via workspace.setSelection) clear a stale goalCol.
    let goalCol: number | null = null;
    // True ONLY while this plugin's own verticalMove handler is executing.
    let inVerticalMove = false;

    // --- view provider for slot 'main' ---
    const viewDisposable: Disposable = view.contribute('main', (): ViewModel => {
      const doc = workspace.activeDocument;
      if (!doc) return { kind: 'text', lines: [''], cursors: [0] };
      const text = doc.text();
      return { kind: 'text', lines: text.split('\n'), cursors: [doc.selection.head] };
    });

    // --- command handlers (all no-op when there is no active document) ---

    const insertChar = (args: { key?: string }): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const key = args?.key ?? '';
      if (key === '') return;
      const head = doc.selection.head;
      // document.apply maps the selection through the edit, so the caret advances.
      workspace.applyEdit({ start: head, end: head, text: key });
    };

    const backspace = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const head = doc.selection.head;
      if (head <= 0) return;
      workspace.applyEdit({ start: head - 1, end: head, text: '' });
    };

    const del = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const head = doc.selection.head;
      if (head >= doc.text().length) return;
      workspace.applyEdit({ start: head, end: head + 1, text: '' });
    };

    const moveTo = (offset: number): void => {
      workspace.setSelection({ anchor: offset, head: offset });
    };

    const moveLeft = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      moveTo(Math.max(0, doc.selection.head - 1));
    };

    const moveRight = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      moveTo(Math.min(doc.text().length, doc.selection.head + 1));
    };

    const verticalMove = (dir: -1 | 1): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      const text = doc.text();
      const { line, col } = offsetToLineCol(text, doc.selection.head);
      // Capture the goal column on the first vertical move, then keep consuming it.
      if (goalCol === null) goalCol = col;
      const lineCount = lineStarts(text).length;
      const target = Math.max(0, Math.min(lineCount - 1, line + dir));
      inVerticalMove = true;
      try {
        moveTo(lineColToOffset(text, target, goalCol));
      } finally {
        inVerticalMove = false;
      }
    };

    const moveUp = (): void => verticalMove(-1);
    const moveDown = (): void => verticalMove(1);

    const moveHome = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const text = doc.text();
      const { line } = offsetToLineCol(text, doc.selection.head);
      moveTo(lineColToOffset(text, line, 0));
    };

    const moveEnd = (): void => {
      const doc = workspace.activeDocument;
      if (!doc) return;
      goalCol = null;
      const text = doc.text();
      const lines = text.split('\n');
      const { line } = offsetToLineCol(text, doc.selection.head);
      moveTo(lineColToOffset(text, line, lines[line].length));
    };

    const focusEditor = (): void => {
      ctx.services.get<FocusService>('focus').replace('editor');
    };

    // --- register commands ---
    subscriptions.push(
      commands.register('editor.insertChar', insertChar, { title: 'Editor: Insert Character' }),
      commands.register('editor.backspace', backspace, { title: 'Editor: Backspace' }),
      commands.register('editor.delete', del, { title: 'Editor: Delete' }),
      commands.register('editor.moveLeft', moveLeft, { title: 'Editor: Move Left' }),
      commands.register('editor.moveRight', moveRight, { title: 'Editor: Move Right' }),
      commands.register('editor.moveUp', moveUp, { title: 'Editor: Move Up' }),
      commands.register('editor.moveDown', moveDown, { title: 'Editor: Move Down' }),
      commands.register('editor.moveHome', moveHome, { title: 'Editor: Move to Line Start' }),
      commands.register('editor.moveEnd', moveEnd, { title: 'Editor: Move to Line End' }),
      commands.register('editor.focus', focusEditor, { title: 'Focus Editor' }),
    );

    // --- key bindings ---
    subscriptions.push(
      keys.bind('editor:<printable>', 'editor.insertChar'),
      keys.bind('editor:backspace', 'editor.backspace'),
      keys.bind('editor:delete', 'editor.delete'),
      keys.bind('editor:left', 'editor.moveLeft'),
      keys.bind('editor:right', 'editor.moveRight'),
      keys.bind('editor:up', 'editor.moveUp'),
      keys.bind('editor:down', 'editor.moveDown'),
      keys.bind('editor:home', 'editor.moveHome'),
      keys.bind('editor:end', 'editor.moveEnd'),
      keys.bind('global:alt+right', 'editor.focus'),
    );

    // --- view registration + re-render / goal-column reset ---
    subscriptions.push(
      viewDisposable,
      events.on('document:changed', () => view.invalidate()),
      events.on('selection:moved', () => { if (!inVerticalMove) goalCol = null; view.invalidate(); }),
      events.on('document:activated', () => {
        goalCol = null;
        view.invalidate();
      }),
    );
  },
};

export default editorView;
