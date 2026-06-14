import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terminal, type InputStream, type OutputStream } from '../../../src/adapters/tui/terminal.ts';

class FakeInput implements InputStream {
  isTTY = true;
  rawMode: boolean | null = null;
  encoding: string | null = null;
  resumed = false;
  paused = false;
  private dataListeners: Array<(c: string) => void> = [];
  setRawMode(mode: boolean): void { this.rawMode = mode; }
  setEncoding(enc: string): void { this.encoding = enc; }
  on(_e: 'data', listener: (c: string) => void): void { this.dataListeners.push(listener); }
  removeListener(_e: 'data', listener: (c: string) => void): void {
    this.dataListeners = this.dataListeners.filter((l) => l !== listener);
  }
  resume(): void { this.resumed = true; }
  pause(): void { this.paused = true; }
  emit(chunk: string): void { for (const l of this.dataListeners) l(chunk); }
  listenerCount(): number { return this.dataListeners.length; }
}

class FakeOutput implements OutputStream {
  isTTY = true;
  columns = 100;
  rows = 30;
  readonly written: string[] = [];
  private resizeListeners: Array<() => void> = [];
  write(data: string): void { this.written.push(data); }
  on(_e: 'resize', listener: () => void): void { this.resizeListeners.push(listener); }
  removeListener(_e: 'resize', listener: () => void): void {
    this.resizeListeners = this.resizeListeners.filter((l) => l !== listener);
  }
  fireResize(): void { for (const l of this.resizeListeners) l(); }
}

test('start() enters raw mode, alt screen, hides cursor, and resumes input', () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const term = new Terminal({ input, output });
  term.start();
  assert.equal(input.rawMode, true);
  assert.equal(input.encoding, 'utf8');
  assert.equal(input.resumed, true);
  const out = output.written.join('');
  assert.match(out, /\x1b\[\?1049h/, 'enters alt screen');
  assert.match(out, /\x1b\[\?25l/, 'hides cursor');
});

test('decodes input data through the key decoder to the onKey handler', () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const term = new Terminal({ input, output });
  const keys: string[] = [];
  term.onKey((k) => keys.push(k));
  term.start();
  input.emit('a\x1b[A\x13'); // 'a', up, ctrl+s
  assert.deepEqual(keys, ['a', 'up', 'ctrl+s']);
});

test('size() reads columns/rows from the output stream', () => {
  const term = new Terminal({ input: new FakeInput(), output: new FakeOutput() });
  assert.deepEqual(term.size(), { cols: 100, rows: 30 });
});

test('resize event forwards the new size to onResize', () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const term = new Terminal({ input, output });
  let got: { cols: number; rows: number } | null = null;
  term.onResize((s) => { got = s; });
  term.start();
  output.columns = 120; output.rows = 40;
  output.fireResize();
  assert.deepEqual(got, { cols: 120, rows: 40 });
});

test('stop() restores cursor + main screen, leaves raw mode, detaches listeners', () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const term = new Terminal({ input, output });
  term.start();
  assert.equal(input.listenerCount(), 1);
  term.stop();
  const out = output.written.join('');
  assert.match(out, /\x1b\[\?25h/, 'shows cursor');
  assert.match(out, /\x1b\[\?1049l/, 'leaves alt screen');
  assert.equal(input.rawMode, false);
  assert.equal(input.paused, true);
  assert.equal(input.listenerCount(), 0, 'data listener removed');
});
