
export const JOBLOG_DIR = 'joblog';

export const OUTPUT_DIR = 'output';

export const JOBLOG_FILES = {
    jobs: 'jobs.jsonl',
    messages: 'messages.jsonl',
    decisions: 'decisions.jsonl',
    activity: 'activity.jsonl',
} as const;

export const AGENT_OUTPUT_FILES = {
    enhancedPrompt: 'enhanced-prompt.md',
    ravenReview: 'raven-review.json',
    session: 'session.json',
    currentTask: 'current-task.md',
    currentHook: 'current-hook.json',
    interrupt: 'interrupt.json',
    stepOutput: 'step-output.json',
} as const;

export const TIMEOUTS = {

    query: 0,

    execute: 0,

    architect: 0,

    raven: 0,

    pollInterval: 100,

    healthCheck: 60_000,
} as const;

export const LIMITS = {

    maxRetries: 2,
} as const;

export const ID_PREFIXES = {
    job: 'job',
    message: 'msg',
    decision: 'dec',
    activity: 'act',
    session: 'session',
    task: 'task',
} as const;

export type AgentType =
    | 'manager'
    | 'architect'
    | 'coder'
    | 'raven'
    | 'reviewer';

export type AgentRole = 'manager' | 'architect' | 'coder' | 'raven' | 'reviewer';

export const V3_CORE_AGENTS = ['manager', 'architect', 'coder', 'raven'] as const;

export const LIBRARY_AGENTS = ['reviewer'] as const;

export const ALL_AGENT_TYPES = [...V3_CORE_AGENTS, ...LIBRARY_AGENTS] as const;

export const DEFAULT_HANDOFF_MESSAGES: Record<string, string> = {
    planner: 'The above is a plan. The project files have NOT been modified. Implement the changes described.',
    implementer: 'The above changes have been applied to the project files. Review or continue from here.',
    reviewer: 'The above is a review. Address the findings described.',
    debugging: 'The above is a diagnosis. The project files have NOT been modified. Apply the fixes described.',
    testing: 'The above tests have been written. Review or verify the results.',
    security: 'The above is a security analysis. The project files have NOT been modified. Address the findings.',
    documentation: 'The above documentation has been written. Review or continue from here.',
    refactoring: 'The above refactoring has been applied to the project files. Review or continue from here.',
    default: 'The above agent has completed its step. Continue with the next phase of work.',
};

export function getDefaultHandoffMessage(role?: string): string {
    if (role && role in DEFAULT_HANDOFF_MESSAGES) {
        return DEFAULT_HANDOFF_MESSAGES[role];
    }
    return DEFAULT_HANDOFF_MESSAGES.default;
}



export const SESSION_LIMIT_PATTERNS = [

    "you've hit your limit",
    'hit your limit',
    'usage resets',
    'limit resets',

    'rate_limit_error',
    'rate limit exceeded',
    'too many requests',
    'error 429',
    'status 429',

    'quota exceeded',
    'usage limit reached',
    'message limit reached',
    'limit has been reached',

    'session limit reached',
    'conversation limit reached',
    'daily limit reached',
    'hourly limit reached',

    'server overloaded',
    'api overloaded',
    'try again later',

    'maximum number of requests',
    'too many messages',
] as const;

export interface SessionLimitResult {
    isLimited: boolean;
    resetTime?: string;
}

export function detectSessionLimit(transcript: string): SessionLimitResult {
    const lower = transcript.toLowerCase();

    const isLimited = SESSION_LIMIT_PATTERNS.some(pattern => lower.includes(pattern));

    if (!isLimited) {
        return { isLimited: false };
    }

    const resetMatch = transcript.match(/resets?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*\([^)]+\))?)/i);
    const resetTime = resetMatch ? resetMatch[1] : undefined;

    return { isLimited: true, resetTime };
}
