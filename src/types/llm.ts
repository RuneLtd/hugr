
export interface ToolDecision {
    behavior: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
}

export type CanUseToolFn = (
    toolName: string,
    input: Record<string, unknown>,
    context: { signal: AbortSignal },
) => ToolDecision | Promise<ToolDecision>;

export interface StreamActivity {
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

export interface ExecuteOptions {
    workdir: string;
    task: string;
    context?: string;
    timeout?: number;
    autoAccept?: boolean;
    sessionProjectPath?: string;
    onActivity?: (activity: StreamActivity) => void;
    agentTeams?: boolean;
    skipGitTracking?: boolean;
    skillContent?: string;
    allowedTools?: string[];
    maxTurns?: number;
    canUseTool?: CanUseToolFn;
    resume?: string;
    onSessionInit?: (sessionId: string) => void;
    images?: Array<{
        id: string;
        name: string;
        mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
        base64: string;
    }>;
    filePaths?: string[];
}

export interface ExecuteResult {
    success: boolean;
    durationMs: number;
    filesChanged: string[];
    fileChanges: FileChange[];
    transcript?: string;
    error?: string;
    costUsd?: number;
    tokenUsage?: { input_tokens: number; output_tokens: number };
    numTurns?: number;
    sessionId?: string;
    sessionLimited?: boolean;
    resetTime?: string;
}

export interface LLMProvider {
    name: string;
    isAvailable(): Promise<boolean>;
    execute(options: ExecuteOptions): Promise<ExecuteResult>;
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
