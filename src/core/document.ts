import { StringBuffer, type TextBuffer, type EditOp } from './buffer.ts';

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
    this.clampSelection();
    return inverse;
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
