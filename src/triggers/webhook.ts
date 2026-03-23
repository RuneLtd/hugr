
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TriggerConfig, TriggerState, TriggerHandler, TriggerCallback, TriggerEvent } from './types.js';

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

function verifySignature(body: string, secret: string, signature: string | undefined): boolean {
    if (!signature) return false;

    const algorithms = ['sha256', 'sha1'];
    for (const algo of algorithms) {
        const prefix = `${algo}=`;
        if (signature.startsWith(prefix)) {
            const expected = createHmac(algo, secret).update(body).digest('hex');
            const actual = signature.slice(prefix.length);
            try {
                return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
            } catch {
                return false;
            }
        }
    }

    const expected = createHmac('sha256', secret).update(body).digest('hex');
    try {
        return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
        return false;
    }
}

export class WebhookServer {
    private server: Server | null = null;
    private routes = new Map<string, WebhookTrigger>();
    private readonly port: number;
    private readonly host: string;
    private readonly log: (msg: string) => void;

    constructor(port = 9090, host = '0.0.0.0', log?: (msg: string) => void) {
        this.port = port;
        this.host = host;
        this.log = log ?? console.log;
    }

    registerRoute(trigger: WebhookTrigger): void {
        const path = trigger.getPath();
        this.routes.set(path, trigger);
    }

    unregisterRoute(path: string): void {
        this.routes.delete(path);
    }

    async start(): Promise<void> {
        if (this.server) return;

        this.server = createServer((req, res) => this.handleRequest(req, res));

        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, this.host, () => {
                this.log(`  Webhook server listening on ${this.host}:${this.port}`);
                this.log(`  Registered routes: ${[...this.routes.keys()].join(', ') || 'none'}`);
                resolve();
            });
            this.server!.on('error', reject);
        });
    }

    async stop(): Promise<void> {
        if (!this.server) return;

        return new Promise((resolve) => {
            this.server!.close(() => {
                this.server = null;
                resolve();
            });
        });
    }

    isRunning(): boolean {
        return this.server !== null;
    }

    getPort(): number {
        return this.port;
    }

    private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                routes: [...this.routes.keys()],
                triggers: [...this.routes.values()].map(t => ({
                    id: t.getState().id,
                    status: t.getState().status,
                    fireCount: t.getState().fireCount,
                })),
            }));
            return;
        }

        if (url.pathname === '/triggers') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(
                [...this.routes.values()].map(t => t.getState()),
            ));
            return;
        }

        const trigger = this.routes.get(url.pathname);
        if (!trigger) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found', availableRoutes: [...this.routes.keys()] }));
            return;
        }

        const expectedMethod = trigger.getMethod();
        if (req.method !== expectedMethod) {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Method not allowed. Expected ${expectedMethod}` }));
            return;
        }

        try {
            const body = await readBody(req);
            const headers: Record<string, string> = {};
            for (const [key, val] of Object.entries(req.headers)) {
                if (typeof val === 'string') headers[key] = val;
            }

            await trigger.handleWebhook(body, headers, url.searchParams);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: true, triggerId: trigger.getState().id }));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const status = message.includes('signature') ? 401 : 500;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
        }
    }
}

export class WebhookTrigger implements TriggerHandler {
    private state: TriggerState;
    private readonly config: TriggerConfig;
    private readonly callback: TriggerCallback;
    private readonly log: (msg: string) => void;

    constructor(config: TriggerConfig, callback: TriggerCallback, log?: (msg: string) => void) {
        if (!config.webhook) {
            throw new Error(`Webhook trigger "${config.id}" requires webhook config`);
        }
        this.config = config;
        this.callback = callback;
        this.log = log ?? console.log;
        this.state = {
            id: config.id,
            type: 'webhook',
            status: 'idle',
            fireCount: 0,
            activeSessions: 0,
        };
    }

    async start(): Promise<void> {
        this.state.status = 'active';
        this.log(`  Webhook trigger "${this.config.id}" active at ${this.config.webhook!.path}`);
    }

    async stop(): Promise<void> {
        this.state.status = 'idle';
    }

    getState(): TriggerState {
        return { ...this.state };
    }

    getPath(): string {
        return this.config.webhook!.path;
    }

    getMethod(): string {
        return this.config.webhook!.method ?? 'POST';
    }

    async handleWebhook(
        body: string,
        headers: Record<string, string>,
        params: URLSearchParams,
    ): Promise<void> {
        const secret = this.config.webhook!.secret;
        if (secret) {
            const sig = headers['x-hub-signature-256']
                ?? headers['x-hub-signature']
                ?? headers['x-signature']
                ?? headers['x-webhook-signature'];
            if (!verifySignature(body, secret, sig)) {
                throw new Error('Invalid webhook signature');
            }
        }

        if (this.config.cooldown && this.state.lastFired) {
            const elapsed = (Date.now() - this.state.lastFired.getTime()) / 1000;
            if (elapsed < this.config.cooldown) {
                this.log(`  Webhook "${this.config.id}" in cooldown (${Math.ceil(this.config.cooldown - elapsed)}s remaining)`);
                return;
            }
        }

        if (this.config.maxConcurrent && this.state.activeSessions >= this.config.maxConcurrent) {
            this.log(`  Webhook "${this.config.id}" at max concurrent (${this.config.maxConcurrent})`);
            return;
        }

        let payload: Record<string, unknown> = {};
        try {
            payload = body ? JSON.parse(body) : {};
        } catch {
            payload = { raw: body };
        }

        const queryParams: Record<string, string> = {};
        params.forEach((val, key) => { queryParams[key] = val; });
        if (Object.keys(queryParams).length > 0) {
            payload.query = queryParams;
        }

        const transform = this.config.webhook!.transform;
        if (transform) {
            const transformed: Record<string, unknown> = {};
            for (const [key, path] of Object.entries(transform)) {
                transformed[key] = resolvePath(payload, path);
            }
            Object.assign(payload, { _transformed: transformed });
        }

        const event: TriggerEvent = {
            triggerId: this.config.id,
            triggerType: 'webhook',
            timestamp: new Date(),
            payload,
            headers,
            source: headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? 'webhook',
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
            throw err;
        } finally {
            this.state.activeSessions = Math.max(0, this.state.activeSessions - 1);
            if (this.state.status === 'firing') {
                this.state.status = 'active';
            }
        }
    }
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}
