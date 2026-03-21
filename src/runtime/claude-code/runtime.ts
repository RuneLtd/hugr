import { ClaudeCodeProvider, type ClaudeCodeConfig, type QueryResult, type LimitCheckResult } from '../../llm/claude-code.js';
import type { AgentRuntime, AgentRunOptions, AgentRunResult, CompletionOptions, CompletionResult } from '../types.js';
import type { ExecuteOptions } from '../../types/llm.js';

export { ClaudeCodeConfig, QueryResult, LimitCheckResult };

export interface ClaudeCodeRuntimeOptions extends AgentRunOptions {
    autoAccept?: boolean;
    sessionProjectPath?: string;
    agentTeams?: boolean;
    skipGitTracking?: boolean;
    skillContent?: string;
    canUseTool?: (toolName: string, input: Record<string, unknown>, context: { signal: AbortSignal }) => { behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown> } | Promise<{ behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown> }>;
    resume?: string;
    onSessionInit?: (sessionId: string) => void;
}

export class ClaudeCodeRuntime extends ClaudeCodeProvider implements AgentRuntime {
    async runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
        const runtimeOpts = (options.runtimeOptions ?? {}) as Partial<ClaudeCodeRuntimeOptions>;

        const executeOptions: ExecuteOptions = {
            workdir: options.workdir,
            task: options.task,
            context: options.context,
            timeout: options.timeout,
            allowedTools: options.allowedTools,
            maxTurns: options.maxTurns,
            images: options.images?.map(img => ({
                id: img.id ?? img.name,
                name: img.name,
                mediaType: img.mediaType,
                base64: img.base64,
            })),
            filePaths: options.filePaths,
            onActivity: options.onActivity,
            autoAccept: runtimeOpts.autoAccept,
            sessionProjectPath: runtimeOpts.sessionProjectPath,
            agentTeams: runtimeOpts.agentTeams,
            skipGitTracking: runtimeOpts.skipGitTracking,
            skillContent: runtimeOpts.skillContent,
            canUseTool: runtimeOpts.canUseTool,
            resume: runtimeOpts.resume,
            onSessionInit: runtimeOpts.onSessionInit,
        };

        const result = await this.execute(executeOptions);

        return {
            success: result.success,
            durationMs: result.durationMs,
            transcript: result.transcript,
            error: result.error,
            filesChanged: result.filesChanged,
            fileChanges: result.fileChanges,
            rateLimited: result.sessionLimited,
            rateLimitInfo: result.sessionLimited
                ? { retryAfter: result.resetTime, message: result.error }
                : undefined,
            runtimeMetadata: {
                sessionId: result.sessionId,
                costUsd: result.costUsd,
                tokenUsage: result.tokenUsage,
                numTurns: result.numTurns,
            },
        };
    }
}
