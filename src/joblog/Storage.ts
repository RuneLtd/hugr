
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, access, appendFile, rename, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import type { JobId, MessageId } from '../types/joblog.js';

export interface JsonlStorageOptions {
  directory: string;
}

export class JsonlStorage {
  private readonly directory: string;
  private initialized = false;

  constructor(options: JsonlStorageOptions) {
    this.directory = options.directory;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.directory, { recursive: true });
    this.initialized = true;
  }

  getPath(filename: string): string {
    return join(this.directory, filename);
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await access(this.getPath(filename));
      return true;
    } catch {
      return false;
    }
  }

  async append<T>(filename: string, entry: T): Promise<void> {
    await this.initialize();
    const path = this.getPath(filename);
    const line = JSON.stringify(entry, this.jsonReplacer) + '\n';
    await appendFile(path, line, 'utf-8');
  }

  async appendBatch<T>(filename: string, entries: T[]): Promise<void> {
    if (entries.length === 0) return;
    await this.initialize();
    const path = this.getPath(filename);
    const lines = entries.map((e) => JSON.stringify(e, this.jsonReplacer)).join('\n') + '\n';
    await appendFile(path, lines, 'utf-8');
  }

  async readAll<T>(filename: string): Promise<T[]> {
    await this.initialize();
    const path = this.getPath(filename);

    if (!(await this.exists(filename))) {
      return [];
    }

    const entries: T[] = [];
    const fileStream = createReadStream(path, { encoding: 'utf-8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          entries.push(JSON.parse(line, this.jsonReviver));
        } catch {
          console.warn(`Skipping corrupt JSONL line: ${line.substring(0, 100)}...`);
        }
      }
    }

    return entries;
  }

  async *stream<T>(filename: string): AsyncIterable<T> {
    await this.initialize();
    const path = this.getPath(filename);

    if (!(await this.exists(filename))) {
      return;
    }

    const fileStream = createReadStream(path, { encoding: 'utf-8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          yield JSON.parse(line, this.jsonReviver);
        } catch {
          console.warn(`[Storage.stream] Skipping corrupt JSONL line: ${line.substring(0, 100)}...`);
        }
      }
    }
  }

  async readLatest<T extends { id: string }>(filename: string): Promise<Map<string, T>> {
    const entries = await this.readAll<T>(filename);
    const map = new Map<string, T>();

    for (const entry of entries) {
      map.set(entry.id, entry);
    }

    return map;
  }

  async compact<T extends { id: string }>(filename: string): Promise<number> {
    const latest = await this.readLatest<T>(filename);

    if (latest.size === 0) return 0;

    const path = this.getPath(filename);

    const tempPath = `${path}.tmp.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const entries = Array.from(latest.values());
    const content = entries.map((e) => JSON.stringify(e, this.jsonReplacer)).join('\n') + '\n';

    await mkdir(dirname(tempPath), { recursive: true });

    const writeStream = createWriteStream(tempPath, { encoding: 'utf-8' });
    await new Promise<void>((resolve, reject) => {
      writeStream.write(content, (err) => {
        if (err) reject(err);
        else {
          writeStream.end(resolve);
        }
      });
    });

    try {
      await rename(tempPath, path);
    } catch (error: unknown) {

      try { await unlink(tempPath); } catch {  }

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return entries.length;
      throw error;
    }
    return entries.length;
  }

  async delete(filename: string): Promise<void> {
    const path = this.getPath(filename);
    try {
      await unlink(path);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private jsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    return value;
  }

  private jsonReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && '__type' in value) {
      const obj = value as { __type: string; value: string };
      if (obj.__type === 'Date') {
        return new Date(obj.value);
      }
    }
    return value;
  }
}

export function generateId(prefix: 'job'): JobId;
export function generateId(prefix: 'msg'): MessageId;
export function generateId(prefix: string): string;
export function generateId(prefix: string = 'id'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}` as any;
}
