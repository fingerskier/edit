import fs from "node:fs";
import path from "node:path";

export type TreeEntry = {
  path: string;
  label: string;
  depth: number;
  kind: "file" | "directory";
  expanded: boolean;
};

export type SearchResult = {
  path: string;
  label: string;
  score: number;
};

export class WorkspaceTree {
  private readonly expanded = new Set<string>();
  highlightedIndex = 0;
  selectedFile?: string;

  constructor(readonly roots: string[]) {
    for (const root of roots) {
      this.expanded.add(root);
    }
  }

  visibleEntries(): TreeEntry[] {
    const entries: TreeEntry[] = [];
    for (const root of this.roots) {
      this.collectVisible(root, 0, entries);
    }
    return entries;
  }

  highlightedEntry(): TreeEntry | undefined {
    return this.visibleEntries()[this.highlightedIndex];
  }

  moveHighlight(delta: number): void {
    const entries = this.visibleEntries();
    if (entries.length === 0) {
      this.highlightedIndex = 0;
      return;
    }
    this.highlightedIndex = Math.max(0, Math.min(entries.length - 1, this.highlightedIndex + delta));
  }

  expandHighlighted(): void {
    const entry = this.highlightedEntry();
    if (entry?.kind === "directory") {
      this.expanded.add(entry.path);
    }
  }

  collapseHighlighted(): void {
    const entry = this.highlightedEntry();
    if (!entry) {
      return;
    }

    if (entry.kind === "directory" && this.expanded.has(entry.path)) {
      this.expanded.delete(entry.path);
      return;
    }

    const parent = path.dirname(entry.path);
    const entries = this.visibleEntries();
    const parentIndex = entries.findIndex((candidate) => candidate.path === parent);
    if (parentIndex >= 0) {
      this.highlightedIndex = parentIndex;
    }
  }

  selectHighlighted(): string | undefined {
    const entry = this.highlightedEntry();
    if (!entry) {
      return undefined;
    }

    if (entry.kind === "directory") {
      this.expanded.has(entry.path) ? this.expanded.delete(entry.path) : this.expanded.add(entry.path);
      return undefined;
    }

    this.selectedFile = entry.path;
    return entry.path;
  }

  searchFiles(query: string, limit = 8): SearchResult[] {
    const results: SearchResult[] = [];
    for (const file of this.allFiles()) {
      const relative = this.relativeLabel(file);
      const score = fuzzyScore(query, relative);
      if (score > 0) {
        results.push({ path: file, label: relative, score });
      }
    }
    return results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
  }

  private collectVisible(candidate: string, depth: number, entries: TreeEntry[]): void {
    const stat = safeStat(candidate);
    if (!stat) {
      return;
    }

    const kind = stat.isDirectory() ? "directory" : "file";
    entries.push({
      path: candidate,
      label: depth === 0 ? candidate : path.basename(candidate),
      depth,
      kind,
      expanded: kind === "directory" && this.expanded.has(candidate)
    });

    if (kind !== "directory" || !this.expanded.has(candidate)) {
      return;
    }

    for (const child of sortedChildren(candidate)) {
      this.collectVisible(child, depth + 1, entries);
    }
  }

  private allFiles(): string[] {
    const files: string[] = [];
    for (const root of this.roots) {
      collectFiles(root, files);
    }
    return files;
  }

  private relativeLabel(file: string): string {
    for (const root of this.roots) {
      const relative = path.relative(root, file);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return relative;
      }
    }
    return file;
  }
}

function sortedChildren(directory: string): string[] {
  try {
    return fs.readdirSync(directory)
      .map((name) => path.join(directory, name))
      .sort((a, b) => {
        const aStat = safeStat(a);
        const bStat = safeStat(b);
        const aDirectory = aStat?.isDirectory() ?? false;
        const bDirectory = bStat?.isDirectory() ?? false;
        if (aDirectory !== bDirectory) {
          return aDirectory ? -1 : 1;
        }
        return path.basename(a).localeCompare(path.basename(b));
      });
  } catch {
    return [];
  }
}

function collectFiles(candidate: string, files: string[]): void {
  const stat = safeStat(candidate);
  if (!stat) {
    return;
  }
  if (stat.isFile()) {
    files.push(candidate);
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const child of sortedChildren(candidate)) {
    collectFiles(child, files);
  }
}

function safeStat(candidate: string): fs.Stats | undefined {
  try {
    return fs.statSync(candidate);
  } catch {
    return undefined;
  }
}

export function fuzzyScore(query: string, candidate: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 1;
  }

  const normalizedCandidate = candidate.toLowerCase();
  let score = 0;
  let cursor = 0;
  for (const char of normalizedQuery) {
    const index = normalizedCandidate.indexOf(char, cursor);
    if (index < 0) {
      return 0;
    }
    score += index === cursor ? 4 : 1;
    if (index === 0 || "/\\-_ .".includes(normalizedCandidate[index - 1] ?? "")) {
      score += 3;
    }
    cursor = index + 1;
  }

  if (normalizedCandidate.includes(normalizedQuery)) {
    score += 10;
  }
  return score - normalizedCandidate.length / 1000;
}
