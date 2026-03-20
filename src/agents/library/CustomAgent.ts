
import { Agent } from '../Agent.js';
import type { Joblog } from '../../joblog/Joblog.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { LLMProvider, StreamActivity } from '../../types/llm.js';
import type { CustomAgentConfig, ToolAccessLevel, AgentToolName } from '../../config/schema.js';
import { detectSessionLimit } from '../../constants.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { loadSkills as loadSkillsUtil } from '../../utils/skills.js';

export interface StepOutputPayload {
    done: boolean;
    summary: string;
    findings?: string[];
    nextPrompt?: string;
}

const TOOL_ACCESS_MAP: Record<ToolAccessLevel, AgentToolName[]> = {
    'full': ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    'read-only': ['Read', 'Glob', 'Grep'],
    'read-write-no-bash': ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
};

function resolveToolList(config: CustomAgentConfig): string[] {
    if (config.allowedTools && config.allowedTools.length > 0) {
        return [...config.allowedTools];
    }
    return [...TOOL_ACCESS_MAP[config.toolAccess]];
}

export type CustomAgentActivity = {
    type: 'thinking' | 'tool_use' | 'writing' | 'reviewing' | 'complete' | 'error' | 'agent_summary';
    message: string;
    tool?: string;
    file?: string;
    agentId: string;
    agentName?: string;
    jobId?: string;
    details?: string;
    tokenUsage?: { input: number; output: number };
};

export interface CustomAgentConstructorConfig {

    id: string;

    agentConfig: CustomAgentConfig;

    joblog: Joblog;

    provider: LLMProvider;

    pollInterval?: number;

    projectPath?: string;

    onActivity?: (activity: CustomAgentActivity) => void;

    agentTeams?: boolean;

    skipGitTracking?: boolean;

    /** Whether this agent is part of a multi-step pipeline (enables structured output) */
    isPipelineAgent?: boolean;
}

export class CustomAgent extends Agent {
    private readonly provider: LLMProvider;
    private readonly agentConfig: CustomAgentConfig;
    private readonly onActivity?: (activity: CustomAgentActivity) => void;
    private readonly agentTeams: boolean;
    private readonly skipGitTracking: boolean;
    private readonly isPipelineAgent: boolean;

    constructor(config: CustomAgentConstructorConfig) {
        super({
            id: config.id,
            name: config.agentConfig.name,
            joblog: config.joblog,
            llm: config.provider as unknown as LLMProvider,
            pollInterval: config.pollInterval,
            projectPath: config.projectPath,
        });

        this.provider = config.provider;
        this.agentConfig = config.agentConfig;
        this.onActivity = config.onActivity;
        this.agentTeams = config.agentTeams ?? false;
        this.skipGitTracking = config.skipGitTracking ?? false;
        this.isPipelineAgent = config.isPipelineAgent ?? false;
    }


    protected async handleMessage(message: AgentMessage): Promise<void> {
        switch (message.type) {
            case 'task_assignment':
                await this.handleTaskAssignment(message);
                break;

            case 'health_ping':
                await this.send({
                    type: 'health_pong',
                    to: message.from,
                    payload: { status: 'active', currentTask: message.jobId },
                });
                break;

            default:
                console.warn(`[${this.id}] Received unexpected message type: ${message.type}`);
        }
    }

    private async handleTaskAssignment(message: AgentMessage): Promise<void> {
        const payload = message.payload as {
            task: string;
            projectPath: string;
            sessionProjectPath?: string;
            originalPrompt?: string;
            iteration?: number;
            images?: Array<{ id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string }>;
            filePaths?: string[];
        };

        if (!message.jobId) {
            throw new Error('Task assignment without jobId');
        }

        const jobId = message.jobId;
        const config = this.agentConfig;

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`🔧 CUSTOM AGENT STARTING: ${config.name}`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`   Agent ID: ${this.id}`);
        console.log(`   Job ID: ${jobId}`);
        console.log(`   Project: ${payload.projectPath}`);
        console.log(`   Tool Access: ${config.toolAccess}`);
        console.log(`   Model: ${config.model || 'default'}`);

