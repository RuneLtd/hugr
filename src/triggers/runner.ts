
import { TriggerEngine } from './TriggerEngine.js';
import { TypedEmitter } from '../events/emitter.js';
import { Joblog } from '../joblog/Joblog.js';
import { Manager } from '../agents/Manager.js';
import { Architect } from '../agents/library/Architect.js';
import { Coder } from '../agents/library/Coder.js';
import { Raven } from '../agents/library/Raven.js';
import { Reviewer } from '../agents/library/Reviewer.js';
import { SkillCreator } from '../agents/library/SkillCreator.js';
import { CustomAgent } from '../agents/library/CustomAgent.js';
import type { Agent } from '../agents/Agent.js';
import type { AgentRuntime } from '../runtime/types.js';
import type { PipelineConfig, PipelineStep, TriggersConfig } from '../config/schema.js';
import type { TriggerEvent, TriggerConfig, TriggerState } from './types.js';
import type { HugrEvents } from '../events/types.js';

export interface TriggerRunnerConfig {
    triggers: TriggersConfig;
    runtime: AgentRuntime;
    defaultProjectPath: string;
    defaultPipeline: PipelineConfig;
    defaultAutonomy?: 'supervised' | 'auto';
    pollInterval?: number;
    agentTeams?: boolean;
    log?: (message: string) => void;
    onSessionLimited?: (data: { resetTime?: string; error: string; jobId?: string }) => void;
}

export interface TriggerSession {
    triggerId: string;
    sessionId: string;
    manager: Manager;
    startedAt: Date;
    status: 'running' | 'completed' | 'failed';
}

export class TriggerRunner {
    private engine: TriggerEngine | null = null;
    private readonly config: TriggerRunnerConfig;
    private readonly log: (msg: string) => void;
    private activeSessions = new Map<string, TriggerSession>();
    public readonly events = new TypedEmitter<HugrEvents>();
    private running = false;

    constructor(config: TriggerRunnerConfig) {
        this.config = config;
        this.log = config.log ?? console.log;
    }

    async start(): Promise<void> {
        if (this.running) return;

        const triggersConfig = this.config.triggers;

        if (triggersConfig.enabled === false) {
            this.log('  Triggers globally disabled');
            return;
        }

        if (!triggersConfig.triggers || triggersConfig.triggers.length === 0) {
            this.log('  No triggers configured');
            return;
        }

        const triggerConfigs: TriggerConfig[] = triggersConfig.triggers.map(def => ({
            id: def.id,
            type: def.type,
            enabled: def.enabled,
            pipeline: def.pipeline,
            task: def.task,
            projectPath: def.projectPath,
            autonomy: def.autonomy,
            maxConcurrent: def.maxConcurrent,
            cooldown: def.cooldown,
            cron: def.cron,
            webhook: def.webhook,
            poll: def.poll,
            watch: def.watch,
            tags: def.tags,
            metadata: def.metadata,
        }));

        this.engine = new TriggerEngine({
            enabled: triggersConfig.enabled,
            triggers: triggerConfigs,
            onTrigger: (event) => this.handleTrigger(event),
            webhookPort: triggersConfig.webhookPort,
            webhookHost: triggersConfig.webhookHost,
            log: this.log,
        });

        await this.engine.start();
        this.running = true;
        this.log(`  TriggerRunner started with ${triggerConfigs.length} trigger(s)`);
    }

    async stop(): Promise<void> {
        if (!this.running) return;

        if (this.engine) {
            await this.engine.stop();
            this.engine = null;
        }

        for (const [key, session] of this.activeSessions) {
            session.manager.stop();
            session.status = 'completed';
        }
        this.activeSessions.clear();

        this.running = false;
        this.log('  TriggerRunner stopped');
    }

    isRunning(): boolean {
        return this.running;
    }

    getActiveSessions(): TriggerSession[] {
        return [...this.activeSessions.values()];
    }

    getTriggerStates(): TriggerState[] {
        return this.engine?.getStates() ?? [];
    }

    getEngine(): TriggerEngine | null {
        return this.engine;
    }

