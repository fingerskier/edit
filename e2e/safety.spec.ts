// Regression tests for ways unsaved work or on-disk content could be lost.
import { expect, test } from '@playwright/test';
import { FILES, editorText, mock, openFromTree, ready, runCommand, start, tab, treeRow } from './helpers';

const README = '/work/demo/README.md';

test('Reload Window asks before discarding unsaved changes', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.keyboard.type('x');
  await runCommand(page, 'Developer: Reload Window');
  await expect(page.locator('#palette-list .pick')).toHaveText(['Save All and Reload', 'Reload Without Saving', 'Cancel']);
  await page.keyboard.press('Escape');
  await expect(tab(page, 'README.md')).toHaveClass(/dirty/);
  expect(await editorText(page)).toBe('x' + FILES[README]);

  await runCommand(page, 'Developer: Reload Window');
  await page.locator('#palette-list .pick', { hasText: 'Save All and Reload' }).click();
  await page.waitForFunction(() => (window as any).fedit === undefined).catch(() => {});
  await ready(page);
  await expect(tab(page, 'README.md')).not.toHaveClass(/dirty/);
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe('x' + FILES[README]);
});

test('Save As onto a file open with unsaved changes asks, and keeps that tab if the write fails', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.keyboard.type('unsaved ');
  await page.keyboard.press('Control+N');
  await page.keyboard.type('other');

  await mock(page, (m) => m.picks.push('/work/demo/README.md'));
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /README\.md is open with unsaved changes/);
  await page.keyboard.press('Escape');
  await expect(tab(page, 'README.md')).toHaveClass(/dirty/);
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe(FILES[README]);

  // Confirmed, but the write fails: the replaced tab and its edits survive.
  await mock(page, (m) => { m.picks.push('/work/demo/README.md'); m.failWrites = true; });
  await page.keyboard.press('Control+Shift+S');
  await page.locator('#palette-list .pick', { hasText: 'Replace' }).click();
  await expect(page.locator('.toast.error')).toContainText('disk full');
  await expect(tab(page, 'README.md')).toHaveClass(/dirty/);
  await expect(tab(page, 'Untitled-1')).toHaveCount(1);

  // Confirmed and written: one tab for the file, holding the new content.
  await mock(page, (m) => { m.picks.push('/work/demo/README.md'); m.failWrites = false; });
  await page.keyboard.press('Control+Shift+S');
  await page.locator('#palette-list .pick', { hasText: 'Replace' }).click();
  await expect(page.locator('#tabs .tab')).toHaveCount(1);
  await expect(tab(page, 'README.md')).not.toHaveClass(/dirty/);
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe('other');
});

test('text typed while a save is in flight keeps the tab open and the app running', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.keyboard.type('a');
  await mock(page, (m) => { m.writeDelay = 400; });

  // Save-and-close: type during the write.
  await page.keyboard.press('Control+W');
  await page.locator('#palette-list .pick', { hasText: /^Save$/ }).click();
  await page.keyboard.type('b');
  await expect(page.locator('.toast.warn')).toContainText('changed while it was being saved');
  await expect(tab(page, 'README.md')).toHaveClass(/dirty/);
  expect(await editorText(page)).toContain('b');

  // Save-all-and-quit: type during the write.
  await page.keyboard.press('Control+Q');
  await page.locator('#palette-list .pick', { hasText: 'Save All and Quit' }).click();
  await page.keyboard.type('c');
  await expect(page.locator('.toast.warn').last()).toContainText('Quit cancelled');
  expect(await mock(page, (m) => m.quit)).toBe(false);
  await expect(tab(page, 'README.md')).toHaveClass(/dirty/);
});

test('typing while an external change is being read flags a conflict instead of overwriting', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  // Hold the reload's read open, type, then let it finish.
  await page.evaluate(() => {
    const backend = (window as any).fedit.backend;
    const read = backend.readFile;
    backend.readFile = async (p: string) => {
      const data = await read(p);
      await new Promise((r) => ((window as any).__releaseRead = r));
      return data;
    };
  });
  await mock(page, (m) => m.externalWrite('/work/demo/README.md', 'theirs\n'));
  await page.waitForFunction(() => typeof (window as any).__releaseRead === 'function');
  await page.keyboard.type('mine ');
  await page.evaluate(() => (window as any).__releaseRead());
  await expect(page.locator('#status-left')).toContainText('Changed on disk');
  await page.keyboard.press('Control+S');
  await expect(page.locator('#palette-list .pick')).toHaveText(['Overwrite', 'Cancel']);
  await page.keyboard.press('Escape');
  expect(await mock(page, (m) => m.read('/work/demo/README.md'))).toBe('theirs\n');
});

