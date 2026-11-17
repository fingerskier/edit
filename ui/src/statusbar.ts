import type { Disposer } from './events.ts';

export interface StatusItemOptions {
  text?: string;
  tooltip?: string;
  /** Run when the item is clicked. */
  onClick?: () => void;
  align?: 'left' | 'right';
  /** Higher sits closer to the outer edge of its side. */
  priority?: number;
}

export interface StatusItem {
  text: string;
  tooltip: string;
  dispose: Disposer;
}

export class StatusBar {
  private left = document.getElementById('status-left')!;
  private right = document.getElementById('status-right')!;

  createItem(opts: StatusItemOptions = {}): StatusItem {
    const el = document.createElement('div');
    el.className = 'status-item' + (opts.onClick ? ' clickable' : '');
    el.dataset.priority = String(opts.priority ?? 0);
    if (opts.onClick) el.addEventListener('click', opts.onClick);
    const host = opts.align === 'right' ? this.right : this.left;
    const priority = opts.priority ?? 0;
    // Left side: high priority first. Right side: high priority last.
    const before = [...host.children].find((c) => {
      const p = Number((c as HTMLElement).dataset.priority);
      return opts.align === 'right' ? p > priority : p < priority;
    });
    host.insertBefore(el, before ?? null);
    const apply = (text: string) => {
      el.textContent = text;
      el.hidden = text === '';
    };
    apply(opts.text ?? '');
    el.title = opts.tooltip ?? '';
    return {
      get text() { return el.textContent ?? ''; },
      set text(value: string) { apply(value); },
      get tooltip() { return el.title; },
      set tooltip(value: string) { el.title = value; },
      dispose: () => el.remove(),
    };
  }
}
