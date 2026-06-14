import type { Disposable } from './disposable.js';

export type CommandHandler = (args: any) => any | Promise<any>;

export interface CommandMeta {
  title?: string;
}

interface CommandEntry {
  handler: CommandHandler;
  meta: CommandMeta;
}

export class CommandRegistry {
  private commands = new Map<string, CommandEntry>();

  register(id: string, handler: CommandHandler, meta: CommandMeta = {}): Disposable {
    const entry: CommandEntry = { handler, meta };
    this.commands.set(id, entry);
    return {
      dispose: () => {
        if (this.commands.get(id) === entry) this.commands.delete(id);
      },
    };
  }

  ids(): string[] {
    return [...this.commands.keys()];
  }

  list(): Array<{ id: string } & CommandMeta> {
    return [...this.commands.entries()].map(([id, entry]) => ({ id, ...entry.meta }));
  }

  async run(id: string, args?: any): Promise<any> {
    const entry = this.commands.get(id);
    if (!entry) throw new Error(`unknown command: ${id}`);
    return await entry.handler(args);
  }
}

export class KeybindingRegistry {
  private bindings = new Map<string, string>();

  bind(keySpec: string, commandId: string): void {
    this.bindings.set(keySpec, commandId);
  }

  resolve(keySpec: string): string | undefined {
    return this.bindings.get(keySpec);
  }
}

export class ServiceRegistry {
  private services = new Map<string, unknown>();

  register(name: string, impl: unknown): void {
    this.services.set(name, impl);
  }

  get<T>(name: string): T {
    if (!this.services.has(name)) throw new Error(`unknown service: ${name}`);
    return this.services.get(name) as T;
  }
}