    private async handleTrigger(event: TriggerEvent): Promise<void> {
        const triggerMeta = event.payload._trigger as {
            id: string;
            type: string;
            task: string;
            pipeline?: string;
            projectPath?: string;
            autonomy?: string;
            tags?: string[];
            metadata?: Record<string, unknown>;
        } | undefined;

        const task = triggerMeta?.task ?? event.payload.task as string ?? `Trigger ${event.triggerId} fired`;
        const projectPath = triggerMeta?.projectPath ?? this.config.defaultProjectPath;
        const autonomy = (triggerMeta?.autonomy ?? this.config.defaultAutonomy ?? 'auto') as 'supervised' | 'auto';

        this.log(`\n  ⚡ Trigger fired: ${event.triggerId} (${event.triggerType})`);
        this.log(`     Task: ${task.slice(0, 120)}${task.length > 120 ? '...' : ''}`);
        this.log(`     Project: ${projectPath}`);

        this.events.emit('trigger:fired', {
            triggerId: event.triggerId,
            triggerType: event.triggerType,
            task,
            payload: event.payload,
            timestamp: event.timestamp,
        });

        try {
            const pipeline = this.resolvePipeline(event);

            const joblog = new Joblog({ projectPath });
            await joblog.initialize();
            await joblog.reset();
            await joblog.initialize();

            const manager = new Manager({
                joblog,
                runtime: this.config.runtime,
                pipelineConfig: pipeline,
                pollInterval: this.config.pollInterval,
                agentTeams: this.config.agentTeams,
                onSessionLimited: this.config.onSessionLimited,
            });

            manager.events.on('activity', (data) => {
                this.events.emit('agent:activity', {
                    agentId: data.agentId ?? 'unknown',
                    agentName: data.agentName,
                    type: data.type,
                    message: data.message,
                    details: data.details,
                    jobId: data.jobId,
                });
            });

            manager.events.on('session:completed', (data) => {
                this.events.emit('session:completed', data);
            });

            manager.events.on('session:failed', (data) => {
                this.events.emit('session:failed', data);
            });

            manager.events.on('iteration:completed', (data) => {
                this.events.emit('iteration:completed', data);
            });

            const sessionId = await manager.startSession({
                task,
                projectPath,
                autonomy,
                isolationMode: 'none',
            });

            const agents = this.createAgents(pipeline, joblog, projectPath);

            const triggerSession: TriggerSession = {
                triggerId: event.triggerId,
                sessionId,
                manager,
                startedAt: new Date(),
                status: 'running',
            };

            const sessionKey = `${event.triggerId}-${sessionId}`;
            this.activeSessions.set(sessionKey, triggerSession);

            this.events.emit('trigger:fired', {
                triggerId: event.triggerId,
                triggerType: event.triggerType,
                task,
                payload: event.payload,
                sessionId,
                timestamp: event.timestamp,
            });

            const agentPromises = agents.map(agent =>
                agent.run().catch((err: unknown) => {
                    const error = err instanceof Error ? err.message : String(err);
                    this.log(`  ⚠️ Agent ${agent.id} error: ${error}`);
                })
            );

            const managerPromise = manager.run().then(() => {
                agents.forEach(a => a.stop());
            });

            Promise.all([managerPromise, ...agentPromises]).then(() => {
                triggerSession.status = 'completed';
                this.activeSessions.delete(sessionKey);
                this.log(`  ✅ Trigger session completed: ${event.triggerId} → ${sessionId}`);
            }).catch((err) => {
                agents.forEach(a => a.stop());
                triggerSession.status = 'failed';
                this.activeSessions.delete(sessionKey);
                const error = err instanceof Error ? err.message : String(err);
                this.log(`  ❌ Trigger session failed: ${event.triggerId} → ${error}`);
                this.events.emit('trigger:error', {
                    triggerId: event.triggerId,
                    error,
                });
            });

        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.log(`  ❌ Failed to start trigger session: ${error}`);
            this.events.emit('trigger:error', {
                triggerId: event.triggerId,
                error,
            });
        }
    }

