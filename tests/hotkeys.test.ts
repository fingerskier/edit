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
  fs.writeFileSync(path.join(root, "src", "alpha.ts"), "alpha");
  fs.writeFileSync(path.join(root, "beta.md"), "beta");
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

    assert.equal(app.handleInput("\u001b[1;3A"), true);
    assert.equal(app.tree.highlightedEntry()?.label, "src");
    assert.equal(app.handleInput("\u001b[1;3D"), true);
    assert.equal(app.tree.highlightedEntry()?.expanded, false);
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
    assert.equal(app.handleInput("l"), true);
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
