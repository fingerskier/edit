import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EditorApp } from "../src/app.js";
import { normalizeKeypress } from "../src/keymap.js";

function fixtureWorkspace(): { root: string; file: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edit-m1-"));
  const file = path.join(root, "alpha.txt");
  fs.writeFileSync(file, "alpha\n");
  return { root, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function quietOutput(): NodeJS.WriteStream {
  return { write: () => true, isTTY: false } as unknown as NodeJS.WriteStream;
}

function openAlpha(app: EditorApp): void {
  assert.equal(app.handleInput("\u000f"), true);
  assert.equal(app.handleInput("a"), true);
  assert.equal(app.handleInput("\r"), true);
}

test("normalizes core editing shortcuts", () => {
  assert.equal(normalizeKeypress("\u0013"), "ctrl+s");
  assert.equal(normalizeKeypress("\u001a"), "ctrl+z");
  assert.equal(normalizeKeypress("\u0019"), "ctrl+y");
  assert.equal(normalizeKeypress("\b"), "backspace");
});

test("app edits the open file, tracks dirty state, undoes/redoes, and saves", () => {
  const { root, file, cleanup } = fixtureWorkspace();
  try {
    const app = new EditorApp([root]);
    app.init(process.stdin, quietOutput());
    openAlpha(app);

    assert.equal(app.state.currentFile, file);
    assert.equal(app.state.isDirty, false);
    assert.match(app.renderFrame(), /clean/);

    assert.equal(app.handleInput("x"), true);
    assert.equal(app.state.currentFileContent, "xalpha\n");
    assert.equal(app.state.cursorLine, 0);
    assert.equal(app.state.cursorColumn, 1);
    assert.equal(app.state.isDirty, true);
    assert.match(app.renderFrame(), /dirty/);

    assert.equal(app.handleInput("\u001a"), true);
    assert.equal(app.state.currentFileContent, "alpha\n");
    assert.equal(app.state.isDirty, false);

    assert.equal(app.handleInput("\u0019"), true);
    assert.equal(app.state.currentFileContent, "xalpha\n");
    assert.equal(app.state.isDirty, true);

    assert.equal(app.handleInput("\u0013"), true);
    assert.equal(fs.readFileSync(file, "utf8"), "xalpha\n");
    assert.equal(app.state.isDirty, false);
    assert.match(app.renderFrame(), /clean/);
  } finally {
    cleanup();
  }
});

test("app handles enter and backspace edits at the cursor", () => {
  const { root, cleanup } = fixtureWorkspace();
  try {
    const app = new EditorApp([root]);
    app.init(process.stdin, quietOutput());
    openAlpha(app);

    assert.equal(app.handleInput("\r"), true);
    assert.equal(app.state.currentFileContent, "\nalpha\n");
    assert.equal(app.state.cursorLine, 1);
    assert.equal(app.state.cursorColumn, 0);

    assert.equal(app.handleInput("\u007f"), true);
    assert.equal(app.state.currentFileContent, "alpha\n");
    assert.equal(app.state.cursorLine, 0);
    assert.equal(app.state.cursorColumn, 0);
  } finally {
    cleanup();
  }
});

test("app accepts ctrl-h backspace from terminals", () => {
  const { root, cleanup } = fixtureWorkspace();
  try {
    const app = new EditorApp([root]);
    app.init(process.stdin, quietOutput());
    openAlpha(app);

    assert.equal(app.handleInput("x"), true);
    assert.equal(app.handleInput("\b"), true);
    assert.equal(app.state.currentFileContent, "alpha\n");
    assert.equal(app.state.cursorLine, 0);
    assert.equal(app.state.cursorColumn, 0);
  } finally {
    cleanup();
  }
});

test("app backspace removes CRLF as one newline", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edit-m1-crlf-"));
  const file = path.join(root, "crlf.txt");
  fs.writeFileSync(file, "alpha\r\n");
  try {
    const app = new EditorApp([root]);
    app.init(process.stdin, quietOutput());

    assert.equal(app.handleInput("\u000f"), true);
    assert.equal(app.handleInput("c"), true);
    assert.equal(app.handleInput("\r"), true);
    assert.equal(app.state.currentFile, file);

    assert.equal(app.handleInput("\r"), true);
    assert.equal(app.state.currentFileContent, "\r\nalpha\r\n");
    assert.equal(app.state.cursorLine, 1);
    assert.equal(app.state.cursorColumn, 0);

    assert.equal(app.handleInput("\u007f"), true);
    assert.equal(app.state.currentFileContent, "alpha\r\n");
    assert.equal(app.state.cursorLine, 0);
    assert.equal(app.state.cursorColumn, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
