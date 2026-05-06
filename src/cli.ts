#!/usr/bin/env node
import process from "node:process";
import { createDefaultCommandRegistry } from "./commands.js";
import { renderShellFrame } from "./renderer.js";

type ParsedArgs = {
  paths: string[];
  help: boolean;
  version: boolean;
};

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`edit ${VERSION}\n\nUsage:\n  edit [paths...]\n  edit --help\n  edit --version`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { paths: [], help: false, version: false };

  for (const arg of argv) {
    if (arg === "--help") {
      parsed.help = true;
      continue;
    }

    if (arg === "--version") {
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

  const registry = createDefaultCommandRegistry(() => process.exit(0));
  void registry;

  console.log(renderShellFrame());
}

main();
