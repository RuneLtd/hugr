import { Agent, type AgentConfig } from '../src/agents/Agent.js';
import type { AgentMessage } from '../src/types/joblog.js';

interface ResearchAgentConfig extends AgentConfig {
    maxSources?: number;
    outputFormat?: 'summary' | 'detailed' | 'bullet-points';
}

interface ResearchPayload {
    task: string;
    projectPath: string;
    topic?: string;
    constraints?: string[];
}

export class ResearchAgent extends Agent {
    private maxSources: number;
    private outputFormat: string;

    constructor(config: ResearchAgentConfig) {
        super({
            ...config,
            id: config.id ?? 'researcher',
            name: config.name ?? 'Research Agent',
        });
        this.maxSources = config.maxSources ?? 5;
        this.outputFormat = config.outputFormat ?? 'summary';
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        switch (message.type) {
            case 'task_assignment':
                await this.handleResearchTask(message);
                break;
            case 'clarification_response':
                break;
            default:
                console.warn(`ResearchAgent received unexpected message type: ${message.type}`);
        }
    }

    private async handleResearchTask(message: AgentMessage): Promise<void> {
        const payload = message.payload as ResearchPayload;
        const jobId = message.jobId;

        if (!jobId) {
            throw new Error('Task assignment without jobId');
        }

        await this.logActivity(jobId, 'llm_call', {
            action: 'research',
            topic: payload.topic ?? payload.task,
        });

        const prompt = this.buildResearchPrompt(payload);

        const result = await (this.runtime as any).runAgent({
            workdir: payload.projectPath,
            task: prompt,
            onActivity: (activity: any) => {
                this.logActivity(jobId, 'llm_call', {
                    type: activity.type,
                    content: activity.content?.slice(0, 200),
                }).catch(() => {});
            },
        });

        if (result.success) {
            await this.sendResult(jobId, {
                success: true,
                summary: result.transcript?.slice(0, 500) ?? 'Research complete',
                output: {
                    files: [],
                    summary: result.transcript ?? '',
                },
                currentPrompt: result.transcript,
            });
        } else {
            await this.sendResult(jobId, {
                success: false,
                error: result.error ?? 'Research failed',
            });
        }
    }

    private buildResearchPrompt(payload: ResearchPayload): string {
        const parts = [
            `Research the following topic thoroughly:`,
            ``,
            payload.task,
        ];

        if (payload.constraints?.length) {
            parts.push('', 'Constraints:');
            payload.constraints.forEach(c => parts.push(`- ${c}`));
        }

        parts.push(
            '',
            `Requirements:`,
            `- Find up to ${this.maxSources} relevant sources`,
            `- Output format: ${this.outputFormat}`,
            `- Include citations where possible`,
            `- Be factual and objective`,
        );

        return parts.join('\n');
    }
}
