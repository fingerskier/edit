import process from "node:process";
import { createDefaultCommandRegistry, type CommandRegistry } from "./commands.js";
import { renderShellFrame } from "./renderer.js";

export type FocusRegion = "tree" | "editor";

export type AppState = {
  workspaceRoots: string[];
  running: boolean;
  focusedRegion: FocusRegion;
  paletteOpen: boolean;
};

export class EditorApp {
  readonly state: AppState;
  readonly commands: CommandRegistry;
  private input?: NodeJS.ReadStream;
  private output?: NodeJS.WriteStream;
  private renderTimer?: NodeJS.Timeout;
  private rawModeEnabled = false;

  constructor(workspaceRoots: string[]) {
    this.state = {
      workspaceRoots,
      running: false,
      focusedRegion: "editor",
      paletteOpen: false
    };

    this.commands = createDefaultCommandRegistry(() => this.shutdown());
    this.commands.register("palette.open", () => {
      this.state.paletteOpen = true;
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

    this.render();
    this.renderTimer = setInterval(() => this.render(), 1000);
  }

  handleInput(data: string): boolean {
    if (data === "q" || data === "\u0003") {
      return this.commands.execute("app.quit");
    }

    if (data === "p") {
      return this.commands.execute("palette.open");
    }

    if (data === "t") {
      return this.commands.execute("tree.focus");
    }

    if (data === "e") {
      return this.commands.execute("editor.focus");
    }

    return false;
  }

  renderFrame(): string {
    return renderShellFrame({
      workspaceRoots: this.state.workspaceRoots,
      focusedRegion: this.state.focusedRegion,
      paletteOpen: this.state.paletteOpen
    });
  }

  render(): void {
    this.output?.write(`\x1b[H\x1b[2J${this.renderFrame()}\n`);
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

    if (this.output?.isTTY) {
      this.output.write("\x1b[?25h\x1b[?1049l");
    }
  }

  private readonly onInput = (chunk: Buffer | string): void => {
    this.handleInput(String(chunk));
  };
}
