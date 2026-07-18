import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import {
  parseArgs, resolveRoots, loadConfig, usage,
  pluginLoadSpecifiers, pluginDisableNames, assemblePlugins, loadUserPlugins,
} from '../src/cli.ts';
import type { Plugin } from '../src/core/plugin-host.ts';
import { createApp } from '../src/core/app.ts';
import { HeadlessAdapter } from '../src/adapters/headless.ts';
import { defaultPlugins } from '../src/plugins/index.ts';
import { pathToFileURL } from 'node:url';

// --- parseArgs ---

test('parseArgs: bare paths become positional arguments', () => {
  const a = parseArgs(['src', 'README.md']);
  assert.deepEqual(a.paths, ['src', 'README.md']);
  assert.equal(a.help, false);
  assert.equal(a.error, undefined);
});

test('parseArgs: help/version flags (long and short)', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--version']).version, true);
  assert.equal(parseArgs(['-v']).version, true);
});

test('parseArgs: --config/--theme take a value (spaced or =)', () => {
  assert.equal(parseArgs(['--config', '/x/c.json']).configPath, '/x/c.json');
  assert.equal(parseArgs(['--config=/x/c.json']).configPath, '/x/c.json');
  assert.equal(parseArgs(['--theme', 't.json']).themePath, 't.json');
  assert.equal(parseArgs(['--no-lsp']).noLsp, true);
});

test('parseArgs: a flag missing its value is an error', () => {
  assert.match(parseArgs(['--config']).error ?? '', /missing value for --config/);
});

test('parseArgs: unknown options are errors', () => {
  assert.match(parseArgs(['--bogus']).error ?? '', /unknown option: --bogus/);
});

test('parseArgs: "--" stops flag parsing', () => {
  const a = parseArgs(['--', '--weird-file-name']);
  assert.deepEqual(a.paths, ['--weird-file-name']);
  assert.equal(a.error, undefined);
});

test('usage text mentions the core options', () => {
  const u = usage();
  assert.match(u, /--help/);
  assert.match(u, /--version/);
  assert.match(u, /paths/);
});

// --- resolveRoots ---

test('resolveRoots: no paths -> cwd is the sole root', async () => {
  const r = await resolveRoots([], '/work/dir');
  assert.deepEqual(r, { roots: [resolve('/work/dir')], files: [] });
});

test('resolveRoots: a directory becomes a root; a file adds its dir + queues to open', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-cli-'));
  try {
    const sub = join(dir, 'sub');
    await mkdir(sub);
    const file = join(dir, 'a.txt');
    await writeFile(file, 'x');

    const r = await resolveRoots([sub, file], dir);
    assert.deepEqual(r.files, [resolve(file)]);
    assert.ok(r.roots.includes(resolve(sub)), 'directory arg is a root');
    assert.ok(r.roots.includes(resolve(dirname(file))), 'file arg contributes its parent dir');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveRoots: dedupes repeated roots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-cli-'));
  try {
    await writeFile(join(dir, 'a.txt'), 'a');
    await writeFile(join(dir, 'b.txt'), 'b');
    const r = await resolveRoots([join(dir, 'a.txt'), join(dir, 'b.txt')], dir);
    assert.deepEqual(r.roots, [resolve(dir)], 'both files share one parent root');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveRoots: a missing path throws', async () => {
  await assert.rejects(
    resolveRoots(['/definitely/does/not/exist-xyz'], '/'),
    /path does not exist/,
  );
});

// --- loadConfig ---

test('loadConfig: absent user config is fine (empty object)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edit-home-'));
  try {
    assert.deepEqual(await loadConfig({ home }), {});
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('loadConfig: reads ~/.edit/config.json', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edit-home-'));
  try {
    await mkdir(join(home, '.edit'));
    await writeFile(join(home, '.edit', 'config.json'), JSON.stringify({ save: { autosaveMs: 1000 } }));
    assert.deepEqual(await loadConfig({ home }), { save: { autosaveMs: 1000 } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('loadConfig: an explicit --config path that is missing throws', async () => {
  await assert.rejects(
    loadConfig({ home: '/tmp', explicitPath: '/no/such/config.json' }),
    /config file not found/,
  );
});

test('loadConfig: malformed JSON throws', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edit-home-'));
  try {
    const p = join(home, 'broken.json');
    await writeFile(p, '{ not valid json');
    await assert.rejects(loadConfig({ home, explicitPath: p }), /invalid config JSON/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// --- plugin assembly ---

const stub = (name: string): Plugin => ({ name, activate() {} });

test('pluginLoadSpecifiers: reads plugins.load string array; ignores junk', () => {
  assert.deepEqual(pluginLoadSpecifiers({}), []);
  assert.deepEqual(pluginLoadSpecifiers({ plugins: { load: ['a', '', 1, 'b'] as any } }), ['a', 'b']);
});

test('pluginDisableNames: reads plugins.disable string array', () => {
  assert.deepEqual(pluginDisableNames({ plugins: { disable: ['status-bar', 3 as any] } }), ['status-bar']);
});

test('assemblePlugins: defaults first, disable by name, user plugins append', () => {
  const defaults = [stub('keymap'), stub('status-bar'), stub('tabs')];
  const user = [stub('my-plugin')];
  const merged = assemblePlugins(defaults, user, ['status-bar']);
  assert.deepEqual(merged.map((p) => p.name), ['keymap', 'tabs', 'my-plugin']);
});

test('loadUserPlugins: loads loose .mjs files from localDir', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edit-home-'));
  const pluginsDir = join(home, '.edit', 'plugins');
  try {
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(
      join(pluginsDir, 'hello.mjs'),
      `export default { name: 'hello', activate() {} };\n`,
    );
    const plugins = await loadUserPlugins({ config: {}, home, localDir: pluginsDir });
    assert.deepEqual(plugins.map((p) => p.name), ['hello']);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('loadUserPlugins: config.plugins.load imports by absolute path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-pkg-'));
  try {
    const mod = join(dir, 'extra.mjs');
    await writeFile(mod, `export default { name: 'extra', activate() {} };\n`);
    // file: URL so Node's import works with absolute paths across platforms.
    const plugins = await loadUserPlugins({
      config: { plugins: { load: [pathToFileURL(mod).href] } },
      home: dir,
      localDir: join(dir, 'no-such-local'),
    });
    assert.deepEqual(plugins.map((p) => p.name), ['extra']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('end-to-end: assembled plugins activate and register a command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edit-user-plug-'));
  try {
    await writeFile(
      join(dir, 'greet.mjs'),
      `export default {
        name: 'greet',
        activate(ctx) {
          ctx.subscriptions.push(
            ctx.commands.register('greet.hello', () => 'hi', { title: 'Greet' }),
          );
        },
      };\n`,
    );
    const user = await loadUserPlugins({ config: {}, home: dir, localDir: dir });
    const plugins = assemblePlugins(defaultPlugins(), user);
    const app = await createApp({ adapter: new HeadlessAdapter(), plugins, roots: [] });
    assert.ok(app.commands.ids().includes('greet.hello'));
    assert.equal(await app.commands.run('greet.hello'), 'hi');
    await app.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
