import { watch, type FSWatcher } from 'node:fs';
import type { EventBus } from './event-bus.js';

export class Watcher {
  private watchers = new Map<string, FSWatcher>();
  constructor(private bus: EventBus) {}

  watch(dir: string): void {
    if (this.watchers.has(dir)) return;
    // Recursive so nested tree expansions still refresh when deep files change
    // (supported on macOS/Windows; Linux since recent Node — best-effort).
    const w = watch(dir, { recursive: true }, (eventType, filename) => {
      this.bus.emit('fs:changed', {
        dir,
        filename: filename === null ? null : filename.toString(),
        eventType,
      });
    });
    this.watchers.set(dir, w);
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
