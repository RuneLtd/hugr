
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Agent } from '../Agent.js';
import type { Joblog } from '../../joblog/Joblog.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { LLMProvider, StreamActivity, CanUseToolFn } from '../../types/llm.js';
import { detectSessionLimit } from '../../constants.js';
import { resolveSessionDataDir } from '../../paths.js';
import type { ArchitectMode } from '../../config/schema.js';
import { loadAgentSkills } from '../../utils/skills.js';

export interface ArchitectActivity {
    type: 'thinking' | 'reading' | 'question' | 'enhancing' | 'complete';
    message: string;
    file?: string;
    agentId: string;
    jobId?: string;

    details?: string;
}

export interface ArchitectConfig {
    joblog: Joblog;
    provider: LLMProvider;
    pollInterval?: number;

    onActivity?: (activity: ArchitectActivity) => void;

    skills?: string[];
}

export interface ArchitectQuestionsPayload {
    questions: Array<{
        question: string;
        reason: string;
        options: string[];
        defaultAnswer: string;
    }>;
}

export interface ArchitectAnswersPayload {
    answers: Array<{
        question: string;
        answer: string;
        skipped: boolean;
    }>;
}

export interface ArchitectResultPayload {
    enhancedPrompt: string;
    assumptions: string[];
    mode: ArchitectMode;
}

export class Architect extends Agent {
    private readonly provider: LLMProvider;
    private readonly onActivity?: (activity: ArchitectActivity) => void;
    private readonly skills: string[];

    constructor(config: ArchitectConfig) {
        super({
            id: 'architect',
            name: 'Architect',
            joblog: config.joblog,
            llm: config.provider as unknown as LLMProvider,
            pollInterval: config.pollInterval,
        });
        this.provider = config.provider;
        this.onActivity = config.onActivity;
        this.skills = config.skills ?? [];
    }

