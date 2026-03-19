
import { EventEmitter } from 'node:events';
import type { Joblog } from '../joblog/Joblog.js';
import type { AgentMessage, JobOutput } from '../types/joblog.js';
import type { LLMProvider } from '../types/llm.js';
import { ClaudeCodeProvider } from '../llm/claude-code.js';
import type { ArchitectMode, RavenPresetConfig, AutonomyLevel, PipelineConfig, PipelineStep, RavenMode, CustomAgentConfig } from '../config/schema.js';
import { detectSessionLimit, AGENT_OUTPUT_FILES, getDefaultHandoffMessage } from '../constants.js';
import {
    getCurrentBranch,
    switchBranch,
    mergeBranch,
    commitAll,
    addWorktree,
    removeWorktree,
    abortMerge,
    deleteBranch,
    listWorktrees,
} from '../git/operations.js';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveSessionDataDir, resolveWorktreeDir } from '../paths.js';

const execFile = promisify(execFileCb);

export interface ManagerEvents {
    'job:status-changed': (data: {
        jobId: string;
        oldStatus: string;
        newStatus: string;
    }) => void;
    'session:completed': (data: {
        sessionId: string;
        durationMs: number;
        iterations: number;
        status: 'completed' | 'failed';

        ccSessionId?: string;
    }) => void;
    'session:failed': (data: { sessionId: string; error: string }) => void;
    'activity': (data: {
        type: string;
        message: string;
        agentId?: string;
        agentName?: string;
        jobId?: string;
    }) => void;
}

export interface ManagerConfig {
    joblog: Joblog;
    provider: ClaudeCodeProvider;
    pollInterval?: number;

    pipelineConfig: PipelineConfig;

    agentTeams?: boolean;
    onSessionLimited?: (data: { resetTime?: string; error: string; jobId?: string }) => void;
}

export interface SessionImage {
    id: string;
    name: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    base64: string;
}

export interface SessionFile {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    base64: string;
}

export interface SessionConfig {
    task: string;
    projectPath: string;
    autonomy: AutonomyLevel;

    targetWorktreePath?: string;

    gitMode?: 'worktrees' | 'branches' | 'local';

    resumeCCSession?: string;

    worktreeAction?: 'continue' | 'clean';

    images?: SessionImage[];

    files?: SessionFile[];
}

export interface VersionEntry {
    iteration: number;
    branch: string;
    worktreePath: string;
    timestamp: Date;
    summary?: string;
}

export interface SessionState {
    id: string;
    status: 'running' | 'paused' | 'completed' | 'failed' | 'session_limited';
    task: string;
    projectPath: string;
    autonomy: AutonomyLevel;
    startedAt: Date;
    completedAt?: Date;
    currentPhase: 'architect' | 'hugr-skill-creator' | 'coding' | 'raven' | 'reviewer' | 'merging' | 'complete';
    originalPrompt: string;
    enhancedPrompt?: string;
    currentIteration: number;

    targetWorktreePath?: string;

    gitMode: 'worktrees' | 'branches' | 'local';

    versions: VersionEntry[];

    pipelineConfig: PipelineConfig;

    currentStepIndex?: number;
    sessionLimitInfo?: {
        hitAt: Date;
        resetTime?: string;
        lastJobId?: string;
        errorMessage?: string;
    };

    ccSessionId?: string;

    continueFromIteration?: number;

    images?: SessionImage[];

    files?: SessionFile[];

    filePaths?: string[];

    pendingIteration?: number;

    stepResults?: Array<{ agentName: string; summary: string }>;
}

export class Manager {
    private session: SessionState | null = null;
    private provider: ClaudeCodeProvider;
    private joblog: Joblog;
    private rootJobId: string | null = null;
    private pendingClarificationFrom: string | null = null;
    private pollInterval: number;
    private pipelineConfig: PipelineConfig;
    private agentTeams: boolean;
    private onSessionLimited?: (data: { resetTime?: string; error: string; jobId?: string }) => void;

    private running = false;
    private stopRequested = false;

    public readonly events = new EventEmitter();

    constructor(config: ManagerConfig) {
        this.joblog = config.joblog;
        this.provider = config.provider;
        this.pollInterval = config.pollInterval ?? 1000;
        this.pipelineConfig = config.pipelineConfig;
        this.agentTeams = config.agentTeams ?? false;
        this.onSessionLimited = config.onSessionLimited;
    }

    static buildDefaultPipeline(
        architectMode: ArchitectMode,
        ravenConfig: RavenPresetConfig,
    ): PipelineConfig {
        const steps: PipelineStep[] = [];

        if (architectMode !== 'off') {
            steps.push({
                agentId: 'architect',
                mode: architectMode,
                enabled: true,
            });
        }

        steps.push({
            agentId: 'coder',
            enabled: true,
        });

        if (ravenConfig.iterations > 0) {
            steps.push({
                agentId: 'raven',
                iterations: ravenConfig.iterations,
                loopUntilDone: ravenConfig.mode === 'auto',
                manualPause: ravenConfig.mode === 'manual',
                maxIterations: ravenConfig.maxIterations,
                enabled: true,
            });
        }

        const desc = [
            architectMode !== 'off' ? `Architect(${architectMode})` : null,
            'Coder',
            ravenConfig.iterations > 0 ? `Raven(${ravenConfig.iterations}×)` : null,
        ].filter(Boolean).join(' → ');

        return {
            id: 'default',
            name: 'Default Pipeline',
            steps,
            description: desc,
        };
    }

