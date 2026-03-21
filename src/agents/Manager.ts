
import { TypedEmitter } from '../events/emitter.js';
import type { Joblog } from '../joblog/Joblog.js';
import type { AgentMessage, JobOutput } from '../types/joblog.js';
import type { AgentRuntime } from '../runtime/types.js';
import type { VCSProvider, IsolatedWorkspace } from '../vcs/types.js';
import type { StorageProvider } from '../storage/types.js';
import type { AgentRegistry } from './registry.js';
import type { ArchitectMode, RavenPresetConfig, AutonomyLevel, PipelineConfig, PipelineStep, RavenMode, CustomAgentConfig } from '../config/schema.js';
import { detectSessionLimit, AGENT_OUTPUT_FILES, getDefaultHandoffMessage } from '../constants.js';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';

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
        providerSessionId?: string;
    }) => void;
    'session:failed': (data: { sessionId: string; error: string }) => void;
    'iteration:completed': (data: {
        iteration: number;
        workspacePath: string;
        ref: string;
        providerSessionId?: string;
    }) => void;
    'activity': (data: {
        type: string;
        message: string;
        agentId?: string;
        agentName?: string;
        jobId?: string;
        details?: string;
    }) => void;
}

export interface ManagerConfig {
    joblog: Joblog;
    runtime: AgentRuntime;
    pollInterval?: number;
    pipelineConfig: PipelineConfig;
    agentTeams?: boolean;
    onSessionLimited?: (data: { resetTime?: string; error: string; jobId?: string }) => void;
    vcs?: VCSProvider;
    storage?: StorageProvider;
    agentRegistry?: AgentRegistry;
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
    targetWorkspacePath?: string;
    isolationMode?: 'full' | 'lightweight' | 'none';
    resumeProviderSession?: string;
    workspaceAction?: 'continue' | 'clean';
    images?: SessionImage[];
    files?: SessionFile[];
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
    currentPrompt?: string;
    currentIteration: number;
    targetWorkspacePath?: string;
    isolationMode: 'full' | 'lightweight' | 'none';
    workspaces: IsolatedWorkspace[];
    pipelineConfig: PipelineConfig;
    currentStepIndex?: number;
    sessionLimitInfo?: {
        hitAt: Date;
        resetTime?: string;
        lastJobId?: string;
        errorMessage?: string;
    };
    providerSessionId?: string;
    continueFromIteration?: number;
    images?: SessionImage[];
    files?: SessionFile[];
    filePaths?: string[];
    pendingIteration?: number;
    stepResults?: Array<{ agentName: string; summary: string }>;
}

export class Manager {
    private session: SessionState | null = null;
    private runtime: AgentRuntime;
    private joblog: Joblog;
    private rootJobId: string | null = null;
    private pendingClarificationFrom: string | null = null;
    private pollInterval: number;
    private pipelineConfig: PipelineConfig;
    private agentTeams: boolean;
    private onSessionLimited?: (data: { resetTime?: string; error: string; jobId?: string }) => void;
    private vcs?: VCSProvider;
    private storage?: StorageProvider;
    private registry?: AgentRegistry;
    private running = false;
    private stopRequested = false;
    public readonly events = new TypedEmitter<ManagerEvents>();

    constructor(config: ManagerConfig) {
        this.joblog = config.joblog;
        this.runtime = config.runtime;
        this.pollInterval = config.pollInterval ?? 1000;
        this.pipelineConfig = config.pipelineConfig;
        this.agentTeams = config.agentTeams ?? false;
        this.onSessionLimited = config.onSessionLimited;
        this.vcs = config.vcs;
        this.storage = config.storage;
        this.registry = config.agentRegistry;
    }

    getSession(): SessionState | null {
        return this.session;
    }

    getWorkspaces(): IsolatedWorkspace[] {
        return this.session?.workspaces ?? [];
    }

