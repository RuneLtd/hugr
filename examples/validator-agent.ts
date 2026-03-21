import { Agent, type AgentConfig } from '../src/agents/Agent.js';
import type { AgentMessage } from '../src/types/joblog.js';

interface ValidationRule {
    name: string;
    description: string;
    check: string;
}

interface ValidatorAgentConfig extends AgentConfig {
    rules?: ValidationRule[];
    strictMode?: boolean;
    passThreshold?: number;
}

interface ValidatePayload {
    task: string;
    projectPath: string;
    contentToValidate: string;
    originalPrompt?: string;
    previousSummaries?: string[];
}

interface ValidationResult {
    passed: boolean;
    score: number;
    issues: Array<{ rule: string; severity: 'error' | 'warning' | 'info'; message: string }>;
    summary: string;
    suggestions: string[];
}

export class ValidatorAgent extends Agent {
    private rules: ValidationRule[];
    private strictMode: boolean;
    private passThreshold: number;

    constructor(config: ValidatorAgentConfig) {
        super({
            ...config,
            id: config.id ?? 'validator',
            name: config.name ?? 'Validator Agent',
        });
        this.rules = config.rules ?? [];
        this.strictMode = config.strictMode ?? false;
        this.passThreshold = config.passThreshold ?? 0.7;
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        switch (message.type) {
            case 'task_assignment':
                await this.handleValidation(message);
                break;
            default:
                console.warn(`ValidatorAgent received unexpected message type: ${message.type}`);
        }
    }

    private async handleValidation(message: AgentMessage): Promise<void> {
        const payload = message.payload as ValidatePayload;
        const jobId = message.jobId;

        if (!jobId) {
            throw new Error('Task assignment without jobId');
        }

        await this.logActivity(jobId, 'llm_call', {
            action: 'validate',
            contentLength: payload.contentToValidate?.length ?? 0,
            ruleCount: this.rules.length,
        });

        const prompt = this.buildValidationPrompt(payload);

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

        if (!result.success) {
            await this.sendResult(jobId, {
                success: false,
                error: result.error ?? 'Validation failed to run',
            });
            return;
        }

        const validation = this.parseValidationResult(result.transcript ?? '');

        const done = validation.passed || !this.strictMode;

        await this.sendResult(jobId, {
            success: true,
            done,
            summary: validation.summary,
            output: {
                files: [],
                summary: validation.summary,
            },
            nextPrompt: validation.passed
                ? undefined
                : this.buildFixPrompt(validation),
        });
    }

    private buildValidationPrompt(payload: ValidatePayload): string {
        const parts = [
            'You are a validation agent. Review the following content and check it against the rules below.',
            '',
            '## Content to Validate',
            payload.contentToValidate,
            '',
        ];

        if (payload.originalPrompt) {
            parts.push('## Original Requirements', payload.originalPrompt, '');
        }

        if (this.rules.length > 0) {
            parts.push('## Validation Rules');
            this.rules.forEach((rule, i) => {
                parts.push(`${i + 1}. **${rule.name}**: ${rule.description}`);
                parts.push(`   Check: ${rule.check}`);
            });
            parts.push('');
        }

        parts.push(
            '## Output Format',
            'Respond with a JSON object:',
            '```json',
            '{',
            '  "passed": true/false,',
            '  "score": 0.0-1.0,',
            '  "issues": [{ "rule": "rule name", "severity": "error|warning|info", "message": "description" }],',
            '  "summary": "one-line summary",',
            '  "suggestions": ["suggestion 1", "suggestion 2"]',
            '}',
            '```',
        );

        return parts.join('\n');
    }

    private parseValidationResult(transcript: string): ValidationResult {
        try {
            const jsonMatch = transcript.match(/```json\s*([\s\S]*?)\s*```/) ?? transcript.match(/\{[\s\S]*"passed"[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as ValidationResult;
                return {
                    passed: parsed.score >= this.passThreshold,
                    score: parsed.score ?? (parsed.passed ? 1 : 0),
                    issues: parsed.issues ?? [],
                    summary: parsed.summary ?? 'Validation complete',
                    suggestions: parsed.suggestions ?? [],
                };
            }
        } catch {}

        return {
            passed: true,
            score: 1,
            issues: [],
            summary: transcript.slice(0, 200),
            suggestions: [],
        };
    }

    private buildFixPrompt(validation: ValidationResult): string {
        const parts = [
            'The previous output failed validation. Please fix the following issues:',
            '',
        ];

        const errors = validation.issues.filter(i => i.severity === 'error');
        const warnings = validation.issues.filter(i => i.severity === 'warning');

        if (errors.length > 0) {
            parts.push('Errors (must fix):');
            errors.forEach(e => parts.push(`- [${e.rule}] ${e.message}`));
            parts.push('');
        }

        if (warnings.length > 0) {
            parts.push('Warnings (should fix):');
            warnings.forEach(w => parts.push(`- [${w.rule}] ${w.message}`));
            parts.push('');
        }

        if (validation.suggestions.length > 0) {
            parts.push('Suggestions:');
            validation.suggestions.forEach(s => parts.push(`- ${s}`));
        }

        return parts.join('\n');
    }
}
