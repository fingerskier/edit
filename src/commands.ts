export type CommandHandler = () => void;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandHandler>();

  register(id: string, handler: CommandHandler): void {
    this.commands.set(id, handler);
  }

  execute(id: string): boolean {
    const handler = this.commands.get(id);
    if (!handler) {
      return false;
    }

    handler();
    return true;
  }

  list(): string[] {
    return [...this.commands.keys()].sort();
  }
}

export function createDefaultCommandRegistry(quit: () => void): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register("app.quit", quit);
  registry.register("palette.open", () => {});
  registry.register("quickOpen.open", () => {});
  registry.register("tree.focus", () => {});
  registry.register("tree.navigate.up", () => {});
  registry.register("tree.navigate.down", () => {});
  registry.register("tree.collapse", () => {});
  registry.register("tree.expand", () => {});
  registry.register("tree.select", () => {});
  registry.register("editor.focus", () => {});
  registry.register("editor.navigate.up", () => {});
  registry.register("editor.navigate.down", () => {});
  registry.register("editor.navigate.left", () => {});
  registry.register("editor.navigate.right", () => {});
  registry.register("editor.save", () => {});
  registry.register("editor.undo", () => {});
  registry.register("editor.redo", () => {});
  return registry;
}
