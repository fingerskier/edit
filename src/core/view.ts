import type { Disposable } from './disposable.js';

export type Slot = 'tree' | 'main' | 'status' | 'panel' | 'overlay';

export interface ListItem { label: string; style?: string }
export interface StyleSpan { line: number; start: number; end: number; style: string }

export type Widget =
  | { kind: 'list'; items: ListItem[]; selected: number }
  | { kind: 'text'; lines: string[]; spans?: StyleSpan[]; cursors?: number[]; scroll?: number }
  | { kind: 'status'; segments: string[] }
  | { kind: 'panel'; title?: string; body: Widget }
  | { kind: 'overlay'; title?: string; body: Widget };

export type ViewModel = Widget;
export type Frame = Partial<Record<Slot, ViewModel>>;
export type ViewProvider = () => ViewModel | null;

export interface ContributeOptions {
  /**
   * Higher priority wins when several providers contribute to the same slot.
   * Defaults to 0. Ties are broken by registration order (latest wins), which
   * preserves the historical last-writer-wins behaviour for un-prioritised
   * contributions.
   */
  priority?: number;
}

interface SlotEntry {
  provider: ViewProvider;
  priority: number;
  seq: number;
}

export class ViewRegistry {
  private slots = new Map<Slot, SlotEntry[]>();
  private seq = 0;

  /**
   * Register a view provider for a slot. Multiple providers may target the same
   * slot — the composer resolves them by priority (highest wins; ties broken by
   * latest registration) so independent plugins can contribute to one region
   * without clobbering each other's registration. The returned disposer removes
   * exactly this contribution.
   */
  contribute(slot: Slot, provider: ViewProvider, opts: ContributeOptions = {}): Disposable {
    const entry: SlotEntry = { provider, priority: opts.priority ?? 0, seq: this.seq++ };
    const list = this.slots.get(slot);
    if (list) list.push(entry);
    else this.slots.set(slot, [entry]);
    return {
      dispose: () => {
        const cur = this.slots.get(slot);
        if (!cur) return;
        const i = cur.indexOf(entry);
        if (i !== -1) cur.splice(i, 1);
        if (cur.length === 0) this.slots.delete(slot);
      },
    };
  }

  /** Slots that currently have at least one contributor. */
  slotsInUse(): Slot[] { return [...this.slots.keys()]; }

  /** Providers for a slot, ordered winner-first (priority desc, then latest seq). */
  providersFor(slot: Slot): ViewProvider[] {
    const list = this.slots.get(slot);
    if (!list) return [];
    return [...list]
      .sort((a, b) => b.priority - a.priority || b.seq - a.seq)
      .map((e) => e.provider);
  }
}

export class ViewComposer {
  constructor(private registry: ViewRegistry) {}

  compose(): Frame {
    const frame: Frame = {};
    for (const slot of this.registry.slotsInUse()) {
      // Evaluate providers winner-first and take the first non-null view model.
      // A provider that returns null or throws degrades only itself — we fall
      // through to the next contender for the slot rather than dropping it.
      for (const provider of this.registry.providersFor(slot)) {
        let vm: ViewModel | null;
        try {
          vm = provider();
        } catch (err) {
          console.error(`[ViewComposer] provider for slot "${slot}" threw:`, err);
          continue;
        }
        if (vm !== null) { frame[slot] = vm; break; }
      }
    }
    return frame;
  }
}