    async startSession(config: SessionConfig): Promise<string> {
        if (this.session?.status === 'running') {
            throw new Error('A session is already running');
        }

        const sessionId = `session-${Date.now()}`;

        this.session = {
            id: sessionId,
            status: 'running',
            task: config.task,
            projectPath: config.projectPath,
            autonomy: config.autonomy,
            startedAt: new Date(),
            currentPhase: 'architect',
            originalPrompt: config.task,
            currentIteration: 0,
            targetWorktreePath: config.targetWorktreePath,
            gitMode: config.gitMode || 'worktrees',
            versions: [],
            pipelineConfig: this.pipelineConfig,
            currentStepIndex: 0,
            ccSessionId: config.resumeCCSession,
            images: config.images,
            files: config.files,
            stepResults: [],
        };

        if (config.files && config.files.length > 0) {
            const { writeFile, mkdir } = await import('fs/promises');
            const { join } = await import('path');
            const uploadDir = join(config.projectPath, '.hugr-uploads');
            await mkdir(uploadDir, { recursive: true });
            const writtenPaths: string[] = [];
            for (const file of config.files) {
                const filePath = join(uploadDir, file.name);
                const buffer = Buffer.from(file.base64, 'base64');
                await writeFile(filePath, buffer);
                writtenPaths.push(filePath);
            }
            this.session.filePaths = writtenPaths;
        }

        console.log(`\n${'═'.repeat(70)}`);
        console.log(`📋 SESSION START: ${sessionId}`);
        console.log(`${'═'.repeat(70)}`);
        console.log(`   Task: ${config.task.slice(0, 200)}${config.task.length > 200 ? '...' : ''}`);
        console.log(`   Full task length: ${config.task.length} chars`);
        console.log(`   Project: ${config.projectPath}`);
        console.log(`   Autonomy: ${config.autonomy}`);
        console.log(`   Git mode: ${config.gitMode || 'worktrees'}`);
        console.log(`   Images: ${config.images?.length || 0}`);
        console.log(`   Files: ${config.files?.length || 0}`);
        console.log(`   Pipeline: ${this.pipelineConfig.description || this.pipelineConfig.steps.map(s => s.agentId).join(' → ')}`);
        console.log(`   Steps (${this.pipelineConfig.steps.length}):`);
        this.pipelineConfig.steps.forEach((s, i) => {
            console.log(`     ${i}: ${s.agentId} (enabled=${s.enabled}, mode=${s.mode || '-'}, loop=${s.loopUntilDone || false}${s.agentConfig ? `, config.name=${s.agentConfig.name}` : ''})`);
        });

        await this.cleanSessionData(config.projectPath);

        if (config.gitMode !== 'local') {
            if (config.worktreeAction === 'continue') {

                const nextIter = await this.findNextIteration(config.projectPath);
                this.session.currentIteration = nextIter;
                this.session.continueFromIteration = nextIter;
                console.log(`   ⏭ Continuing from iteration ${nextIter} (keeping existing worktrees)`);
            } else {

                await this.cleanStaleWorktrees(config.projectPath);
            }
        }

        const rootJob = await this.joblog.createJob({
            description: config.task,
            phase: 'root',
            complexity: 'complex',
            acceptanceCriteria: ['Task completed as requested'],
            maxAttempts: 1,
            dependencies: [],
            tags: ['root', sessionId],
        });

        this.rootJobId = rootJob.id;
        await this.persistState();

        await this.dispatchToNextStep();

        return sessionId;
    }

    async run(): Promise<void> {
        if (this.running) {
            throw new Error('Manager is already running');
        }

        this.running = true;
        this.stopRequested = false;

        try {
            while (!this.stopRequested) {
                const messages = await this.joblog.getMessages('manager');

                if (messages.length === 0) {
                    await this.sleep(this.pollInterval);
                    continue;
                }

                for (const message of messages) {
                    if (this.stopRequested) break;

                    try {
                        await this.handleMessage(message);
                    } catch (error) {
                        console.error(`Error handling message: ${error instanceof Error ? error.message : String(error)}`);
                    }

                    await this.joblog.markMessageProcessed(message.id);
                }
            }
        } finally {
            this.running = false;
        }
    }

    stop(): void {
        this.stopRequested = true;
    }

    private async dispatchToNextStep(): Promise<void> {
        if (!this.session) return;

        const pipeline = this.session.pipelineConfig;
        const stepIndex = this.session.currentStepIndex ?? 0;

        let idx = stepIndex;
        while (idx < pipeline.steps.length && !pipeline.steps[idx].enabled) {
            idx++;
        }
        console.log(`\n   🔀 dispatchToNextStep: stepIndex=${stepIndex}, resolved idx=${idx}, total steps=${pipeline.steps.length}${idx < pipeline.steps.length ? `, next agent=${pipeline.steps[idx].agentId}` : ', pipeline complete'}`);
        console.log(`   Current state: phase=${this.session.currentPhase}, iteration=${this.session.currentIteration}, enhancedPrompt=${!!this.session.enhancedPrompt} (${(this.session.enhancedPrompt || '').length} chars)`);

        if (idx >= pipeline.steps.length) {

            await this.completeSession('completed');
            return;
        }

        this.session.currentStepIndex = idx;
        const step = pipeline.steps[idx];

        switch (step.agentId) {
            case 'architect':
                await this.dispatchToArchitect();
                break;
            case 'coder':

                if (this.session.versions.length === 0) {

                    if (!this.session.enhancedPrompt) {
                        this.session.enhancedPrompt = this.session.originalPrompt;
                    }
                    await this.createFirstVersion();
                }
                await this.dispatchToCoder();
                break;
            case 'raven':
                await this.dispatchToRaven();
                break;
            case 'reviewer':
                await this.dispatchToReviewer();
                break;
            case 'hugr-skill-creator':
                await this.dispatchToSkillCreator();
                break;
            default:

                if (step.agentConfig) {
                    if (this.session.versions.length === 0) {
                        if (!this.session.enhancedPrompt) {
                            this.session.enhancedPrompt = this.session.originalPrompt;
                        }
                        await this.createFirstVersion();
                    }
                    await this.dispatchToCustomAgent(step);
                } else {
                    console.warn(`   ⚠️ Unknown agent '${step.agentId}' with no agentConfig — skipping`);
                    this.session.currentStepIndex = idx + 1;
                    await this.dispatchToNextStep();
                }
                break;
        }
    }

    private async advanceToNextStep(): Promise<void> {
        if (!this.session) return;
        this.session.currentStepIndex = (this.session.currentStepIndex ?? 0) + 1;
        await this.dispatchToNextStep();
    }

    private async dispatchToArchitect(): Promise<void> {
        if (!this.session || !this.rootJobId) return;

        console.log(`\n${'─'.repeat(70)}`);
        console.log(`🏗️ DISPATCH → Architect (step ${this.session.currentStepIndex ?? 0})`);
        this.session.currentPhase = 'architect';
        await this.persistState();

        await this.joblog.startJob(this.rootJobId, 'architect');

        this.events.emit('job:status-changed', {
            jobId: this.rootJobId,
            oldStatus: 'pending',
            newStatus: 'in_progress',
        });

        const pipeline = this.session.pipelineConfig;
        const currentStep = pipeline.steps[this.session.currentStepIndex ?? 0];
        const architectMode = currentStep?.mode || 'thorough';

        console.log(`   Mode: ${architectMode}`);
        console.log(`   Sending originalPrompt (${this.session.originalPrompt.length} chars): ${this.session.originalPrompt.slice(0, 150)}${this.session.originalPrompt.length > 150 ? '...' : ''}`);
        console.log(`   Images: ${this.session.images?.length || 0}`);

        this.events.emit('activity', {
            type: 'starting',
            agentId: 'architect',
            message: 'Starting Architect…',
        });

        await this.send({
            type: 'task_assignment',
            to: 'architect',
            jobId: this.rootJobId,
            payload: {
                task: this.session.originalPrompt,
                projectPath: this.session.projectPath,
                architectMode,

                images: this.session.images,
                filePaths: this.session.filePaths,
            },
        });
    }

