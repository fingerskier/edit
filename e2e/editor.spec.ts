import { expect, test } from '@playwright/test';
import { FILES, editorText, mock, openFromTree, ready, runCommand, start, tab, treeRow } from './helpers';

test('opens a folder, shows the tree, and highlights an opened file', async ({ page }) => {
  await start(page);
  await expect(page.locator('#sidebar-title')).toHaveText('demo');
  await expect(page.locator('#tree .tree-row .tree-name')).toHaveText(['data', 'src', 'README.md']);

  await openFromTree(page, 'src', 'util.js');
  expect(await editorText(page)).toBe(FILES['/work/demo/src/util.js']);
  await expect(page.locator('#status-right')).toContainText('JavaScript');
  await expect(page.locator('#status-right')).toContainText('Spaces: 2');
  // Syntax highlighting: the keyword and the string get different styled spans.
  const colors = await page.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLElement>('.cm-content .cm-line span')];
    const color = (text: string) => getComputedStyle(spans.find((s) => s.textContent === text)!).color;
    return [color('export'), color('greet')];
  });
  expect(colors[0]).not.toBe(colors[1]);
  await expect(page).toHaveTitle('util.js — demo — Fedit');
});

test('highlights common formats by file name', async ({ page }) => {
  const samples: Record<string, [string, string]> = {
    'a.ts': ['const x: number = 1;\n', 'TypeScript'],
    'a.py': ['def f():\n    return 1\n', 'Python'],
    'a.rs': ['fn main() {}\n', 'Rust'],
    'a.go': ['package main\n', 'Go'],
    'a.json': ['{"a": 1}\n', 'JSON'],
    'a.md': ['# Title\n', 'Markdown'],
    'a.html': ['<p>hi</p>\n', 'HTML'],
    'a.css': ['a { color: red; }\n', 'CSS'],
    'a.yaml': ['a: 1\n', 'YAML'],
    'a.toml': ['a = 1\n', 'TOML'],
    'a.sh': ['# note\necho "hi"\n', 'Shell'],
    'a.sql': ['SELECT 1;\n', 'SQL'],
    'a.c': ['int main() { return 0; }\n', 'C'],
    'a.java': ['class A {}\n', 'Java'],
    'a.xml': ['<a/>\n', 'XML'],
    'Dockerfile': ['FROM alpine\n', 'Dockerfile'],
    'notes.txt': ['plain\n', 'Plain Text'],
  };
  const files = Object.fromEntries(Object.entries(samples).map(([name, [body]]) => [`/w/${name}`, body]));
  await start(page, { files, paths: ['/w'] });
  for (const [name, [, language]] of Object.entries(samples)) {
    await treeRow(page, name.replace('.', '\\.')).click();
    await expect(tab(page, name)).toHaveClass(/active/);
    await expect(page.locator('#status-right'), name).toContainText(language);
    if (language !== 'Plain Text') {
      // The grammar loaded and produced at least one highlighted token.
      await expect(page.locator('.cm-content .cm-line span[class]').first(), name).toBeVisible();
    }
  }
});

test('edits, marks the tab dirty, and saves with Ctrl+S', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('new line');
  await expect(tab(page, 'README.md')).toHaveClass(/dirty/);
  await expect(page).toHaveTitle(/^● README\.md/);
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe(FILES['/work/demo/README.md']);

  await page.keyboard.press('Control+S');
  await expect(tab(page, 'README.md')).not.toHaveClass(/dirty/);
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe(FILES['/work/demo/README.md'] + 'new line');

  await page.keyboard.press('Control+Z');
  await expect(tab(page, 'README.md')).toHaveClass(/dirty/);
  await page.keyboard.press('Control+Y');
  await expect(tab(page, 'README.md')).not.toHaveClass(/dirty/);
});

test('preserves CRLF line endings on save', async ({ page }) => {
  await start(page, { files: { '/w/win.txt': 'one\r\ntwo\r\n' }, paths: ['/w/win.txt'] });
  await expect(page.locator('#status-right')).toContainText('CRLF');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('three');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'win.txt')).not.toHaveClass(/dirty/);
  expect(await mock(page, (m) => m.read('/w/win.txt'))).toBe('one\r\ntwo\r\nthree\r\n');
});

