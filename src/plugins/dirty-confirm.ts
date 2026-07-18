// Shared yes/no confirm for discarding unsaved buffers. Uses the reusable
// quickInput picker so quit and close share one UX.

import { basename } from 'node:path';
import type { Document } from '../core/document.js';
import type { QuickInputService, QuickPickItem } from './quick-input.js';

interface ConfirmPick extends QuickPickItem {
  value: boolean;
}

function labelFor(doc: Document): string {
  return doc.path === null ? 'Untitled' : basename(doc.path);
}

/**
 * Ask the user whether to discard dirty documents. Returns true if it is safe
 * to proceed (no dirty docs, or the user chose discard). Returns false if the
 * user cancelled or closed the picker.
 */
export async function confirmDiscardDirty(
  pick: QuickInputService['pick'],
  dirty: Document[],
  title = 'Unsaved changes',
): Promise<boolean> {
  if (dirty.length === 0) return true;
  const names = dirty.map(labelFor).join(', ');
  const items: ConfirmPick[] = [
    { label: `Discard changes to ${names}`, value: true },
    { label: 'Cancel', value: false },
  ];
  const chosen = await pick(items, { title });
  return chosen?.value === true;
}
