export type RenderOptions = {
  workspaceRoots?: string[];
  focusedRegion?: "tree" | "editor";
  paletteOpen?: boolean;
};

export function renderShellFrame(options: RenderOptions | string[] = {}): string {
  const normalized: RenderOptions = Array.isArray(options) ? { workspaceRoots: options } : options;
  const workspaceRoots = normalized.workspaceRoots ?? [];
  const focusedRegion = normalized.focusedRegion ?? "editor";
  const paletteOpen = normalized.paletteOpen ?? false;

  const leftLabel = workspaceRoots.length > 0 ? workspaceRoots[0] : "<no workspace>";
  const extraRoots = workspaceRoots.length > 1 ? ` (+${workspaceRoots.length - 1})` : "";
  const treeLine = `${focusedRegion === "tree" ? ">" : " "} ${leftLabel}${extraRoots}`.slice(0, 20).padEnd(20, " ");
  const editorLine = `${focusedRegion === "editor" ? ">" : " "} <open file to start>`.slice(0, 30).padEnd(30, " ");
  const paletteLine = paletteOpen ? "│ Palette: type a command                                  │" : "│ Palette: <closed>                                        │";

  return [
    "┌──────── Tree ────────┬──────────── Editor ────────────┐",
    `│ ${treeLine} │ ${editorLine} │`,
    "│                      │                                │",
    "├──────────────────────┴────────────────────────────────┤",
    paletteLine,
    "│ Status: NORMAL | File: <none> | Ln 1, Col 1 | clean  │",
    "└───────────────────────────────────────────────────────┘"
  ].join("\n");
}