    private createAgents(pipeline: PipelineConfig, joblog: Joblog, projectPath: string): Agent[] {
        const runtime = this.config.runtime;
        const pollInterval = this.config.pollInterval ?? 100;
        const agentTeams = this.config.agentTeams;
        const created = new Set<string>();
        const agents: Agent[] = [];

        const onActivity = (activity: { type: string; message: string; agentId?: string; jobId?: string; details?: string }) => {
            this.events.emit('agent:activity', {
                agentId: activity.agentId ?? 'unknown',
                type: activity.type,
                message: activity.message,
                jobId: activity.jobId,
                details: activity.details,
            });
        };
        const activityCallback = onActivity as never;

        for (const step of pipeline.steps) {
            if (!step.enabled) continue;
            if (created.has(step.agentId)) continue;
            created.add(step.agentId);

            switch (step.agentId) {
                case 'architect':
                    agents.push(new Architect({
                        joblog,
                        runtime,
                        pollInterval,
                        onActivity: activityCallback,
                        skills: step.agentConfig?.skills,
                        skillPrefix: 'hugr',
                    }));
                    break;
                case 'coder':
                    agents.push(new Coder({
                        joblog,
                        runtime,
                        pollInterval,
                        projectPath,
                        autoAccept: true,
                        onActivity: activityCallback,
                        selfReview: true,
                        agentTeams,
                        skipGitTracking: true,
                        skills: step.agentConfig?.skills,
                        skillPrefix: 'hugr',
                    }));
                    break;
                case 'raven':
                    agents.push(new Raven({
                        joblog,
                        runtime,
                        pollInterval,
                        projectPath,
                        onActivity: activityCallback,
                        agentTeams,
                        skipGitTracking: true,
                        skillPrefix: 'hugr',
                    }));
                    break;
                case 'reviewer':
                    agents.push(new Reviewer({
                        joblog,
                        runtime,
                        pollInterval,
                        projectPath,
                        onActivity: activityCallback,
                        agentTeams,
                        skipGitTracking: true,
                        skills: step.agentConfig?.skills,
                        skillPrefix: 'hugr',
                    }));
                    break;
                case 'hugr-skill-creator':
                    agents.push(new SkillCreator({
                        joblog,
                        runtime,
                        pollInterval,
                        onActivity: activityCallback,
                        skillPrefix: 'hugr',
                    }));
                    break;
                default:
                    if (step.agentConfig) {
                        agents.push(new CustomAgent({
                            id: step.agentId,
                            agentConfig: step.agentConfig,
                            joblog,
                            runtime,
                            pollInterval,
                            projectPath,
                            onActivity: activityCallback,
                            agentTeams,
                            skipGitTracking: true,
                            isPipelineAgent: true,
                        }));
                    }
                    break;
            }
        }

        return agents;
    }

    private resolvePipeline(event: TriggerEvent): PipelineConfig {
        const triggerMeta = event.payload._trigger as {
            pipeline?: string;
            metadata?: Record<string, unknown>;
        } | undefined;

        if (triggerMeta?.metadata?.pipeline) {
            const customPipeline = triggerMeta.metadata.pipeline as {
                name?: string;
                description?: string;
                steps?: Array<{
                    agentId: string;
                    agentConfig?: {
                        name: string;
                        instructions: string;
                        toolAccess: 'full' | 'read-only' | 'read-write-no-bash';
                        allowedTools?: string[];
                    };
                    enabled: boolean;
                    mode?: string;
                    iterations?: number;
                    maxIterations?: number;
                    loopUntilDone?: boolean;
                }>;
            };

            if (customPipeline.steps && customPipeline.steps.length > 0) {
                return {
                    id: `trigger-${event.triggerId}`,
                    name: customPipeline.name ?? `Trigger: ${event.triggerId}`,
                    description: customPipeline.description,
                    steps: customPipeline.steps.map(step => ({
                        ...step,
                        enabled: step.enabled !== false,
                    })) as PipelineStep[],
                };
            }
        }

        return this.config.defaultPipeline;
    }
}
