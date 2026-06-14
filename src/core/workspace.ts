import type { EventBus } from './event-bus.js';
import type { FileSystem } from './file-system.js';
import type { EditOp } from './buffer.js';
import type { Selection, Document } from './document.js';
import { DocumentSet } from './document-set.js';

export class Workspace {
  readonly roots: string[];
  private docs = new DocumentSet();

  constructor(private bus: EventBus, private fs: FileSystem, roots: string[] = []) {
    this.roots = roots;
  }

  get activeDocument(): Document | null { return this.docs.active; }
  list(): Document[] { return this.docs.list(); }
  getDocument(id: string): Document | undefined { return this.docs.get(id); }

  async openFile(path: string): Promise<Document> {
    const existing = this.list().find((d) => d.path === path);
    if (existing) {
      this.docs.setActive(existing.id);
      this.bus.emit('document:activated', { docId: existing.id });
      return existing;
    }
    const content = await this.fs.read(path);
    const doc = this.docs.add(path, content);
    this.bus.emit('document:opened', { docId: doc.id, path });
    this.docs.setActive(doc.id);
    this.bus.emit('document:activated', { docId: doc.id });
    return doc;
  }

  openScratch(initial = ''): Document {
    const doc = this.docs.add(null, initial);
    this.bus.emit('document:opened', { docId: doc.id, path: null });
    this.docs.setActive(doc.id);
    this.bus.emit('document:activated', { docId: doc.id });
    return doc;
  }

  setActive(id: string): void {
    if (!this.docs.get(id)) return;
    this.docs.setActive(id);
    this.bus.emit('document:activated', { docId: id });
  }

  closeDocument(id: string): void {
    if (!this.docs.get(id)) return;
    this.docs.close(id);
    this.bus.emit('document:closed', { docId: id });
    const active = this.docs.active;
    if (active) this.bus.emit('document:activated', { docId: active.id });
  }

  applyEdit(op: EditOp): EditOp {
    const doc = this.requireActive();
    const selBefore = { ...doc.selection };
    const inverse = doc.apply(op);
    this.bus.emit('document:changed', { docId: doc.id, op, inverse, selBefore });
    return inverse;
  }

  setSelection(sel: Selection): void {
    const doc = this.requireActive();
    doc.setSelection(sel);
    this.bus.emit('selection:moved', { docId: doc.id, selection: doc.selection });
  }

  async save(): Promise<void> {
    const doc = this.requireActive();
    if (doc.path === null) throw new Error('cannot save scratch document without a path');
    await this.fs.write(doc.path, doc.text());
    doc.markClean();
    this.bus.emit('document:saved', { docId: doc.id, path: doc.path });
  }

  private requireActive(): Document {
    const doc = this.docs.active;
    if (!doc) throw new Error('no active document');
    return doc;
  }
}
