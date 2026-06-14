import { Document } from './document.ts';

export class DocumentSet {
  private docs = new Map<string, Document>();
  private activeId: string | null = null;
  private seq = 0;

  get active(): Document | null {
    return this.activeId ? this.docs.get(this.activeId) ?? null : null;
  }

  list(): Document[] { return [...this.docs.values()]; }

  add(path: string | null, initial = ''): Document {
    const id = `doc${++this.seq}`;
    const doc = new Document(id, path, initial);
    this.docs.set(id, doc);
    if (this.activeId === null) this.activeId = id;
    return doc;
  }

  get(id: string): Document | undefined { return this.docs.get(id); }

  setActive(id: string): void {
    if (this.docs.has(id)) this.activeId = id;
  }

  close(id: string): void {
    this.docs.delete(id);
    if (this.activeId === id) {
      const next = this.docs.keys().next();
      this.activeId = next.done ? null : next.value;
    }
  }
}
