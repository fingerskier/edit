import type { Disposer } from './events.ts';

export interface Command {
  id: string;
  /** Shown in the command palette. Commands without a title are hidden from it. */
  title?: string;
  /** Return `false` to report "not handled", letting the key fall through. */
  run: (args?: any) => unknown;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(id: string, run: Command['run'], title?: string): Disposer {
    const command = { id, run, title };
    this.commands.set(id, command);
    return () => {
      if (this.commands.get(id) === command) this.commands.delete(id);
    };
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  /** Run a command. Rejects when the id is unknown. */
  async execute(id: string, args?: unknown): Promise<unknown> {
    const command = this.commands.get(id);
    if (!command) throw new Error(`Unknown command: ${id}`);
    return command.run(args);
  }

  /** Run synchronously where possible, so a key handler can see a `false` result. */
  executeSync(id: string, args?: unknown): unknown {
    const command = this.commands.get(id);
    if (!command) throw new Error(`Unknown command: ${id}`);
    return command.run(args);
  }
}
