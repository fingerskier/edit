#!/usr/bin/env node
// `fedit` — launcher for the Fedit desktop editor.
//
// The npm package carries this script, the web UI and the app's Rust sources.
// The desktop binary itself is downloaded from the matching GitHub release on
// first use (or built with cargo when no prebuilt binary exists).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBinary } from '../lib/binary.mjs';
import { installLauncher, launcherPaths, removeLauncher } from '../lib/desktop.mjs';
import { PACKAGE, configDir, parseArgs } from '../lib/paths.mjs';
import { runNpm } from '../lib/proc.mjs';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
/** Records which binary the application launcher was last built for. */
const launcherStamp = path.join(configDir(), 'launcher.json');

const HELP = `Fedit ${version} — a lightweight, pluggable desktop text editor

Usage:
  fedit [path...]            Open files, or a folder, in the editor
  fedit install              Install globally and add an application launcher
  fedit uninstall            Remove the launcher and downloaded binaries
  fedit plugin add <pkg>     Install a plugin package from npm
  fedit plugin remove <pkg>  Remove an installed plugin package
  fedit plugin list          List plugins

Options:
  -n, --new-window Open the paths in a new window of the running app
  --new-instance   Start a separate, independent copy of the app
  --from-source    With install: build the app with cargo instead of downloading
  --verbose        Keep the app attached to this terminal and show its output
  -v, --version    Print the version
  -h, --help       Show this help

Config: ${configDir()}
`;

function npmGlobalVersion() {
  const result = runNpm(['ls', '-g', PACKAGE, '--json', '--depth=0'], { encoding: 'utf8' });
  try {
    return JSON.parse(result.stdout).dependencies?.[PACKAGE]?.version ?? null;
  } catch {
    return null;
  }
}

/** True when this script runs from npx's temporary cache rather than an install. */
function runningFromNpx() {
  return pkgRoot.split(path.sep).includes('_npx');
}

async function install({ fromSource }) {
  if (npmGlobalVersion() !== version) {
    const spec = process.env.FEDIT_INSTALL_SPEC || `${PACKAGE}@${version}`;
    console.error(`Installing ${spec} globally…`);
    const result = runNpm(['install', '-g', spec], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error('Global install failed. The editor still runs through npx; fix npm permissions and run `fedit install` to retry.');
    }
  }
  const binary = await ensureBinary({ version, pkgRoot, fromSource });
  const launcher = refreshLauncher(binary);
  console.error(`Fedit ${version} is installed.` + (launcher ? ` Launcher: ${launcher}` : ''));
  console.error('Run `fedit <file or folder>` from a terminal, or start Fedit from your application menu.');
  return binary;
}

/** (Re)create the application launcher for `binary` and remember that it was done. */
function refreshLauncher(binary) {
  const launcher = installLauncher({ binary, version, pkgRoot });
  if (launcher) {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(launcherStamp, JSON.stringify({ binary, version }) + '\n');
  }
  return launcher;
}

/** True when a launcher exists but was made for a different binary (after an upgrade). */
function launcherIsStale(binary) {
  const entry = launcherPaths()?.entry;
  if (!entry || !fs.existsSync(entry)) return false;
  try {
    return JSON.parse(fs.readFileSync(launcherStamp, 'utf8')).binary !== binary;
  } catch {
    return true;
  }
}

function uninstall() {
  const removed = removeLauncher();
  fs.rmSync(launcherStamp, { force: true });
  const bin = path.join(configDir(), 'bin');
  if (fs.existsSync(bin)) {
    fs.rmSync(bin, { recursive: true, force: true });
    removed.push(bin);
  }
  for (const p of removed) console.error(`Removed ${p}`);
  console.error(`Settings and plugins in ${configDir()} were kept.`);
  console.error(`To remove the command itself: npm uninstall -g ${PACKAGE}`);
}

