import type { EventBus } from './event-bus.js';
import type { FileSystem } from './file-system.js';
import type { Workspace } from './workspace.js';
import type { CommandRegistry, KeybindingRegistry, ServiceRegistry } from './registries.js';
import type { Slot, ViewProvider } from './view.js';

export interface PluginContext {
  commands: CommandRegistry;
  keys: KeybindingRegistry;
  view: { contribute(slot: Slot, provider: ViewProvider): void; invalidate(): void };
  events: EventBus;
  workspace: Workspace;
  fs: FileSystem;
  config: Record<string, any>;
  services: ServiceRegistry;
}

export interface Plugin {
  name: string;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export class PluginHost {
  private active: Plugin[] = [];

  constructor(private ctxFor: (plugin: Plugin) => PluginContext) {}

  async activateAll(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      await plugin.activate(this.ctxFor(plugin));
      this.active.push(plugin);
    }
  }

  async deactivateAll(): Promise<void> {
    for (const plugin of [...this.active].reverse()) {
      await plugin.deactivate?.();
    }
    this.active = [];
  }
}
