// Pure rendering: (Frame, Layout) -> an in-memory screen grid of styled cells, plus
// the hardware-cursor position for the editor caret. No TTY here — the grid can be
// snapshotted as text (screenToText) for tests, or serialized to ANSI (screenToAnsi)
// for the terminal. Full repaint every frame (frames are one screen; simplest+correct).

import type { Frame, Widget } from '../../core/view.js';
import type { Layout, Rect } from './layout.js';

export interface Cell { ch: string; inverse: boolean }

export interface Screen {
  cols: number;
  rows: number;
  cells: Cell[][]; // [row][col]
  /** Editor caret in screen coords, or null when hidden (e.g. an overlay is up). */
  cursor: { x: number; y: number } | null;
}

const BLANK = ' ';

function blankScreen(cols: number, rows: number): Screen {
  const cells: Cell[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < cols; x++) row.push({ ch: BLANK, inverse: false });
    cells.push(row);
  }
  return { cols, rows, cells, cursor: null };
}

function set(screen: Screen, x: number, y: number, ch: string, inverse: boolean): void {
  if (y < 0 || y >= screen.rows || x < 0 || x >= screen.cols) return;
  screen.cells[y][x] = { ch, inverse };
}

/** Write `text` at (x,y), clipped to `width` columns and the screen edge. */
function putText(screen: Screen, x: number, y: number, text: string, width: number, inverse = false): void {
  const chars = [...text];
  for (let k = 0; k < chars.length && k < width; k++) set(screen, x + k, y, chars[k], inverse);
}

/** Fill an entire row segment with a (possibly inverse) blank background. */
function fillRow(screen: Screen, rect: Rect, y: number, inverse: boolean): void {
  for (let x = rect.x; x < rect.x + rect.width; x++) set(screen, x, y, BLANK, inverse);
}

/** Vertical scroll offset that keeps `selected` visible in `height` rows. */
function scrollFor(selected: number, height: number): number {
  if (height <= 0 || selected < height) return 0;
  return selected - height + 1;
}

// --- list painting (shared by the tree slot and the overlay body) ---
interface ListLike { items: { label: string }[]; selected: number }

function paintList(screen: Screen, rect: Rect, list: ListLike): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  const top = scrollFor(list.selected, rect.height);
  for (let i = 0; i < rect.height; i++) {
    const idx = top + i;
    if (idx >= list.items.length) break;
    const y = rect.y + i;
    const selected = idx === list.selected;
    if (selected) fillRow(screen, rect, y, true); // selection bar spans the column
    putText(screen, rect.x, y, list.items[idx].label, rect.width, selected);
  }
}

// --- editor text painting; returns the caret position in screen coords (or null) ---
function offsetToRowCol(lines: string[], offset: number): { row: number; col: number } {
  let rem = Math.max(0, offset);
  for (let r = 0; r < lines.length; r++) {
    const len = lines[r].length;
    if (rem <= len) return { row: r, col: rem };
    rem -= len + 1; // account for the joining '\n'
  }
  const last = Math.max(0, lines.length - 1);
  return { row: last, col: lines[last]?.length ?? 0 };
}

function paintText(
  screen: Screen,
  rect: Rect,
  widget: Extract<Widget, { kind: 'text' }>,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const lines = widget.lines.length > 0 ? widget.lines : [''];
  const caretOffset = widget.cursors?.[0];
  const caret = caretOffset === undefined ? null : offsetToRowCol(lines, caretOffset);

  // Scroll so the caret stays visible (derived from the caret, not stored state).
  const top = caret ? scrollFor(caret.row, rect.height) : 0;
  const left = caret && caret.col >= rect.width ? caret.col - rect.width + 1 : 0;

  for (let i = 0; i < rect.height; i++) {
    const idx = top + i;
    if (idx >= lines.length) break;
    putText(screen, rect.x, rect.y + i, lines[idx].slice(left, left + rect.width), rect.width);
  }

  if (!caret) return null;
  const cx = rect.x + (caret.col - left);
  const cy = rect.y + (caret.row - top);
  if (cx < rect.x || cx >= rect.x + rect.width || cy < rect.y || cy >= rect.y + rect.height) return null;
  return { x: cx, y: cy };
}

