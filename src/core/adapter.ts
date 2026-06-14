import type { Frame } from './view.js';

export type KeyHandler = (key: string) => void;

export interface Adapter {
  /** Paint a composed frame. */
  render(frame: Frame): void;
  /** Register the handler the adapter calls for each captured key. */
  onKey(handler: KeyHandler): void;
  /** Release resources (terminal raw mode, etc.). */
  dispose(): void;
}