        console.log(`   Self-Review: ${config.selfReview ? 'enabled' : 'disabled'}`);
        console.log(`   Task (${payload.task.length} chars): ${payload.task.slice(0, 250)}${payload.task.length > 250 ? '...' : ''}`);
        console.log(`   Original prompt: ${payload.originalPrompt ? `${payload.originalPrompt.slice(0, 100)}...` : 'not provided'}`);
        console.log(`   Session project: ${payload.sessionProjectPath || 'same as project'}`);
        console.log(`   Iteration: ${payload.iteration ?? 0}`);
        console.log(`   Images: ${payload.images?.length || 0}`);
        console.log(`   Pipeline agent: ${this.isPipelineAgent}`);
        console.log(`${'─'.repeat(60)}`);

        try {

            let context = config.instructions || '';
            console.log(`   Instructions (${(config.instructions || '').length} chars): ${(config.instructions || '').slice(0, 150)}${(config.instructions || '').length > 150 ? '...' : ''}`);
            if (!context.includes('Do not ask clarifying questions')) {
                context += '\n\nIMPORTANT: Do not ask clarifying questions. Make reasonable assumptions and proceed.';
            }

            let taskPrompt = payload.task;
            if (this.isPipelineAgent) {
                const canLoop = config.canLoop === true;
                context += `\n\nCRITICAL REQUIREMENT: You are part of a multi-agent pipeline. Your FINAL message MUST end with the following JSON handoff block. This is mandatory — without it, the next agent cannot receive your work. Do your work first, then end with:

\`\`\`json
{
  "done": ${canLoop ? 'true or false (false if you think another pass is needed)' : 'true'},
  "summary": "A detailed handoff for the next agent. Describe what you did, what the current state of the project is, and what the next agent should focus on or be aware of.",
  "findings": ["Key finding 1", "Key finding 2"],
  ${canLoop ? '"nextPrompt": "ONLY if done is false. Specific, actionable instructions for what the previous agent should fix or redo."' : '"nextPrompt": null'}
}
\`\`\``;
            }

            let skillContent: string | undefined;
            if (config.skills && config.skills.length > 0) {
                skillContent = await loadSkillsUtil(config.skills);
            }

            const allowedTools = resolveToolList(config);

            console.log(`   📤 CUSTOM AGENT PROMPT TO CLAUDE CODE:`);
            console.log(`   Task (${taskPrompt.length} chars): ${taskPrompt.slice(0, 400)}${taskPrompt.length > 400 ? '...' : ''}`);
            console.log(`   Context (${context.length} chars): ${context.slice(0, 300)}${context.length > 300 ? '...' : ''}`);
            console.log(`   Allowed tools: ${allowedTools?.join(', ') || 'default'}`);
            console.log(`   Skills: ${config.skills?.join(', ') || 'none'}`);
            console.log(`   Skill content loaded: ${!!skillContent} (${(skillContent || '').length} chars)`);

            this.onActivity?.({
                type: 'thinking',
                message: `Starting ${config.name}: ${payload.task.slice(0, 60)}...`,
                agentId: this.id,
                agentName: this.agentConfig.name,
                jobId,
            });

            const result = await this.provider.execute({
                workdir: payload.projectPath,
                sessionProjectPath: payload.sessionProjectPath || (this.projectPath ?? payload.projectPath),
                task: taskPrompt,
                context,
                autoAccept: true,
                agentTeams: this.agentTeams,
                skillContent,
                skipGitTracking: this.skipGitTracking,
                allowedTools,
                images: payload.images,
                filePaths: payload.filePaths,
                onActivity: this.onActivity ? (streamActivity: StreamActivity) => {
                    this.handleStreamActivity(jobId, streamActivity);
                } : undefined,
            });

            console.log(`\n${'─'.repeat(60)}`);
            console.log(`🔧 ${config.name.toUpperCase()} EXECUTION COMPLETE`);
            console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
            console.log(`   Success: ${result.success}`);
            console.log(`   Files changed: ${result.filesChanged.length}`);
            if (result.filesChanged.length > 0) {
                result.filesChanged.slice(0, 5).forEach(f => console.log(`     - ${f}`));
                if (result.filesChanged.length > 5) {
                    console.log(`     ... and ${result.filesChanged.length - 5} more`);
                }
            }

            if (result.success) {

                if (config.selfReview && result.sessionId) {
                    console.log(`\n${'─'.repeat(60)}`);
                    console.log(`🔍 ${config.name.toUpperCase()} SELF-REVIEW`);
                    console.log(`${'─'.repeat(60)}`);

                    this.onActivity?.({
                        type: 'reviewing',
                        message: `${config.name} reviewing its work...`,
                        agentId: this.id,
                        agentName: this.agentConfig.name,
                        jobId,
                    });

                    const reviewResult = await this.provider.execute({
                        workdir: payload.projectPath,
                        sessionProjectPath: payload.sessionProjectPath || (this.projectPath ?? payload.projectPath),
                        task: `Review the changes you just made. Look for:
1. Missing functionality — did you implement everything?
2. Broken imports, type errors, or syntax issues
3. Runtime errors — would this work if someone ran it?
4. Missing error handling or edge cases

Fix anything you find. Be surgical — don't refactor working code, just fix what's broken.
If everything looks good, you're done.`,
                        context,
                        autoAccept: true,
                        agentTeams: this.agentTeams,
                        skillContent,
                        skipGitTracking: true,
                        allowedTools,
                        resume: result.sessionId,
                        onActivity: this.onActivity ? (streamActivity: StreamActivity) => {
                            this.handleStreamActivity(jobId, streamActivity);
                        } : undefined,
                    });

                    console.log(`   Self-review: ${reviewResult.success ? 'OK' : 'failed (non-fatal)'}`);
                    if (reviewResult.filesChanged.length > 0) {
                        console.log(`   Files fixed: ${reviewResult.filesChanged.length}`);
                    }

                    if (!reviewResult.success) {
                        const reviewLimitCheck = detectSessionLimit(reviewResult.transcript ?? '');
                        if (reviewLimitCheck.isLimited) {
                            await this.sendResult(jobId, {
                                success: false,
                                error: `Session limit reached during self-review${reviewLimitCheck.resetTime ? ` - resets ${reviewLimitCheck.resetTime}` : ''}`,
                                sessionLimited: true,
                                resetTime: reviewLimitCheck.resetTime,
                            });
                            return;
                        }
                    }
                }

                console.log(`\n${'═'.repeat(60)}`);
                console.log(`✅ ${config.name.toUpperCase()} SUCCESS`);
                console.log(`   Files changed: ${result.filesChanged.length}`);
                if (result.filesChanged.length > 0) {
                    result.filesChanged.slice(0, 10).forEach(f => console.log(`     - ${f}`));
                    if (result.filesChanged.length > 10) console.log(`     ... and ${result.filesChanged.length - 10} more`);
                }
                console.log(`   ccSessionId: ${result.sessionId || 'none'}`);
                console.log(`${'═'.repeat(60)}`);

                let stepOutput: StepOutputPayload | undefined;
                if (this.isPipelineAgent) {
                    try {
                        const transcript = result.transcript ?? '';
                        const jsonMatch = transcript.match(/```json\s*(\{[\s\S]*?"done"[\s\S]*?"summary"[\s\S]*?\})\s*```/);
                        if (jsonMatch) {
                            stepOutput = JSON.parse(jsonMatch[1]) as StepOutputPayload;
                            console.log(`   📋 STEP OUTPUT (parsed from transcript):`);
                        } else {
                            const looseMatch = transcript.match(/\{[\s\S]*"done"[\s\S]*"summary"[\s\S]*\}/);
                            if (looseMatch) {
                                stepOutput = JSON.parse(looseMatch[0]) as StepOutputPayload;
                                console.log(`   📋 STEP OUTPUT (parsed from transcript, loose match):`);
                            }
                        }
                    } catch {
                    }

                    if (!stepOutput) {
                        const transcript = (result.transcript ?? '').trim();
                        if (transcript.length > 100) {
                            stepOutput = {
                                done: true,
                                summary: transcript.slice(-4000),
                            };
                            console.warn(`   ⚠️ No step output JSON found — using last ${Math.min(transcript.length, 4000)} chars of transcript as fallback`);
                        } else {
                            console.warn(`   ⚠️ No step output found in transcript — using fallback summary`);
                        }
                    }

                    if (stepOutput) {
                        console.log(`     done: ${stepOutput.done}`);
                        console.log(`     summary (${(stepOutput.summary || '').length} chars): ${(stepOutput.summary || '').slice(0, 200)}${(stepOutput.summary || '').length > 200 ? '...' : ''}`);
                        console.log(`     findings: ${stepOutput.findings?.length || 0}`);
                        if (stepOutput.findings?.length) {
                            stepOutput.findings.slice(0, 5).forEach((f, i) => console.log(`       ${i}: ${f.slice(0, 80)}`));
                        }
                        if (stepOutput.nextPrompt) {
                            console.log(`     nextPrompt (${stepOutput.nextPrompt.length} chars): ${stepOutput.nextPrompt.slice(0, 150)}...`);
                        }
                    }
                }

                const resultPayload = {
                    success: true,
                    output: {
                        files: result.fileChanges.map(change => ({
                            path: change.path,
                            action: change.action === 'created' ? 'create' : change.action === 'deleted' ? 'delete' : 'modify',
                            summary: `${change.action} by ${config.name}`,
                        })),
                        summary: stepOutput?.summary || `${config.name} completed: ${payload.task.slice(0, 100)}`,
                    },
                    ccSessionId: result.sessionId,
                    // Pipeline-specific fields
                    ...(stepOutput ? {
                        done: stepOutput.done,
                        nextPrompt: stepOutput.nextPrompt,
                        findings: stepOutput.findings,
                        stepOutput,
                    } : {}),
                };
                console.log(`\n   📤 SENDING RESULT TO MANAGER:`);
                console.log(`   Summary: ${resultPayload.output.summary.slice(0, 150)}`);
                console.log(`   Files in result: ${resultPayload.output.files.length}`);
                if (stepOutput) {
                    console.log(`   Pipeline fields: done=${stepOutput.done}, nextPrompt=${!!stepOutput.nextPrompt}, findings=${stepOutput.findings?.length || 0}`);
                }
                await this.sendResult(jobId, resultPayload);
            } else {

                const limitCheck = detectSessionLimit(result.transcript ?? '');
                if (limitCheck.isLimited) {
                    console.log(`   ⚠️  SESSION LIMIT DETECTED`);
                    await this.sendResult(jobId, {
                        success: false,
                        error: `Session limit reached${limitCheck.resetTime ? ` - resets ${limitCheck.resetTime}` : ''}`,
                        sessionLimited: true,
                        resetTime: limitCheck.resetTime,
                    });
                    return;
                }

                if (this.isPipelineAgent) {
                    try {
                        const transcript = result.transcript ?? '';
                        const jsonMatch = transcript.match(/```json\s*(\{[\s\S]*?"done"[\s\S]*?"summary"[\s\S]*?\})\s*```/)
                            || transcript.match(/\{[\s\S]*"done"[\s\S]*"summary"[\s\S]*\}/);
                        if (jsonMatch) {
                            const raw = jsonMatch[1] || jsonMatch[0];
                            const stepOutput = JSON.parse(raw) as StepOutputPayload;
                            console.log(`   📋 Agent ended non-successfully but step output found in transcript — treating as success`);
                            console.log(`   📋 Step output: done=${stepOutput.done}, summary=${stepOutput.summary.slice(0, 80)}`);

                            await this.sendResult(jobId, {
                                success: true,
                                output: {
                                    files: result.fileChanges.map(change => ({
                                        path: change.path,
                                        action: change.action === 'created' ? 'create' : change.action === 'deleted' ? 'delete' : 'modify',
                                        summary: `${change.action} by ${config.name}`,
                                    })),
                                    summary: stepOutput.summary,
                                },
                                ccSessionId: result.sessionId,
                                done: stepOutput.done,
                                nextPrompt: stepOutput.nextPrompt,
                                findings: stepOutput.findings,
                                stepOutput,
                            });
                            return;
                        }
                    } catch {
                    }
                }

                console.log(`\n${'═'.repeat(60)}`);
                console.log(`❌ ${config.name.toUpperCase()} FAILED`);
                console.log(`${'═'.repeat(60)}\n`);

                await this.sendResult(jobId, {
                    success: false,
                    error: result.error || `${config.name} did not complete successfully`,
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ ${config.name} exception: ${errorMessage}`);

            await this.sendResult(jobId, {
                success: false,
                error: `${config.name} failed: ${errorMessage}`,
            });
        }
    }


    private handleStreamActivity(jobId: string, activity: StreamActivity): void {
        if (!this.onActivity) return;

        switch (activity.type) {
            case 'tool_start': {
                if (!activity.displayInput) break;
                const toolName = activity.toolName?.toLowerCase() ?? '';
                let activityType: CustomAgentActivity['type'] = 'tool_use';
                if (toolName.includes('write') || toolName.includes('edit')) {
                    activityType = 'writing';
                }

                const details = JSON.stringify({
                    toolName: activity.toolName,
                    displayInput: activity.displayInput,
                });

                this.onActivity({
                    type: activityType,
                    message: `${activity.toolName} ${activity.displayInput}`,
                    tool: activity.toolName,
                    agentId: this.id,
                    agentName: this.agentConfig.name,
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
                    type: 'tool_use',
                    message: activity.content || `${activity.toolName} (${activity.elapsedSeconds}s)`,
                    tool: activity.toolName,
                    agentId: this.id,
                    agentName: this.agentConfig.name,
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
                    type: 'tool_use',
                    message: activity.stat || activity.content,
                    tool: activity.toolName,
                    agentId: this.id,
                    agentName: this.agentConfig.name,
                    jobId,
                    details,
                });
                break;
            }

            case 'text': {
                if (activity.content.length > 10) {
                    this.onActivity({
                        type: 'thinking',
                        message: activity.content,
                        agentId: this.id,
                        agentName: this.agentConfig.name,
                        jobId,
                    });
                }
                break;
            }

            case 'thinking': {
                this.onActivity({
                    type: 'thinking',
                    message: activity.content,
                    agentId: this.id,
                    agentName: this.agentConfig.name,
                    jobId,
                });
                break;
            }

            case 'error': {
                this.onActivity({
                    type: 'error',
                    message: `Error: ${activity.content}`,
                    agentId: this.id,
                    agentName: this.agentConfig.name,
                    jobId,
                });
                break;
            }

            case 'result': {
                if (activity.content && activity.content !== 'Completed' && activity.content.length > 10) {
                    this.onActivity({
                        type: 'agent_summary',
                        message: activity.content,
                        agentId: this.id,
                        agentName: this.agentConfig.name,
                        jobId,
                    });
                }
                this.onActivity({
                    type: 'complete',
                    message: 'Completed',
                    agentId: this.id,
                    agentName: this.agentConfig.name,
                    jobId,
                    tokenUsage: activity.tokenUsage,
                });
                break;
            }
        }
    }
}