    pauseSession(): void {
        if (this.session) {
            this.session.status = 'paused';
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
                await this.createWorkspace(nextIteration);

                const coderStepIdx = this.session.pipelineConfig.steps.findIndex(
                    (s: PipelineStep) => s.agentId === 'coder' && s.enabled,
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

    async getBaseBranch(): Promise<string> {
        if (!this.session) throw new Error('No active session');
        const { getCurrentBranch } = await import('../git/operations.js');
        return getCurrentBranch(this.session.projectPath);
    }

    async mergeVersion(branch: string): Promise<{ success: boolean; conflicts?: string[]; error?: string }> {
        if (!this.session) return { success: false, error: 'No active session' };

        const projectPath = this.session.projectPath;
        const workspace = this.session.workspaces.find((w: IsolatedWorkspace) => w.ref === branch);
        const { commitAll, removeWorktree, getCurrentBranch, switchBranch, mergeBranch, abortMerge } = await import('../git/operations.js');

        try {
            if (workspace) {
                try {
                    await commitAll(workspace.path, `hugr: pre-merge commit (${branch})`);
                } catch {}

                try {
                    await removeWorktree(projectPath, workspace.path);
                } catch {}
            }

            const baseBranch = await getCurrentBranch(projectPath);
            try {
                await switchBranch(projectPath, baseBranch);
            } catch {}

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
            targetWorkspacePath: config.targetWorkspacePath,
            isolationMode: config.isolationMode || 'full',
            workspaces: [],
            pipelineConfig: this.pipelineConfig,
            currentStepIndex: 0,
            providerSessionId: config.resumeProviderSession,
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
        console.log(`   Isolation mode: ${config.isolationMode || 'full'}`);
        console.log(`   Images: ${config.images?.length || 0}`);
        console.log(`   Files: ${config.files?.length || 0}`);
        console.log(`   Pipeline: ${this.pipelineConfig.description || this.pipelineConfig.steps.map(s => s.agentId).join(' → ')}`);
        console.log(`   Steps (${this.pipelineConfig.steps.length}):`);
        this.pipelineConfig.steps.forEach((s, i) => {
            console.log(`     ${i}: ${s.agentId} (enabled=${s.enabled}, mode=${s.mode || '-'}, loop=${s.loopUntilDone || false}${s.agentConfig ? `, config.name=${s.agentConfig.name}` : ''})`);
        });

        await this.cleanSessionData(config.projectPath);

        if (config.isolationMode !== 'none') {
            if (config.workspaceAction === 'continue') {
                const nextIter = await this.findNextIteration(config.projectPath);
                this.session.currentIteration = nextIter;
                this.session.continueFromIteration = nextIter;
                console.log(`   ⏭ Continuing from iteration ${nextIter} (keeping existing workspaces)`);
            } else {
                await this.cleanStaleWorkspaces(config.projectPath);
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
        console.log(`   Current state: phase=${this.session.currentPhase}, iteration=${this.session.currentIteration}, currentPrompt=${!!this.session.currentPrompt} (${(this.session.currentPrompt || '').length} chars)`);

        if (idx >= pipeline.steps.length) {
            await this.completeSession('completed');
            return;
        }

        this.session.currentStepIndex = idx;
        const step = pipeline.steps[idx];

        if (this.registry) {
            const handler = this.registry.get(step.agentId);
            if (handler) {
                await handler.dispatch(step, this.buildDispatchContext());
                return;
            }
        }

        switch (step.agentId) {
            case 'architect':
                await this.dispatchToArchitect();
                break;
            case 'coder':
                if (this.session.workspaces.length === 0) {
                    if (!this.session.currentPrompt) {
                        this.session.currentPrompt = this.session.originalPrompt;
                    }
                    await this.createFirstWorkspace();
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
                    if (this.session.workspaces.length === 0) {
                        if (!this.session.currentPrompt) {
                            this.session.currentPrompt = this.session.originalPrompt;
                        }
                        await this.createFirstWorkspace();
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
                resumeProviderSession: this.session.providerSessionId,
            },
        });
    }

    private async dispatchToCoder(): Promise<void> {
        if (!this.session || !this.session.workspaces.length) return;

        const currentWorkspace = this.session.workspaces[this.session.workspaces.length - 1];
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`💻 DISPATCH → Coder (iteration ${this.session.currentIteration}, step ${this.session.currentStepIndex ?? 0})`);
        console.log(`   Workspace: ${currentWorkspace.path}`);
        console.log(`   currentPrompt set: ${!!this.session.currentPrompt} (${(this.session.currentPrompt || '').length} chars)`);
        console.log(`   Sending task (${(this.session.currentPrompt || this.session.originalPrompt).length} chars): ${(this.session.currentPrompt || this.session.originalPrompt).slice(0, 200)}${(this.session.currentPrompt || this.session.originalPrompt).length > 200 ? '...' : ''}`);
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
        });

        await this.send({
            type: 'task_assignment',
            to: 'coder',
            jobId: coderJob.id,
            payload: {
                task: this.session.currentPrompt || this.session.originalPrompt,
                projectPath: currentWorkspace.path,
                sessionProjectPath: this.session.projectPath,
                iteration: this.session.currentIteration,
                originalPrompt: this.session.originalPrompt,
                resumeProviderSession: undefined,
                images: this.session.currentIteration === 0 ? this.session.images : undefined,
                filePaths: this.session.currentIteration === 0 ? this.session.filePaths : undefined,
            },
        });
    }

    private async dispatchToRaven(): Promise<void> {
        if (!this.session) return;
        if (!this.session.workspaces.length) {
            console.warn(`   ⚠️ Raven dispatch skipped: no workspaces exist yet (Coder must run before Raven). Advancing pipeline.`);
            await this.advanceToNextStep();
            return;
        }

        const currentWorkspace = this.session.workspaces[this.session.workspaces.length - 1];
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`🐦 DISPATCH → Raven (iteration ${this.session.currentIteration}, step ${this.session.currentStepIndex ?? 0})`);
        console.log(`   Workspace: ${currentWorkspace.path}`);
        console.log(`   originalPrompt (${this.session.originalPrompt.length} chars): ${this.session.originalPrompt.slice(0, 150)}${this.session.originalPrompt.length > 150 ? '...' : ''}`);
        console.log(`   currentPrompt (${(this.session.currentPrompt || this.session.originalPrompt).length} chars): ${(this.session.currentPrompt || this.session.originalPrompt).slice(0, 150)}...`);
        console.log(`   Previous summaries: ${this.session.workspaces.filter(v => v.summary).length}`);
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
        });

        await this.send({
            type: 'raven_request',
            to: 'raven',
            jobId: ravenJob.id,
            payload: {
                projectPath: currentWorkspace.path,
                sessionProjectPath: this.session.projectPath,
                workspacePath: currentWorkspace.path,
                originalPrompt: this.session.originalPrompt,
                currentPrompt: this.session.currentPrompt || this.session.originalPrompt,
                iteration: this.session.currentIteration,
                previousSummaries: this.session.workspaces
                    .filter(v => v.summary)
                    .map(v => v.summary!),
            },
        });
    }

