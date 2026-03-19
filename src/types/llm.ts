
export interface LLMProvider {

    name: string;

    isAvailable(): Promise<boolean>;

    complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;

    stream?(prompt: string, options?: CompletionOptions): AsyncIterable<string>;

    listModels?(): Promise<ModelInfo[]>;
}

export interface CompletionOptions {

    model?: string;

    systemPrompt?: string;

    temperature?: number;

    maxTokens?: number;

    stop?: string[];

    timeout?: number;
}

export interface CompletionResult {

    text: string;

    model: string;

    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };

    durationMs: number;

    truncated?: boolean;
}

export interface ModelInfo {
    name: string;
    size?: string;
    modifiedAt?: Date;
    digest?: string;
}

export class LLMError extends Error {
    constructor(
        message: string,
        public readonly provider: string,
        public readonly code?: string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false
    ) {
        super(message);
        this.name = 'LLMError';
    }
}
