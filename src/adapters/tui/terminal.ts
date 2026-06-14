// Thin TTY side-effects layer: raw mode, alt screen, cursor visibility, writes, and
// resize events. All real I/O lives here so the rest of the TUI stays pure/testable.
// Streams are injectable; the TuiAdapter depends only on `TerminalLike`, so tests can
// substitute an in-memory fake.

import { decodeKeys } from './key-decoder.js';

export interface TerminalLike {
  /** Enter raw mode + alt screen, hide the hardware cursor. */
  start(): void;
  /** Restore the terminal to its pre-start state. */
  stop(): void;
  size(): { cols: number; rows: number };
  write(data: string): void;
  onKey(cb: (key: string) => void): void;
  onResize(cb: (size: { cols: number; rows: number }) => void): void;
}

// Minimal surfaces we need from Node's TTY streams (kept loose for fakes/tests).
export interface InputStream {
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: string): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  removeListener?(event: 'data', listener: (chunk: string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  isTTY?: boolean;
}
export interface OutputStream {
  write(data: string): unknown;
  on(event: 'resize', listener: () => void): unknown;
  removeListener?(event: 'resize', listener: () => void): unknown;
  columns?: number;
  rows?: number;
  isTTY?: boolean;
}

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR = '\x1b[2J';

export class Terminal implements TerminalLike {
  private input: InputStream;
  private output: OutputStream;
  private keyCb: ((key: string) => void) | null = null;
  private resizeCb: ((size: { cols: number; rows: number }) => void) | null = null;
  private onData = (chunk: string): void => {
    for (const key of decodeKeys(chunk)) this.keyCb?.(key);
  };
  private onResizeEvent = (): void => { this.resizeCb?.(this.size()); };
  private started = false;

  constructor(streams?: { input?: InputStream; output?: OutputStream }) {
    this.input = streams?.input ?? (process.stdin as unknown as InputStream);
    this.output = streams?.output ?? (process.stdout as unknown as OutputStream);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.setRawMode?.(true);
    this.input.setEncoding('utf8');
    this.input.on('data', this.onData);
    this.input.resume();
    this.output.on('resize', this.onResizeEvent);
    this.output.write(ENTER_ALT + HIDE_CURSOR + CLEAR);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.input.removeListener?.('data', this.onData);
    this.output.removeListener?.('resize', this.onResizeEvent);
    this.output.write(SHOW_CURSOR + LEAVE_ALT);
    this.input.setRawMode?.(false);
    this.input.pause();
  }

  size(): { cols: number; rows: number } {
    return { cols: this.output.columns ?? 80, rows: this.output.rows ?? 24 };
  }

  write(data: string): void { this.output.write(data); }

  onKey(cb: (key: string) => void): void { this.keyCb = cb; }
  onResize(cb: (size: { cols: number; rows: number }) => void): void { this.resizeCb = cb; }
}
