import type { AgentRunResult } from './types.js';

export interface RateLimitInfo {
    retryAfter?: Date;
    message?: string;
}

export interface RateLimitHandler {
    isRateLimited(result: AgentRunResult): boolean;
    getRetryInfo(result: AgentRunResult): RateLimitInfo | null;
}
