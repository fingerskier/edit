export interface EditOp {
  start: number; // offset, inclusive
  end: number;   // offset, exclusive; for a pure insert start === end
  text: string;  // replacement text
}

export interface TextBuffer {
  getText(): string;
  length(): number;
  /** Applies the op and returns the inverse op that would undo it. */
  apply(op: EditOp): EditOp;
}

export class StringBuffer implements TextBuffer {
  private text: string;
  constructor(initial = '') { this.text = initial; }

  getText(): string { return this.text; }
  length(): number { return this.text.length; }

  apply(op: EditOp): EditOp {
    // Normalize the op into valid, ordered bounds so the returned inverse always
    // round-trips: clamp into [0, length] and enforce start <= end.
    const len = this.text.length;
    const start = Math.max(0, Math.min(len, op.start));
    const end = Math.max(start, Math.min(len, op.end));
    const removed = this.text.slice(start, end);
    this.text = this.text.slice(0, start) + op.text + this.text.slice(end);
    return { start, end: start + op.text.length, text: removed };
  }
}
