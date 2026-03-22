import { Agent, type AgentConfig } from '../Agent.js';
import type { AgentMessage } from '../../types/joblog.js';

export interface Route {
    agentId: string;
    description: string;
    condition?: string;
}

export interface RouterConfig extends Omit<AgentConfig, 'id' | 'name'> {
    id?: string;
    name?: string;
    routes: Route[];
    defaultRoute?: string;
    useRuntime?: boolean;
    routeFn?: (message: AgentMessage, routes: Route[]) => Promise<string | string[]>;
}

export class Router extends Agent {
    private readonly routes: Route[];
    private readonly defaultRoute?: string;
    private readonly useRuntime: boolean;
    private readonly routeFn?: (message: AgentMessage, routes: Route[]) => Promise<string | string[]>;

    constructor(config: RouterConfig) {
        super({
            ...config,
            id: config.id ?? 'router',
            name: config.name ?? 'Router',
        });
        this.routes = config.routes;
        this.defaultRoute = config.defaultRoute;
        this.useRuntime = config.useRuntime ?? false;
        this.routeFn = config.routeFn;
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        let targetAgents: string[];

        if (this.routeFn) {
            const result = await this.routeFn(message, this.routes);
            targetAgents = Array.isArray(result) ? result : [result];
        } else if (this.useRuntime) {
            targetAgents = await this.routeWithRuntime(message);
        } else {
            targetAgents = this.defaultRoute ? [this.defaultRoute] : [this.routes[0]?.agentId ?? 'executor'];
        }

        for (const agentId of targetAgents) {
            await this.send({
                type: 'task_assignment',
                to: agentId,
                jobId: message.jobId!,
                payload: message.payload,
            });
        }
    }

    private async routeWithRuntime(message: AgentMessage): Promise<string[]> {
        const payload = message.payload as { task?: string; context?: string };
        const routeDescriptions = this.routes
            .map(r => `- "${r.agentId}": ${r.description}${r.condition ? ` (when: ${r.condition})` : ''}`)
            .join('\n');

        const prompt = `Given the following task, decide which agent(s) should handle it. Available agents:\n${routeDescriptions}\n\nTask: ${payload?.task ?? JSON.stringify(message.payload)}\n\nRespond with a JSON array of agent IDs, e.g. ["agent1"] or ["agent1", "agent2"] for parallel execution.`;

        const result = await this.runtime.runAgent({
            workdir: this.projectPath ?? process.cwd(),
            task: prompt,
        });

        try {
            const match = result.transcript?.match(/\[[\s\S]*?\]/);
            if (match) return JSON.parse(match[0]);
        } catch {}

        return this.defaultRoute ? [this.defaultRoute] : [this.routes[0]?.agentId ?? 'executor'];
    }
}
