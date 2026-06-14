#!/usr/bin/env node
// `edit` CLI entrypoint. The pure parts (parseArgs / resolveRoots / loadConfig) are
// exported and unit-tested; main() wires the TUI adapter + core + default plugins to
// the real terminal and is smoke-tested manually. Process side effects (exit, signal
// handlers, terminal raw mode) run only when this file is executed as a script.

import { stat, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './core/app.js';
import { defaultPlugins } from './plugins/index.js';
import { TuiAdapter } from './adapters/tui/tui-adapter.js';
import { Terminal } from './adapters/tui/terminal.js';

export type Config = Record<string, Record<string, unknown>>;

export interface ParsedArgs {
  paths: string[];
  help: boolean;
  version: boolean;
  configPath?: string;
  themePath?: string;
  noLsp: boolean;
  error?: string;
}

export function usage(): string {
  return [
    'Usage: edit [options] [paths...]',
    '',
    'A lightning-fast cross-platform terminal text editor.',
    '',
    'Arguments:',
    '  paths            Files and/or directories to open (directories become roots)',
    '',
    'Options:',
    '  -h, --help       Show this help and exit',
    '  -v, --version    Print the version and exit',
    '  --config <path>  Use the given config file',
    '  --theme <path>   Use the given theme file',
    '  --no-lsp         Disable language servers',
  ].join('\n');
}

/** Parse `edit [options] [paths...]`. Never throws; reports problems via `.error`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const res: ParsedArgs = { paths: [], help: false, version: false, noLsp: false };
  let positionalOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (positionalOnly) { res.paths.push(arg); continue; }
    if (arg === '--') { positionalOnly = true; continue; }

    // Support both "--config path" and "--config=path".
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    const inlineVal = eq >= 0 ? arg.slice(eq + 1) : undefined;

    const takeValue = (): string | undefined => {
      if (inlineVal !== undefined) return inlineVal;
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) return undefined;
      i++;
      return next;
    };

    switch (flag) {
      case '-h': case '--help': res.help = true; break;
      case '-v': case '--version': res.version = true; break;
      case '--no-lsp': res.noLsp = true; break;
      case '--config': {
        const v = takeValue();
        if (v === undefined) { res.error = `missing value for ${flag}`; return res; }
        res.configPath = v; break;
      }
      case '--theme': {
        const v = takeValue();
        if (v === undefined) { res.error = `missing value for ${flag}`; return res; }
        res.themePath = v; break;
      }
      default:
        if (arg.startsWith('-') && arg !== '-') { res.error = `unknown option: ${arg}`; return res; }
        res.paths.push(arg);
    }
  }
  return res;
}

export interface ResolvedRoots { roots: string[]; files: string[] }

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Resolve CLI paths into workspace roots + files to open. Directories are roots;
 * files contribute their parent directory as a root and are queued to open. With no
 * paths, the current directory is the sole root. Throws on a non-existent path.
 */
export async function resolveRoots(paths: string[], cwd: string): Promise<ResolvedRoots> {
  if (paths.length === 0) return { roots: [resolve(cwd)], files: [] };

  const roots: string[] = [];
  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(cwd, p);
    let st;
    try { st = await stat(abs); } catch { throw new Error(`path does not exist: ${p}`); }
    if (st.isDirectory()) roots.push(abs);
    else { files.push(abs); roots.push(dirname(abs)); }
  }
  return { roots: dedupe(roots), files: dedupe(files) };
}

/**
 * Load config JSON. Precedence: an explicit --config path (required to exist) else the
 * user file `~/.edit/config.json` (absent is fine). Throws on a missing explicit file
 * or malformed JSON (caller maps to exit code 2).
 */
export async function loadConfig(opts: { home: string; explicitPath?: string }): Promise<Config> {
  const path = opts.explicitPath ?? join(opts.home, '.edit', 'config.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    if (opts.explicitPath) throw new Error(`config file not found: ${opts.explicitPath}`);
    return {};
  }
  try {
    return JSON.parse(raw) as Config;
  } catch {
    throw new Error(`invalid config JSON in ${path}`);
  }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.error) { process.stderr.write(`edit: ${args.error}\n\n${usage()}\n`); process.exit(2); }
  if (args.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
  if (args.version) { process.stdout.write(`${readVersion()}\n`); process.exit(0); }

  let roots: string[];
  let files: string[];
  let config: Config;
  try {
    ({ roots, files } = await resolveRoots(args.paths, process.cwd()));
    config = await loadConfig({ home: homedir(), explicitPath: args.configPath });
  } catch (err) {
    process.stderr.write(`edit: ${(err as Error).message}\n`);
    process.exit(2);
    return;
  }

  const term = new Terminal();
  const adapter = new TuiAdapter(term);
  const app = await createApp({ adapter, plugins: defaultPlugins(), roots, config });

  // Open any files passed on the command line (best-effort; the editor has focus by default).
  for (const f of files) {
    try { await app.workspace.openFile(f); } catch { /* skip unreadable file */ }
  }

  // Quit path: a command + binding the keymap can resolve, plus OS signals. Disposing
  // the app tears down plugins, the watcher, and the adapter (which restores the TTY).
  let quitting = false;
  const shutdown = async (code: number): Promise<void> => {
    if (quitting) return;
    quitting = true;
    try {
      await app.dispose();
    } catch {
      try { term.stop(); } catch { /* already restored */ }
    }
    process.exit(code);
  };
  app.commands.register('app.quit', () => shutdown(0), { title: 'Quit' });
  app.keys.bind('global:ctrl+q', 'app.quit');
  process.on('SIGINT', () => { void shutdown(0); });
  process.on('SIGTERM', () => { void shutdown(0); });
}

// Run only when executed directly (not when imported by tests).
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  void main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`edit: fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
