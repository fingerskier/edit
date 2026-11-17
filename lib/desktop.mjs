// Desktop integration: an application-menu launcher for each platform.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIME_TYPES = [
  'text/plain', 'text/markdown', 'text/x-log', 'text/csv', 'text/html', 'text/css', 'text/xml', 'text/javascript',
  'application/json', 'application/xml', 'application/x-yaml', 'application/toml', 'application/x-shellscript',
  'text/x-python', 'text/x-csrc', 'text/x-chdr', 'text/x-c++src', 'text/x-java', 'text/x-rust', 'text/x-go',
  'text/x-typescript', 'text/x-makefile', 'text/x-readme', 'application/x-zerosize',
];

/** The freedesktop entry text. Exec quoting follows the Desktop Entry spec. */
export function desktopEntry(binary) {
  const quoted = '"' + binary.replace(/(["`$\\])/g, '\\$1') + '"';
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Fedit',
    'GenericName=Text Editor',
    'Comment=Lightweight pluggable text editor',
    `Exec=${quoted} %F`,
    'Icon=fedit',
    'Terminal=false',
    'StartupNotify=true',
    'StartupWMClass=fedit',
    'Categories=Utility;TextEditor;Development;',
    'Keywords=text;editor;code;',
    `MimeType=${MIME_TYPES.join(';')};`,
    '',
  ].join('\n');
}

export function infoPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Fedit</string>
  <key>CFBundleDisplayName</key><string>Fedit</string>
  <key>CFBundleIdentifier</key><string>com.fingerskier.fedit</string>
  <key>CFBundleExecutable</key><string>fedit</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Text Document</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array><string>public.text</string><string>public.data</string></array>
    </dict>
  </array>
</dict>
</plist>
`;
}

/** Paths the launcher occupies, so install and uninstall agree. */
export function launcherPaths(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'linux') {
    const data = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return {
      entry: path.join(data, 'applications', 'fedit.desktop'),
      icons: [
        path.join(data, 'icons', 'hicolor', '256x256', 'apps', 'fedit.png'),
        path.join(data, 'icons', 'hicolor', 'scalable', 'apps', 'fedit.svg'),
      ],
    };
  }
  if (platform === 'darwin') return { entry: path.join(home, 'Applications', 'Fedit.app'), icons: [] };
  if (platform === 'win32') {
    const appdata = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return { entry: path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Fedit.lnk'), icons: [] };
  }
  return null;
}

/** Create or refresh the application launcher. Returns its path, or null if unsupported. */
export function installLauncher({ binary, version, pkgRoot, platform = process.platform, env = process.env, home = os.homedir() }) {
  const paths = launcherPaths(platform, env, home);
  if (!paths) return null;
  if (platform === 'linux') {
    fs.mkdirSync(path.dirname(paths.entry), { recursive: true });
    fs.writeFileSync(paths.entry, desktopEntry(binary));
    const sources = [path.join(pkgRoot, 'assets', 'icon-256.png'), path.join(pkgRoot, 'assets', 'icon.svg')];
    paths.icons.forEach((dest, i) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(sources[i], dest);
    });
    try {
      execFileSync('update-desktop-database', [path.dirname(paths.entry)], { stdio: 'ignore' });
    } catch {
      // Optional: menus pick the entry up without it.
    }
  } else if (platform === 'darwin') {
    const contents = path.join(paths.entry, 'Contents');
    fs.rmSync(paths.entry, { recursive: true, force: true });
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
    fs.copyFileSync(binary, path.join(contents, 'MacOS', 'fedit'));
    fs.chmodSync(path.join(contents, 'MacOS', 'fedit'), 0o755);
    fs.copyFileSync(path.join(pkgRoot, 'src-tauri', 'icons', 'icon.icns'), path.join(contents, 'Resources', 'icon.icns'));
    fs.writeFileSync(path.join(contents, 'Info.plist'), infoPlist(version));
  } else if (platform === 'win32') {
    fs.mkdirSync(path.dirname(paths.entry), { recursive: true });
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    const script =
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(paths.entry)}); ` +
      `$s.TargetPath = ${q(binary)}; $s.Description = 'Fedit text editor'; $s.Save()`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
  }
  return paths.entry;
}

export function removeLauncher(platform = process.platform, env = process.env, home = os.homedir()) {
  const paths = launcherPaths(platform, env, home);
  if (!paths) return [];
  const removed = [];
  for (const p of [paths.entry, ...paths.icons]) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      removed.push(p);
    }
  }
  return removed;
}
