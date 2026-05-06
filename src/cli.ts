#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import { createDefaultCommandRegistry } from "./commands.js";
import { renderShellFrame } from "./renderer.js";

type ParsedArgs = {
  paths: string[];
  help: boolean;
  version: boolean;
};

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(
    `edit ${VERSION}\n\nUsage:\n  edit [paths...]\n  edit --help\n  edit --version\n\nExamples:\n  edit\n  edit .\n  edit src test`
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { paths: [], help: false, version: false };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      parsed.version = true;
      continue;
    }

    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      process.exitCode = 2;
      printHelp();
      process.exit();
    }

    parsed.paths.push(arg);
  }

  return parsed;
}

function resolveWorkspaceRoots(paths: string[]): string[] {
  if (paths.length === 0) {
    return [process.cwd()];
  }

  const deduped = new Set<string>();
  for (const candidate of paths) {
    const absolute = path.resolve(candidate);
    if (!fs.existsSync(absolute)) {
      console.error(`Path does not exist: ${candidate}`);
      process.exitCode = 2;
      process.exit();
    }

    deduped.add(absolute);
  }

  return [...deduped];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.version) {
    console.log(VERSION);
    return;
  }

  const workspaceRoots = resolveWorkspaceRoots(args.paths);

  const registry = createDefaultCommandRegistry(() => process.exit(0));
  void registry;

  console.log(renderShellFrame(workspaceRoots));
}

main();
