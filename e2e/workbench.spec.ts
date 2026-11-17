import { expect, test } from '@playwright/test';
import { FILES, editorText, mock, openFromTree, runCommand, start, tab, treeRow } from './helpers';

test('command palette lists commands with their keys and runs them', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Control+Shift+P');
  await expect(page.locator('#palette-input')).toHaveValue('>');
  await page.keyboard.type('toggle side');
  const first = page.locator('#palette-list .pick').first();
  await expect(first).toContainText('View: Toggle Sidebar Visibility');
  await expect(first.locator('.key')).toHaveText('Ctrl+B');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#sidebar')).toBeHidden();

  await page.keyboard.press('F1');
  await expect(page.locator('#palette-input')).toHaveValue('>');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  await page.keyboard.press('Control+B');
  await expect(page.locator('#sidebar')).toBeVisible();
});

test('quick open finds files by fuzzy name and can jump to a line', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Control+P');
  await page.keyboard.type('utjs');
  await expect(page.locator('#palette-list .pick').first()).toContainText('util.js');
  await expect(page.locator('#palette-list .pick').first().locator('.pick-desc')).toHaveText('src');
  await page.keyboard.press('Enter');
  await expect(tab(page, 'util.js')).toHaveClass(/active/);
  // Opening a nested file reveals it in the tree.
  await expect(treeRow(page, 'util\\.js')).toHaveClass(/active-file/);

  await page.keyboard.press('Control+P');
  await page.keyboard.type('main:3');
  await page.keyboard.press('Enter');
  await expect(tab(page, 'main.js')).toHaveClass(/active/);
  await expect(page.locator('#status-right')).toContainText('Ln 3, Col 1');

  // With no query, quick open offers the other open and recent files.
  await page.keyboard.press('Control+P');
  await expect(page.locator('#palette-list .pick .pick-label')).toHaveText(['util.js']);
  await page.keyboard.press('Control+P');
  await expect(page.locator('#palette')).toBeHidden();
});

test('tabs switch with Ctrl+Tab, Ctrl+PageUp and Alt+number', async ({ page }) => {
  await start(page);
  await openFromTree(page, 'README.md');
  await openFromTree(page, 'src', 'main.js');
  await openFromTree(page, 'util.js');
  await page.keyboard.press('Control+Tab');
  await expect(tab(page, 'README.md')).toHaveClass(/active/);
  await page.keyboard.press('Control+PageUp');
  await expect(tab(page, 'util.js')).toHaveClass(/active/);
  await page.keyboard.press('Alt+2');
  await expect(tab(page, 'main.js')).toHaveClass(/active/);
  await tab(page, 'README.md').click({ button: 'middle' });
  await expect(tab(page, 'README.md')).toHaveCount(0);
  // Each tab keeps its own undo history.
  await page.keyboard.type('A');
  await page.keyboard.press('Alt+2');
  await page.keyboard.type('B');
  await page.keyboard.press('Control+Z');
  await expect(tab(page, 'util.js')).not.toHaveClass(/dirty/);
  await expect(tab(page, 'main.js')).toHaveClass(/dirty/);
});

test('user keybindings override, remove, and add chords', async ({ page }) => {
  const keybindings = `// my keys
  [
    { "key": "ctrl+shift+d", "command": "editor.action.copyLinesDownAction", "when": "editorTextFocus" },
    { "key": "ctrl+b", "command": "-workbench.action.toggleSidebarVisibility" },
    { "key": "ctrl+m ctrl+b", "command": "workbench.action.toggleSidebarVisibility" },
    { "key": "ctrl+s", "command": "workbench.action.files.saveAll", "when": "neverTrue" },
  ]`;
  await start(page, { files: { ...FILES, '/config/keybindings.json': keybindings } });
  await openFromTree(page, 'README.md');
  await page.keyboard.press('Control+Shift+D');
  expect(await editorText(page)).toBe('# Demo\n# Demo\n\nSome *markdown* text.\n');

  await page.keyboard.press('Control+B');
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.keyboard.press('Control+M');
  await expect(page.locator('#status-left')).toContainText('Waiting for second key');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#status-left')).not.toContainText('Waiting');

  // A user rule whose `when` is false leaves the default in charge.
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'README.md')).not.toHaveClass(/dirty/);

  // An unknown second key cancels the chord without typing into the document.
  await page.keyboard.press('Control+K');
  await page.keyboard.press('q');
  await expect(page.locator('#status-left')).toContainText('is not a command');
  expect(await editorText(page)).toBe('# Demo\n# Demo\n\nSome *markdown* text.\n');

  // Edits to keybindings.json apply without a restart.
  await mock(page, (m) => m.externalWrite('/config/keybindings.json', '[{ "key": "ctrl+b", "command": "workbench.action.files.newUntitledFile" }]'));
  await expect.poll(async () => {
    await page.keyboard.press('Control+B');
    return page.locator('#tabs .tab', { hasText: 'Untitled' }).count();
  }).toBeGreaterThan(0);

  await runCommand(page, 'Preferences: Open Default Keyboard Shortcuts');
  await expect(tab(page, 'Default Keybindings.json')).toHaveClass(/active/);
  expect(await editorText(page)).toContain('{"key":"ctrl+k ctrl+o","command":"workbench.action.files.openFolder"}');
});

