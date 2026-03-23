import type { LLMProvider } from '../types/llm.js';

export type ProviderName = 'claude-code' | (string & {});

export interface ProviderFactoryOptions {
    cliPath?: string;
    model?: string;
    timeout?: number;
    maxRetries?: number;
    [key: string]: unknown;
}

type ProviderFactory = (options: ProviderFactoryOptions) => LLMProvider | Promise<LLMProvider>;

const registry = new Map<string, ProviderFactory>();

let builtinsRegistered = false;

function ensureBuiltins(): void {
    if (builtinsRegistered) return;
    builtinsRegistered = true;

    registry.set('claude-code', async (options: ProviderFactoryOptions) => {
        const { ClaudeCodeProvider } = await import('./claude-code.js');
        return new ClaudeCodeProvider({
            cliPath: options.cliPath,
            model: options.model,
            timeout: options.timeout,
            maxRetries: options.maxRetries,
            queryTimeout: options.timeout,
            executeTimeout: options.timeout ? options.timeout * 6 : undefined,
        });
    });
}

export function registerProvider(name: string, factory: ProviderFactory): void {
    ensureBuiltins();
    registry.set(name, factory);
}

export async function createProvider(name: ProviderName, options: ProviderFactoryOptions = {}): Promise<LLMProvider> {
    ensureBuiltins();
    const factory = registry.get(name);
    if (factory) {
        return factory(options);
    }

    throw new Error(
        `Unknown provider "${name}". Available: ${[...registry.keys()].join(', ')}. ` +
        `Use registerProvider() to add custom providers.`
    );
}

export function listProviders(): string[] {
    ensureBuiltins();
    return [...registry.keys()];
}
