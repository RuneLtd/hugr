import { Agent, type AgentConfig } from './Agent.js';
import type { AgentMessage } from '../types/joblog.js';

export type MessageHandler = (
    message: AgentMessage,
    agent: Agent,
) => Promise<void>;

export interface CreateAgentOptions extends Omit<AgentConfig, 'id' | 'name'> {
    id: string;
    name?: string;
    handler: MessageHandler;
    onStart?: () => Promise<void>;
    onStop?: () => Promise<void>;
    onError?: (error: unknown, message: AgentMessage) => Promise<void>;
}

class FunctionalAgent extends Agent {
    private readonly handler: MessageHandler;
    private readonly startHook?: () => Promise<void>;
    private readonly stopHook?: () => Promise<void>;
    private readonly errorHook?: (error: unknown, message: AgentMessage) => Promise<void>;

    constructor(options: CreateAgentOptions) {
        super({
            id: options.id,
            name: options.name ?? options.id,
            joblog: options.joblog,
            runtime: options.runtime,
            pollInterval: options.pollInterval,
            projectPath: options.projectPath,
            retries: options.retries,
            timeoutMs: options.timeoutMs,
        });
        this.handler = options.handler;
        this.startHook = options.onStart;
        this.stopHook = options.onStop;
        this.errorHook = options.onError;
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        await this.handler(message, this);
    }

    protected async onStart(): Promise<void> {
        if (this.startHook) await this.startHook();
    }

    protected async onStop(): Promise<void> {
        if (this.stopHook) await this.stopHook();
    }

    protected async onError(error: unknown, message: AgentMessage): Promise<void> {
        if (this.errorHook) {
            await this.errorHook(error, message);
        } else {
            await super.onError(error, message);
        }
    }
}

export function createAgent(options: CreateAgentOptions): Agent {
    return new FunctionalAgent(options);
}
