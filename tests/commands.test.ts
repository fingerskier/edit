import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, createDefaultCommandRegistry } from "../src/commands.js";

test("command registry registers, lists, and executes commands", () => {
  const registry = new CommandRegistry();
  let executed = false;

  registry.register("sample.run", () => {
    executed = true;
  });

  assert.deepEqual(registry.list(), ["sample.run"]);
  assert.equal(registry.execute("sample.run"), true);
  assert.equal(executed, true);
  assert.equal(registry.execute("missing.command"), false);
});

test("default command registry contains milestone 0 commands", () => {
  let quit = false;
  const registry = createDefaultCommandRegistry(() => {
    quit = true;
  });

  assert.deepEqual(registry.list(), [
    "app.quit",
    "editor.focus",
    "editor.navigate.down",
    "editor.navigate.left",
    "editor.navigate.right",
    "editor.navigate.up",
    "editor.redo",
    "editor.save",
    "editor.undo",
    "palette.open",
    "quickOpen.open",
    "tree.collapse",
    "tree.expand",
    "tree.focus",
    "tree.navigate.down",
    "tree.navigate.up",
    "tree.select"
  ]);
  assert.equal(registry.execute("app.quit"), true);
  assert.equal(quit, true);
});