test('VS Code editing shortcuts act on the document', async ({ page }) => {
  await start(page, { files: { '/w/a.js': 'one\ntwo\nthree\n' }, paths: ['/w/a.js'] });
  // Comment toggling needs the grammar, which loads on demand.
  await page.waitForFunction(() => (window as any).fedit.workbench.view.state.languageDataAt('commentTokens', 0).length > 0);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+/');
  expect(await editorText(page)).toBe('// one\ntwo\nthree\n');
  await page.keyboard.press('Control+/');
  await page.keyboard.press('Alt+ArrowDown');
  expect(await editorText(page)).toBe('two\none\nthree\n');
  await page.keyboard.press('Shift+Alt+ArrowDown');
  expect(await editorText(page)).toBe('two\none\none\nthree\n');
  await page.keyboard.press('Control+Shift+K');
  expect(await editorText(page)).toBe('two\none\nthree\n');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('x');
  // Deleting a line leaves the cursor on the line that followed it.
  expect(await editorText(page)).toBe('two\none\nthree\nx\n');
  await page.keyboard.press('Control+Shift+Enter');
  await page.keyboard.type('y');
  expect(await editorText(page)).toBe('two\none\nthree\ny\nx\n');
  await page.keyboard.press('Tab');
  expect(await editorText(page)).toBe('two\none\nthree\ny   \nx\n'); // pads to the next tab stop

  // Ctrl+D adds the next occurrence; typing replaces both.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('ab ab ab');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.keyboard.press('Control+D');
  await expect(page.locator('#status-right')).toContainText('2 selections');
  await page.keyboard.type('z');
  expect(await editorText(page)).toBe('z z ab');
  await page.keyboard.press('Escape');
  await expect(page.locator('#status-right')).toContainText('Ln 1');
});

test('find, replace and go to line', async ({ page }) => {
  await start(page, { files: { '/w/a.txt': 'cat\ndog\ncat\nbird\n' }, paths: ['/w/a.txt'] });
  await page.keyboard.press('Control+H');
  await expect(page.locator('.cm-search')).toBeVisible();
  await page.locator('.cm-search input[name=search]').fill('cat');
  await page.locator('.cm-search input[name=replace]').fill('cow');
  await page.locator('.cm-search button[name=replaceAll]').click();
  expect(await editorText(page)).toBe('cow\ndog\ncow\nbird\n');
  await page.locator('.cm-search input[name=search]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-search')).toHaveCount(0);

  await page.keyboard.press('Control+G');
  await expect(page.locator('#palette-input')).toHaveValue(':');
  await page.keyboard.type('4');
  await expect(page.locator('#palette-list')).toContainText('Go to line 4');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status-right')).toContainText('Ln 4, Col 1');
});

test('non-text and oversized files open in the system default app', async ({ page }) => {
  await start(page);
  await treeRow(page, 'data').click();
  await treeRow(page, 'logo\\.png').click();
  await expect(page.locator('.toast')).toContainText('not a text file');
  await treeRow(page, 'huge\\.log').click();
  await expect(page.locator('.toast').last()).toContainText('too large');
  expect(await mock(page, (m) => m.opened)).toEqual(['/work/demo/data/logo.png', '/work/demo/data/huge.log']);
  await expect(page.locator('#tabs .tab')).toHaveCount(0);
});

test('closing a modified tab asks first', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.keyboard.type('x');
  await page.keyboard.press('Control+W');
  await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', 'Save changes to README.md?');
  await page.keyboard.press('Escape');
  await expect(tab(page, 'README.md')).toHaveCount(1);

  await page.keyboard.press('Control+W');
  await page.locator('#palette-list .pick', { hasText: "Don't Save" }).click();
  await expect(page.locator('#tabs .tab')).toHaveCount(0);
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe(FILES['/work/demo/README.md']);
  await expect(page.locator('#welcome')).toBeVisible();

  await page.keyboard.press('Control+Shift+T');
  await expect(tab(page, 'README.md')).toHaveClass(/active/);
});

test('quitting with unsaved changes asks, and Save All writes them', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.keyboard.type('x');
  await mock(page, (m) => m.emit('close-requested'));
  await expect(page.locator('#palette-list .pick')).toHaveText(['Save All and Quit', 'Quit Without Saving', 'Cancel']);
  await page.keyboard.press('Escape');
  expect(await mock(page, (m) => m.quit)).toBe(false);

  await page.keyboard.press('Control+Q');
  await page.keyboard.press('Enter');
  await expect.poll(() => mock(page, (m) => m.quit)).toBe(true);
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe('x' + FILES['/work/demo/README.md']);
});

