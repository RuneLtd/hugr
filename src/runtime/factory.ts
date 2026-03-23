import type { AgentRuntime } from './types.js';

export type RuntimeName = 'claude-code' | (string & {});

export interface RuntimeFactoryOptions {
    cliPath?: string;
    model?: string;
    timeout?: number;
    maxRetries?: number;
    [key: string]: unknown;
}

type RuntimeFactory = (options: RuntimeFactoryOptions) => AgentRuntime | Promise<AgentRuntime>;

const registry = new Map<string, RuntimeFactory>();

let builtinsRegistered = false;

function ensureBuiltins(): void {
    if (builtinsRegistered) return;
    builtinsRegistered = true;

    registry.set('claude-code', async (options: RuntimeFactoryOptions) => {
        const { ClaudeCodeRuntime } = await import('./claude-code/runtime.js');
        return new ClaudeCodeRuntime({
            cliPath: options.cliPath,
            model: options.model,
            timeout: options.timeout,
            maxRetries: options.maxRetries,
            queryTimeout: options.timeout,
            executeTimeout: options.timeout ? options.timeout * 6 : undefined,
        });
    });
}

export function registerRuntime(name: string, factory: RuntimeFactory): void {
    ensureBuiltins();
    registry.set(name, factory);
}

export async function createRuntime(name: RuntimeName, options: RuntimeFactoryOptions = {}): Promise<AgentRuntime> {
    ensureBuiltins();
    const factory = registry.get(name);
    if (factory) {
        return factory(options);
    }

    throw new Error(
        `Unknown runtime "${name}". Available: ${[...registry.keys()].join(', ')}. ` +
        `Use registerRuntime() to add custom runtimes.`
    );
}

export function listRuntimes(): string[] {
    ensureBuiltins();
    return [...registry.keys()];
}
