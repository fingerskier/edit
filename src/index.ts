export { createApp, type App, type AppOptions } from './core/app.js';
export { type Disposable } from './core/disposable.js';
export { EventBus } from './core/event-bus.js';
export { StringBuffer, type TextBuffer, type EditOp } from './core/buffer.js';
export { Document, type Selection } from './core/document.js';
export { DocumentSet } from './core/document-set.js';
export { Workspace } from './core/workspace.js';
export { FileSystem, type DirEntry } from './core/file-system.js';
export { Watcher } from './core/watcher.js';
export {
  CommandRegistry, KeybindingRegistry, ServiceRegistry, type CommandHandler, type CommandMeta,
} from './core/registries.js';
export {
  ViewRegistry, ViewComposer,
  type Slot, type Widget, type ViewModel, type Frame, type ViewProvider,
  type ListItem, type StyleSpan,
} from './core/view.js';
export { type Adapter, type KeyHandler } from './core/adapter.js';
export { HeadlessAdapter } from './adapters/headless.js';
export { PluginHost, type Plugin, type PluginContext } from './core/plugin-host.js';
export { resolvePlugins, type ResolveOptions } from './core/plugin-loader.js';
