export interface ToolCapability {
    read: boolean;
    write: boolean;
    execute: boolean;
    search: boolean;
    web: boolean;
}

export interface ToolDefinition {
    name: string;
    description?: string;
    capabilities: Partial<ToolCapability>;
    provider?: string;
}

export type ToolAccessLevel = 'full' | 'read-only' | 'read-write-no-bash' | (string & {});

export interface ToolResolver {
    resolveTools(accessLevel: ToolAccessLevel, overrides?: string[]): string[];
    getAvailableTools(): ToolDefinition[];
    mapToolName(genericName: string): string;
}
