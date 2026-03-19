
type Brand<T, B extends string> = T & { readonly __brand: B };

export type SessionId = Brand<string, 'SessionId'>;

export type JobId = Brand<string, 'JobId'>;

export type MessageId = Brand<string, 'MessageId'>;

export type JobStatus =
    | 'pending'
    | 'in_progress'
    | 'complete'
    | 'failed';

export type JobComplexity = 'simple' | 'medium' | 'complex';

export interface Job {
    id: JobId;
    description: string;
    status: JobStatus;
    parent?: string;
    children?: string[];
    dependencies?: string[];
    assignedAgent?: string;
    complexity: JobComplexity;
    attempts: number;
    maxAttempts: number;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    acceptanceCriteria: string[];
    output?: JobOutput;
    error?: JobError;
    phase?: string;
    tags?: string[];
}

export interface JobOutput {
    files: {
        path: string;
        action: 'create' | 'modify' | 'delete';
        summary?: string;
    }[];
    summary: string;
    testsAdded?: string[];
}

export interface JobError {
    type: 'validation' | 'timeout' | 'agent_crashed' | 'unknown';
    message: string;
    stack?: string;
    lastAttempt: Date;
}

export interface JobFilter {
    status?: JobStatus | JobStatus[];
    phase?: string;
    assignedAgent?: string;
    tags?: string[];
    parent?: string | null;
}

export type CreateJobInput = Omit<
    Job,
    'id' | 'createdAt' | 'status' | 'attempts'
> & {
    status?: JobStatus;
    attempts?: number;
};

export type MessageType =
    | 'task_assignment'
    | 'task_result'
    | 'clarification_request'
    | 'clarification_response'

    | 'raven_request'
    | 'raven_result'

    | 'reviewer_request'

    | 'health_ping'
    | 'health_pong';

export interface AgentMessage {
    id: MessageId;
    type: MessageType;
    from: string;
    to: string;
    jobId?: string;
    payload: unknown;
    timestamp: Date;
    processed: boolean;
    processedAt?: Date;
}

export type JoblogEntryType = 'job' | 'message' | 'decision' | 'activity';

export interface JoblogEntry {
    type: JoblogEntryType;
    timestamp: Date;
    data: Job | AgentMessage | DecisionEntry | ActivityEntry;
}

export interface DecisionEntry {
    id: string;
    jobId: string;
    agentId: string;
    type: 'design' | 'implementation' | 'error-recovery' | 'skip' | 'assumption';
    question: string;
    chosen: string;
    reasoning: string;
    alternatives: string[];
    confidence: number;
    timestamp: Date;
}

export interface ActivityEntry {
    id: string;
    jobId: string;
    agentId: string;
    type: 'file_read' | 'file_write' | 'tool_call' | 'llm_call' | 'error';
    data: unknown;
    timestamp: Date;
}

export interface IJoblog {
    initialize(): Promise<void>;
    close(): Promise<void>;

    createJob(input: CreateJobInput): Promise<Job>;
    getJob(id: string): Promise<Job | null>;
    listJobs(filter?: JobFilter): Promise<Job[]>;
    updateJob(id: string, changes: Partial<Job>): Promise<Job>;

    startJob(id: string, agentId: string): Promise<Job>;
    completeJob(id: string, output: JobOutput): Promise<Job>;
    failJob(id: string, error: Omit<JobError, 'lastAttempt'>): Promise<Job>;

    getNextJob(agentId?: string, options?: { phase?: string }): Promise<Job | null>;

    createSubtask(parentId: string, input: Omit<CreateJobInput, 'parent'>): Promise<Job>;
    getChildren(parentId: string): Promise<Job[]>;

    sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp' | 'processed'>): Promise<AgentMessage>;
    getMessages(agentId: string, unprocessedOnly?: boolean): Promise<AgentMessage[]>;
    markMessageProcessed(messageId: string): Promise<void>;

    logDecision(decision: Omit<DecisionEntry, 'id' | 'timestamp'>): Promise<void>;
    logActivity(activity: Omit<ActivityEntry, 'id' | 'timestamp'>): Promise<void>;
    getJobHistory(jobId: string): Promise<JoblogEntry[]>;

    rebuild(): Promise<void>;
    compact(): Promise<void>;
}
