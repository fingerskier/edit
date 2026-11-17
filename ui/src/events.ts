export type Disposer = () => void;

export class Emitter {
  private handlers = new Map<string, Set<(payload: any) => void>>();

  on(event: string, handler: (payload: any) => void): Disposer {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      try {
        handler(payload);
      } catch (e) {
        console.error(`[fedit] handler for "${event}" failed`, e);
      }
    }
  }
}