function plugin(args) {
  const dir = path.join(configDir(), 'plugins');
  const [action, ...names] = args;
  if (action === 'list') {
    const loose = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.m?js$/.test(f)) : [];
    let deps = {};
    try {
      deps = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies ?? {};
    } catch {
      // No packages installed yet.
    }
    for (const f of loose) console.log(`${f}  (file)`);
    for (const [name, range] of Object.entries(deps)) console.log(`${name}  ${range}`);
    if (loose.length === 0 && Object.keys(deps).length === 0) console.log(`No plugins. Put .js files in ${dir} or run \`fedit plugin add <pkg>\`.`);
    return 0;
  }
  if ((action !== 'add' && action !== 'remove') || names.length === 0) {
    console.error('Usage: fedit plugin add <pkg>... | remove <pkg>... | list');
    return 2;
  }
  fs.mkdirSync(dir, { recursive: true });
  const manifest = path.join(dir, 'package.json');
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ name: 'fedit-plugins', private: true }, null, 2) + '\n');
  const npmArgs = [action === 'add' ? 'install' : 'uninstall', '--prefix', dir, '--no-audit', '--no-fund', ...names];
  const status = runNpm(npmArgs, { stdio: 'inherit' }).status ?? 1;
  if (status === 0) console.error('Done. Run "Developer: Reload Window" in Fedit (or restart it) to apply.');
  return status;
}

function launch(binary, paths, flags) {
  const env = { ...process.env };
  if (flags.has('--new-instance')) env.FEDIT_NEW_INSTANCE = '1';
  // The app itself reads this one: a running copy opens the paths in a new window.
  if (flags.has('--new-window') || flags.has('-n')) paths = ['--new-window', ...paths];
  if (flags.has('--verbose')) {
    const child = spawn(binary, paths, { stdio: 'inherit', env });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }
  // Detach so the editor outlives this terminal. Its output goes to a log file:
  // a pipe would break once this process exits.
  fs.mkdirSync(configDir(), { recursive: true });
  const logPath = path.join(configDir(), 'fedit.log');
  const log = fs.openSync(logPath, 'w');
  const child = spawn(binary, paths, { detached: true, stdio: ['ignore', log, log], env });
  let settled = false;
  const done = (code) => {
    if (settled) return;
    settled = true;
    process.exit(code);
  };
  child.on('error', (e) => {
    console.error(`Cannot start ${binary}: ${e.message}`);
    done(1);
  });
  // A healthy start either keeps running or exits 0 after handing the paths to
  // the window that is already open. Anything else in the first moments is a
  // startup failure worth showing.
  child.on('exit', (code, signal) => {
    if (code === 0) return done(0);
    console.error(`Fedit exited at startup (${signal ?? `code ${code}`}).`);
    try {
      console.error(fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-15).join('\n'));
    } catch {
      // No log to show.
    }
    if (process.platform === 'linux') console.error('Fedit needs WebKitGTK 4.1 (package webkit2gtk-4.1 / libwebkit2gtk-4.1-0).');
    if (process.platform === 'win32') console.error('Fedit needs the Microsoft Edge WebView2 runtime.');
    done(1);
  });
  setTimeout(() => {
    child.unref();
    done(0);
  }, 1200);
}

async function main() {
  const argv = process.argv.slice(2);
  const { flags } = parseArgs(argv);
  if (flags.has('-h') || flags.has('--help')) return void process.stdout.write(HELP);
  if (flags.has('-v') || flags.has('--version')) return void console.log(version);

  const [command, ...rest] = argv.filter((a) => !a.startsWith('-'));
  if (command === 'plugin') process.exit(plugin(rest));
  if (command === 'uninstall' && rest.length === 0) return uninstall();
  if (command === 'install' && rest.length === 0) return void (await install({ fromSource: flags.has('--from-source') }));

  const { paths } = parseArgs(argv);
  // First run through npx: install for good, then open the editor.
  const binary =
    runningFromNpx() && npmGlobalVersion() !== version
      ? await install({ fromSource: false })
      : await ensureBinary({ version, pkgRoot });
  // Keep an existing launcher pointing at the current binary after an upgrade.
  if (launcherIsStale(binary)) {
    try {
      refreshLauncher(binary);
    } catch (e) {
      console.error(`Could not update the application launcher: ${e.message}`);
    }
  }
  launch(binary, paths, flags);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
