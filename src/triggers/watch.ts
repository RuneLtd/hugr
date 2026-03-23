
import { watch, type FSWatcher } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import type { TriggerConfig, TriggerState, TriggerHandler, TriggerCallback, TriggerEvent } from './types.js';

export class WatchTrigger implements TriggerHandler {
    private watchers: FSWatcher[] = [];
    private state: TriggerState;
    private readonly config: TriggerConfig;
    private readonly callback: TriggerCallback;
    private readonly log: (msg: string) => void;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingChanges = new Map<string, string>();
    private readonly debounceMs: number;
    private readonly pattern: RegExp | null;
    private readonly watchEvents: Set<string>;

    constructor(config: TriggerConfig, callback: TriggerCallback, log?: (msg: string) => void) {
        if (!config.watch) {
            throw new Error(`Watch trigger "${config.id}" requires watch config`);
        }
        this.config = config;
        this.callback = callback;
        this.log = log ?? console.log;
        this.debounceMs = config.watch.debounce ?? 500;
        this.pattern = config.watch.pattern ? globToRegex(config.watch.pattern) : null;
        this.watchEvents = new Set(config.watch.events ?? ['create', 'modify']);
        this.state = {
            id: config.id,
            type: 'watch',
            status: 'idle',
            fireCount: 0,
            activeSessions: 0,
        };
    }

    async start(): Promise<void> {
        if (this.watchers.length > 0) return;
        this.state.status = 'active';

        const watchPath = this.config.watch!.path;
        const recursive = this.config.watch!.recursive ?? true;

        try {
            const watcher = watch(watchPath, { recursive }, (eventType, filename) => {
                if (filename) this.handleChange(eventType, filename);
            });

            watcher.on('error', (err) => {
                this.state.lastError = err.message;
                this.log(`  Watch trigger "${this.config.id}" error: ${err.message}`);
            });

            this.watchers.push(watcher);
            this.log(`  Watch trigger "${this.config.id}" monitoring: ${watchPath}`);
        } catch (err) {
            this.state.status = 'error';
            this.state.lastError = err instanceof Error ? err.message : String(err);
            throw err;
        }
    }

    async stop(): Promise<void> {
        for (const watcher of this.watchers) {
            watcher.close();
        }
        this.watchers = [];

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        this.state.status = 'idle';
    }

    getState(): TriggerState {
        return { ...this.state };
    }

    private handleChange(eventType: string, filename: string): void {
        if (this.pattern && !this.pattern.test(filename)) return;

        if (filename.startsWith('.git/') || filename.includes('node_modules/')) return;

        const changeType = eventType === 'rename' ? 'create' : 'modify';
        if (!this.watchEvents.has(changeType)) return;

        this.pendingChanges.set(filename, changeType);

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => this.flush(), this.debounceMs);
    }

    private async flush(): Promise<void> {
        const changes = new Map(this.pendingChanges);
        this.pendingChanges.clear();

        if (changes.size === 0) return;

        if (this.config.cooldown && this.state.lastFired) {
            const elapsed = (Date.now() - this.state.lastFired.getTime()) / 1000;
            if (elapsed < this.config.cooldown) return;
        }

        if (this.config.maxConcurrent && this.state.activeSessions >= this.config.maxConcurrent) {
            return;
        }

        const files = [...changes.entries()].map(([path, action]) => ({ path, action }));

        const event: TriggerEvent = {
            triggerId: this.config.id,
            triggerType: 'watch',
            timestamp: new Date(),
            payload: {
                files,
                fileCount: files.length,
                watchPath: this.config.watch!.path,
                firstFile: files[0]?.path,
            },
            source: this.config.watch!.path,
        };

        this.state.status = 'firing';
        this.state.lastFired = new Date();
        this.state.fireCount++;
        this.state.activeSessions++;

        try {
            await this.callback(event);
        } catch (err) {
            this.state.status = 'error';
            this.state.lastError = err instanceof Error ? err.message : String(err);
            this.log(`  Watch trigger "${this.config.id}" error: ${this.state.lastError}`);
        } finally {
            this.state.activeSessions = Math.max(0, this.state.activeSessions - 1);
            if (this.state.status === 'firing') {
                this.state.status = 'active';
            }
        }
    }
}

function globToRegex(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{DOUBLESTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
    return new RegExp(`^${escaped}$`);
}
