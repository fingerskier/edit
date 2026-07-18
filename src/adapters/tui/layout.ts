// Pure screen geometry: given the terminal size, compute the rectangle each slot
// occupies. No painting, no I/O — fully unit-testable.
//
// Layout (per spec §5.1, with an optional bottom panel and optional tab strip):
//   ┌──────────┬─────────────────────────┐
//   │  tree    │  tabs (optional, 1 row) │   } content rows
//   │          │  main (editor)          │
//   ├──────────┴─────────────────────────┤
//   │ panel (output / problems / …)       │   } panelHeight rows (0 = hidden)
//   ├─────────────────────────────────────┤
//   │ status (1 row, full width)          │
//   └─────────────────────────────────────┘
// The tree is a fixed-width left column with a 1-col vertical divider; the panel is
// a full-width region above the status bar (shown only when something contributes
// to the `panel` slot); the tab strip sits only in the main column (not over the
// tree); the command palette is a centered overlay drawn on top.

export interface Rect { x: number; y: number; width: number; height: number }

export interface Layout {
  cols: number;
  rows: number;
  tree: Rect;
  /** x of the 1-col vertical divider between tree and main; -1 when there is no room. */
  dividerX: number;
  /** Tab strip above the editor within the main column; height 0 when hidden. */
  tabs: Rect;
  main: Rect;
  /** Full-width bottom panel above the status bar; height 0 when hidden. */
  panel: Rect;
  status: Rect;
  /** Centered box for the command-palette overlay (title border + body). */
  overlay: Rect;
}

export interface LayoutOptions {
  /** Rows reserved for the bottom panel (clamped to the space above the status bar). 0 hides it. */
  panelHeight?: number;
  /** Rows reserved for the tab strip at the top of the main column. 0 hides it. */
  tabsHeight?: number;
}

const TREE_RATIO = 0.25;
const TREE_MIN = 16;
const TREE_MAX = 40;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function computeLayout(cols: number, rows: number, opts: LayoutOptions = {}): Layout {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));

  // Status bar owns the bottom row; everything else shares the rows above it.
  const above = Math.max(0, r - 1);
  const status: Rect = { x: 0, y: r - 1, width: c, height: 1 };

  // The panel takes the bottom `panelHeight` of the area above the status bar;
  // tree/main get what's left.
  const panelH = clamp(Math.floor(opts.panelHeight ?? 0), 0, above);
  const contentH = above - panelH;
  const panel: Rect = { x: 0, y: above - panelH, width: c, height: panelH };

  // Tree width: a clamped fraction of the screen, but never so wide that the main
  // region (after a 1-col divider) loses its last column.
  let treeW = clamp(Math.round(c * TREE_RATIO), TREE_MIN, TREE_MAX);
  treeW = Math.min(treeW, Math.max(0, c - 2)); // keep >=1 col for main + 1 for divider

  const tree: Rect = { x: 0, y: 0, width: treeW, height: contentH };
  const dividerX = treeW > 0 && treeW < c - 1 ? treeW : -1;
  const mainX = dividerX >= 0 ? dividerX + 1 : treeW;
  const mainW = Math.max(0, c - mainX);
  // Tabs sit only in the main column; tree keeps the full content height.
  const tabsH = clamp(Math.floor(opts.tabsHeight ?? 0), 0, contentH);
  const tabs: Rect = { x: mainX, y: 0, width: mainW, height: tabsH };
  const main: Rect = { x: mainX, y: tabsH, width: mainW, height: contentH - tabsH };

  // Overlay: centered in the area above the status bar, ~70% wide / ~60% tall.
  const ovW = clamp(Math.round(c * 0.7), Math.min(20, c), Math.min(72, c));
  const ovH = clamp(Math.round(above * 0.6), Math.min(3, above), Math.min(18, above));
  const overlay: Rect = {
    x: Math.max(0, Math.floor((c - ovW) / 2)),
    y: Math.max(0, Math.floor((above - ovH) / 2)),
    width: ovW,
    height: ovH,
  };

  return { cols: c, rows: r, tree, dividerX, tabs, main, panel, status, overlay };
}
