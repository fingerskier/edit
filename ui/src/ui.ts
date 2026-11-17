// Small DOM pieces shared across the workbench: toasts, context menu, escaping.

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export type ToastKind = 'info' | 'warn' | 'error';

export function toast(message: string, kind: ToastKind = 'info'): void {
  const host = document.getElementById('toasts')!;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.append(el);
  if (kind === 'error') console.error('[fedit]', message);
  setTimeout(() => el.remove(), kind === 'info' ? 3500 : 7000);
  el.addEventListener('click', () => el.remove());
}

/** Error text from a rejected backend call (Tauri rejects with a plain string). */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface MenuItem {
  label?: string;
  run?: () => void;
  separator?: boolean;
}

export function showMenu(x: number, y: number, items: MenuItem[]): void {
  document.querySelector('.menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu';
  for (const item of items) {
    const el = document.createElement('div');
    if (item.separator) {
      el.className = 'menu-sep';
    } else {
      el.className = 'menu-item';
      el.textContent = item.label ?? '';
      el.addEventListener('click', () => {
        close();
        item.run?.();
      });
    }
    menu.append(el);
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))}px`;

  const onDown = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  function close() {
    menu.remove();
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
  }
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
}
