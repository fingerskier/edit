import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from './plugin-host.js';

export interface ResolveOptions {
  /** npm package names or absolute module paths, in load order. */
  specifiers: string[];
  /** Directory scanned for loose .mjs/.js plugin files. */
  localDir: string;
}

function asPlugin(mod: any, source: string): Plugin {
  const plugin = mod?.default;
  if (!plugin || typeof plugin.activate !== 'function' || typeof plugin.name !== 'string') {
    throw new Error(`${source}: missing default-exported plugin`);
  }
  return plugin as Plugin;
}

export async function resolvePlugins(options: ResolveOptions): Promise<Plugin[]> {
  const plugins: Plugin[] = [];

  for (const spec of options.specifiers) {
    const mod = await import(spec);
    plugins.push(asPlugin(mod, spec));
  }

  let files: string[] = [];
  try {
    files = (await readdir(options.localDir))
      .filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))
      .sort((a, b) => a.localeCompare(b));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  for (const file of files) {
    const full = resolve(join(options.localDir, file));
    const mod = await import(pathToFileURL(full).href);
    plugins.push(asPlugin(mod, file));
  }

  return plugins;
}