test('explorer: keyboard navigation, create, rename, delete', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Control+Shift+E');
  await expect(treeRow(page, 'data')).toHaveClass(/selected/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(treeRow(page, 'main\\.js')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(treeRow(page, 'main\\.js')).toHaveClass(/selected/);
  await page.keyboard.press('Enter');
  await expect(tab(page, 'main.js')).toHaveClass(/active/);

  // New file lands next to the selected file and opens.
  await runCommand(page, 'Explorer: New File');
  await page.locator('#tree input').fill('extra.ts');
  await page.keyboard.press('Enter');
  await expect(tab(page, 'extra.ts')).toHaveClass(/active/);
  expect(await mock(page, (m) => m.read('/work/demo/src/extra.ts'))).toBe('');

  // Rename keeps the open tab attached to the file.
  await treeRow(page, 'extra\\.ts').click();
  await page.keyboard.press('Control+Shift+E');
  await page.keyboard.press('F2');
  await page.locator('#tree input').fill('renamed.py');
  await page.keyboard.press('Enter');
  await expect(tab(page, 'renamed.py')).toHaveClass(/active/);
  await expect(page.locator('#status-right')).toContainText('Python');
  await page.locator('.cm-content').click();
  await page.keyboard.type('x = 1');
  await page.keyboard.press('Control+S');
  expect(await mock(page, (m) => [m.read('/work/demo/src/renamed.py'), m.read('/work/demo/src/extra.ts')])).toEqual(['x = 1', undefined]);

  // Renaming onto an existing name is refused.
  await treeRow(page, 'renamed\\.py').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Rename' }).click();
  await page.locator('#tree input').fill('util.js');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast.error')).toContainText('already exists');

  // Delete goes to the trash after a confirmation and closes the tab.
  await treeRow(page, 'renamed\\.py').click();
  await page.keyboard.press('Control+Shift+E');
  await page.keyboard.press('Delete');
  await page.locator('#palette-list .pick', { hasText: 'Move to Trash' }).click();
  await expect(treeRow(page, 'renamed\\.py')).toHaveCount(0);
  await expect(tab(page, 'renamed.py')).toHaveCount(0);
  expect(await mock(page, (m) => m.trashed)).toEqual(['/work/demo/src/renamed.py']);

  // New folder at the root via the empty-area context menu.
  await page.locator('#tree').click({ button: 'right', position: { x: 30, y: 400 } });
  await page.locator('.menu-item', { hasText: 'New Folder' }).click();
  await page.locator('#tree input').fill('docs');
  await page.keyboard.press('Enter');
  await expect(treeRow(page, 'docs')).toBeVisible();

  // Context menu actions reach the host.
  await treeRow(page, 'README\\.md').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Reveal in File Manager' }).click();
  await treeRow(page, 'README\\.md').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Open with Default App' }).click();
  expect(await mock(page, (m) => [m.revealed, m.opened])).toEqual([['/work/demo/README.md'], ['/work/demo/README.md']]);
});

test('the tree follows changes made outside the editor', async ({ page }) => {
  await start(page);
  await mock(page, (m) => m.externalWrite('/work/demo/added.txt', 'x'));
  await expect(treeRow(page, 'added\\.txt')).toBeVisible();
  // The watcher is told about the folder, the open files' folders and the config folder.
  await treeRow(page, 'src').click();
  await expect.poll(() => mock(page, (m) => [...m.watched].sort())).toEqual(['/config', '/work/demo', '/work/demo/src']);
});

test('opening and closing folders, and files passed while running', async ({ page }) => {
  await start(page, { files: { ...FILES, '/other/x.txt': 'x' }, paths: [] });
  await expect(page.locator('#sidebar-title')).toHaveText('No Folder Opened');
  await mock(page, (m) => m.picks.push('/work/demo'));
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Control+O');
  await expect(page.locator('#sidebar-title')).toHaveText('demo');

  // A second `fedit <file>` hands its path to the running window.
  await mock(page, (m) => m.emit('open-paths', ['/other/x.txt']));
  await expect(tab(page, 'x.txt')).toHaveClass(/active/);
  // Dropping a folder on the window opens it.
  await mock(page, (m) => m.emit('drop', ['/other']));
  await expect(page.locator('#sidebar-title')).toHaveText('other');

  await runCommand(page, 'File: Close Folder');
  await expect(page.locator('#sidebar-title')).toHaveText('No Folder Opened');
  await page.locator('#tree a', { hasText: '~/demo' }).click();
  await expect(page.locator('#sidebar-title')).toHaveText('demo');
});

test('plugins register commands, keys, status items and editor extensions', async ({ page }) => {
  const source = `
    export default {
      name: 'shout',
      activate(ctx) {
        const item = ctx.statusBar.createItem({ align: 'right', priority: 10 });
        const count = () => { item.text = ctx.editor.getText().split(/\\s+/).filter(Boolean).length + ' words'; };
        ctx.events.on('editor:activated', count);
        ctx.editor.addExtension(ctx.codemirror.view.EditorView.updateListener.of((u) => { if (u.docChanged) count(); }));
        ctx.commands.register('shout.upper', () => ctx.editor.replaceSelection(ctx.editor.getSelection().toUpperCase()), 'Shout: Uppercase Selection');
        ctx.keybindings.add({ key: 'ctrl+alt+u', command: 'shout.upper', when: 'editorTextFocus' });
        if (ctx.config.get('shout.greet', false)) ctx.ui.notify('shout ready');
      },
    };`;
  await start(page, {
    files: { ...FILES, '/config/settings.json': '{ "shout.greet": true, "plugins.disable": ["off"] }' },
    plugins: [
      { name: 'shout', path: '/config/plugins/shout.js', source },
      { name: 'off', path: '/config/plugins/off.js', source: 'export default { activate() { throw new Error("should be disabled"); } }' },
      { name: 'broken', path: '/config/plugins/broken.js', source: 'export default { activate() { throw new Error("boom"); } }' },
      { name: 'missing', path: '/config/plugins/node_modules/missing', error: 'package.json: not found' },
    ],
  });
  await expect(page.locator('.toast', { hasText: 'shout ready' })).toBeVisible();
  await expect(page.locator('.toast.error', { hasText: 'Plugin "broken" failed to load: boom' })).toBeVisible();
  await expect(page.locator('.toast.error', { hasText: 'Plugin "missing" failed to load' })).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'should be disabled' })).toHaveCount(0);

  await openFromTree(page, 'README.md');
  await expect(page.locator('#status-right')).toContainText('5 words');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+Alt+U');
  expect(await editorText(page)).toBe('# DEMO\n\nSOME *MARKDOWN* TEXT.\n');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('more words');
  await expect(page.locator('#status-right')).toContainText('7 words');

  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('shout');
  const row = page.locator('#palette-list .pick').first();
  await expect(row).toContainText('Shout: Uppercase Selection');
  await expect(row.locator('.key')).toHaveText('Ctrl+Alt+U');
});