    private handleStreamActivity(jobId: string, activity: StreamActivity): void {
        if (!this.onActivity) return;

        switch (activity.type) {
            case 'tool_start': {
                const toolName = activity.toolName?.toLowerCase() ?? '';

                if (toolName.includes('askuserquestion')) break;

                if (!activity.displayInput) break;
                let activityType: ArchitectActivity['type'] = 'enhancing';
                if (toolName.includes('read') || toolName.includes('glob') || toolName.includes('grep')) {
                    activityType = 'reading';
                }
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
                    this.onActivity({
                        type: 'thinking',
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
                    type: 'enhancing',
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
                console.warn(`Architect received unexpected message type: ${message.type}`);
        }
    }

    private async handleTaskAssignment(message: AgentMessage): Promise<void> {
        const payload = message.payload as {
            task: string;
            projectPath: string;
            architectMode: ArchitectMode;
            images?: Array<{ id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string }>;
        };

        if (!message.jobId) {
            throw new Error('Task assignment without jobId');
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`🏗️  ARCHITECT STARTING`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`   Job ID: ${message.jobId}`);
        console.log(`   Project: ${payload.projectPath}`);
        console.log(`   Mode: ${payload.architectMode}`);
        console.log(`   Task: ${payload.task.slice(0, 80)}${payload.task.length > 80 ? '...' : ''}`);

        await this.logActivity(message.jobId, 'llm_call', {
            action: 'enhancing_prompt',
            task: payload.task,
            mode: payload.architectMode,
        });

        const jobId = message.jobId;
        try {
            await this.runArchitectSession(jobId, payload);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`\n${'═'.repeat(60)}`);
            console.error(`❌ ARCHITECT FAILED`);
            console.error(`   Error: ${errorMessage}`);
            console.log(`${'═'.repeat(60)}\n`);

            await this.sendResult(jobId, {
                success: false,
                error: `Prompt enhancement failed: ${errorMessage}`,
            });
        }
    }

    private async runArchitectSession(
        jobId: string,
        payload: { task: string; projectPath: string; architectMode: ArchitectMode; images?: Array<{ id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string }>; filePaths?: string[] },
    ): Promise<void> {
        const sessionDir = resolveSessionDataDir(payload.projectPath);
        await mkdir(sessionDir, { recursive: true });

        const enhancedPromptPath = join(sessionDir, 'enhanced-prompt.md');
        const existingEnhancedPrompt = await this.tryLoadExistingEnhancedPrompt(enhancedPromptPath);

        if (existingEnhancedPrompt) {
            console.log(`\n   ✔ Found existing enhanced-prompt.md`);
            console.log(`   Skipping Claude Code session (recovery mode)`);

            console.log(`\n${'═'.repeat(60)}`);
            console.log(`🏗️  ARCHITECT COMPLETE (from existing prompt)`);
            console.log(`${'═'.repeat(60)}\n`);

            await this.sendResult(jobId, {
                success: true,
                output: {
                    files: [],
                    summary: 'Recovered enhanced prompt from existing file',
                },
                result: {
                    enhancedPrompt: existingEnhancedPrompt.prompt,
                    assumptions: existingEnhancedPrompt.assumptions,
                    mode: payload.architectMode,
                } satisfies ArchitectResultPayload,
            });
            return;
        }

        console.log(`   🎯 Skills configured: ${this.skills.length > 0 ? this.skills.join(', ') : 'none (using default)'}`);

        const architectSkill = await loadAgentSkills('architect', payload.projectPath, this.skills.length > 0 ? this.skills : undefined);

        if (!architectSkill) {
            console.log(`   ⚠️  No architect skill found, using default behavior`);
        }

        const isNewProject = await this.isEmptyProject(payload.projectPath);

        const prompt = this.buildPrompt(
            payload.task,
            payload.architectMode,
            isNewProject,
            enhancedPromptPath,
        );

        const canUseTool = this.createCanUseTool(jobId, payload.architectMode);

        console.log(`\n   Launching Claude Code session for prompt enhancement...`);
        console.log(`   📤 ARCHITECT PROMPT TO CLAUDE CODE (${prompt.length} chars):`);
        console.log(`   ${prompt.slice(0, 300)}${prompt.length > 300 ? '...' : ''}`);
        console.log(`   Skill loaded: ${!!architectSkill} (${(architectSkill || '').length} chars)`);

        const result = await this.provider.execute({
            workdir: payload.projectPath,
            task: prompt,
            autoAccept: true,
            skipGitTracking: true,
            timeout: 0,
            skillContent: architectSkill,
            canUseTool,
            allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'AskUserQuestion', 'Bash'],

            images: payload.images,
            filePaths: payload.filePaths,
            onActivity: this.onActivity
                ? (streamActivity: StreamActivity) => {
                      this.handleStreamActivity(jobId, streamActivity);
                  }
                : undefined,
        });

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`🏗️  ARCHITECT SESSION COMPLETE`);
        console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
        console.log(`   Success: ${result.success}`);

        if (!result.success) {
            const limitCheck = detectSessionLimit(result.transcript ?? '');
            if (limitCheck.isLimited) {
                console.log(`   ⚠️  SESSION LIMIT DETECTED IN ARCHITECT`);
                await this.sendResult(jobId, {
                    success: false,
                    error: `Session limit reached${limitCheck.resetTime ? ` - resets ${limitCheck.resetTime}` : ''}`,
                    sessionLimited: true,
                    resetTime: limitCheck.resetTime,
                });
                return;
            }
        }

        let enhancedPromptOutput: {
            enhancedPrompt: string;
            assumptions: string[];
        };

        try {
            const content = await readFile(enhancedPromptPath, 'utf-8');

            enhancedPromptOutput = this.parseEnhancedPromptFile(content);
            console.log(`   ✔ Successfully read enhanced-prompt.md`);
        } catch (e) {

            console.warn(`   ⚠️  Could not read enhanced-prompt.md: ${e instanceof Error ? e.message : e}`);
            console.log(`   Attempting to extract enhanced prompt from transcript...`);
            enhancedPromptOutput = this.extractEnhancedPromptFromTranscript(result.transcript ?? '');
        }

        const finalOutput = {
            enhancedPrompt: enhancedPromptOutput.enhancedPrompt,
            assumptions: enhancedPromptOutput.assumptions,
        };

        await writeFile(enhancedPromptPath, this.formatEnhancedPromptFile(finalOutput), 'utf-8');
        console.log(`   ✔ Updated enhanced-prompt.md`);

        console.log(`\n   📝 ENHANCEMENT SUMMARY:`);
        console.log(`   ├─ Enhanced prompt length: ${finalOutput.enhancedPrompt.length} chars`);
        console.log(`   ├─ Enhanced prompt preview: ${finalOutput.enhancedPrompt.slice(0, 300)}${finalOutput.enhancedPrompt.length > 300 ? '...' : ''}`);
        console.log(`   ├─ Assumptions: ${finalOutput.assumptions.length}`);
        finalOutput.assumptions.slice(0, 5).forEach((assumption, i) => {
            console.log(`   │  ${i + 1}. ${assumption.slice(0, 60)}...`);
        });
        if (finalOutput.assumptions.length > 5) {
            console.log(`   │  ... and ${finalOutput.assumptions.length - 5} more`);
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`🏗️  ARCHITECT COMPLETE`);
        console.log(`${'═'.repeat(60)}\n`);

        await this.sendResult(jobId, {
            success: true,
            output: {
                files: [enhancedPromptPath],
                summary: `Enhanced prompt with ${finalOutput.assumptions.length} assumptions`,
            },
            result: {
                enhancedPrompt: finalOutput.enhancedPrompt,
                assumptions: finalOutput.assumptions,
                mode: payload.architectMode,
            } satisfies ArchitectResultPayload,
            ccSessionId: result.sessionId,
        });
    }

