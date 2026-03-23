
export type TriggerType = 'cron' | 'webhook' | 'poll' | 'watch';

export type TriggerStatus = 'idle' | 'active' | 'firing' | 'error' | 'disabled';

export interface TriggerConfig {
    id: string;
    type: TriggerType;
    enabled?: boolean;
    pipeline?: string;
    task: string;

    projectPath?: string;
    autonomy?: 'supervised' | 'auto';
    maxConcurrent?: number;
    cooldown?: number;

    cron?: string;
    webhook?: WebhookTriggerConfig;
    poll?: PollTriggerConfig;
    watch?: WatchTriggerConfig;

    tags?: string[];
    metadata?: Record<string, unknown>;
}

export interface WebhookTriggerConfig {
    path: string;
    secret?: string;
    method?: 'POST' | 'GET' | 'PUT';
    transform?: Record<string, string>;
}

export interface PollTriggerConfig {
    url: string;
    interval: number;
    headers?: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
    jq?: string;
    dedup?: boolean;
    dedupKey?: string;
}

export interface WatchTriggerConfig {
    path: string;
    pattern?: string;
    events?: Array<'create' | 'modify' | 'delete'>;
    recursive?: boolean;
    debounce?: number;
}

export interface TriggerEvent {
    triggerId: string;
    triggerType: TriggerType;
    timestamp: Date;
    payload: Record<string, unknown>;
    headers?: Record<string, string>;
    source?: string;
}

export interface TriggerState {
    id: string;
    type: TriggerType;
    status: TriggerStatus;
    lastFired?: Date;
    lastError?: string;
    fireCount: number;
    activeSessions: number;
}

export interface TriggerHandler {
    start(): Promise<void>;
    stop(): Promise<void>;
    getState(): TriggerState;
}

export type TriggerCallback = (event: TriggerEvent) => Promise<void>;

export interface TriggerEngineConfig {
    enabled?: boolean;
    triggers: TriggerConfig[];
    onTrigger: TriggerCallback;
    webhookPort?: number;
    webhookHost?: string;
    log?: (message: string) => void;
}

export type TemplateCategory =
    | 'content'
    | 'research'
    | 'monitoring'
    | 'devops'
    | 'data'
    | 'communication';

export interface TriggerTemplate {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    trigger: Omit<TriggerConfig, 'id'>;
    pipeline?: {
        name: string;
        description: string;
        steps: Array<{
            agentId: string;
            agentConfig?: {
                name: string;
                instructions: string;
                toolAccess: 'full' | 'read-only' | 'read-write-no-bash';
                allowedTools?: string[];
            };
            enabled: boolean;
        }>;
    };
    variables?: Array<{
        name: string;
        description: string;
        required: boolean;
        default?: string;
    }>;
}
