import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs, resolveWorkspaceRoots, run, usageText, VERSION } from "../src/cli.js";

function streamCapture(): { stream: NodeJS.WriteStream; output: () => string } {
  let data = "";
  return {
    stream: { write: (chunk: string | Uint8Array) => { data += String(chunk); return true; } } as NodeJS.WriteStream,
    output: () => data
  };
}

test("parseArgs accepts paths, help, and version", () => {
  assert.deepEqual(parseArgs(["src", "--help", "-v"]), {
    exitCode: 0,
    args: { paths: ["src"], help: true, version: true }
  });
});

test("parseArgs rejects unknown flags with exit code 2", () => {
  assert.deepEqual(parseArgs(["--wat"]), { exitCode: 2, error: "Unknown flag: --wat" });
});

test("parseArgs accepts --config path", () => {
  assert.deepEqual(parseArgs(["--config", "custom.json", "."]), {
    exitCode: 0,
    args: { paths: ["."], help: false, version: false, configPath: "custom.json" }
  });
  assert.deepEqual(parseArgs(["--config"]), { exitCode: 2, error: "Missing value for --config" });
});

test("run prints readable help and version", () => {
  const helpOut = streamCapture();
  assert.equal(run(["--help"], helpOut.stream, streamCapture().stream), 0);
  assert.match(helpOut.output(), /Usage:\n  edit \[paths\.\.\.\]/);

  const versionOut = streamCapture();
  assert.equal(run(["--version"], versionOut.stream, streamCapture().stream), 0);
  assert.equal(versionOut.output(), `${VERSION}\n`);
});

test("run returns 2 and prints help for unknown flags", () => {
  const stdout = streamCapture();
  const stderr = streamCapture();

  assert.equal(run(["--bad"], stdout.stream, stderr.stream), 2);
  assert.match(stderr.output(), /Unknown flag: --bad/);
  assert.equal(stdout.output(), `${usageText()}\n`);
});

test("resolveWorkspaceRoots defaults to cwd and de-duplicates paths", () => {
  assert.deepEqual(resolveWorkspaceRoots([]).roots, [process.cwd()]);
  assert.deepEqual(resolveWorkspaceRoots([".", "."]).roots, [process.cwd()]);
});

test("resolveWorkspaceRoots rejects missing paths with exit code 2", () => {
  const result = resolveWorkspaceRoots(["definitely-missing-m0-path"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.error ?? "", /Path does not exist/);
});

test("run returns 2 for invalid config JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-cli-config-"));
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, "{");
  const stderr = streamCapture();

  assert.equal(run(["--config", configPath, "--help"], streamCapture().stream, stderr.stream), 0, "help exits before config load");
  assert.equal(run(["--config", configPath], streamCapture().stream, stderr.stream), 2);
  assert.match(stderr.output(), /Invalid config JSON/);
});
