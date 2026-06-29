// src/plugins/command-palette.ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { QuickInputService, QuickPickItem } from './quick-input.js';

/**
 * Turn a dotted command id into a human label.
 *   humanizeId('editor.insertChar') === 'Editor: Insert Char'
 * Each dot-separated segment is split on camelCase / Pascal boundaries and on
 * whitespace/underscore/hyphen, each word is Title-cased, words join with ' ',
 * then segments join with ': '.
 */
export function humanizeId(id: string): string {
  return id
    .split('.')
    .map((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[\s_-]+/)
        .filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    )
    .join(': ');
}

interface CommandPick extends QuickPickItem { value: string }

// The palette is now a thin consumer of the shared `quickInput` service: it
// gathers the registered commands and hands them to the picker, then runs the
// chosen one. All overlay/filter/focus mechanics live in quick-input.
const plugin: Plugin = {
  name: 'command-palette',
  activate(ctx: PluginContext) {
    ctx.subscriptions.push(
      ctx.commands.register('palette.open', async () => {
        const quickInput = ctx.services.get<QuickInputService>('quickInput');
        const items: CommandPick[] = ctx.commands
          .list()
          // Hide internal UI commands and the palette's own opener (no recursion).
          .filter((c) => !c.internal && c.id !== 'palette.open')
          .map((c) => ({ label: c.title || humanizeId(c.id), value: c.id }));
        const chosen = await quickInput.pick(items, { title: 'Commands' });
        if (chosen) await ctx.commands.run(chosen.value, {});
      }, { title: 'Command Palette' }),
      ctx.keys.bind('global:ctrl+p', 'palette.open'),
    );
  },
};

export default plugin;
