import { StringBuffer, type TextBuffer, type EditOp } from './buffer.js';

export interface Selection { anchor: number; head: number }

export class Document {
  readonly id: string;
  path: string | null;
  buffer: TextBuffer;
  selection: Selection = { anchor: 0, head: 0 };
  dirty = false;

  constructor(id: string, path: string | null, initial = '') {
    this.id = id;
    this.path = path;
    this.buffer = new StringBuffer(initial);
  }

  text(): string { return this.buffer.getText(); }

  apply(op: EditOp): EditOp {
    const inverse = this.buffer.apply(op);
    this.dirty = true;
    this.mapSelectionThroughEdit(inverse);
    return inverse;
  }

  // Shift the caret/selection so it tracks the text it pointed at. The inverse op
  // (returned by the buffer) carries the normalized edit in old coordinates:
  //   s        = inverse.start                 (edit start)
  //   oldEnd   = inverse.start + removedLen     (end of the replaced region, old coords)
  //   newEnd   = inverse.end                    (end of the inserted text, new coords)
  // Offsets before the edit are unchanged; after it shift by delta; inside the
  // replaced region collapse to the end of the insertion.
  private mapSelectionThroughEdit(inverse: EditOp): void {
    const s = inverse.start;
    const newEnd = inverse.end;
    const oldEnd = s + inverse.text.length;
    const delta = newEnd - oldEnd;
    const map = (p: number) => (p < s ? p : p > oldEnd ? p + delta : newEnd);
    this.selection = { anchor: map(this.selection.anchor), head: map(this.selection.head) };
    this.clampSelection();
  }

  setSelection(sel: Selection): void {
    this.selection = sel;
    this.clampSelection();
  }

  markClean(): void { this.dirty = false; }

  private clampSelection(): void {
    const max = this.buffer.length();
    const clamp = (n: number) => Math.max(0, Math.min(max, n));
    this.selection = { anchor: clamp(this.selection.anchor), head: clamp(this.selection.head) };
  }
}