function paintStatus(screen: Screen, rect: Rect, widget: Extract<Widget, { kind: 'status' }>): void {
  fillRow(screen, rect, rect.y, true); // a solid bar across the bottom
  putText(screen, rect.x, rect.y, widget.segments.join('  '), rect.width, true);
}

// --- overlay box (command palette) ---
function paintOverlay(screen: Screen, rect: Rect, widget: Extract<Widget, { kind: 'overlay' }>): void {
  if (rect.width < 2 || rect.height < 2) return;
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.width - 1;
  const y1 = rect.y + rect.height - 1;

  // Clear the box interior + borders so it fully occludes whatever is underneath.
  for (let y = y0; y <= y1; y++) fillRow(screen, rect, y, false);

  // Borders.
  set(screen, x0, y0, '┌', false);
  set(screen, x1, y0, '┐', false);
  set(screen, x0, y1, '└', false);
  set(screen, x1, y1, '┘', false);
  for (let x = x0 + 1; x < x1; x++) { set(screen, x, y0, '─', false); set(screen, x, y1, '─', false); }
  for (let y = y0 + 1; y < y1; y++) { set(screen, x0, y, '│', false); set(screen, x1, y, '│', false); }

  // Title embedded in the top border: ┌─ Title ─…─┐
  if (widget.title) {
    const label = ' ' + widget.title + ' ';
    putText(screen, x0 + 2, y0, label, rect.width - 4, false);
  }

  // Body (a list) inside the border.
  const inner: Rect = { x: x0 + 1, y: y0 + 1, width: rect.width - 2, height: rect.height - 2 };
  const body = widget.body;
  if (body.kind === 'list') {
    paintList(screen, inner, body);
  } else if (body.kind === 'text') {
    paintText(screen, inner, body);
  }
}

/** Compose a full Frame into a screen grid. */
export function renderFrame(frame: Frame, layout: Layout): Screen {
  const screen = blankScreen(layout.cols, layout.rows);

  if (frame.tree && frame.tree.kind === 'list') paintList(screen, layout.tree, frame.tree);

  // Vertical divider between tree and main.
  if (layout.dividerX >= 0) {
    for (let y = 0; y < layout.tree.height; y++) set(screen, layout.dividerX, y, '│', false);
  }

  if (frame.main && frame.main.kind === 'text') {
    screen.cursor = paintText(screen, layout.main, frame.main);
  }

  if (frame.status && frame.status.kind === 'status') paintStatus(screen, layout.status, frame.status);

  // Overlay paints last (on top) and suppresses the editor caret.
  if (frame.overlay && frame.overlay.kind === 'overlay') {
    paintOverlay(screen, layout.overlay, frame.overlay);
    screen.cursor = null;
  }

  return screen;
}

/** Plain-text view of the grid (trailing blanks trimmed) for snapshots/debugging. */
export function screenToText(screen: Screen): string {
  return screen.cells
    .map((row) => row.map((c) => c.ch).join('').replace(/\s+$/u, ''))
    .join('\n');
}

/** Serialize the grid to a full-repaint ANSI string (absolute row positioning + reverse runs). */
export function screenToAnsi(screen: Screen): string {
  let out = '';
  for (let y = 0; y < screen.rows; y++) {
    out += `\x1b[${y + 1};1H`; // move to start of this row (cancels any pending autowrap)
    let inv = false;
    for (let x = 0; x < screen.cols; x++) {
      const cell = screen.cells[y][x];
      if (cell.inverse && !inv) { out += '\x1b[7m'; inv = true; }
      else if (!cell.inverse && inv) { out += '\x1b[27m'; inv = false; }
      out += cell.ch;
    }
    if (inv) out += '\x1b[27m';
  }
  return out;
}
