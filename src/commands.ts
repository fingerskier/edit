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
  registry.register("tree.focus", () => {});
  registry.register("editor.focus", () => {});
  return registry;
}
