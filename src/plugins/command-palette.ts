// src/plugins/command-palette.ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { Widget } from '../core/view.js';
import type { FocusService } from './keymap.js';

const FOCUS_CONTEXT = 'palette';

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

interface PaletteItem { id: string; label: string }

const plugin: Plugin = {
  name: 'command-palette',
  activate(ctx: PluginContext) {
    const state = { open: false, filter: '', selected: 0 };

    // Resolve the focus service lazily inside handlers (keymap loads first, §F),
    // never at activate time, to avoid activation-order coupling.
    const focus = (): FocusService => ctx.services.get<FocusService>('focus');

    // Candidate commands, excluding the palette's own commands so the user can't
    // recursively open/close the palette from within it.
    const candidates = (): PaletteItem[] =>
      ctx.commands
        .list()
        .filter((c) => !c.id.startsWith('palette.'))
        .map((c) => ({ id: c.id, label: c.title || humanizeId(c.id) }));

    const filtered = (): PaletteItem[] => {
      const needle = state.filter.toLowerCase();
      if (needle === '') return candidates();
      return candidates().filter((c) => c.label.toLowerCase().includes(needle));
    };

    const clampSelected = () => {
      const len = filtered().length;
      if (len === 0) { state.selected = 0; return; }
      state.selected = Math.max(0, Math.min(len - 1, state.selected));
    };

    // --- view provider (slot 'overlay') -----------------------------------
    ctx.subscriptions.push(
      ctx.view.contribute('overlay', (): Widget | null => {
        if (!state.open) return null;
        const items = filtered().map((c) => ({ label: c.label }));
        return {
          kind: 'overlay',
          title: 'Commands',
          body: { kind: 'list', items, selected: state.selected },
        };
      }),
    );

    // --- commands ---------------------------------------------------------
    ctx.subscriptions.push(
      ctx.commands.register('palette.open', () => {
        // Reset the query/selection every time. Only push the focus context when
        // we are actually transitioning from closed -> open, so repeated ctrl+p
        // never stacks 'palette' on the focus stack (which would wedge close).
        const wasOpen = state.open;
        state.open = true;
        state.filter = '';
        state.selected = 0;
        if (!wasOpen) focus().push(FOCUS_CONTEXT);
        ctx.view.invalidate();
      }, { title: 'Command Palette' }),
    );

    // Idempotent close: never wedges the focus stack. Only pop when the palette
    // context is actually on top.
    const close = () => {
      const wasOpen = state.open;
      state.open = false;
      if (wasOpen) {
        const f = focus();
        if (f.top() === FOCUS_CONTEXT) f.pop(FOCUS_CONTEXT);
        ctx.view.invalidate();
      }
    };

    ctx.subscriptions.push(
      ctx.commands.register('palette.close', () => { close(); }, { title: 'Palette: Close' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.accept', async () => {
        if (!state.open) return;
        clampSelected();
        const chosen = filtered()[state.selected];
        close();
        if (chosen) {
          await ctx.commands.run(chosen.id, {});
        }
      }, { title: 'Palette: Run Selected' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.up', () => {
        if (!state.open) return;
        state.selected = Math.max(0, state.selected - 1);
        clampSelected();
        ctx.view.invalidate();
      }, { title: 'Palette: Previous' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.down', () => {
        if (!state.open) return;
        const len = filtered().length;
        state.selected = Math.min(Math.max(0, len - 1), state.selected + 1);
        clampSelected();
        ctx.view.invalidate();
      }, { title: 'Palette: Next' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.filterChar', (args: { key?: string }) => {
        if (!state.open) return;
        const key = args?.key ?? '';
        if (key === '') return;
        state.filter += key;
        state.selected = 0;
        ctx.view.invalidate();
      }, { title: 'Palette: Filter' }),
    );

    ctx.subscriptions.push(
      ctx.commands.register('palette.backspace', () => {
        if (!state.open) return;
        if (state.filter.length > 0) {
          state.filter = state.filter.slice(0, -1);
          state.selected = 0;
          ctx.view.invalidate();
        }
      }, { title: 'Palette: Delete Filter Char' }),
    );

    // --- keybindings ------------------------------------------------------
    ctx.subscriptions.push(ctx.keys.bind('global:ctrl+p', 'palette.open'));
    ctx.subscriptions.push(ctx.keys.bind('palette:escape', 'palette.close'));
    ctx.subscriptions.push(ctx.keys.bind('palette:enter', 'palette.accept'));
    ctx.subscriptions.push(ctx.keys.bind('palette:up', 'palette.up'));
    ctx.subscriptions.push(ctx.keys.bind('palette:down', 'palette.down'));
    ctx.subscriptions.push(ctx.keys.bind('palette:<printable>', 'palette.filterChar'));
    ctx.subscriptions.push(ctx.keys.bind('palette:backspace', 'palette.backspace'));
  },
};

export default plugin;
