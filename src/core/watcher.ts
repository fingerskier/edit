import { watch, type FSWatcher } from 'node:fs';
import type { EventBus } from './event-bus.ts';

export class Watcher {
  private watchers = new Map<string, FSWatcher>();
  constructor(private bus: EventBus) {}

  watch(dir: string): void {
    if (this.watchers.has(dir)) return;
    const w = watch(dir, () => this.bus.emit('fs:changed', { dir }));
    this.watchers.set(dir, w);
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
