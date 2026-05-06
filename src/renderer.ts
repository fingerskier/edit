import path from "node:path";
import type { OverlayMode } from "./app.js";
import type { SearchResult, TreeEntry } from "./workspace.js";

export type RenderOptions = {
  workspaceRoots?: string[];
  focusedRegion?: "tree" | "editor";
  overlayMode?: OverlayMode;
  paletteOpen?: boolean;
  currentFile?: string;
  treeEntries?: TreeEntry[];
  highlightedTreeIndex?: number;
  quickOpenQuery?: string;
  quickOpenResults?: SearchResult[];
};

export function renderShellFrame(options: RenderOptions | string[] = {}): string {
  const normalized: RenderOptions = Array.isArray(options) ? { workspaceRoots: options } : options;
  const workspaceRoots = normalized.workspaceRoots ?? [];
  const focusedRegion = normalized.focusedRegion ?? "editor";
  const overlayMode = normalized.overlayMode ?? (normalized.paletteOpen ? "palette" : "none");
  const currentFile = normalized.currentFile;
  const treeLines = renderTreeLines(normalized.treeEntries, normalized.highlightedTreeIndex ?? 0, workspaceRoots, focusedRegion);
  const editorTitle = currentFile ? path.basename(currentFile) : "<open file to start>";
  const editorPrefix = focusedRegion === "editor" ? ">" : " ";
  const editorLine = `${editorPrefix} ${editorTitle}`.slice(0, 30).padEnd(30, " ");
  const overlayLine = renderOverlayLine(overlayMode, normalized.quickOpenQuery ?? "", normalized.quickOpenResults ?? []);
  const statusFile = currentFile ? path.basename(currentFile) : "<none>";

  return [
    "┌──────── Tree ────────┬──────────── Editor ────────────┐",
    `│ ${treeLines[0]} │ ${editorLine} │`,
    `│ ${treeLines[1]} │                                │`,
    `│ ${treeLines[2]} │                                │`,
    "├──────────────────────┴────────────────────────────────┤",
    overlayLine,
    `│ Status: NORMAL | File: ${statusFile}`.slice(0, 56).padEnd(56, " ") + "│",
    "└───────────────────────────────────────────────────────┘"
  ].join("\n");
}

function renderTreeLines(entries: TreeEntry[] | undefined, highlightedIndex: number, workspaceRoots: string[], focusedRegion: "tree" | "editor"): string[] {
  const fallbackLabel = workspaceRoots.length > 0 ? workspaceRoots[0] : "<no workspace>";
  const fallback = `${focusedRegion === "tree" ? ">" : " "} ${fallbackLabel}`;
  const source = entries && entries.length > 0 ? entries : [{ label: fallback, depth: 0, kind: "directory", expanded: true, path: fallback } as TreeEntry];

  return [0, 1, 2].map((slot) => {
    const entry = source[slot];
    if (!entry) {
      return " ".repeat(20);
    }
    const highlight = slot === highlightedIndex ? ">" : " ";
    const icon = entry.kind === "directory" ? (entry.expanded ? "▾" : "▸") : " ";
    const indent = " ".repeat(Math.min(entry.depth * 2, 4));
    return `${highlight}${indent}${icon} ${entry.label}`.slice(0, 20).padEnd(20, " ");
  });
}

function renderOverlayLine(mode: OverlayMode, query: string, results: SearchResult[]): string {
  if (mode === "palette") {
    return "│ Palette: type a command                                  │";
  }

  if (mode === "quickOpen") {
    const first = results[0]?.label ?? "<no matches>";
    return `│ Quick Open: ${query} -> ${first}`.slice(0, 56).padEnd(56, " ") + "│";
  }

  return "│ Palette: <closed> | Ctrl+O quick open | Ctrl+P commands │";
}
