import fs from "node:fs";
import path from "node:path";
import { PieceTableBuffer } from "./text-buffer.js";

export type EditOperation =
  | { type: "insert"; offset: number; text: string }
  | { type: "delete"; offset: number; length: number };

type TransactionKind = "typing" | "edit";

type EditTransaction = {
  kind: TransactionKind;
  undo: EditOperation[];
  redo: EditOperation[];
  createdAt: number;
  updatedAt: number;
};

export type EditableDocumentOptions = {
  maxUndoEntries?: number;
  typingCoalesceMs?: number;
};

export class EditableDocument {
  readonly buffer: PieceTableBuffer;
  readonly newline: string;
  private savedText: string;
  private readonly undoStack: EditTransaction[] = [];
  private readonly redoStack: EditTransaction[] = [];
  private readonly maxUndoEntries: number;
  private readonly typingCoalesceMs: number;

  constructor(text = "", options: EditableDocumentOptions = {}) {
    this.buffer = new PieceTableBuffer(text);
    this.savedText = text;
    this.newline = detectNewline(text);
    this.maxUndoEntries = Math.max(1, Math.floor(options.maxUndoEntries ?? 1000));
    this.typingCoalesceMs = Math.max(0, Math.floor(options.typingCoalesceMs ?? 1000));
  }

  static open(file: string): EditableDocument {
    return new EditableDocument(fs.readFileSync(file, "utf8"));
  }

  get text(): string {
    return this.buffer.toString();
  }

  get dirty(): boolean {
    return this.text !== this.savedText;
  }

  insertText(offset: number, text: string, options: { coalesce?: boolean; timestamp?: number } = {}): void {
    if (text.length === 0) {
      return;
    }

    this.buffer.insert(offset, text);
    const timestamp = options.timestamp ?? Date.now();
    const transaction: EditTransaction = {
      kind: options.coalesce ?? true ? "typing" : "edit",
      redo: [{ type: "insert", offset, text }],
      undo: [{ type: "delete", offset, length: text.length }],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.recordTransaction(transaction);
  }

  deleteText(offset: number, length: number): string {
    const deleted = this.buffer.delete(offset, length);
    if (deleted.length === 0) {
      return deleted;
    }

    const timestamp = Date.now();
    this.recordTransaction({
      kind: "edit",
      redo: [{ type: "delete", offset, length }],
      undo: [{ type: "insert", offset, text: deleted }],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return deleted;
  }

  replaceText(offset: number, length: number, text: string): string {
    const deleted = this.buffer.replace(offset, length, text);
    if (deleted.length === 0 && text.length === 0) {
      return deleted;
    }

    const redo: EditOperation[] = [];
    const undo: EditOperation[] = [];
    if (length > 0) {
      redo.push({ type: "delete", offset, length });
    }
    if (text.length > 0) {
      redo.push({ type: "insert", offset, text });
      undo.push({ type: "delete", offset, length: text.length });
    }
    if (deleted.length > 0) {
      undo.push({ type: "insert", offset, text: deleted });
    }

    const timestamp = Date.now();
    this.recordTransaction({ kind: "edit", redo, undo, createdAt: timestamp, updatedAt: timestamp });
    return deleted;
  }

  undo(): boolean {
    const transaction = this.undoStack.pop();
    if (!transaction) {
      return false;
    }

    this.applyOperations(transaction.undo);
    this.redoStack.push(transaction);
    return true;
  }

  redo(): boolean {
    const transaction = this.redoStack.pop();
    if (!transaction) {
      return false;
    }

    this.applyOperations(transaction.redo);
    this.undoStack.push(transaction);
    return true;
  }

  markClean(): void {
    this.savedText = this.text;
  }

  save(file: string): void {
    writeFileAtomic(file, this.text);
    this.markClean();
  }

  private recordTransaction(transaction: EditTransaction): void {
    if (this.tryCoalesceTyping(transaction)) {
      this.redoStack.length = 0;
      return;
    }

    this.undoStack.push(transaction);
    while (this.undoStack.length > this.maxUndoEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  private tryCoalesceTyping(transaction: EditTransaction): boolean {
    if (transaction.kind !== "typing") {
      return false;
    }

    const previous = this.undoStack[this.undoStack.length - 1];
    if (!previous || previous.kind !== "typing") {
      return false;
    }

    const previousRedo = previous.redo[0];
    const previousUndo = previous.undo[0];
    const nextRedo = transaction.redo[0];
    if (
      previous.redo.length !== 1 ||
      previous.undo.length !== 1 ||
      previousRedo?.type !== "insert" ||
      previousUndo?.type !== "delete" ||
      nextRedo?.type !== "insert" ||
      nextRedo.text.length !== 1 ||
      transaction.createdAt - previous.updatedAt > this.typingCoalesceMs ||
      previousRedo.offset + previousRedo.text.length !== nextRedo.offset
    ) {
      return false;
    }

    previousRedo.text += nextRedo.text;
    previousUndo.length += nextRedo.text.length;
    previous.updatedAt = transaction.updatedAt;
    return true;
  }

  private applyOperations(operations: EditOperation[]): void {
    for (const operation of operations) {
      if (operation.type === "insert") {
        this.buffer.insert(operation.offset, operation.text);
      } else {
        this.buffer.delete(operation.offset, operation.length);
      }
    }
  }
}

function detectNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function writeFileAtomic(file: string, text: string): void {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const handle = fs.openSync(temporary, "w");
  try {
    fs.writeFileSync(handle, text, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, file);
}
