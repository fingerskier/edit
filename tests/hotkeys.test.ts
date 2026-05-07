import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EditorApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Keymap, normalizeKeypress } from "../src/keymap.js";
import { WorkspaceTree, fuzzyScore } from "../src/workspace.js";

function fixtureWorkspace(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edit-hotkeys-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "alpha.ts"), "const alphaValue = 1;\nconsole.log(alphaValue);\n");
  fs.writeFileSync(path.join(root, "beta.md"), "## beta doc\n");
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function quietOutput(): NodeJS.WriteStream {
  return { write: () => true, isTTY: false } as unknown as NodeJS.WriteStream;
}

test("normalizes requested terminal hotkeys", () => {
  assert.equal(normalizeKeypress("\u001b[1;3A"), "alt+up");
  assert.equal(normalizeKeypress("\u001b[1;3B"), "alt+down");
  assert.equal(normalizeKeypress("\u001b[1;3D"), "alt+left");
  assert.equal(normalizeKeypress("\u001b[1;3C"), "alt+right");
  assert.equal(normalizeKeypress("\u001b[A"), "up");
  assert.equal(normalizeKeypress("\u001b[B"), "down");
  assert.equal(normalizeKeypress("\u001b[D"), "left");
  assert.equal(normalizeKeypress("\u001b[C"), "right");
  assert.equal(normalizeKeypress("\u001bOA"), "up");
  assert.equal(normalizeKeypress("\u001bOB"), "down");
  assert.equal(normalizeKeypress("\u000f"), "ctrl+o");
  assert.equal(normalizeKeypress("\u0010"), "ctrl+p");
});

test("keybindings are editable through JSON config", () => {
  const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edit-config-")), "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ keybindings: { "ctrl+x": "quickOpen.open", "ctrl+p": "tree.select" } }));

  const config = loadConfig(configFile);
  const keymap = new Keymap(config.keybindings);

  assert.equal(keymap.commandForKey("ctrl+x"), "quickOpen.open");
  assert.equal(keymap.commandForKey("ctrl+p"), "tree.select");
});

test("alt arrows navigate, expand, collapse, and alt right opens files in tree", () => {
  const { root, cleanup } = fixtureWorkspace();
  try {
    const app = new EditorApp([root]);
    app.init(process.stdin, quietOutput());

    assert.equal(app.tree.highlightedEntry()?.path, root);
    assert.equal(app.handleInput("\u001b[1;3C"), true);
    assert.equal(app.tree.highlightedEntry()?.expanded, true);

    assert.equal(app.handleInput("\u001b[1;3B"), true);
    assert.equal(app.tree.highlightedEntry()?.kind, "directory");
    assert.equal(app.handleInput("\u001b[1;3C"), true);
    assert.equal(app.tree.highlightedEntry()?.expanded, true);

    assert.equal(app.handleInput("\u001b[1;3B"), true);
    assert.equal(app.tree.highlightedEntry()?.label, "alpha.ts");
    assert.equal(app.handleInput("\u001b[1;3C"), true);
    assert.equal(app.state.currentFile, path.join(root, "src", "alpha.ts"));
    assert.match(app.renderFrame(), /const alphaValue = 1;/);
    assert.match(app.renderFrame(), /console\.log\(alphaValue\);/);

    assert.equal(app.handleInput("\u001b[1;3A"), true);
    assert.equal(app.tree.highlightedEntry()?.label, "src");
    assert.equal(app.handleInput("\u001b[1;3D"), true);
    assert.equal(app.tree.highlightedEntry()?.expanded, false);
  } finally {
    cleanup();
  }
});

test("plain arrows navigate the open file cursor", () => {
  const { root, cleanup } = fixtureWorkspace();
  try {
    const app = new EditorApp([root]);
    app.init(process.stdin, quietOutput());

    assert.equal(app.handleInput("\u000f"), true);
    assert.equal(app.handleInput("a"), true);
    assert.equal(app.handleInput("\r"), true);
    assert.equal(app.state.currentFile, path.join(root, "src", "alpha.ts"));
    assert.equal(app.state.cursorLine, 0);
    assert.equal(app.state.cursorColumn, 0);

    assert.equal(app.handleInput("\u001b[C"), true);
    assert.equal(app.state.cursorLine, 0);
    assert.equal(app.state.cursorColumn, 1);
    assert.match(app.renderFrame(), /Ln 1, Col 2/);

    assert.equal(app.handleInput("\u001b[B"), true);
    assert.equal(app.state.cursorLine, 1);
    assert.equal(app.state.cursorColumn, 1);
    assert.match(app.renderFrame(), /> c▌onsole\.log\(alphaValue\);/);
    assert.match(app.renderFrame(), /Ln 2, Col 2/);

    assert.equal(app.handleInput("\u001b[D"), true);
    assert.equal(app.state.cursorColumn, 0);
    assert.equal(app.handleInput("\u001b[A"), true);
    assert.equal(app.state.cursorLine, 0);
    assert.match(app.renderFrame(), /Ln 1, Col 1/);
  } finally {
    cleanup();
  }
});

test("ctrl+o opens fuzzy quick open and enter selects best file", () => {
  const { root, cleanup } = fixtureWorkspace();
  try {
    const app = new EditorApp([root]);
    app.init(process.stdin, quietOutput());

    assert.equal(app.handleInput("\u000f"), true);
    assert.equal(app.state.overlayMode, "quickOpen");
    assert.equal(app.handleInput("a"), true);
    assert.equal(app.handleInput("x"), true);
    assert.equal(app.handleInput("\b"), true);
    assert.equal(app.handleInput("l"), true);
    assert.equal(app.state.quickOpenQuery, "al");
    assert.equal(app.state.quickOpenResults[0]?.label, path.join("src", "alpha.ts"));
    assert.equal(app.handleInput("\r"), true);
    assert.equal(app.state.currentFile, path.join(root, "src", "alpha.ts"));
  } finally {
    cleanup();
  }
});

test("ctrl+p opens command palette", () => {
  const app = new EditorApp([process.cwd()]);
  app.init(process.stdin, quietOutput());
  assert.equal(app.handleInput("\u0010"), true);
  assert.equal(app.state.overlayMode, "palette");
});

test("fuzzy scoring prefers matching paths", () => {
  assert.ok(fuzzyScore("alp", "src/alpha.ts") > fuzzyScore("alp", "beta.md"));
  const tree = new WorkspaceTree([process.cwd()]);
  assert.ok(Array.isArray(tree.searchFiles("package")));
});
