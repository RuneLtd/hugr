
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDefaultSkill } from '../../utils/skills.js';

import { Agent } from '../Agent.js';
import type { Joblog } from '../../joblog/Joblog.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { LLMProvider, StreamActivity, CanUseToolFn } from '../../types/llm.js';

export interface SkillCreatorActivity {
    type: 'thinking' | 'reading' | 'writing' | 'complete' | 'text';
    message: string;
    file?: string;
    agentId: string;
    jobId?: string;
    details?: string;
}

export interface SkillCreatorConfig {
    joblog: Joblog;
    runtime: LLMProvider;
    pollInterval?: number;
    onActivity?: (activity: SkillCreatorActivity) => void;
}

export interface SkillCreatorQuestionsPayload {
    questions: Array<{
        question: string;
        reason: string;
        options: string[];
        defaultAnswer: string;
    }>;
}

export interface SkillCreatorAnswersPayload {
    answers: Array<{
        question: string;
        answer: string;
        skipped: boolean;
    }>;
}

export class SkillCreator extends Agent {
    private readonly onActivity?: (activity: SkillCreatorActivity) => void;
    private lastTextContent: string = '';

    constructor(config: SkillCreatorConfig) {
        super({
            id: 'hugr-skill-creator',
            name: 'Skill Creator',
            joblog: config.joblog,
            runtime: config.runtime,
            pollInterval: config.pollInterval,
        });
        this.onActivity = config.onActivity;
    }

    private handleStreamActivity(jobId: string, activity: StreamActivity): void {
        if (!this.onActivity) return;

        switch (activity.type) {
            case 'tool_start': {
                const toolName = activity.toolName?.toLowerCase() ?? '';
                if (toolName.includes('askuserquestion')) break;
                if (!activity.displayInput) break;

                const isReadTool = toolName.includes('read') || toolName.includes('glob') || toolName.includes('grep');
                const activityType: SkillCreatorActivity['type'] = isReadTool ? 'reading' : 'writing';
                const details = JSON.stringify({
                    toolName: activity.toolName,
                    displayInput: activity.displayInput,
                });
                this.onActivity({
                    type: activityType,
                    message: `${activity.toolName} ${activity.displayInput}`,
                    file: activity.toolName,
                    agentId: this.id,
                    jobId,
                    details,
                });
                break;
            }
            case 'tool_progress': {
                const details = JSON.stringify({
                    toolName: activity.toolName,
                    elapsedSeconds: activity.elapsedSeconds,
                });
                this.onActivity({
                    type: 'reading',
                    message: activity.content || `${activity.toolName} (${activity.elapsedSeconds}s)`,
                    agentId: this.id,
                    jobId,
                    details,
                });
                break;
            }
            case 'tool_summary': {
                const details = JSON.stringify({
                    toolName: activity.toolName,
                    stat: activity.stat,
                });
                this.onActivity({
                    type: 'reading',
                    message: activity.stat || activity.content,
                    agentId: this.id,
                    jobId,
                    details,
                });
                break;
            }
            case 'text':
                if (activity.content.length > 10) {
                    this.lastTextContent = activity.content;
                    this.onActivity({
                        type: 'text',
                        message: activity.content,
                        agentId: this.id,
                        jobId,
                    });
                }
                break;
            case 'thinking':
                this.onActivity({
                    type: 'thinking',
                    message: activity.content,
                    agentId: this.id,
                    jobId,
                });
                break;
            case 'error':
                this.onActivity({
                    type: 'writing',
                    message: `Error: ${activity.content}`,
                    agentId: this.id,
                    jobId,
                });
                break;
        }
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        switch (message.type) {
            case 'task_assignment':
                await this.handleTaskAssignment(message);
                break;

            case 'clarification_response':
                this.handleClarificationResponse(message);
                break;

            case 'health_ping':
                await this.send({
                    type: 'health_pong',
                    to: message.from,
                    payload: { status: 'active', currentTask: message.jobId },
                });
                break;

            default:
                console.warn(`SkillCreator received unexpected message type: ${message.type}`);
        }
    }