    private async dispatchToSkillCreator(): Promise<void> {
        if (!this.session || !this.rootJobId) return;

        console.log(`\n${'─'.repeat(70)}`);
        console.log(`🛠️ DISPATCH → Skill Creator (step ${this.session.currentStepIndex ?? 0})`);
        this.session.currentPhase = 'hugr-skill-creator';
        await this.persistState();

        await this.joblog.startJob(this.rootJobId, 'hugr-skill-creator');

        this.events.emit('job:status-changed', {
            jobId: this.rootJobId,
            oldStatus: 'pending',
            newStatus: 'in_progress',
        });

        this.events.emit('activity', {
            type: 'starting',
            agentId: 'hugr-skill-creator',
            message: 'Starting Skill Creator…',
        });

        await this.send({
            type: 'task_assignment',
            to: 'hugr-skill-creator',
            jobId: this.rootJobId,
            payload: {
                task: this.session.originalPrompt,
                projectPath: this.session.projectPath,
                images: this.session.images,
                filePaths: this.session.filePaths,
                resumeCCSession: this.session.ccSessionId,
            },
        });
    }

    private async dispatchToCoder(): Promise<void> {
        if (!this.session || !this.session.versions.length) return;

        const currentVersion = this.session.versions[this.session.versions.length - 1];
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`💻 DISPATCH → Coder (iteration ${this.session.currentIteration}, step ${this.session.currentStepIndex ?? 0})`);
        console.log(`   Worktree: ${currentVersion.worktreePath}`);
        console.log(`   enhancedPrompt set: ${!!this.session.enhancedPrompt} (${(this.session.enhancedPrompt || '').length} chars)`);
        console.log(`   Sending task (${(this.session.enhancedPrompt || this.session.originalPrompt).length} chars): ${(this.session.enhancedPrompt || this.session.originalPrompt).slice(0, 200)}${(this.session.enhancedPrompt || this.session.originalPrompt).length > 200 ? '...' : ''}`);
        console.log(`   Images: ${this.session.currentIteration === 0 ? (this.session.images?.length || 0) : 'none (not first iteration)'}`);
        this.session.currentPhase = 'coding';
        await this.persistState();

        const coderJob = await this.joblog.createSubtask(this.rootJobId!, {
            description: `Implement: ${this.session.originalPrompt.slice(0, 100)}`,
            phase: 'implementation',
            complexity: 'complex',
            acceptanceCriteria: ['Implementation complete'],
            maxAttempts: 1,
            dependencies: [],
        });

        await this.joblog.startJob(coderJob.id, 'coder');

        this.events.emit('job:status-changed', {
            jobId: coderJob.id,
            oldStatus: 'pending',
            newStatus: 'in_progress',
        });

        this.events.emit('activity', {
            type: 'starting',
            agentId: 'coder',
            message: `Starting Coder (iteration ${this.session.currentIteration})…`,
            iteration: this.session.currentIteration,
        });

