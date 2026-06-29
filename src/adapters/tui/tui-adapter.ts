// The real-terminal Adapter: wires a TerminalLike (input + output + resize) to the
// core's render/onKey/dispose contract. Decoding and painting live in the pure
// modules; this class is just the glue + lifecycle.

import type { Adapter, KeyHandler } from '../../core/adapter.js';
import type { Frame } from '../../core/view.js';
import { computeLayout } from './layout.js';
import { renderFrame, screenToAnsi } from './renderer.js';
import { Terminal, type TerminalLike } from './terminal.js';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

export class TuiAdapter implements Adapter {
  private term: TerminalLike;
  private keyHandler: KeyHandler | null = null;
  private lastFrame: Frame = {};

  constructor(term: TerminalLike = new Terminal()) {
    this.term = term;
    this.term.start();
    // Forward decoded keys to whatever handler the core registers via onKey().
    this.term.onKey((key) => this.keyHandler?.(key));
    // On resize, repaint the most recent frame against the new geometry.
    this.term.onResize(() => this.paint(this.lastFrame));
  }

  render(frame: Frame): void {
    this.lastFrame = frame;
    this.paint(frame);
  }

  onKey(handler: KeyHandler): void { this.keyHandler = handler; }

  dispose(): void {
    this.keyHandler = null;
    this.term.stop();
  }

  private paint(frame: Frame): void {
    const { cols, rows } = this.term.size();
    // Reserve rows for the bottom panel only when something contributes to it
    // (~30% of the height above the status bar, clamped); computeLayout clamps to
    // the actually-available space.
    const panelHeight = frame.panel ? Math.max(3, Math.min(12, Math.round((rows - 1) * 0.3))) : 0;
    const screen = renderFrame(frame, computeLayout(cols, rows, { panelHeight }));
    // Paint with the cursor hidden (so it doesn't streak across the repaint), then
    // either place + show the editor caret, or leave it hidden (e.g. overlay up).
    let out = HIDE_CURSOR + screenToAnsi(screen);
    if (screen.cursor) {
      out += `\x1b[${screen.cursor.y + 1};${screen.cursor.x + 1}H` + SHOW_CURSOR;
    }
    this.term.write(out);
  }
}
