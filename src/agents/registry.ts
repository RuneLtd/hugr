import type { Joblog } from '../joblog/Joblog.js';
import type { AgentRuntime } from '../runtime/types.js';
import type { VCSProvider } from '../vcs/types.js';
import type { StorageProvider } from '../storage/types.js';
import type { SkillLoader } from '../skills/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { TypedEmitter } from '../events/emitter.js';
import type { HugrEvents } from '../events/types.js';
import type { PipelineStep } from '../config/schema.js';

export interface AgentDispatchContext {
    session: any;
    rootJobId: string;
    joblog: Joblog;
    runtime: AgentRuntime;
    events: TypedEmitter<HugrEvents>;
    vcs?: VCSProvider;
    storage?: StorageProvider;
    skills?: SkillLoader;
    tools?: ToolRegistry;
    agentTeams: boolean;
}

export interface AgentHandler {
    id: string;

    dispatch(
        step: PipelineStep,
        context: AgentDispatchContext,
    ): Promise<void>;

    handleResult(
        message: any,
        payload: any,
        context: AgentDispatchContext,
    ): Promise<{ advance: boolean; loopToStep?: number }>;

    getPhaseLabel(): string;
}

export class AgentRegistry {
    private handlers = new Map<string, AgentHandler>();

    register(handler: AgentHandler): void {
        this.handlers.set(handler.id, handler);
    }

    get(agentId: string): AgentHandler | undefined {
        return this.handlers.get(agentId);
    }

    has(agentId: string): boolean {
        return this.handlers.has(agentId);
    }

    list(): string[] {
        return Array.from(this.handlers.keys());
    }

    unregister(agentId: string): boolean {
        return this.handlers.delete(agentId);
    }
}
