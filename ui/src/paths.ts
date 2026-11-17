// Path helpers that work on both `/` and `\` paths without touching the disk.

export function sepOf(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i < 0 ? trimmed : trimmed.slice(i + 1);
}

export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (i < 0) return '';
  if (i === 0) return trimmed[0];
  // Keep the separator of a Windows drive root: `C:\`.
  if (i === 2 && trimmed[1] === ':') return trimmed.slice(0, 3);
  return trimmed.slice(0, i);
}

export function join(dir: string, name: string): string {
  if (!dir) return name;
  const sep = sepOf(dir);
  return dir.replace(/[\\/]+$/, '') + sep + name.replace(/^[\\/]+/, '');
}

/** True when `path` is `dir` itself or lies inside it. */
export function isWithin(path: string, dir: string): boolean {
  const d = dir.replace(/[\\/]+$/, '');
  return path === d || path.startsWith(d + '/') || path.startsWith(d + '\\');
}

/** `path` relative to `dir`, or `path` unchanged when it is not inside `dir`. */
export function relative(path: string, dir: string): string {
  const d = dir.replace(/[\\/]+$/, '');
  return isWithin(path, d) && path !== d ? path.slice(d.length + 1) : path;
}

/** Replace a leading home directory with `~` for display. */
export function tildify(path: string, home: string): string {
  return home && isWithin(path, home) && path !== home ? '~' + path.slice(home.length) : path;
}
