import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore plain ES modules without type declarations
import { assetName, cachedBinary, configDir, parseArgs, releaseUrl } from '../lib/paths.mjs';
// @ts-ignore
import { desktopEntry, infoPlist, installLauncher, launcherPaths, removeLauncher } from '../lib/desktop.mjs';
// @ts-ignore
import { findBinary } from '../lib/binary.mjs';
// @ts-ignore
import { quoteForCmd } from '../lib/proc.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fedit = path.join(root, 'bin', 'fedit.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fedit-launcher-'));

test('config directory follows the same rules as the app', () => {
  assert.equal(configDir({ FEDIT_HOME: '/x' }, 'linux', '/home/u'), '/x');
  assert.equal(configDir({ XDG_CONFIG_HOME: '/cfg' }, 'linux', '/home/u'), '/cfg/fedit');
  assert.equal(configDir({}, 'linux', '/home/u'), '/home/u/.config/fedit');
  assert.equal(configDir({}, 'darwin', '/Users/u'), '/Users/u/.config/fedit');
  assert.equal(configDir({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u'), 'C:\\Users\\u\\AppData\\Roaming\\fedit');
});

test('release assets are named per platform', () => {
  assert.equal(assetName('linux', 'x64'), 'fedit-linux-x64');
  assert.equal(assetName('darwin', 'arm64'), 'fedit-macos-arm64');
  assert.equal(assetName('win32', 'x64'), 'fedit-windows-x64.exe');
  assert.equal(assetName('freebsd', 'x64'), null);
  assert.equal(assetName('linux', 'ia32'), null);
  assert.equal(releaseUrl('1.2.3', 'linux', 'x64'), 'https://github.com/fingerskier/edit/releases/download/v1.2.3/fedit-linux-x64');
  assert.equal(cachedBinary('1.2.3', { FEDIT_HOME: '/c' }, 'linux', 'x64'), '/c/bin/1.2.3-linux-x64/fedit');
  assert.equal(cachedBinary('1.2.3', { FEDIT_HOME: 'C:\\c' }, 'win32', 'arm64'), 'C:\\c\\bin\\1.2.3-win32-arm64\\fedit.exe');
});

test('arguments split into flags and absolute paths', () => {
  const cwd = path.resolve('/cwd');
  const { flags, paths } = parseArgs(['--verbose', 'a.txt', path.resolve('/abs/b'), '--', '-dash.txt'], cwd);
  assert.deepEqual([...flags], ['--verbose']);
  assert.deepEqual(paths, [path.join(cwd, 'a.txt'), path.resolve('/abs/b'), path.join(cwd, '-dash.txt')]);
});

test('desktop entry quotes the binary and passes files', () => {
  const entry = desktopEntry('/home/u/my "apps"/fedit');
  assert.match(entry, /^Exec="\/home\/u\/my \\"apps\\"\/fedit" %F$/m);
  assert.match(entry, /^MimeType=text\/plain;.*;$/m);
  assert.match(entry, /^Categories=.*TextEditor;/m);
  assert.match(infoPlist('1.2.3'), /<string>1\.2\.3<\/string>/);
});

test('linux launcher installs and removes cleanly', () => {
  const home = tmp();
  const env = { XDG_DATA_HOME: path.join(home, 'share') };
  const entry = installLauncher({ binary: '/opt/fedit', version: '1.0.0', pkgRoot: root, platform: 'linux', env, home });
  assert.equal(entry, path.join(home, 'share', 'applications', 'fedit.desktop'));
  assert.match(fs.readFileSync(entry, 'utf8'), /Exec="\/opt\/fedit" %F/);
  for (const icon of launcherPaths('linux', env, home).icons) assert.ok(fs.statSync(icon).size > 0, icon);
  assert.equal(removeLauncher('linux', env, home).length, 3);
  assert.equal(fs.existsSync(entry), false);
  assert.deepEqual(removeLauncher('linux', env, home), []);
});

test('windows shell arguments keep paths with spaces in one piece', () => {
  assert.equal(quoteForCmd('install'), 'install');
  assert.equal(quoteForCmd('C:\\Users\\Jane Doe\\fedit'), '"C:\\Users\\Jane Doe\\fedit"');
  assert.equal(quoteForCmd('a"b'), '"a""b"');
  assert.equal(quoteForCmd('x&y'), '"x&y"');
  assert.equal(quoteForCmd(''), '""');
});

test('an upgraded binary refreshes an existing launcher', { skip: process.platform !== 'linux' }, () => {
  const home = tmp();
  const env = { ...process.env, FEDIT_HOME: home, XDG_DATA_HOME: path.join(home, 'share') };
  const entry = path.join(home, 'share', 'applications', 'fedit.desktop');
  const fake = path.join(home, 'fedit-new');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const run = () => spawnSync(process.execPath, [fedit, 'x.txt'], { encoding: 'utf8', env: { ...env, FEDIT_BINARY: fake } });

  // No launcher installed: running the editor does not create one.
  assert.equal(run().status, 0);
  assert.equal(fs.existsSync(entry), false);

  // A launcher left by an older version is repointed at the current binary.
  installLauncher({ binary: '/old/fedit', version: '0.0.1', pkgRoot: root, platform: 'linux', env, home });
  assert.equal(run().status, 0);
  assert.match(fs.readFileSync(entry, 'utf8'), new RegExp(`Exec="${fake}" %F`));
  const stamp = fs.statSync(path.join(home, 'launcher.json')).mtimeMs;
  assert.equal(run().status, 0);
  assert.equal(fs.statSync(path.join(home, 'launcher.json')).mtimeMs, stamp, 'an up-to-date launcher is left alone');
});

test('binary lookup: override, then cache', () => {
  const home = tmp();
  const env = { FEDIT_HOME: home };
  assert.equal(findBinary({ version: '9.9.9', pkgRoot: home, env }), null);
  const cached = cachedBinary('9.9.9', env);
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, '');
  assert.equal(findBinary({ version: '9.9.9', pkgRoot: home, env }), cached);
  assert.equal(findBinary({ version: '9.9.9', pkgRoot: home, env: { ...env, FEDIT_BINARY: '/nope' } }), null);
  assert.equal(findBinary({ version: '9.9.9', pkgRoot: home, env: { ...env, FEDIT_BINARY: cached } }), cached);
});

test('cli: version, help, and plugin listing', () => {
  const home = tmp();
  const run = (...args: string[]) => spawnSync(process.execPath, [fedit, ...args], { encoding: 'utf8', env: { ...process.env, FEDIT_HOME: home } });
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(run('--version').stdout.trim(), version);
  assert.match(run('--help').stdout, /fedit plugin add/);
  assert.match(run('plugin', 'list').stdout, /No plugins/);
  fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins', 'a.js'), '');
  fs.writeFileSync(path.join(home, 'plugins', 'package.json'), '{"dependencies":{"some-plugin":"^1.0.0"}}');
  assert.equal(run('plugin', 'list').stdout, 'a.js  (file)\nsome-plugin  ^1.0.0\n');
  assert.equal(run('plugin', 'bogus').status, 2);
});

test('cli: a binary that fails at startup is reported, with its output', { skip: process.platform === 'win32' }, () => {
  const home = tmp();
  const bad = path.join(home, 'bad');
  fs.writeFileSync(bad, '#!/bin/sh\necho "libwebkit missing" >&2\nexit 127\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, [fedit, 'x.txt'], { encoding: 'utf8', env: { ...process.env, FEDIT_HOME: home, FEDIT_BINARY: bad } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exited at startup \(code 127\)/);
  assert.match(result.stderr, /libwebkit missing/);
});

test('cli: starts the app detached with absolute paths', { skip: process.platform === 'win32' }, () => {
  const home = tmp();
  const out = path.join(home, 'args.txt');
  const fake = path.join(home, 'fake');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}"\necho "$FEDIT_NEW_INSTANCE" >> "${out}"\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [fedit, '--new-instance', 'rel.txt', '/abs/dir'], {
    encoding: 'utf8', cwd: home, env: { ...process.env, FEDIT_HOME: home, FEDIT_BINARY: fake },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), `${fs.realpathSync(home)}/rel.txt\n/abs/dir\n1\n`);
});

test('package and crate versions match, so the launcher downloads the right release', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  assert.equal(/^version = "(.+)"$/m.exec(cargo)?.[1], version);
});
