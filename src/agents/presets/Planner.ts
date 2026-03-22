import { Agent, type AgentConfig } from '../Agent.js';
import type { AgentMessage } from '../../types/joblog.js';

export interface PlanStep {
    id: string;
    description: string;
    agentId?: string;
    dependsOn?: string[];
}

export interface PlanResult {
    steps: PlanStep[];
    summary: string;
    estimatedComplexity?: 'low' | 'medium' | 'high';
}

export interface PlannerConfig extends Omit<AgentConfig, 'id' | 'name'> {
    id?: string;
    name?: string;
    systemPrompt?: string;
    maxSteps?: number;
    outputFormat?: 'json' | 'markdown';
    onPlanGenerated?: (plan: PlanResult) => void;
}

export class Planner extends Agent {
    private readonly systemPrompt: string;
    private readonly maxSteps: number;
    private readonly outputFormat: string;
    private readonly onPlanGenerated?: (plan: PlanResult) => void;

    constructor(config: PlannerConfig) {
        super({
            ...config,
            id: config.id ?? 'planner',
            name: config.name ?? 'Planner',
        });
        this.systemPrompt = config.systemPrompt ?? this.defaultSystemPrompt();
        this.maxSteps = config.maxSteps ?? 20;
        this.outputFormat = config.outputFormat ?? 'json';
        this.onPlanGenerated = config.onPlanGenerated;
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        const payload = message.payload as {
            task: string;
            context?: string;
            projectPath?: string;
        };

        const prompt = this.buildPrompt(payload.task, payload.context);

        const result = await this.runtime.runAgent({
            workdir: payload.projectPath ?? this.projectPath ?? process.cwd(),
            task: prompt,
            allowedTools: ['Read', 'Glob', 'Grep'],
        });

        let plan: PlanResult;
        try {
            const jsonMatch = result.transcript?.match(/```json\s*([\s\S]*?)\s*```/)
                ?? result.transcript?.match(/\{[\s\S]*"steps"[\s\S]*\}/);
            const raw = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : result.transcript ?? '';
            plan = JSON.parse(raw);
        } catch {
            plan = {
                steps: [{ id: 'step-1', description: result.transcript ?? payload.task }],
                summary: result.transcript ?? 'Plan generated',
            };
        }

        if (plan.steps.length > this.maxSteps) {
            plan.steps = plan.steps.slice(0, this.maxSteps);
        }

        if (this.onPlanGenerated) {
            this.onPlanGenerated(plan);
        }

        await this.sendResult(message.jobId!, {
            success: result.success,
            plan,
        });
    }

    private buildPrompt(task: string, context?: string): string {
        const parts = [this.systemPrompt];
        if (context) parts.push(`Context:\n${context}`);
        parts.push(`Task: ${task}`);
        parts.push(`Respond with a JSON object containing "steps" (array of {id, description, agentId?, dependsOn?}), "summary" (string), and optionally "estimatedComplexity" ("low"|"medium"|"high"). Max ${this.maxSteps} steps.`);
        return parts.join('\n\n');
    }

    private defaultSystemPrompt(): string {
        return `You are a planning agent. Break down the given task into clear, actionable steps. Each step should be specific enough for another agent to execute independently. Consider dependencies between steps and assign agent types where appropriate.`;
    }
}
