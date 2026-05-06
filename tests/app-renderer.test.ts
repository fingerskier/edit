import assert from "node:assert/strict";
import test from "node:test";
import { EditorApp } from "../src/app.js";
import { renderShellFrame } from "../src/renderer.js";

test("renderer includes fixed tree, editor, status, and palette regions", () => {
  const frame = renderShellFrame({ workspaceRoots: [process.cwd()], focusedRegion: "tree", overlayMode: "none" });

  assert.match(frame, /Tree/);
  assert.match(frame, /Editor/);
  assert.match(frame, /Status:/);
  assert.match(frame, /Palette: <closed>/);
});

test("renderer is stable for identical input", () => {
  const options = { workspaceRoots: [process.cwd()], focusedRegion: "editor" as const, overlayMode: "palette" as const };
  assert.equal(renderShellFrame(options), renderShellFrame(options));
});

test("renderer fills the requested terminal dimensions", () => {
  const frame = renderShellFrame({ workspaceRoots: [process.cwd()], terminalSize: { columns: 100, rows: 30 } });
  const lines = frame.split("\n");

  assert.equal(lines.length, 30);
  assert.ok(lines.every((line) => line.length === 100));
});

test("app lifecycle initializes, dispatches input commands, renders, and shuts down", () => {
  const app = new EditorApp([process.cwd()]);
  const quietOutput = { write: () => true, isTTY: false } as unknown as NodeJS.WriteStream;

  app.init(process.stdin, quietOutput);
  assert.equal(app.state.running, true);
  assert.equal(app.state.focusedRegion, "editor");

  assert.equal(app.handleInput("t"), true);
  assert.equal(app.state.focusedRegion, "tree");

  assert.equal(app.handleInput("p"), true);
  assert.equal(app.state.overlayMode, "palette");
  assert.match(app.renderFrame(), /Palette: type a command/);

  assert.equal(app.handleInput("q"), true);
  assert.equal(app.state.running, false);
});
