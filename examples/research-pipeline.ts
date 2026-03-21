import { Joblog } from '../src/joblog/Joblog.js';
import { Manager, type ManagerConfig, type SessionConfig } from '../src/agents/Manager.js';
import { AgentRegistry, type AgentHandler, type AgentDispatchContext } from '../src/agents/registry.js';
import type { PipelineConfig, PipelineStep } from '../src/config/schema.js';
import type { AgentRuntime, AgentRunOptions, AgentRunResult, CompletionOptions, CompletionResult, ModelInfo } from '../src/runtime/types.js';

class MockRuntime implements AgentRuntime {
    name = 'mock';

    async isAvailable(): Promise<boolean> {
        return true;
    }

    async runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
        const start = Date.now();
        options.onActivity?.({
            type: 'thinking',
            content: `Processing: ${options.task.slice(0, 100)}...`,
            timestamp: new Date(),
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        options.onActivity?.({
            type: 'result',
            content: `Completed task about: ${options.task.slice(0, 50)}`,
            timestamp: new Date(),
        });

        return {
            success: true,
            durationMs: Date.now() - start,
            transcript: `Mock result for: ${options.task.slice(0, 200)}`,
        };
    }

    async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
        return {
            text: `Mock completion for: ${prompt.slice(0, 100)}`,
            model: 'mock-model',
            durationMs: 50,
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        return [{ name: 'mock-model' }];
    }
}

function createResearchHandler(): AgentHandler {
    return {
        id: 'researcher',

        async dispatch(step: PipelineStep, context: AgentDispatchContext): Promise<void> {
            const task = context.session.currentPrompt || context.session.originalPrompt;

            await context.joblog.sendMessage({
                type: 'task_assignment',
                from: 'manager',
                to: 'researcher',
                jobId: context.rootJobId,
                payload: {
                    task: `Research the following topic:\n\n${task}`,
                    projectPath: context.session.projectPath,
                },
            });
        },

        async handleResult(message: any, payload: any, context: AgentDispatchContext) {
            if (payload.success && payload.currentPrompt) {
                context.session.currentPrompt = payload.currentPrompt;
            }
            return { advance: true };
        },

        getPhaseLabel() {
            return 'Researching';
        },
    };
}

function createValidatorHandler(): AgentHandler {
    return {
        id: 'validator',

        async dispatch(step: PipelineStep, context: AgentDispatchContext): Promise<void> {
            const content = context.session.currentPrompt || context.session.originalPrompt;

            await context.joblog.sendMessage({
                type: 'task_assignment',
                from: 'manager',
                to: 'validator',
                jobId: context.rootJobId,
                payload: {
                    task: `Validate the following content for accuracy and completeness:\n\n${content}`,
                    projectPath: context.session.projectPath,
                    contentToValidate: content,
                },
            });
        },

        async handleResult(message: any, payload: any, context: AgentDispatchContext) {
            const passed = payload.done !== false;
            if (!passed && payload.nextPrompt) {
                context.session.currentPrompt = payload.nextPrompt;
                return { advance: false, loopToStep: 0 };
            }
            return { advance: true };
        },

        getPhaseLabel() {
            return 'Validating';
        },
    };
}

function createSummarizerHandler(): AgentHandler {
    return {
        id: 'summarizer',

        async dispatch(step: PipelineStep, context: AgentDispatchContext): Promise<void> {
            const content = context.session.currentPrompt || context.session.originalPrompt;

            await context.joblog.sendMessage({
                type: 'task_assignment',
                from: 'manager',
                to: 'summarizer',
                jobId: context.rootJobId,
                payload: {
                    task: `Create a final summary report from the following research:\n\n${content}`,
                    projectPath: context.session.projectPath,
                },
            });
        },

        async handleResult(message: any, payload: any) {
            return { advance: true };
        },

        getPhaseLabel() {
            return 'Summarizing';
        },
    };
}

async function main() {
    const projectPath = '/tmp/hugr-research-demo';

    const runtime = new MockRuntime();

    const registry = new AgentRegistry();
    registry.register(createResearchHandler());
    registry.register(createValidatorHandler());
    registry.register(createSummarizerHandler());

    const pipeline: PipelineConfig = {
        id: 'research-pipeline',
        name: 'Research → Validate → Summarize',
        description: 'Three-step research pipeline with validation loop',
        steps: [
            {
                agentId: 'researcher',
                enabled: true,
            },
            {
                agentId: 'validator',
                enabled: true,
            },
            {
                agentId: 'summarizer',
                enabled: true,
            },
        ],
    };

    const joblog = new Joblog({ projectPath });
    await joblog.initialize();

    const managerConfig: ManagerConfig = {
        joblog,
        runtime,
        pipelineConfig: pipeline,
        agentRegistry: registry,
    };

    const manager = new Manager(managerConfig);

    manager.events.on('activity', (data) => {
        console.log(`[${data.agentId ?? 'system'}] ${data.type}: ${data.message}`);
    });

    manager.events.on('session:completed', (data) => {
        console.log(`\nSession ${data.status} in ${data.durationMs}ms (${data.iterations} iterations)`);
    });

    manager.events.on('session:failed', (data) => {
        console.error(`\nSession failed: ${data.error}`);
    });

    const sessionConfig: SessionConfig = {
        task: 'Research the impact of large language models on software development practices in 2025',
        projectPath,
        autonomy: 'auto',
        isolationMode: 'none',
    };

    console.log('Starting research pipeline...\n');

    const sessionId = await manager.startSession(sessionConfig);
    console.log(`Session ID: ${sessionId}\n`);

    await manager.run();

    const session = manager.getSession();
    console.log(`\nFinal state: ${session?.status}`);
    console.log(`Prompt evolved through ${session?.workspaces?.length ?? 0} workspaces`);

    await joblog.close();
}

main().catch(console.error);
