import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { Widget } from '../core/view.js';
import type { FocusService } from './keymap.js';
import { fuzzyRank } from '../core/fuzzy.js';

// A reusable fuzzy picker exposed as the `quickInput` service. It owns the
// `overlay` slot, a `quickInput` focus context, and the type/move/accept/cancel
// commands — so any plugin (command palette, fuzzy file-open, …) gets a picker
// by calling `ctx.services.get('quickInput').pick(items)` instead of re-building
// the overlay + filter + focus machinery. Mirrors VS Code's window.showQuickPick.

const FOCUS_CONTEXT = 'quickInput';

export interface QuickPickItem {
  label: string;
  description?: string;
  value?: unknown;
}

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
}

export interface QuickInputService {
  /** Open a fuzzy picker over `items`; resolves with the chosen item, or `undefined` if cancelled. */
  pick<T extends QuickPickItem>(items: T[], opts?: QuickPickOptions): Promise<T | undefined>;
}

interface Session {
  title?: string;
  items: QuickPickItem[];
  filter: string;
  selected: number;
  resolve: (value: QuickPickItem | undefined) => void;
}

const quickInput: Plugin = {
  name: 'quick-input',

  activate(ctx: PluginContext): void {
    let session: Session | null = null;

    // Resolve the focus service lazily (keymap registers it first, contract §F).
    const focus = (): FocusService => ctx.services.get<FocusService>('focus');

    const visible = (s: Session): QuickPickItem[] => fuzzyRank(s.filter, s.items, (i) => i.label);

    const clamp = (s: Session): void => {
      const len = visible(s).length;
      s.selected = len === 0 ? 0 : Math.max(0, Math.min(len - 1, s.selected));
    };

    // --- overlay view (slot 'overlay') ---
    ctx.subscriptions.push(
      ctx.view.contribute('overlay', (): Widget | null => {
        if (!session) return null;
        const items = visible(session).map((i) => ({ label: i.label }));
        return {
          kind: 'overlay',
          title: session.title ?? 'Quick Input',
          body: { kind: 'list', items, selected: session.selected },
        };
      }),
    );

    // --- the service ---
    const service: QuickInputService = {
      pick(items, opts) {
        return new Promise((resolve) => {
          const wasOpen = session !== null;
          // Replacing an already-open picker: settle the previous promise as
          // cancelled but REUSE its focus frame (don't push the context twice).
          if (session) session.resolve(undefined);
          session = {
            title: opts?.title,
            items: items as QuickPickItem[],
            filter: '',
            selected: 0,
            resolve: resolve as (value: QuickPickItem | undefined) => void,
          };
          if (!wasOpen) focus().push(FOCUS_CONTEXT);
          ctx.view.invalidate();
        });
      },
    };
    ctx.subscriptions.push(ctx.services.register('quickInput', service));

    // Close the active picker, restore focus, then settle its promise. Idempotent
    // and focus-stack safe (only pops when the quickInput context is on top).
    const settle = (value: QuickPickItem | undefined): void => {
      if (!session) return;
      const { resolve } = session;
      session = null;
      const f = focus();
      if (f.top() === FOCUS_CONTEXT) f.pop(FOCUS_CONTEXT);
      ctx.view.invalidate();
      resolve(value);
    };

    // --- commands (internal: hidden from the command palette) ---
    const meta = (title: string) => ({ title, internal: true });
    ctx.subscriptions.push(
      ctx.commands.register('quickInput.accept', () => {
        if (!session) return;
        clamp(session);
        settle(visible(session)[session.selected]);
      }, meta('Quick Input: Accept')),

      ctx.commands.register('quickInput.cancel', () => { settle(undefined); }, meta('Quick Input: Cancel')),

      ctx.commands.register('quickInput.up', () => {
        if (!session) return;
        session.selected = Math.max(0, session.selected - 1);
        clamp(session);
        ctx.view.invalidate();
      }, meta('Quick Input: Previous')),

      ctx.commands.register('quickInput.down', () => {
        if (!session) return;
        const len = visible(session).length;
        session.selected = Math.min(Math.max(0, len - 1), session.selected + 1);
        ctx.view.invalidate();
      }, meta('Quick Input: Next')),

      ctx.commands.register('quickInput.filterChar', (args: { key?: string }) => {
        if (!session) return;
        const key = args?.key ?? '';
        if (key === '') return;
        session.filter += key;
        session.selected = 0;
        ctx.view.invalidate();
      }, meta('Quick Input: Filter')),

      ctx.commands.register('quickInput.backspace', () => {
        if (!session || session.filter.length === 0) return;
        session.filter = session.filter.slice(0, -1);
        session.selected = 0;
        ctx.view.invalidate();
      }, meta('Quick Input: Delete Filter Char')),
    );

    // --- keybindings (active only while the quickInput context owns input) ---
    ctx.subscriptions.push(
      ctx.keys.bind('quickInput:enter', 'quickInput.accept'),
      ctx.keys.bind('quickInput:escape', 'quickInput.cancel'),
      ctx.keys.bind('quickInput:up', 'quickInput.up'),
      ctx.keys.bind('quickInput:down', 'quickInput.down'),
      ctx.keys.bind('quickInput:<printable>', 'quickInput.filterChar'),
      ctx.keys.bind('quickInput:backspace', 'quickInput.backspace'),
    );
  },
};

export default quickInput;
