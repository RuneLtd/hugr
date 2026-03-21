export interface ImageAttachment {
    id?: string;
    name: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    base64: string;
}

export interface AgentActivity {
    type: 'thinking' | 'text' | 'tool_start' | 'tool_end' | 'tool_progress' | 'tool_summary' | 'error' | 'result';
    content: string;
    toolName?: string;
    timestamp: Date;
    displayInput?: string;
    elapsedSeconds?: number;
    stat?: string;
    tokenUsage?: { input: number; output: number };
}

export interface FileChange {
    path: string;
    action: 'created' | 'modified' | 'deleted';
}

export interface AgentRunOptions {
    workdir: string;
    task: string;
    context?: string;
    timeout?: number;
    allowedTools?: string[];
    maxTurns?: number;
    images?: ImageAttachment[];
    filePaths?: string[];
    onActivity?: (activity: AgentActivity) => void;
    runtimeOptions?: Record<string, unknown>;
}

export interface AgentRunResult {
    success: boolean;
    durationMs: number;
    transcript?: string;
    error?: string;
    filesChanged?: string[];
    fileChanges?: FileChange[];
    rateLimited?: boolean;
    rateLimitInfo?: {
        retryAfter?: string;
        message?: string;
    };
    runtimeMetadata?: Record<string, unknown>;
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

export interface AgentRuntime {
    name: string;
    isAvailable(): Promise<boolean>;
    runAgent(options: AgentRunOptions): Promise<AgentRunResult>;
    complete?(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
    stream?(prompt: string, options?: CompletionOptions): AsyncIterable<string>;
    listModels?(): Promise<ModelInfo[]>;
}

export class RuntimeError extends Error {
    constructor(
        message: string,
        public readonly runtime: string,
        public readonly code?: string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false
    ) {
        super(message);
        this.name = 'RuntimeError';
    }
}
