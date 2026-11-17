// The one overlay input of the workbench. It backs the command palette, quick
// open, go-to-line, pickers, and text prompts.

import { fuzzyMatch } from './fuzzy.ts';
import { escapeHtml } from './ui.ts';

export interface PickItem<T = unknown> {
  label: string;
  description?: string;
  /** Text shown as a key hint on the right. */
  key?: string;
  /** Text to fuzzy-match against. Defaults to the label. */
  match?: string;
  value: T;
}

interface Session {
  provider: (query: string) => PickItem[];
  accept: (item: PickItem | undefined, query: string) => void;
  cancel: () => void;
  /** Accept with no item selected (text prompts). */
  free: boolean;
}

const MAX_SHOWN = 200;

/** Fuzzy-filter items by query, best first. With no query, order is kept. */
export function filterItems<T>(items: PickItem<T>[], query: string): { item: PickItem<T>; positions: number[] }[] {
  const q = query.trim();
  if (q === '') return items.map((item) => ({ item, positions: [] }));
  const scored: { item: PickItem<T>; positions: number[]; score: number; len: number; index: number }[] = [];
  items.forEach((item, index) => {
    const text = item.match ?? item.label;
    const m = fuzzyMatch(q, text);
    if (m) scored.push({ item, positions: item.match === undefined ? m.positions : [], score: m.score, len: text.length, index });
  });
  scored.sort((a, b) => b.score - a.score || a.len - b.len || a.index - b.index);
  return scored;
}

function highlight(label: string, positions: number[]): string {
  if (positions.length === 0) return escapeHtml(label);
  const marks = new Set(positions);
  let out = '';
  for (let i = 0; i < label.length; i++) out += marks.has(i) ? `<b>${escapeHtml(label[i])}</b>` : escapeHtml(label[i]);
  return out;
}

export class Palette {
  private root = document.getElementById('palette')!;
  private input = document.getElementById('palette-input') as HTMLInputElement;
  private list = document.getElementById('palette-list')!;
  private session: Session | null = null;
  private shown: { item: PickItem; positions: number[] }[] = [];
  private index = 0;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.pick');
      if (!row) return;
      this.index = Number(row.dataset.index);
      this.acceptCurrent();
    });
    document.addEventListener('mousedown', (e) => {
      if (this.session && !this.root.contains(e.target as Node)) this.close(true);
    });
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  /** Low-level open: `provider` maps the current text to the rows to show. */
  open(opts: {
    placeholder?: string;
    value?: string;
    provider: (query: string) => PickItem[];
    accept: (item: PickItem | undefined, query: string) => void;
    cancel?: () => void;
    free?: boolean;
  }): void {
    if (this.session) this.close(true);
    else this.returnFocus = document.activeElement as HTMLElement | null;
    this.session = { provider: opts.provider, accept: opts.accept, cancel: opts.cancel ?? (() => {}), free: opts.free ?? false };
    this.input.placeholder = opts.placeholder ?? '';
    this.input.value = opts.value ?? '';
    this.root.hidden = false;
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.refresh();
  }

  /** Pick one of `items` with fuzzy filtering. Resolves undefined when dismissed. */
  pick<T>(items: PickItem<T>[], opts: { placeholder?: string } = {}): Promise<T | undefined> {
    return new Promise((resolve) => {
      this.open({
        placeholder: opts.placeholder,
        provider: (q) => filterItems(items, q).map((s) => ({ ...s.item, positions: s.positions }) as PickItem),
        accept: (item) => resolve(item?.value as T | undefined),
        cancel: () => resolve(undefined),
      });
    });
  }

  /** Ask for a line of text. Resolves undefined when dismissed. */
  prompt(opts: { placeholder?: string; value?: string; validate?: (value: string) => string | undefined } = {}): Promise<string | undefined> {
    return new Promise((resolve) => {
      const check = (q: string) => opts.validate?.(q);
      this.open({
        placeholder: opts.placeholder,
        value: opts.value,
        free: true,
        provider: (q) => {
          const problem = check(q);
          return problem ? [{ label: problem, value: null }] : [];
        },
        accept: (_item, q) => (check(q) ? undefined : resolve(q)),
        cancel: () => resolve(undefined),
      });
      this.input.select();
    });
  }

  /** Yes/no style confirmation built on `pick`. Resolves the chosen value. */
  confirm<T>(message: string, choices: { label: string; value: T }[]): Promise<T | undefined> {
    return this.pick(choices, { placeholder: message });
  }

  close(cancelled = false): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.root.hidden = true;
    this.list.innerHTML = '';
    if (cancelled) session.cancel();
    // Only hand focus back if nothing else took it while we were open.
    if (!this.session && (document.activeElement === this.input || document.activeElement === document.body)) {
      this.returnFocus?.focus();
    }
  }

  /** Recompute the rows from the provider, e.g. after its data arrived. */
  refresh(): void {
    if (!this.session) return;
    const items = this.session.provider(this.input.value) as (PickItem & { positions?: number[] })[];
    this.shown = items.slice(0, MAX_SHOWN).map((item) => ({ item, positions: item.positions ?? [] }));
    this.index = 0;
    this.render();
  }

  private render(): void {
    this.list.innerHTML = this.shown
      .map(({ item, positions }, i) => {
        const desc = item.description ? `<span class="pick-desc">${escapeHtml(item.description)}</span>` : '';
        const key = item.key ? `<span class="key">${escapeHtml(item.key)}</span>` : '';
        return `<div class="pick${i === this.index ? ' selected' : ''}" role="option" data-index="${i}"><span class="pick-label">${highlight(item.label, positions)}</span>${desc}${key}</div>`;
      })
      .join('');
    this.list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private move(delta: number): void {
    if (this.shown.length === 0) return;
    this.index = (this.index + delta + this.shown.length) % this.shown.length;
    this.render();
  }

  private acceptCurrent(): void {
    const session = this.session;
    if (!session) return;
    const item = this.shown[this.index]?.item;
    if (!item && !session.free) return;
    const query = this.input.value;
    if (session.free) {
      // A prompt stays open while its validator objects.
      const before = this.session;
      session.accept(undefined, query);
      if (this.session === before && this.shown.length > 0) return;
      if (this.session === before) this.close();
      return;
    }
    this.close();
    session.accept(item, query);
  }

  private onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown': this.move(1); break;
      case 'ArrowUp': this.move(-1); break;
      case 'PageDown': this.move(8); break;
      case 'PageUp': this.move(-8); break;
      case 'Enter': this.acceptCurrent(); break;
      case 'Escape': this.close(true); break;
      case 'Tab': break; // keep focus inside the palette
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
