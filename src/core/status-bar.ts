import type { Disposable } from './disposable.js';

/**
 * A single, independently-owned cell in the status line. Many plugins may each
 * create items; all visible items are concatenated into the one `status` slot,
 * ordered by priority. Mutating `text`/`priority` or calling `show()`/`hide()`
 * re-renders the bar. Mirrors VS Code's `window.createStatusBarItem`.
 */
export interface StatusBarItem extends Disposable {
  /** Text shown for this item. An empty string hides the item from the rendered bar. */
  text: string;
  /** Higher priority sorts earlier (leftmost). Defaults to 0. */
  priority: number;
  show(): void;
  hide(): void;
}

/** The plugin-facing surface (exposed as `ctx.statusBar`). */
export interface StatusBarApi {
  createItem(opts?: { text?: string; priority?: number }): StatusBarItem;
}

interface InternalItem {
  text: string;
  priority: number;
  visible: boolean;
  seq: number;
}

/**
 * Aggregates status-bar items from any number of plugins into a single ordered
 * list of segments. The core registers one internal `status` view provider that
 * reads `segments()`; plugins never own the slot directly, so they compose
 * instead of clobbering one another.
 */
export class StatusBarRegistry implements StatusBarApi {
  private items = new Set<InternalItem>();
  private seq = 0;
  private listeners = new Set<() => void>();

  createItem(opts: { text?: string; priority?: number } = {}): StatusBarItem {
    const item: InternalItem = {
      text: opts.text ?? '',
      priority: opts.priority ?? 0,
      visible: true,
      seq: this.seq++,
    };
    this.items.add(item);
    const registry = this;
    const handle: StatusBarItem = {
      get text() { return item.text; },
      set text(v: string) { if (item.text !== v) { item.text = v; registry.emitChange(); } },
      get priority() { return item.priority; },
      set priority(v: number) { if (item.priority !== v) { item.priority = v; registry.emitChange(); } },
      show() { if (!item.visible) { item.visible = true; registry.emitChange(); } },
      hide() { if (item.visible) { item.visible = false; registry.emitChange(); } },
      dispose() { if (registry.items.delete(item)) registry.emitChange(); },
    };
    this.emitChange();
    return handle;
  }

  /** Visible, non-empty item texts ordered by priority (desc), then creation order. */
  segments(): string[] {
    return [...this.items]
      .filter((i) => i.visible && i.text.length > 0)
      .sort((a, b) => b.priority - a.priority || a.seq - b.seq)
      .map((i) => i.text);
  }

  /** Subscribe to any change (text/priority/visibility/add/remove). */
  onDidChange(fn: () => void): Disposable {
    this.listeners.add(fn);
    return { dispose: () => { this.listeners.delete(fn); } };
  }

  private emitChange(): void {
    for (const fn of [...this.listeners]) {
      try { fn(); } catch (err) { console.error('[StatusBar] change listener threw:', err); }
    }
  }
}