    private async dispatchToReviewer(): Promise<void> {
        if (!this.session) return;

        const workDir = this.session.workspaces.length > 0
            ? this.session.workspaces[this.session.workspaces.length - 1].path
            : (this.session.targetWorkspacePath || this.session.projectPath);

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

        const workDir = this.session.workspaces.length > 0
            ? this.session.workspaces[this.session.workspaces.length - 1].path
            : (this.session.targetWorkspacePath || this.session.projectPath);

        console.log(`\n${'─'.repeat(70)}`);
        console.log(`🔧 DISPATCH → Custom Agent: ${config.name} (id=${step.agentId}, step ${this.session.currentStepIndex ?? 0})`);
        console.log(`   Work dir: ${workDir}`);
        console.log(`   Tool access: ${config.toolAccess}`);
        console.log(`   Model: ${config.model || 'default'}`);
        console.log(`   Pipeline agent: ${!!step.agentConfig}`);
        console.log(`   Can loop: ${config.canLoop || false}`);
        console.log(`   currentPrompt set: ${!!this.session.currentPrompt} (${(this.session.currentPrompt || '').length} chars)`);
        const taskToSend = this.session.currentPrompt || this.session.originalPrompt;
        console.log(`   Sending task (${taskToSend.length} chars): ${taskToSend.slice(0, 200)}${taskToSend.length > 200 ? '...' : ''}`);
        console.log(`   Previous step results: ${this.session.stepResults?.length || 0}`);
        if (this.session.stepResults?.length) {
            this.session.stepResults.forEach((r, i) => console.log(`     ${i}: ${r.agentName} → ${(r.summary || '').slice(0, 80)}`));
        }
        this.session.currentPhase = 'coding' as SessionState['currentPhase'];
        await this.persistState();

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
        });

        this.events.emit('activity', {
            type: 'starting',
            agentId: step.agentId,
            agentName: config.name,
            message: `Starting ${config.name}…`,
        });

        const task = this.session.currentPrompt || this.session.originalPrompt;

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
            currentPrompt?: string;
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
            const currentPrompt = payload.result?.currentPrompt ?? payload.currentPrompt;
            this.session.currentPrompt = currentPrompt || this.session.originalPrompt;
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`✅ RESULT ← Architect`);
            console.log(`   currentPrompt received: ${!!currentPrompt} (${(currentPrompt || '').length} chars)`);
            console.log(`   session.currentPrompt now (${(this.session.currentPrompt ?? '').length} chars): ${(this.session.currentPrompt ?? '').slice(0, 200)}${(this.session.currentPrompt ?? '').length > 200 ? '...' : ''}`);
            console.log(`   providerSessionId: ${payload.providerSessionId || 'none'}`);
            if (payload.result?.assumptions?.length) {
                console.log(`   Assumptions (${payload.result.assumptions.length}): ${payload.result.assumptions.slice(0, 3).join('; ').slice(0, 120)}`);
            }

            const nextIdx = (this.session.currentStepIndex ?? 0) + 1;
            const remainingSteps = this.session.pipelineConfig.steps.slice(nextIdx);
            const hasMoreSteps = remainingSteps.some(s => s.enabled);

            if (payload.providerSessionId && !hasMoreSteps) {
                this.session.providerSessionId = payload.providerSessionId;
            }

            if (!hasMoreSteps && currentPrompt) {
                this.events.emit('activity', {
                    type: 'agent_summary',
                    message: currentPrompt,
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
            console.log(`   providerSessionId: ${payload.providerSessionId || 'none'}`);
            if (isCustomAgent) {
                console.log(`   stepOutput: ${payload.stepOutput ? JSON.stringify({ done: payload.stepOutput.done, summary: (payload.stepOutput.summary || '').slice(0, 100), findings: payload.findings?.length || 0, hasNextPrompt: !!payload.nextPrompt }) : 'none'}`);
            }
            await this.joblog.completeJob(message.jobId!, payload.output);

            if (payload.providerSessionId) {
                this.session.providerSessionId = payload.providerSessionId;
            }

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
                this.session.currentPrompt = `${this.session.originalPrompt}\n\n---\n${agentName} output:\n${summary}${findings}\n---\n${handoff}`;
                console.log(`   📝 PROMPT HANDOFF: Updated session.currentPrompt from ${agentName} ${payload.stepOutput ? '(structured)' : '(fallback summary)'}`);
                console.log(`   Handoff message: ${handoff}`);
                console.log(`   New currentPrompt (${this.session.currentPrompt.length} chars): ${this.session.currentPrompt.slice(0, 250)}${this.session.currentPrompt.length > 250 ? '...' : ''}`);
            }

            if (this.session.workspaces.length > 0) {
                const currentWorkspace = this.session.workspaces[this.session.workspaces.length - 1];
                currentWorkspace.summary = payload.output.summary || `Iteration ${this.session.currentIteration} complete`;

                if (this.session.isolationMode !== 'none') {
                    try {
                        if (this.vcs) {
                            await this.vcs.commitChanges(currentWorkspace.path, `hugr: iteration ${this.session.currentIteration}`);
                        } else {
                            const { commitAll } = await import('../git/operations.js');
                            await commitAll(currentWorkspace.path, `hugr: iteration ${this.session.currentIteration}`);
                        }
                    } catch (error) {
                        console.warn(`Could not commit: ${error}`);
                    }
                }
            }

            if (this.session.workspaces.length > 0) {
                const currentWorkspace = this.session.workspaces[this.session.workspaces.length - 1];
                this.events.emit('iteration:completed', {
                    iteration: this.session.currentIteration,
                    workspacePath: currentWorkspace.path,
                    ref: currentWorkspace.ref,
                    providerSessionId: payload.providerSessionId || this.session.providerSessionId,
                });
            }

            if (isCustomAgent && currentStep.loopUntilDone && payload.done === false) {
                await this.handleCustomAgentLoop(currentStep, payload);
                return;
            }

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

        let loopTargetIdx = -1;
        for (let i = currentIdx - 1; i >= 0; i--) {
            if (pipeline.steps[i].enabled) {
                loopTargetIdx = i;
                break;
            }
        }

        if (loopTargetIdx < 0) {
            console.log(`   ⚠️ No previous step to loop to, re-dispatching to self`);
            loopTargetIdx = currentIdx;
        }

        this.session.currentIteration = nextIteration;
        this.session.currentPrompt = payload.nextPrompt || this.session.currentPrompt;

        await this.createWorkspace(nextIteration);

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
            default:
                if (targetStep.agentConfig) {
                    await this.dispatchToCustomAgent(targetStep);
                } else {
                    console.warn(`   ⚠️ Cannot loop back to unknown agent '${targetStep.agentId}'`);
                    await this.advanceToNextStep();
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
            const nextPrompt = payload.nextPrompt || payload.result?.nextPrompt;
            if (nextPrompt) {
                this.session.currentPrompt = nextPrompt;
            }

            const ravenSummary = payload.result?.summary || payload.summary || '';
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`✅ RESULT ← Raven (iteration ${this.session.currentIteration})`);
            console.log(`   Summary: ${ravenSummary.slice(0, 200)}${ravenSummary.length > 200 ? '...' : ''}`);
            console.log(`   nextPrompt provided: ${!!nextPrompt}`);
            console.log(`   Suggestions: ${payload.result?.suggestions?.length || 0}`);

            await this.joblog.completeJob(message.jobId!, {
                files: [],
                summary: ravenSummary || 'Review complete',
            });

            if (payload.providerSessionId) {
                this.session.providerSessionId = payload.providerSessionId;
            }

            const pipeline = this.session.pipelineConfig;
            const ravenStep = pipeline.steps.find((s, idx) => s.agentId === 'raven' && s.enabled && idx === (this.session?.currentStepIndex ?? 0));

            const isAutoMode = ravenStep?.loopUntilDone === true;
            const isManualMode = ravenStep?.manualPause === true;
            const maxIterations = ravenStep?.maxIterations ?? 10;

            if (payload.done === true || (this.session.currentIteration >= maxIterations)) {
                console.log(`   ✅ Raven complete (done=${payload.done}, iteration=${this.session.currentIteration}/${maxIterations})`);
                await this.advanceToNextStep();
            } else if (isAutoMode || (!isManualMode && isAutoMode)) {
                console.log(`   🔄 Raven auto-mode: looping back for iteration ${this.session.currentIteration + 1}`);

                this.session.currentIteration += 1;
                await this.createWorkspace(this.session.currentIteration);

                const coderStep = pipeline.steps.find(s => s.agentId === 'coder' && s.enabled);
                if (coderStep) {
                    const coderIdx = pipeline.steps.indexOf(coderStep);
                    this.session.currentStepIndex = coderIdx;
                    await this.dispatchToCoder();
                } else {
                    console.warn(`   ⚠️ No Coder step found in pipeline, cannot loop`);
                    await this.advanceToNextStep();
                }
            } else if (isManualMode) {
                console.log(`   ⏸️ Raven manual-mode: pausing, waiting for external loop signal`);
                await this.advanceToNextStep();
            } else {
                console.log(`   ✅ Raven complete (no loop mode set)`);
                await this.advanceToNextStep();
            }
        } else {
            console.error(`❌ Raven failed: ${payload.error}`);
            await this.joblog.failJob(message.jobId!, {
                type: 'unknown',
                message: payload.error || 'Raven failed',
            });
            await this.completeSession('failed', payload.error || 'Raven failed');
        }
    }

    private async handleReviewerResult(
        message: AgentMessage,
        payload: any
    ): Promise<void> {
        if (!this.session) return;

        if (payload.success) {
            const summary = payload.result?.summary || payload.summary || 'Review complete';
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`✅ RESULT ← Reviewer`);
            console.log(`   Summary: ${summary.slice(0, 200)}${summary.length > 200 ? '...' : ''}`);

            await this.joblog.completeJob(message.jobId!, {
                files: [],
                summary,
            });

            if (payload.providerSessionId) {
                this.session.providerSessionId = payload.providerSessionId;
            }

            await this.advanceToNextStep();
        } else {
            console.error(`❌ Reviewer failed: ${payload.error}`);
            await this.joblog.failJob(message.jobId!, {
                type: 'unknown',
                message: payload.error || 'Reviewer failed',
            });
            await this.completeSession('failed', payload.error || 'Reviewer failed');
        }
    }

    private async handleSkillCreatorResult(
        message: AgentMessage,
        payload: any
    ): Promise<void> {
        if (!this.session) return;

        if (payload.success) {
            const summary = payload.result?.summary || payload.summary || 'Skill creation complete';
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`✅ RESULT ← Skill Creator`);
            console.log(`   Summary: ${summary.slice(0, 200)}${summary.length > 200 ? '...' : ''}`);

            await this.joblog.completeJob(message.jobId!, {
                files: payload.result?.files || [],
                summary,
            });

            if (payload.providerSessionId) {
                this.session.providerSessionId = payload.providerSessionId;
            }

            await this.advanceToNextStep();
        } else {
            console.error(`❌ Skill Creator failed: ${payload.error}`);
            await this.joblog.failJob(message.jobId!, {
                type: 'unknown',
                message: payload.error || 'Skill Creator failed',
            });
            await this.completeSession('failed', payload.error || 'Skill Creator failed');
        }
    }

    private async handleClarificationRequest(message: AgentMessage): Promise<void> {
        if (!this.session) return;

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

        if (this.session.autonomy === 'auto') {
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

    private async handleSessionLimit(jobId: string, error: string, resetTime?: string): Promise<void> {
        if (!this.session) return;

        console.error(`\n❌ SESSION LIMIT DETECTED`);
        console.error(`   Error: ${error}`);
        console.error(`   Reset time: ${resetTime || 'unknown'}`);

        this.session.status = 'session_limited';
        this.session.sessionLimitInfo = {
            hitAt: new Date(),
            resetTime,
            lastJobId: jobId,
            errorMessage: error,
        };

        await this.persistState();

        if (this.onSessionLimited) {
            this.onSessionLimited({
                resetTime,
                error,
                jobId,
            });
        }
    }

    private async completeSession(status: 'completed' | 'failed', error?: string): Promise<void> {
        if (!this.session) return;

        this.session.status = status;
        this.session.completedAt = new Date();
        this.session.currentPhase = 'complete';

        const durationMs = this.session.completedAt.getTime() - this.session.startedAt.getTime();

        console.log(`\n${'═'.repeat(70)}`);
        console.log(`🏁 SESSION ${status.toUpperCase()}: ${this.session.id}`);
        console.log(`${'═'.repeat(70)}`);
        console.log(`   Duration: ${(durationMs / 1000).toFixed(1)}s`);
        console.log(`   Iterations: ${this.session.currentIteration}`);
        console.log(`   Status: ${status}`);
        if (error) {
            console.log(`   Error: ${error}`);
        }

        await this.persistState();

        if (this.rootJobId) {
            if (status === 'completed') {
                await this.joblog.completeJob(this.rootJobId, {
                    files: [],
                    summary: `Session ${status}. Iterations: ${this.session.currentIteration}`,
                });
            } else {
                await this.joblog.failJob(this.rootJobId, {
                    type: 'unknown',
                    message: error || `Session ${status}`,
                });
            }
        }

        this.events.emit('session:completed', {
            sessionId: this.session.id,
            durationMs,
            iterations: this.session.currentIteration,
            status,
            providerSessionId: this.session.providerSessionId,
        });

        this.stop();
    }

    private async createFirstWorkspace(): Promise<void> {
        if (!this.session) return;

        await this.createWorkspace(0);
    }

    private async createWorkspace(iteration: number): Promise<void> {
        if (!this.session) return;

        console.log(`\n   📦 Creating workspace for iteration ${iteration}`);

        const workspacePath = this.session.isolationMode === 'none'
            ? this.session.projectPath
            : (this.session.targetWorkspacePath || join(this.session.projectPath, `.hugr-iter-${iteration}`));

        let workspace: IsolatedWorkspace;

        if (this.vcs) {
            workspace = await this.vcs.createWorkspace({
                projectPath: this.session.projectPath,
                iteration,
                isolationMode: this.session.isolationMode,
            });
        } else {
            if (this.session.isolationMode !== 'none') {
                try {
                    const { addWorktree, getCurrentBranch } = await import('../git/operations.js');
                    const currentBranch = await getCurrentBranch(this.session.projectPath);
                    await addWorktree(this.session.projectPath, workspacePath, currentBranch);

                    workspace = {
                        id: `workspace-${iteration}`,
                        path: workspacePath,
                        ref: currentBranch,
                        iteration,
                        timestamp: new Date(),
                    };
                } catch (error) {
                    console.warn(`Failed to create worktree: ${error}, using project path directly`);
                    workspace = {
                        id: `workspace-${iteration}`,
                        path: this.session.projectPath,
                        ref: 'local',
                        iteration,
                        timestamp: new Date(),
                    };
                }
            } else {
                workspace = {
                    id: `workspace-${iteration}`,
                    path: this.session.projectPath,
                    ref: 'local',
                    iteration,
                    timestamp: new Date(),
                };
            }
        }

        this.session.workspaces.push(workspace);
        await this.persistState();

        console.log(`   ✅ Workspace created: ${workspace.path} (iteration=${iteration})`);
    }

    private async cleanStaleWorkspaces(projectPath: string): Promise<void> {
        if (this.vcs) {
            await this.vcs.cleanStaleWorkspaces(projectPath);
        } else {
            try {
                const { listWorktrees, removeWorktree } = await import('../git/operations.js');
                const worktreePaths = await listWorktrees(projectPath);
                for (const wtPath of worktreePaths) {
                    if (!wtPath.includes('master') && !wtPath.includes('main')) {
                        try {
                            await removeWorktree(projectPath, wtPath);
                        } catch (error) {
                            console.warn(`Could not remove worktree: ${error}`);
                        }
                    }
                }
            } catch (error) {
                console.warn(`Could not clean stale worktrees: ${error}`);
            }
        }
    }

    private async findNextIteration(projectPath: string): Promise<number> {
        if (this.vcs) {
            return await this.vcs.findNextIteration(projectPath);
        }

        try {
            const { listWorktrees } = await import('../git/operations.js');
            const worktreePaths = await listWorktrees(projectPath);
            let maxIter = 0;
            for (const wtPath of worktreePaths) {
                const match = wtPath.match(/\.hugr-iter-(\d+)/);
                if (match) {
                    maxIter = Math.max(maxIter, parseInt(match[1], 10));
                }
            }
            return maxIter + 1;
        } catch (error) {
            console.warn(`Could not find next iteration: ${error}`);
            return 1;
        }
    }

    private async mergeWorkspace(workspacePath: string, targetBranch: string = 'main'): Promise<void> {
        if (this.vcs) {
            const workspace = this.session?.workspaces.find(w => w.path === workspacePath);
            if (workspace) {
                await this.vcs.mergeWorkspace(this.session!.projectPath, workspace);
            }
        } else {
            try {
                const { mergeBranch, abortMerge } = await import('../git/operations.js');
                await mergeBranch(workspacePath, targetBranch);
            } catch (error) {
                console.warn(`Merge failed, aborting: ${error}`);
                try {
                    const { abortMerge } = await import('../git/operations.js');
                    await abortMerge(workspacePath);
                } catch {
                    // ignore abort failure
                }
                throw error;
            }
        }
    }

    private async persistState(): Promise<void> {
        if (!this.session) return;

        const sessionDir = this.session.id;

        if (this.storage) {
            try {
                await this.storage.write(
                    join(sessionDir, 'state.json'),
                    JSON.stringify(this.session, null, 2)
                );
            } catch (error) {
                console.warn(`Failed to write state via storage: ${error}`);
                await this.fallbackPersistState();
            }
        } else {
            await this.fallbackPersistState();
        }
    }

    private async fallbackPersistState(): Promise<void> {
        if (!this.session) return;

        try {
            const sessionDataDir = await this.resolveSessionDataDir();
            const sessionDir = join(sessionDataDir, this.session.id);
            await mkdir(sessionDir, { recursive: true });
            await writeFile(
                join(sessionDir, 'state.json'),
                JSON.stringify(this.session, null, 2)
            );
        } catch (error) {
            console.error(`Failed to persist state: ${error}`);
        }
    }

    private async loadPersistedState(sessionId: string): Promise<SessionState | null> {
        if (this.storage) {
            try {
                const content = await this.storage.read(join(sessionId, 'state.json'));
                if (!content) return null;
                return JSON.parse(content);
            } catch (error) {
                console.warn(`Failed to read state via storage: ${error}`);
                return await this.fallbackLoadPersistedState(sessionId);
            }
        } else {
            return await this.fallbackLoadPersistedState(sessionId);
        }
    }

    private async fallbackLoadPersistedState(sessionId: string): Promise<SessionState | null> {
        try {
            const sessionDataDir = await this.resolveSessionDataDir();
            const content = await readFile(
                join(sessionDataDir, sessionId, 'state.json'),
                'utf-8'
            );
            const state = JSON.parse(content) as SessionState;
            state.startedAt = new Date(state.startedAt);
            if (state.completedAt) {
                state.completedAt = new Date(state.completedAt);
            }
            if (state.sessionLimitInfo) {
                state.sessionLimitInfo.hitAt = new Date(state.sessionLimitInfo.hitAt);
            }
            return state;
        } catch (error) {
            return null;
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
            if (this.session.workspaces.length === 0) {
                await this.createFirstWorkspace();
            }
            await this.dispatchToCoder();
        } else if (phase === 'raven') {
            await this.dispatchToRaven();
        } else if (phase === 'reviewer') {
            await this.dispatchToReviewer();
        } else if (phase === 'complete') {
            await this.completeSession('completed');
        } else {
            if (this.session.workspaces.length === 0) {
                await this.createFirstWorkspace();
            }
            await this.dispatchToCoder();
        }
    }

    private async cleanSessionData(projectPath: string): Promise<void> {
        try {
            const sessionDataDir = await this.resolveSessionDataDir();
            const sessionDir = join(sessionDataDir, this.session?.id || 'unknown');

            if (this.storage) {
                try {
                    const files = await this.storage.list(sessionDir);
                    for (const file of files) {
                        try {
                            await this.storage.delete(file);
                        } catch {
                            // ignore individual delete failures
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to clean via storage: ${error}`);
                    await this.fallbackCleanSessionData(sessionDir);
                }
            } else {
                await this.fallbackCleanSessionData(sessionDir);
            }
        } catch (error) {
            console.warn(`Could not clean session data: ${error}`);
        }
    }

    private async fallbackCleanSessionData(sessionDir: string): Promise<void> {
        try {
            const oldStateFile = join(sessionDir, 'state.json');
            await unlink(oldStateFile);
        } catch {
            // ignore if file doesn't exist
        }
    }

    private async resolveSessionDataDir(): Promise<string> {
        if (!this.session) {
            throw new Error('No active session');
        }
        return join(this.session.projectPath, '.hugr-session');
    }

    private buildDispatchContext(): import('./registry.js').AgentDispatchContext {
        return {
            session: this.session!,
            rootJobId: this.rootJobId!,
            joblog: this.joblog,
            runtime: this.runtime,
            events: this.events as any,
            vcs: this.vcs,
            storage: this.storage,
            agentTeams: this.agentTeams,
        };
    }

    private async send(message: any): Promise<void> {
        await this.joblog.sendMessage({
            from: 'manager',
            type: message.type,
            payload: message.payload,
            to: message.to,
            jobId: message.jobId,
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
