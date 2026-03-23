
import type {
    TriggerConfig,
    TriggerEvent,
    TriggerState,
    TriggerHandler,
    TriggerEngineConfig,
    TriggerCallback,
} from './types.js';
import { CronTrigger } from './cron.js';
import { WebhookServer, WebhookTrigger } from './webhook.js';
import { PollTrigger } from './poll.js';
import { WatchTrigger } from './watch.js';

export class TriggerEngine {
    private handlers = new Map<string, TriggerHandler>();
    private webhookServer: WebhookServer | null = null;
    private readonly config: TriggerEngineConfig;
    private readonly log: (msg: string) => void;
    private running = false;

    constructor(config: TriggerEngineConfig) {
        this.config = config;
        this.log = config.log ?? console.log;
    }

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        const triggers = this.config.triggers.filter(t => t.enabled !== false);

        if (triggers.length === 0) {
            this.log('  No enabled triggers configured');
            return;
        }

        this.log(`\n  Starting ${triggers.length} trigger(s)...`);

        const webhookTriggers: WebhookTrigger[] = [];

        for (const triggerConfig of triggers) {
            const wrappedCallback = this.wrapCallback(triggerConfig);

            let handler: TriggerHandler;

            switch (triggerConfig.type) {
                case 'cron':
                    handler = new CronTrigger(triggerConfig, wrappedCallback, this.log);
                    break;

                case 'webhook': {
                    const wh = new WebhookTrigger(triggerConfig, wrappedCallback, this.log);
                    webhookTriggers.push(wh);
                    handler = wh;
                    break;
                }

                case 'poll':
                    handler = new PollTrigger(triggerConfig, wrappedCallback, this.log);
                    break;

                case 'watch':
                    handler = new WatchTrigger(triggerConfig, wrappedCallback, this.log);
                    break;

                default:
                    this.log(`  Unknown trigger type: ${(triggerConfig as TriggerConfig).type}`);
                    continue;
            }

            this.handlers.set(triggerConfig.id, handler);
        }

        if (webhookTriggers.length > 0) {
            this.webhookServer = new WebhookServer(
                this.config.webhookPort ?? 9090,
                this.config.webhookHost ?? '0.0.0.0',
                this.log,
            );

            for (const wt of webhookTriggers) {
                this.webhookServer.registerRoute(wt);
            }

            await this.webhookServer.start();
        }

        for (const [id, handler] of this.handlers) {
            try {
                await handler.start();
            } catch (err) {
                this.log(`  Failed to start trigger "${id}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        this.log(`  All triggers started\n`);
    }

    async stop(): Promise<void> {
        if (!this.running) return;

        for (const [id, handler] of this.handlers) {
            try {
                await handler.stop();
            } catch (err) {
                this.log(`  Error stopping trigger "${id}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        if (this.webhookServer) {
            await this.webhookServer.stop();
            this.webhookServer = null;
        }

        this.handlers.clear();
        this.running = false;
    }

    isRunning(): boolean {
        return this.running;
    }

    getStates(): TriggerState[] {
        return [...this.handlers.values()].map(h => h.getState());
    }

    getState(triggerId: string): TriggerState | undefined {
        return this.handlers.get(triggerId)?.getState();
    }

    getTriggerIds(): string[] {
        return [...this.handlers.keys()];
    }

    async addTrigger(triggerConfig: TriggerConfig): Promise<void> {
        if (this.handlers.has(triggerConfig.id)) {
            await this.removeTrigger(triggerConfig.id);
        }

        const wrappedCallback = this.wrapCallback(triggerConfig);
        let handler: TriggerHandler;

        switch (triggerConfig.type) {
            case 'cron':
                handler = new CronTrigger(triggerConfig, wrappedCallback, this.log);
                break;

            case 'webhook': {
                const wh = new WebhookTrigger(triggerConfig, wrappedCallback, this.log);
                if (this.webhookServer) {
                    this.webhookServer.registerRoute(wh);
                }
                handler = wh;
                break;
            }

            case 'poll':
                handler = new PollTrigger(triggerConfig, wrappedCallback, this.log);
                break;

            case 'watch':
                handler = new WatchTrigger(triggerConfig, wrappedCallback, this.log);
                break;

            default:
                throw new Error(`Unknown trigger type: ${triggerConfig.type}`);
        }

        this.handlers.set(triggerConfig.id, handler);

        if (this.running) {
            await handler.start();
        }
    }

    async removeTrigger(triggerId: string): Promise<void> {
        const handler = this.handlers.get(triggerId);
        if (!handler) return;

        await handler.stop();
        this.handlers.delete(triggerId);

        if (handler instanceof WebhookTrigger && this.webhookServer) {
            this.webhookServer.unregisterRoute(handler.getPath());
        }
    }

    private wrapCallback(triggerConfig: TriggerConfig): TriggerCallback {
        return async (event: TriggerEvent) => {
            const enrichedEvent: TriggerEvent = {
                ...event,
                payload: {
                    ...event.payload,
                    _trigger: {
                        id: triggerConfig.id,
                        type: triggerConfig.type,
                        task: interpolateTemplate(triggerConfig.task, event.payload),
                        pipeline: triggerConfig.pipeline,
                        projectPath: triggerConfig.projectPath,
                        autonomy: triggerConfig.autonomy,
                        tags: triggerConfig.tags,
                        metadata: triggerConfig.metadata,
                    },
                },
            };

            await this.config.onTrigger(enrichedEvent);
        };
    }
}

export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
        const value = resolvePath(context, path.trim());
        if (value === undefined || value === null) return `{{${path.trim()}}}`;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    });
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
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
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}