test('editor context menu cuts, copies and pastes through the system clipboard', async ({ page }) => {
  await start(page, { files: { '/w/a.txt': 'alpha beta\n' }, paths: ['/w/a.txt'] });
  expect(await mock(page, (m) => m.ready)).toBe(true);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+ArrowRight');
  // Right-click on the selection itself; elsewhere it would move the cursor first.
  await page.locator('.cm-line').first().click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(page.locator('.menu-item')).toHaveText(['Cut', 'Copy', 'Paste', 'Select All', 'Command Palette…']);
  await page.locator('.menu-item', { hasText: 'Cut' }).click();
  await expect.poll(() => editorText(page)).toBe(' beta\n');
  expect(await mock(page, (m) => m.clipboard)).toBe('alpha');

  await page.keyboard.press('Control+End');
  await page.locator('.cm-content').click({ button: 'right', position: { x: 200, y: 100 } });
  await page.locator('.menu-item', { hasText: 'Paste' }).click();
  await expect.poll(() => editorText(page)).toBe(' beta\nalpha');

  // Copy Path from the palette uses the same clipboard.
  await runCommand(page, 'File: Copy Path');
  await expect.poll(() => mock(page, (m) => m.clipboard)).toBe('/w/a.txt');
  // The menu closes on Escape without acting.
  await page.locator('.cm-content').click({ button: 'right', position: { x: 200, y: 100 } });
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);
});
