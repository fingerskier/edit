import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EditableDocument } from "../src/document.js";

test("editable document tracks dirty state and coalesces typing undo", () => {
  const document = new EditableDocument("");

  document.insertText(0, "a");
  document.insertText(1, "b");
  document.insertText(2, "c");

  assert.equal(document.text, "abc");
  assert.equal(document.dirty, true);
  assert.equal(document.undo(), true);
  assert.equal(document.text, "");
  assert.equal(document.dirty, false);
  assert.equal(document.redo(), true);
  assert.equal(document.text, "abc");
});

test("editable document undo and redo cover delete and replace operations", () => {
  const document = new EditableDocument("hello world");

  assert.equal(document.deleteText(5, 1), " ");
  assert.equal(document.text, "helloworld");
  assert.equal(document.replaceText(5, 5, " there"), "world");
  assert.equal(document.text, "hello there");

  assert.equal(document.undo(), true);
  assert.equal(document.text, "helloworld");
  assert.equal(document.undo(), true);
  assert.equal(document.text, "hello world");
  assert.equal(document.redo(), true);
  assert.equal(document.text, "helloworld");
});

test("editable document respects typing coalescing time windows", () => {
  const document = new EditableDocument("", { typingCoalesceMs: 100 });

  document.insertText(0, "a", { timestamp: 0 });
  document.insertText(1, "b", { timestamp: 50 });
  document.insertText(2, "c", { timestamp: 500 });

  assert.equal(document.undo(), true);
  assert.equal(document.text, "ab");
  assert.equal(document.undo(), true);
  assert.equal(document.text, "");
});

test("editable document clears redo branches and enforces undo stack limits", () => {
  const document = new EditableDocument("", { maxUndoEntries: 2 });

  document.insertText(0, "a", { coalesce: false });
  document.insertText(1, "b", { coalesce: false });
  document.insertText(2, "c", { coalesce: false });

  assert.equal(document.undo(), true);
  assert.equal(document.text, "ab");
  document.insertText(2, "x", { coalesce: false });
  assert.equal(document.redo(), false);

  assert.equal(document.undo(), true);
  assert.equal(document.text, "ab");
  assert.equal(document.undo(), true);
  assert.equal(document.text, "a");
  assert.equal(document.undo(), false);
});

test("editable document handles open/edit/undo/redo/save for a 5 MB file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-doc-large-"));
  const file = path.join(dir, "large.txt");
  const largeText = `${"a".repeat(5 * 1024 * 1024)}\n`;
  fs.writeFileSync(file, largeText);

  try {
    const document = EditableDocument.open(file);
    document.insertText(0, "x", { coalesce: false });
    assert.equal(document.text.length, largeText.length + 1);
    assert.equal(document.undo(), true);
    assert.equal(document.text.length, largeText.length);
    assert.equal(document.redo(), true);
    document.save(file);
    assert.equal(fs.readFileSync(file, "utf8").slice(0, 2), "xa");
    assert.equal(document.dirty, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("editable document saves atomically and marks clean", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-doc-"));
  const file = path.join(dir, "note.txt");
  fs.writeFileSync(file, "old\n");

  try {
    const document = EditableDocument.open(file);
    document.insertText(document.buffer.length, "new\n");
    assert.equal(document.dirty, true);

    document.save(file);
    assert.equal(fs.readFileSync(file, "utf8"), "old\nnew\n");
    assert.equal(document.dirty, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
