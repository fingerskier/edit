import type { EventBus } from './event-bus.js';
import type { FileSystem } from './file-system.js';
import type { Workspace } from './workspace.js';
import type { CommandRegistry, KeybindingRegistry, ServiceRegistry } from './registries.js';
import type { Slot, ViewProvider, ContributeOptions } from './view.js';
import type { StatusBarApi } from './status-bar.js';
import type { Disposable } from './disposable.js';

export interface PluginContext {
  commands: CommandRegistry;
  keys: KeybindingRegistry;
  view: {
    contribute(slot: Slot, provider: ViewProvider, opts?: ContributeOptions): Disposable;
    invalidate(): void;
  };
  events: EventBus;
  workspace: Workspace;
  fs: FileSystem;
  config: Record<string, any>;
  services: ServiceRegistry;
  statusBar: StatusBarApi;
  subscriptions: Disposable[];
}

export interface Plugin {
  name: string;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export class PluginHost {
  private active: { plugin: Plugin; ctx: PluginContext }[] = [];

  constructor(private ctxFor: (plugin: Plugin) => PluginContext) {}

  async activateAll(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      const ctx = this.ctxFor(plugin);
      await plugin.activate(ctx);
      this.active.push({ plugin, ctx });
    }
  }

  async deactivateAll(): Promise<void> {
    for (const { plugin, ctx } of [...this.active].reverse()) {
      try {
        await plugin.deactivate?.();
      } catch (err) {
        console.error(`[PluginHost] ${plugin.name} deactivate threw:`, err);
      }
      for (const sub of [...ctx.subscriptions].reverse()) {
        try {
          sub.dispose();
        } catch (err) {
          console.error(`[PluginHost] ${plugin.name} subscription dispose threw:`, err);
        }
      }
    }
    this.active = [];
  }
}
