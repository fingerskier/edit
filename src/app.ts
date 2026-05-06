import process from "node:process";
import { createDefaultCommandRegistry, type CommandRegistry } from "./commands.js";
import { Keymap } from "./keymap.js";
import { renderShellFrame } from "./renderer.js";
import { WorkspaceTree, type SearchResult } from "./workspace.js";

export type FocusRegion = "tree" | "editor";
export type OverlayMode = "none" | "palette" | "quickOpen";

export type AppState = {
  workspaceRoots: string[];
  running: boolean;
  focusedRegion: FocusRegion;
  overlayMode: OverlayMode;
  quickOpenQuery: string;
  quickOpenResults: SearchResult[];
  currentFile?: string;
};

export class EditorApp {
  readonly state: AppState;
  readonly commands: CommandRegistry;
  readonly keymap: Keymap;
  readonly tree: WorkspaceTree;
  private input?: NodeJS.ReadStream;
  private output?: NodeJS.WriteStream;
  private renderTimer?: NodeJS.Timeout;
  private rawModeEnabled = false;

  constructor(workspaceRoots: string[], keybindings: Record<string, string> = {}) {
    this.tree = new WorkspaceTree(workspaceRoots);
    this.keymap = new Keymap(keybindings);
    this.state = {
      workspaceRoots,
      running: false,
      focusedRegion: "editor",
      overlayMode: "none",
      quickOpenQuery: "",
      quickOpenResults: []
    };

    this.commands = createDefaultCommandRegistry(() => this.shutdown());
    this.commands.register("palette.open", () => {
      this.state.overlayMode = "palette";
      this.render();
    });
    this.commands.register("quickOpen.open", () => {
      this.state.overlayMode = "quickOpen";
      this.state.quickOpenQuery = "";
      this.state.quickOpenResults = this.tree.searchFiles("");
      this.render();
    });
    this.commands.register("tree.focus", () => {
      this.state.focusedRegion = "tree";
      this.render();
    });
    this.commands.register("editor.focus", () => {
      this.state.focusedRegion = "editor";
      this.render();
    });
    this.commands.register("tree.navigate.up", () => {
      this.state.focusedRegion = "tree";
      this.tree.moveHighlight(-1);
      this.render();
    });
    this.commands.register("tree.navigate.down", () => {
      this.state.focusedRegion = "tree";
      this.tree.moveHighlight(1);
      this.render();
    });
    this.commands.register("tree.collapse", () => {
      this.state.focusedRegion = "tree";
      this.tree.collapseHighlighted();
      this.render();
    });
    this.commands.register("tree.expand", () => {
      this.state.focusedRegion = "tree";
      const highlighted = this.tree.highlightedEntry();
      if (highlighted?.kind === "file") {
        const selected = this.tree.selectHighlighted();
        if (selected) {
          this.state.currentFile = selected;
          this.state.focusedRegion = "editor";
        }
      } else {
        this.tree.expandHighlighted();
      }
      this.render();
    });
    this.commands.register("tree.select", () => {
      this.state.focusedRegion = "tree";
      const selected = this.tree.selectHighlighted();
      if (selected) {
        this.state.currentFile = selected;
        this.state.focusedRegion = "editor";
      }
      this.render();
    });
  }

  init(input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stdout): void {
    this.input = input;
    this.output = output;
    this.state.running = true;
  }

  start(): void {
    if (!this.input || !this.output) {
      this.init();
    }

    if (!this.input?.isTTY || !this.output?.isTTY) {
      this.render();
      this.shutdown();
      return;
    }

    this.output.write("\x1b[?1049h\x1b[?25l");
    if (typeof this.input.setRawMode === "function") {
      this.input.setRawMode(true);
      this.rawModeEnabled = true;
    }
    this.input.resume();
    this.input.setEncoding("utf8");
    this.input.on("data", this.onInput);
    process.on("SIGWINCH", this.onResize);

    this.render();
    this.renderTimer = setInterval(() => this.render(), 1000);
  }

  handleInput(data: string): boolean {
    if (this.handleOverlayInput(data)) {
      return true;
    }

    const command = this.keymap.commandForInput(data);
    return command ? this.commands.execute(command) : false;
  }

  renderFrame(): string {
    return renderShellFrame({
      workspaceRoots: this.state.workspaceRoots,
      focusedRegion: this.state.focusedRegion,
      overlayMode: this.state.overlayMode,
      currentFile: this.state.currentFile,
      treeEntries: this.tree.visibleEntries(),
      highlightedTreeIndex: this.tree.highlightedIndex,
      quickOpenQuery: this.state.quickOpenQuery,
      quickOpenResults: this.state.quickOpenResults,
      terminalSize: this.terminalSize()
    });
  }

  render(): void {
    this.output?.write(`\x1b[H\x1b[2J${this.renderFrame()}`);
  }

  shutdown(): void {
    if (!this.state.running) {
      return;
    }

    this.state.running = false;
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = undefined;
    }

    if (this.input) {
      this.input.off("data", this.onInput);
      if (this.rawModeEnabled && typeof this.input.setRawMode === "function") {
        this.input.setRawMode(false);
      }
      this.rawModeEnabled = false;
      this.input.pause();
    }
    process.off("SIGWINCH", this.onResize);

    if (this.output?.isTTY) {
      this.output.write("\x1b[?25h\x1b[?1049l");
    }
  }

  private handleOverlayInput(data: string): boolean {
    if (this.state.overlayMode === "none") {
      return false;
    }

    if (data === "\u001b") {
      this.state.overlayMode = "none";
      this.render();
      return true;
    }

    if (this.state.overlayMode === "quickOpen") {
      if (data === "\r" || data === "\n") {
        const selected = this.state.quickOpenResults[0];
        if (selected) {
          this.state.currentFile = selected.path;
        }
        this.state.overlayMode = "none";
        this.render();
        return true;
      }

      if (data === "\u007f") {
        this.state.quickOpenQuery = this.state.quickOpenQuery.slice(0, -1);
        this.state.quickOpenResults = this.tree.searchFiles(this.state.quickOpenQuery);
        this.render();
        return true;
      }

      if (data.length === 1 && data >= " " && data <= "~") {
        this.state.quickOpenQuery += data;
        this.state.quickOpenResults = this.tree.searchFiles(this.state.quickOpenQuery);
        this.render();
        return true;
      }
    }

    return false;
  }

  private terminalSize(): { columns: number; rows: number } {
    return {
      columns: this.output?.columns ?? process.stdout.columns ?? 80,
      rows: this.output?.rows ?? process.stdout.rows ?? 24
    };
  }

  private readonly onResize = (): void => {
    this.render();
  };

  private readonly onInput = (chunk: Buffer | string): void => {
    this.handleInput(String(chunk));
  };
}
