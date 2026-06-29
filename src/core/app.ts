import { EventBus } from './event-bus.js';
import { FileSystem } from './file-system.js';
import { Watcher } from './watcher.js';
import { Workspace } from './workspace.js';
import { CommandRegistry, KeybindingRegistry, ServiceRegistry } from './registries.js';
import { ViewRegistry, ViewComposer } from './view.js';
import { StatusBarRegistry } from './status-bar.js';
import { PluginHost, type Plugin, type PluginContext } from './plugin-host.js';
import type { Adapter } from './adapter.js';

export interface AppOptions {
  adapter: Adapter;
  plugins: Plugin[];
  roots: string[];
  config?: Record<string, Record<string, any>>;
}

export interface App {
  bus: EventBus;
  workspace: Workspace;
  commands: CommandRegistry;
  keys: KeybindingRegistry;
  render(): void;
  dispose(): Promise<void>;
}

export async function createApp(options: AppOptions): Promise<App> {
  const { adapter, plugins, roots, config = {} } = options;

  const bus = new EventBus();
  const fs = new FileSystem();
  const watcher = new Watcher(bus);
  const workspace = new Workspace(bus, fs, roots);
  const commands = new CommandRegistry();
  const keys = new KeybindingRegistry();
  const services = new ServiceRegistry();
  const views = new ViewRegistry();
  const composer = new ViewComposer(views);
  const statusBar = new StatusBarRegistry();

  for (const root of roots) watcher.watch(root);

  const render = () => adapter.render(composer.compose());

  // One internal provider renders the aggregated status-bar items as the single
  // `status` slot. Plugins contribute via ctx.statusBar.createItem(...) rather
  // than owning the slot, so many of them can compose into the bar at once. The
  // slot is omitted while no item has visible text (preserves prior behaviour
  // for apps without a status plugin).
  views.contribute('status', () => {
    const segments = statusBar.segments();
    return segments.length > 0 ? { kind: 'status', segments } : null;
  });
  statusBar.onDidChange(render);

  const ctxFor = (plugin: Plugin): PluginContext => ({
    commands,
    keys,
    view: {
      contribute: (slot, provider, opts) => views.contribute(slot, provider, opts),
      invalidate: render,
    },
    events: bus,
    workspace,
    fs,
    config: config[plugin.name] ?? {},
    services,
    statusBar,
    subscriptions: [],
  });

  const host = new PluginHost(ctxFor);

  // The core does not dispatch keys itself. It forwards raw keys onto the bus as a
  // past-tense 'key' fact; the keymap plugin owns resolution, focus/mode routing,
  // passing the key to the command, and command-error handling.
  adapter.onKey((key) => {
    bus.emit('key', { key });
  });

  await host.activateAll(plugins);
  render();

  return {
    bus,
    workspace,
    commands,
    keys,
    render,
    async dispose() {
      await host.deactivateAll();
      watcher.close();
      adapter.dispose();
    },
  };
}
