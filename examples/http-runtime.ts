import type {
    AgentRuntime,
    AgentRunOptions,
    AgentRunResult,
    CompletionOptions,
    CompletionResult,
    ModelInfo,
} from '../src/index.js';

interface HttpRuntimeConfig {
    endpoint: string;
    headers?: Record<string, string>;
    model?: string;
    requestTransform?: (task: string, options: AgentRunOptions) => unknown;
    responseTransform?: (body: unknown) => { text: string; success: boolean };
}

export class HttpRuntime implements AgentRuntime {
    name = 'http';
    private endpoint: string;
    private headers: Record<string, string>;
    private model: string;
    private requestTransform: (task: string, options: AgentRunOptions) => unknown;
    private responseTransform: (body: unknown) => { text: string; success: boolean };

    constructor(config: HttpRuntimeConfig) {
        this.endpoint = config.endpoint;
        this.headers = config.headers ?? {};
        this.model = config.model ?? 'default';

        this.requestTransform = config.requestTransform ?? ((task, options) => ({
            prompt: task,
            context: options.context,
            model: this.model,
        }));

        this.responseTransform = config.responseTransform ?? ((body: unknown) => {
            const b = body as Record<string, unknown>;
            return {
                text: String(b.text ?? b.response ?? b.content ?? b.output ?? ''),
                success: true,
            };
        });
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(this.endpoint, {
                method: 'HEAD',
                signal: AbortSignal.timeout(5000),
            });
            return response.ok || response.status === 405;
        } catch {
            return false;
        }
    }

    async runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
        const start = Date.now();

        try {
            options.onActivity?.({
                type: 'thinking',
                content: 'Sending request...',
                timestamp: new Date(),
            });

            const body = this.requestTransform(options.task, options);

            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.headers,
                },
                body: JSON.stringify(body),
                signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
            });

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    durationMs: Date.now() - start,
                    error: `HTTP ${response.status}: ${errorText}`,
                    rateLimited: response.status === 429,
                };
            }

            const responseBody = await response.json();
            const result = this.responseTransform(responseBody);

            options.onActivity?.({
                type: 'result',
                content: result.text,
                timestamp: new Date(),
            });

            return {
                success: result.success,
                durationMs: Date.now() - start,
                transcript: result.text,
            };
        } catch (error) {
            return {
                success: false,
                durationMs: Date.now() - start,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
        const start = Date.now();

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.headers,
            },
            body: JSON.stringify({
                prompt,
                model: options?.model ?? this.model,
                system: options?.systemPrompt,
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
            }),
            signal: options?.timeout ? AbortSignal.timeout(options.timeout) : undefined,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const body = await response.json() as Record<string, unknown>;
        const text = String(body.text ?? body.response ?? body.content ?? '');

        return {
            text,
            model: String(body.model ?? this.model),
            durationMs: Date.now() - start,
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        return [{ name: this.model }];
    }
}
