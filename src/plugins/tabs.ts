// Editor tab strip: multi-document chrome over the existing DocumentSet.
// The workspace already holds many open documents with one active; this plugin
// contributes a `tabs` view slot and the switch/close commands that drive it.

import { basename } from 'node:path';
import type { Plugin, PluginContext } from '../core/plugin-host.js';
import type { Document } from '../core/document.js';
import type { ViewModel } from '../core/view.js';
import type { QuickInputService } from './quick-input.js';
import { confirmDiscardDirty } from './dirty-confirm.js';

function tabLabel(doc: Document): string {
  const name = doc.path === null ? 'Untitled' : basename(doc.path);
  return doc.dirty ? `● ${name}` : name;
}

const tabs: Plugin = {
  name: 'tabs',

  activate(ctx: PluginContext): void {
    const { commands, keys, view, events, workspace, subscriptions } = ctx;

    const contribute = view.contribute('tabs', (): ViewModel | null => {
      const docs = workspace.list();
      if (docs.length === 0) return null;
      const active = workspace.activeDocument;
      const activeIndex = active ? docs.findIndex((d) => d.id === active.id) : 0;
      return {
        kind: 'tabs',
        items: docs.map((d) => ({
          id: d.id,
          label: tabLabel(d),
          dirty: d.dirty,
        })),
        activeIndex: Math.max(0, activeIndex),
      };
    });

    const cycle = (delta: number): void => {
      const docs = workspace.list();
      if (docs.length <= 1) return;
      const active = workspace.activeDocument;
      if (!active) return;
      const i = docs.findIndex((d) => d.id === active.id);
      if (i < 0) return;
      const next = docs[(i + delta + docs.length) % docs.length];
      workspace.setActive(next.id);
      view.invalidate();
    };

    const closeActive = async (): Promise<void> => {
      const active = workspace.activeDocument;
      if (!active) return;
      if (active.dirty) {
        const qi = ctx.services.get<QuickInputService>('quickInput');
        const ok = await confirmDiscardDirty(qi.pick.bind(qi), [active], 'Close with unsaved changes?');
        if (!ok) return;
      }
      workspace.closeDocument(active.id);
      view.invalidate();
    };

    subscriptions.push(
      contribute,
      commands.register('tabs.next', () => cycle(1), { title: 'Tabs: Next' }),
      commands.register('tabs.prev', () => cycle(-1), { title: 'Tabs: Previous' }),
      commands.register('tabs.close', closeActive, { title: 'Tabs: Close' }),
      keys.bind('global:ctrl+pagedown', 'tabs.next'),
      keys.bind('global:ctrl+pageup', 'tabs.prev'),
      keys.bind('global:ctrl+w', 'tabs.close'),
      events.on('document:opened', () => view.invalidate()),
      events.on('document:activated', () => view.invalidate()),
      events.on('document:closed', () => view.invalidate()),
      events.on('document:changed', () => view.invalidate()),
      events.on('document:saved', () => view.invalidate()),
    );
  },
};

export default tabs;
