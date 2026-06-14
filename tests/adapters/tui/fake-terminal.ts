// In-memory TerminalLike for headless testing of the TUI adapter + full app stack.
// Mirrors the real Terminal: feedRaw() runs the same key-decoder a real TTY would.
import type { TerminalLike } from '../../../src/adapters/tui/terminal.ts';
import { decodeKeys } from '../../../src/adapters/tui/key-decoder.ts';

export class FakeTerminal implements TerminalLike {
  cols: number;
  rows: number;
  readonly writes: string[] = [];
  started = false;
  stopped = false;
  private keyCb: ((key: string) => void) | null = null;
  private resizeCb: ((size: { cols: number; rows: number }) => void) | null = null;

  constructor(cols = 80, rows = 24) { this.cols = cols; this.rows = rows; }

  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
  size(): { cols: number; rows: number } { return { cols: this.cols, rows: this.rows }; }
  write(data: string): void { this.writes.push(data); }
  onKey(cb: (key: string) => void): void { this.keyCb = cb; }
  onResize(cb: (size: { cols: number; rows: number }) => void): void { this.resizeCb = cb; }

  /** Simulate raw bytes from the terminal (decoded exactly as the real Terminal does). */
  feedRaw(chunk: string): void { for (const key of decodeKeys(chunk)) this.keyCb?.(key); }
  /** Simulate an already-decoded key token. */
  sendKey(key: string): void { this.keyCb?.(key); }
  /** Simulate a terminal resize. */
  resize(cols: number, rows: number): void {
    this.cols = cols; this.rows = rows;
    this.resizeCb?.({ cols, rows });
  }

  /** The most recent painted output (full-repaint ANSI string). */
  lastWrite(): string { return this.writes.at(-1) ?? ''; }
}
