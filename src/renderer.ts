import path from "node:path";
import type { OverlayMode } from "./app.js";
import type { SearchResult, TreeEntry } from "./workspace.js";

export type TerminalSize = {
  columns: number;
  rows: number;
};

export type RenderOptions = {
  workspaceRoots?: string[];
  focusedRegion?: "tree" | "editor";
  overlayMode?: OverlayMode;
  paletteOpen?: boolean;
  currentFile?: string;
  currentFileContent?: string;
  cursorLine?: number;
  cursorColumn?: number;
  editorScrollLine?: number;
  dirty?: boolean;
  treeEntries?: TreeEntry[];
  highlightedTreeIndex?: number;
  quickOpenQuery?: string;
  quickOpenResults?: SearchResult[];
  terminalSize?: Partial<TerminalSize>;
};

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MIN_COLUMNS = 32;
const MIN_ROWS = 6;

export function renderShellFrame(options: RenderOptions | string[] = {}): string {
  const normalized: RenderOptions = Array.isArray(options) ? { workspaceRoots: options } : options;
  const workspaceRoots = normalized.workspaceRoots ?? [];
  const focusedRegion = normalized.focusedRegion ?? "editor";
  const overlayMode = normalized.overlayMode ?? (normalized.paletteOpen ? "palette" : "none");
  const currentFile = normalized.currentFile;
  const cursorLine = normalizePosition(normalized.cursorLine);
  const cursorColumn = normalizePosition(normalized.cursorColumn);
  const editorScrollLine = normalizePosition(normalized.editorScrollLine);
  const dirtyState = normalized.dirty ? "dirty" : "clean";
  const size = normalizeTerminalSize(normalized.terminalSize);
  const { treeWidth, editorWidth } = layoutWidths(size.columns);
  const contentRows = size.rows - 5;
  const treeLines = renderTreeLines(
    normalized.treeEntries,
    normalized.highlightedTreeIndex ?? 0,
    workspaceRoots,
    focusedRegion,
    treeWidth,
    contentRows
  );
  const editorLines = renderEditorLines(
    currentFile,
    normalized.currentFileContent,
    focusedRegion,
    editorScrollLine,
    cursorLine,
    editorWidth,
    contentRows
  );
  const overlayLine = borderedLine(renderOverlayText(overlayMode, normalized.quickOpenQuery ?? "", normalized.quickOpenResults ?? []), size.columns);
  const statusFile = currentFile ? path.basename(currentFile) : "<none>";
  const statusLine = borderedLine(`Status: NORMAL | File: ${statusFile} | Ln ${cursorLine + 1}, Col ${cursorColumn + 1} | ${dirtyState}`, size.columns);

  const lines = [topBorder(treeWidth, editorWidth)];
  for (let index = 0; index < contentRows; index += 1) {
    lines.push(`│${treeLines[index]}│${editorLines[index]}│`);
  }
  lines.push(separatorBorder(size.columns));
  lines.push(overlayLine);
  lines.push(statusLine);
  lines.push(bottomBorder(size.columns));

  return lines.join("\n");
}

function normalizeTerminalSize(size: Partial<TerminalSize> | undefined): TerminalSize {
  return {
    columns: Math.max(MIN_COLUMNS, Math.floor(size?.columns ?? DEFAULT_COLUMNS)),
    rows: Math.max(MIN_ROWS, Math.floor(size?.rows ?? DEFAULT_ROWS))
  };
}

function normalizePosition(position: number | undefined): number {
  return Math.max(0, Math.floor(position ?? 0));
}

function layoutWidths(columns: number): { treeWidth: number; editorWidth: number } {
  const available = columns - 3;
  const treeWidth = Math.min(40, Math.max(20, Math.floor(columns * 0.3), Math.min(available - 10, 20)));
  return { treeWidth, editorWidth: available - treeWidth };
}

function renderTreeLines(
  entries: TreeEntry[] | undefined,
  highlightedIndex: number,
  workspaceRoots: string[],
  focusedRegion: "tree" | "editor",
  width: number,
  count: number
): string[] {
  const fallbackLabel = workspaceRoots.length > 0 ? workspaceRoots[0] : "<no workspace>";
  const fallback = `${focusedRegion === "tree" ? ">" : " "} ${fallbackLabel}`;
  const source = entries && entries.length > 0 ? entries : [{ label: fallback, depth: 0, kind: "directory", expanded: true, path: fallback } as TreeEntry];
  const maxStart = Math.max(0, source.length - count);
  const start = Math.max(0, Math.min(maxStart, highlightedIndex - count + 1));

  return Array.from({ length: count }, (_, slot) => {
    const entryIndex = start + slot;
    const entry = source[entryIndex];
    if (!entry) {
      return " ".repeat(width);
    }
    const highlight = entryIndex === highlightedIndex ? ">" : " ";
    const icon = entry.kind === "directory" ? (entry.expanded ? "▾" : "▸") : " ";
    const indent = " ".repeat(Math.min(entry.depth * 2, Math.max(0, width - 4)));
    return fitText(`${highlight}${indent}${icon} ${entry.label}`, width);
  });
}

function renderEditorLines(
  currentFile: string | undefined,
  content: string | undefined,
  focusedRegion: "tree" | "editor",
  scrollLine: number,
  cursorLine: number,
  width: number,
  count: number
): string[] {
  const editorTitle = currentFile ? path.basename(currentFile) : "<open file to start>";
  const editorPrefix = focusedRegion === "editor" ? ">" : " ";
  const lines = [fitText(`${editorPrefix} ${editorTitle}`, width)];

  if (currentFile) {
    const contentLines = splitEditorContent(content ?? "");
    const visibleContentRows = Math.max(0, count - 1);
    const maxScrollLine = Math.max(0, contentLines.length - visibleContentRows);
    const firstLine = Math.max(0, Math.min(scrollLine, maxScrollLine));

    for (let contentIndex = firstLine; lines.length < count && contentIndex < contentLines.length; contentIndex += 1) {
      const cursorMarker = contentIndex === cursorLine ? ">" : " ";
      lines.push(fitText(`${cursorMarker} ${contentLines[contentIndex]}`, width));
    }
  }

  while (lines.length < count) {
    lines.push(" ".repeat(width));
  }

  return lines;
}

function splitEditorContent(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function renderOverlayText(mode: OverlayMode, query: string, results: SearchResult[]): string {
  if (mode === "palette") {
    return "Palette: type a command";
  }

  if (mode === "quickOpen") {
    const first = results[0]?.label ?? "<no matches>";
    return `Quick Open: ${query} -> ${first}`;
  }

  return "Palette: <closed> | Ctrl+O quick open | Ctrl+P commands";
}

function topBorder(treeWidth: number, editorWidth: number): string {
  return `┌${titleSegment(" Tree ", treeWidth)}┬${titleSegment(" Editor ", editorWidth)}┐`;
}

function separatorBorder(columns: number): string {
  return `├${"─".repeat(columns - 2)}┤`;
}

function bottomBorder(columns: number): string {
  return `└${"─".repeat(columns - 2)}┘`;
}

function borderedLine(text: string, columns: number): string {
  return `│${fitText(text, columns - 2)}│`;
}

function titleSegment(title: string, width: number): string {
  if (width <= title.length) {
    return title.slice(0, width);
  }
  const left = Math.floor((width - title.length) / 2);
  const right = width - title.length - left;
  return `${"─".repeat(left)}${title}${"─".repeat(right)}`;
}

function fitText(text: string, width: number): string {
  return text.slice(0, width).padEnd(width, " ");
}
