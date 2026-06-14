// Pure screen geometry: given the terminal size, compute the rectangle each slot
// occupies. No painting, no I/O — fully unit-testable.
//
// Layout (fixed, per spec §5.1):
//   ┌──────────┬─────────────────────────┐
//   │  tree    │  main (editor)          │   } content rows = rows - 1
//   │          │                         │
//   ├──────────┴─────────────────────────┤
//   │ status (1 row, full width)          │
//   └─────────────────────────────────────┘
// The tree is a fixed-width left column with a 1-col vertical divider; the command
// palette is a centered overlay box drawn on top of everything.

export interface Rect { x: number; y: number; width: number; height: number }

export interface Layout {
  cols: number;
  rows: number;
  tree: Rect;
  /** x of the 1-col vertical divider between tree and main; -1 when there is no room. */
  dividerX: number;
  main: Rect;
  status: Rect;
  /** Centered box for the command-palette overlay (title border + body). */
  overlay: Rect;
}

const TREE_RATIO = 0.25;
const TREE_MIN = 16;
const TREE_MAX = 40;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function computeLayout(cols: number, rows: number): Layout {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));

  // Status bar owns the bottom row; everything else shares the rows above it.
  const contentH = Math.max(0, r - 1);
  const status: Rect = { x: 0, y: r - 1, width: c, height: 1 };

  // Tree width: a clamped fraction of the screen, but never so wide that the main
  // region (after a 1-col divider) loses its last column.
  let treeW = clamp(Math.round(c * TREE_RATIO), TREE_MIN, TREE_MAX);
  treeW = Math.min(treeW, Math.max(0, c - 2)); // keep >=1 col for main + 1 for divider

  const tree: Rect = { x: 0, y: 0, width: treeW, height: contentH };
  const dividerX = treeW > 0 && treeW < c - 1 ? treeW : -1;
  const mainX = dividerX >= 0 ? dividerX + 1 : treeW;
  const main: Rect = { x: mainX, y: 0, width: Math.max(0, c - mainX), height: contentH };

  // Overlay: centered, ~70% wide / ~60% tall, with sane caps and a minimum.
  const ovW = clamp(Math.round(c * 0.7), Math.min(20, c), Math.min(72, c));
  const ovH = clamp(Math.round(contentH * 0.6), Math.min(3, contentH), Math.min(18, contentH));
  const overlay: Rect = {
    x: Math.max(0, Math.floor((c - ovW) / 2)),
    y: Math.max(0, Math.floor((contentH - ovH) / 2)),
    width: ovW,
    height: ovH,
  };

  return { cols: c, rows: r, tree, dividerX, main, status, overlay };
}
