export type CommandHandler = (args: any) => any | Promise<any>;

export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();

  register(id: string, handler: CommandHandler): void {
    this.handlers.set(id, handler);
  }

  ids(): string[] { return [...this.handlers.keys()]; }

  async run(id: string, args?: any): Promise<any> {
    const handler = this.handlers.get(id);
    if (!handler) throw new Error(`unknown command: ${id}`);
    return await handler(args);
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
