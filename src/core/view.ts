export type Slot = 'tree' | 'main' | 'status' | 'overlay';

export interface ListItem { label: string; style?: string }
export interface StyleSpan { line: number; start: number; end: number; style: string }

export type Widget =
  | { kind: 'list'; items: ListItem[]; selected: number }
  | { kind: 'text'; lines: string[]; spans?: StyleSpan[]; cursors?: number[]; scroll?: number }
  | { kind: 'status'; segments: string[] }
  | { kind: 'overlay'; title?: string; body: Widget };

export type ViewModel = Widget;
export type Frame = Partial<Record<Slot, ViewModel>>;
export type ViewProvider = () => ViewModel | null;

export class ViewRegistry {
  private providers = new Map<Slot, ViewProvider>();

  contribute(slot: Slot, provider: ViewProvider): void {
    this.providers.set(slot, provider);
  }

  entries(): [Slot, ViewProvider][] { return [...this.providers.entries()]; }
}

export class ViewComposer {
  constructor(private registry: ViewRegistry) {}

  compose(): Frame {
    const frame: Frame = {};
    for (const [slot, provider] of this.registry.entries()) {
      const vm = provider();
      if (vm !== null) frame[slot] = vm;
    }
    return frame;
  }
}