test('a save that lands during a reload is not replaced by the older content', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await page.evaluate(() => {
    const backend = (window as any).fedit.backend;
    const read = backend.readFile;
    backend.readFile = async (p: string) => {
      const data = await read(p);
      await new Promise((r) => ((window as any).__releaseRead = r));
      return data;
    };
  });
  await mock(page, (m) => m.externalWrite('/work/demo/README.md', 'older outside version\n'));
  await page.waitForFunction(() => typeof (window as any).__releaseRead === 'function');
  await page.keyboard.press('Control+S'); // the clean buffer is written back over the outside version
  await expect.poll(() => mock(page, (m) => m.read('/work/demo/README.md'))).toBe(FILES[README]);
  await page.evaluate(() => (window as any).__releaseRead());
  await page.evaluate(() => (window as any).fedit.workbench.handleFsChange([]));
  expect(await editorText(page)).toBe(FILES[README]);
  await expect(tab(page, 'README.md')).not.toHaveClass(/dirty/);
});

test('reloading a CRLF file with the cursor at the end does not throw, and bad UTF-8 turns read-only', async ({ page }) => {
  await start(page, { files: { '/w/a.txt': 'one two three four\n' }, paths: ['/w/a.txt'] });
  await page.keyboard.press('Control+End');
  await mock(page, (m) => m.externalWrite('/w/a.txt', 'a\r\nb\r\nc\r\n'));
  await expect.poll(() => editorText(page)).toBe('a\nb\nc\n');
  await expect(page.locator('#status-right')).toContainText('CRLF');
  await expect(tab(page, 'a.txt')).not.toHaveClass(/dirty/);

  await mock(page, (m) => m.externalWrite('/w/a.txt', 'lossy:caf�\n'));
  await expect(page.locator('#status-left')).toContainText('Read-only');
  await expect(page.locator('.toast.warn')).toContainText('no longer valid UTF-8');
  await page.keyboard.type('zzz');
  expect(await editorText(page)).toBe('caf�\n');
  await page.keyboard.press('Control+S');
  expect(await mock(page, (m) => m.read('/w/a.txt'))).toBe('lossy:caf�\n');
});

test('removed and emptied bindings really stop the key, and a malformed one is ignored', async ({ page }) => {
  const keybindings = `[
    { "key": "ctrl+f", "command": "-actions.find" },
    { "key": "ctrl+h", "command": "" },
    { "key": "ctrl+", "command": "workbench.action.files.save" }
  ]`;
  await start(page, { files: { ...FILES, '/config/keybindings.json': keybindings } });
  await openFromTree(page, 'README.md');
  await page.keyboard.press('Control+F');
  await page.keyboard.press('Control+H');
  await expect(page.locator('.cm-search')).toHaveCount(0);
  // The palette still opens and lists commands despite the malformed rule.
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('save');
  await expect(page.locator('#palette-list .pick').first()).toContainText('File: Save');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Find');
  await expect(page.locator('.cm-search')).toBeVisible();
});

test('a plugin that fails during activation leaves nothing registered', async ({ page }) => {
  const source = `export default { activate(ctx) {
    ctx.commands.register('half.done', () => {}, 'Half: Done');
    ctx.keybindings.add({ key: 'ctrl+alt+9', command: 'half.done' });
    ctx.statusBar.createItem({ text: 'HALF' });
    throw new Error('late failure');
  } };`;
  await start(page, { plugins: [{ name: 'half', path: '/config/plugins/half.js', source }] });
  await expect(page.locator('.toast.error')).toContainText('late failure');
  const left = await page.evaluate(() => {
    const app = (window as any).fedit;
    return [app.commands.has('half.done'), app.rules.some((r: any) => r.command === 'half.done'), document.getElementById('status')!.textContent!.includes('HALF')];
  });
  expect(left).toEqual([false, false, false]);
});

test('a slow refresh of the previous folder cannot clear the folder opened after it', async ({ page }) => {
  await start(page, { files: { ...FILES, '/other/x.txt': 'x' } });
  await page.evaluate(() => {
    const app = (window as any).fedit;
    const readDir = app.backend.readDir;
    app.backend.readDir = async (p: string) => {
      if (p !== '/work/demo') return readDir(p);
      await new Promise((r) => ((window as any).__releaseDir = r));
      throw 'gone';
    };
    void app.explorer.refresh();
  });
  await page.waitForFunction(() => typeof (window as any).__releaseDir === 'function');
  await page.evaluate(() => (window as any).fedit.openPath('/other'));
  await expect(page.locator('#sidebar-title')).toHaveText('other');
  await page.evaluate(() => (window as any).__releaseDir());
  await page.waitForTimeout(200);
  await expect(page.locator('#sidebar-title')).toHaveText('other');
  await expect(treeRow(page, 'x\\.txt')).toBeVisible();
});
