// Running npm and cargo the same way on every platform.

import { spawnSync } from 'node:child_process';

/**
 * Quote one argument for cmd.exe. npm on Windows is a `.cmd` shim and has to
 * go through the shell, which would otherwise split a path such as
 * `C:\Users\Jane Doe\…` at the space.
 */
export function quoteForCmd(arg) {
  if (arg !== '' && !/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export function runNpm(args, options = {}, platform = process.platform) {
  if (platform !== 'win32') return spawnSync('npm', args, options);
  return spawnSync(['npm.cmd', ...args].map(quoteForCmd).join(' '), { ...options, shell: true });
}

/** cargo is a real executable on every platform, so it needs no shell. */
export function runCargo(args, options = {}) {
  return spawnSync('cargo', args, options);
}
