// src/plugins/save.ts
import type { Plugin, PluginContext } from '../core/plugin-host.js';

const save: Plugin = {
  name: 'save',

  activate(ctx: PluginContext): void {
    // file.save: persist the active document. No-op (do NOT throw) when there is
    // no active document or it is a scratch buffer (path === null) with nowhere
    // to write — Workspace.save() itself throws on a path-less doc, so the guard
    // is required. Otherwise delegate to the workspace (writes + markClean()).
    ctx.subscriptions.push(
      ctx.commands.register(
        'file.save',
        async () => {
          const doc = ctx.workspace.activeDocument;
          if (!doc || doc.path === null) return;
          await ctx.workspace.save();
        },
        { title: 'Save File' },
      ),
    );

    ctx.subscriptions.push(ctx.keys.bind('editor:ctrl+s', 'file.save'));

    // Optional autosave. Only arm a timer when autosaveMs is a positive number;
    // each tick just runs the file.save command (which itself no-ops on scratch
    // / no active doc), so autosave is safe regardless of what is focused.
    const autosaveMs = ctx.config.autosaveMs;
    if (typeof autosaveMs === 'number' && autosaveMs > 0) {
      const timer = setInterval(() => {
        void ctx.commands.run('file.save').catch((err) => {
          console.error('[save] autosave failed:', err);
        });
      }, autosaveMs);
      ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
    }
  },
};

export default save;
