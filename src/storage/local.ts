import { readFile, writeFile, unlink, access, appendFile, readdir, mkdir as fsMkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { StorageProvider } from './types.js';

export interface LocalStorageConfig {
    baseDir?: string;
}

export class LocalStorageProvider implements StorageProvider {
    private baseDir: string;

    constructor(config?: LocalStorageConfig) {
        this.baseDir = config?.baseDir || join(homedir(), '.hugr');
    }

    async read(key: string): Promise<string | null> {
        try {
            return await readFile(this.resolve(key), 'utf-8');
        } catch {
            return null;
        }
    }

    async write(key: string, data: string): Promise<void> {
        const path = this.resolve(key);
        await fsMkdir(dirname(path), { recursive: true });
        await writeFile(path, data, 'utf-8');
    }

    async delete(key: string): Promise<void> {
        try {
            await unlink(this.resolve(key));
        } catch {}
    }

    async exists(key: string): Promise<boolean> {
        try {
            await access(this.resolve(key));
            return true;
        } catch {
            return false;
        }
    }

    async list(prefix: string): Promise<string[]> {
        try {
            const dir = this.resolve(prefix);
            const entries = await readdir(dir);
            return entries.map(e => join(prefix, e));
        } catch {
            return [];
        }
    }

    async append(key: string, line: string): Promise<void> {
        const path = this.resolve(key);
        await fsMkdir(dirname(path), { recursive: true });
        await appendFile(path, line + '\n');
    }

    async readLines(key: string): Promise<string[]> {
        const content = await this.read(key);
        if (!content) return [];
        return content.split('\n').filter(l => l.trim());
    }

    resolvePath(...segments: string[]): string {
        return join(this.baseDir, ...segments);
    }

    async mkdir(path: string): Promise<void> {
        await fsMkdir(path, { recursive: true });
    }

    private resolve(key: string): string {
        return join(this.baseDir, key);
    }
}