        await this.send({
            type: 'task_assignment',
            to: 'coder',
            jobId: coderJob.id,
            payload: {
                task: this.session.enhancedPrompt || this.session.originalPrompt,
                projectPath: currentVersion.worktreePath,
                sessionProjectPath: this.session.projectPath,
                iteration: this.session.currentIteration,
                originalPrompt: this.session.originalPrompt,

                resumeCCSession: undefined,

                images: this.session.currentIteration === 0 ? this.session.images : undefined,
                filePaths: this.session.currentIteration === 0 ? this.session.filePaths : undefined,
            },
        });
    }

    private async dispatchToRaven(): Promise<void> {
        if (!this.session) return;
        if (!this.session.versions.length) {
            console.warn(`   ⚠️ Raven dispatch skipped: no versions exist yet (Coder must run before Raven). Advancing pipeline.`);
            await this.advanceToNextStep();
            return;
        }

        const currentVersion = this.session.versions[this.session.versions.length - 1];
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`🐦 DISPATCH → Raven (iteration ${this.session.currentIteration}, step ${this.session.currentStepIndex ?? 0})`);
        console.log(`   Worktree: ${currentVersion.worktreePath}`);
        console.log(`   originalPrompt (${this.session.originalPrompt.length} chars): ${this.session.originalPrompt.slice(0, 150)}${this.session.originalPrompt.length > 150 ? '...' : ''}`);
        console.log(`   currentPrompt (enhancedPrompt) (${(this.session.enhancedPrompt || this.session.originalPrompt).length} chars): ${(this.session.enhancedPrompt || this.session.originalPrompt).slice(0, 150)}...`);
        console.log(`   Previous summaries: ${this.session.versions.filter(v => v.summary).length}`);
        this.session.currentPhase = 'raven';
        await this.persistState();

        const ravenJob = await this.joblog.createSubtask(this.rootJobId!, {
            description: 'Review and suggest improvements',
            phase: 'review',
            complexity: 'complex',
            acceptanceCriteria: ['Review complete'],
            maxAttempts: 1,
            dependencies: [],
        });

        await this.joblog.startJob(ravenJob.id, 'raven');

        this.events.emit('activity', {
            type: 'starting',
            agentId: 'raven',
            message: `Starting Raven review (iteration ${this.session.currentIteration})…`,
            iteration: this.session.currentIteration,
        });

        await this.send({
            type: 'raven_request',
            to: 'raven',
            jobId: ravenJob.id,
            payload: {
                projectPath: currentVersion.worktreePath,
                sessionProjectPath: this.session.projectPath,
                worktreePath: currentVersion.worktreePath,
                originalPrompt: this.session.originalPrompt,
                currentPrompt: this.session.enhancedPrompt || this.session.originalPrompt,
                iteration: this.session.currentIteration,
                previousSummaries: this.session.versions
                    .filter(v => v.summary)
                    .map(v => v.summary!),
            },
        });
    }

    private async dispatchToReviewer(): Promise<void> {
        if (!this.session) return;

        const workDir = this.session.versions.length > 0
            ? this.session.versions[this.session.versions.length - 1].worktreePath
            : (this.session.targetWorktreePath || this.session.projectPath);

        console.log(`\n📋 Reviewer analysis phase`);
        this.session.currentPhase = 'reviewer';
        await this.persistState();

        const reviewerJob = await this.joblog.createSubtask(this.rootJobId!, {
            description: 'Code review and analysis',
            phase: 'review',
            complexity: 'simple',
            acceptanceCriteria: ['Review complete'],
            maxAttempts: 1,
            dependencies: [],
        });

        await this.joblog.startJob(reviewerJob.id, 'reviewer');

        this.events.emit('activity', {
            type: 'starting',
            agentId: 'reviewer',
            message: 'Starting Reviewer…',
        });

        await this.send({
            type: 'reviewer_request',
            to: 'reviewer',
            jobId: reviewerJob.id,
            payload: {
                projectPath: workDir,
                sessionProjectPath: this.session.projectPath,
                originalPrompt: this.session.originalPrompt,
            },
        });
    }

    private async dispatchToCustomAgent(step: PipelineStep): Promise<void> {
        if (!this.session || !step.agentConfig) return;

        const config = step.agentConfig;

        const workDir = this.session.versions.length > 0
            ? this.session.versions[this.session.versions.length - 1].worktreePath
            : (this.session.targetWorktreePath || this.session.projectPath);

        console.log(`\n${'─'.repeat(70)}`);
        console.log(`🔧 DISPATCH → Custom Agent: ${config.name} (id=${step.agentId}, step ${this.session.currentStepIndex ?? 0})`);
        console.log(`   Work dir: ${workDir}`);
        console.log(`   Tool access: ${config.toolAccess}`);
        console.log(`   Model: ${config.model || 'default'}`);
        console.log(`   Pipeline agent: ${!!step.agentConfig}`);
        console.log(`   Can loop: ${config.canLoop || false}`);
        console.log(`   enhancedPrompt set: ${!!this.session.enhancedPrompt} (${(this.session.enhancedPrompt || '').length} chars)`);
        const taskToSend = this.session.enhancedPrompt || this.session.originalPrompt;
        console.log(`   Sending task (${taskToSend.length} chars): ${taskToSend.slice(0, 200)}${taskToSend.length > 200 ? '...' : ''}`);
        console.log(`   Previous step results: ${this.session.stepResults?.length || 0}`);
        if (this.session.stepResults?.length) {
            this.session.stepResults.forEach((r, i) => console.log(`     ${i}: ${r.agentName} → ${(r.summary || '').slice(0, 80)}`));
        }
        this.session.currentPhase = 'coding' as SessionState['currentPhase'];
        await this.persistState();

        // Ensure root job is started (Architect does this in its dispatch,
        // but if the first pipeline step is a custom agent, root job is still pending)
        if (this.rootJobId) {
            const rootJob = await this.joblog.getJob(this.rootJobId);
            if (rootJob?.status === 'pending') {
                await this.joblog.startJob(this.rootJobId, step.agentId);
            }
        }

        const customJob = await this.joblog.createSubtask(this.rootJobId!, {
            description: `${config.name}: ${this.session.originalPrompt.slice(0, 100)}`,
            phase: 'implementation',
            complexity: 'complex',
            acceptanceCriteria: ['Agent task complete'],
            maxAttempts: 1,
            dependencies: [],
        });

        await this.joblog.startJob(customJob.id, step.agentId);

        this.events.emit('job:status-changed', {
            jobId: customJob.id,
            oldStatus: 'pending',
            newStatus: 'in_progress',
            // Include agent info so frontend can attribute to the right phase
            agentId: step.agentId,
            agentName: config.name,
        });

        this.events.emit('activity', {
            type: 'starting',
            agentId: step.agentId,
            agentName: config.name,
            message: `Starting ${config.name}…`,
        });

        // Mirror preset pattern: pass clean prompt, not accumulated summaries.
        // enhancedPrompt is set by the Manager after each step completes
        // (just like Architect sets it for Coder, or Raven sets nextPrompt for Coder).
        const task = this.session.enhancedPrompt || this.session.originalPrompt;

        await this.send({
            type: 'task_assignment',
            to: step.agentId,
            jobId: customJob.id,
            payload: {
                task,
                projectPath: workDir,
                sessionProjectPath: this.session.projectPath,
                originalPrompt: this.session.originalPrompt,
                iteration: this.session.currentIteration,
                images: this.session.currentIteration === 0 ? this.session.images : undefined,
                filePaths: this.session.currentIteration === 0 ? this.session.filePaths : undefined,
            },
        });
    }

    private async handleMessage(message: AgentMessage): Promise<void> {
        if (message.from === 'manager') {
            return;
        }

        switch (message.type) {
            case 'task_result':
                await this.handleTaskResult(message);
                break;
            case 'clarification_request':
                await this.handleClarificationRequest(message);
                break;
            default:
                break;
        }
    }

    private async handleTaskResult(message: AgentMessage): Promise<void> {
        const payload = message.payload as {
            success: boolean;
            output?: JobOutput;
            error?: string;
            enhancedPrompt?: string;
            sessionLimited?: boolean;
            resetTime?: string;
            done?: boolean;
            summary?: string;
        };

        if (!message.jobId) return;

        const job = await this.joblog.getJob(message.jobId);
        if (!job) return;

        const isSessionLimited = payload.sessionLimited ||
            (payload.error && detectSessionLimit(payload.error).isLimited);

        if (isSessionLimited && payload.error) {
            await this.handleSessionLimit(message.jobId, payload.error, payload.resetTime);
            return;
        }

        if (this.session?.currentPhase === 'architect') {
            await this.handleArchitectResult(message, payload);
        } else if (this.session?.currentPhase === 'coding') {
            await this.handleCoderResult(message, payload);
        } else if (this.session?.currentPhase === 'raven') {
            await this.handleRavenResult(message, payload);
        } else if (this.session?.currentPhase === 'reviewer') {
            await this.handleReviewerResult(message, payload);
        } else if (this.session?.currentPhase === 'hugr-skill-creator') {
            await this.handleSkillCreatorResult(message, payload);
        }
    }

    private async handleArchitectResult(
        message: AgentMessage,
        payload: any
    ): Promise<void> {
        if (!this.session) return;

        if (payload.success) {
            const enhancedPrompt = payload.result?.enhancedPrompt ?? payload.enhancedPrompt;
            this.session.enhancedPrompt = enhancedPrompt || this.session.originalPrompt;
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`✅ RESULT ← Architect`);
            console.log(`   enhancedPrompt received: ${!!enhancedPrompt} (${(enhancedPrompt || '').length} chars)`);
            console.log(`   session.enhancedPrompt now (${(this.session.enhancedPrompt ?? '').length} chars): ${(this.session.enhancedPrompt ?? '').slice(0, 200)}${(this.session.enhancedPrompt ?? '').length > 200 ? '...' : ''}`);
            console.log(`   ccSessionId: ${payload.ccSessionId || 'none'}`);
            if (payload.result?.assumptions?.length) {
                console.log(`   Assumptions (${payload.result.assumptions.length}): ${payload.result.assumptions.slice(0, 3).join('; ').slice(0, 120)}`);
            }

            const nextIdx = (this.session.currentStepIndex ?? 0) + 1;
            const remainingSteps = this.session.pipelineConfig.steps.slice(nextIdx);
            const hasMoreSteps = remainingSteps.some(s => s.enabled);

            if (payload.ccSessionId && !hasMoreSteps) {
                this.session.ccSessionId = payload.ccSessionId;
            }

            if (!hasMoreSteps && enhancedPrompt) {
                this.events.emit('activity', {
                    type: 'agent_summary',
                    message: enhancedPrompt,
                    agentId: 'architect',
                    jobId: message.jobId,
                });
            }

            await this.advanceToNextStep();
        } else {
            console.error(`❌ Architect failed: ${payload.error}`);
            await this.joblog.completeJob(message.jobId!, {
                files: [],
                summary: payload.error || 'Architect failed',
            });
            await this.completeSession('failed', payload.error);
        }
    }

    private async handleCoderResult(
        message: AgentMessage,
        payload: any
    ): Promise<void> {
        if (!this.session) return;

        const pipeline = this.session.pipelineConfig;
        const currentStep = pipeline.steps[this.session.currentStepIndex ?? 0];
        const isCustomAgent = currentStep?.agentConfig != null && !['architect', 'coder', 'raven', 'reviewer'].includes(currentStep.agentId);

        if (payload.success && payload.output) {
            const agentName = currentStep?.agentConfig?.name || message.from || 'Coder';
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`✅ RESULT ← ${agentName} (iteration ${this.session.currentIteration}, isCustomAgent=${isCustomAgent})`);
            console.log(`   From: ${message.from}`);
            console.log(`   Files: ${payload.output.files?.length || 0}`);
            console.log(`   Summary: ${(payload.output.summary || '').slice(0, 150)}`);
            console.log(`   ccSessionId: ${payload.ccSessionId || 'none'}`);
            if (isCustomAgent) {
                console.log(`   stepOutput: ${payload.stepOutput ? JSON.stringify({ done: payload.stepOutput.done, summary: (payload.stepOutput.summary || '').slice(0, 100), findings: payload.findings?.length || 0, hasNextPrompt: !!payload.nextPrompt }) : 'none'}`);
            }
            await this.joblog.completeJob(message.jobId!, payload.output);

            if (payload.ccSessionId) {
                this.session.ccSessionId = payload.ccSessionId;
            }

            // Record step result for logging/recovery
            if (this.session.stepResults) {
                this.session.stepResults.push({
                    agentName,
                    summary: payload.output.summary || `${agentName} completed successfully`,
                });
            }

            if (isCustomAgent) {
                const summary = payload.stepOutput?.summary || payload.output?.summary || '';
                const findings = payload.findings?.length
                    ? `\n\nKey findings:\n${(payload.findings as string[]).map((f: string) => `- ${f}`).join('\n')}`
                    : '';
                const agentConfig = currentStep.agentConfig;
                const handoff = agentConfig?.handoffMessage || getDefaultHandoffMessage(agentConfig?.role);
                this.session.enhancedPrompt = `${this.session.originalPrompt}\n\n---\n${agentName} output:\n${summary}${findings}\n---\n${handoff}`;
                console.log(`   📝 PROMPT HANDOFF: Updated session.enhancedPrompt from ${agentName} ${payload.stepOutput ? '(structured)' : '(fallback summary)'}`);
                console.log(`   Handoff message: ${handoff}`);
                console.log(`   New enhancedPrompt (${this.session.enhancedPrompt.length} chars): ${this.session.enhancedPrompt.slice(0, 250)}${this.session.enhancedPrompt.length > 250 ? '...' : ''}`);
            }

            if (this.session.versions.length > 0) {
                const currentVersion = this.session.versions[this.session.versions.length - 1];
                currentVersion.summary = payload.output.summary || `Iteration ${this.session.currentIteration} complete`;

                if (this.session.gitMode !== 'local') {
                    try {
                        await commitAll(currentVersion.worktreePath, `hugr: iteration ${this.session.currentIteration}`);
                    } catch (error) {
                        console.warn(`Could not commit: ${error}`);
                    }
                }
            }

            if (this.session.versions.length > 0) {
                const currentVersion = this.session.versions[this.session.versions.length - 1];
                this.events.emit('iteration:completed', {
                    iteration: this.session.currentIteration,
                    worktreePath: currentVersion.worktreePath,
                    branch: currentVersion.branch,
                    ccSessionId: payload.ccSessionId || this.session.ccSessionId,
                });
            }

            // --- Loop logic: works for custom agents with canLoop AND for Raven-based presets ---

            // Check if THIS step (custom agent) has loopUntilDone and returned done: false
            if (isCustomAgent && currentStep.loopUntilDone && payload.done === false) {
                await this.handleCustomAgentLoop(currentStep, payload);
                return;
            }

            // For built-in presets: check if next step is Raven and we've hit the iteration cap
            const ravenStep = pipeline.steps.find(s => s.agentId === 'raven' && s.enabled);
            const fixedIterations = ravenStep?.iterations ?? 0;
            const isAutoMode = ravenStep?.loopUntilDone === true;
            const isManualMode = ravenStep?.manualPause === true;
            const isFinalIteration = !isAutoMode && !isManualMode
                && fixedIterations > 0
                && this.session.currentIteration >= fixedIterations;

            if (isFinalIteration) {
                console.log(`   ✅ Final iteration ${this.session.currentIteration} complete (${fixedIterations} configured), skipping Raven`);

                const ravenStepIdx = pipeline.steps.findIndex(s => s.agentId === 'raven' && s.enabled);
                if (ravenStepIdx >= 0) {
                    this.session.currentStepIndex = ravenStepIdx;
                }
                await this.advanceToNextStep();
            } else {

                await this.advanceToNextStep();
            }
        } else {
            const agentName = currentStep?.agentConfig?.name || 'Coder';
            console.error(`❌ ${agentName} failed: ${payload.error}`);
            await this.joblog.failJob(message.jobId!, {
                type: 'unknown',
                message: payload.error || `${agentName} failed`,
            });
            await this.completeSession('failed', payload.error || `${agentName} failed`);
        }
    }

    /**
     * Handle loop iteration for a custom agent that returned done: false.
     * This is the generic version of what handleRavenResult does for Raven.
     * When a custom agent with canLoop returns done: false + nextPrompt,
     * the Manager finds the PREVIOUS step in the pipeline and jumps back to it.
     */
    private async handleCustomAgentLoop(
        currentStep: PipelineStep,
        payload: any,
    ): Promise<void> {
        if (!this.session) return;

        const pipeline = this.session.pipelineConfig;
        const currentIdx = this.session.currentStepIndex ?? 0;
        const maxIter = currentStep.maxIterations ?? 5;
        const nextIteration = this.session.currentIteration + 1;

        if (nextIteration > maxIter) {
            console.log(`   ⚠️ Custom loop iteration cap reached (${nextIteration}/${maxIter}), advancing`);
            await this.advanceToNextStep();
            return;
        }

        console.log(`   🔄 ${currentStep.agentConfig?.name || 'Agent'} wants iteration ${nextIteration} — looping back`);

        // Find the step to loop back to: the step immediately before this one
        let loopTargetIdx = -1;
        for (let i = currentIdx - 1; i >= 0; i--) {
            if (pipeline.steps[i].enabled) {
                loopTargetIdx = i;
                break;
            }
        }

        if (loopTargetIdx < 0) {
            // No previous step to loop to — re-dispatch to self
            console.log(`   ⚠️ No previous step to loop to, re-dispatching to self`);
            loopTargetIdx = currentIdx;
        }

        // Update session state
        this.session.currentIteration = nextIteration;
        this.session.enhancedPrompt = payload.nextPrompt || this.session.enhancedPrompt;

        // Create new worktree for the iteration
        await this.createVersionWorktree(nextIteration);

        // Jump back to the target step
        const targetStep = pipeline.steps[loopTargetIdx];
        this.session.currentStepIndex = loopTargetIdx;

        switch (targetStep.agentId) {
            case 'architect':
                await this.dispatchToArchitect();
                break;
            case 'coder':
                await this.dispatchToCoder();
                break;
            case 'raven':
                await this.dispatchToRaven();
                break;
            case 'reviewer':
                await this.dispatchToReviewer();
                break;
            case 'hugr-skill-creator':
                await this.dispatchToSkillCreator();
                break;
            default:
                if (targetStep.agentConfig) {
                    await this.dispatchToCustomAgent(targetStep);
                } else {
                    await this.dispatchToNextStep();
                }
                break;
        }
    }

    private async handleRavenResult(
        message: AgentMessage,
        payload: any
    ): Promise<void> {
        if (!this.session) return;

        if (payload.success) {
            const isDone = payload.done === true;
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`✅ RESULT ← Raven (done=${isDone})`);
            console.log(`   Summary: ${(payload.summary || '').slice(0, 150)}`);
            if (!isDone && payload.nextPrompt) {
                console.log(`   nextPrompt (${payload.nextPrompt.length} chars): ${payload.nextPrompt.slice(0, 200)}${payload.nextPrompt.length > 200 ? '...' : ''}`);
            }

            await this.joblog.completeJob(message.jobId!, {
                files: [],
                summary: payload.summary || 'Review complete',
            });

            if (payload.summary && this.session.versions.length > 0) {
                this.session.versions[this.session.versions.length - 1].summary = payload.summary;
            }

            if (isDone) {
                await this.advanceToNextStep();
                return;
            }

            const pipeline = this.session.pipelineConfig;
            const ravenStep = pipeline.steps[this.session.currentStepIndex ?? 0];
            const fixedIterations = ravenStep?.iterations ?? 0;
            const isAutoMode = ravenStep?.loopUntilDone === true;
            const isManualMode = ravenStep?.manualPause === true;

            const nextIteration = this.session.currentIteration + 1;
            const withinFixedCount = nextIteration <= fixedIterations;

            const canIterate = isAutoMode || isManualMode || withinFixedCount;

            if (canIterate) {
                if (isManualMode) {

                    this.session.enhancedPrompt = payload.nextPrompt || this.session.enhancedPrompt;
                    this.session.pendingIteration = nextIteration;

                    this.events.emit('activity', {
                        type: 'raven-awaiting-approval',
                        iteration: this.session.currentIteration,
                        message: `Raven wants to iterate (cycle ${nextIteration}) — resume to continue or stop the session.`,
                    });
                    console.log(`   ⏸️  Manual mode: pausing for user approval before iteration ${nextIteration}`);

                    return;
                }

                const coderStepIdx = pipeline.steps.findIndex(s => s.agentId === 'coder' && s.enabled);

                this.session.currentIteration = nextIteration;
                this.session.enhancedPrompt = payload.nextPrompt || this.session.enhancedPrompt;
                console.log(`   📝 RAVEN LOOP: iteration ${nextIteration}, updated enhancedPrompt (${(this.session.enhancedPrompt ?? '').length} chars): ${(this.session.enhancedPrompt ?? '').slice(0, 200)}...`);
                await this.createVersionWorktree(this.session.currentIteration);

                if (coderStepIdx >= 0) {
                    console.log(`   Jumping back to coder step (index ${coderStepIdx})`);
                    this.session.currentStepIndex = coderStepIdx;
                    await this.dispatchToCoder();
                } else {

                    await this.advanceToNextStep();
                }
            } else {

                console.log(`   ⚠️ Iteration cap reached (${this.session.currentIteration + 1}/${fixedIterations} configured iterations), completing`);
                await this.advanceToNextStep();
            }
        } else {
            console.error(`❌ Raven failed: ${payload.error}`);
            await this.joblog.failJob(message.jobId!, {
                type: 'unknown',
                message: payload.error || 'Raven failed',
            });

            await this.advanceToNextStep();
        }
    }

    private async handleReviewerResult(
        message: AgentMessage,
        payload: any
    ): Promise<void> {
        if (!this.session) return;

        if (payload.success) {
            console.log(`✅ Reviewer analysis complete`);
            await this.joblog.completeJob(message.jobId!, {
                files: [],
                summary: payload.summary || 'Code review complete',
            });

            if (payload.ccSessionId) {
                this.session.ccSessionId = payload.ccSessionId;
            }
        } else {
            console.error(`❌ Reviewer failed: ${payload.error}`);
            await this.joblog.failJob(message.jobId!, {
                type: 'unknown',
                message: payload.error || 'Reviewer failed',
            });
        }

        await this.advanceToNextStep();
    }

    private async handleSkillCreatorResult(
        message: AgentMessage,
        payload: any
    ): Promise<void> {
        if (!this.session) return;

        if (payload.success) {
            console.log(`✅ Skill Creator complete`);
            const summary = payload.output?.summary || 'Skill creation complete';
            await this.joblog.completeJob(message.jobId!, {
                files: payload.output?.files || [],
                summary,
            });

            if (summary && summary !== 'Skill creation session complete') {
                this.events.emit('activity', {
                    type: 'agent_summary',
                    message: summary,
                    agentId: 'hugr-skill-creator',
                    jobId: message.jobId,
                });
            }

            if (payload.ccSessionId) {
                this.session.ccSessionId = payload.ccSessionId;
            }
        } else {
            console.error(`❌ Skill Creator failed: ${payload.error}`);
            await this.joblog.failJob(message.jobId!, {
                type: 'unknown',
                message: payload.error || 'Skill creation failed',
            });
        }

        await this.advanceToNextStep();
    }

    private async handleClarificationRequest(message: AgentMessage): Promise<void> {
        const payload = message.payload as {
            question?: string;
            options?: string[];
            questions?: Array<{
                question: string;
                reason: string;
                options: string[];
                defaultAnswer: string;
            }>;
        };

        if (this.session?.autonomy === 'auto') {

            if (payload.questions && payload.questions.length > 0) {
                const answers = payload.questions.map(q => ({
                    question: q.question,
                    answer: q.defaultAnswer || q.options?.[0] || 'proceed with default approach',
                    skipped: false,
                }));
                await this.send({
                    type: 'clarification_response',
                    to: message.from,
                    jobId: message.jobId,
                    payload: { answers },
                });
            } else {

                const answer = payload.options?.[0] ?? 'proceed with default approach';
                await this.send({
                    type: 'clarification_response',
                    to: message.from,
                    jobId: message.jobId,
                    payload: { answer },
                });
            }
        } else {

            this.pendingClarificationFrom = message.from;

            if (payload.questions && payload.questions.length > 0) {
                console.log(`\n❓ ${message.from} has ${payload.questions.length} question(s) for the user — forwarding to UI`);
                this.events.emit('activity', {
                    type: 'clarification_request',
                    message: `${message.from} has ${payload.questions.length} question(s)`,
                    details: JSON.stringify(payload.questions),
                    agentId: message.from,
                    jobId: message.jobId,
                });
            } else if (payload.question) {
                console.log(`\n❓ ${payload.question}`);
                this.events.emit('activity', {
                    type: 'clarification_request',
                    message: payload.question,
                    details: JSON.stringify([{
                        question: payload.question,
                        reason: '',
                        options: payload.options ?? [],
                        defaultAnswer: payload.options?.[0] ?? '',
                    }]),
                    agentId: message.from,
                    jobId: message.jobId,
                });
            }
        }
    }

    private async createFirstVersion(): Promise<void> {
        if (!this.session) return;

        if (this.session.gitMode === 'local') {
            const workDir = this.session.targetWorktreePath || this.session.projectPath;
            const version: VersionEntry = {
                iteration: 0,
                branch: 'local',
                worktreePath: workDir,
                timestamp: new Date(),
            };
            this.session.versions.push(version);
            this.session.currentIteration = 0;
            await this.persistState();
            console.log(`   ✔ Local mode: working in ${workDir}`);
            return;
        }

        if (this.session.targetWorktreePath) {
            const worktreePath = this.session.targetWorktreePath;

            let branch = 'hugr/v-0';
            try {
                const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath });
                branch = stdout.trim();
            } catch {

            }

            const match = branch.match(/^hugr\/v-(\d+)$/);
            const iteration = match ? parseInt(match[1], 10) : 0;

            const version: VersionEntry = {
                iteration,
                branch,
                worktreePath,
                timestamp: new Date(),
            };

            this.session.versions.push(version);
            this.session.currentIteration = iteration;
            await this.persistState();

            console.log(`   ✔ Using existing worktree: ${branch} (${worktreePath})`);
            return;
        }

        const startIteration = this.session.currentIteration || 0;
        await this.createVersionWorktree(startIteration);
    }

    private async createVersionWorktree(iteration: number): Promise<void> {
        if (!this.session) return;

        if (this.session.gitMode === 'local') {

            this.session.ccSessionId = undefined;

            const workDir = this.session.targetWorktreePath || this.session.projectPath;
            const version: VersionEntry = {
                iteration,
                branch: 'local',
                worktreePath: workDir,
                timestamp: new Date(),
            };
            this.session.versions.push(version);
            this.session.currentIteration = iteration;
            await this.persistState();
            console.log(`   ✔ Local mode: iteration ${iteration} in ${workDir}`);
            return;
        }

        this.session.ccSessionId = undefined;

        const projectPath = this.session.projectPath;
        const branchName = `hugr/v-${iteration}`;
        const worktreePath = join(resolveWorktreeDir(projectPath), `v-${iteration}`);

        try {

            try {
                await execFile('git', ['rev-parse', 'HEAD'], { cwd: projectPath });
            } catch {
                await commitAll(projectPath, 'chore: initial commit (hugr)');

                try {
                    await execFile('git', ['rev-parse', 'HEAD'], { cwd: projectPath });
                } catch {
                    await execFile('git', ['commit', '--allow-empty', '--no-verify', '-m', 'chore: initial commit (hugr)'], { cwd: projectPath });
                }
            }

            const continueFrom = this.session.continueFromIteration;
            const isFirstOfContinueSession = continueFrom !== undefined && iteration === continueFrom;
            const startPoint = (iteration > 0 && !isFirstOfContinueSession)
                ? `hugr/v-${iteration - 1}`
                : undefined;

            await addWorktree(projectPath, worktreePath, branchName, startPoint);

            const version: VersionEntry = {
                iteration,
                branch: branchName,
                worktreePath,
                timestamp: new Date(),
            };

            this.session.versions.push(version);
            this.session.currentIteration = iteration;
            await this.persistState();

            console.log(`   ✔ Worktree: ${branchName}`);
        } catch (error) {
            console.error(`Failed to create version worktree: ${error}`);
            throw error;
        }
    }

    private async findNextIteration(projectPath: string): Promise<number> {
        try {
            const { stdout } = await execFile(
                'git',
                ['for-each-ref', '--format=%(refname:short)', 'refs/heads/hugr/'],
                { cwd: projectPath },
            );
            const iterations = stdout.trim().split('\n').filter(Boolean)
                .map(b => b.match(/^hugr\/v-(\d+)$/))
                .filter((m): m is RegExpMatchArray => m !== null)
                .map(m => parseInt(m[1], 10));
            return iterations.length > 0 ? Math.max(...iterations) + 1 : 0;
        } catch {
            return 0;
        }
    }

    private async cleanSessionData(projectPath: string): Promise<void> {
        const dataDir = resolveSessionDataDir(projectPath);
        const staleFiles = [
            AGENT_OUTPUT_FILES.enhancedPrompt,
            AGENT_OUTPUT_FILES.ravenReview,
            AGENT_OUTPUT_FILES.currentTask,
            AGENT_OUTPUT_FILES.currentHook,
            AGENT_OUTPUT_FILES.interrupt,
            AGENT_OUTPUT_FILES.stepOutput,
            'session-state.json',
        ];

        for (const file of staleFiles) {
            try {
                await unlink(join(dataDir, file));
            } catch {

            }
        }

        console.log(`   🧹 Cleaned stale session data`);
    }

    private async cleanStaleWorktrees(projectPath: string): Promise<void> {
        try {

            const worktreeDir = resolveWorktreeDir(projectPath);
            const worktrees = await listWorktrees(projectPath);
            for (const wt of worktrees) {

                if (wt.startsWith(worktreeDir)) {
                    try {
                        await removeWorktree(projectPath, wt);
                    } catch {

                    }
                }
            }

            const { stdout } = await execFile(
                'git',
                ['for-each-ref', '--format=%(refname:short)', 'refs/heads/hugr/'],
                { cwd: projectPath },
            );
            const branches = stdout.trim().split('\n').filter(Boolean);
            for (const branch of branches) {
                try {
                    await deleteBranch(projectPath, branch);
                } catch {

                }
            }

            if (branches.length > 0) {
                console.log(`   🧹 Cleaned ${branches.length} stale hugr branch(es)`);
            }
        } catch {

        }
    }

    private async persistState(): Promise<void> {
        if (!this.session) return;

        try {
            const dataDir = resolveSessionDataDir(this.session.projectPath);
            await mkdir(dataDir, { recursive: true });
            const statePath = join(dataDir, 'session-state.json');

            const serializable = {
                ...this.session,
                startedAt: this.session.startedAt.toISOString(),
                completedAt: this.session.completedAt?.toISOString(),
                versions: this.session.versions.map(v => ({
                    ...v,
                    timestamp: v.timestamp.toISOString(),
                })),
            };

            await writeFile(statePath, JSON.stringify(serializable, null, 2), 'utf-8');
        } catch (error) {
            console.warn(`Failed to persist state: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    static async loadPersistedState(projectPath: string): Promise<SessionState | null> {
        try {
            const dataDir = resolveSessionDataDir(projectPath);
            const statePath = join(dataDir, 'session-state.json');
            const raw = await readFile(statePath, 'utf-8');
            const parsed = JSON.parse(raw);

            return {
                ...parsed,
                startedAt: new Date(parsed.startedAt),
                completedAt: parsed.completedAt ? new Date(parsed.completedAt) : undefined,
                versions: parsed.versions.map((v: any) => ({
                    ...v,
                    timestamp: new Date(v.timestamp),
                })),
                sessionLimitInfo: parsed.sessionLimitInfo
                    ? {
                        ...parsed.sessionLimitInfo,
                        hitAt: new Date(parsed.sessionLimitInfo.hitAt),
                    }
                    : undefined,
            };
        } catch {
            return null;
        }
    }

    private async handleSessionLimit(jobId: string, error: string, resetTime?: string): Promise<void> {
        if (!this.session) return;

        const limit = detectSessionLimit(error);
        const time = resetTime || limit.resetTime;

        console.warn(`\n⚠️ Session limit reached${time ? ` — resets ${time}` : ''}`);
        console.warn(`   Paused. Run 'hugr resume' when limits reset.`);

        this.session.status = 'session_limited';
        this.session.sessionLimitInfo = {
            hitAt: new Date(),
            lastJobId: jobId,
            errorMessage: error.slice(0, 200),
            resetTime: time,
        };

        await this.persistState();

        if (this.onSessionLimited) {
            this.onSessionLimited({
                resetTime: time,
                error: error.slice(0, 200),
                jobId,
            });
        }
    }

    async resumeSession(): Promise<void> {
        if (this.session?.status === 'paused' || this.session?.status === 'session_limited') {
            this.session.status = 'running';

            if (this.session.pendingIteration != null) {
                const nextIteration = this.session.pendingIteration;
                this.session.pendingIteration = undefined;
                this.session.currentIteration = nextIteration;

                console.log(`   ▶️  Manual mode: user approved iteration ${nextIteration}, resuming Coder`);
                await this.createVersionWorktree(nextIteration);

                const coderStepIdx = this.session.pipelineConfig.steps.findIndex(
                    s => s.agentId === 'coder' && s.enabled,
                );
                if (coderStepIdx >= 0) {
                    this.session.currentStepIndex = coderStepIdx;
                    await this.persistState();
                    await this.dispatchToCoder();
                } else {
                    await this.advanceToNextStep();
                }
                return;
            }

            await this.persistState();
        }
    }

    async resumeFromState(state: SessionState, rootJobId: string): Promise<void> {

        const legacyState = state as any;
        const pipelineConfig = state.pipelineConfig ?? Manager.buildDefaultPipeline(
            legacyState.architectMode ?? 'thorough',
            legacyState.ravenConfig ?? { iterations: 1, mode: 'fixed' as const, maxIterations: 3 },
        );

        this.session = {
            ...state,
            status: 'running',
            pipelineConfig,
        };
        this.rootJobId = rootJobId;
        await this.persistState();

        const phase = state.currentPhase;

        if (phase === 'architect') {

            await this.dispatchToArchitect();
        } else if (phase === 'coding') {

            if (this.session.versions.length === 0) {
                await this.createFirstVersion();
            }
            await this.dispatchToCoder();
        } else if (phase === 'raven') {

            await this.dispatchToRaven();
        } else if (phase === 'reviewer') {

            await this.dispatchToReviewer();
        } else if (phase === 'complete') {

            await this.completeSession('completed');
        } else {

            if (this.session.versions.length === 0) {
                await this.createFirstVersion();
            }
            await this.dispatchToCoder();
        }
    }

    pauseSession(): void {
        if (this.session) {
            this.session.status = 'paused';
        }
    }

    async completeSession(status: 'completed' | 'failed' = 'completed', error?: string): Promise<void> {
        if (!this.session) return;

        this.session.status = status;
        this.session.completedAt = new Date();
        this.session.currentPhase = 'complete';

        const durationMs = Date.now() - this.session.startedAt.getTime();
        const durationSec = (durationMs / 1000).toFixed(1);

        const versionCount = this.session.versions.length;
        const mins = Math.floor(durationMs / 60000);
        const secs = Math.round((durationMs % 60000) / 1000);
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${durationSec}s`;

        if (status === 'completed') {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`✅ SESSION COMPLETE`);
            console.log(`${'═'.repeat(60)}`);
            console.log(`   Iterations: ${versionCount}`);
            console.log(`   Duration:   ${timeStr}`);
            console.log(`${'═'.repeat(60)}`);
        } else {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`❌ SESSION FAILED: ${error}`);
            console.log(`${'═'.repeat(60)}`);
        }

        if (this.rootJobId) {
            try {
                const rootJob = await this.joblog.getJob(this.rootJobId);
                if (rootJob?.status === 'pending') {
                    await this.joblog.startJob(this.rootJobId, 'session');
                }
                if (status === 'completed') {
                    await this.joblog.completeJob(this.rootJobId, {
                        files: [],
                        summary: `Session completed (${versionCount} iteration${versionCount !== 1 ? 's' : ''}) in ${timeStr}`,
                    });
                } else {
                    await this.joblog.failJob(this.rootJobId, {
                        type: 'unknown',
                        message: error || 'Session failed',
                    });
                }
            } catch (e) {
                console.debug(`   Could not update root job: ${e instanceof Error ? e.message : e}`);
            }
        }

        await this.persistState();

        this.events.emit('session:completed', {
            sessionId: this.session.id,
            durationMs: durationMs,
            iterations: this.session.versions.length,
            status,
            ccSessionId: this.session.ccSessionId,
        });
    }

    getSession(): SessionState | null {
        return this.session;
    }

    async submitArchitectAnswers(answers: Array<{ question: string; answer: string; skipped: boolean }>): Promise<void> {
        if (!this.rootJobId) return;

        const targetAgent = this.pendingClarificationFrom || 'architect';
        this.pendingClarificationFrom = null;

        await this.send({
            type: 'clarification_response',
            to: targetAgent,
            jobId: this.rootJobId,
            payload: {
                answers,
                projectPath: this.session?.projectPath,
                originalDescription: this.session?.originalPrompt,
            },
        });
    }

    getVersions(): VersionEntry[] {
        return this.session?.versions ?? [];
    }

    async getBaseBranch(): Promise<string> {
        if (!this.session) throw new Error('No active session');
        return getCurrentBranch(this.session.projectPath);
    }

    async mergeVersion(branch: string): Promise<{ success: boolean; conflicts?: string[]; error?: string }> {
        if (!this.session) return { success: false, error: 'No active session' };

        const projectPath = this.session.projectPath;
        const version = this.session.versions.find(v => v.branch === branch);

        try {

            if (version) {
                try {
                    await commitAll(version.worktreePath, `hugr: pre-merge commit (${branch})`);
                } catch {

                }

                try {
                    await removeWorktree(projectPath, version.worktreePath);
                } catch {

                }
            }

            const baseBranch = await getCurrentBranch(projectPath);
            try {
                await switchBranch(projectPath, baseBranch);
            } catch {

            }

            const result = await mergeBranch(projectPath, branch);

            if (result.success) {
                console.log(`✅ Merged ${branch} into ${baseBranch}`);
                return { success: true };
            } else if (result.conflicts && result.conflicts.length > 0) {
                console.error(`⚠️ Merge conflicts: ${result.conflicts.join(', ')}`);
                await abortMerge(projectPath);
                return { success: false, conflicts: result.conflicts };
            } else {
                return { success: false, error: result.error || 'Merge failed' };
            }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    private async send(message: Omit<AgentMessage, 'id' | 'timestamp' | 'processed' | 'from'>): Promise<void> {
        await this.joblog.sendMessage({
            ...message,
            from: 'manager',
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
