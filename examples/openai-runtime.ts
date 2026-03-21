import type {
    AgentRuntime,
    AgentRunOptions,
    AgentRunResult,
    AgentActivity,
    CompletionOptions,
    CompletionResult,
    ModelInfo,
} from '../src/index.js';

interface OpenAIConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    organization?: string;
}

export class OpenAIRuntime implements AgentRuntime {
    name = 'openai';
    private apiKey: string;
    private baseUrl: string;
    private model: string;
    private organization?: string;

    constructor(config: OpenAIConfig) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
        this.model = config.model ?? 'gpt-4o';
        this.organization = config.organization;
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: this.buildHeaders(),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
        const start = Date.now();

        const systemPrompt = [
            options.context ?? '',
            options.workdir ? `Working directory: ${options.workdir}` : '',
        ].filter(Boolean).join('\n');

        try {
            options.onActivity?.({
                type: 'thinking',
                content: 'Processing task...',
                timestamp: new Date(),
            });

            const messages: Array<{ role: string; content: string }> = [];
            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt });
            }
            messages.push({ role: 'user', content: options.task });

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    ...this.buildHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    max_tokens: options.runtimeOptions?.maxTokens ?? 4096,
                    temperature: (options.runtimeOptions?.temperature as number) ?? 0.7,
                }),
                signal: options.timeout
                    ? AbortSignal.timeout(options.timeout)
                    : undefined,
            });

            if (!response.ok) {
                const errorBody = await response.text();
                if (response.status === 429) {
                    return {
                        success: false,
                        durationMs: Date.now() - start,
                        error: 'Rate limited by OpenAI',
                        rateLimited: true,
                        rateLimitInfo: {
                            retryAfter: response.headers.get('retry-after') ?? undefined,
                            message: errorBody,
                        },
                    };
                }
                return {
                    success: false,
                    durationMs: Date.now() - start,
                    error: `OpenAI API error (${response.status}): ${errorBody}`,
                };
            }

            const data = await response.json() as {
                choices: Array<{ message: { content: string } }>;
                usage?: { prompt_tokens: number; completion_tokens: number };
            };
            const content = data.choices[0]?.message?.content ?? '';

            options.onActivity?.({
                type: 'result',
                content,
                timestamp: new Date(),
                tokenUsage: data.usage ? {
                    input: data.usage.prompt_tokens,
                    output: data.usage.completion_tokens,
                } : undefined,
            });

            return {
                success: true,
                durationMs: Date.now() - start,
                transcript: content,
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

        const messages: Array<{ role: string; content: string }> = [];
        if (options?.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                ...this.buildHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: options?.model ?? this.model,
                messages,
                max_tokens: options?.maxTokens ?? 4096,
                temperature: options?.temperature ?? 0.7,
                stop: options?.stop,
            }),
            signal: options?.timeout ? AbortSignal.timeout(options.timeout) : undefined,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
        }

        const data = await response.json() as {
            choices: Array<{ message: { content: string } }>;
            model: string;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };

        return {
            text: data.choices[0]?.message?.content ?? '',
            model: data.model,
            usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
            } : undefined,
            durationMs: Date.now() - start,
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        const response = await fetch(`${this.baseUrl}/models`, {
            headers: this.buildHeaders(),
        });

        if (!response.ok) return [];

        const data = await response.json() as {
            data: Array<{ id: string; created: number }>;
        };

        return data.data.map(m => ({
            name: m.id,
            modifiedAt: new Date(m.created * 1000),
        }));
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
        };
        if (this.organization) {
            headers['OpenAI-Organization'] = this.organization;
        }
        return headers;
    }
}
