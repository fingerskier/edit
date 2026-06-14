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
    const removed = this.text.slice(op.start, op.end);
    this.text = this.text.slice(0, op.start) + op.text + this.text.slice(op.end);
    return { start: op.start, end: op.start + op.text.length, text: removed };
  }
}
