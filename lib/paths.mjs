// Locations shared by the launcher and the desktop app.

import os from 'node:os';
import path from 'node:path';

export const REPO = 'fingerskier/edit';
export const PACKAGE = '@fingerskier/edit';

/** The settings/keybindings/plugins directory. Must match `config_dir` in src-tauri/src/fsops.rs. */
export function configDir(env = process.env, platform = process.platform, home = os.homedir()) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (env.FEDIT_HOME) return env.FEDIT_HOME;
  if (platform === 'win32' && env.APPDATA) return p.join(env.APPDATA, 'fedit');
  if (env.XDG_CONFIG_HOME) return p.join(env.XDG_CONFIG_HOME, 'fedit');
  return p.join(home, '.config', 'fedit');
}

const PLATFORMS = { linux: 'linux', darwin: 'macos', win32: 'windows' };
const ARCHES = { x64: 'x64', arm64: 'arm64' };

/** Release asset for a platform, or null when no prebuilt binary is published for it. */
export function assetName(platform = process.platform, arch = process.arch) {
  if (!(platform in PLATFORMS) || !(arch in ARCHES)) return null;
  return `fedit-${PLATFORMS[platform]}-${ARCHES[arch]}${platform === 'win32' ? '.exe' : ''}`;
}

export function releaseUrl(version, platform = process.platform, arch = process.arch) {
  const asset = assetName(platform, arch);
  return asset ? `https://github.com/${REPO}/releases/download/v${version}/${asset}` : null;
}

/** Where the downloaded (or locally built) app binary for a version is kept. */
export function cachedBinary(version, env = process.env, platform = process.platform, arch = process.arch) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  // The file itself is always named `fedit`: the desktop identifies a window's
  // app by its executable name, and the launcher entry is matched against it.
  return p.join(configDir(env, platform), 'bin', `${version}-${platform}-${arch}`, platform === 'win32' ? 'fedit.exe' : 'fedit');
}

/** Split launcher arguments into flags and absolute paths. */
export function parseArgs(argv, cwd = process.cwd()) {
  const flags = new Set();
  const paths = [];
  let onlyPaths = false;
  for (const arg of argv) {
    if (onlyPaths) paths.push(path.resolve(cwd, arg));
    else if (arg === '--') onlyPaths = true;
    else if (arg.startsWith('-') && arg.length > 1) flags.add(arg);
    else paths.push(path.resolve(cwd, arg));
  }
  return { flags, paths };
}
