
import { createHash } from 'node:crypto';
import type { TriggerConfig, TriggerState, TriggerHandler, TriggerCallback, TriggerEvent } from './types.js';

export class PollTrigger implements TriggerHandler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private state: TriggerState;
    private readonly config: TriggerConfig;
    private readonly callback: TriggerCallback;
    private readonly log: (msg: string) => void;
    private lastHash: string | null = null;
    private seenKeys = new Set<string>();

    constructor(config: TriggerConfig, callback: TriggerCallback, log?: (msg: string) => void) {
        if (!config.poll) {
            throw new Error(`Poll trigger "${config.id}" requires poll config`);
        }
        this.config = config;
        this.callback = callback;
        this.log = log ?? console.log;
        this.state = {
            id: config.id,
            type: 'poll',
            status: 'idle',
            fireCount: 0,
            activeSessions: 0,
        };
    }

    async start(): Promise<void> {
        if (this.timer) return;
        this.state.status = 'active';

        const interval = this.config.poll!.interval * 1000;
        this.timer = setInterval(() => this.tick(), interval);

        this.log(`  Poll trigger "${this.config.id}" started: checking ${this.config.poll!.url} every ${this.config.poll!.interval}s`);

        await this.tick();
    }

    async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.state.status = 'idle';
    }

    getState(): TriggerState {
        return { ...this.state };
    }

    private async tick(): Promise<void> {
        try {
            const pollConfig = this.config.poll!;
            const headers: Record<string, string> = {
                'User-Agent': 'hugr-trigger/1.0',
                ...pollConfig.headers,
            };

            const response = await fetch(pollConfig.url, {
                method: pollConfig.method ?? 'GET',
                headers,
                body: pollConfig.method === 'POST' ? pollConfig.body : undefined,
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) {
                this.state.lastError = `HTTP ${response.status}: ${response.statusText}`;
                return;
            }

            const contentType = response.headers.get('content-type') ?? '';
            let data: unknown;

            if (contentType.includes('json')) {
                data = await response.json();
            } else if (contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom')) {
                const text = await response.text();
                data = parseSimpleXml(text);
            } else {
                data = await response.text();
            }

            let items: unknown[] = [];
            if (pollConfig.jq) {
                const extracted = extractByPath(data, pollConfig.jq);
                items = Array.isArray(extracted) ? extracted : [extracted];
            } else if (Array.isArray(data)) {
                items = data;
            } else {
                items = [data];
            }

            if (pollConfig.dedup !== false) {
                const newItems: unknown[] = [];
                for (const item of items) {
                    const key = this.getDedupKey(item, pollConfig.dedupKey);
                    if (!this.seenKeys.has(key)) {
                        this.seenKeys.add(key);
                        newItems.push(item);
                    }
                }

                if (this.state.fireCount === 0 && newItems.length === items.length) {
                    return;
                }

                items = newItems;
            } else {
                const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
                if (hash === this.lastHash) return;
                this.lastHash = hash;
            }

            if (items.length === 0) return;

            if (this.config.cooldown && this.state.lastFired) {
                const elapsed = (Date.now() - this.state.lastFired.getTime()) / 1000;
                if (elapsed < this.config.cooldown) return;
            }

            if (this.config.maxConcurrent && this.state.activeSessions >= this.config.maxConcurrent) {
                return;
            }

            const event: TriggerEvent = {
                triggerId: this.config.id,
                triggerType: 'poll',
                timestamp: new Date(),
                payload: {
                    items: items as Record<string, unknown>[],
                    itemCount: items.length,
                    sourceUrl: pollConfig.url,
                    item: items[0] as Record<string, unknown>,
                },
                source: pollConfig.url,
            };

            this.state.status = 'firing';
            this.state.lastFired = new Date();
            this.state.fireCount++;
            this.state.activeSessions++;

            try {
                await this.callback(event);
            } catch (err) {
                this.state.lastError = err instanceof Error ? err.message : String(err);
                this.log(`  Poll trigger "${this.config.id}" error: ${this.state.lastError}`);
            } finally {
                this.state.activeSessions = Math.max(0, this.state.activeSessions - 1);
                if (this.state.status === 'firing') {
                    this.state.status = 'active';
                }
            }
        } catch (err) {
            this.state.lastError = err instanceof Error ? err.message : String(err);
        }
    }

    private getDedupKey(item: unknown, dedupKeyPath?: string): string {
        if (dedupKeyPath && item && typeof item === 'object') {
            const val = extractByPath(item, dedupKeyPath);
            if (val != null) return String(val);
        }

        return createHash('sha256')
            .update(JSON.stringify(item))
            .digest('hex');
    }
}

function extractByPath(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        if (Array.isArray(current)) {
            const idx = parseInt(part, 10);
            if (!isNaN(idx)) {
                current = current[idx];
                continue;
            }
            return current.map(item => extractByPath(item, parts.slice(parts.indexOf(part)).join('.')));
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function parseSimpleXml(xml: string): Record<string, unknown> {
    const items: Record<string, string>[] = [];

    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;

    const regex = itemRegex.test(xml) ? itemRegex : entryRegex;
    regex.lastIndex = 0;

    let match;
    while ((match = regex.exec(xml)) !== null) {
        const content = match[1];
        const item: Record<string, string> = {};

        const tagRegex = /<(\w+)[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
        let tagMatch;
        while ((tagMatch = tagRegex.exec(content)) !== null) {
            item[tagMatch[1]] = (tagMatch[2] ?? tagMatch[3]).trim();
        }

        const linkMatch = content.match(/<link[^>]+href="([^"]*)"[^>]*\/?>/);
        if (linkMatch && !item.link) {
            item.link = linkMatch[1];
        }

        if (Object.keys(item).length > 0) {
            items.push(item);
        }
    }

    const titleMatch = xml.match(/<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/);
    const feedTitle = titleMatch ? (titleMatch[1] ?? titleMatch[2]).trim() : '';

    return {
        title: feedTitle,
        items,
        itemCount: items.length,
    };
}
