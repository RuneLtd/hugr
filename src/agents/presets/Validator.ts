import { Agent, type AgentConfig } from '../Agent.js';
import type { AgentMessage } from '../../types/joblog.js';

export interface ValidationRule {
    id: string;
    description: string;
    check: string;
}

export interface ValidationResult {
    passed: boolean;
    score: number;
    results: Array<{
        ruleId: string;
        passed: boolean;
        message: string;
    }>;
    summary: string;
    fixPrompt?: string;
}

export interface ValidatorConfig extends Omit<AgentConfig, 'id' | 'name'> {
    id?: string;
    name?: string;
    rules?: ValidationRule[];
    passThreshold?: number;
    generateFixPrompt?: boolean;
    systemPrompt?: string;
}

export class Validator extends Agent {
    private readonly rules: ValidationRule[];
    private readonly passThreshold: number;
    private readonly generateFixPrompt: boolean;
    private readonly systemPrompt?: string;

    constructor(config: ValidatorConfig) {
        super({
            ...config,
            id: config.id ?? 'validator',
            name: config.name ?? 'Validator',
        });
        this.rules = config.rules ?? [];
        this.passThreshold = config.passThreshold ?? 1.0;
        this.generateFixPrompt = config.generateFixPrompt ?? true;
        this.systemPrompt = config.systemPrompt;
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        const payload = message.payload as {
            task?: string;
            projectPath?: string;
            context?: string;
            targetOutput?: string;
        };

        const prompt = this.buildPrompt(payload);

        const result = await this.runtime.runAgent({
            workdir: payload.projectPath ?? this.projectPath ?? process.cwd(),
            task: prompt,
            allowedTools: ['Read', 'Glob', 'Grep'],
        });

        let validation: ValidationResult;
        try {
            const jsonMatch = result.transcript?.match(/```json\s*([\s\S]*?)\s*```/)
                ?? result.transcript?.match(/\{[\s\S]*"passed"[\s\S]*\}/);
            const raw = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : result.transcript ?? '';
            validation = JSON.parse(raw);
        } catch {
            validation = {
                passed: result.success,
                score: result.success ? 1.0 : 0.0,
                results: [],
                summary: result.transcript ?? 'Validation complete',
            };
        }

        await this.sendResult(message.jobId!, {
            success: true,
            validation,
        });
    }

    private buildPrompt(payload: { task?: string; context?: string; targetOutput?: string }): string {
        const parts: string[] = [];

        if (this.systemPrompt) {
            parts.push(this.systemPrompt);
        } else {
            parts.push('You are a validation agent. Evaluate the given output against the specified criteria.');
        }

        if (this.rules.length > 0) {
            parts.push('Validation rules:');
            for (const rule of this.rules) {
                parts.push(`- [${rule.id}] ${rule.description}: ${rule.check}`);
            }
        }

        if (payload.context) parts.push(`Context:\n${payload.context}`);
        if (payload.targetOutput) parts.push(`Output to validate:\n${payload.targetOutput}`);
        if (payload.task) parts.push(`Task: ${payload.task}`);

        parts.push(`Pass threshold: ${this.passThreshold * 100}% of rules must pass.`);

        if (this.generateFixPrompt) {
            parts.push('If validation fails, include a "fixPrompt" field with specific instructions to fix the issues.');
        }

        parts.push('Respond with a JSON object: {"passed": boolean, "score": number 0-1, "results": [{ruleId, passed, message}], "summary": string, "fixPrompt"?: string}');

        return parts.join('\n\n');
    }
}
