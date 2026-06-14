export type Listener = (payload: any) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, payload: any): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Isolate listeners: one throwing reactor must not abort the rest mid-emit,
    // which would leave a state-change only partially announced.
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] listener for "${event}" threw:`, err);
      }
    }
  }
}
