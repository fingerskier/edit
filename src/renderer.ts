export function renderShellFrame(workspaceRoots: string[] = []): string {
  const leftLabel = workspaceRoots.length > 0 ? workspaceRoots[0] : "<no workspace>";
  const extraRoots = workspaceRoots.length > 1 ? ` (+${workspaceRoots.length - 1})` : "";
  const treeLine = `${leftLabel}${extraRoots}`.slice(0, 20).padEnd(20, " ");

  return [
    "┌──────── Tree ────────┬──────────── Editor ────────────┐",
    `│ ${treeLine} │ <open file to start>           │`,
    "│                      │                                │",
    "├──────────────────────┴────────────────────────────────┤",
    "│ Status: NORMAL | File: <none> | Ln 1, Col 1 | clean  │",
    "└───────────────────────────────────────────────────────┘"
  ].join("\n");
}
