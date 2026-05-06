#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { EditorApp } from "./app.js";
import { defaultGlobalConfigPath, loadConfig } from "./config.js";

export type ParsedArgs = {
  paths: string[];
  help: boolean;
  version: boolean;
  configPath?: string;
};

export type CliResult = {
  exitCode: number;
  args?: ParsedArgs;
  error?: string;
};

export const VERSION = "2026.5.5";

export function usageText(): string {
  return `edit ${VERSION}\n\nUsage:\n  edit [paths...]\n  edit --help\n  edit --version\n  edit --config <path> [paths...]\n\nOptions:\n  -h, --help      Show this help text\n  -v, --version   Print version and exit\n  --config <path> Load JSON config (default: ${defaultGlobalConfigPath()})\n\nKeys:\n  Arrow keys      Navigate the open file\n  Alt+Up/Down     Navigate directory tree\n  Alt+Left        Collapse tree node\n  Alt+Right       Expand directory or open highlighted file\n  Ctrl+O          Fuzzy file search\n  Ctrl+P          Command palette\n  q / Ctrl+C      Quit\n\nExamples:\n  edit\n  edit .\n  edit --config ~/.edit/config.json src test`;
}

export function parseArgs(argv: string[]): CliResult {
  const parsed: ParsedArgs = { paths: [], help: false, version: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      parsed.version = true;
      continue;
    }

    if (arg === "--config") {
      const configPath = argv[index + 1];
      if (!configPath || configPath.startsWith("-")) {
        return { exitCode: 2, error: "Missing value for --config" };
      }
      parsed.configPath = configPath;
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      return { exitCode: 2, error: `Unknown flag: ${arg}` };
    }

    parsed.paths.push(arg);
  }

  return { exitCode: 0, args: parsed };
}

export function resolveWorkspaceRoots(paths: string[]): CliResult & { roots?: string[] } {
  if (paths.length === 0) {
    return { exitCode: 0, roots: [process.cwd()] };
  }

  const deduped = new Set<string>();
  for (const candidate of paths) {
    const absolute = path.resolve(candidate);
    if (!fs.existsSync(absolute)) {
      return { exitCode: 2, error: `Path does not exist: ${candidate}` };
    }

    deduped.add(absolute);
  }

  return { exitCode: 0, roots: [...deduped] };
}

export function run(argv: string[], stdout: NodeJS.WriteStream = process.stdout, stderr: NodeJS.WriteStream = process.stderr): number {
  const parsed = parseArgs(argv);
  if (parsed.exitCode !== 0 || !parsed.args) {
    if (parsed.error) {
      stderr.write(`${parsed.error}\n`);
    }
    stdout.write(`${usageText()}\n`);
    return parsed.exitCode;
  }

  if (parsed.args.help) {
    stdout.write(`${usageText()}\n`);
    return 0;
  }

  if (parsed.args.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  const roots = resolveWorkspaceRoots(parsed.args.paths);
  if (roots.exitCode !== 0 || !roots.roots) {
    if (roots.error) {
      stderr.write(`${roots.error}\n`);
    }
    return roots.exitCode;
  }

  let config;
  try {
    config = loadConfig(parsed.args.configPath);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  for (const warning of config.warnings) {
    stderr.write(`Config warning: ${warning}\n`);
  }

  const app = new EditorApp(roots.roots, config.keybindings);
  app.init(process.stdin, stdout);
  app.start();
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentPath = fileURLToPath(import.meta.url);
if (invokedPath === currentPath) {
  process.exitCode = run(process.argv.slice(2));
}