    private async handleTaskAssignment(message: AgentMessage): Promise<void> {
        const payload = message.payload as {
            task: string;
            projectPath: string;
            images?: Array<{ id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string }>;
            filePaths?: string[];
            resumeProviderSession?: string;
        };

        if (!message.jobId) {
            throw new Error('Task assignment without jobId');
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`🛠️  SKILL CREATOR STARTING`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`   Job ID: ${message.jobId}`);
        console.log(`   Project: ${payload.projectPath}`);
        console.log(`   Task: ${payload.task.slice(0, 80)}${payload.task.length > 80 ? '...' : ''}`);

        await this.logActivity(message.jobId, 'llm_call', {
            action: 'creating_skill',
            task: payload.task,
        });

        const jobId = message.jobId;
        try {
            await this.runSkillCreatorSession(jobId, payload);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`\n${'═'.repeat(60)}`);
            console.error(`❌ SKILL CREATOR FAILED`);
            console.error(`   Error: ${errorMessage}`);
            console.log(`${'═'.repeat(60)}\n`);

            await this.sendResult(jobId, {
                success: false,
                error: `Skill creation failed: ${errorMessage}`,
            });
        }
    }

    private isOpenClawTask(task: string): boolean {
        const lower = task.toLowerCase();
        return lower.startsWith('[openclaw]') || /\bopenclaw\b/.test(lower) || /\bopen\s*claw\b/.test(lower);
    }

    private async runSkillCreatorSession(
        jobId: string,
        payload: { task: string; projectPath: string; images?: Array<{ id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string }>; filePaths?: string[]; resumeProviderSession?: string },
    ): Promise<void> {
        const useOpenClaw = this.isOpenClawTask(payload.task);
        const skillCreatorSkill = await loadDefaultSkill(
            useOpenClaw ? 'openclaw-skill-creator' : 'skill-creator',
            payload.projectPath
        );

        if (!skillCreatorSkill) {
            console.log(`   ⚠️  No skill-creator found, using default behavior`);
        }

        if (useOpenClaw) {
            console.log(`   🐾 OpenClaw mode detected — using hugr-openclaw-skill-creator`);
        }

        const prompt = this.buildPrompt(payload.task);
        const canUseTool = this.createCanUseTool(jobId);

        console.log(`\n   Launching Claude Code session for skill creation...`);
        console.log(`   📤 SKILL CREATOR PROMPT TO CLAUDE CODE (${prompt.length} chars):`);
        console.log(`   ${prompt.slice(0, 300)}${prompt.length > 300 ? '...' : ''}`);
        console.log(`   Skill loaded: ${!!skillCreatorSkill} (${(skillCreatorSkill || '').length} chars)`);

        if (payload.resumeProviderSession) {
            console.log(`   🔄 Resuming provider session: ${payload.resumeProviderSession}`);
        }

        const result = await (this.runtime as any).execute({
            workdir: payload.projectPath,
            task: prompt,
            autoAccept: true,
            skipGitTracking: true,
            timeout: 0,
            skillContent: skillCreatorSkill,
            canUseTool,
            allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'AskUserQuestion', 'Bash'],
            images: payload.images,
            filePaths: payload.filePaths,
            resume: payload.resumeProviderSession,
            onActivity: this.onActivity
                ? (streamActivity: StreamActivity) => {
                      this.handleStreamActivity(jobId, streamActivity);
                  }
                : undefined,
        });

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`🛠️  SKILL CREATOR SESSION COMPLETE`);
        console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
        console.log(`   Success: ${result.success}`);

        if (!result.success) {
										if (result.sessionLimited) {
                console.log(`   ⚠️  SESSION LIMIT DETECTED IN SKILL CREATOR`);
                await this.sendResult(jobId, {
                    success: false,
                    error: `Session limit reached${result.resetTime ? ` - resets ${result.resetTime}` : ''}`,
                    sessionLimited: true,
                    resetTime: result.resetTime,
                });
                return;
            }
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`🛠️  SKILL CREATOR COMPLETE`);
        console.log(`${'═'.repeat(60)}\n`);

        await this.sendResult(jobId, {
            success: result.success,
            output: {
                files: [],
                summary: this.lastTextContent || 'Skill creation session complete',
            },
            providerSessionId: result.sessionId,
        });
    }

    private createCanUseTool(jobId: string): CanUseToolFn {
        return async (toolName, input, options) => {
            if (toolName !== 'AskUserQuestion') {
                return { behavior: 'allow' as const };
            }

            console.log(`\n   📋 AskUserQuestion intercepted — routing to UI`);

            const questions = this.mapSDKQuestionsToPayload(input);
            console.log(`   Questions: ${questions.length}`);

            await this.send({
                type: 'clarification_request',
                to: 'manager',
                jobId,
                payload: {
                    questions,
                } satisfies SkillCreatorQuestionsPayload,
            });

            console.log(`   Waiting for user answers (polling joblog)...`);

            const answers = await this.pollForClarificationResponse(options.signal);

            console.log(`   ✔ Received ${answers.length} answers from user`);

            const sdkAnswers: Record<string, string> = {};
            for (let i = 0; i < answers.length; i++) {
                if (!answers[i].skipped) {
                    sdkAnswers[String(i)] = answers[i].answer;
                }
            }

            return {
                behavior: 'allow' as const,
                updatedInput: { ...input, answers: sdkAnswers },
            };
        };
    }

    private async pollForClarificationResponse(signal: AbortSignal): Promise<SkillCreatorAnswersPayload['answers']> {
        while (!signal.aborted) {
            const messages = await this.joblog.getMessages(this.id);
            for (const message of messages) {
                if (message.type === 'clarification_response') {
                    await this.joblog.markMessageProcessed(message.id);
                    const payload = message.payload as SkillCreatorAnswersPayload;
                    return payload.answers;
                }
                await this.joblog.markMessageProcessed(message.id);
            }
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }
        throw new Error('SkillCreator aborted while waiting for user answers');
    }

    private handleClarificationResponse(_message: AgentMessage): void {
    }

    private buildPrompt(userTask: string): string {
        const isOpenClaw = this.isOpenClawTask(userTask);
        const skillName = isOpenClaw ? 'hugr-openclaw-skill-creator' : 'hugr-skill-creator';
        return `Using the ${skillName} skill, create a skill for this:

${userTask}

Use AskUserQuestion for all questions — the UI routes them to the user.`;
    }

    private mapSDKQuestionsToPayload(input: Record<string, unknown>): SkillCreatorQuestionsPayload['questions'] {
        const sdkQuestions = (input as any).questions;
        if (!Array.isArray(sdkQuestions)) return [];

        return sdkQuestions.map((q: any) => ({
            question: q.question ?? '',
            reason: q.header ?? '',
            options: Array.isArray(q.options)
                ? q.options.map((o: any) => (typeof o === 'string' ? o : o.label ?? String(o)))
                : [],
            defaultAnswer: Array.isArray(q.options) && q.options.length > 0
                ? typeof q.options[0] === 'string'
                    ? q.options[0]
                    : q.options[0]?.label ?? ''
                : '',
        }));
    }
}
