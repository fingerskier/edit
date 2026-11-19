import { expect, type Page } from '@playwright/test';

export interface Seed {
  files?: Record<string, string>;
  dirs?: string[];
  paths?: string[];
  /** False to start like a second window, which does not restore the session. */
  restore?: boolean;
  plugins?: { name: string; path: string; source?: string; error?: string }[];
}

export const FILES = {
  '/work/demo/README.md': '# Demo\n\nSome *markdown* text.\n',
  '/work/demo/src/main.js': "import { greet } from './util.js';\n\nconsole.log(greet('world'));\n",
  '/work/demo/src/util.js': 'export function greet(name) {\n  return `hello, ${name}`;\n}\n',
  '/work/demo/src/app.py': 'def main():\n    print("hi")\n',
  '/work/demo/data/config.json': '{\n  "name": "demo"\n}\n',
  '/work/demo/data/logo.png': 'binary:PNG',
  '/work/demo/data/huge.log': 'large:',
};

/** Load the app with a seeded in-memory file system and wait until it has booted. */
export async function start(page: Page, seed: Seed = {}): Promise<void> {
  const full: Seed = { files: FILES, paths: ['/work/demo'], ...seed };
  await page.addInitScript((s) => {
    (window as any).__FEDIT_SEED__ = s;
  }, full);
  await page.goto('/');
  await ready(page);
}

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).fedit !== undefined);
}

export const mock = <T>(page: Page, fn: (m: any) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__mock)`) as Promise<T>;

/** A tree row by exact name; `name` is a regular expression source. */
export const treeRow = (page: Page, name: string) =>
  page.locator('#tree .tree-row').filter({ has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) });
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A tab by its exact title. */
export const tab = (page: Page, name: string) =>
  page.locator('#tabs .tab').filter({ has: page.locator('.tab-title', { hasText: new RegExp(`^${escapeRe(name)}$`) }) });
export const editorText = (page: Page) => page.evaluate(() => (window as any).fedit.workbench.view.state.doc.toString() as string);

export async function openFromTree(page: Page, ...segments: string[]): Promise<void> {
  for (const name of segments) await treeRow(page, name).click();
  await expect(tab(page, segments[segments.length - 1])).toHaveClass(/active/);
}

/** Run a command through the palette, the way a user would. */
export async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#palette-input').fill('>' + title);
  await expect(page.locator('#palette-list .pick').first()).toContainText(title);
  await page.keyboard.press('Enter');
}