    private createCanUseTool(jobId: string, architectMode: ArchitectMode): CanUseToolFn {
        return async (toolName, input, options) => {
            if (toolName !== 'AskUserQuestion') {
                return { behavior: 'allow' as const };
            }

            console.log(`\n   📋 AskUserQuestion intercepted (${architectMode} mode) — routing to UI`);

            const questions = this.mapSDKQuestionsToPayload(input);
            console.log(`   Questions: ${questions.length}`);

            await this.send({
                type: 'clarification_request',
                to: 'manager',
                jobId,
                payload: {
                    questions,
                } satisfies ArchitectQuestionsPayload,
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

    private async pollForClarificationResponse(signal: AbortSignal): Promise<ArchitectAnswersPayload['answers']> {
        while (!signal.aborted) {
            const messages = await this.joblog.getMessages(this.id);
            for (const message of messages) {
                if (message.type === 'clarification_response') {
                    await this.joblog.markMessageProcessed(message.id);
                    const payload = message.payload as ArchitectAnswersPayload;
                    return payload.answers;
                }
                await this.joblog.markMessageProcessed(message.id);
            }
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }
        throw new Error('Architect aborted while waiting for user answers');
    }

    private handleClarificationResponse(_message: AgentMessage): void {
    }

    private buildPrompt(userTask: string, architectMode: ArchitectMode, isNewProject: boolean, enhancedPromptPath: string): string {
        const projectContext = isNewProject
            ? 'This is a new/empty project — there is no existing codebase to explore.'
            : 'This is an existing project. Read the codebase first to understand what exists.';

        const modeGuidance = architectMode === 'quick'
            ? `Be quick:
1. Explore the codebase to understand what's relevant to the request.
2. Ask 1-2 targeted clarifying questions about feature behavior, scope, or UX — not about stack or technology choices. Keep it brief — no suggestions, just clarify ambiguities.
3. Write the enhanced prompt.`
            : `Be thorough:
1. Explore the codebase deeply to understand structure, patterns, and conventions relevant to the request.
2. Ask clarifying questions about feature behavior, scope, edge cases, and UX — where a wrong assumption would lead to wasted work. Never ask about technology stack, frameworks, or tooling — infer those from the codebase.
3. Then suggest ideas that could improve the user's request. Present each suggestion as a question the user can accept or reject (e.g. "Would you also like X? I noticed your app already has Y which could support this."). The user will see each as a selectable card.
4. Write the enhanced prompt incorporating all answers.`;

        return `## User's Request
${userTask}

## Context
${projectContext}

## Mode
${modeGuidance}

## Output Path
Write the enhanced prompt to this exact path using the Write tool:
${enhancedPromptPath}

Use AskUserQuestion for all questions — the UI routes them to the user.`;
    }

    private parseEnhancedPromptFile(content: string): {
        enhancedPrompt: string;
        assumptions: string[];
    } {

        return { enhancedPrompt: content.trim(), assumptions: [] };
    }

    private extractEnhancedPromptFromTranscript(transcript: string): {
        enhancedPrompt: string;
        assumptions: string[];
    } {

        const markdownMatch = transcript.match(/```markdown\n([\s\S]*?)\n```/);
        if (markdownMatch) {
            return this.parseEnhancedPromptFile(markdownMatch[1]);
        }

        console.log(`   ⚠️  Using fallback: transcript as enhanced prompt`);
        return {
            enhancedPrompt: transcript,
            assumptions: ['Unable to extract structured assumptions from transcript'],
        };
    }

    private formatEnhancedPromptFile(output: { enhancedPrompt: string; assumptions: string[] }): string {
        return output.enhancedPrompt;
    }

    private async isEmptyProject(projectPath: string): Promise<boolean> {
        try {
            const { readdir } = await import('node:fs/promises');
            const entries = await readdir(projectPath);
            const meaningful = entries.filter(e => !e.startsWith('.') && e !== 'node_modules' && e !== '.hugr');
            if (meaningful.length === 0) return true;
            const projectFiles = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml'];
            return !entries.some(e => projectFiles.includes(e));
        } catch {
            return true;
        }
    }

    private mapSDKQuestionsToPayload(input: Record<string, unknown>): ArchitectQuestionsPayload['questions'] {
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

    private async tryLoadExistingEnhancedPrompt(enhancedPromptPath: string): Promise<{
        prompt: string;
        assumptions: string[];
    } | null> {
        try {
            const content = await readFile(enhancedPromptPath, 'utf-8');
            const parsed = this.parseEnhancedPromptFile(content);
            return {
                prompt: parsed.enhancedPrompt,
                assumptions: parsed.assumptions,
            };
        } catch {
            return null;
        }
    }
}
