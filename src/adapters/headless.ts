import type { Adapter, KeyHandler } from '../core/adapter.js';
import type { Frame } from '../core/view.js';

export class HeadlessAdapter implements Adapter {
  readonly frames: Frame[] = [];
  private keyHandler: KeyHandler | null = null;

  render(frame: Frame): void { this.frames.push(frame); }
  lastFrame(): Frame | undefined { return this.frames.at(-1); }

  onKey(handler: KeyHandler): void { this.keyHandler = handler; }
  sendKey(key: string): void { this.keyHandler?.(key); }

  dispose(): void { this.keyHandler = null; }
}
