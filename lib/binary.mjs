// Finding, downloading, or building the desktop app binary.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assetName, cachedBinary, releaseUrl } from './paths.mjs';

const exe = process.platform === 'win32' ? 'fedit.exe' : 'fedit';

/** An existing binary: explicit override, the cache, or a local development build. */
export function findBinary({ version, pkgRoot, env = process.env }) {
  if (env.FEDIT_BINARY) return fs.existsSync(env.FEDIT_BINARY) ? env.FEDIT_BINARY : null;
  const cached = cachedBinary(version, env);
  if (fs.existsSync(cached)) return cached;
  const dev = path.join(pkgRoot, 'src-tauri', 'target', 'release', exe);
  if (fs.existsSync(dev) && fs.existsSync(path.join(pkgRoot, '.git'))) return dev;
  return null;
}

function place(source, dest, move) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.copyFileSync(source, tmp);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
  if (move) fs.rmSync(source, { force: true });
  return dest;
}

/** Download the prebuilt binary for this version. Resolves null when none is published. */
export async function downloadBinary({ version, env = process.env, log = console.error }) {
  const url = releaseUrl(version);
  if (!url) return null;
  log(`Downloading ${assetName()} for v${version}…`);
  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    log(`Download failed: ${e.message}`);
    return null;
  }
  if (!response.ok) {
    log(`No prebuilt binary at ${url} (HTTP ${response.status}).`);
    return null;
  }
  const dest = cachedBinary(version, env);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.download`;
  fs.writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
  return place(tmp, dest, true);
}

export function hasCargo() {
  return spawnSync('cargo', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}

/** Build the app from the sources shipped in the package. Needs a Rust toolchain. */
export function buildFromSource({ version, pkgRoot, env = process.env, log = console.error }) {
  if (!fs.existsSync(path.join(pkgRoot, 'dist', 'index.html'))) {
    throw new Error('The web UI is not built. Run `npm run build:ui` first.');
  }
  const target = path.join(os.tmpdir(), `fedit-build-${version}`);
  log('Building Fedit from source with cargo. The first build takes a few minutes…');
  const result = spawnSync(
    'cargo',
    ['build', '--release', '--locked', '--features', 'tauri/custom-protocol', '--manifest-path', path.join(pkgRoot, 'src-tauri', 'Cargo.toml')],
    { stdio: 'inherit', env: { ...env, CARGO_TARGET_DIR: target }, shell: process.platform === 'win32' },
  );
  if (result.status !== 0) throw new Error('cargo build failed.');
  const dest = place(path.join(target, 'release', exe), cachedBinary(version, env), false);
  fs.rmSync(target, { recursive: true, force: true });
  return dest;
}

/** Find a binary, or obtain one: download first, then a source build if cargo is available. */
export async function ensureBinary({ version, pkgRoot, env = process.env, fromSource = false, log = console.error }) {
  if (!fromSource) {
    const found = findBinary({ version, pkgRoot, env });
    if (found) return found;
    if (env.FEDIT_BINARY) throw new Error(`FEDIT_BINARY points to a missing file: ${env.FEDIT_BINARY}`);
    const downloaded = await downloadBinary({ version, env, log });
    if (downloaded) return downloaded;
  }
  if (hasCargo()) return buildFromSource({ version, pkgRoot, env, log });
  throw new Error(
    fromSource
      ? 'Building from source needs the Rust toolchain (https://rustup.rs).'
      : `No Fedit binary is available for ${process.platform}-${process.arch}, and cargo was not found to build one.\n` +
        'Install Rust (https://rustup.rs) and run `fedit install --from-source`.',
  );
}
