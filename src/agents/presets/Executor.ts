import { Agent, type AgentConfig } from '../Agent.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { AgentRunResult } from '../../runtime/types.js';
import type { ToolResolver } from '../../tools/types.js';

export interface ExecutorConfig extends Omit<AgentConfig, 'id' | 'name'> {
    id?: string;
    name?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    onProgress?: (activity: { type: string; message: string }) => void;
    toolResolver?: ToolResolver;
}

export class Executor extends Agent {
    private readonly systemPrompt?: string;
    private readonly allowedTools?: string[];
    private readonly maxTurns?: number;
    private readonly onProgress?: (activity: { type: string; message: string }) => void;

    constructor(config: ExecutorConfig) {
        super({
            ...config,
            id: config.id ?? 'executor',
            name: config.name ?? 'Executor',
        });
        this.systemPrompt = config.systemPrompt;
        this.allowedTools = config.allowedTools;
        this.maxTurns = config.maxTurns;
        this.onProgress = config.onProgress;
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        if (!message.jobId) {
            throw new Error('Executor received message without jobId');
        }

        const payload = message.payload as {
            task: string;
            context?: string;
            projectPath?: string;
            allowedTools?: string[];
        };

        const task = this.systemPrompt
            ? `${this.systemPrompt}\n\nTask: ${payload.task}`
            : payload.task;

        const result: AgentRunResult = await this.runtime.runAgent({
            workdir: payload.projectPath ?? this.projectPath ?? process.cwd(),
            task,
            context: payload.context,
            allowedTools: payload.allowedTools ?? this.allowedTools,
            maxTurns: this.maxTurns,
            onActivity: this.onProgress ? (activity) => {
                this.onProgress!({ type: activity.type, message: activity.content });
            } : undefined,
        });

        await this.sendResult(message.jobId, {
            success: result.success,
            output: result.transcript,
            filesChanged: result.filesChanged ?? [],
            fileChanges: result.fileChanges ?? [],
            error: result.error,
            durationMs: result.durationMs,
        });
    }
}