test('a file changed by another program reloads when clean and is flagged when dirty', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await mock(page, (m) => m.externalWrite('/work/demo/README.md', 'changed outside\n'));
  await expect.poll(() => editorText(page)).toBe('changed outside\n');
  await expect(tab(page, 'README.md')).not.toHaveClass(/dirty/);

  await page.keyboard.type('mine ');
  await mock(page, (m) => m.externalWrite('/work/demo/README.md', 'changed again\n'));
  await expect(page.locator('#status-left')).toContainText('Changed on disk');
  expect(await editorText(page)).toBe('mine changed outside\n');
  await page.keyboard.press('Control+S');
  await page.locator('#palette-list .pick', { hasText: 'Overwrite' }).click();
  await expect.poll(() => mock(page, (m) => m.read('/work/demo/README.md'))).toBe('mine changed outside\n');
});

test('untitled files save through Save As', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Control+N');
  await expect(tab(page, 'Untitled-1')).toHaveClass(/active/);
  await page.keyboard.type('print(1)');
  await mock(page, (m) => m.picks.push('/work/demo/new.py'));
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'new.py')).toHaveClass(/active/);
  await expect(page.locator('#status-right')).toContainText('Python');
  expect(await mock(page, (m) => m.read('/work/demo/new.py'))).toBe('print(1)');
  await expect(treeRow(page, 'new\\.py')).toBeVisible();
});

test('a path that does not exist opens as a new file created on save', async ({ page }) => {
  await start(page, { files: FILES, paths: ['/work/demo/brand-new.md'] });
  await expect(tab(page, 'brand-new.md')).toHaveClass(/active/);
  await page.keyboard.type('# hi');
  await page.keyboard.press('Control+S');
  await expect.poll(() => mock(page, (m) => m.read('/work/demo/brand-new.md'))).toBe('# hi');
});

test('session and recent files survive a restart', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'src', 'util.js');
  await openFromTree(page, 'README.md');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#sidebar')).toBeHidden();
  await page.waitForFunction(() => (window as any).__mock.read('/config/state.json')?.includes('README.md'));
  const saved = JSON.parse((await mock(page, (m) => m.read('/config/state.json')))!);
  expect(saved.recentFiles).toEqual(['/work/demo/README.md', '/work/demo/src/util.js']);
  expect(saved.recentFolders).toEqual(['/work/demo']);
  await page.waitForFunction(() => JSON.parse((window as any).__mock.read('/config/state.json')).sidebar.visible === false);

  await page.reload();
  await ready(page);
  await expect(page.locator('#tabs .tab')).toHaveText(['util.js×', 'README.md×']);
  await expect(tab(page, 'README.md')).toHaveClass(/active/);
  await expect(page.locator('#sidebar')).toBeHidden();
  await page.keyboard.press('Control+B');
  await expect(treeRow(page, 'util\\.js')).toBeVisible(); // the expanded folder was remembered

  await page.keyboard.press('Control+K');
  await page.keyboard.press('Control+W');
  await expect(page.locator('#tabs .tab')).toHaveCount(0);
  await page.keyboard.press('Control+R');
  await expect(page.locator('#palette-list .pick .pick-label')).toHaveText(['~/demo', '~/demo/README.md', '~/demo/src/util.js']);
  await page.keyboard.type('util');
  await page.keyboard.press('Enter');
  await expect(tab(page, 'util.js')).toHaveClass(/active/);
});

test('settings.json applies live and survives bad input', async ({ page }) => {
  await start(page, { files: { ...FILES, '/config/settings.json': '{ "workbench.colorTheme": "dark", "editor.tabSize": 8, }' } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openFromTree(page, 'README.md');
  await expect(page.locator('#status-right')).toContainText('Spaces: 8');

  await mock(page, (m) => m.externalWrite('/config/settings.json', '{ "workbench.colorTheme": "light", "editor.wordWrap": "on", "editor.fontSize": 20, "files.exclude": ["data"] }'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.cm-content')).toHaveClass(/cm-lineWrapping/);
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '20px');
  await expect(treeRow(page, 'data')).toHaveCount(0);

  await mock(page, (m) => m.externalWrite('/config/settings.json', '{ broken'));
  await expect(page.locator('.toast.error')).toContainText('settings.json');
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '14px');

  await page.keyboard.press('Control+,');
  await expect(tab(page, 'settings.json')).toHaveClass(/active/);
});

test('zoom changes the editor font size and is remembered', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '16px');
  await page.keyboard.press('Control+-');
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '15px');
  await page.waitForFunction(() => JSON.parse((window as any).__mock.read('/config/state.json') ?? '{}').zoom === 1);
  await page.reload();
  await ready(page);
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '15px');
  await runCommand(page, 'View: Reset Zoom');
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '14px');
});
