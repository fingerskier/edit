import { readFile, writeFile, readdir } from 'node:fs/promises';

export interface DirEntry { name: string; isDir: boolean }

export class FileSystem {
  read(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async write(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf8');
  }

  async list(dir: string): Promise<DirEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
