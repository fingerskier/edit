import type { Plugin, PluginContext } from '../core/plugin-host.js';

// The contract for input ownership: a stack of contexts, base first. The top of
// the stack owns keyboard input. `replace` swaps the BASE context (panel focus);
// `push`/`pop` manage transient overlays (e.g. the command palette).
export interface FocusService {
  push(context: string): void;        // overlays push on top
  pop(expected?: string): void;       // warn+no-op if top() !== expected; never pops the base (index 0)
  replace(context: string): void;     // sets the BASE context (index 0); NO-OP while an overlay is on top
  top(): string;                      // current context that owns input
  stack(): string[];                  // copy of the stack, base first
}

// A key token is "printable" when it is a single Unicode code point at or above
// the space character. Named keys/chords arrive as multi-char tokens ('enter',
// 'ctrl+s', ...) and are therefore not printable. Control chars (e.g. '\n') are
// single code points but below ' ', so they are not printable either.
export function isPrintable(key: string): boolean {
  return [...key].length === 1 && key >= ' ';
}

const keymap: Plugin = {
  name: 'keymap',

  activate(ctx: PluginContext): void {
    const { commands, keys, events, services, subscriptions } = ctx;

    // Seed synchronously so the very first key sees top() === 'editor'.
    const stack: string[] = ['editor'];

    const emitChanged = (): void => {
      events.emit('focus:changed', { context: stack[stack.length - 1] });
    };

    const focus: FocusService = {
      push(context: string): void {
        stack.push(context);
        emitChanged();
      },
      pop(expected?: string): void {
        if (stack.length <= 1) return; // never pop the base
        if (expected !== undefined && stack[stack.length - 1] !== expected) {
          console.warn(
            `[keymap] focus.pop expected "${expected}" but top is "${stack[stack.length - 1]}"; ignoring`,
          );
          return;
        }
        stack.pop();
        emitChanged();
      },
      replace(context: string): void {
        if (stack.length > 1) return; // overlay on top: replacing the base is a no-op
        stack[0] = context;
        emitChanged();
      },
      top(): string {
        return stack[stack.length - 1];
      },
      stack(): string[] {
        return [...stack];
      },
    };

    subscriptions.push(services.register('focus', focus));

    // The ONE key listener. Resolution order: context:key, then global:key, then
    // (printables only) context:<printable>. The command receives { key }. A
    // failing command (sync throw or async rejection) is caught here and logged
    // so it never escapes the synchronous sendKey/emit path.
    subscriptions.push(
      events.on('key', (e: { key: string }) => {
        const key = e.key;
        const context = focus.top();
        const id =
          keys.resolve(`${context}:${key}`) ??
          keys.resolve(`global:${key}`) ??
          (isPrintable(key) ? keys.resolve(`${context}:<printable>`) : undefined);
        if (id) {
          commands
            .run(id, { key })
            .catch((err) => console.error('[keymap] command failed:', id, err));
        }
      }),
    );
  },
};

export default keymap;
